import { addDays, atTime, dateKey, weekday } from './dates.js';
const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function commandDate(text, now = new Date()) {
  const key = dateKey(now);
  if (/\btomorrow\b/i.test(text)) return addDays(key, 1);
  if (/\btoday\b/i.test(text)) return key;
  const match = text.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!match) return null;
  let offset = (dayNames.indexOf(match[1]) - weekday(key) + 7) % 7;
  if (/\bnext\b/i.test(text) && offset === 0) offset = 7;
  return addDays(key, offset);
}
function findTask(query, tasks) {
  const normal = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !['the', 'task', 'work', 'coursework', 'this', 'my', 'on', 'for'].includes(w));
  const words = normal(query);
  if (!words.length) return { error: 'Include a task title or module code so I can find the right task.' };
  const matches = tasks.filter(t => !t.completed).map(task => ({ task, score: words.filter(w => normal(`${task.title} ${task.courseName}`).some(x => x.includes(w))).length })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (!matches.length) return { error: 'I couldn’t find that unfinished task. Try using its title or module code.' };
  if (matches[1]?.score === matches[0].score) return { error: 'That matches more than one task. Use a more specific task title.' };
  return { task: matches[0].task };
}
export function parseCommand(text, tasks, now = new Date()) {
  const date = commandDate(text, now);
  if (/\b(busy|unavailable|going out|block)\b/i.test(text)) {
    if (!date) return { error: 'Include a day, for example “I’m busy Wednesday afternoon”.' };
    let startHour, endHour, label;
    const explicit = text.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    let startMinute = 0, endMinute = 0;
    if (explicit) {
      const hour = (h, meridiem) => meridiem ? Number(h) % 12 + (meridiem.toLowerCase() === 'pm' ? 12 : 0) : Number(h);
      startHour = hour(explicit[1], explicit[3]); endHour = hour(explicit[4], explicit[6]);
      startMinute = Number(explicit[2] || 0); endMinute = Number(explicit[5] || 0);
      // A meridiem suffix must be supplied for both values when using a 12-hour range.
      if (Boolean(explicit[3]) !== Boolean(explicit[6])) return { error: 'Use 24-hour times (“14:00–17:00”) or add am/pm to both times (“2pm–5pm”).' };
      label = 'Personal time';
    } else if (/\bevening\b/i.test(text)) { startHour = 17; endHour = 23; label = 'Evening off'; }
    else if (/\bafternoon\b/i.test(text)) { startHour = 12; endHour = 18; label = 'Afternoon off'; }
    else if (/\bmorning\b/i.test(text)) { startHour = 8; endHour = 12; label = 'Morning off'; }
    else if (/\b(all day|whole day)\b/i.test(text)) { startHour = 0; endHour = 24; label = 'Day off'; }
    else return { error: 'Add a time: morning (08–12), afternoon (12–18), evening (17–23), all day, or a range like 14:00–17:00.' };
    if (startHour < 0 || endHour > 24 || startMinute > 59 || endMinute > 59 || startHour >= 24 || (endHour === 24 && endMinute) || endHour * 60 + endMinute <= startHour * 60 + startMinute) return { error: 'Use an end time after the start time, between 00:00 and 24:00.' };
    const start = atTime(date, startHour, startMinute), end = atTime(date, endHour, endMinute);
    if (end <= now) return { error: 'That time has already passed. Try tomorrow or a future day.' };
    return { type: 'block', event: { id: `personal-${start.getTime()}-${end.getTime()}`, title: label, start: start.toISOString(), end: end.toISOString(), source: 'personal' } };
  }
  if (/\b(finished|completed|done)\b/i.test(text)) {
    const query = text.replace(/\b(i|have|ve|just|finished|completed|done|early|with)\b/gi, ' ');
    const result = findTask(query, tasks);
    return result.error ? result : { type: 'complete', task: result.task };
  }
  if (/\b(move|reschedule)\b/i.test(text)) {
    if (!date) return { error: 'Include the new day, for example “Move maths sheet to Friday”.' };
    const query = text.replace(/\b(move|reschedule|to|next|this|today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, ' ');
    const result = findTask(query, tasks);
    if (result.error) return result;
    if (result.task.dueDate && atTime(date) >= new Date(result.task.dueDate)) return { error: 'That day is after the task’s deadline. Pick an earlier day.' };
    return { type: 'move', task: result.task, date };
  }
  return { error: 'I understand three kinds of requests: “I’m busy Wednesday afternoon”, “Finished maths sheet”, and “Move maths sheet to Friday”. You can also edit tasks and study hours directly.' };
}
