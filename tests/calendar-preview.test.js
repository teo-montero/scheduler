import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustPreviewDay } from '../src/calendar-preview.js';

const event = (id, start, end) => ({ id, start: `2026-11-02T${start}:00Z`, end: `2026-11-02T${end}:00Z` });
const events = [event('a', '09:00', '10:00'), event('b', '10:00', '11:00'), event('c', '11:00', '12:00')];
const times = rows => rows.map(row => [row.start.slice(11, 16), row.end.slice(11, 16)]);
test('preview resize pushes and pulls neighbors without changing the input', () => {
  const before = structuredClone(events);
  const extended = adjustPreviewDay(events, 'a', 'end', 1);
  assert.deepEqual(times(extended), [['09:00', '10:30'], ['10:30', '11:30'], ['11:30', '12:30']]);
  assert.deepEqual(times(adjustPreviewDay(extended, 'a', 'end', -1)), times(events));
  assert.deepEqual(events, before);
});
test('preview move ripples both ways, preserving neighboring durations', () => {
  assert.deepEqual(times(adjustPreviewDay(events, 'b', 'move', -1)), [['08:30', '09:30'], ['09:30', '10:30'], ['11:00', '12:00']]);
  assert.deepEqual(times(adjustPreviewDay(events, 'b', 'move', 1)), [['09:00', '10:00'], ['10:30', '11:30'], ['11:30', '12:30']]);
});
test('preview rejects zero duration, stays within the day and leaves other days alone', () => {
  assert.equal(adjustPreviewDay(events, 'a', 'end', -2), null);
  assert.deepEqual(times(adjustPreviewDay([event('short', '09:00', '09:50')], 'short', 'end', -1)), [['09:00', '09:20']]);
  assert.equal(adjustPreviewDay(events, 'a', 'move', -19), null);
  assert.equal(adjustPreviewDay(events, 'c', 'end', 25), null);
  assert.deepEqual(times(adjustPreviewDay([...events, { ...event('tomorrow', '09:00', '10:00'), start: '2026-11-03T09:00:00Z', end: '2026-11-03T10:00:00Z' }], 'a', 'end', 1)), [['09:00', '10:30'], ['10:30', '11:30'], ['11:30', '12:30']]);
});
