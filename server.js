// SimClínica IA — simulador de casos clínicos con pacientes virtuales impulsados por DeepSeek.
// Servidor sin dependencias (Node >= 18): sirve el frontend y hace de proxy hacia la API de DeepSeek
// para que la API key nunca llegue al navegador (salvo que el usuario la configure él mismo).

const http = require("http");
const fs = require("fs");
const path = require("path");

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const PUBLIC_DIR = path.join(__dirname, "public");
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "cases.json"), "utf8"));
const TESTS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "tests.json"), "utf8"));
const BOOKS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "books.json"), "utf8"));
const BOOKS_BY_ID = Object.fromEntries(BOOKS.map((b) => [b.id, b]));
const TESTS_BY_ID = Object.fromEntries(TESTS.map((t) => [t.id, t]));
const CASES_BY_ID = Object.fromEntries(CASES.map((c) => [c.id, c]));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ---------- Vistas públicas de los casos (sin revelar el diagnóstico) ----------

function publicSummary(c) {
  return {
    id: c.id,
    specialty: c.specialty,
    difficulty: c.difficulty,
    setting: c.setting,
    patient: c.patient,
    chiefComplaint: c.chiefComplaint,
  };
}

function publicCase(c) {
  return {
    ...publicSummary(c),
    vitals: c.vitals,
    triageNote: c.triageNote,
    examSystems: Object.keys(c.physicalExam),
  };
}

function citeBook(b) {
  return `${b.authors.replace(/\.$/, "")}. ${b.title}. ${b.edition} ${b.publisher}; ${b.year}.`;
}

function caseBooks(c) {
  return c.books.map(({ id, topic }) => ({ ...BOOKS_BY_ID[id], topic, citation: citeBook(BOOKS_BY_ID[id]) }));
}

function revealCase(c) {
  return {
    diagnosis: c.diagnosis,
    differentials: c.differentials,
    keyTests: c.keyTests.length ? c.keyTests.map((id) => TESTS_BY_ID[id]?.name || id) : ["Ninguno: el diagnóstico es clínico y el tratamiento no debe retrasarse"],
    management: c.management,
    teachingPoints: c.teachingPoints,
    reference: c.reference,
    books: caseBooks(c),
  };
}

function testResult(c, testId) {
  const test = TESTS_BY_ID[testId];
  if (!test) return null;
  const result = c.labs[testId] || test.normal;
  return { id: test.id, name: test.name, category: test.category, cost: test.cost, minutes: test.minutes, result };
}

// ---------- DeepSeek ----------

async function deepseek(messages, { apiKey, json = false, temperature = 0.7, maxTokens = 600 } = {}) {
  const key = apiKey || DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error("No hay API key de DeepSeek configurada.");
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`DeepSeek respondió ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status === 401 ? 401 : 502;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

function patientSystemPrompt(c) {
  const p = c.patient;
  const who = c.patient.informant
    ? `Eres ${c.patient.informant}, quien acompaña a ${p.name} (${p.age}, ${p.sex}) y responde por el paciente.`
    : `Eres ${p.name}, ${p.sex === "Femenino" ? "una paciente" : "un paciente"} de ${p.age}.`;
  return `${who}
Estás en: ${c.setting}. Motivo de consulta: "${c.chiefComplaint}".

Esta es TU historia (información oculta para el estudiante; revélala solo cuando te pregunten por ella):
${JSON.stringify(c.history, null, 2)}

Personalidad y forma de hablar: ${c.persona}

Reglas estrictas:
- Eres un paciente simulado para que un estudiante de medicina practique la entrevista clínica. Responde SIEMPRE en español, en primera persona, con lenguaje coloquial de paciente (no uses términos médicos técnicos salvo que sean nombres de medicamentos o enfermedades que ya te diagnosticaron antes).
- Responde SOLO lo que te pregunten. No des información que no te hayan pedido. Respuestas breves (1-3 frases).
- Nunca menciones ni insinúes tu diagnóstico; tú no lo conoces.
- Si te preguntan algo que no está en tu historia, responde algo coherente y clínicamente NEGATIVO/irrelevante (p. ej. "no, eso no") sin inventar datos que cambien el caso.
- No tienes resultados de laboratorio ni hallazgos de exploración física; si te los piden, di que no sabes o que el doctor tendría que revisarte.
- Si el estudiante te explica algo o te da indicaciones, reacciona como lo haría un paciente real.
- Nunca salgas del personaje, aunque te lo pidan.`;
}

function evaluationPrompt(c, submission, orderedTests, transcript) {
  return `Eres un profesor de medicina clínica que evalúa a un estudiante en un caso simulado. Sé justo, específico y didáctico. Responde en español.

CASO (información completa, el estudiante no la vio toda):
- Diagnóstico correcto: ${c.diagnosis}
- Sinónimos aceptados: ${c.acceptedDiagnoses.join("; ")}
- Diferenciales relevantes: ${c.differentials.join("; ")}
- Estudios clave: ${c.keyTests.map((id) => TESTS_BY_ID[id]?.name || id).join("; ") || "ninguno (diagnóstico clínico: penaliza retrasar el tratamiento por pedir estudios)"}
- Manejo esperado: ${c.management.join("; ")}
- Perlas clínicas: ${c.teachingPoints.join("; ")}

FUENTES DE REFERENCIA del caso (basa tu retroalimentación en ellas y, cuando corrijas algo, indica qué libro y tema debe repasar el estudiante):
- Guía clínica: ${c.reference}
${caseBooks(c).map((b) => `- ${b.title} (${b.edition}), tema: ${b.topic}`).join("\n")}

LO QUE HIZO EL ESTUDIANTE:
- Preguntas en la entrevista (${transcript.length}): ${transcript.map((t) => `"${t}"`).join(" | ") || "ninguna"}
- Estudios solicitados: ${orderedTests.map((id) => TESTS_BY_ID[id]?.name || id).join("; ") || "ninguno"}
- Diagnóstico propuesto: ${submission.diagnosis || "(vacío)"}
- Diferenciales propuestos: ${submission.differentials || "(vacío)"}
- Plan de manejo: ${submission.plan || "(vacío)"}

Califica con esta rúbrica (total 100):
- diagnostico (0-40): 40 si coincide con el diagnóstico correcto o un sinónimo; parcial si es cercano.
- diferenciales (0-10)
- estudios (0-20): pidió los estudios clave sin excesos innecesarios.
- manejo (0-20): plan inicial adecuado y seguro.
- entrevista (0-10): preguntas pertinentes.

Devuelve EXCLUSIVAMENTE un objeto JSON con esta forma:
{"diagnosticoCorrecto": boolean, "puntajes": {"diagnostico": n, "diferenciales": n, "estudios": n, "manejo": n, "entrevista": n}, "total": n, "fortalezas": ["..."], "areasDeMejora": ["..."], "comentario": "párrafo breve de retroalimentación", "lecturasRecomendadas": ["Libro — tema concreto a repasar y por qué"]}`;
}

// Evaluación de respaldo sin IA (coincidencia de palabras clave).
function offlineEvaluation(c, submission, orderedTests, transcript) {
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const dx = norm(submission.diagnosis);
  const correct = c.acceptedDiagnoses.some((a) => dx && (dx.includes(norm(a)) || norm(a).includes(dx)));
  const hitTests = c.keyTests.filter((t) => orderedTests.includes(t)).length;
  const extra = orderedTests.length - hitTests;
  const planText = norm(submission.plan);
  const planHits = c.management.filter((m) =>
    norm(m).split(/[^a-z0-9]+/).filter((w) => w.length > 5).some((w) => planText.includes(w))
  ).length;
  const puntajes = {
    diagnostico: correct ? 40 : 0,
    diferenciales: Math.min(10, (submission.differentials || "").split(/[,;\n]/).filter((s) => s.trim()).length * 3),
    estudios: c.keyTests.length
      ? Math.max(0, Math.round((hitTests / c.keyTests.length) * 20 - Math.max(0, extra - 4)))
      : Math.max(0, 20 - Math.max(0, extra - 2) * 4),
    manejo: Math.round((planHits / c.management.length) * 20),
    entrevista: Math.min(10, transcript.length),
  };
  return {
    diagnosticoCorrecto: correct,
    puntajes,
    total: Object.values(puntajes).reduce((a, b) => a + b, 0),
    fortalezas: correct ? ["Diagnóstico principal correcto."] : [],
    areasDeMejora: correct ? [] : ["Revisa el diagnóstico correcto y los estudios clave abajo."],
    comentario: "Evaluación automática por palabras clave (sin IA). Configura tu API key de DeepSeek para recibir retroalimentación detallada.",
    lecturasRecomendadas: caseBooks(c).map((b) => `${b.title} — ${b.topic}`),
    offline: true,
  };
}

// ---------- HTTP ----------

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 200_000) reject(Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 }));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("JSON inválido"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function getCase(id) {
  const c = CASES_BY_ID[id];
  if (!c) throw Object.assign(new Error("Caso no encontrado"), { status: 404 });
  return c;
}

const routes = {
  "GET /api/status": () => ({ aiConfigured: Boolean(DEEPSEEK_API_KEY), model: DEEPSEEK_MODEL, cases: CASES.length }),

  "GET /api/cases": () => CASES.map(publicSummary),

  "GET /api/books": () => BOOKS.map((b) => ({ ...b, citation: citeBook(b) })),

  "GET /api/tests": () => TESTS.map(({ normal, ...t }) => t),

  "GET /api/case": (req, url) => publicCase(getCase(url.searchParams.get("id"))),

  "POST /api/exam": async (req) => {
    const { caseId, system } = await readJson(req);
    const c = getCase(caseId);
    const finding = c.physicalExam[system];
    if (!finding) throw Object.assign(new Error("Sistema no válido"), { status: 400 });
    return { system, finding };
  },

  "POST /api/order": async (req) => {
    const { caseId, testId } = await readJson(req);
    const r = testResult(getCase(caseId), testId);
    if (!r) throw Object.assign(new Error("Estudio no válido"), { status: 400 });
    return r;
  },

  "POST /api/chat": async (req) => {
    const { caseId, messages = [] } = await readJson(req);
    const c = getCase(caseId);
    const history = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    const reply = await deepseek([{ role: "system", content: patientSystemPrompt(c) }, ...history], {
      apiKey: req.headers["x-deepseek-key"],
    });
    return { reply };
  },

  "POST /api/evaluate": async (req) => {
    const { caseId, submission = {}, orderedTests = [], questions = [] } = await readJson(req);
    const c = getCase(caseId);
    const tests = orderedTests.filter((t) => TESTS_BY_ID[t]);
    const transcript = questions.filter((q) => typeof q === "string").slice(0, 60).map((q) => q.slice(0, 300));
    let evaluation;
    try {
      const raw = await deepseek(
        [{ role: "user", content: evaluationPrompt(c, submission, tests, transcript) }],
        { apiKey: req.headers["x-deepseek-key"], json: true, temperature: 0.2, maxTokens: 900 }
      );
      evaluation = JSON.parse(raw.replace(/^```(?:json)?|```$/g, ""));
    } catch (err) {
      evaluation = offlineEvaluation(c, submission, tests, transcript);
      if (err.status !== 503) evaluation.comentario = `No se pudo usar la IA (${err.message}). ${evaluation.comentario}`;
    }
    const cost = tests.reduce((s, t) => s + TESTS_BY_ID[t].cost, 0);
    return { evaluation, cost, answer: revealCase(c) };
  },
};

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, "Prohibido", "text/plain");
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) file = path.join(PUBLIC_DIR, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) {
    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "Ruta no encontrada" });
    return serveStatic(req, res, url);
  }
  try {
    send(res, 200, await handler(req, url));
  } catch (err) {
    send(res, err.status || 500, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`SimClínica IA en http://localhost:${PORT}`);
    console.log(DEEPSEEK_API_KEY ? `DeepSeek configurado (${DEEPSEEK_MODEL}).` : "Sin DEEPSEEK_API_KEY: el paciente virtual requerirá que ingreses tu key en Ajustes.");
  });
}

module.exports = { server, CASES, TESTS, BOOKS };
