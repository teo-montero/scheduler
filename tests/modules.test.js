import test from 'node:test';
import assert from 'node:assert/strict';
import { consideredTasks, isCourseIncluded } from '../src/modules.js';
import { scheduleTasks } from '../src/scheduler.js';
import { atTime } from '../src/dates.js';

test('module choices remove work from scheduling while preserving imported data and all timetable commitments', () => {
  const day = '2026-10-19';
  const tasks = [
    { id: 'chosen', courseId: 101, estimatedMinutes: 50, dueDate: atTime(day, 17).toISOString() },
    { id: 'excluded', courseId: 102, estimatedMinutes: 60, dueDate: atTime(day, 8).toISOString() },
    { id: 'independent', courseId: 0, estimatedMinutes: 25, dueDate: null },
    { id: 'manual-in-module', courseId: '102', estimatedMinutes: 25, dueDate: null }
  ];
  const events = [{ id: 'class-from-excluded-module', courseId: 102, start: atTime(day, 9).toISOString(), end: atTime(day, 11).toISOString() }];
  const workspace = { tasks, events, excludedCourseIds: ['102'] };
  const snapshot = JSON.stringify(workspace);
  const plan = scheduleTasks({ tasks: consideredTasks(workspace), events, now: atTime(day, 9) });
  assert.deepEqual(new Set(plan.blocks.map(b => b.taskId)), new Set(['chosen', 'independent']));
  assert.equal(plan.unscheduled.length, 0);
  assert.ok(plan.blocks.every(b => new Date(b.start) >= atTime(day, 11)));
  assert.equal(JSON.stringify(workspace), snapshot);
  workspace.excludedCourseIds = [];
  assert.equal(consideredTasks(workspace).length, 4);
  assert.equal(workspace.tasks[1].estimatedMinutes, 60);
});

test('existing workspaces default to all modules and match course IDs as strings or numbers', () => {
  const tasks = [{ id: 'a', courseId: 1 }, { id: 'b', courseId: '2' }, { id: 'personal', courseId: 0 }];
  assert.deepEqual(consideredTasks({ tasks }), tasks);
  assert.deepEqual(consideredTasks({ tasks, excludedCourseIds: [2] }).map(t => t.id), ['a', 'personal']);
  assert.equal(isCourseIncluded({ excludedCourseIds: ['1'] }, 1), false);
  assert.equal(isCourseIncluded({ excludedCourseIds: ['0'] }, 0), true);
});
