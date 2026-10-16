import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { emptyWorkspace } from '../src/demo.js';

export async function exerciseAssistant() {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!['dashboard.html', 'dashboard.js', 'styles.css', 'assets/mark.svg'].includes(path)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)]);
    res.end(await readFile(resolve('dist', path)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    for (const width of [1440, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1050 }, timezoneId: 'Europe/London' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.install({ time: new Date('2026-11-02T08:00:00Z') });
      await page.goto(`http://127.0.0.1:${server.address().port}/dashboard.html`);
      await page.evaluate(data => localStorage.setItem('studyspace-workspace-v1', JSON.stringify(data)), emptyWorkspace());
      await page.reload();
      await page.locator('#chat-toggle').click();
      const event = (type, title, startTime, endTime) => ({ type, title, startTime, endTime, date: '2026-11-02', endDate: '2026-11-02', location: 'Library', description: '<b>Bring notes</b>' });
      const events = [event('lecture', 'Algorithms lecture', '09:00', '10:00'), event('study', 'Revision', '11:00', '12:00'), event('user_time', 'Gym', '18:00', '19:00')];
      let answer = { ok: true, result: { action: 'clarify', message: 'What day and time?', events: [] } }, requests = [], release;
      await page.route('**/api/assistant', async route => {
        requests.push(route.request().postDataJSON());
        if (release) await release;
        await route.fulfill({ status: answer.ok ? 200 : 503, contentType: 'application/json', body: JSON.stringify(answer) });
      });
      const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyspace-workspace-v1')));
      const send = async text => {
        await page.locator('#chat-input').fill(text); await page.locator('#chat-form button').click();
        await page.waitForFunction(() => document.querySelector('#chat-form').getAttribute('aria-busy') === 'false');
      };
      await send('Add a lecture, study and gym');
      assert.equal((await saved()).blocked.length, 0);
      assert.ok((await page.locator('#chat-messages').textContent()).includes('What day and time?'));
      answer = { ok: true, result: { action: 'create_events', message: 'Ready', events } };
      let unblock; release = new Promise(resolve => { unblock = resolve; });
      await page.locator('#chat-input').fill('Monday 2 November: 9–10, 11–12 and 18–19');
      await page.locator('#chat-form button').click();
      await page.waitForFunction(() => document.querySelector('#chat-form').getAttribute('aria-busy') === 'true');
      assert.equal(await page.locator('#chat-input').isDisabled(), true);
      assert.equal(await page.locator('#chat-form button').isDisabled(), true);
      unblock(); release = null;
      await page.waitForFunction(() => document.querySelector('#chat-form').getAttribute('aria-busy') === 'false');
      assert.equal((await saved()).blocked.length, 3);
      assert.equal(requests[1].messages[1].text, 'What day and time?');
      assert.ok(!JSON.stringify(requests).includes('calendarUrl'));
      await page.locator('#chat-toggle').click();
      const prefix = width === 320 ? '.agenda-event' : '.calendar-event';
      const colors = [];
      for (const type of ['lecture', 'study', 'user_time']) {
        const card = page.locator(`${prefix}[data-event-type="${type}"]`);
        assert.equal(await card.count(), 1);
        colors.push(await card.evaluate(node => getComputedStyle(node).backgroundColor));
      }
      assert.equal(new Set(colors).size, 3);
      await page.locator(`${prefix}[data-event-type="study"]`).dblclick();
      assert.ok((await page.locator('#event-detail').textContent()).includes('<b>Bring notes</b>'));
      assert.equal(await page.locator('#event-detail b').count(), 0);
      assert.ok((await page.locator('#event-detail').textContent()).includes('Library'));
      await page.locator('#event-dialog .close-dialog').first().click();
      await page.reload();
      assert.equal((await saved()).blocked.length, 3);
      assert.equal(await page.locator(`${prefix}[data-event-type]`).count(), 3);
      await page.locator('#chat-toggle').click();
      await send('Add the same events again');
      assert.equal((await saved()).blocked.length, 3);
      assert.ok((await page.locator('#chat-messages').textContent()).includes('No duplicates'));
      answer = { ok: true, result: { action: 'create_events', message: 'Ready', events: [event('user_time', 'Free slot', '13:00', '14:00'), event('study', 'Conflicting study', '09:30', '10:30')] } };
      await send('Add two more events');
      assert.equal((await saved()).blocked.length, 3);
      assert.ok((await page.locator('#chat-messages').textContent()).includes('overlaps'));
      answer = { ok: true, result: { action: 'create_events', message: 'Ready', events: [{ ...events[0], type: 'invalid' }] } };
      await send('Add malformed event');
      assert.equal((await saved()).blocked.length, 3);
      answer = { ok: false, error: 'The assistant is not connected yet. Add your OpenAI API key on the local server, then restart it.' };
      await send('Add another event');
      assert.equal((await saved()).blocked.length, 3);
      assert.ok((await page.locator('#chat-messages').textContent()).includes('not connected'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(errors, []);
      console.log(`Assistant ${width}px: typed colours, full details, clarification, pending state, persistence, deduplication and atomic errors passed.`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
