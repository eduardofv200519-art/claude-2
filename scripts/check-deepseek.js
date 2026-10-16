// Verifica contra la API real de DeepSeek que el paciente virtual y la evaluación funcionan.
// Uso: npm run check   (lee DEEPSEEK_API_KEY de .env o del entorno)

const { CASES, deepseek, modelFor, listModels, parseJsonReply, patientSystemPrompt, evaluationPrompt } = require("../server.js");

const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};

(async () => {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    fail("No hay DEEPSEEK_API_KEY. Copia .env.example a .env y pon tu key.");
    return;
  }
  const c = CASES.find((x) => x.id === "iam-inferior");

  console.log("1. Modelos disponibles");
  try {
    const ids = await listModels(key);
    ok(ids.join(", "));
    ok(`Modelo que usará la app: ${await modelFor(key)}`);
  } catch (e) {
    return fail(e.message);
  }

  console.log("2. Paciente virtual");
  try {
    const history = [{ role: "user", content: "Buenas tardes, ¿qué le trae por aquí?" }];
    const reply = await deepseek([{ role: "system", content: patientSystemPrompt(c) }, ...history], { apiKey: key });
    if (!reply) return fail("Respuesta vacía.");
    ok(`Doctor: ${history[0].content}`);
    ok(`Paciente: ${reply}`);
    if (/infarto|IAM|elevación del ST/i.test(reply)) fail("El paciente reveló el diagnóstico (revisa el prompt).");
  } catch (e) {
    return fail(e.message);
  }

  console.log("3. Evaluación (JSON)");
  try {
    const raw = await deepseek(
      [{ role: "user", content: evaluationPrompt(c, { diagnosis: "IAMCEST inferior", differentials: "disección aórtica, TEP", plan: "AAS 300 mg, ticagrelor, angioplastia primaria" }, ["ecg", "trop"], ["¿Desde cuándo le duele?", "¿Fuma?"]) }],
      { apiKey: key, json: true, temperature: 0.2, maxTokens: 900 }
    );
    const ev = parseJsonReply(raw);
    if (typeof ev.total !== "number" || !ev.puntajes) return fail(`JSON con forma inesperada: ${raw.slice(0, 300)}`);
    ok(`Puntaje: ${ev.total}/100, diagnóstico correcto: ${ev.diagnosticoCorrecto}`);
    ok(`Comentario: ${ev.comentario}`);
    if (ev.lecturasRecomendadas?.length) ok(`Lecturas: ${ev.lecturasRecomendadas.join(" | ")}`);
  } catch (e) {
    return fail(e.message);
  }

  if (!process.exitCode) console.log("\nTodo funciona con DeepSeek ✔");
})();
