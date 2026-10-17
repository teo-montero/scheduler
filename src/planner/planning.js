import { addDays, atTime, dateKey, weekday, TIME_ZONE } from '../dates.js';
import { DEFAULT_SETTINGS } from '../scheduler.js';
import { hasSampleData, schedulableTasks } from '../modules.js';
import { plainText } from '../course-content.js';
import { nextStudyBlockMinutes, STUDY_BLOCK_MINUTES, STUDY_BLOCK_POLICY_VERSION } from '../study-blocks.js';

const minute = 60000;
const stamp = value => new Date(value).getTime();
export const overlaps = (a, b) => stamp(a.start) < stamp(b.end) && stamp(a.end) > stamp(b.start);
const iso = value => new Date(value).toISOString();
export function normalizePersonal(input = {}) {
  const commuteMinutes = input.commuteMinutes === null || input.commuteMinutes === '' ? 0 : input.commuteMinutes ?? 0;
  const studyLocation = input.studyLocation || 'either';
  if (!Number.isInteger(commuteMinutes) || commuteMinutes < 0 || commuteMinutes > 300 || !['home', 'campus', 'either'].includes(studyLocation)) throw new Error('Use a one-way commute from 0 to 300 minutes and a study location of home or campus.');
  return { commuteMinutes, studyLocation };
}
const clockMinutes = value => {
  if (!/^\d{2}:\d{2}$/.test(value || '')) throw new Error('Enter weekly activity times as HH:mm.');
  const [h, m] = value.split(':').map(Number);
  if (h > 23 || m > 59) throw new Error('Use a time between 00:00 and 23:59.');
  return h * 60 + m;
};
export function normalizeWeeklyActivities(input = []) {
  if (!Array.isArray(input) || input.length > 100) throw new Error('Use at most 100 weekly activities.');
  const seen = new Set();
  return input.map((item, index) => {
    const title = plainText(item.title).slice(0, 100), id = String(item.id || `weekly-${index + 1}`);
    const days = [...new Set(item.days || [])];
    const start = clockMinutes(item.startTime), end = clockMinutes(item.endTime);
    if (!title || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || start === end || seen.has(id)) throw new Error('Each weekly activity needs a name, repeat days and different start/end times.');
    seen.add(id);
    return { id, title, days, startTime: item.startTime, endTime: item.endTime };
  });
}
export function weeklyEvents(activities, now, horizonDays) {
  const events = [];
  for (const activity of normalizeWeeklyActivities(activities)) {
    for (let offset = -1; offset < horizonDays; offset++) {
      const day = addDays(dateKey(now), offset);
      if (!activity.days.includes(weekday(day))) continue;
      const start = clockMinutes(activity.startTime), end = clockMinutes(activity.endTime);
      events.push({ id: `recurring-${activity.id}-${day}`, activityId: activity.id, title: activity.title,
        start: atTime(day, 0, start).toISOString(), end: atTime(end <= start ? addDays(day, 1) : day, 0, end).toISOString(),
        source: 'personal', kind: 'weekly', priority: 2, recurring: true });
    }
  }
  return events.filter(event => stamp(event.end) > stamp(now));
}
function fixedEvent(event, kind, priority) {
  if (!event.id || !Number.isFinite(stamp(event.start)) || !(stamp(event.end) > stamp(event.start))) throw new Error('A calendar commitment has an invalid ID or time.');
  return { ...event, start: iso(event.start), end: iso(event.end), kind, priority, immutable: true };
}
export function buildPlanningContext(workspace, now = new Date()) {
  const settings = { ...DEFAULT_SETTINGS, ...workspace.settings, blockMinutes: STUDY_BLOCK_MINUTES, dailyStudyLimitMinutes: workspace.settings?.dailyStudyLimitMinutes ?? 360 };
  if (!Number.isInteger(settings.horizonDays) || settings.horizonDays < 1 || settings.horizonDays > 90 || settings.startHour < 0 || settings.endHour > 24 || settings.startHour >= settings.endHour || settings.blockMinutes < 15 || settings.blockMinutes > 120 || settings.breakMinutes < 0 || !Number.isInteger(settings.dailyStudyLimitMinutes) || settings.dailyStudyLimitMinutes < 15 || settings.dailyStudyLimitMinutes > 720) throw new Error('Invalid planning settings.');
  const personal = normalizePersonal(workspace.personal), end = atTime(addDays(dateKey(now), settings.horizonDays));
  const within = e => stamp(e.end) > stamp(now) && stamp(e.start) < stamp(end);
  const lectures = workspace.events.filter(within).map(e => fixedEvent(e, 'lecture', 3));
  const recurring = weeklyEvents(workspace.weeklyActivities || [], now, settings.horizonDays);
  const fixed = [...lectures, ...recurring, ...workspace.blocked.filter(within).map(e => fixedEvent(e, 'personal', 2))];
  const conflicts = [];
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) if (overlaps(fixed[i], fixed[j])) conflicts.push({ eventIds: [fixed[i].id, fixed[j].id], reason: 'Fixed commitments overlap; lectures keep their original times.' });
  const windows = [], commutes = [], locationBlocks = [];
  const tasks = schedulableTasks(workspace).filter(t => !t.completed).map(t => ({
    id: String(t.id), courseId: t.courseId || null, title: plainText(t.title).slice(0, 180), courseName: plainText(t.courseName).slice(0, 100),
    category: t.category || null, sourceTitle: plainText(t.sourceTitle).slice(0, 180), sectionName: plainText(t.sectionName).slice(0, 200),
    weekNumber: t.weekNumber ?? null, teachingWeekStart: t.teachingWeekEnd ? t.notBefore || null : null, teachingWeekEnd: t.teachingWeekEnd || null,
    // Moodle teaching-week labels are not release dates. Allow a sheet to be
    // prepared in the prior week while retaining its actual teaching context.
    estimatedMinutes: t.estimatedMinutes, dueDate: t.dueDate || null,
    notBefore: t.source === 'moodle-content' && t.category === 'exercise' && t.teachingWeekEnd && t.notBefore
      ? atTime(addDays(dateKey(t.notBefore), -7)).toISOString() : t.notBefore || null,
    preferredDate: workspace.preferences?.[t.id]?.date || null
  }));
  for (const task of tasks) if (!Number.isInteger(task.estimatedMinutes) || task.estimatedMinutes < 1 || task.estimatedMinutes > 6000 || task.dueDate && !Number.isFinite(stamp(task.dueDate)) || task.notBefore && !Number.isFinite(stamp(task.notBefore))) throw new Error(`Invalid workload or date for ${task.title}.`);
  for (let offset = 0; offset < settings.horizonDays; offset++) {
    const day = addDays(dateKey(now), offset), dayStart = atTime(day), dayEnd = atTime(addDays(day, 1));
    const campus = lectures.filter(e => !e.allDay && !/\b(online|remote|zoom|teams)\b/i.test(e.location || '') && stamp(e.start) < stamp(dayEnd) && stamp(e.end) > stamp(dayStart));
    const studyStart = stamp(atTime(day, settings.startHour)), studyEnd = stamp(atTime(day, settings.endHour));
    const studyDay = settings.weekends || ![0, 6].includes(weekday(day));
    const location = personal.studyLocation === 'either' ? campus.length ? 'campus' : 'home' : personal.studyLocation;
    const onCampus = campus.length || location === 'campus' && studyDay && tasks.length;
    let departure, returned;
    if (onCampus) {
      const arrival = Math.min(...campus.map(e => stamp(e.start)), location === 'campus' && studyDay && tasks.length ? Math.max(studyStart, stamp(atTime(day, 6)) + personal.commuteMinutes * minute) : Infinity);
      const leaving = Math.max(...campus.map(e => stamp(e.end)), location === 'campus' && studyDay && tasks.length ? Math.min(studyEnd, stamp(atTime(day, 23)) - personal.commuteMinutes * minute) : -Infinity);
      departure = arrival - personal.commuteMinutes * minute; returned = leaving + personal.commuteMinutes * minute;
      if (departure < stamp(atTime(day, 6)) || returned > stamp(atTime(day, 23))) conflicts.push({ eventIds: campus.map(e => e.id), reason: 'Campus travel falls outside 06:00–23:00. Review your commute or fixed commitments.' });
      if (personal.commuteMinutes) {
        commutes.push({ id: `commute-out-${day}`, title: 'Travel to campus', start: iso(departure), end: iso(arrival), source: 'personal', kind: 'commute', priority: 3, day, required: campus.length > 0 });
        commutes.push({ id: `commute-home-${day}`, title: 'Travel home', start: iso(leaving), end: iso(returned), source: 'personal', kind: 'commute', priority: 3, day, required: campus.length > 0 });
      }
      if (location === 'home') locationBlocks.push({ id: `campus-presence-${day}`, start: iso(departure), end: iso(returned), kind: 'location' });
    }
    if (!studyDay) continue;
    const addWindow = (start, finish) => {
      start = Math.max(start, stamp(now));
      if (finish > start) windows.push({ date: day, start: iso(start), end: iso(finish), location });
    };
    if (location === 'home' && onCampus) { addWindow(studyStart, Math.min(studyEnd, departure)); addWindow(Math.max(studyStart, returned), studyEnd); }
    else if (location === 'campus') addWindow(Math.max(studyStart, stamp(atTime(day, 6)) + personal.commuteMinutes * minute), Math.min(studyEnd, stamp(atTime(day, 23)) - personal.commuteMinutes * minute));
    else addWindow(studyStart, studyEnd);
  }
  for (const travel of commutes) for (const event of fixed) if (overlaps(travel, event)) conflicts.push({ eventIds: [travel.id, event.id], reason: 'Travel overlaps a fixed commitment; neither was silently moved.' });
  return { now: iso(now), horizonEnd: iso(end), timeZone: TIME_ZONE, settings, personal, tasks, fixedEvents: fixed, commutes, windows, busy: [...fixed, ...commutes, ...locationBlocks], conflicts };
}

// The model proposes only study sessions. Fixed/weekly/travel events cannot be edited by its output.
export function validateStudyPlan(context, output) {
  if (!output || !Array.isArray(output.sessions) || output.sessions.length > 4000) throw new Error('AI returned an invalid study plan.');
  const tasks = new Map(context.tasks.map(t => [t.id, t])), used = new Map(), daily = new Map();
  const sessions = [...output.sessions].sort((a, b) => stamp(a.start) - stamp(b.start)).map((session, index) => {
    const task = tasks.get(String(session.taskId)), start = stamp(session.start), end = stamp(session.end), duration = (end - start) / minute;
    const window = context.windows.find(w => w.location === session.location && start >= stamp(w.start) && end <= stamp(w.end));
    if (!task || !window || !Number.isInteger(duration) || duration < 1 || start < stamp(context.now) || end > stamp(context.horizonEnd) || task.dueDate && end > stamp(task.dueDate) || task.notBefore && start < stamp(task.notBefore) || task.preferredDate && dateKey(start) !== task.preferredDate || context.busy.some(e => overlaps(session, e))) throw new Error('AI scheduled work outside availability, after a deadline, or over a higher-priority event.');
    if (duration !== nextStudyBlockMinutes(task, task.estimatedMinutes - (used.get(task.id) || 0))) throw new Error('Study work must use a continuous block: 120 minutes per sheet, 150 minutes per lecture, and two-hour blocks for longer tasks. Do not split a task into short fragments.');
    used.set(task.id, (used.get(task.id) || 0) + duration);
    daily.set(window.date, (daily.get(window.date) || 0) + duration);
    if (duration < 15 && used.get(task.id) !== task.estimatedMinutes) throw new Error('AI created a study fragment shorter than 15 minutes.');
    if (used.get(task.id) > task.estimatedMinutes || daily.get(window.date) > context.settings.dailyStudyLimitMinutes) throw new Error('AI exceeded the task workload or daily study limit.');
    return { id: `study-${task.id}-${start}-${index}`, taskId: task.id, courseId: task.courseId, title: task.title, courseName: task.courseName, start: iso(start), end: iso(end), source: 'study', kind: 'study', priority: 1, location: session.location };
  }).sort((a, b) => stamp(a.start) - stamp(b.start));
  for (let i = 1; i < sessions.length; i++) if (stamp(sessions[i].start) < stamp(sessions[i - 1].end)) throw new Error('AI overlapped study sessions.');
  const unscheduled = context.tasks.flatMap(task => {
    if (task.notBefore && stamp(task.notBefore) >= stamp(context.horizonEnd) && !task.dueDate) return [];
    const minutes = task.estimatedMinutes - (used.get(task.id) || 0);
    return minutes > 0 ? [{ taskId: task.id, minutes, reason: 'Work remaining within the available study windows' }] : [];
  });
  const activeDays = new Set(sessions.filter(e => e.location === 'campus').map(e => dateKey(e.start)));
  const commutes = context.commutes.filter(e => e.required || activeDays.has(e.day));
  return { blocks: sessions, unscheduled, personalEvents: [...context.fixedEvents.filter(e => e.kind === 'weekly'), ...commutes], conflicts: context.conflicts };
}

// Used for immediate local edits and explicitly reported fallback when AI is unavailable.
export function localStudyPlan(context) {
  const sessions = [], daily = new Map();
  const round = value => Math.ceil(value / (5 * minute)) * 5 * minute;
  function findSlot(task, length, breakMinutes) {
    const padding = breakMinutes * minute;
    const previousTaskEnd = Math.max(0, ...sessions.filter(session => session.taskId === task.id).map(session => stamp(session.end)));
    const busy = [...context.busy, ...sessions.map(session => ({ start: iso(stamp(session.start) - padding), end: iso(stamp(session.end) + padding) }))];
    for (const window of context.windows) {
      if (task.preferredDate && task.preferredDate !== window.date || length > context.settings.dailyStudyLimitMinutes - (daily.get(window.date) || 0)) continue;
      let cursor = round(Math.max(stamp(window.start), stamp(context.now), previousTaskEnd, task.notBefore ? stamp(task.notBefore) : 0));
      const end = Math.min(stamp(window.end), stamp(context.horizonEnd), task.dueDate ? stamp(task.dueDate) : Infinity);
      for (const hit of busy.filter(event => stamp(event.end) > cursor && stamp(event.start) < end).sort((a, b) => stamp(a.start) - stamp(b.start))) {
        if (cursor + length * minute <= Math.min(stamp(hit.start), end)) return { window, start: cursor };
        cursor = round(Math.max(cursor, stamp(hit.end)));
        if (cursor + length * minute > end) break;
      }
      if (cursor + length * minute <= end) return { window, start: cursor };
    }
    return null;
  }
  const pending = [...context.tasks].sort((a, b) => (a.dueDate ? stamp(a.dueDate) : Infinity) - (b.dueDate ? stamp(b.dueDate) : Infinity) || a.id.localeCompare(b.id));
  for (const task of pending) {
    let remaining = task.estimatedMinutes;
    while (remaining > 0) {
      const length = nextStudyBlockMinutes(task, remaining);
      const slot = findSlot(task, length, context.settings.breakMinutes) || findSlot(task, length, 0);
      if (!slot) break;
      sessions.push({ taskId: task.id, start: iso(slot.start), end: iso(slot.start + length * minute), location: slot.window.location });
      daily.set(slot.window.date, (daily.get(slot.window.date) || 0) + length);
      remaining -= length;
    }
  }
  return { sessions, note: 'Local deadline-first allocation.' };
}
export async function generateWorkspacePlan(workspace, { ai, now = new Date(), useAI = true } = {}) {
  const context = buildPlanningContext(workspace, now);
  let output, engine = 'local', warning = '';
  if (useAI && hasSampleData(workspace)) {
    useAI = false; warning = 'Sample workspace: no AI request was made. Connect Moodle or your timetable before using AI with real data.';
    console.info('[Study Space][Planner] AI skipped: sample workspace');
  }
  if (useAI && context.tasks.length) {
    try { if (!ai?.plan) throw new Error('Configure an AI planning provider.'); output = await ai.plan(context); validateStudyPlan(context, output); engine = 'ai'; }
    catch (error) { output = undefined; warning = `AI planning unavailable: ${error.message} A local plan was generated instead.`; engine = 'local-fallback'; }
  }
  output ||= localStudyPlan(context);
  // Invalid AI output falls back atomically, never partially enters the calendar.
  let plan;
  try { plan = validateStudyPlan(context, output); }
  catch (error) { plan = validateStudyPlan(context, localStudyPlan(context)); engine = 'local-fallback'; warning = `AI plan rejected: ${error.message} A local plan was generated instead.`; }
  return { ...workspace, ...plan, planning: { blockPolicyVersion: STUDY_BLOCK_POLICY_VERSION, engine, warning, conflicts: plan.conflicts, generatedAt: iso(now), note: plainText(output.note).slice(0, 500), provider: engine === 'ai' ? output.provider || 'AI' : null, model: engine === 'ai' ? output.model || null : null, usage: engine === 'ai' ? output.usage || null : null } };
}
