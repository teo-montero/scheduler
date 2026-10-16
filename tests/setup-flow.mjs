import assert from 'node:assert/strict';
import { addDays, atTime, dateKey } from '../src/dates.js';
import { localStudyPlan, overlaps } from '../src/planner/planning.js';

export async function exerciseSetup(context, origin) {
  const page = await context.newPage(), errors = [], methods = [], aiCalls = [];
  const worker = context.serviceWorkers()[0];
  page.on('pageerror', error => errors.push(error.message));
  const previous = await worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
  const day = addDays(dateKey(), 3), compact = day.replaceAll('-', '');
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:setup-lecture\r\nDTSTART;TZID=Europe/London:${compact}T100000\r\nDTEND;TZID=Europe/London:${compact}T110000\r\nSUMMARY:Setup lecture\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  await worker.evaluate(ics => {
    globalThis.__beforeSetupFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      if (!String(input).startsWith('https://timetable.mesh.ucl.ac.uk/')) return globalThis.__beforeSetupFetch(input, options);
      const response = new Response(ics); Object.defineProperty(response, 'url', { value: String(input) }); return response;
    };
  }, ics);
  const moodleRoute = async route => {
    if (!route.request().url().includes('/lib/ajax/service.php')) {
      await route.fulfill({ contentType: 'text/html', body: '<title>Test Moodle</title><script>window.M={cfg:{sesskey:"synthetic-session-key"}}</script>' }); return;
    }
    const call = route.request().postDataJSON()[0]; methods.push(call);
    const data = call.methodname === 'core_courseformat_get_state' ? JSON.stringify({ course: { id: '111' }, section: [{ id: '1', title: 'Lecture notes' }], cm: [
      { id: '51', name: 'Lecture 1 Introduction', sectionid: '1', module: 'resource', url: 'https://moodle.ucl.ac.uk/mod/resource/view.php?id=51' },
      { id: '52', name: 'Exercise Sheet 1', sectionid: '1', module: 'resource', url: 'https://moodle.ucl.ac.uk/mod/resource/view.php?id=52' }
    ] }) : { courses: [{ id: 111, fullname: 'Algorithms', shortname: 'COMP111' }, { id: 222, fullname: 'Generic welcome course', shortname: 'WELCOME' }], nextoffset: -1 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ error: false, data }]) });
  };
  const aiRoute = async route => {
    const path = new URL(route.request().url()).pathname, input = route.request().postDataJSON(); aiCalls.push(path);
    const result = path === '/analyse' ? { suggestions: { tasks: input.activities.map(item => ({ activityId: item.id, title: `Study ${item.name}`, category: item.id === '51' ? 'lecture' : 'exercise', estimatedMinutes: 60, optional: false, confidence: 'low', reason: 'Synthetic estimate.' })) }, model: 'synthetic' }
      : path === '/chat' ? { message: 'Your afternoon is protected.', clarification: null, actions: [{ type: 'block_time', title: 'Bar with friends', start: atTime(addDays(dateKey(), 1), 12).toISOString(), end: atTime(addDays(dateKey(), 1), 18).toISOString() }] }
      : localStudyPlan(input);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...result }) });
  };
  await context.route('https://moodle.ucl.ac.uk/**', moodleRoute);
  await context.route('http://127.0.0.1:8787/**', aiRoute);
  let popup;
  try {
    await page.goto(`${origin}/setup.html`);
    await page.locator('#setup-next').waitFor({ state: 'visible' });
    await page.locator('#setup-timetable').fill('not-a-url'); await page.locator('#setup-next').click();
    assert.equal(await page.locator('[data-step="0"]').isVisible(), true);
    await page.locator('#setup-timetable').fill('https://timetable.apps.ucl.ac.uk/icalendar/synthetic-setup');
    await page.locator('#setup-next').click();
    await page.waitForSelector('[data-step="1"]:visible');
    assert.match(await page.locator('#setup-status').textContent(), /1 timetable events fetched/);
    const popupReady = context.waitForEvent('page'); await page.locator('#setup-moodle-link').click(); popup = await popupReady;
    await popup.waitForURL('https://moodle.ucl.ac.uk/my/');
    await page.locator('#setup-load-courses').click(); await page.waitForSelector('[data-setup-course="111"]');
    await page.locator('[data-setup-course="222"]').uncheck();
    await page.locator('#setup-check-courses').click();
    await page.waitForFunction(() => document.querySelector('#setup-status').textContent.includes('2 visible activities'));
    assert.equal(methods.filter(call => call.methodname === 'core_courseformat_get_state').length, 1);
    assert.equal(methods.find(call => call.methodname === 'core_courseformat_get_state').args.courseid, 111);
    assert.deepEqual(aiCalls, [], 'Connection checks must not run AI');
    assert.match(await page.locator('#setup-course-list').textContent(), /1 sections · 2 activities fetched/);
    assert.match(await page.locator('#setup-course-list').textContent(), /Exercise Sheet 1/);
    const saved = await worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
    assert.equal(saved.courseContent[111].state.activities.length, 2);
    assert.deepEqual(saved.excludedCourseIds, ['222']); assert.ok(!JSON.stringify(saved).includes('synthetic-session-key'));
    await page.locator('#setup-next').click(); await page.waitForSelector('[data-step="2"]:visible');
    await page.locator('#setup-commute').fill('30'); await page.getByRole('radio', { name: 'At home' }).check();
    await page.locator('#setup-next').click(); await page.waitForSelector('[data-step="3"]:visible');
    await page.locator('#add-activity').click(); await page.getByLabel('Activity name', { exact: true }).fill('Football training');
    await page.getByRole('checkbox', { name: 'Monday', exact: true }).check();
    await page.getByLabel('Starts at').fill('18:00'); await page.getByLabel('Ends at').fill('19:00');
    await page.locator('#add-activity').click(); await page.getByRole('button', { name: 'Remove activity 2', exact: true }).click();
    assert.equal(await page.locator('.setup-activity').count(), 1);
    await page.setViewportSize({ width: 320, height: 740 });
    for (let step = 3; step >= 0; step--) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (step) await page.locator('#setup-back').click();
    }
    for (let step = 0; step < 3; step++) { await page.locator('#setup-next').click(); await page.waitForSelector(`[data-step="${step + 1}"]:visible`); }
    await page.locator('#setup-next').click(); await page.waitForURL('**/dashboard.html'); await page.waitForSelector('#page-title');
    const finished = await worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
    assert.equal(finished.personal.commuteMinutes, 30); assert.equal(finished.personal.studyLocation, 'home');
    assert.equal(finished.weeklyActivities[0].title, 'Football training'); assert.equal(finished.tasks.length, 2);
    assert.equal(finished.events[0].title, 'Setup lecture'); assert.equal(finished.planning.engine, 'ai');
    assert.ok(finished.personalEvents.some(event => event.kind === 'commute'));
    assert.ok(finished.personalEvents.some(event => event.kind === 'weekly'));
    assert.ok(aiCalls.includes('/analyse') && aiCalls.includes('/plan'));
    await page.locator('#chat-input').fill('This afternoon tomorrow must be free because I am going to the bar with friends');
    await page.locator('#chat-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector('#chat-messages').textContent.includes('Your afternoon is protected'));
    const updated = await worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
    const blocked = updated.blocked.find(event => event.title === 'Bar with friends');
    assert.ok(blocked); assert.ok(updated.blocks.every(block => !overlaps(block, blocked)));
    assert.ok(aiCalls.includes('/chat'));
    assert.deepEqual(errors, []);
  } finally {
    if (popup) await popup.close();
    await context.unroute('https://moodle.ucl.ac.uk/**', moodleRoute);
    await context.unroute('http://127.0.0.1:8787/**', aiRoute);
    await worker.evaluate(async previous => {
      globalThis.fetch = globalThis.__beforeSetupFetch; delete globalThis.__beforeSetupFetch;
      if (previous) await chrome.storage.local.set({ workspace: previous }); else await chrome.storage.local.remove('workspace');
    }, previous);
    await page.close();
  }
}
