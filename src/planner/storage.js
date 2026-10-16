import { emptyWorkspace } from '../demo.js';
import { migrateMoodleSnapshots } from '../course-content.js';
import { DEFAULT_SETTINGS } from '../scheduler.js';

export function normalizeWorkspace(input) {
  if (!input || !Array.isArray(input.tasks) || !Array.isArray(input.events)) return emptyWorkspace();
  const state = { ...emptyWorkspace(), ...input };
  state.settings = { ...DEFAULT_SETTINGS, ...input.settings };
  state.excludedCourseIds ||= [];
  state.personal ||= { commuteMinutes: 0, studyLocation: 'either' };
  state.weeklyActivities ||= [];
  migrateMoodleSnapshots(state);
  return state;
}
export function createWorkspaceStorage({ browser = globalThis.chrome, local = globalThis.localStorage } = {}) {
  const extension = Boolean(browser?.runtime?.id && browser.storage?.local);
  return {
    async load() {
      const input = extension ? (await browser.storage.local.get('workspace')).workspace : JSON.parse(local.getItem('studyspace-workspace-v1') || 'null');
      return normalizeWorkspace(input);
    },
    async save(state) {
      if (extension) await browser.storage.local.set({ workspace: state });
      else local.setItem('studyspace-workspace-v1', JSON.stringify(state));
    }
  };
}
