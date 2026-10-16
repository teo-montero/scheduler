// Passed directly to chrome.scripting.executeScript. Keep all dependencies inside this function.
export async function readMoodleInPage(options = {}) {
  const diagnostics = { page: `${window.location.origin}${window.location.pathname}`, sessionKeyFound: false, sessionKeySource: null, requests: [] };
  let sesskey;
  try {
    // core/config is what Moodle's own core/ajax uses. M.cfg is its normal
    // bootstrap source; retain DOM fallbacks for pages where it isn't exported.
    let config = window.M?.cfg || {}, source = 'window.M.cfg.sesskey', nativeAjax;
    const loader = typeof window.requirejs === 'function' ? window.requirejs : typeof window.require === 'function' && window.define?.amd ? window.require : null;
    if (loader) {
      const modules = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 3000);
        try { loader(['core/config', 'core/ajax'], (pageConfig, ajax) => { clearTimeout(timer); resolve({ config: pageConfig?.default || pageConfig, ajax: ajax?.default || ajax }); }, () => { clearTimeout(timer); resolve(null); }); }
        catch { clearTimeout(timer); resolve(null); }
      });
      if (modules?.config?.sesskey) { config = modules.config; source = 'core/config.sesskey'; }
      if (typeof modules?.ajax?.call === 'function') nativeAjax = modules.ajax;
    }
    sesskey = typeof config.sesskey === 'string' ? config.sesskey.trim() : '';
    if (!sesskey) {
      const input = document.querySelector('input[name="sesskey"]');
      if (input?.value) { sesskey = input.value.trim(); source = 'page form input'; }
      else {
        const logout = document.querySelector('a[href*="/login/logout.php"][href*="sesskey="]');
        if (logout) { sesskey = new URL(logout.href, window.location.href).searchParams.get('sesskey') || ''; source = 'page logout link'; }
      }
    }
    diagnostics.pageSessionKeyFound = Boolean(sesskey);
    if (typeof options.sesskeyOverride === 'string' && options.sesskeyOverride.trim()) {
      diagnostics.pageKeyMatchesOverride = sesskey === options.sesskeyOverride.trim();
      sesskey = options.sesskeyOverride.trim(); source = 'local debug override'; nativeAjax = null;
    }
    diagnostics.sessionKeyFound = Boolean(sesskey); diagnostics.sessionKeySource = sesskey ? source : null; diagnostics.sessionKeyLength = sesskey.length;
    diagnostics.transport = nativeAjax ? 'Moodle core/ajax' : 'same-origin fetch';
    console.info('[Study Space][Moodle] Session check', diagnostics);
    if (!sesskey) throw new Error('No Moodle sesskey was found in this tab. Open your signed-in Moodle dashboard, refresh it, then retry.');
    if (options.mode === 'session-check') return { ok: true, diagnostics };
    const debug = value => JSON.parse(JSON.stringify(value ?? null, (key, item) => {
      if (/^(?:authorization|cookie|set-cookie|sesskey|api_?key)$/i.test(key)) return '[redacted]';
      return typeof item === 'string' ? item.replaceAll(sesskey, '[redacted]').replace(/([?&](?:sesskey|token|key)=)[^&#\s]+/gi, '$1[redacted]') : item;
    }));
    async function moodleCall(methodname, args = {}) {
      const root = new URL(config.wwwroot || window.location.origin);
      if (root.origin !== window.location.origin) throw new Error('Moodle page configuration points to a different origin. Open the UCL Moodle dashboard and retry.');
      const url = new URL(`${root.pathname.replace(/\/$/, '')}/lib/ajax/service.php`, root.origin);
      url.search = new URLSearchParams({ sesskey, info: methodname }).toString();
      const started = Date.now(), body = [{ index: 0, methodname, args }];
      const details = { method: methodname, ...(args.courseid ? { courseId: args.courseid } : {}), ...(args.offset !== undefined ? { offset: args.offset, limit: args.limit } : {}) };
      const request = { ...details, transport: diagnostics.transport, phase: 'started' };
      diagnostics.requests.push(request);
      const headers = { Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
      console.info('[Study Space][Moodle] API request', { ...details, transport: diagnostics.transport, url: debug(url.href), httpMethod: 'POST', headers, body: debug(body) });
      let data;
      try {
        if (nativeAjax) {
          data = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Moodle core/ajax timed out after 20 seconds. Inspect Network in the Moodle tab.')), 20000);
            try { Promise.resolve(nativeAjax.call([{ methodname, args }], true, true, false, 20000)[0]).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); }
            catch (error) { clearTimeout(timer); reject(error); }
          });
          console.info('[Study Space][Moodle] Native AJAX response', { method: methodname, data: debug(data) });
        } else {
          const response = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(20000), headers, body: JSON.stringify(body) });
          request.httpStatus = response.status; request.contentType = response.headers.get('content-type'); request.redirected = response.redirected;
          const finalUrl = new URL(response.url || url.href);
          request.responsePage = `${finalUrl.origin}${finalUrl.pathname}`;
          const text = await response.text();
          console.info('[Study Space][Moodle] Raw API response', { ...request, headers: debug(Object.fromEntries(response.headers)), body: debug(text) });
          if (!response.ok) throw new Error(`Moodle returned HTTP ${response.status}. Inspect the response in the Moodle tab's Network panel.`);
          let result;
          try { result = JSON.parse(text.replace(/^﻿/, '')); }
          catch {
            const loginPage = /\/(?:login|saml2|auth)(?:\/|$)/i.test(finalUrl.pathname) || /<form[^>]*(?:id=["']login|action=["'][^"']*login)/i.test(text);
            const challenge = /cf-chl|challenge-platform|just a moment|cloudflare|checking your browser/i.test(text);
            if (challenge) throw new Error('Moodle returned a browser/security challenge, not course JSON. Open and refresh the Moodle tab, finish any verification, then retry.');
            if (loginPage) throw new Error('The API redirected to Moodle/SSO login even though a sesskey was found. Refresh the signed-in Moodle dashboard and retry.');
            throw new Error(`Moodle returned ${request.contentType || 'non-JSON content'} from ${finalUrl.pathname}, not course JSON. The raw response is logged in the Moodle tab.`);
          }
          console.info('[Study Space][Moodle] Parsed API response', { method: methodname, body: debug(result) });
          const exception = Array.isArray(result) ? result[0]?.exception : result;
          if (!Array.isArray(result) || !result[0] || result[0].error) {
            request.errorCode = exception?.errorcode || null;
            throw new Error(exception?.errorcode === 'invalidsesskey' ? 'Moodle rejected this tab’s sesskey. Refresh the Moodle dashboard to get the current session key.' : `Moodle API error${exception?.errorcode ? ` (${exception.errorcode})` : ''}. Refresh Moodle and retry.`);
          }
          data = result[0].data;
        }
        let summary = data;
        if (typeof data === 'string') { try { summary = JSON.parse(data); } catch { summary = null; } }
        request.phase = 'complete'; request.durationMs = Date.now() - started;
        console.info('[Study Space][Moodle] API response', { ...details, durationMs: request.durationMs,
          ...(summary?.courses ? { courses: summary.courses.length } : {}), ...(summary?.events ? { events: summary.events.length } : {}),
          ...(summary?.section ? { sections: summary.section.length, activities: summary.cm?.length || 0 } : {}), parsedData: debug(summary) });
        return data;
      } catch (error) {
        request.phase = 'failed'; request.durationMs = Date.now() - started; request.errorCode ||= error?.errorcode || null;
        console.warn('[Study Space][Moodle] API failed', { ...request, error: debug({ message: error?.message || String(error), code: request.errorCode }) });
        throw new Error(debug(error?.message || (request.errorCode ? `Moodle API error (${request.errorCode})` : 'Moodle API failed. Inspect Network in the Moodle tab.')));
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
      return { ok: true, diagnostics, state: {
        course: { id: state.course.id },
        section: state.section.map(section => ({ id: section.id, title: section.title, number: section.number ?? section.section, visible: section.visible })),
        cm: state.cm.map(item => Object.fromEntries(['id', 'name', 'module', 'sectionid', 'url', 'visible', 'uservisible', 'completionstate', 'isoverallcomplete', 'description'].filter(key => key in item).map(key => [key, item[key]])))
      } };
    }
    const courses = [];
    let courseDone = false;
    if (options.mode === 'deadlines') { courses.push(...(options.courses || [])); courseDone = true; }
    else {
    for (let offset = 0; offset < 1000; offset += 24) {
      const data = await moodleCall('core_course_get_enrolled_courses_by_timeline_classification', { offset, limit: 24, classification: 'all', sort: 'fullname', customfieldname: '', customfieldvalue: '', requiredfields: ['id', 'fullname', 'shortname', 'showcoursecategory', 'showshortname', 'visible', 'enddate'] });
      const page = data?.courses || [];
      courses.push(...page.map(c => ({ id: c.id, name: plain(c.fullname), shortname: plain(c.shortname) })));
      if (page.length < 24 || data.nextoffset === -1) { courseDone = true; break; }
    }
    }
    if (options.mode === 'courses') return { ok: true, diagnostics, courses, tasks: null, warnings: courseDone ? [] : ['The course limit was reached; some modules may be missing.'] };
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
      return { ok: true, diagnostics, courses, tasks: null, warnings };
    }
    const byId = new Map(courses.map(c => [Number(c.id), c]));
    const tasks = rawEvents.filter(e => !e.action || e.action.actionable !== false).map(e => {
      const courseId = e.course?.id || e.courseid || 0;
      const due = e.timestart || e.timesort;
      const type = e.modulename === 'assign' ? 'assignment' : e.modulename === 'quiz' ? 'quiz' : 'other';
      return { id: `moodle-${e.id}`, courseId, courseName: byId.get(Number(courseId))?.shortname || plain(e.course?.shortname) || 'Moodle', title: plain(e.name), type, dueDate: due > 0 ? new Date(due * 1000).toISOString() : null, url: e.action?.url || e.url || null, estimatedMinutes: type === 'quiz' ? 60 : 120, completed: false, source: 'moodle', eventType: e.eventtype || '', activityId: (() => { try { const url = new URL(e.action?.url || e.url, window.location.origin); return /^\/mod\/[a-z0-9_]+\/view\.php$/i.test(url.pathname) ? url.searchParams.get('id') : null; } catch { return null; } })() };
    });
    return { ok: true, diagnostics, courses, tasks, warnings };
  } catch (error) {
    // Never return request URLs or session credentials to the extension.
    return { ok: false, diagnostics, error: error.name === 'TimeoutError' ? 'Moodle took too long to respond. Please try again.' : String(error.message || error).replaceAll(sesskey || '\u0000', '[redacted]') };
  }
}
