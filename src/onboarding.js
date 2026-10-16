// Older builds set setupCompletedAt when preferences were saved, before the
// remaining setup steps ran. Require an explicit final-step completion as well.
export function hasCompletedSetup(workspace) {
  return workspace?.setupComplete === true && Boolean(workspace.setupCompletedAt) && workspace.mode !== 'demo';
}

export function workspaceEntryPage(workspace) {
  return hasCompletedSetup(workspace) ? 'dashboard.html' : 'setup.html';
}
