# SimClínica IA

Simulador de casos clínicos inspirado en [ResimGame](https://resimgame.com/): entrevistas a un **paciente virtual que responde con IA (DeepSeek, Gemini, Groq, OpenRouter, Cerebras o Mistral)**, lo exploras, pides estudios y propones tu diagnóstico y plan. Al final recibes una evaluación con puntaje, retroalimentación y la respuesta del caso con su guía clínica de referencia.

## Características

- **Interrogatorio en lenguaje natural**: el paciente (o su familiar, cuando el paciente no puede hablar) responde en personaje y solo revela lo que preguntas.
- **Exploración física** por sistemas.
- **35 estudios** de laboratorio, imagen y procedimientos, con costo y tiempo simulados. Si pides un estudio irrelevante, obtienes un resultado normal, igual que en la vida real.
- **Evaluación con IA** según una rúbrica: diagnóstico (40), diferenciales (10), estudios (20), manejo (20) y entrevista (10). Si la IA no está disponible, se usa una evaluación de respaldo por palabras clave.
- **15 casos** de urgencias y medicina interna, cada uno basado en presentaciones clínicas típicas y documentadas, con referencia a la guía correspondiente (ESC, AHA/ASA, ADA, ATS/IDSA, ACOG, ACG, OPS, WAO…). Incluye casos relevantes para Latinoamérica, como dengue con signos de alarma e intoxicación por organofosforados.
- **Libros de texto de referencia**: cada caso indica qué libro y qué tema consultar (Harrison, Tintinalli, Rosen, Braunwald, Sabiston, Schwartz, Williams Obstetricia/Ginecología/Endocrinología, Mandell, Adams y Victor, Murray & Nadel, Sleisenger, Goldfrank y Middleton). La IA usa esas fuentes para dar la retroalimentación y recomienda lecturas específicas. Hay una página de **Bibliografía** con todas las citas.
- El progreso se guarda en el navegador (localStorage).

| Caso | Especialidad |
|---|---|
| IAMCEST inferior con extensión a VD | Cardiología |
| Tromboembolia pulmonar postoperatoria | Neumología |
| Cetoacidosis diabética | Endocrinología |
| Apendicitis aguda | Cirugía |
| Meningitis bacteriana neumocócica | Infectología |
| Embarazo ectópico roto | Ginecología |
| Neumonía adquirida en la comunidad grave | Medicina interna |
| Disección aórtica tipo A | Cardiología |
| EVC isquémico (oclusión de M1) | Neurología |
| Insuficiencia cardiaca aguda descompensada | Cardiología |
| Pancreatitis aguda biliar | Gastroenterología |
| Dengue con signos de alarma | Infectología |
| Intoxicación por organofosforados | Toxicología |
| Hemorragia de tubo digestivo alto por úlcera | Gastroenterología |
| Anafilaxia | Urgencias |

## Usar en Windows sin instalar nada (.exe)

1. Descarga `SimClinica-IA.exe` y haz doble clic. Se abre una ventana negra (el servidor) y la app en tu navegador, en http://localhost:3000.
2. Windows puede mostrar **"Windows protegió tu PC"** porque el ejecutable no está firmado: elige **Más información → Ejecutar de todas formas**.
3. En la app, sigue la guía **"Activa la IA gratis"**: saca una key de Gemini y pégala en ⚙ Ajustes.
4. Para cerrar la app, cierra la ventana negra.

Opcional: pon un archivo `.env` junto al `.exe` (mismo formato que `.env.example`) para dejar la key configurada.

Para generar el ejecutable (desde cualquier sistema, con Node 22):

```bash
npm run build:exe                     # dist/SimClinica-IA.exe (Windows x64)
node scripts/build-exe.js linux-x64   # dist/SimClinica-IA-linux
```

Descarga el Node.js oficial de la misma versión (verificado con SHA-256), quita su firma digital (se invalidaría al inyectar la app) e inyecta la app con [Node SEA](https://nodejs.org/api/single-executable-applications.html).

## Cómo correrlo

Requiere Node.js 18 o superior. No tiene dependencias.

```bash
cp .env.example .env      # elige AI_PROVIDER y pon tu AI_API_KEY
npm start                 # http://localhost:3000 (solo esta computadora; HOST=0.0.0.0 para compartir en la red)
npm run check             # prueba real: modelos, paciente virtual y evaluación
npm test                  # pruebas automáticas (con una IA simulada)
```

También puedes elegir proveedor y key desde **⚙ Ajustes** en la app (se guardan en tu navegador) y usar **Probar conexión**.

### Proveedores de IA

Todos usan el formato compatible con OpenAI. La app detecta sola el modelo de chat adecuado con `GET /models`, descarta los modelos de audio, imagen o embeddings y, si un modelo se retira, lo vuelve a detectar. Si el proveedor no soporta el modo JSON, la evaluación se reintenta sin él.

| `AI_PROVIDER` | ¿Gratis? | Dónde sacar la key | Notas |
|---|---|---|---|
| `gemini` | Sí, modelos Flash | aistudio.google.com/apikey | Recomendado para empezar gratis. En el plan gratuito Google puede usar tus prompts para mejorar sus productos. |
| `groq` | Sí | console.groq.com/keys | Muy rápido. Límite diario de tokens (≈100-200 mil según modelo). |
| `openrouter` | Sí, modelos `:free` | openrouter.ai/keys | ≈50 solicitudes/día gratis (1,000 si compras 10 USD de créditos). La app prefiere los `:free`. |
| `cerebras` | Verificar | cloud.cerebras.ai | Las fuentes no coinciden sobre si hoy hay plan gratuito permanente. |
| `mistral` | Sí, plan "Experiment" | console.mistral.ai/api-keys | Límites visibles solo en su consola. |
| `deepseek` | No (muy barato) | platform.deepseek.com/api_keys | "Probar conexión" muestra el saldo. |

Los planes gratuitos cambian seguido: revisa los límites en la consola de cada proveedor.

## Agregar casos

Los casos están en `data/cases.json` y el catálogo de estudios en `data/tests.json`. Cada caso tiene:

- `history`: la historia oculta que el paciente virtual revela al ser interrogado.
- `persona`: cómo habla el paciente.
- `physicalExam`: hallazgos por sistema.
- `labs`: resultados específicos por estudio. Los estudios que no aparecen aquí devuelven el valor `normal` del catálogo.
- `diagnosis`, `acceptedDiagnoses`, `differentials`, `keyTests`, `management`, `teachingPoints` y `reference` (guía clínica): se usan para evaluar y para mostrar la respuesta.
- `books`: libros de texto (`id` de `data/books.json`) y el tema que hay que consultar.

`npm test` valida que todos los estudios y libros referenciados existan en sus catálogos.

## Estructura

```
server.js          servidor HTTP + proxy al proveedor de IA (la key nunca se expone al navegador)
data/cases.json    casos clínicos
data/tests.json    catálogo de estudios
data/books.json    libros de texto de referencia
public/            frontend (HTML/CSS/JS sin frameworks)
scripts/check-ai.js  prueba real contra el proveedor de IA (npm run check)
scripts/build-exe.js genera el ejecutable para Windows o Linux
test/              pruebas
```

> Herramienta educativa. Los pacientes son ficticios y los casos se construyeron a partir de presentaciones clínicas típicas y guías publicadas; no sustituyen el juicio clínico ni la bibliografía original.
