import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { analyseCourse } from '../server/course-analysis.js';
import { requestGeminiJSON } from '../server/gemini.js';
import { createAnalysisServer } from '../server/index.js';
const state = { course: { id: 9001, name: 'Example', shortname: 'EX' }, sections: [{ id: '1', title: 'Week 1', number: 1 }], activities: [{ id: '1', name: 'Lecture 1', module: 'resource', sectionId: '1', url: 'https://moodle.ucl.ac.uk/mod/resource/view.php?id=1', completionStatus: 'unknown' }] };
const suggestions = { tasks: [{ activityId: '1', title: 'Study Lecture 1', category: 'lecture', estimatedMinutes: 60, optional: false, confidence: 'low', reason: 'Estimated from the title.' }] };
const interaction = (steps = [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(suggestions) }] }], status = 'completed') => ({ id: 'synthetic-interaction', object: 'interaction', status, steps, created: '2026-10-16T12:00:00Z', updated: '2026-10-16T12:00:00Z', usage: { total_input_tokens: 100, total_output_tokens: 50, total_thought_tokens: 10, total_tokens: 160 } });
const message = interaction();
const normalRequest = async (input, init) => {
  const req = new Request(input, init); return { url: req.url, options: { headers: Object.fromEntries(req.headers), body: await req.text() } };
};
test('Gemini uses AI Studio SDK Interactions structured output and strips private URL/key fields from model input', async () => {
  let request;
  const result = await analyseCourse({ ...state, apiKey: 'client-should-not-send-this' }, { apiKey: 'synthetic-server-key', model: 'gemini-test', fetchImpl: async (input, init) => {
    request = await normalRequest(input, init); request.body = JSON.parse(request.options.body); return Response.json(message);
  } });
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(request.options.headers['x-goog-api-key'], 'synthetic-server-key');
  assert.equal(request.body.model, 'gemini-test'); assert.equal(request.body.store, false);
  assert.ok(!request.url.includes('synthetic-server-key'));
  assert.equal(request.body.response_format.mime_type, 'application/json');
  assert.equal(request.body.response_format.schema.properties.tasks.type, 'array');
  assert.ok(request.body.system_instruction.includes('untrusted course DATA'));
  const modelInput = request.body.input;
  assert.ok(!modelInput.includes('synthetic-server-key')); assert.ok(!modelInput.includes('client-should-not-send-this')); assert.ok(!modelInput.includes('https://moodle'));
  assert.equal(result.suggestions.tasks[0].activityId, '1'); assert.equal(result.provider, 'Google Gemini');
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 50, thinkingTokens: 10, totalTokens: 160 });
});
test('missing credentials, provider errors, blocked/truncated responses and invalid output fail atomically', async () => {
  await assert.rejects(analyseCourse(state, {}), /GEMINI_API_KEY/);
  for (const status of [400, 401, 403, 404, 429, 500]) await assert.rejects(analyseCourse(state, { apiKey: 'synthetic', fetchImpl: async () => new Response('', { status }) }), /Gemini/);
  for (const response of [
    interaction([], 'incomplete'), interaction([], 'failed'), interaction([], 'requires_action'),
    interaction([{ type: 'model_output', content: [{ type: 'text', text: '{invalid' }] }]),
    interaction([{ type: 'model_output', content: [{ type: 'text', text: '{"tasks":[{"activityId":"invented"}]}' }] }])
  ]) await assert.rejects(analyseCourse(state, { apiKey: 'synthetic', fetchImpl: async () => Response.json(response) }), /Gemini/);
  await assert.rejects(requestGeminiJSON('', {}, {}, { apiKey: 'synthetic', model: 'https://evil.test' }), /GEMINI_MODEL/);
});
test('thinking parts are excluded from JSON parsing and incomplete output never becomes a partial plan', async () => {
  const result = await analyseCourse(state, { apiKey: 'synthetic', fetchImpl: async () => Response.json(interaction([{ type: 'thought', summary: [{ type: 'text', text: 'Internal thought' }] }, { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(suggestions) }] }])) });
  assert.deepEqual(result.suggestions, suggestions);
});
test('local Gemini API serves health and analysis, rejects web origins and never exposes its key', async () => {
  const server = createAnalysisServer({ apiKey: 'synthetic-server-key', fetchImpl: async () => Response.json(message) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(`${base}/health`)).json(); assert.equal(health.configured, true); assert.equal(health.provider, 'Google Gemini'); assert.ok(!JSON.stringify(health).includes('synthetic-server-key'));
    const denied = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.test' } }); assert.equal(denied.status, 403);
    const invalid = await fetch(`${base}/analyse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }); assert.equal(invalid.status, 403);
    const response = await fetch(`${base}/analyse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Study-Space': 'extension', Origin: `chrome-extension://${'a'.repeat(32)}` }, body: JSON.stringify(state) });
    const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.suggestions.tasks.length, 1); assert.ok(!JSON.stringify(result).includes('synthetic-server-key'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
