import { atTime } from './dates.js';

export const ANALYSIS_CACHE_VERSION = 'study-tasks-gemini-4-week-ahead';
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function plainText(value) {
  return String(value ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      if (entity.startsWith('#')) { const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }
      return ENTITIES[entity.toLowerCase()] || '';
    }).replace(/\s+/g, ' ').trim();
}
export function moodleActivityId(value) {
  try {
    const url = new URL(value, 'https://moodle.ucl.ac.uk');
    const id = url.searchParams.get('id');
    return url.protocol === 'https:' && url.hostname === 'moodle.ucl.ac.uk' && /^\/mod\/[a-z0-9_]+\/view\.php$/i.test(url.pathname) && /^\d+$/.test(id || '') ? String(id) : null;
  } catch { return null; }
}
function resourceUrl(value, courseId, activityId) {
  try {
    const url = new URL(value || `/course/view.php?id=${courseId}#module-${activityId}`, 'https://moodle.ucl.ac.uk');
    if (url.protocol !== 'https:' || url.hostname !== 'moodle.ucl.ac.uk' || url.username || url.password) return null;
    // Do not persist session-related query parameters returned in provider links.
    for (const key of [...url.searchParams.keys()]) if (/sesskey|token|password|auth/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}
export function parseCourseState(input) {
  let state = input;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof state === 'string') { state = JSON.parse(state); continue; }
    if (Array.isArray(state)) {
      if (!state[0] || state[0].error) throw new Error('Moodle did not return course content.');
      state = state[0].data; continue;
    }
    if (state && typeof state === 'object' && !Array.isArray(state.cm) && 'data' in state) { state = state.data; continue; }
    break;
  }
  if (!state || !state.course || !Array.isArray(state.section) || !Array.isArray(state.cm)) throw new Error('The Moodle course response is missing its course, sections or activities.');
  return state;
}
function teachingWindow(title) {
  const week = /\bweek\s+(\d+)\b/i.exec(title);
  const match = /\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})\b/i.exec(title);
  if (!match) return { weekNumber: week ? Number(week[1]) : null, notBefore: null, teachingWeekEnd: null };
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[3].slice(0, 3).toLowerCase()) + 1;
  const start = Number(match[1]), end = Number(match[2]), year = Number(match[4]);
  if (!month || start > end || start < 1 || end > new Date(Date.UTC(year, month, 0)).getUTCDate()) return { weekNumber: week ? Number(week[1]) : null, notBefore: null, teachingWeekEnd: null };
  const key = day => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { weekNumber: week ? Number(week[1]) : null, notBefore: atTime(key(start)).toISOString(), teachingWeekEnd: atTime(key(end), 23, 59).toISOString() };
}
export const TASK_CATEGORIES = ['lecture', 'exercise', 'notebook', 'assignment', 'quiz', 'reading', 'practical', 'preparation', 'setup', 'group', 'recording', 'reference', 'survey', 'other'];
export function normalizeCourseState(input, course = {}) {
  const state = parseCourseState(input);
  const courseId = Number(course.id || state.course.id);
  if (!Number.isSafeInteger(courseId) || courseId <= 0 || String(state.course.id) !== String(courseId)) throw new Error('The course content did not match the requested module.');
  const sections = state.section.filter(section => section.visible !== false).map(section => ({ id: String(section.id), title: plainText(section.title), number: section.number ?? section.section ?? null, ...teachingWindow(plainText(section.title)) }));
  const sectionsById = new Map(sections.map(section => [section.id, section]));
  const activities = [], seen = new Set();
  for (const item of state.cm) {
    if (item.visible === false || item.uservisible === false || !/^\d+$/.test(String(item.id)) || seen.has(String(item.id)) || !sectionsById.has(String(item.sectionid))) continue;
    seen.add(String(item.id));
    const title = plainText(item.name), module = String(item.module || '');
    if (!title || !/^[a-z0-9_]+$/i.test(module)) continue;
    const completed = typeof item.isoverallcomplete === 'boolean' ? item.isoverallcomplete : item.completionstate === 1;
    activities.push({ id: String(item.id), name: title, module, sectionId: String(item.sectionid),
      url: resourceUrl(item.url, courseId, item.id),
      description: plainText(item.description || '').slice(0, 10000),
      completionStatus: completed ? 'complete' : item.isoverallcomplete === false || item.completionstate === 0 ? 'incomplete' : 'unknown'
    });
  }
  return { course: { id: courseId, name: plainText(course.name) || `Course ${courseId}`, shortname: plainText(course.shortname) || '' }, sections, activities };
}
export async function courseFingerprint(state) {
  // Completion changes update progress locally without paying for another analysis.
  const content = { course: state.course, sections: state.sections, activities: state.activities.map(({ completionStatus, ...activity }) => activity) };
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function validateAnalysis(state, input) {
  if (!input || !Array.isArray(input.tasks) || input.tasks.length > state.activities.length) throw new Error('AI returned an invalid task list.');
  const activities = new Map(state.activities.map(item => [item.id, item]));
  const seen = new Set();
  return { tasks: input.tasks.map(task => {
    const activityId = String(task.activityId || ''), activity = activities.get(activityId);
    const title = plainText(task.title).slice(0, 180), category = String(task.category || '').toLowerCase();
    const minutes = task.estimatedMinutes;
    if (!activity || seen.has(activityId) || !title || !TASK_CATEGORIES.includes(category) || typeof task.optional !== 'boolean' || !['low', 'medium', 'high'].includes(String(task.confidence).toLowerCase()) || !(minutes === null || Number.isInteger(minutes) && minutes >= 15 && minutes <= 6000) || typeof task.reason !== 'string') throw new Error('AI returned a task with an unknown resource, duplicate ID, or invalid estimate.');
    if (!activity.url) throw new Error('AI selected a resource without a supported Moodle link.');
    seen.add(activityId);
    return { activityId, title, category, estimatedMinutes: minutes, optional: task.optional, confidence: task.confidence.toLowerCase(), reason: plainText(task.reason).slice(0, 500) };
  }) };
}
export function tasksFromAnalysis(state, analysis, metadata = {}) {
  const validated = validateAnalysis(state, analysis);
  const activities = new Map(state.activities.map(item => [item.id, item]));
  const sections = new Map(state.sections.map(section => [section.id, section]));
  return validated.tasks.map(suggestion => {
    const item = activities.get(suggestion.activityId), section = sections.get(item.sectionId);
    const nonExaminable = /non[ -]?examinable/i.test(item.name);
    const optional = suggestion.optional || nonExaminable;
    return { id: `moodle-activity-${state.course.id}-${item.id}`, activityId: item.id,
      courseId: state.course.id, courseName: state.course.shortname || state.course.name,
      title: suggestion.title, type: ['assign', 'quiz'].includes(item.module) ? item.module === 'assign' ? 'assignment' : 'quiz' : 'resource',
      category: suggestion.category, url: item.url, sourceTitle: item.name, sectionName: section?.title || '',
      dueDate: null, estimatedMinutes: suggestion.estimatedMinutes, needsEstimate: suggestion.estimatedMinutes === null,
      estimateSource: 'ai', estimateProvider: metadata.provider || 'AI', estimateModel: metadata.model || null, estimateConfidence: suggestion.confidence, estimateReason: suggestion.reason,
      completed: item.completionStatus === 'complete', moodleCompletionStatus: item.completionStatus,
      optional, nonExaminable, includeInPlan: !optional && suggestion.estimatedMinutes !== null, source: 'moodle-content',
      notBefore: section?.notBefore || null, teachingWeekEnd: section?.teachingWeekEnd || null, weekNumber: section?.weekNumber || null
    };
  });
}
const activityKey = task => {
  const id = task.activityId || moodleActivityId(task.url);
  return id ? `${task.courseId}:${id}` : null;
};
// Rebuild provider tasks from snapshots; user edits remain separate from imports.
export function mergeMoodleTasks(existing, calendarTasks = [], courseContent = {}) {
  const previousById = new Map(existing.map(task => [task.id, task]));
  const previousByActivity = new Map(existing.filter(task => String(task.source).startsWith('moodle')).map(task => [activityKey(task), task]).filter(([key]) => key));
  const calendarByActivity = new Map();
  for (const task of calendarTasks) {
    const key = activityKey(task);
    if (key) { const candidates = calendarByActivity.get(key) || []; candidates.push(task); calendarByActivity.set(key, candidates); }
  }
  const consumed = new Set(), imported = [];
  for (const snapshot of Object.values(courseContent)) {
    for (const content of snapshot.analysis?.tasks || []) {
      const candidates = calendarByActivity.get(activityKey(content)) || [];
      candidates.forEach(task => consumed.add(task.id));
      const deadline = candidates.filter(task => task.dueDate).sort((a, b) => Number(/due|close/i.test(b.eventType || '')) - Number(/due|close/i.test(a.eventType || '')) || new Date(a.dueDate) - new Date(b.dueDate))[0];
      imported.push({ ...content, dueDate: deadline?.dueDate || null, calendarEventIds: candidates.map(task => task.id) });
    }
  }
  imported.push(...calendarTasks.filter(task => !consumed.has(task.id)));
  const result = imported.map(task => {
    const previous = previousById.get(task.id) || previousByActivity.get(activityKey(task));
    if (!previous) return task;
    const legacyEstimateEdit = previous.source === 'moodle' && previous.estimatedMinutes !== (previous.type === 'quiz' ? 60 : 120);
    const estimateEdited = Boolean(previous.estimateEdited || legacyEstimateEdit);
    const completionOverride = previous.completionOverride ?? (previous.source === 'moodle' && previous.completed ? true : undefined);
    return { ...task,
      ...(estimateEdited ? { estimatedMinutes: previous.estimatedMinutes, needsEstimate: false, estimateEdited: true, estimateSource: 'user' } : {}),
      ...(completionOverride !== undefined ? { completed: completionOverride, completionOverride } : {}),
      ...(previous.planInclusionEdited ? { includeInPlan: previous.includeInPlan, planInclusionEdited: true } : estimateEdited && task.needsEstimate ? { includeInPlan: true } : {})
    };
  });
  const ids = new Set(result.map(task => task.id));
  const keys = new Set(result.map(activityKey).filter(Boolean));
  // Keep locally completed history when an activity disappears from a successful snapshot.
  const history = existing.filter(task => String(task.source).startsWith('moodle') && task.completed && !ids.has(task.id) && (!activityKey(task) || !keys.has(activityKey(task))));
  return [...existing.filter(task => !String(task.source).startsWith('moodle')), ...history, ...result];
}
export function migrateMoodleSnapshots(workspace) {
  workspace.courseContent ||= {};
  workspace.moodleCalendarTasks ??= workspace.tasks.filter(task => task.source === 'moodle');
}
export function reconcileMoodleWorkspace(workspace) {
  migrateMoodleSnapshots(workspace);
  const previous = new Map(workspace.tasks.map(task => [activityKey(task), task]).filter(([key]) => key));
  const tasks = mergeMoodleTasks(workspace.tasks, workspace.moodleCalendarTasks, workspace.courseContent);
  workspace.preferences ||= {};
  for (const task of tasks) {
    const old = previous.get(activityKey(task));
    if (old && old.id !== task.id && workspace.preferences[old.id] && !workspace.preferences[task.id]) workspace.preferences[task.id] = workspace.preferences[old.id];
  }
  workspace.tasks = tasks;
}
