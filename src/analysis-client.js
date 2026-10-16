export const AI_BACKEND = 'http://127.0.0.1:8787';
export async function backendHealth() {
  try {
    const response = await fetch(`${AI_BACKEND}/health`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new Error('Start the local Gemini backend with npm run ai. Your fetched course content stays saved in the extension.'); }
}
export async function requestAnalysis(state) {
  let response;
  try { response = await fetch(`${AI_BACKEND}/analyse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Study-Space': 'extension' }, body: JSON.stringify(state), signal: AbortSignal.timeout(150000) }); }
  catch { throw new Error('The Gemini backend could not be reached or the request timed out. Keep npm run ai running, then analyse the saved course again.'); }
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Gemini analysis failed. Your saved course content has been kept.');
  return result;
}

async function planningRequest(path, input) {
  let response;
  try { response = await fetch(`${AI_BACKEND}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Study-Space': 'extension' }, body: JSON.stringify(input), signal: AbortSignal.timeout(150000) }); }
  catch { throw new Error('Start the Gemini backend with npm run ai and keep it running.'); }
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Gemini could not complete the request.');
  return result;
}
export const requestPlan = context => planningRequest('plan', context);
export const requestChat = input => planningRequest('chat', input);
