export async function fetchAssistant(payload) {
  let response;
  try {
    response = await fetch(globalThis.location?.protocol.startsWith('http') ? '/api/assistant' : 'http://127.0.0.1:4173/api/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(35000)
    });
  } catch {
    throw new Error('Cannot reach the local assistant. Start the local server and try again.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('The assistant server returned an invalid response. No events were added.'); }
  if (!response.ok || !data.ok) throw new Error(data.error || 'The assistant could not process your request.');
  return data;
}
