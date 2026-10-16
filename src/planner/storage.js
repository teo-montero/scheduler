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
    async getBackup() {
      return extension ? (await browser.storage.local.get('workspaceBackup')).workspaceBackup : JSON.parse(local.getItem('studyspace-workspace-backup-v1') || 'null');
    },
    async restart() {
      const input = extension ? (await browser.storage.local.get('workspace')).workspace : JSON.parse(local.getItem('studyspace-workspace-v1') || 'null');
      if (input && (input.tasks?.length || input.events?.length || input.courses?.length || input.blocked?.length || input.weeklyActivities?.length || input.setupComplete)) {
        const backup = { savedAt: new Date().toISOString(), workspace: input };
        if (extension) await browser.storage.local.set({ workspaceBackup: backup });
        else local.setItem('studyspace-workspace-backup-v1', JSON.stringify(backup));
      }
      // Only replace the workspace after its backup has been saved successfully.
      const fresh = emptyWorkspace();
      if (extension) await browser.storage.local.set({ workspace: fresh });
      else local.setItem('studyspace-workspace-v1', JSON.stringify(fresh));
      return fresh;
    },
    async restoreBackup() {
      const backup = await this.getBackup();
      if (!backup?.workspace) throw new Error('No workspace backup is available.');
      await this.save(backup.workspace);
      return backup.workspace;
    },
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
