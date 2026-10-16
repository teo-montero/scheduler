import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { emptyWorkspace } from '../src/demo.js';

export async function exerciseCalendarPreview() {
  const server = createServer(async (req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!['dashboard.html', 'dashboard.js', 'styles.css', 'assets/mark.svg', 'assets/icon-32.png', 'assets/icon-128.png'].includes(file)) { res.writeHead(404); res.end(); return; }
    try { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(file)]); res.end(await readFile(resolve('dist', file))); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    for (const width of [1440, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1050 }, timezoneId: 'Europe/London', reducedMotion: 'reduce' });
      context.setDefaultTimeout(8000);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-11-02T08:00:00Z') });
      const workspace = emptyWorkspace();
      workspace.events = [
        { id: 'preview-a', title: 'Design project', start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z', source: 'study' },
        { id: 'preview-b', title: 'Algorithms lecture', start: '2026-11-02T10:00:00Z', end: '2026-11-02T11:00:00Z', source: 'ucl-timetable' },
        { id: 'preview-c', title: 'Lunch with friends', start: '2026-11-02T11:00:00Z', end: '2026-11-02T12:00:00Z', source: 'personal' }
      ];
      await page.goto(`http://127.0.0.1:${server.address().port}/dashboard.html`);
      await page.evaluate(data => localStorage.setItem('studyspace-workspace-v1', JSON.stringify(data)), workspace);
      await page.reload();
      const saved = await page.evaluate(() => localStorage.getItem('studyspace-workspace-v1'));
      const prefix = width === 320 ? '.agenda-event' : '.calendar-event';
      const a = page.locator(`${prefix}[data-event="preview-a"]`), b = page.locator(`${prefix}[data-event="preview-b"]`);
      const time = node => node.locator(width === 320 ? '.agenda-event-time' : '.event-time').textContent();
      await a.click();
      assert.equal(await page.locator('#event-dialog').isVisible(), false);
      assert.equal(await a.getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Extend by 30 minutes', exact: true }).click();
      assert.equal(await time(a), '09:00–10:30'); assert.equal(await time(b), '10:30–11:30');
      assert.equal(await a.getAttribute('aria-pressed'), 'true', 'Editing controls retain selection');
      await page.locator('#calendar-heading').click();
      assert.equal(await a.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('.is-editing, .preview-decoration').count(), 0);
      assert.equal(await page.locator('#calendar-editor').isVisible(), false);
      assert.equal(await time(a), '09:00–10:30', 'Outside click preserves the visual edit');
      assert.equal(await page.evaluate(() => localStorage.getItem('studyspace-workspace-v1')), saved);
      await a.click();
      assert.equal(await a.getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Shorten by 30 minutes', exact: true }).click();
      assert.equal(await time(a), '09:00–10:00'); assert.equal(await time(b), '10:00–11:00');
      await b.click();
      await page.getByRole('button', { name: 'Move 30 minutes earlier', exact: true }).click();
      assert.equal(await time(a), '08:30–09:30'); assert.equal(await time(b), '09:30–10:30');
      await page.getByRole('button', { name: 'Reset preview', exact: true }).click();
      await a.dblclick();
      assert.equal(await page.locator('#event-title').textContent(), 'Design project');
      assert.equal(await page.locator('#event-dialog').isVisible(), true);
      await page.keyboard.press('Escape');
      if (width === 1440) {
        await a.click();
        const box = await a.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 25);
        await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + 61, { steps: 6 }); await page.mouse.up();
        assert.equal(await time(a), '09:30–10:30'); assert.equal(await time(b), '10:30–11:30');
        const edge = page.locator('#calendar-body [data-preview-resize="end"]');
        const edgeBox = await edge.boundingBox();
        await page.mouse.move(edgeBox.x + 18, edgeBox.y + 6); await page.mouse.down();
        await page.mouse.move(edgeBox.x + 18, edgeBox.y + 42, { steps: 6 }); await page.mouse.up();
        assert.equal(await time(a), '09:30–11:00'); assert.equal(await time(b), '11:00–12:00');
        await a.focus(); await page.keyboard.press('ArrowUp');
        assert.equal(await time(a), '09:00–10:30');
        await page.keyboard.press('Shift+ArrowDown');
        assert.equal(await time(a), '09:00–11:00');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#event-dialog').isVisible(), true);
        await page.keyboard.press('Escape');
      }
      assert.equal(await page.evaluate(() => localStorage.getItem('studyspace-workspace-v1')), saved);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.clock.fastForward(10500);
      if (process.env.PREVIEW_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PREVIEW_SCREENSHOT_DIR}/calendar-edit-${width}.png`, animations: 'disabled', fullPage: width === 320 });
      await page.locator(`${width === 320 ? '#calendar-agenda' : '#calendar-body'} [data-preview-remove]`).click();
      assert.equal(await a.count(), 0); assert.equal(await b.count(), 1);
      assert.equal(await page.evaluate(() => localStorage.getItem('studyspace-workspace-v1')), saved);
      await page.reload();
      assert.equal(await a.count(), 1); assert.equal(await time(a), '09:00–10:00');
      assert.equal(await time(b), '10:00–11:00');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`${width}px: calendar preview selection, resize, ripple, move, details, removal and zero persistence passed.`);
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
if (process.argv.includes('--run')) await exerciseCalendarPreview();
