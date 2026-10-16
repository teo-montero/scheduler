import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerService } from '../src/planner/service.js';
import { buildPlanningContext, localStudyPlan, validateStudyPlan, generateWorkspacePlan, weeklyEvents, overlaps } from '../src/planner/planning.js';
import { applyChatActions } from '../src/planner/chat.js';
import { normalizeCourseState } from '../src/course-content.js';
import { emptyWorkspace } from '../src/demo.js';
import { atTime, dateKey } from '../src/dates.js';
import { fetchUclTimetable } from '../src/integrations/timetable.js';
const now = atTime('2026-10-19', 8);
const slot = (hour, end) => ({ start: atTime('2026-10-19', hour).toISOString(), end: atTime('2026-10-19', end).toISOString() });
function workspace() {
  return { ...emptyWorkspace(), settings: { ...emptyWorkspace().settings, horizonDays: 2 }, personal: { commuteMinutes: 30, studyLocation: 'home' },
    events: [{ id: 'lecture', title: 'Lecture', source: 'ucl-timetable', ...slot(10, 12) }],
    tasks: [{ id: 'sheet', title: 'Exercise sheet', source: 'personal', estimatedMinutes: 180, completed: false, dueDate: atTime('2026-10-20', 18).toISOString() }],
    weeklyActivities: [{ id: 'job', title: 'Part-time job', days: [1], startTime: '14:00', endTime: '16:00' }] };
}
test('home/campus preferences produce commute events and respect lecture > personal > study priorities', async () => {
  for (const studyLocation of ['home', 'campus', 'either']) {
    const state = workspace(); state.personal.studyLocation = studyLocation;
    const context = buildPlanningContext(state, now), output = localStudyPlan(context), plan = validateStudyPlan(context, output);
    assert.equal(plan.unscheduled.length, 0);
    assert.equal(plan.blocks.reduce((sum, block) => sum + (new Date(block.end) - new Date(block.start)) / 60000, 0), 180);
    assert.ok(plan.personalEvents.some(event => event.kind === 'commute'));
    assert.ok(plan.personalEvents.some(event => event.kind === 'weekly'));
    for (const block of plan.blocks) assert.ok(context.busy.every(event => !overlaps(block, event)));
    if (studyLocation === 'home') assert.ok(plan.blocks.every(block => dateKey(block.start) !== '2026-10-19' || new Date(block.end) <= atTime('2026-10-19', 9, 30) || new Date(block.start) >= atTime('2026-10-19', 12, 30)));
    if (studyLocation === 'campus') assert.ok(plan.blocks.every(block => block.location === 'campus'));
    const generated = await generateWorkspacePlan(state, { ai: { plan: async () => output }, now });
    assert.equal(generated.planning.engine, 'ai'); assert.deepEqual(generated.events, state.events);
  }
});
test('AI cannot invent tasks, overlap commitments, exceed workload, ignore location or remove breaks', async () => {
  const state = workspace(), context = buildPlanningContext(state, now);
  const good = { taskId: 'sheet', start: atTime('2026-10-19', 16).toISOString(), end: atTime('2026-10-19', 16, 50).toISOString(), location: 'home' };
  assert.equal(validateStudyPlan(context, { sessions: [good] }).blocks.length, 1);
  for (const sessions of [
    [{ ...good, taskId: 'invented' }], [{ ...good, ...slot(10, 11) }], [{ ...good, location: 'campus' }],
    [good, { ...good, start: atTime('2026-10-19', 16, 25).toISOString(), end: atTime('2026-10-19', 17, 15).toISOString() }], [good, { ...good, start: good.end, end: atTime('2026-10-19', 17, 40).toISOString() }],
    [{ ...good, start: atTime('2026-10-18', 9).toISOString() }]
  ]) assert.throws(() => validateStudyPlan(context, { sessions }));
  assert.throws(() => validateStudyPlan({ ...context, settings: { ...context.settings, dailyStudyLimitMinutes: 45 } }, { sessions: [good] }), /daily study limit/);
  const fallback = await generateWorkspacePlan(state, { ai: { plan: async () => ({ sessions: [{ ...good, taskId: 'invented' }] }) }, now });
  assert.equal(fallback.planning.engine, 'local-fallback'); assert.ok(fallback.planning.warning); assert.ok(fallback.blocks.every(block => block.taskId === 'sheet'));
});
test('recurrence preserves London clock times across DST, supports overnight activities and reports fixed clashes', () => {
  const recurring = weeklyEvents([{ id: 'social', title: 'Social', days: [5], startTime: '22:00', endTime: '01:00' }], atTime('2026-10-23', 8), 8);
  assert.equal(recurring.length, 2); assert.equal(recurring[0].start, '2026-10-23T21:00:00.000Z'); assert.equal(recurring[1].start, '2026-10-30T22:00:00.000Z');
  assert.equal(recurring[0].end, '2026-10-24T00:00:00.000Z');
  const state = workspace(); state.weeklyActivities[0].startTime = '11:00'; state.weeklyActivities[0].endTime = '13:00';
  const context = buildPlanningContext(state, now); assert.ok(context.conflicts.length > 0); assert.equal(context.fixedEvents.find(event => event.id === 'lecture').priority, 3);
  assert.deepEqual(state.events[0], workspace().events[0]);
});
test('fetch-only onboarding saves only selected indexes before AI and handles failure without losing other data', async () => {
  let stored = workspace(), calls = [], aiCalls = 0;
  const content = id => normalizeCourseState({ course: { id }, section: [{ id: '1', title: 'Notes' }], cm: [{ id: String(id * 10), sectionid: '1', name: 'Lecture 1', module: 'resource' }] }, { id, name: `Course ${id}` });
  const planner = createPlannerService({
    storage: { load: async () => structuredClone(stored), save: async state => { stored = structuredClone(state); } }, now: () => now,
    connections: { moodle: { listCourses: async () => ({ courses: [{ id: 1, name: 'Course 1' }, { id: 2, name: 'Generic' }, { id: 3, name: 'Broken' }] }), readCourse: async course => { calls.push(course.id); if (course.id === 3) throw new Error('Moodle unavailable'); return content(course.id); } } },
    ai: { analyse: async state => { aiCalls++; assert.ok(stored.courseContent[state.course.id]); return { suggestions: { tasks: [{ activityId: state.activities[0].id, title: 'Study Lecture 1', category: 'lecture', estimatedMinutes: 60, optional: false, confidence: 'low', reason: 'Title only.' }] } }; }, plan: async context => localStudyPlan(context) }
  });
  await planner.loadCourses(); await planner.selectCourses([1, 3]); const checked = await planner.fetchSelectedCourses();
  assert.deepEqual(calls, [1, 3]); assert.equal(aiCalls, 0); assert.equal(checked.errors.length, 1); assert.equal(stored.courseContent[1].state.activities.length, 1); assert.equal(stored.events[0].id, 'lecture');
  await planner.analyseSelectedCourses(); assert.equal(aiCalls, 1); assert.equal(stored.tasks.filter(t => t.source === 'moodle-content').length, 1);
  await planner.fetchSelectedCourses(); await planner.analyseSelectedCourses(); assert.equal(aiCalls, 1, 'Unchanged content reuses analysis');
});
test('chat changes only allowed fields, protects requested time and replans even if AI planning fails', async () => {
  let stored = workspace(); const original = structuredClone(stored.events);
  const actions = [{ type: 'block_time', title: 'Bar with friends', ...slot(12, 18) }];
  assert.throws(() => applyChatActions(stored, [{ type: 'move_lecture', taskId: 'lecture' }], now));
  assert.deepEqual(stored.events, original);
  const planner = createPlannerService({ storage: { load: async () => structuredClone(stored), save: async state => { stored = structuredClone(state); } }, connections: {}, now: () => now,
    ai: { chat: async () => ({ message: 'Your afternoon is protected.', clarification: null, actions }), plan: async () => { throw new Error('Offline'); } } });
  const changed = await planner.chat('This afternoon must be free because I am going to the bar with friends');
  assert.equal(changed.applied, true); assert.deepEqual(stored.events, original);
  assert.ok(stored.blocks.every(block => !overlaps(block, actions[0]))); assert.equal(stored.planning.engine, 'local-fallback');
  const invalid = structuredClone(stored);
  await assert.rejects(planner.chat(''), /request/); assert.deepEqual(stored, invalid);
});
test('the timetable connector downloads independently and rejects non-UCL destinations', async () => {
  let count = 0;
  const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:test\r\nDTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\nSUMMARY:Lecture\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const result = await fetchUclTimetable('https://timetable.apps.ucl.ac.uk/icalendar/synthetic-connector', { now, fetchImpl: async url => { count++; assert.match(url, /timetable.mesh.ucl.ac.uk/); return new Response(text); } });
  assert.equal(count, 1); assert.equal(result.events.length, 1);
  await assert.rejects(fetchUclTimetable('https://untrusted.test/calendar'), /UCL/);
});
