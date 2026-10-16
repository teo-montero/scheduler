import { fetchAssistant } from './assistant-client.js';
import { BUILD_ID, TIMETABLE_ORIGINS } from './protocol.js';
import { readMoodleInPage } from './moodle.js';
import { parseTimetable, validateCalendarUrl, calendarFetchUrl } from './ical.js';
import { addDays, atTime, dateKey } from './dates.js';
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  const existing = (await chrome.tabs.query({ url }))[0];
  if (existing) { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('dashboard.html'))) return false;
  const handle = async () => {
    if (message.buildId && message.buildId !== BUILD_ID) throw new Error('Study Space was updated. Refresh this planner tab, then try again.');
    if (message.type === 'ASSISTANT_CHAT') return fetchAssistant(message.payload);
    if (message.type === 'SYNC_MOODLE') {
      const tabs = await chrome.tabs.query({ url: 'https://moodle.ucl.ac.uk/*' });
      if (!tabs.length) throw new Error('Open Moodle in another tab and sign in, then click Sync Moodle again.');
      const sorted = tabs.sort((a, b) => Number(b.active) - Number(a.active));
      for (const tab of sorted) {
        let result;
        try { [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: readMoodleInPage }); }
        catch { continue; }
        if (result?.ok) return result;
      }
      throw new Error('Could not read a signed-in Moodle session. Refresh your Moodle dashboard and try again.');
    }
    if (message.type === 'SYNC_TIMETABLE') {
      const url = calendarFetchUrl(message.url);
      const allowed = await chrome.permissions.contains({ origins: TIMETABLE_ORIGINS });
      if (!allowed) throw new Error('Chrome has blocked timetable access for this extension. Click Sync timetable and allow access to the two UCL timetable sites.');
      let response;
      try { response = await fetch(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(20000) }); }
      catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('UCL’s timetable server did not respond within 20 seconds. Try Sync timetable again. Your existing calendar has been kept.');
        throw new Error('Chrome could not download the feed from timetable.mesh.ucl.ac.uk. Check this extension’s Site access in chrome://extensions and your network connection. Your existing calendar has been kept.');
      }
      if (!response.ok) throw new Error(`Timetable returned HTTP ${response.status}. Check your subscription URL.`);
      // UCL may redirect subscriptions between its two timetable hosts.
      validateCalendarUrl(response.url);
      const text = await response.text();
      if (text.length > 10_000_000) throw new Error('The calendar is too large. Import a shorter date range.');
      return { ok: true, events: parseTimetable(text, { from: atTime(addDays(dateKey(), -7)) }), meta: { entryCount: (text.match(/BEGIN:VEVENT/gi) || []).length, bytes: text.length } };
    }
    throw new Error('Unknown extension request.');
  };
  handle().then(result => reply({ ...result, buildId: BUILD_ID })).catch(error => reply({ ok: false, error: error.message, buildId: BUILD_ID }));
  return true;
});
