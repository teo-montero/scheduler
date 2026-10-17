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
test('AI cannot invent tasks, overlap commitments, exceed workload, ignore location or fragment continuous tasks', async () => {
  const state = workspace(), context = buildPlanningContext(state, now);
  const good = { taskId: 'sheet', start: atTime('2026-10-19', 16).toISOString(), end: atTime('2026-10-19', 18).toISOString(), location: 'home' };
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
test('sheets and lecture study stay continuous, skip short gaps and get breaks between tasks', () => {
  const state = { ...emptyWorkspace(), personal: { commuteMinutes: 0, studyLocation: 'home' }, settings: { ...emptyWorkspace().settings, blockMinutes: 50, horizonDays: 1 },
    events: [{ id: 'class', title: 'Class', ...slot(10, 11) }], tasks: [
      { id: 'a-sheet', title: 'Problem sheet', estimatedMinutes: 120 },
      { id: 'b-notes', title: 'Lecture notes', estimatedMinutes: 150 }
    ] };
  const context = buildPlanningContext(state, now);
  assert.equal(context.settings.blockMinutes, 120, 'Old 50-minute settings do not recreate fragments');
  const plan = validateStudyPlan(context, localStudyPlan(context));
  assert.equal(plan.blocks.length, 2);
  assert.equal(plan.blocks[0].start, atTime('2026-10-19', 11).toISOString());
  assert.equal((new Date(plan.blocks[0].end) - new Date(plan.blocks[0].start)) / 60000, 120);
  assert.equal((new Date(plan.blocks[1].end) - new Date(plan.blocks[1].start)) / 60000, 150);
  assert.equal((new Date(plan.blocks[1].start) - new Date(plan.blocks[0].end)) / 60000, 10);
  assert.throws(() => validateStudyPlan(context, { sessions: [{ taskId: 'a-sheet', ...slot(11, 12), location: 'home' }] }), /continuous block/);
  state.settings.endHour = 12;
  const tight = buildPlanningContext(state, now), unplanned = validateStudyPlan(tight, localStudyPlan(tight));
  assert.equal(unplanned.blocks.length, 0, 'Two separate one-hour gaps cannot hold a two-hour task');
  assert.equal(unplanned.unscheduled.find(item => item.taskId === 'a-sheet').minutes, 120);
});
test('inter-block breaks are optional when a deadline only permits back-to-back continuous blocks', () => {
  const state = { ...emptyWorkspace(), settings: { ...emptyWorkspace().settings, horizonDays: 1, endHour: 13 }, tasks: [
    { id: 'a', title: 'Sheet A', estimatedMinutes: 120 }, { id: 'b', title: 'Sheet B', estimatedMinutes: 120 }
  ] };
  const context = buildPlanningContext(state, now), plan = validateStudyPlan(context, localStudyPlan(context));
  assert.equal(plan.blocks.length, 2); assert.equal(plan.unscheduled.length, 0);
  assert.equal(plan.blocks[0].end, plan.blocks[1].start);
});
test('opening a saved fragmented plan migrates it once without AI or changes to source data', async () => {
  let stored = workspace(), saves = 0;
  stored.tasks[0].estimatedMinutes = 120;
  stored.blocks = [{ id: 'old-fragment', taskId: 'sheet', title: 'Exercise sheet', ...slot(16, 16.5), source: 'study' }];
  const originalEvents = structuredClone(stored.events);
  const planner = createPlannerService({ storage: { load: async () => structuredClone(stored), save: async state => { saves++; stored = structuredClone(state); } }, connections: {}, ai: { plan: async () => { throw new Error('Migration must not call AI'); } }, now: () => now });
  const migrated = await planner.getWorkspace();
  assert.equal(migrated.blocks.length, 1);
  assert.equal((new Date(migrated.blocks[0].end) - new Date(migrated.blocks[0].start)) / 60000, 120);
  assert.deepEqual(migrated.events, originalEvents);
  assert.ok(migrated.planning.blockPolicyVersion);
  await planner.getWorkspace(); assert.equal(saves, 1, 'A current plan is not rebuilt on each open');
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
