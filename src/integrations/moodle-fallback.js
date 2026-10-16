import coursesResponse from '../../fixtures/moodle/courses.json' with { type: 'json' };
import course56435 from '../../fixtures/moodle/course-56435.json' with { type: 'json' };
import course58243 from '../../fixtures/moodle/course-58243.json' with { type: 'json' };

const states = { 56435: course56435, 58243: course58243 };

// Recorded user-supplied responses, used only after the browser request fails.
export function getMoodleFallback(options, error) {
  const isCourse = options.mode === 'course-content';
  if (!isCourse && !['courses', 'exact-courses-call'].includes(options.mode)) return null;
  const recorded = isCourse ? states[options.courseId] : coursesResponse;
  if (!recorded) return null; // Never substitute a different course or invent content.
  const response = structuredClone(recorded);
  let data = response[0].data;
  if (typeof data === 'string') data = JSON.parse(data);
  const warning = `MOCK FALLBACK: live Moodle request failed (${error.message}). Using the supplied ${isCourse ? `course ${options.courseId}` : '11-course list'} response.`;
  const result = {
    ok: true, dataSource: 'mock', fallbackReason: error.message, warnings: [warning],
    diagnostics: { dataSource: 'mock', liveFailure: error.diagnostics || null },
    rawResponse: { status: null, source: 'mock', body: JSON.stringify(response) },
    ...(isCourse ? { state: data } : { courses: data.courses.map(course => ({ id: course.id, name: course.fullname, shortname: course.shortname })) })
  };
  console.warn('[Study Space][Moodle] MOCK FALLBACK', { warning, response: result });
  return result;
}
