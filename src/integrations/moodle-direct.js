// Injected into the signed-in Moodle tab. This is deliberately one fetch,
// with the same URL, method and JSON body as the supplied curl commands.
export async function fetchExactMoodleCourses(options = {}) {
  const sesskey = options.sesskeyOverride || window.M?.cfg?.sesskey || '';
  const isCourse = options.mode === 'course-content';
  const methodname = isCourse ? 'core_courseformat_get_state' : 'core_course_get_enrolled_courses_by_timeline_classification';
  const url = new URL('/lib/ajax/service.php', window.location.origin);
  url.search = new URLSearchParams({ sesskey, info: methodname }).toString();
  const body = [{ index: 0, methodname, args: isCourse ? { courseid: options.courseId } : {
    offset: options.offset || 0, limit: 24, classification: 'all', sort: 'fullname',
    customfieldname: '', customfieldvalue: '',
    requiredfields: ['id', 'fullname', 'shortname', 'showcoursecategory', 'showshortname', 'visible', 'enddate']
  } }];
  const headers = {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'content-type': 'application/json',
    'x-requested-with': 'XMLHttpRequest'
  };
  const redact = value => typeof value === 'string' && sesskey ? value.replaceAll(sesskey, '[redacted]') : value;
  const diagnostics = {
    page: window.location.origin + window.location.pathname,
    sessionKeyFound: Boolean(sesskey), sessionKeyLength: sesskey.length,
    sessionKeySource: options.sesskeyOverride ? 'local debug override' : 'window.M.cfg.sesskey',
    transport: 'one direct same-origin fetch', requests: []
  };
  try {
    if (isCourse && (!Number.isSafeInteger(options.courseId) || options.courseId <= 0)) throw new Error('Choose a valid Moodle module.');
    console.info('[Study Space][Moodle direct] POST request', {
      url: redact(url.href), method: 'POST', credentials: 'include', headers, body
    });
    // Cookies, Origin, Referer and sec-* headers are supplied by Chrome itself.
    // No RequireJS, Moodle core/ajax, pagination or session checks before this call.
    const response = await fetch(url.href, {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    const text = redact(await response.text());
    const rawResponse = { status: response.status, url: redact(response.url), headers: Object.fromEntries(response.headers), body: text };
    diagnostics.requests.push({ method: methodname, httpStatus: response.status });
    diagnostics.response = rawResponse;
    console.info('[Study Space][Moodle direct] Raw response', rawResponse);
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error(`HTTP ${response.status}: Moodle returned non-JSON content. The full response is shown below and logged in the Moodle tab.`); }
    console.info('[Study Space][Moodle direct] JSON response', parsed);
    if (!response.ok) throw new Error(`Moodle returned HTTP ${response.status}.`);
    if (!Array.isArray(parsed) || parsed[0]?.error) throw new Error(parsed[0]?.exception?.message || parsed?.exception?.message || parsed?.message || 'Moodle returned an API error. See the raw response.');
    if (isCourse) {
      const state = typeof parsed[0]?.data === 'string' ? JSON.parse(parsed[0].data) : parsed[0]?.data;
      if (Number(state?.course?.id) !== options.courseId || !Array.isArray(state?.section) || !Array.isArray(state?.cm)) throw new Error('Moodle did not return the requested course sections and activities.');
      return { ok: true, dataSource: 'live', diagnostics, rawResponse, state };
    }
    if (!Array.isArray(parsed[0]?.data?.courses)) throw new Error('Moodle returned no courses array. See the raw response.');
    const plain = value => { const el = document.createElement('div'); el.innerHTML = String(value || ''); return el.textContent || ''; };
    return { ok: true, dataSource: 'live', diagnostics, rawResponse, nextOffset: parsed[0].data.nextoffset, courses: parsed[0].data.courses.map(course => ({
      id: course.id, name: plain(course.fullname), shortname: plain(course.shortname)
    })) };
  } catch (error) {
    const message = redact(String(error.message || error));
    console.error('[Study Space][Moodle direct] Request failed', { message, diagnostics });
    return { ok: false, error: message, diagnostics };
  }
}
