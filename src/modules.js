// Keep imported data intact; selection controls which module work is considered.
export function isCourseIncluded(workspace, courseId) {
  if (!courseId || String(courseId) === '0') return true;
  return !(workspace.excludedCourseIds || []).some(id => String(id) === String(courseId));
}
export function consideredTasks(workspace) {
  return workspace.tasks.filter(task => isCourseIncluded(workspace, task.courseId));
}
export function schedulableTasks(workspace) {
  return consideredTasks(workspace).filter(task => task.includeInPlan !== false && !task.needsEstimate);
}
