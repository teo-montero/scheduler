import { readMoodleInPage } from '../moodle.js';
import { normalizeCourseState } from '../course-content.js';

// Browser adapter only. The Moodle page owns its credentials; no session key is returned.
export function createMoodleConnection(browser = globalThis.chrome) {
  async function read(options) {
    const tabs = await browser.tabs.query({ url: 'https://moodle.ucl.ac.uk/*' });
    if (!tabs.length) throw new Error('Open Moodle in another tab and sign in, then try again.');
    let lastError;
    for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) {
      try {
        const [{ result }] = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: readMoodleInPage, args: [options] });
        if (result?.ok) return result;
        if (result?.error) lastError = result.error;
        console.warn('[Study Space][Moodle] Tab read failed', { tabId: tab.id, reason: result?.error || 'No script result' });
      } catch { lastError = 'Chrome could not run the Moodle reader. Allow Moodle site access for the extension, refresh Moodle and try again.'; console.warn('[Study Space][Moodle] Injection failed', { tabId: tab.id }); }
    }
    throw new Error(lastError || 'Could not read Moodle. Refresh your signed-in Moodle tab and try again.');
  }
  return {
    read,
    async open() {
      const [existing] = await browser.tabs.query({ url: 'https://moodle.ucl.ac.uk/*' });
      const tab = existing ? await browser.tabs.update(existing.id, { active: true }) : await browser.tabs.create({ url: 'https://moodle.ucl.ac.uk/my/' });
      return { tabId: tab.id };
    },
    listCourses: () => read({ mode: 'courses' }),
    readDeadlines: courses => read({ mode: 'deadlines', courses }),
    async readCourse(course) {
      const id = Number(course?.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Choose a valid Moodle module.');
      const result = await read({ mode: 'course-content', courseId: id });
      return normalizeCourseState(result.state, course);
    }
  };
}
