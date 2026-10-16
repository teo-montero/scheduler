import { BUILD_ID } from '../protocol.js';
import { normalizeCourseState } from '../course-content.js';

export function createExtensionConnections(browser = globalThis.chrome) {
  async function request(message) {
    if (!browser?.runtime?.id) throw new Error('Live sync requires the loaded Chrome extension. Run npm run build, load dist in chrome://extensions, then open Study Space.');
    console.info('[Study Space][Connection] Starting', { action: message.type, ...(message.courseId ? { courseId: message.courseId } : {}) });
    let result;
    try { result = await browser.runtime.sendMessage({ ...message, buildId: BUILD_ID }); }
    catch { throw new Error('The extension connection was lost. Reload the extension, then refresh this page.'); }
    if (result?.buildId !== BUILD_ID) throw new Error('An older extension worker is running. Reload the extension and refresh this page.');
    if (!result.ok) { console.warn('[Study Space][Connection] Failed', { action: message.type }); throw new Error(result.error || 'The connection failed.'); }
    console.info('[Study Space][Connection] Complete', { action: message.type, ...(result.courses ? { courses: result.courses.length } : {}), ...(result.events ? { events: result.events.length } : {}), ...(result.state ? { sections: result.state.section?.length, activities: result.state.cm?.length } : {}) });
    return result;
  }
  return {
    timetable: { fetch: url => request({ type: 'SYNC_TIMETABLE', url }) },
    moodle: {
      open: () => request({ type: 'OPEN_MOODLE' }),
      listCourses: () => request({ type: 'SYNC_MOODLE' }),
      async readCourse(course) {
        const result = await request({ type: 'READ_MOODLE_COURSE', courseId: Number(course.id) });
        return normalizeCourseState(result.state, course);
      },
      readDeadlines: () => request({ type: 'SYNC_MOODLE_DEADLINES' })
    }
  };
}
