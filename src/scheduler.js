import { addDays, atTime, dateKey, weekday } from './dates.js';
import { nextStudyBlockMinutes, STUDY_BLOCK_MINUTES } from './study-blocks.js';
export const DEFAULT_SETTINGS = { startHour: 9, endHour: 18, blockMinutes: STUDY_BLOCK_MINUTES, breakMinutes: 10, weekends: false, horizonDays: 28 };
const ms = minutes => minutes * 60000;
export function scheduleTasks({ tasks, events = [], blocked = [], preferences = {}, settings = {}, now = new Date() }) {
  const config = { ...DEFAULT_SETTINGS, ...settings };
  if (!(config.startHour >= 0 && config.endHour <= 24 && config.startHour < config.endHour && config.blockMinutes >= 15 && config.blockMinutes <= 120 && config.breakMinutes >= 0 && config.horizonDays >= 1 && config.horizonDays <= 90)) throw new Error('Invalid study hours or block length.');
  const start = new Date(now).getTime();
  const firstDay = dateKey(now);
  const horizon = atTime(addDays(firstDay, config.horizonDays)).getTime();
  const occupied = [...events, ...blocked].map(e => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() })).filter(e => Number.isFinite(e.start) && e.end > e.start);
  const blocks = [], unscheduled = [];
  const pending = tasks.filter(t => !t.completed && t.includeInPlan !== false && !t.needsEstimate).sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity) || String(a.id).localeCompare(String(b.id)));
  for (const task of pending) {
    let remaining = Math.max(0, Math.round(Number(task.estimatedMinutes) || 120));
    const deadline = task.dueDate ? new Date(task.dueDate).getTime() : horizon;
    if (!Number.isFinite(deadline)) { unscheduled.push({ taskId: task.id, minutes: remaining, reason: 'Invalid deadline' }); continue; }
    const availableFrom = task.notBefore ? new Date(task.notBefore).getTime() : start;
    if (!Number.isFinite(availableFrom)) { unscheduled.push({ taskId: task.id, minutes: remaining, reason: 'Invalid teaching date' }); continue; }
    if (availableFrom >= horizon && !task.dueDate) continue; // Future teaching belongs to the course backlog.
    const preference = preferences[task.id];
    for (let day = 0; day < config.horizonDays && remaining > 0; day++) {
      const key = addDays(firstDay, day);
      if ((!config.weekends && [0, 6].includes(weekday(key))) || (preference?.date && key !== preference.date)) continue;
      let cursor = Math.max(start, availableFrom, atTime(key, config.startHour).getTime());
      // Use a five-minute grid without advancing beyond a deadline.
      cursor = Math.ceil(cursor / ms(5)) * ms(5);
      const end = Math.min(atTime(key, config.endHour).getTime(), deadline, horizon);
      if (end <= cursor) continue;
      const busy = occupied.filter(e => e.end > cursor && e.start < end).sort((a, b) => a.start - b.start);
      const gaps = [];
      for (const event of busy) {
        if (event.start > cursor) gaps.push([cursor, Math.min(event.start, end)]);
        cursor = Math.max(cursor, event.end);
      }
      if (cursor < end) gaps.push([cursor, end]);
      for (const [gapStart, gapEnd] of gaps) {
        let slot = gapStart;
        while (remaining > 0) {
          const length = nextStudyBlockMinutes({ estimatedMinutes: Math.max(0, Math.round(Number(task.estimatedMinutes) || 120)) }, remaining);
          if (gapEnd - slot < ms(length)) break;
          const block = { id: `study-${task.id}-${slot}`, taskId: task.id, courseId: task.courseId, courseName: task.courseName, title: task.title, start: new Date(slot).toISOString(), end: new Date(slot + ms(length)).toISOString(), source: 'study' };
          blocks.push(block);
          // A break is reserved after every focus block, including between tasks.
          occupied.push({ start: slot, end: slot + ms(length + config.breakMinutes) });
          remaining -= length;
          slot += ms(length + config.breakMinutes);
        }
      }
    }
    if (remaining > 0) unscheduled.push({ taskId: task.id, minutes: remaining, reason: deadline <= start ? 'Deadline has passed' : preference?.date ? 'Not enough time on your chosen day' : 'Not enough free time before the deadline' });
  }
  return { blocks: blocks.sort((a, b) => new Date(a.start) - new Date(b.start)), unscheduled };
}
