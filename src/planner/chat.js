import { atTime, dateKey } from '../dates.js';
import { plainText } from '../course-content.js';
import { isCourseIncluded } from '../modules.js';

export function applyChatActions(workspace, actions, now = new Date()) {
  if (!Array.isArray(actions) || !actions.length || actions.length > 10) throw new Error('The assistant did not return a supported change.');
  const state = structuredClone(workspace);
  for (const [index, action] of actions.entries()) {
    if (action.type === 'block_time') {
      const start = new Date(action.start), end = new Date(action.end);
      if (!Number.isFinite(start.getTime()) || end <= start || !Number.isFinite(end.getTime()) || end <= now || end - start > 7 * 86400000 || start.getTime() - now.getTime() > 90 * 86400000) throw new Error('The assistant returned an invalid personal-time range.');
      state.blocked.push({ id: `personal-chat-${now.getTime()}-${index}`, title: plainText(action.title || 'Personal time').slice(0, 100), start: start.toISOString(), end: end.toISOString(), source: 'personal' });
    } else if (action.type === 'complete_task' || action.type === 'move_task') {
      const task = state.tasks.find(t => t.id === action.taskId && isCourseIncluded(state, t.courseId));
      if (!task) throw new Error('The assistant selected an unknown or excluded task.');
      if (action.type === 'complete_task') { task.completed = true; task.completionOverride = true; }
      else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(action.date || '') || dateKey(atTime(action.date)) !== action.date || action.date < dateKey(now) || task.dueDate && atTime(action.date) >= new Date(task.dueDate)) throw new Error('The assistant selected an invalid study date or a date after the deadline.');
        state.preferences[task.id] = { date: action.date };
      }
    } else throw new Error('The assistant requested an unsupported change. Lectures and weekly commitments cannot be moved by chat.');
  }
  return state;
}
