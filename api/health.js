// ============================================================
// FILE: api/health.js
// PURPOSE: Tests all configured API keys and returns their
//          status. Hit this endpoint to verify keys work
//          before going live.
// USAGE: Visit /api/health in browser or Postman
// ============================================================

async function testGroqKey(key, index) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: 'Reply with only the word OK' }],
        max_tokens: 5
      })
    });

    if (response.status === 429) return { key: `GROQ_KEY_${index}`, status: 'RATE_LIMITED', ok: false };
    if (response.status === 401) return { key: `GROQ_KEY_${index}`, status: 'INVALID_KEY', ok: false };
    if (!response.ok) return { key: `GROQ_KEY_${index}`, status: `ERROR_${response.status}`, ok: false };

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    return { key: `GROQ_KEY_${index}`, status: 'OK', reply, ok: true };

  } catch (err) {
    return { key: `GROQ_KEY_${index}`, status: 'NETWORK_ERROR', detail: err.message, ok: false };
  }
}

async function testGeminiKey(key) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with only the word OK' }] }]
        })
      }
    );

    if (response.status === 429) return { key: 'GEMINI_KEY', status: 'RATE_LIMITED', ok: false };
    if (response.status === 400) return { key: 'GEMINI_KEY', status: 'INVALID_KEY', ok: false };
    if (!response.ok) return { key: 'GEMINI_KEY', status: `ERROR_${response.status}`, ok: false };

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return { key: 'GEMINI_KEY', status: 'OK', reply, ok: true };

  } catch (err) {
    return { key: 'GEMINI_KEY', status: 'NETWORK_ERROR', detail: err.message, ok: false };
  }
}

export default async function handler(req, res) {
  const GROQ_KEYS = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ];
  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  // Test all keys in parallel
  const groqTests = GROQ_KEYS.map((key, i) =>
    key ? testGroqKey(key, i + 1) : Promise.resolve({ key: `GROQ_KEY_${i + 1}`, status: 'NOT_CONFIGURED', ok: false })
  );

  const geminiTest = GEMINI_KEY
    ? testGeminiKey(GEMINI_KEY)
    : Promise.resolve({ key: 'GEMINI_KEY', status: 'NOT_CONFIGURED', ok: false });

  const [groq1, groq2, groq3, gemini] = await Promise.all([...groqTests, geminiTest]);

  const results = [groq1, groq2, groq3, gemini];
  const workingCount = results.filter(r => r.ok).length;
  const allOk = workingCount === results.length;

  return res.status(200).json({
    summary: allOk ? 'ALL KEYS WORKING' : `${workingCount}/${results.length} KEYS WORKING`,
    timestamp: new Date().toISOString(),
    results
  });
}