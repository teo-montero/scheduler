import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCourseState, parseCourseState, validateAnalysis, tasksFromAnalysis, courseFingerprint, reconcileMoodleWorkspace } from '../src/course-content.js';
import { scheduleTasks } from '../src/scheduler.js';
import { atTime } from '../src/dates.js';
const raw = {
  course: { id: '9001', statekey: 'irrelevant-page-state' },
  section: [{ id: '10', number: 1, title: 'Week 3: 19 - 23 Oct. 2026' }, { id: '20', title: 'Additional Material' }],
  cm: [
    { id: '1', name: 'Lecture &amp; notes 1', module: 'resource', sectionid: '10', url: 'https://moodle.ucl.ac.uk/mod/resource/view.php?id=1&sesskey=synthetic-secret', isoverallcomplete: true },
    { id: '2', name: 'Problem Set 1', module: 'folder', sectionid: '10', url: 'https://moodle.ucl.ac.uk/mod/folder/view.php?id=2', completionstate: 0 },
    { id: '3', name: 'Group Coursework: Submission', module: 'assign', sectionid: '10', url: 'https://moodle.ucl.ac.uk/mod/assign/view.php?id=3' },
    { id: '4', name: 'Non examinable: Lecture 16', module: 'resource', sectionid: '20', url: 'https://moodle.ucl.ac.uk/mod/resource/view.php?id=4' },
    { id: '5', name: 'Hidden resource', module: 'resource', sectionid: '10', visible: false },
    { id: '6', name: 'Announcements', module: 'forum', sectionid: '10' }
  ]
};
const course = { id: 9001, name: 'Example module', shortname: 'EXAMPLE' };
const suggestion = (activityId, category, estimatedMinutes, optional = false) => ({ activityId: String(activityId), title: `Task ${activityId}`, category, estimatedMinutes, optional, confidence: 'low', reason: 'Estimate based on course metadata, not document contents.' });
const suggestions = { tasks: [suggestion(1, 'lecture', 60), suggestion(2, 'exercise', 120), suggestion(3, 'assignment', null), suggestion(4, 'lecture', 60)] };
test('double-encoded Moodle response normalises links, dates, visibility and three-state completion', () => {
  const response = JSON.stringify([{ error: false, data: JSON.stringify(raw) }]);
  assert.equal(parseCourseState(response).cm.length, 6);
  const state = normalizeCourseState(response, course);
  assert.equal(state.activities.length, 5);
  assert.equal(state.activities[0].name, 'Lecture & notes 1');
  assert.ok(!JSON.stringify(state).includes('synthetic-secret'));
  assert.ok(!JSON.stringify(state).includes('irrelevant-page-state'));
  assert.deepEqual(state.activities.slice(0, 3).map(a => a.completionStatus), ['complete', 'incomplete', 'unknown']);
  assert.equal(state.sections[0].notBefore, atTime('2026-10-19').toISOString());
  assert.equal(state.sections[0].teachingWeekEnd, atTime('2026-10-23', 23, 59).toISOString());
  assert.throws(() => normalizeCourseState(raw, { id: 9002 }));
});
test('AI suggestions use source URLs and completion, leave unknown workload out of the plan, and respect teaching weeks', () => {
  const state = normalizeCourseState(raw, course);
  const tasks = tasksFromAnalysis(state, suggestions);
  assert.equal(tasks[0].completed, true);
  assert.equal(tasks[0].url, 'https://moodle.ucl.ac.uk/mod/resource/view.php?id=1');
  assert.equal(tasks[1].dueDate, null);
  assert.equal(tasks[2].needsEstimate, true); assert.equal(tasks[2].includeInPlan, false);
  assert.equal(tasks[3].optional, true); assert.equal(tasks[3].includeInPlan, false);
  const plan = scheduleTasks({ tasks, now: atTime('2026-10-16', 9) });
  assert.deepEqual(new Set(plan.blocks.map(b => b.taskId)), new Set(['moodle-activity-9001-2']));
  assert.ok(plan.blocks.every(b => new Date(b.start) >= atTime('2026-10-19')));
});
test('invalid, invented or duplicate AI resource IDs and invalid estimates are rejected atomically', () => {
  const state = normalizeCourseState(raw, course);
  for (const tasks of [[suggestion(999, 'lecture', 60)], [suggestion(1, 'lecture', 60), suggestion(1, 'lecture', 60)], [suggestion(1, 'lecture', -1)], [suggestion(1, 'invented', 60)]]) assert.throws(() => validateAnalysis(state, { tasks }));
  const result = validateAnalysis(state, { tasks: [{ ...suggestion(2, 'exercise', 60), url: 'https://evil.test/', dueDate: 'invented' }] });
  assert.ok(!('url' in result.tasks[0])); assert.ok(!('dueDate' in result.tasks[0]));
});
test('content fingerprints ignore completion changes but detect material changes', async () => {
  const a = normalizeCourseState(raw, course), b = structuredClone(a);
  b.activities[0].completionStatus = 'incomplete';
  assert.equal(await courseFingerprint(a), await courseFingerprint(b));
  b.activities[0].name = 'Revised notes';
  assert.notEqual(await courseFingerprint(a), await courseFingerprint(b));
});
test('course tasks and Moodle calendar actions merge by activity, preserving edits and day preferences', () => {
  const state = normalizeCourseState(raw, course), contentTasks = tasksFromAnalysis(state, suggestions);
  const old = { id: 'moodle-500', courseId: 9001, activityId: '3', title: 'Old coursework', source: 'moodle', type: 'assignment', url: 'https://moodle.ucl.ac.uk/mod/assign/view.php?id=3', estimatedMinutes: 180, estimateEdited: true, completed: true, completionOverride: true };
  const calendar = { ...old, estimatedMinutes: 120, estimateEdited: false, completed: false, completionOverride: undefined, dueDate: atTime('2026-10-23', 17).toISOString() };
  const workspace = { tasks: [old, { id: 'personal', source: 'personal', estimatedMinutes: 30 }], moodleCalendarTasks: [calendar], courseContent: { 9001: { state, analysis: { tasks: contentTasks } } }, preferences: { 'moodle-500': { date: '2026-10-21' } } };
  reconcileMoodleWorkspace(workspace);
  assert.equal(workspace.tasks.length, 5);
  const task = workspace.tasks.find(t => t.activityId === '3');
  assert.equal(task.id, 'moodle-activity-9001-3'); assert.equal(task.completed, true);
  assert.equal(task.estimatedMinutes, 180); assert.equal(task.needsEstimate, false); assert.equal(task.includeInPlan, true);
  assert.equal(task.dueDate, calendar.dueDate);
  assert.deepEqual(workspace.preferences[task.id], { date: '2026-10-21' });
  workspace.moodleCalendarTasks = []; reconcileMoodleWorkspace(workspace);
  assert.equal(workspace.tasks.find(t => t.activityId === '3').dueDate, null);
  assert.equal(workspace.tasks.find(t => t.activityId === '3').estimatedMinutes, 180);
});
