const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");

// DeepSeek simulado con el comportamiento posterior a V4: "deepseek-chat" ya no existe,
// GET /models lista los modelos vigentes y la evaluación llega envuelta en ```json.
const AVAILABLE = ["deepseek-v4-pro", "deepseek-flash"];
let lastRequest;
const chatModels = [];
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization === "Bearer sin-saldo") return reply(402, { error: { message: "Insufficient Balance" } });
    if (req.url === "/models") return reply(200, { object: "list", data: AVAILABLE.map((id) => ({ id, object: "model" })) });
    lastRequest = { headers: req.headers, body: JSON.parse(raw) };
    chatModels.push(lastRequest.body.model);
    if (!AVAILABLE.includes(lastRequest.body.model)) return reply(400, { error: { message: "Model Not Exist" } });
    const content = lastRequest.body.response_format
      ? "```json\n" + JSON.stringify({ diagnosticoCorrecto: true, puntajes: { diagnostico: 40, diferenciales: 8, estudios: 18, manejo: 15, entrevista: 7 }, total: 88, fortalezas: ["a"], areasDeMejora: ["b"], comentario: "ok" }) + "\n```"
      : "Me duele mucho el pecho, doctor.";
    reply(200, { choices: [{ message: { content } }] });
  });
});

let base, app;
before(async () => {
  await new Promise((r) => mock.listen(0, r));
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  process.env.DEEPSEEK_API_KEY = "test-key";
  app = require("../server.js").server;
  await new Promise((r) => app.listen(0, r));
  base = `http://127.0.0.1:${app.address().port}`;
});
after(() => {
  app.close();
  mock.close();
});

const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("los datos de los casos son consistentes", () => {
  const { CASES, TESTS, BOOKS } = require("../server.js");
  const bookIds = new Set(BOOKS.map((b) => b.id));
  const testIds = new Set(TESTS.map((t) => t.id));
  const ids = new Set();
  for (const c of CASES) {
    assert.ok(!ids.has(c.id), `id duplicado ${c.id}`);
    ids.add(c.id);
    for (const k of ["diagnosis", "chiefComplaint", "persona", "reference"]) assert.ok(c[k], `${c.id} sin ${k}`);
    assert.ok(c.acceptedDiagnoses.length && c.management.length && c.teachingPoints.length, c.id);
    for (const t of c.keyTests) assert.ok(testIds.has(t), `${c.id}: estudio clave desconocido ${t}`);
    for (const t of Object.keys(c.labs)) assert.ok(testIds.has(t), `${c.id}: resultado de estudio desconocido ${t}`);
    for (const t of c.keyTests) assert.ok(c.labs[t], `${c.id}: estudio clave ${t} sin resultado específico`);
    assert.ok(c.books?.length, `${c.id}: sin libros de referencia`);
    for (const b of c.books) assert.ok(bookIds.has(b.id) && b.topic, `${c.id}: libro desconocido ${b.id}`);
  }
});

test("la lista de casos no revela el diagnóstico", async () => {
  const text = await (await fetch(base + "/api/cases")).text();
  assert.ok(!text.includes("diagnosis") && !text.includes("history"));
  const one = await (await fetch(base + "/api/case?id=iam-inferior")).json();
  assert.equal(one.diagnosis, undefined);
  assert.ok(one.examSystems.includes("cardio"));
});

test("estudios: resultado específico del caso o normal por defecto", async () => {
  const ecg = await (await post("/api/order", { caseId: "iam-inferior", testId: "ecg" })).json();
  assert.match(ecg.result, /Elevación del ST/);
  const tsh = await (await post("/api/order", { caseId: "iam-inferior", testId: "tsh" })).json();
  assert.match(tsh.result, /Eutiroideo/);
  assert.equal((await post("/api/order", { caseId: "iam-inferior", testId: "nope" })).status, 400);
});

test("chat usa DeepSeek con la historia oculta en el prompt de sistema", async () => {
  const r = await (await post("/api/chat", { caseId: "iam-inferior", messages: [{ role: "user", content: "¿Qué le pasa?" }] })).json();
  assert.equal(r.reply, "Me duele mucho el pecho, doctor.");
  assert.equal(lastRequest.headers.authorization, "Bearer test-key");
  assert.equal(lastRequest.body.messages[0].role, "system");
  assert.match(lastRequest.body.messages[0].content, /Roberto Salinas/);
});

test("evaluación devuelve puntaje y revela la respuesta", async () => {
  const r = await (await post("/api/evaluate", { caseId: "iam-inferior", submission: { diagnosis: "IAMCEST inferior" }, orderedTests: ["ecg", "trop"] })).json();
  assert.equal(r.evaluation.total, 88);
  assert.equal(r.cost, 40);
  assert.match(r.answer.diagnosis, /elevación del ST/);
  assert.ok(r.answer.books.some((b) => b.id === "braunwald" && b.citation.includes("Libby")));
  assert.match(lastRequest.body.messages[0].content, /Braunwald/);
});

test("detecta el modelo vigente y reintenta si el guardado fue retirado", async () => {
  const { modelCache } = require("../server.js");
  modelCache.set("test-key", "deepseek-chat"); // nombre retirado
  chatModels.length = 0;
  const r = await (await post("/api/chat", { caseId: "iam-inferior", messages: [{ role: "user", content: "hola" }] })).json();
  assert.equal(r.reply, "Me duele mucho el pecho, doctor.");
  assert.deepEqual(chatModels, ["deepseek-chat", "deepseek-flash"]);
  const check = await (await post("/api/check", {})).json();
  assert.equal(check.ok, true);
  assert.equal(check.model, "deepseek-flash");
});

test("errores de DeepSeek llegan con mensaje claro", async () => {
  const res = await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "sin-saldo" },
    body: JSON.stringify({ caseId: "iam-inferior", messages: [{ role: "user", content: "hola" }] }),
  });
  assert.equal(res.status, 402);
  assert.match((await res.json()).error, /saldo/);
});

test("evaluación sin IA usa el respaldo por palabras clave", async () => {
  const saved = process.env.DEEPSEEK_BASE_URL;
  mock.close();
  const r = await (await post("/api/evaluate", { caseId: "anafilaxia", submission: { diagnosis: "Choque anafiláctico", plan: "adrenalina intramuscular" }, orderedTests: [] })).json();
  assert.equal(r.evaluation.offline, true);
  assert.equal(r.evaluation.diagnosticoCorrecto, true);
  assert.ok(Number.isFinite(r.evaluation.total));
  process.env.DEEPSEEK_BASE_URL = saved;
});
