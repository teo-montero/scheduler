import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { exerciseSetup } from './setup-flow.mjs';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dateKey, addDays, atTime, weekStart } from '../src/dates.js';

for (const folder of ['.', 'dist']) {
  const root = resolve(folder);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  for (const path of [manifest.background.service_worker, 'dashboard.html', 'dashboard.js', 'styles.css', ...Object.values(manifest.icons)]) await access(join(root, path));
  const profile = await mkdtemp(join(tmpdir(), 'studyspace-test-'));
  let context;
  try {
    // Optional alternate Chromium binary for hosts that cannot launch the bundled version.
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`], viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/London' });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    context.setDefaultTimeout(8000);
    const errors = []; worker.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const extensionId = new URL(worker.url()).hostname;
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    // Keep the current-time marker in view, independent of the hour the suite runs.
    await page.clock.install({ time: atTime(dateKey(), 12) });
    await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await page.waitForSelector('.calendar-event');
    assert.ok(await page.locator('.calendar-event').count() > 10);
    assert.equal(await page.locator('.day-name').count(), 7);
    await page.getByRole('button', { name: 'Sync Moodle', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Open Moodle'));
    console.log(`${folder}: Chrome accepted manifest, worker and dashboard; no-session error handled.`);
    await exerciseSetup(context, 'chrome-extension://' + extensionId);
    console.log(folder + ': real setup bindings, fetch-only course checks, selection, persistence, commute, weekly events and AI chat/planning passed with simulated providers.');
    await page.reload(); await page.waitForSelector('.calendar-event');
    if (folder === 'dist') { assert.deepEqual(errors, []); continue; }

    // Each navigation destination has an accurate title and current-page state.
    for (const [view, title] of [['tasks', 'All tasks'], ['courses', 'My modules'], ['week', 'My week']]) {
      await page.locator('[data-view="' + view + '"]').click();
      assert.equal(await page.locator('#page-title').textContent(), title);
      assert.equal(await page.locator('.primary-nav [aria-current="page"]').count(), 1);
      assert.equal(await page.locator('.primary-nav [aria-current="page"]').getAttribute('data-view'), view);
      assert.equal(await page.locator('#focus-summary').isVisible(), view === 'week');
    }

    // A routine clock refresh must not remove the event a keyboard user is focused on.
    const focusedEvent = await page.locator('.calendar-event').first().elementHandle();
    await focusedEvent.focus();
    const markerTop = await page.locator('.now-line').evaluate(node => parseFloat(node.style.top));
    await page.clock.fastForward(61000);
    assert.ok(await page.locator('.now-line').evaluate(node => parseFloat(node.style.top)) > markerTop);
    assert.equal(await focusedEvent.evaluate(node => node.isConnected && document.activeElement === node), true);
    await focusedEvent.dispose();
    console.log('Contextual navigation, weekly summary and focus-preserving clock refresh passed.');

    await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
    await page.locator('#task-title').fill('Browser test essay');
    await page.locator('#task-due').fill(`${addDays(dateKey(), 5)}T17:00`);
    await page.locator('#task-estimate').fill('75');
    await page.getByRole('button', { name: 'Save task', exact: true }).click();
    await page.locator('[data-view="tasks"]').click();
    await page.waitForSelector('#all-tasks [data-edit-task]');
    assert.equal(await page.getByRole('button', { name: 'Browser test essay', exact: true }).count(), 1);
    const completeEssay = page.getByRole('button', { name: 'Complete Browser test essay', exact: true });
    await completeEssay.focus(); await completeEssay.press('Space');
    await page.waitForFunction(() => !document.querySelector('#all-tasks').textContent.includes('Browser test essay'));
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#all-tasks') && document.activeElement.matches('[data-complete]'))), true, 'Keyboard completion should focus another task');
    await page.locator('#task-filter').selectOption('completed');
    await page.waitForFunction(() => document.querySelector('#all-tasks').textContent.includes('Browser test essay'));
    await page.reload(); await page.waitForSelector('.calendar-event');
    await page.locator('[data-view="tasks"]').click(); await page.locator('#task-filter').selectOption('completed');
    assert.ok((await page.locator('#all-tasks').textContent()).includes('Browser test essay'));

    // A busy-day request, persisted personal time, and a completion through chat.
    await page.locator('#chat-input').fill('I’m busy tomorrow afternoon');
    await page.locator('#chat-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector('#chat-messages').textContent.includes('now protected'));
    await page.locator('#settings-button').click();
    assert.ok((await page.locator('#blocked-list').textContent()).includes('Afternoon off'));
    await page.locator('[data-remove-block]').click();
    assert.equal(await page.locator('[data-remove-block]').count(), 0);
    await page.locator('#settings-dialog .close-dialog').first().click();
    await page.locator('#chat-input').fill('Finished maths problem sheet');
    await page.locator('#chat-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector('#chat-messages').textContent.includes('is checked off'));
    console.log('Task create/complete/persistence and local chat commands passed.');

    // Test authenticated-page integration with a synthetic Moodle page, never a real account.
    const seenMethods = [], apiRequests = [];
    const due = Math.floor(atTime(addDays(dateKey(), 4), 17).getTime() / 1000);
    await context.route('https://moodle.ucl.ac.uk/**', async route => {
      const request = route.request();
      if (request.url().includes('/lib/ajax/service.php')) {
        const payload = request.postDataJSON()[0]; seenMethods.push(payload.methodname); apiRequests.push({ url: request.url(), payload });
        const data = payload.methodname.startsWith('core_course_') ? { courses: [{ id: 101, fullname: 'Test &amp; Learning', shortname: 'COMP-TEST' }], nextoffset: -1 } : { events: [{ id: 301, name: 'Integration assignment', modulename: 'assign', timestart: due, course: { id: 101 }, action: { actionable: true, url: 'https://moodle.ucl.ac.uk/mod/assign/view.php?id=99' } }] };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ error: false, data }]) });
      } else await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Simulated Moodle</title></head><body><h1>Test Moodle</h1><script>window.M={cfg:{sesskey:"synthetic-session-key"}};</script></body></html>' });
    });
    const moodle = await context.newPage(); await moodle.goto('https://moodle.ucl.ac.uk/my/');
    await page.bringToFront(); await page.getByRole('button', { name: 'Sync Moodle', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#mode-badge').textContent.includes('Your workspace'));
    assert.ok(seenMethods.includes('core_course_get_enrolled_courses_by_timeline_classification'));
    assert.ok(!seenMethods.includes('core_calendar_get_action_events_by_timesort'));
    await page.locator('#refresh-deadlines-button').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Moodle deadlines refreshed'));
    assert.ok(seenMethods.includes('core_calendar_get_action_events_by_timesort'));
    assert.ok(apiRequests.every(r => new URL(r.url).searchParams.get('sesskey') === 'synthetic-session-key'));
    const data = await worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
    assert.equal(data.tasks.length, 1); assert.equal(data.tasks[0].title, 'Integration assignment');
    assert.equal(data.courses[0].name, 'Test & Learning'); assert.equal(data.events.length, 0); // Sample calendar removed.
    assert.equal(data.mode, 'live'); assert.ok(!JSON.stringify(data).includes('synthetic-session-key'));
    // An isolated page world cannot reach the extension through runtime; injection runs in MAIN.
    assert.equal(await moodle.evaluate(() => Boolean(window.M?.cfg?.sesskey)), true);
    await page.locator('[data-view="tasks"]').click();
    await page.locator('#task-filter').selectOption('pending');
    await page.getByRole('button', { name: 'Integration assignment', exact: true }).click();
    assert.equal(await page.locator('#task-title').isDisabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'task-estimate');
    await page.locator('#task-estimate').fill('180'); await page.getByRole('button', { name: 'Save task', exact: true }).click();
    await page.locator('[data-view="courses"]').click();
    await page.locator('#refresh-deadlines-button').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Moodle deadlines refreshed'));
    assert.equal((await worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace)).tasks[0].estimatedMinutes, 180);
    console.log('Full MAIN-world Moodle sync passed with simulated data; sample removal, entity decoding, estimate persistence and no credential storage verified.');

    // URL fetch from the worker and local ICS import.
    const day = addDays(dateKey(), 2).replaceAll('-', '');
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:browser-lecture\r\nDTSTART;TZID=Europe/London:${day}T100000\r\nDTEND;TZID=Europe/London:${day}T110000\r\nSUMMARY:Browser test lecture\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    // Playwright cannot route extension-origin worker fetches. Stub fetch in the
    // isolated worker for this fixture while exercising the real message handler.
    await worker.evaluate(({ ics }) => {
      const original = globalThis.fetch;
      globalThis.fetch = async (input, options) => {
        const url = String(input);
        if (url.startsWith('https://timetable.mesh.ucl.ac.uk/')) {
          globalThis.__testTimetableUrl = url;
          if (url.includes('synthetic-network-failure')) throw new TypeError('Failed to fetch');
          const response = new Response(ics, { status: 200, headers: { 'Content-Type': 'text/calendar' } });
          Object.defineProperty(response, 'url', { value: url });
          return response;
        }
        return original(input, options);
      };
    }, { ics });
    await page.locator('#settings-button').click();
    await page.locator('#calendar-url').fill('https://timetable.apps.ucl.ac.uk/icalendar/synthetic-test-key');
    await page.locator('#sync-calendar-button').click();
    await page.waitForFunction(() => document.querySelector('#calendar-status').textContent.includes('1 event imported') || document.querySelector('#calendar-error').textContent.length > 0);
    assert.equal(await page.locator('#calendar-error').textContent(), '', 'Timetable URL fetch failed');
    assert.equal(await worker.evaluate(() => globalThis.__testTimetableUrl), 'https://timetable.mesh.ucl.ac.uk/online-timetable-api-proxy/v0.1/icalendar?key_identifier=synthetic-test-key');
    assert.equal(await page.locator('#settings-error').textContent(), '');
    assert.equal(await page.locator('.calendar-preview-event').count(), 1);
    await page.locator('#view-imported-calendar').click();
    assert.equal(await page.locator('#settings-dialog').isVisible(), false);
    await page.waitForSelector('.calendar-event');
    assert.ok((await page.locator('#calendar-body').textContent()).includes('Browser test lecture'));
    await page.locator('#settings-button').click();
    await page.locator('#calendar-url').fill('https://timetable.apps.ucl.ac.uk/icalendar/synthetic-network-failure');
    await page.locator('#sync-calendar-button').click();
    await page.waitForFunction(() => document.querySelector('#calendar-error').textContent.includes('Chrome could not download'));
    const preserved = await worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
    assert.equal(preserved.events.length, 1);
    assert.equal(preserved.events[0].title, 'Browser test lecture');
    // Save preferences with a new URL must fetch the feed rather than save an unused link.
    await page.locator('#calendar-url').fill('https://timetable.apps.ucl.ac.uk/icalendar/synthetic-save-subscription');
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
    assert.ok((await worker.evaluate(() => globalThis.__testTimetableUrl)).includes('synthetic-save-subscription'));
    await page.locator('#settings-button').click();
    console.log('Calendar preview, View calendar, visible download errors, preserved data on failure and importing on Save preferences passed.');
    await page.locator('#ics-file').setInputFiles({ name: 'test.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
    await page.waitForFunction(() => document.querySelector('#calendar-status').textContent.includes('1 event imported'));
    const afterImport = await worker.evaluate(async () => (await chrome.storage.local.get('workspace')).workspace);
    assert.equal(afterImport.events[0].title, 'Browser test lecture');
    assert.equal(afterImport.tasks[0].title, 'Integration assignment');
    await page.locator('#start-hour').selectOption('18'); await page.locator('#end-hour').selectOption('10');
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    assert.ok((await page.locator('#settings-error').textContent()).includes('end after'));
    await page.locator('#start-hour').selectOption('9'); await page.locator('#end-hour').selectOption('18');
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    console.log('ICS import and preference validation passed.');

    // When the final task leaves a filtered list, keep a useful keyboard focus target.
    await page.locator('[data-view="tasks"]').click();
    await page.locator('#task-filter').selectOption('pending');
    const completeLast = page.getByRole('button', { name: 'Complete Integration assignment', exact: true });
    await completeLast.focus(); await completeLast.press('Space');
    await page.waitForFunction(() => document.activeElement.id === 'page-title');
    assert.equal(await page.locator('#all-tasks [data-complete]').count(), 0);
    await page.locator('#task-filter').selectOption('completed');
    const reopenLast = page.getByRole('button', { name: 'Reopen Integration assignment', exact: true });
    await reopenLast.focus(); await reopenLast.press('Space');
    await page.waitForFunction(() => document.activeElement.id === 'page-title');
    await page.locator('#task-filter').selectOption('pending');
    assert.equal(await page.getByRole('button', { name: 'Complete Integration assignment', exact: true }).count(), 1);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [view, title] of [['tasks', 'All tasks'], ['courses', 'My modules'], ['week', 'My week']]) {
      const navigation = page.locator('.primary-nav [data-view="' + view + '"]');
      assert.equal(await navigation.locator('span').first().isVisible(), true, title + ' needs a visible mobile label');
      await navigation.click();
      assert.equal(await page.locator('#page-title').textContent(), title);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.equal(await page.getByRole('button', { name: 'Preferences', exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    assert.equal(await page.locator('#settings-dialog').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settings-dialog').isVisible(), false);
    assert.equal(await page.locator('#calendar-scroll').isVisible(), false);
    assert.equal(await page.locator('#calendar-agenda').isVisible(), true);
    assert.equal(await page.locator('[data-agenda-day]').count(), 7);
    const lectureDay = addDays(dateKey(), 2);
    await page.locator('[data-agenda-day="' + lectureDay + '"]').click();
    assert.equal(await page.locator('[data-agenda-day][aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('[data-agenda-day][aria-pressed="true"]').getAttribute('data-agenda-day'), lectureDay);
    const agendaLecture = page.locator('.agenda-event').filter({ hasText: 'Browser test lecture' });
    assert.equal(await agendaLecture.locator('.agenda-event-time').textContent(), '10:00–11:00');
    await agendaLecture.click();
    assert.equal(await page.locator('#event-dialog').isVisible(), true);
    assert.equal(await page.locator('#event-title').textContent(), 'Browser test lecture');
    await page.keyboard.press('Escape');
    const firstDay = await page.locator('[data-agenda-day]').first().getAttribute('data-agenda-day');
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    assert.equal(await page.locator('[data-agenda-day]').first().getAttribute('data-agenda-day'), addDays(firstDay, 7));
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    assert.equal(await page.locator('[data-agenda-day]').first().getAttribute('data-agenda-day'), firstDay);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    assert.equal(await page.locator('[data-agenda-day]').first().getAttribute('data-agenda-day'), weekStart());
    assert.equal(await page.locator('[data-agenda-day][aria-pressed="true"]').getAttribute('data-agenda-day'), dateKey());
    console.log('Keyboard completion/reopening, mobile navigation, preferences, agenda and week controls passed.');
    await page.screenshot({ path: join(tmpdir(), 'studyspace-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('Mobile layout has no document overflow; no page or service-worker errors.');
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
}
console.log('All browser checks passed.');
