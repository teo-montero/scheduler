import { requestGeminiJSON } from '../server/gemini.js';
try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try {
  const result = await requestGeminiJSON('This is a connection check. Return the requested JSON.', { task: 'Set connected to true.' }, { type: 'object', additionalProperties: false, properties: { connected: { type: 'boolean' } }, required: ['connected'] }, { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || undefined, maxOutputTokens: 256 });
  if (result.connected !== true) throw new Error('Gemini returned an unexpected connection-check result.');
  console.log(JSON.stringify({ connected: true, provider: result.provider, model: result.model, usage: result.usage }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
