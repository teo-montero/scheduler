import { emptyWorkspace } from '../demo.js';
import { ANALYSIS_CACHE_VERSION, courseFingerprint, reconcileMoodleWorkspace, tasksFromAnalysis } from '../course-content.js';
import { hasSampleData, isCourseIncluded, consideredTasks } from '../modules.js';
import { parseTimetable, validateCalendarUrl } from '../ical.js';
import { normalizeWorkspace } from './storage.js';
import { generateWorkspacePlan, normalizePersonal, normalizeWeeklyActivities } from './planning.js';
import { addDays, atTime, dateKey } from '../dates.js';
import { parseCommand } from '../commands.js';
import { applyChatActions } from './chat.js';

// UI-independent orchestration. Providers, persistence and clock can be replaced in tests.
export function createPlannerService({ storage, connections, ai, now = () => new Date() }) {
  let queue = Promise.resolve();
  const listeners = new Set();
  const emit = event => { for (const listener of listeners) { try { listener(structuredClone(event)); } catch { /* A view cannot interrupt a save. */ } } };
  const run = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const load = async () => normalizeWorkspace(await storage.load());
  const save = async state => { await storage.save(state); emit({ type: 'saved', workspace: state }); return state; };
  const live = state => state.mode === 'demo' ? emptyWorkspace(state.settings) : state;
  const replan = (state, useAI = false) => generateWorkspacePlan(state, { ai, now: now(), useAI });
  const progress = (stage, course, index, total) => emit({ type: 'progress', stage, course, index, total });
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getWorkspace: () => run(load),
    saveWorkspace: state => run(() => save(normalizeWorkspace(state))),
    openMoodle: () => connections.moodle.open(),
    connectTimetable: url => run(async () => {
      const canonical = validateCalendarUrl(url);
      const result = await connections.timetable.fetch(canonical);
      const state = live(await load());
      state.events = result.events; state.calendarUrl = canonical; state.calendarSyncedAt = now().toISOString();
      return { workspace: await save(await replan(state)), meta: result.meta };
    }),
    importTimetable: text => run(async () => {
      const events = parseTimetable(text, { from: atTime(addDays(dateKey(now()), -7)) });
      const state = live(await load()); state.events = events; state.calendarUrl = ''; state.calendarSyncedAt = now().toISOString();
      return save(await replan(state));
    }),
    loadCourses: () => run(async () => {
      const result = await connections.moodle.listCourses();
      const state = live(await load()); state.courses = result.courses; state.moodleSyncedAt = now().toISOString();
      state.moodleDataSource = result.dataSource || 'live'; state.moodleFallbackReason = result.fallbackReason || null;
      return { workspace: await save(state), warnings: result.warnings || [] };
    }),
    selectCourses: ids => run(async () => {
      const state = await load(), selected = new Set(ids.map(String));
      if ([...selected].some(id => !state.courses.some(c => String(c.id) === id))) throw new Error('Select courses from the enrolled-module list.');
      state.excludedCourseIds = state.courses.filter(c => !selected.has(String(c.id))).map(c => String(c.id));
      return save(await replan(state));
    }),
    fetchSelectedCourses: () => run(async () => {
      const state = await load(), courses = state.courses.filter(c => isCourseIncluded(state, c.id)), errors = [], warnings = [];
      for (const [index, course] of courses.entries()) {
        progress('fetching', course, index + 1, courses.length);
        try {
          const content = await connections.moodle.readCourse(course), fingerprint = await courseFingerprint(content);
          state.courseContent[course.id] = { ...state.courseContent[course.id], state: content, fingerprint, dataSource: content.dataSource || 'live', fallbackReason: content.fallbackReason || null, fetchedAt: now().toISOString() };
          if (content.dataSource === 'mock') warnings.push(`MOCK FALLBACK: ${course.shortname || course.name} uses the supplied course response because its live request failed (${content.fallbackReason}).`);
          await save(state); // Durable before any AI request.
        } catch (error) { errors.push({ courseId: course.id, message: error.message }); }
      }
      return { workspace: state, errors, warnings };
    }),
    analyseSelectedCourses: ({ force = false } = {}) => run(async () => {
      let state = await load(); const errors = [];
      if (hasSampleData(state)) return { workspace: state, errors: [{ courseId: null, message: 'Sample workspace: connect Moodle before analysing courses. No AI request was made.' }] };
      const courses = state.courses.filter(c => isCourseIncluded(state, c.id));
      for (const [index, course] of courses.entries()) {
        const snapshot = state.courseContent[course.id];
        if (!snapshot?.state) { errors.push({ courseId: course.id, message: 'Fetch this course first.' }); continue; }
        progress('analysing', course, index + 1, courses.length);
        try {
          if (force || snapshot.analysis?.cacheVersion !== ANALYSIS_CACHE_VERSION || snapshot.analysis?.fingerprint !== snapshot.fingerprint) {
            const result = await ai.analyse(snapshot.state);
            const tasks = tasksFromAnalysis(snapshot.state, result.suggestions, result);
            snapshot.analysis = { ...result, tasks, fingerprint: snapshot.fingerprint, cacheVersion: ANALYSIS_CACHE_VERSION, analysedAt: now().toISOString() };
          } else snapshot.analysis.tasks = tasksFromAnalysis(snapshot.state, snapshot.analysis.suggestions, snapshot.analysis);
          reconcileMoodleWorkspace(state); state = await save(await replan(state));
        } catch (error) { errors.push({ courseId: course.id, message: error.message }); }
      }
      return { workspace: state, errors };
    }),
    refreshDeadlines: () => run(async () => {
      const result = await connections.moodle.readDeadlines();
      let state = await load();
      if (result.tasks !== null) { state.moodleCalendarTasks = result.tasks; reconcileMoodleWorkspace(state); state = await save(await replan(state)); }
      return { workspace: state, warnings: result.warnings || [] };
    }),
    savePersonal: ({ personal, weeklyActivities } = {}) => run(async () => {
      const state = live(await load());
      if (personal) state.personal = normalizePersonal(personal);
      if (weeklyActivities) state.weeklyActivities = normalizeWeeklyActivities(weeklyActivities);
      return save(await replan(state));
    }),
    createPlan: ({ useAI = true } = {}) => run(async () => save(await replan(await load(), useAI))),
    chat: message => run(async () => {
      if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw new Error('Enter a request of at most 2,000 characters.');
      const state = await load();
      const tasks = consideredTasks(state);
      let command = parseCommand(message, tasks, now()), response;
      // Fast local commands remain available without a provider. Free-form requests use the AI provider.
      if (command.error) {
        if (hasSampleData(state)) return { workspace: state, reply: 'This is sample data. Connect Moodle or your timetable before using AI chat. No AI request was made.', applied: false };
        response = await ai.chat({ message, now: now().toISOString(), tasks: tasks.map(({ id, title, courseName }) => ({ id, title, courseName })) });
        if (response.clarification) return { workspace: state, reply: response.clarification, applied: false };
        const changed = applyChatActions(state, response.actions, now());
        const planned = await replan(changed, true);
        planned.messages.push({ role: 'user', text: message }, { role: 'assistant', text: response.message || 'Your plan has been updated.' });
        return { workspace: await save(planned), reply: response.message, applied: true };
      }
      if (command.type === 'block') { state.blocked.push(command.event); response = 'That time is now protected. Your study tasks have been rescheduled.'; }
      if (command.type === 'complete') { command.task.completed = true; command.task.completionOverride = true; response = `${command.task.title} is checked off.`; }
      if (command.type === 'move') { state.preferences[command.task.id] = { date: command.date }; response = `${command.task.title} is now planned for ${command.date}.`; }
      const planned = await replan(state, true);
      planned.messages.push({ role: 'user', text: message }, { role: 'assistant', text: response });
      return { workspace: await save(planned), reply: response, applied: true };
    })
  };
}
