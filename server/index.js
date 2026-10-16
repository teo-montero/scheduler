import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { analyseCourse, PROMPT_VERSION } from './course-analysis.js';
import { DEFAULT_MODEL, PROVIDER } from './gemini.js';
import { planWithGemini, interpretChatWithGemini } from './planning.js';

export function createAnalysisServer({ apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || DEFAULT_MODEL, fetchImpl = fetch } = {}) {
  let busy = false;
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const originAllowed = !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    const hostAllowed = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host || '');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, data) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    if (!originAllowed || !hostAllowed) { reply(403, { ok: false, error: 'This local API accepts requests from the Study Space Chrome extension.' }); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Study-Space');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') { reply(200, { ok: true, configured: Boolean(apiKey), model, provider: PROVIDER, promptVersion: PROMPT_VERSION }); return; }
    if (req.method !== 'POST' || !['/analyse', '/plan', '/chat'].includes(req.url)) { reply(404, { ok: false, error: 'Not found.' }); return; }
    if (req.headers['x-study-space'] !== 'extension' || !String(req.headers['content-type']).startsWith('application/json')) { reply(403, { ok: false, error: 'Use the extension to start analysis.' }); return; }
    if (busy) { reply(429, { ok: false, error: 'Another course is being analysed. Wait for it to finish, then try again.' }); return; }
    busy = true;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) throw Object.assign(new Error('Course content is too large for one analysis.'), { status: 413 }); chunks.push(chunk); }
      let state;
      try { state = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid course JSON.'), { status: 400 }); }
      const operation = { '/analyse': analyseCourse, '/plan': planWithGemini, '/chat': interpretChatWithGemini }[req.url];
      const result = await operation(state, { apiKey, model, fetchImpl });
      reply(200, { ok: true, ...result });
    } catch (error) { reply(error.status || 400, { ok: false, error: error.message }); }
    finally { busy = false; }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const server = createAnalysisServer();
  server.listen(8787, '127.0.0.1', () => {
    console.log('Study Space Gemini backend: http://127.0.0.1:8787');
    console.log(process.env.GEMINI_API_KEY ? 'Gemini API key configured. Course content is sent to Gemini only when you start analysis.' : 'Add GEMINI_API_KEY to .env and restart this server to enable Gemini.');
  });
}
