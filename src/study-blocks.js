export const STUDY_BLOCK_MINUTES = 120;
export const STUDY_BLOCK_POLICY_VERSION = 'continuous-blocks-1';

// A normal sheet (120m) or lecture-content task (150m) stays in one event.
// Longer coursework can span several substantial blocks, with a final remainder.
export function nextStudyBlockMinutes(task, remaining = task.estimatedMinutes) {
  return task.estimatedMinutes <= 150 ? remaining : Math.min(remaining, STUDY_BLOCK_MINUTES);
}
