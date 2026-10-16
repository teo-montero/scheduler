import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAnalysisServer } from '../server/index.js';
import { buildPlanningContext, localStudyPlan } from '../src/planner/planning.js';
import { emptyWorkspace } from '../src/demo.js';
import { atTime } from '../src/dates.js';

test('plan and chat HTTP endpoints use native Gemini structured output, validate IDs and strip private fields', async () => {
  let calls = [], badOutput = false;
  const server = createAnalysisServer({ apiKey: 'synthetic-test-key', fetchImpl: async (input, init) => {
    const req = new Request(input, init); const url = req.url;
    const body = JSON.parse(await req.text()), payload = JSON.parse(body.input); calls.push(body);
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions'); assert.equal(body.response_format.mime_type, 'application/json');
    assert.ok(!body.input.includes('private-do-not-send'));
    const result = payload.candidate ? badOutput ? { sessions: [{ taskId: 'invented', start: payload.now, end: payload.horizonEnd, location: 'home' }], note: '' } : localStudyPlan(payload)
      : { message: 'Afternoon protected.', clarification: null, actions: [{ type: 'block_time', taskId: null, start: '2026-10-19T11:00:00.000Z', end: '2026-10-19T17:00:00.000Z', date: null, title: 'Bar with friends' }] };
    return Response.json({ id: 'synthetic-interaction', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(result) }] }], usage: { total_input_tokens: 200, total_output_tokens: 100 } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Study-Space': 'extension', Origin: `chrome-extension://${'b'.repeat(32)}` }, body: JSON.stringify(data) });
  try {
    const state = emptyWorkspace(); state.tasks = [{ id: 'sheet', title: 'Exercise sheet', estimatedMinutes: 60 }]; state.settings.horizonDays = 2;
    const context = buildPlanningContext(state, atTime('2026-10-19', 9)); context.calendarUrl = 'private-do-not-send'; context.cookie = 'private-do-not-send';
    const response = await post('/plan', context), result = await response.json(); assert.equal(response.status, 200); assert.equal(result.sessions.length, 2); assert.equal(result.usage.inputTokens, 200);
    const chatResponse = await post('/chat', { message: 'Keep this afternoon free; I am going to the bar with friends', now: context.now, tasks: state.tasks, calendarUrl: 'private-do-not-send' });
    const chat = await chatResponse.json(); assert.equal(chatResponse.status, 200); assert.equal(chat.actions[0].type, 'block_time');
    badOutput = true; const invalid = await post('/plan', context); assert.equal(invalid.status, 400); assert.equal((await invalid.json()).ok, false);
    assert.equal(calls.length, 3);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
