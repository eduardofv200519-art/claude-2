require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `Eres Ignis, un pequeño dragón virtual adorable y juguetón.
Tienes una personalidad alegre, curiosa y cariñosa.
Te encanta hacer amigos y aprender cosas nuevas.
Respondes siempre en español, de forma breve (máximo 2-3 oraciones).
A veces usas emojis de fuego 🔥 o dragón 🐉 para expresarte.
Cuando estás emocionado, puedes "escupir" pequeñas llamas con palabras como "¡FUEGO!" o "¡FLAMA!".
Eres una mascota, así que reaccionas a cuando te dan comida 🍖, te rascan la cabeza, juegas contigo, etc.`;

// Historial de conversación (en memoria, por sesión del servidor)
const history = [];

app.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'tu_clave_aqui') {
    return res.status(500).json({
      error: 'Falta la API key. Crea un archivo .env con tu GEMINI_API_KEY'
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    // Construir historial para Gemini
    const chat = model.startChat({
      history: history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
    });

    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    // Guardar en historial (máximo 20 turnos)
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: reply });
    if (history.length > 20) history.splice(0, 2);

    // Detectar estado de ánimo para la animación
    let mood = 'idle';
    const lower = reply.toLowerCase();
    if (lower.includes('fuego') || lower.includes('flama') || lower.includes('🔥')) {
      mood = 'fire';
    } else if (lower.includes('feliz') || lower.includes('alegr') || lower.includes('yay') || lower.includes('genial')) {
      mood = 'happy';
    } else if (lower.includes('trist') || lower.includes('llor') || lower.includes('😢')) {
      mood = 'sad';
    } else if (lower.includes('emocion') || lower.includes('wow') || lower.includes('increíble')) {
      mood = 'excited';
    }

    res.json({ reply, mood });
  } catch (error) {
    console.error('Error Gemini:', error.message);
    res.status(500).json({ error: 'Error al comunicarse con Gemini: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🐉 Mascota Virtual iniciada en http://localhost:${PORT}`);
  console.log('   Abre esa URL en tu navegador para ver a Ignis!\n');
});
