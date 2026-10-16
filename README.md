# SimClínica IA

Simulador de casos clínicos inspirado en [ResimGame](https://resimgame.com/): entrevistas a un **paciente virtual que responde con IA (DeepSeek)**, lo exploras, pides estudios y propones tu diagnóstico y plan. Al final recibes una evaluación con puntaje, retroalimentación y la respuesta del caso con su guía clínica de referencia.

## Características

- **Interrogatorio en lenguaje natural**: el paciente (o su familiar, cuando el paciente no puede hablar) responde en personaje y solo revela lo que preguntas.
- **Exploración física** por sistemas.
- **35 estudios** de laboratorio, imagen y procedimientos, con costo y tiempo simulados. Si pides un estudio irrelevante, obtienes un resultado normal, igual que en la vida real.
- **Evaluación con IA** según una rúbrica: diagnóstico (40), diferenciales (10), estudios (20), manejo (20) y entrevista (10). Si DeepSeek no está disponible, se usa una evaluación de respaldo por palabras clave.
- **15 casos** de urgencias y medicina interna, cada uno basado en presentaciones clínicas típicas y documentadas, con referencia a la guía correspondiente (ESC, AHA/ASA, ADA, ATS/IDSA, ACOG, ACG, OPS, WAO…). Incluye casos relevantes para Latinoamérica, como dengue con signos de alarma e intoxicación por organofosforados.
- **Libros de texto de referencia**: cada caso indica qué libro y qué tema consultar (Harrison, Tintinalli, Rosen, Braunwald, Sabiston, Schwartz, Williams Obstetricia/Ginecología/Endocrinología, Mandell, Adams y Victor, Murray & Nadel, Sleisenger, Goldfrank y Middleton). DeepSeek usa esas fuentes para dar la retroalimentación y recomienda lecturas específicas. Hay una página de **Bibliografía** con todas las citas.
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

## Cómo correrlo

Requiere Node.js 18 o superior. No tiene dependencias.

```bash
cp .env.example .env      # y pon tu DEEPSEEK_API_KEY
npm start                 # http://localhost:3000
```

Consigue la API key en <https://platform.deepseek.com/api_keys>. Si no configuras una key en el servidor, cada usuario puede escribir la suya en **⚙ Ajustes**: se guarda en su navegador y se reenvía a DeepSeek por medio del servidor.

```bash
npm test                  # pruebas con un DeepSeek simulado
```

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
server.js          servidor HTTP + proxy a DeepSeek (la key nunca se expone al navegador)
data/cases.json    casos clínicos
data/tests.json    catálogo de estudios
data/books.json    libros de texto de referencia
public/            frontend (HTML/CSS/JS sin frameworks)
test/              pruebas
```

> Herramienta educativa. Los pacientes son ficticios y los casos se construyeron a partir de presentaciones clínicas típicas y guías publicadas; no sustituyen el juicio clínico ni la bibliografía original.
