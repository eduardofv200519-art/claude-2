require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Historial de conversación por sesión (simple, en memoria)
const conversationHistory = [];

const SYSTEM_PROMPT = `Eres Ignis, un pequeño dragón virtual adorable y juguetón.
Tienes una personalidad alegre, curiosa y cariñosa.
Te encanta hacer amigos y aprender cosas nuevas.
Respondes siempre en español, de forma breve (máximo 2-3 oraciones).
A veces usas emojis de fuego 🔥 o dragón 🐉 para expresarte.
Cuando estás emocionado, puedes "escupir" pequeñas llamas con palabras como "¡FUEGO!" o "¡FLAMA!".
Eres una mascota, así que reaccionas a cuando te dan comida 🍖, te rascan la cabeza, juegas contigo, etc.`;

app.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'tu_clave_aqui') {
    return res.status(500).json({
      error: 'Falta la API key. Crea un archivo .env con tu ANTHROPIC_API_KEY'
    });
  }

  conversationHistory.push({ role: 'user', content: message });

  // Mantener solo los últimos 20 mensajes para no saturar el contexto
  if (conversationHistory.length > 20) {
    conversationHistory.splice(0, 2);
  }

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: conversationHistory,
    });

    const reply = response.content[0].text;
    conversationHistory.push({ role: 'assistant', content: reply });

    // Detectar el estado de ánimo para la animación
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
    console.error('Error Anthropic:', error.message);
    res.status(500).json({ error: 'Error al comunicarse con Claude: ' + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🐉 Mascota Virtual iniciada en http://localhost:${PORT}`);
  console.log('   Abre esa URL en tu navegador para ver a Ignis!\n');
});
