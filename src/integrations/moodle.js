import { readMoodleInPage } from '../moodle.js';
import { fetchExactMoodleCourses } from './moodle-direct.js';
import { getMoodleFallback } from './moodle-fallback.js';
import { normalizeCourseState } from '../course-content.js';

// Browser adapter only. The Moodle page owns its credentials; no session key is returned.
export function createMoodleConnection(browser = globalThis.chrome) {
  async function readLive(options) {
    let localOverride;
    try {
      const response = await fetch(browser.runtime.getURL('moodle-local.json'), { cache: 'no-store' });
      if (response.ok) { const config = await response.json(); if (config.enabled && typeof config.sesskey === 'string') localOverride = config.sesskey; }
    } catch { /* No local debug override configured. */ }
    console.info('[Study Space][Moodle] Session mode', { localOverrideEnabled: Boolean(localOverride), overrideLength: localOverride?.length || 0 });
    const tabs = await browser.tabs.query({ url: 'https://moodle.ucl.ac.uk/*' });
    if (!tabs.length) throw new Error('Open Moodle in another tab and sign in, then try again.');
    const page = tab => { try { const url = new URL(tab.url); return url.origin + url.pathname; } catch { return 'Moodle tab'; } };
    const rank = tab => (/\/(?:my|course)(?:\/|$)/.test(new URL(tab.url).pathname) ? 100 : 0) + (tab.active ? 10 : 0) + (tab.status === 'complete' ? 1 : 0);
    console.info('[Study Space][Moodle] Available tabs', tabs.map(tab => ({ tabId: tab.id, page: page(tab), status: tab.status, discarded: tab.discarded })));
    let lastError; const failures = [];
    for (const tab of tabs.sort((a, b) => rank(b) - rank(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0))) {
      console.info('[Study Space][Moodle] Reading tab', { tabId: tab.id, page: page(tab), mode: options.mode });
      try {
        const [{ result }] = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: ['exact-courses-call', 'courses', 'course-content'].includes(options.mode) ? fetchExactMoodleCourses : readMoodleInPage, args: [{ ...options, ...(localOverride ? { sesskeyOverride: localOverride } : {}) }] });
        if (result?.ok) {
          console.info('[Study Space][Moodle] Session and request diagnostics', result.diagnostics);
          return { ...result, diagnostics: { ...result.diagnostics, tabId: tab.id, previousFailures: failures } };
        }
        if (result?.error) lastError = result.error;
        failures.push({ tabId: tab.id, page: page(tab), error: result?.error || 'No script result', ...result?.diagnostics });
        console.warn('[Study Space][Moodle] Tab read failed', failures[failures.length - 1]);
        // A real HTTP response proves the request ran. Show it without repeating
        // the diagnostic POST in every other open Moodle tab.
        if (options.mode === 'exact-courses-call' && result?.diagnostics?.response) break;
      } catch (error) {
        lastError = 'Chrome could not run the Moodle reader. Allow Moodle site access for the extension, refresh Moodle and try again.';
        failures.push({ tabId: tab.id, page: page(tab), error: String(error.message || error).replace(/(https?:\/\/[^?#\s]+)[?#][^\s]*/g, '$1[redacted]') });
        console.warn('[Study Space][Moodle] Injection failed', failures[failures.length - 1]);
      }
    }
    throw Object.assign(new Error(lastError || 'Could not read Moodle. Refresh your signed-in Moodle tab and try again.'), { diagnostics: { tabs: failures } });
  }
  async function read(options) {
    try {
      const result = await readLive(options);
      if (options.mode === 'courses') {
        let page = result;
        for (let offset = 24; page.courses.length === 24 && page.nextOffset !== -1; offset += 24) {
          if (offset >= 1000) { result.warnings = ['The course limit was reached; some modules may be missing.']; break; }
          page = await readLive({ ...options, offset });
          result.courses.push(...page.courses);
        }
      }
      return result;
    }
    catch (error) {
      const fallback = getMoodleFallback(options, error);
      if (fallback) return fallback;
      throw error;
    }
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
      return { ...normalizeCourseState(result.state, course), dataSource: result.dataSource || 'live', fallbackReason: result.fallbackReason || null };
    }
  };
}
