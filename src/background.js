import { fetchAssistant } from './assistant-client.js';
import { normalizeCourseState } from './course-content.js';
import { BUILD_ID, TIMETABLE_ORIGINS } from './protocol.js';
import { createMoodleConnection } from './integrations/moodle.js';
import { fetchUclTimetable } from './integrations/timetable.js';
import { workspaceEntryPage } from './onboarding.js';
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
chrome.action.onClicked.addListener(async () => {
  const { workspace } = await chrome.storage.local.get('workspace');
  const url = chrome.runtime.getURL(workspaceEntryPage(workspace));
  const tabs = await chrome.tabs.query({ url: ['dashboard.html', 'setup.html'].map(page => `${chrome.runtime.getURL(page)}*`) });
  const existing = tabs.find(tab => tab.url?.split(/[?#]/)[0] === url) || tabs[0];
  if (existing) { await chrome.tabs.update(existing.id, { active: true, ...(existing.url?.split(/[?#]/)[0] === url ? {} : { url }) }); await chrome.windows.update(existing.windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
});
const moodle = createMoodleConnection();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !['dashboard.html', 'setup.html'].some(page => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(page))) return false;
  const handle = async () => {
    if (message.buildId && message.buildId !== BUILD_ID) throw new Error('Study Space was updated. Refresh this planner tab, then try again.');
    if (message.type === 'ASSISTANT_CHAT') return fetchAssistant(message.payload);
    if (message.type === 'OPEN_MOODLE') return { ok: true, ...await moodle.open() };
    if (message.type === 'READ_MOODLE_COURSE') {
      const courseId = Number(message.courseId);
      if (!Number.isSafeInteger(courseId) || courseId <= 0) throw new Error('Choose a valid Moodle module.');
      return moodle.read({ mode: 'course-content', courseId });
    }
    if (message.type === 'SYNC_MOODLE') return moodle.read({ mode: 'courses' });
    if (message.type === 'MOODLE_EXACT_COURSES_CALL') return moodle.read({ mode: 'exact-courses-call' });
    if (message.type === 'SYNC_MOODLE_DEADLINES') {
      const courses = (await chrome.storage.local.get('workspace')).workspace?.courses;
      if (!courses?.length) throw new Error('Sync Moodle modules first.');
      return moodle.read({ mode: 'deadlines', courses });
    }
    if (message.type === 'FETCH_COURSE_STATE') {
      const workspace = (await chrome.storage.local.get('workspace')).workspace;
      const course = workspace?.courses?.find(item => Number(item.id) === Number(message.courseId));
      if (!course || !Number.isSafeInteger(Number(message.courseId)) || (workspace.excludedCourseIds || []).some(id => String(id) === String(course.id))) throw new Error('Select an enrolled module before fetching its course content.');
      const result = await moodle.read({ mode: 'course-content', courseId: Number(course.id) });
      return { ok: true, state: normalizeCourseState(result.state, course) };
    }
    if (message.type === 'SYNC_TIMETABLE') {
      const allowed = await chrome.permissions.contains({ origins: TIMETABLE_ORIGINS });
      if (!allowed) throw new Error('Chrome has blocked timetable access for this extension. Click Sync timetable and allow access to the two UCL timetable sites.');
      return { ok: true, ...await fetchUclTimetable(message.url) };
    }
    throw new Error('Unknown extension request.');
  };
  handle().then(result => reply({ ...result, buildId: BUILD_ID })).catch(error => reply({ ok: false, error: error.message, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}), buildId: BUILD_ID }));
  return true;
});
