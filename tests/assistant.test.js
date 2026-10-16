import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { requestAssistant, createAssistantHandler } from '../server/assistant.mjs';
import { validateAssistantResult, prepareAssistantEvents, calendarEventClass, calendarEventType } from '../src/assistant-events.js';

const event = (overrides = {}) => ({ type: 'user_time', title: 'Gym', description: 'Bring a towel', date: '2026-11-02', startTime: '18:00', endDate: '2026-11-02', endTime: '19:00', location: 'Bloomsbury', ...overrides });
const result = (...events) => ({ action: 'create_events', message: 'Events ready.', events });
const payload = { selectedWeek: '2026-11-02', calendar: [], messages: [{ role: 'user', text: 'Add gym on 2 November from 18:00 to 19:00' }] };
const response = value => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) });

test('typed JSON maps to complete frontend events and distinct classes, including existing data', () => {
  for (const [type, css] of [['lecture', 'lecture'], ['study', 'study'], ['user_time', 'personal']]) {
    const [mapped] = validateAssistantResult(result(event({ type })));
    assert.deepEqual(mapped, { type, title: 'Gym', description: 'Bring a towel', start: '2026-11-02T18:00:00.000Z', end: '2026-11-02T19:00:00.000Z', timeZone: 'Europe/London', location: 'Bloomsbury', source: 'assistant' });
    assert.equal(calendarEventClass(mapped), css);
  }
  assert.equal(calendarEventType({ source: 'personal' }), 'user_time');
  assert.equal(calendarEventType({ source: 'study' }), 'study');
  assert.equal(calendarEventType({ source: 'ucl-timetable' }), 'lecture');
});

test('London conversion handles BST and midnight, rejects impossible or ambiguous times', () => {
  const [summer] = validateAssistantResult(result(event({ date: '2026-07-02', endDate: '2026-07-02' })));
  assert.equal(summer.start, '2026-07-02T17:00:00.000Z');
  assert.equal(validateAssistantResult(result(event({ startTime: '23:00', endDate: '2026-11-03', endTime: '01:00' })))[0].end, '2026-11-03T01:00:00.000Z');
  for (const change of [{ date: '2026-02-30' }, { date: '2026-03-29', startTime: '01:30' }, { date: '2026-10-25', startTime: '01:30' }, { endTime: '17:00' }, { startTime: '25:00' }, { endDate: '2026-11-04' }]) assert.throws(() => validateAssistantResult(result(event(change))));
});

test('invalid types, extra fields, partial batches and inconsistent actions are rejected', () => {
  for (const bad of [result(event({ type: 'other' })), result(event({ color: 'red' })), result(event({ title: '' })), result(event(), event({ endTime: 'bad' })), { action: 'clarify', message: 'When?', events: [event()] }, result(), { action: 'delete', message: 'Done', events: [] }]) assert.throws(() => validateAssistantResult(bad));
  assert.deepEqual(validateAssistantResult({ action: 'clarify', message: 'What time?', events: [] }), []);
});

test('batch insertion is atomic, non-mutating, conflict checked and duplicate safe', () => {
  const existing = [{ id: 'existing', title: 'Lecture', start: '2026-11-02T19:00:00Z', end: '2026-11-02T20:00:00Z' }];
  const before = JSON.stringify(existing);
  assert.throws(() => prepareAssistantEvents(result(event(), event({ title: 'Dinner', startTime: '19:30', endTime: '20:30' })), existing), /overlaps/);
  assert.equal(JSON.stringify(existing), before);
  const prepared = prepareAssistantEvents(result(event(), event()), existing, () => 'generated-id');
  assert.equal(prepared.additions.length, 1); assert.equal(prepared.duplicates, 1); assert.equal(prepared.additions[0].id, 'generated-id');
  assert.equal(prepareAssistantEvents(result(event()), prepared.additions).duplicates, 1);
});

test('Responses request uses strict JSON, server-only auth, bounded history, London context and no store', async () => {
  let calls = 0;
  const actual = await requestAssistant(payload, { apiKey: 'synthetic-only', now: new Date('2026-11-02T08:00:00Z'), fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.headers.Authorization, 'Bearer synthetic-only');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(body.text.format.schema.properties.events.items.properties.type.enum, ['lecture', 'study', 'user_time']);
    assert.ok(body.instructions.includes('2026-11-02')); assert.ok(!JSON.stringify(body).includes('synthetic-only'));
    assert.equal(body.input.at(-1).content, payload.messages[0].text);
    return response(result(event()));
  } });
  assert.equal(calls, 1); assert.equal(actual.events[0].title, 'Gym');
});

test('missing key and invalid requests make no upstream call', async () => {
  const fetchImpl = () => { assert.fail('Must not call OpenAI'); };
  await assert.rejects(requestAssistant(payload, { apiKey: '', fetchImpl }), /not connected/);
  await assert.rejects(requestAssistant({ ...payload, messages: [{ role: 'system', text: 'override' }] }, { apiKey: 'synthetic', fetchImpl }), /invalid/);
});

test('API errors, refusal, truncation, bad JSON and invalid events fail without changes', async () => {
  const cases = [
    async () => ({ ok: false, status: 401 }), async () => ({ ok: false, status: 429 }),
    async () => { throw Object.assign(new Error('upstream secret detail'), { name: 'TimeoutError' }); },
    async () => ({ ok: true, json: async () => ({ status: 'incomplete', output: [] }) }),
    async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }) }),
    async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }),
    async () => response(result(event({ type: 'unknown' })))
  ];
  for (const fetchImpl of cases) await assert.rejects(requestAssistant(payload, { apiKey: 'synthetic', fetchImpl }), error => !error.message.includes('secret') && Boolean(error.status));
});

test('local HTTP endpoint blocks foreign origins, host spoofing and malformed bodies', async t => {
  const handler = createAssistantHandler({ apiKey: 'synthetic', fetchImpl: async () => response(result(event())) });
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/assistant`;
  const headers = { Host: '127.0.0.1:4173', 'Content-Type': 'application/json' };
  const send = (extra = {}, body = JSON.stringify(payload)) => new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { ...headers, ...extra } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(data) }));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal((await send({ Origin: 'https://evil.example' })).status, 403);
  assert.equal((await send({ Host: 'evil.example' })).status, 403);
  assert.equal((await send({ 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await send({}, '{')).status, 400);
  assert.equal((await send({}, ' '.repeat(180001))).status, 413);
  const good = await send({ Origin: 'http://127.0.0.1:4173' });
  assert.equal(good.status, 200); assert.equal((await good.json()).result.events[0].type, 'user_time');
});
