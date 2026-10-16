// Passed directly to chrome.scripting.executeScript. Keep all dependencies inside this function.
export async function readMoodleInPage() {
  try {
    const sesskey = window.M?.cfg?.sesskey;
    if (!sesskey) throw new Error('Open your Moodle dashboard and sign in, then try syncing again.');
    async function moodleCall(methodname, args = {}) {
      const url = new URL('/lib/ajax/service.php', window.location.origin);
      url.search = new URLSearchParams({ sesskey, info: methodname }).toString();
      const response = await fetch(url, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify([{ index: 0, methodname, args }]) });
      if (!response.ok) throw new Error(`Moodle returned HTTP ${response.status}. Try signing in again.`);
      let result;
      try { result = await response.json(); } catch { throw new Error('Moodle returned a sign-in page. Sign in and retry.'); }
      if (!Array.isArray(result) || !result[0] || result[0].error) throw new Error(result?.[0]?.exception?.message || 'Moodle could not complete this request.');
      return result[0].data;
    }
    const plain = value => { const el = document.createElement('div'); el.innerHTML = String(value || ''); return el.textContent || ''; };
    const courses = [];
    let courseDone = false;
    for (let offset = 0; offset < 1000; offset += 50) {
      const data = await moodleCall('core_course_get_enrolled_courses_by_timeline_classification', { offset, limit: 50, classification: 'all', sort: 'fullname', customfieldname: '', customfieldvalue: '', requiredfields: ['id', 'fullname', 'shortname', 'showcoursecategory', 'showshortname', 'visible', 'enddate'] });
      const page = data?.courses || [];
      courses.push(...page.map(c => ({ id: c.id, name: plain(c.fullname), shortname: plain(c.shortname) })));
      if (page.length < 50 || data.nextoffset === -1) { courseDone = true; break; }
    }
    const rawEvents = [];
    const warnings = [];
    if (!courseDone) warnings.push('The course limit was reached; some courses may be missing.');
    try {
      let aftereventid = 0;
      const seen = new Set();
      let eventDone = false;
      for (let page = 0; page < 20; page++) {
        const data = await moodleCall('core_calendar_get_action_events_by_timesort', { timesortfrom: 0, limitnum: 50, aftereventid });
        const events = data?.events || [];
        const fresh = events.filter(e => !seen.has(e.id));
        fresh.forEach(e => seen.add(e.id));
        rawEvents.push(...fresh);
        if (events.length < 50 || !fresh.length) { eventDone = true; break; }
        aftereventid = events[events.length - 1].id;
      }
      if (!eventDone) warnings.push('The deadline limit was reached; some deadlines may be missing.');
    } catch {
      warnings.push('Courses synced, but Moodle deadlines could not be read. Your previous deadlines have been kept. Try syncing again.');
      return { ok: true, courses, tasks: null, warnings };
    }
    const byId = new Map(courses.map(c => [Number(c.id), c]));
    const tasks = rawEvents.filter(e => !e.action || e.action.actionable !== false).map(e => {
      const courseId = e.course?.id || e.courseid || 0;
      const due = e.timestart || e.timesort;
      const type = e.modulename === 'assign' ? 'assignment' : e.modulename === 'quiz' ? 'quiz' : 'other';
      return { id: `moodle-${e.id}`, courseId, courseName: byId.get(Number(courseId))?.shortname || plain(e.course?.shortname) || 'Moodle', title: plain(e.name), type, dueDate: due > 0 ? new Date(due * 1000).toISOString() : null, url: e.action?.url || e.url || null, estimatedMinutes: type === 'quiz' ? 60 : 120, completed: false, source: 'moodle' };
    });
    return { ok: true, courses, tasks, warnings };
  } catch (error) {
    // Never return request URLs or session credentials to the extension.
    return { ok: false, error: error.name === 'TimeoutError' ? 'Moodle took too long to respond. Please try again.' : error.message };
  }
}
