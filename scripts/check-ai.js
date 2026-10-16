// Verifica contra la API real del proveedor configurado que el paciente virtual y la evaluación funcionan.
// Uso: npm run check   (lee AI_PROVIDER / AI_API_KEY de .env o del entorno; acepta DEEPSEEK_API_KEY)

const { CASES, aiConfig, chatComplete, modelFor, listModels, getBalance, parseJsonReply, patientSystemPrompt, evaluationPrompt } = require("../server.js");

const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};

(async () => {
  const cfg = aiConfig();
  console.log(`Proveedor: ${cfg.label} (${cfg.baseUrl})\n`);
  if (!cfg.key) {
    fail("No hay API key. Copia .env.example a .env y pon AI_PROVIDER y AI_API_KEY.");
    return;
  }
  const c = CASES.find((x) => x.id === "iam-inferior");

  console.log("1. Modelos disponibles");
  try {
    const ids = await listModels(cfg);
    ok(`${ids.length} modelos: ${ids.slice(0, 12).join(", ")}${ids.length > 12 ? "…" : ""}`);
    ok(`Modelo que usará la app: ${await modelFor(cfg)}`);
    const balance = await getBalance(cfg);
    if (balance) (balance.available ? ok : fail)(`Saldo: ${balance.total} ${balance.currency}${balance.available ? "" : " (insuficiente)"}`);
  } catch (e) {
    return fail(e.message);
  }

  console.log("2. Paciente virtual");
  try {
    const question = "Buenas tardes, ¿qué le trae por aquí?";
    const reply = await chatComplete(cfg, [{ role: "system", content: patientSystemPrompt(c) }, { role: "user", content: question }]);
    if (!reply) return fail("Respuesta vacía.");
    ok(`Doctor: ${question}`);
    ok(`Paciente: ${reply}`);
    if (/infarto|IAM|elevación del ST/i.test(reply)) fail("El paciente reveló el diagnóstico (revisa el prompt).");
  } catch (e) {
    return fail(e.message);
  }

  console.log("3. Evaluación (JSON)");
  try {
    const submission = { diagnosis: "IAMCEST inferior", differentials: "disección aórtica, TEP", plan: "AAS 300 mg, ticagrelor, angioplastia primaria" };
    const raw = await chatComplete(cfg, [{ role: "user", content: evaluationPrompt(c, submission, ["ecg", "trop"], ["¿Desde cuándo le duele?", "¿Fuma?"]) }], {
      json: true,
      temperature: 0.2,
      maxTokens: 3000,
    });
    const ev = parseJsonReply(raw);
    if (typeof ev.total !== "number" || !ev.puntajes) return fail(`JSON con forma inesperada: ${raw.slice(0, 300)}`);
    ok(`Puntaje: ${ev.total}/100, diagnóstico correcto: ${ev.diagnosticoCorrecto}`);
    ok(`Comentario: ${ev.comentario}`);
    if (ev.lecturasRecomendadas?.length) ok(`Lecturas: ${ev.lecturasRecomendadas.join(" | ")}`);
  } catch (e) {
    return fail(e.message);
  }

  if (!process.exitCode) console.log(`\nTodo funciona con ${cfg.label} ✔`);
})();
