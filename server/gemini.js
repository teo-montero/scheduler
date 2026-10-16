import { GoogleGenAI } from '@google/genai';

// This SDK and the API key are used only by the Node backend, never the extension.
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const PROVIDER = 'Google Gemini';
export async function requestGeminiJSON(system, payload, schema, { apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, maxOutputTokens = 16384 } = {}) {
  if (!apiKey?.trim()) throw Object.assign(new Error('Add GEMINI_API_KEY to your local .env file and restart npm run ai. Your fetched course content is already saved.'), { status: 503 });
  if (!/^gemini-[a-z0-9][a-z0-9._-]{0,100}$/i.test(model)) throw Object.assign(new Error('Set GEMINI_MODEL to a Gemini model ID, without a URL or models/ prefix.'), { status: 400 });
  const client = new GoogleGenAI({ apiKey: apiKey.trim(), vertexai: false, httpOptions: { apiVersion: 'v1beta', timeout: 120000, fetch: fetchImpl } });
  const started = Date.now();
  console.info('[Study Space][Gemini] Request', { model, api: 'interactions.create' });
  let interaction;
  try {
    interaction = await client.interactions.create({ model, input: JSON.stringify(payload), system_instruction: system,
      store: false, response_format: { type: 'text', mime_type: 'application/json', schema }, generation_config: { max_output_tokens: maxOutputTokens }
    }, { timeout: 120000, maxRetries: 0 });
  } catch (error) {
    const status = Number(error.status || error.statusCode || 0);
    console.warn('[Study Space][Gemini] Request failed', { model, httpStatus: status || null, errorType: error.name, durationMs: Date.now() - started });
    const message = [401, 403].includes(status) ? 'Gemini rejected access. Check GEMINI_API_KEY and its Google AI Studio project permissions.'
      : status === 400 ? 'Gemini rejected the request. Check GEMINI_API_KEY, GEMINI_MODEL and the structured-output configuration.'
      : status === 429 ? 'Gemini quota or rate limit reached. Check your AI Studio quota/billing or try again later.'
      : status === 404 ? 'Gemini model not available. Set GEMINI_MODEL to a model available to your AI Studio project.'
      : status === 503 ? 'Gemini is experiencing high demand. Your data is saved; try again shortly.'
      : status ? `Gemini returned HTTP ${status}. Check your model and API account.` : 'Gemini could not be reached or returned an invalid API response. Your saved data has been kept.';
    // SDK errors can contain request details; never forward or log their raw message.
    throw Object.assign(new Error(message), { status: status === 429 ? 429 : 502 });
  }
  if (interaction.status !== 'completed') throw Object.assign(new Error(interaction.status === 'incomplete' ? 'Gemini reached its output limit. No partial task list was saved.' : 'Gemini did not return a complete response. No partial changes were accepted.'), { status: 502 });
  let data;
  try { data = JSON.parse(interaction.output_text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
  catch { throw Object.assign(new Error('Gemini returned invalid structured JSON. No partial changes were accepted.'), { status: 502 }); }
  const usage = interaction.usage || {};
  console.info('[Study Space][Gemini] Complete', { model, durationMs: Date.now() - started, inputTokens: usage.total_input_tokens || 0, outputTokens: usage.total_output_tokens || 0 });
  return { ...data, provider: PROVIDER, model, usage: { inputTokens: usage.total_input_tokens || 0, outputTokens: usage.total_output_tokens || 0, thinkingTokens: usage.total_thought_tokens || 0, totalTokens: usage.total_tokens || 0 } };
}