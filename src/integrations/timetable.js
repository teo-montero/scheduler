import { debugData } from './debug.js';
import { calendarFetchUrl, parseTimetable, validateCalendarUrl } from '../ical.js';
import { addDays, atTime, dateKey } from '../dates.js';

// No DOM, storage or planning: this connector only downloads/normalises UCL data.
export async function fetchUclTimetable(value, { fetchImpl = fetch, now = new Date() } = {}) {
  const url = calendarFetchUrl(value);
  const started = Date.now();
  console.info('[Study Space][Timetable] API request', { url: debugData(url), method: 'GET', headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' }, body: null });
  let response;
  try { response = await fetchImpl(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(20000) }); }
  catch (error) {
    console.warn('[Study Space][Timetable] API failed', { durationMs: Date.now() - started, errorType: error.name });
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('UCL’s timetable server did not respond within 20 seconds. Your existing calendar has been kept.');
    throw new Error('Chrome could not download the feed from timetable.mesh.ucl.ac.uk. Check extension Site access and your network connection. Your existing calendar has been kept.');
  }
  console.info('[Study Space][Timetable] HTTP response', { httpStatus: response.status, durationMs: Date.now() - started });
  const text = await response.text();
  console.info('[Study Space][Timetable] API response body (ICS)', { httpStatus: response.status, headers: debugData(Object.fromEntries(response.headers)), body: debugData(text) });
  if (!response.ok) throw new Error(`Timetable returned HTTP ${response.status}. Check your subscription URL.`);
  validateCalendarUrl(response.url || url);
  if (text.length > 10_000_000) throw new Error('The calendar is too large. Import a shorter date range.');
  let events;
  try { events = parseTimetable(text, { from: atTime(addDays(dateKey(now), -7)) }); }
  catch (error) { console.warn('[Study Space][Timetable] Parse failed', { errorType: error.name }); throw error; }
  console.info('[Study Space][Timetable] Import ready', { events: events.length, parsedEvents: debugData(events), bytes: text.length, durationMs: Date.now() - started });
  return { events, meta: { entryCount: (text.match(/BEGIN:VEVENT/gi) || []).length, bytes: text.length } };
}
