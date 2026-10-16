import assert from 'node:assert/strict';

// Exercise the prototype boundary: usable inputs/navigation, no workspace writes.
export async function exerciseSetup(context, origin) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const externalRequests = [];
  page.on('request', request => { if (request.url().startsWith('https:')) externalRequests.push(request.url()); });
  await context.route('https://moodle.ucl.ac.uk/my/', route => route.fulfill({ contentType: 'text/html', body: '<title>Moodle test destination</title>' }));
  try {
    await page.goto(`${origin}/dashboard.html`);
    await page.locator('#settings-button').click();
    await page.locator('#start-button').click();
    await page.waitForURL('**/setup.html');
    const before = await page.evaluate(async () => ({ extension: await chrome.storage.local.get(null), local: { ...localStorage } }));
    await page.locator('#setup-timetable').fill('not-a-url');
    await page.locator('#setup-next').click();
    assert.equal(await page.locator('[data-step="0"]').isVisible(), true);
    const sampleUrl = 'https://timetable.apps.ucl.ac.uk/icalendar/preview';
    await page.locator('#setup-timetable').fill(sampleUrl);
    await page.locator('#setup-next').click();
    assert.equal(await page.locator('h1:visible').textContent(), 'Connect Moodle');
    assert.equal(await page.locator('h1:visible').evaluate(node => node === document.activeElement), true);
    const popupReady = context.waitForEvent('page');
    await page.locator('#setup-moodle-link').click();
    const popup = await popupReady;
    await popup.waitForURL('https://moodle.ucl.ac.uk/my/');
    await popup.close();
    await page.locator('#setup-back').click();
    assert.equal(await page.locator('#setup-timetable').inputValue(), sampleUrl);
    await page.locator('#setup-next').click();
    await page.locator('#setup-next').click();
    await page.locator('#setup-commute').fill('30');
    await page.getByRole('radio', { name: 'At home' }).check();
    await page.locator('#setup-next').click();
    await page.locator('#add-activity').click();
    await page.getByLabel('Activity name', { exact: true }).fill('Football training');
    await page.getByRole('checkbox', { name: 'Monday', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Wednesday', exact: true }).check();
    await page.getByLabel('Starts at').fill('18:00');
    await page.getByLabel('Ends at').fill('19:00');
    await page.locator('#add-activity').click();
    await page.getByRole('button', { name: 'Remove activity 2', exact: true }).click();
    assert.equal(await page.locator('.setup-activity').count(), 1);
    await page.locator('#setup-back').click();
    assert.equal(await page.locator('#setup-commute').inputValue(), '30');
    assert.equal(await page.getByRole('radio', { name: 'At home' }).isChecked(), true);
    await page.locator('#setup-next').click();
    assert.equal(await page.getByLabel('Activity name', { exact: true }).inputValue(), 'Football training');
    const after = await page.evaluate(async () => ({ extension: await chrome.storage.local.get(null), local: { ...localStorage } }));
    assert.deepEqual(after, before, 'Setup must not persist answers or change workspace data');
    assert.deepEqual(externalRequests, [], 'Setup must not fetch calendar or Moodle data');
    await page.setViewportSize({ width: 320, height: 740 });
    for (let step = 3; step >= 0; step--) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('.setup-steps [aria-current="step"]').count(), 1);
      if (step) await page.locator('#setup-back').click();
    }
    for (let step = 0; step < 4; step++) await page.locator('#setup-next').click();
    await page.waitForURL('**/dashboard.html');
    await page.waitForSelector('#page-title');
    await page.locator('#settings-button').click();
    await page.locator('#start-button').click();
    await page.getByRole('link', { name: 'Skip setup' }).click();
    await page.waitForURL('**/dashboard.html');
    assert.deepEqual(errors, []);
  } finally {
    await context.unroute('https://moodle.ucl.ac.uk/my/');
    await page.close();
  }
}
