require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const respuestas = [
  { palabras: ['hola', 'hey', 'buenas', 'hi', 'saludos'],
    respuesta: '¡Hola! 🐉 ¡Me alegra verte! ¿Quieres jugar conmigo?',
    mood: 'happy' },
  { palabras: ['comida', 'comer', 'hambre', 'carne', 'pollo', 'hueso'],
    respuesta: '¡FUEGO! 🔥🍖 ¡Comida! ¡Comida! ¡Esto está delicioso!',
    mood: 'fire' },
  { palabras: ['jugar', 'juego', 'pelota', 'correr'],
    respuesta: '¡Sí sí sí! ¡Me encanta jugar! 🐉 ¡FLAMA de emoción!',
    mood: 'excited' },
  { palabras: ['rascar', 'rasca', 'cabeza', 'mimo', 'caricia', 'acariciar'],
    respuesta: 'Mmmm... 😊 ¡Eso se siente muy bien! Sigo queriendo más...',
    mood: 'happy' },
  { palabras: ['fuego', 'llama', 'flama', 'escupe'],
    respuesta: '¡FUEGO! 🔥🔥 ¡Mira qué llamas tan bonitas puedo hacer!',
    mood: 'fire' },
  { palabras: ['triste', 'llorar', 'mal', 'solo', 'soledad'],
    respuesta: 'Aww... 😢 No estés triste, yo estoy aquí contigo siempre.',
    mood: 'sad' },
  { palabras: ['dormir', 'cansado', 'sueño', 'noche'],
    respuesta: 'Yo también tengo un poco de sueño... 🐉 Pero no me dormiré si me haces compañía.',
    mood: 'idle' },
  { palabras: ['bonito', 'lindo', 'guapo', 'hermoso', 'cute'],
    respuesta: '¡Gracias! 🐉🔥 ¡Tú también eres muy especial para mí!',
    mood: 'happy' },
  { palabras: ['adios', 'chao', 'bye', 'hasta', 'luego'],
    respuesta: 'No te vayas... 😢 Pero si debes irte, ¡hasta pronto! Te voy a extrañar.',
    mood: 'sad' },
  { palabras: ['nombre', 'llamas', 'quien', 'eres'],
    respuesta: '¡Me llamo Ignis! 🐉 Soy un dragoncito muy feliz de conocerte.',
    mood: 'happy' },
  { palabras: ['wow', 'increíble', 'genial', 'asombroso', 'cool'],
    respuesta: '¡Sí! ¡FUEGO! 🔥 ¡Eso es lo más emocionante que he escuchado hoy!',
    mood: 'excited' },
  { palabras: ['agua', 'bañar', 'mojado'],
    respuesta: '¡Nooo! 😢 ¡El agua apaga mis llamas! ¡Por favoooor!',
    mood: 'sad' },
];

const respuestasPorDefecto = [
  { respuesta: 'Grrr... 🐉 No entiendo muy bien, pero igualmente me alegra que hables conmigo.', mood: 'idle' },
  { respuesta: '¡Boing! 🔥 Eso que dijiste suena interesante... cuéntame más.', mood: 'happy' },
  { respuesta: 'Hmm... 🐉 Estoy pensando en eso con mucho fuego en mi cabeza.', mood: 'idle' },
  { respuesta: '¡Ooooh! No sé qué decir, pero me gustó escucharte. 🐉', mood: 'happy' },
];

function obtenerRespuesta(mensaje) {
  const lower = mensaje.toLowerCase();
  for (const entrada of respuestas) {
    if (entrada.palabras.some(p => lower.includes(p))) {
      return { reply: entrada.respuesta, mood: entrada.mood };
    }
  }
  const aleatoria = respuestasPorDefecto[Math.floor(Math.random() * respuestasPorDefecto.length)];
  return { reply: aleatoria.respuesta, mood: aleatoria.mood };
}

app.post('/chat', (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }
  const resultado = obtenerRespuesta(message);
  res.json(resultado);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🐉 Mascota Virtual iniciada en http://localhost:${PORT}`);
  console.log('   Abre esa URL en tu navegador para ver a Ignis!\n');
});
