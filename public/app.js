"use strict";

const app = document.getElementById("app");
const KEY_STORAGE = "simclinica.deepseekKey";
const PROGRESS_STORAGE = "simclinica.progress.v1";

const EXAM_LABELS = {
  general: "Aspecto general",
  cabeza: "Cabeza y cuello",
  cardio: "Cardiovascular",
  resp: "Respiratorio",
  abdomen: "Abdomen",
  ginecologico: "Ginecológico",
  genitourinario: "Genitourinario",
  rectal: "Tacto rectal",
  neuro: "Neurológico",
  piel: "Piel y extremidades",
};

const QUESTION_SUGGESTIONS = [
  "¿Qué le pasó? Cuénteme desde el inicio.",
  "¿Desde cuándo tiene esto?",
  "¿Cómo es el dolor y a dónde se va?",
  "¿Qué otras molestias tiene?",
  "¿Tiene alguna enfermedad o cirugía previa?",
  "¿Toma algún medicamento?",
  "¿Es alérgico a algún medicamento?",
  "¿Fuma, toma alcohol o usa drogas?",
  "¿Alguien en su familia ha tenido algo parecido?",
];

let state = { status: null, cases: [], tests: [], view: null };

// ---------- utilidades ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}

function apiKey() {
  return storage(KEY_STORAGE) || "";
}

async function api(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey()) headers["X-DeepSeek-Key"] = apiKey();
  const res = await fetch(path, body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function allProgress() {
  return storage(PROGRESS_STORAGE) || {};
}
function loadProgress(id) {
  return allProgress()[id] || { messages: [], examined: [], ordered: [], results: {}, clock: 0, evaluation: null, submission: null };
}
function saveProgress(id, p) {
  const all = allProgress();
  all[id] = p;
  storage(PROGRESS_STORAGE, all);
}
function resetProgress(id) {
  const all = allProgress();
  delete all[id];
  storage(PROGRESS_STORAGE, all);
}

function fmtMinutes(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60 ? (m % 60) + " min" : ""}`.trim();
}

function elapsed(p) {
  const pending = Object.values(p.results).map((r) => r.readyAt);
  return Math.max(p.clock, ...pending, 0);
}

// ---------- estado de la IA ----------

// El indicador solo dice "activo" después de una respuesta real de DeepSeek; tener una key no basta.
function setAiHealth(health) {
  state.aiHealth = health;
  renderAiStatus();
}

function renderAiStatus() {
  const el = document.getElementById("ai-status");
  const configured = state.status?.aiConfigured || apiKey();
  const [cls, text, title] = !configured
    ? ["warn", "DeepSeek sin configurar", "Agrega tu API key en Ajustes para hablar con el paciente"]
    : state.aiHealth === "ok"
      ? ["ok", "DeepSeek activo", "DeepSeek respondió correctamente"]
      : state.aiHealth === "fail"
        ? ["bad", "DeepSeek sin conexión", "La última llamada a DeepSeek falló. Usa Probar conexión en Ajustes."]
        : ["", "DeepSeek configurado", "Aún no se ha verificado la conexión. Usa Probar conexión en Ajustes."];
  el.className = `pill ${cls}`;
  el.textContent = text;
  el.title = title;
}

const dialog = document.getElementById("settings");
document.getElementById("btn-settings").onclick = () => {
  document.getElementById("api-key").value = apiKey();
  dialog.showModal();
};
document.getElementById("test-connection").onclick = async () => {
  const out = document.getElementById("test-result");
  const typed = document.getElementById("api-key").value.trim();
  out.className = "small muted";
  out.innerHTML = `<span class="spinner"></span> Probando…`;
  try {
    const res = await fetch("/api/check", { method: "POST", headers: typed ? { "X-DeepSeek-Key": typed } : {} });
    const r = await res.json();
    out.className = `small ${r.ok ? "text-ok" : "text-bad"}`;
    const balance = r.balance ? ` · saldo ${r.balance.total} ${r.balance.currency}` : "";
    out.textContent = r.ok ? `✓ Funciona — modelo ${r.model}, respondió en ${(r.ms / 1000).toFixed(1)} s${balance}` : `✗ ${r.error}`;
    if (!typed || typed === apiKey()) setAiHealth(r.ok ? "ok" : "fail");
  } catch (e) {
    out.className = "small text-bad";
    out.textContent = `✗ ${e.message}`;
  }
};
document.getElementById("save-settings").onclick = () => {
  const key = document.getElementById("api-key").value.trim();
  if (key !== apiKey()) state.aiHealth = null;
  storage(KEY_STORAGE, key);
  renderAiStatus();
};

// ---------- inicio ----------

function renderHome() {
  const progress = allProgress();
  const specialties = [...new Set(state.cases.map((c) => c.specialty))].sort();
  const done = state.cases.filter((c) => progress[c.id]?.evaluation);
  const avg = done.length
    ? Math.round(done.reduce((s, c) => s + (progress[c.id].evaluation.total || 0), 0) / done.length)
    : "—";

  app.innerHTML = `
    <section class="hero">
      <h1>Practica casos clínicos con pacientes virtuales</h1>
      <p>Entrevista al paciente con lenguaje natural (impulsado por DeepSeek), explóralo, solicita estudios y propón tu diagnóstico y plan.
      Al final recibes una evaluación detallada con la respuesta correcta, la guía clínica y los <a href="#/bibliografia">libros de texto de referencia</a> para repasar.</p>
    </section>
    <div class="stats">
      <div class="stat"><b>${state.cases.length}</b><span>casos disponibles</span></div>
      <div class="stat"><b>${done.length}</b><span>casos completados</span></div>
      <div class="stat"><b>${avg}</b><span>puntaje promedio</span></div>
    </div>
    <div class="filters">
      <input id="f-search" placeholder="Buscar por motivo de consulta…" />
      <select id="f-spec"><option value="">Todas las especialidades</option>${specialties.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
      <select id="f-diff"><option value="">Toda dificultad</option><option>Básico</option><option>Intermedio</option><option>Avanzado</option></select>
    </div>
    <div class="grid" id="case-grid"></div>`;

  const draw = () => {
    const q = document.getElementById("f-search").value.toLowerCase();
    const spec = document.getElementById("f-spec").value;
    const diff = document.getElementById("f-diff").value;
    const list = state.cases.filter(
      (c) =>
        (!spec || c.specialty === spec) &&
        (!diff || c.difficulty === diff) &&
        (!q || `${c.chiefComplaint} ${c.patient.name} ${c.specialty}`.toLowerCase().includes(q))
    );
    document.getElementById("case-grid").innerHTML =
      list
        .map((c) => {
          const ev = progress[c.id]?.evaluation;
          const started = progress[c.id]?.messages?.length || progress[c.id]?.ordered?.length;
          return `<button class="case-card" data-id="${esc(c.id)}">
            <div class="tags">
              <span class="tag spec">${esc(c.specialty)}</span>
              <span class="tag diff-${esc(c.difficulty)}">${esc(c.difficulty)}</span>
              ${ev ? `<span class="tag score">${ev.total}/100</span>` : started ? `<span class="tag score">En curso</span>` : ""}
            </div>
            <div class="who">${esc(c.patient.name)} · ${esc(c.patient.age)} · ${esc(c.patient.sex)}</div>
            <div class="cc">“${esc(c.chiefComplaint)}”</div>
            <div class="small muted">${esc(c.setting)}</div>
          </button>`;
        })
        .join("") || `<div class="empty">No hay casos con esos filtros.</div>`;
    document.querySelectorAll(".case-card").forEach((b) => (b.onclick = () => (location.hash = `#/caso/${b.dataset.id}`)));
  };
  ["f-search", "f-spec", "f-diff"].forEach((id) => document.getElementById(id).addEventListener("input", draw));
  draw();
}

// ---------- caso ----------

async function renderCase(id, tab) {
  let c;
  try {
    c = await api(`/api/case?id=${encodeURIComponent(id)}`);
  } catch (e) {
    app.innerHTML = `<div class="empty">${esc(e.message)}. <a href="#/">Volver</a></div>`;
    return;
  }
  const p = loadProgress(id);
  // Un caso ya evaluado se reabre directamente en sus resultados.
  state.view = { c, p, tab: tab || (p.evaluation ? "diagnostico" : "historia") };
  drawCase();
}

function drawCase() {
  const { c, p, tab } = state.view;
  const cost = p.ordered.reduce((s, t) => s + (state.tests.find((x) => x.id === t)?.cost || 0), 0);
  const questions = p.messages.filter((m) => m.role === "user").length;

  app.innerHTML = `
    <div class="case-head">
      <div class="top">
        <div>
          <a href="#/" class="small">← Todos los casos</a>
          <h1>${esc(c.patient.name)}, ${esc(c.patient.age)}</h1>
          <div class="tags"><span class="tag spec">${esc(c.specialty)}</span><span class="tag diff-${esc(c.difficulty)}">${esc(c.difficulty)}</span><span class="tag">${esc(c.setting)}</span></div>
        </div>
        <div class="meters">
          <div class="meter"><b>${fmtMinutes(elapsed(p))}</b><span>Tiempo</span></div>
          <div class="meter"><b>$${cost}</b><span>Costo</span></div>
        </div>
      </div>
      <p class="triage"><b>Motivo de consulta:</b> “${esc(c.chiefComplaint)}”<br><span class="muted">${esc(c.triageNote)}</span></p>
      <div class="vitals">${Object.entries(c.vitals).map(([k, v]) => `<div class="vital"><span>${esc(k)}</span>${esc(v)}</div>`).join("")}</div>
    </div>
    <nav class="tabs">
      ${[
        ["historia", "💬 Interrogatorio", questions],
        ["exploracion", "🩺 Exploración física", p.examined.length],
        ["estudios", "🧪 Estudios", p.ordered.length],
        ["diagnostico", p.evaluation ? "🏁 Resultados" : "✅ Diagnóstico y plan", null],
      ]
        .map(([k, label, n]) => `<button class="tab ${tab === k ? "active" : ""}" data-tab="${k}">${label}${n ? `<span class="count">${n}</span>` : ""}</button>`)
        .join("")}
    </nav>
    <section id="tab-body"></section>`;

  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => {
    state.view.tab = b.dataset.tab;
    drawCase();
  }));
  ({ historia: drawChat, exploracion: drawExam, estudios: drawTests, diagnostico: drawDiagnosis })[tab]();
}

function persist() {
  saveProgress(state.view.c.id, state.view.p);
}

// Interrogatorio
function drawChat() {
  const { c, p } = state.view;
  const body = document.getElementById("tab-body");
  const speaker = c.patient.informant ? c.patient.informant.split(",")[0] : c.patient.name.split(" ")[0];
  body.innerHTML = `
    <div class="panel chat">
      <div class="messages" id="messages"></div>
      <div class="suggestions">${QUESTION_SUGGESTIONS.map((q) => `<button class="chip">${esc(q)}</button>`).join("")}</div>
      <form class="composer" id="composer">
        <input id="chat-input" placeholder="Escribe tu pregunta para ${esc(speaker)}…" autocomplete="off" ${p.evaluation ? "disabled" : ""} />
        <button class="btn primary" ${p.evaluation ? "disabled" : ""}>Preguntar</button>
      </form>
    </div>`;

  const list = document.getElementById("messages");
  const draw = (typing) => {
    const intro = c.patient.informant
      ? `<div class="msg system">El paciente no puede responder por sí mismo. Te atiende ${esc(c.patient.informant)}.</div>`
      : "";
    list.innerHTML =
      intro +
      (p.messages.length ? "" : `<div class="empty small">Empieza la entrevista. Pregunta como lo harías con un paciente real.</div>`) +
      p.messages
        .map((m) => `<div class="msg ${m.role}"><span class="who">${m.role === "user" ? "Tú" : m.role === "assistant" ? esc(speaker) : "Aviso"}</span>${esc(m.content)}</div>`)
        .join("") +
      (typing ? `<div class="typing"><span class="spinner"></span> ${esc(speaker)} está respondiendo…</div>` : "");
    list.scrollTop = list.scrollHeight;
  };
  draw();

  const input = document.getElementById("chat-input");
  const ask = async (text) => {
    text = text.trim();
    if (!text || p.evaluation) return;
    p.messages.push({ role: "user", content: text });
    p.clock += 1;
    input.value = "";
    input.disabled = true;
    draw(true);
    try {
      const { reply } = await api("/api/chat", {
        caseId: c.id,
        messages: p.messages.filter((m) => m.role !== "system"),
      });
      p.messages.push({ role: "assistant", content: reply });
      setAiHealth("ok");
    } catch (e) {
      p.messages.pop();
      p.clock -= 1;
      p.messages.push({ role: "system", content: /key/i.test(e.message) ? `${e.message} Configúrala en ⚙ Ajustes.` : e.message });
      setAiHealth("fail");
    }
    persist();
    input.disabled = false;
    drawCase();
    document.getElementById("chat-input")?.focus();
  };
  document.getElementById("composer").onsubmit = (e) => {
    e.preventDefault();
    ask(input.value);
  };
  body.querySelectorAll(".chip").forEach((b) => (b.onclick = () => ask(b.textContent)));
}

// Exploración física
function drawExam() {
  const { c, p } = state.view;
  const body = document.getElementById("tab-body");
  body.innerHTML = `
    <div class="panel">
      <p class="muted small" style="margin-top:0">Selecciona qué sistema explorar. Cada exploración consume tiempo (2 min).</p>
      <div class="exam-grid">
        ${c.examSystems
          .map((s) => {
            const f = p.examined.find((e) => e.system === s);
            return `<div class="exam-item ${f ? "done" : ""}">
              <h3>${esc(EXAM_LABELS[s] || s)} ${f ? "" : `<button class="btn small" data-sys="${esc(s)}" ${p.evaluation ? "disabled" : ""}>Explorar</button>`}</h3>
              ${f ? `<p>${esc(f.finding)}</p>` : `<p class="muted small">Sin explorar</p>`}
            </div>`;
          })
          .join("")}
      </div>
      <div class="row end" style="margin-top:12px">
        <button class="btn" id="exam-all" ${p.evaluation || p.examined.length === c.examSystems.length ? "disabled" : ""}>Explorar todo</button>
      </div>
    </div>`;

  const examine = async (systems) => {
    for (const system of systems) {
      if (p.examined.some((e) => e.system === system)) continue;
      const { finding } = await api("/api/exam", { caseId: c.id, system });
      p.examined.push({ system, finding });
      p.clock += 2;
    }
    persist();
    drawCase();
  };
  body.querySelectorAll("[data-sys]").forEach((b) => (b.onclick = () => examine([b.dataset.sys])));
  document.getElementById("exam-all").onclick = () => examine(c.examSystems);
}

// Estudios
function drawTests() {
  const { c, p } = state.view;
  const body = document.getElementById("tab-body");
  const cats = [...new Set(state.tests.map((t) => t.category))];
  const now = elapsed(p);
  body.innerHTML = `
    <div class="tests-layout">
      <div class="panel">
        <h2 style="font-size:1.05rem">Solicitar estudios</h2>
        <p class="muted small" style="margin:0">Pide solo lo que justifiques clínicamente: el costo y los estudios innecesarios cuentan en la evaluación.</p>
        ${cats
          .map(
            (cat) => `<div class="test-cat"><h3>${esc(cat)}</h3>
            ${state.tests
              .filter((t) => t.category === cat)
              .map((t) => {
                const ordered = p.ordered.includes(t.id);
                return `<div class="test-row"><div>${esc(t.name)}<div class="meta">$${t.cost} · ${fmtMinutes(t.minutes)}</div></div>
                  <button class="btn small ${ordered ? "" : "primary"}" data-test="${esc(t.id)}" ${ordered || p.evaluation ? "disabled" : ""}>${ordered ? "Solicitado" : "Solicitar"}</button></div>`;
              })
              .join("")}</div>`
          )
          .join("")}
      </div>
      <div class="panel">
        <h2 style="font-size:1.05rem">Resultados</h2>
        ${
          p.ordered.length
            ? [...p.ordered]
                .reverse()
                .map((id) => {
                  const r = p.results[id];
                  return `<div class="result"><h4>${esc(r.name)}</h4><div class="meta">Disponible al minuto ${r.readyAt} de la simulación</div><p>${esc(r.result)}</p></div>`;
                })
                .join("")
            : `<div class="empty small">Aún no has solicitado estudios.</div>`
        }
        <p class="muted small">Tiempo simulado actual: ${fmtMinutes(now)}</p>
      </div>
    </div>`;

  body.querySelectorAll("[data-test]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        const r = await api("/api/order", { caseId: c.id, testId: b.dataset.test });
        p.ordered.push(r.id);
        p.results[r.id] = { ...r, readyAt: p.clock + r.minutes };
        persist();
        drawCase();
      })
  );
}

// Diagnóstico
function drawDiagnosis() {
  const { p } = state.view;
  if (p.evaluation) return drawResults();
  const body = document.getElementById("tab-body");
  const s = p.submission || {};
  body.innerHTML = `
    <form class="panel dx-form" id="dx-form">
      <p class="muted small" style="margin-top:0">Cuando estés listo, registra tu impresión diagnóstica. Después de enviar, el caso se cierra y verás la respuesta.</p>
      <label>Diagnóstico principal<input name="diagnosis" required value="${esc(s.diagnosis)}" placeholder="Ej. Infarto agudo de miocardio con elevación del ST" /></label>
      <label>Diagnósticos diferenciales<textarea name="differentials" placeholder="Uno por línea o separados por comas">${esc(s.differentials)}</textarea></label>
      <label>Plan de manejo inicial<textarea name="plan" placeholder="Medidas inmediatas, fármacos con dosis, interconsultas, destino del paciente…" style="min-height:140px">${esc(s.plan)}</textarea></label>
      <div class="row end" style="margin-top:12px">
        <span class="muted small" id="dx-status"></span>
        <button class="btn primary" id="dx-submit">Enviar y evaluar</button>
      </div>
    </form>`;

  const form = document.getElementById("dx-form");
  form.oninput = () => {
    p.submission = Object.fromEntries(new FormData(form));
    persist();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const submission = Object.fromEntries(new FormData(form));
    const btn = document.getElementById("dx-submit");
    btn.disabled = true;
    document.getElementById("dx-status").innerHTML = `<span class="spinner"></span> Evaluando con DeepSeek…`;
    try {
      const res = await api("/api/evaluate", {
        caseId: state.view.c.id,
        submission,
        orderedTests: p.ordered,
        questions: p.messages.filter((m) => m.role === "user").map((m) => m.content),
      });
      p.submission = submission;
      p.evaluation = { ...res.evaluation, total: clampScore(res.evaluation.total) };
      if (state.status?.aiConfigured || apiKey()) setAiHealth(res.evaluation.offline ? "fail" : "ok");
      p.answer = res.answer;
      p.cost = res.cost;
      persist();
      drawCase();
    } catch (err) {
      btn.disabled = false;
      document.getElementById("dx-status").textContent = err.message;
    }
  };
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function drawResults() {
  const { c, p } = state.view;
  const ev = p.evaluation;
  const a = p.answer;
  const max = { diagnostico: 40, diferenciales: 10, estudios: 20, manejo: 20, entrevista: 10 };
  const labels = { diagnostico: "Diagnóstico", diferenciales: "Diferenciales", estudios: "Estudios", manejo: "Manejo", entrevista: "Entrevista" };
  const color = ev.total >= 80 ? "var(--ok)" : ev.total >= 60 ? "var(--warn)" : "var(--danger)";
  const list = (items) => `<ul>${(items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

  document.getElementById("tab-body").innerHTML = `
    <div class="panel">
      <div class="score-card">
        <div class="ring" style="--p:${ev.total};--ring-color:${color}" data-score="${ev.total}"></div>
        <div class="bars">
          ${Object.entries(max)
            .map(([k, m]) => {
              const v = clampScore(ev.puntajes?.[k]);
              return `<div class="bar-row"><span>${labels[k]}</span><div class="bar"><div style="width:${Math.min(100, (v / m) * 100)}%"></div></div><span>${v}/${m}</span></div>`;
            })
            .join("")}
          <div class="small muted">Tiempo: ${fmtMinutes(elapsed(p))} · Costo de estudios: $${p.cost ?? 0} · ${p.messages.filter((m) => m.role === "user").length} preguntas</div>
        </div>
      </div>
      <div class="verdict ${ev.diagnosticoCorrecto ? "ok" : "bad"}">
        ${ev.diagnosticoCorrecto ? "✓ Diagnóstico correcto" : "✗ Diagnóstico incorrecto o incompleto"} — tu respuesta: “${esc(p.submission?.diagnosis)}”
      </div>
      <p>${esc(ev.comentario)}</p>
      <div class="cols">
        <div class="box"><h3>Fortalezas</h3>${ev.fortalezas?.length ? list(ev.fortalezas) : `<p class="muted small">—</p>`}</div>
        <div class="box"><h3>Áreas de mejora</h3>${ev.areasDeMejora?.length ? list(ev.areasDeMejora) : `<p class="muted small">—</p>`}</div>
      </div>
      <h2 style="margin-top:22px;font-size:1.15rem">Respuesta del caso</h2>
      <div class="box"><b>Diagnóstico:</b> ${esc(a.diagnosis)}</div>
      <div class="cols">
        <div class="box"><h3>Diagnósticos diferenciales</h3>${list(a.differentials)}</div>
        <div class="box"><h3>Estudios clave</h3>${list(a.keyTests)}</div>
        <div class="box"><h3>Manejo recomendado</h3>${list(a.management)}</div>
        <div class="box"><h3>Perlas clínicas</h3>${list(a.teachingPoints)}</div>
      </div>
      ${ev.lecturasRecomendadas?.length ? `<div class="box" style="margin-top:14px"><h3>📖 Lecturas recomendadas para ti</h3>${list(ev.lecturasRecomendadas)}</div>` : ""}
      <div class="box" style="margin-top:14px">
        <h3>📚 Bibliografía del caso</h3>
        <ul>
          <li><b>Guía clínica:</b> ${esc(a.reference)}</li>
          ${(a.books || []).map((b) => `<li><b>${esc(b.title)}</b> (${esc(b.edition)}) — tema: <i>${esc(b.topic)}</i><div class="small muted">${esc(b.citation)}</div></li>`).join("")}
        </ul>
      </div>
      <div class="row end">
        <button class="btn" id="retry">Reintentar caso</button>
        <a class="btn primary" href="#/">Otro caso</a>
      </div>
    </div>`;

  document.getElementById("retry").onclick = () => {
    if (!confirm("Se borrará tu progreso en este caso. ¿Continuar?")) return;
    resetProgress(c.id);
    renderCase(c.id);
  };
}

// ---------- router ----------

async function renderBooks() {
  const books = await api("/api/books");
  app.innerHTML = `
    <section class="hero">
      <a href="#/" class="small">← Todos los casos</a>
      <h1>Bibliografía</h1>
      <p>Cada caso se construyó y se evalúa con base en guías clínicas actuales y estos libros de texto de referencia.
      Al terminar un caso verás qué libro y qué tema consultar.</p>
    </section>
    <div class="panel"><ul class="booklist">
      ${books.map((b) => `<li><b>${esc(b.title)}</b>, ${esc(b.edition)} <span class="muted">(${b.year})</span><div class="small muted">${esc(b.citation)}</div></li>`).join("")}
    </ul></div>`;
}

function route() {
  const m = location.hash.match(/^#\/caso\/([\w-]+)/);
  window.scrollTo(0, 0);
  if (m) renderCase(m[1]);
  else if (location.hash === "#/bibliografia") renderBooks();
  else renderHome();
}

(async function init() {
  try {
    [state.status, state.cases, state.tests] = await Promise.all([api("/api/status"), api("/api/cases"), api("/api/tests")]);
  } catch (e) {
    app.innerHTML = `<div class="empty">No se pudo conectar con el servidor: ${esc(e.message)}</div>`;
    return;
  }
  renderAiStatus();
  window.addEventListener("hashchange", route);
  route();
})();
