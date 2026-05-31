// In-memory rate limit store: IP -> { count, resetAt }
const rateLimitStore = new Map();
const RATE_LIMIT = 15; // quiz needs ~6 calls (5 batches + 1 final), allow generous headroom for retries
const RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minute window

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean);

const GEMINI_KEY = process.env.GEMINI_API_KEY;

async function callGroq(key, messages, model) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.7 })
  });

  if (response.status === 429 || response.status >= 500) {
    throw new Error(`RATE_LIMITED:${response.status}`);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HARD_FAIL:${err}`);
  }

  return response.json();
}

async function callGemini(messages) {
  const systemMsg = messages.find(m => m.role === 'system');
  const convo = messages.filter(m => m.role !== 'system');

  const geminiMessages = convo.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  if (systemMsg) {
    geminiMessages.unshift({
      role: 'user',
      parts: [{ text: `[Instructions]: ${systemMsg.content}` }]
    });
    geminiMessages.splice(1, 0, {
      role: 'model',
      parts: [{ text: 'Understood. I will follow these instructions.' }]
    });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: geminiMessages })
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GEMINI_FAIL:${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('GEMINI_EMPTY_RESPONSE');

  return {
    choices: [{ message: { content: text } }]
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }

  const { messages, modelOverride } = req.body;
  const groqModel = modelOverride === 'large'
    ? 'llama-3.3-70b-versatile'
    : 'llama-3.1-8b-instant';

  // ── Try Groq keys in order ────────────────────────────────
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    try {
      console.log(`Trying Groq key ${i + 1}...`);
      const data = await callGroq(GROQ_KEYS[i], messages, groqModel);
      return res.status(200).json(data);
    } catch (err) {
      if (err.message.startsWith('HARD_FAIL')) {
        return res.status(400).json({ error: err.message });
      }
      console.warn(`Groq key ${i + 1} rate limited, trying next...`);
    }
  }

  // ── All Groq keys exhausted — try Gemini ─────────────────
  if (GEMINI_KEY) {
    try {
      console.log('All Groq keys exhausted, falling back to Gemini...');
      const data = await callGemini(messages);
      return res.status(200).json(data);
    } catch (err) {
      console.error('Gemini fallback also failed:', err.message);
      return res.status(429).json({
        error: 'All providers are currently rate limited. Please wait a moment and try again.',
        detail: err.message
      });
    }
  }

  // ── No fallback available ─────────────────────────────────
  return res.status(429).json({
    error: 'All API keys are rate limited and no fallback is configured.',
  });
}
