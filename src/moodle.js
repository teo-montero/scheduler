// Passed directly to chrome.scripting.executeScript. Keep all dependencies inside this function.
export async function readMoodleInPage(options = {}) {
  try {
    const sesskey = window.M?.cfg?.sesskey;
    if (!sesskey) throw new Error('Open your Moodle dashboard and sign in, then try syncing again.');
    async function moodleCall(methodname, args = {}) {
      const url = new URL('/lib/ajax/service.php', window.location.origin);
      url.search = new URLSearchParams({ sesskey, info: methodname }).toString();
      const started = Date.now();
      const details = { method: methodname, ...(args.courseid ? { courseId: args.courseid } : {}), ...(args.offset !== undefined ? { offset: args.offset, limit: args.limit } : {}) };
      console.info('[Study Space][Moodle] API request', details);
      let httpStatus;
      try {
        const response = await fetch(url, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify([{ index: 0, methodname, args }]) });
        httpStatus = response.status;
        if (!response.ok) throw new Error(`Moodle returned HTTP ${response.status}. Try signing in again.`);
        let result;
        try { result = await response.json(); } catch { throw new Error('Moodle returned a sign-in page. Sign in and retry.'); }
        if (!Array.isArray(result) || !result[0] || result[0].error) throw new Error('Moodle could not complete this request. Refresh your signed-in tab and retry.');
        const data = result[0].data;
        let summary = data;
        if (typeof data === 'string') { try { summary = JSON.parse(data); } catch { summary = null; } }
        console.info('[Study Space][Moodle] API response', { ...details, httpStatus, durationMs: Date.now() - started,
          ...(summary?.courses ? { courses: summary.courses.length } : {}), ...(summary?.events ? { events: summary.events.length } : {}),
          ...(summary?.section ? { sections: summary.section.length, activities: summary.cm?.length || 0 } : {}) });
        return data;
      } catch (error) {
        console.warn('[Study Space][Moodle] API failed', { ...details, httpStatus, durationMs: Date.now() - started, errorType: error.name });
        throw error;
      }
    }
    const plain = value => { const el = document.createElement('div'); el.innerHTML = String(value || ''); return el.textContent || ''; };
    if (options.mode === 'course-content') {
      if (!Number.isSafeInteger(options.courseId) || options.courseId <= 0) throw new Error('Choose a valid Moodle module.');
      const data = await moodleCall('core_courseformat_get_state', { courseid: options.courseId });
      const state = typeof data === 'string' ? JSON.parse(data) : data;
      if (!state || !state.course || !Array.isArray(state.section) || !Array.isArray(state.cm)) throw new Error('Moodle did not return the course sections and resources.');
      // Export just the course index fields needed by the planner and AI. Session
      // config, page HTML and unrelated Moodle state never leave this tab.
      return { ok: true, state: {
        course: { id: state.course.id },
        section: state.section.map(section => ({ id: section.id, title: section.title, number: section.number ?? section.section, visible: section.visible })),
        cm: state.cm.map(item => Object.fromEntries(['id', 'name', 'module', 'sectionid', 'url', 'visible', 'uservisible', 'completionstate', 'isoverallcomplete', 'description'].filter(key => key in item).map(key => [key, item[key]])))
      } };
    }
    const courses = [];
    let courseDone = false;
    if (options.mode === 'deadlines') { courses.push(...(options.courses || [])); courseDone = true; }
    else {
    for (let offset = 0; offset < 1000; offset += 50) {
      const data = await moodleCall('core_course_get_enrolled_courses_by_timeline_classification', { offset, limit: 50, classification: 'all', sort: 'fullname', customfieldname: '', customfieldvalue: '', requiredfields: ['id', 'fullname', 'shortname', 'showcoursecategory', 'showshortname', 'visible', 'enddate'] });
      const page = data?.courses || [];
      courses.push(...page.map(c => ({ id: c.id, name: plain(c.fullname), shortname: plain(c.shortname) })));
      if (page.length < 50 || data.nextoffset === -1) { courseDone = true; break; }
    }
    }
    if (options.mode === 'courses') return { ok: true, courses, tasks: null, warnings: courseDone ? [] : ['The course limit was reached; some modules may be missing.'] };
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
      return { id: `moodle-${e.id}`, courseId, courseName: byId.get(Number(courseId))?.shortname || plain(e.course?.shortname) || 'Moodle', title: plain(e.name), type, dueDate: due > 0 ? new Date(due * 1000).toISOString() : null, url: e.action?.url || e.url || null, estimatedMinutes: type === 'quiz' ? 60 : 120, completed: false, source: 'moodle', eventType: e.eventtype || '', activityId: (() => { try { const url = new URL(e.action?.url || e.url, window.location.origin); return /^\/mod\/[a-z0-9_]+\/view\.php$/i.test(url.pathname) ? url.searchParams.get('id') : null; } catch { return null; } })() };
    });
    return { ok: true, courses, tasks, warnings };
  } catch (error) {
    // Never return request URLs or session credentials to the extension.
    return { ok: false, error: error.name === 'TimeoutError' ? 'Moodle took too long to respond. Please try again.' : error.message };
  }
}
