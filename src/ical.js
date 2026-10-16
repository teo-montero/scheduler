import ICAL from 'ical.js';
import { atTime, addDays, dateKey } from './dates.js';
function toDate(time, timezone) {
  if (!time) return null;
  if (time.zone?.tzid === 'UTC' || (time.zone?.tzid && time.zone.tzid !== 'floating')) return time.toJSDate();
  const key = `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
  return atTime(key, time.hour || 0, time.minute || 0, timezone || 'Europe/London');
}
export function parseTimetable(text, { from = new Date(), to = atTime(addDays(dateKey(from), 120)) } = {}) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('This URL did not return an iCalendar feed. Paste your UCL subscription URL, or import an .ics file.');
  const calendar = new ICAL.Component(ICAL.parse(text));
  for (const component of calendar.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(component.getFirstPropertyValue('tzid'), new ICAL.Timezone(component));
  }
  const components = calendar.getAllSubcomponents('vevent');
  const masters = components.filter(c => !c.hasProperty('recurrence-id'));
  const exceptions = components.filter(c => c.hasProperty('recurrence-id'));
  // Some exports contain a detached instance without its original series.
  const masterUids = new Set(masters.map(c => c.getFirstPropertyValue('uid')));
  masters.push(...exceptions.filter(c => !masterUids.has(c.getFirstPropertyValue('uid'))));
  const results = [], seen = new Set();
  for (const component of masters) {
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const event = new ICAL.Event(component);
    if (!event.startDate) continue;
    for (const exception of exceptions.filter(e => e.getFirstPropertyValue('uid') === event.uid)) event.relateException(new ICAL.Event(exception));
    const timezone = component.getFirstProperty('dtstart')?.getParameter('tzid');
    const add = (startTime, endTime, item = event) => {
      if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
      const zone = item.component.getFirstProperty('dtstart')?.getParameter('tzid') || timezone;
      const start = toDate(startTime, zone), end = toDate(endTime, zone);
      if (!start || !end || end <= start || start >= to || end <= from) return;
      const id = `timetable-${event.uid || event.summary}-${start.toISOString()}`;
      if (seen.has(id)) return;
      seen.add(id);
      results.push({ id, title: item.summary || event.summary || 'Timetable event', start: start.toISOString(), end: end.toISOString(), location: item.location || event.location || '', allDay: Boolean(startTime.isDate), source: 'ucl-timetable' });
    };
    if (event.isRecurring()) {
      const iterator = event.iterator();
      let complete = false;
      for (let i = 0; i < 50000; i++) {
        const occurrence = iterator.next();
        if (!occurrence || toDate(occurrence, timezone) >= to) { complete = true; break; }
        const detail = event.getOccurrenceDetails(occurrence);
        add(detail.startDate, detail.endDate, detail.item);
      }
      if (!complete) throw new Error('This calendar has a recurrence too large to expand. Export a shorter date range and import it as an .ics file.');
    } else add(event.startDate, event.endDate);
  }
  return results.sort((a, b) => new Date(a.start) - new Date(b.start));
}
export function validateCalendarUrl(value) {
  let url;
  try { url = new URL(value.trim().replace(/^webcal:/i, 'https:')); } catch { throw new Error('Enter a valid UCL timetable subscription URL.'); }
  const hostAllowed = ['timetable.apps.ucl.ac.uk', 'timetable.mesh.ucl.ac.uk'].includes(url.hostname);
  const legacyPath = /^\/icalendar\/[^/]+\/?$/.test(url.pathname);
  const proxyPath = url.hostname === 'timetable.mesh.ucl.ac.uk' && url.pathname === '/online-timetable-api-proxy/v0.1/icalendar' && Boolean(url.searchParams.get('key_identifier')?.trim());
  if (url.protocol !== 'https:' || !hostAllowed || url.username || url.password || url.port || (!legacyPath && !proxyPath)) throw new Error('Use your UCL /icalendar/… subscription URL or the timetable.mesh.ucl.ac.uk iCalendar API URL.');
  url.hash = '';
  return url.href;
}
export function calendarFetchUrl(value) {
  const url = new URL(validateCalendarUrl(value));
  if (url.pathname.startsWith('/icalendar/')) {
    // The legacy subscription responds with HTTP 307 to this proxy. Fetch it
    // directly so Chrome need not follow a cross-origin redirect.
    const identifier = decodeURIComponent(url.pathname.split('/')[2]);
    const proxy = new URL('https://timetable.mesh.ucl.ac.uk/online-timetable-api-proxy/v0.1/icalendar');
    proxy.searchParams.set('key_identifier', identifier);
    return proxy.href;
  }
  return url.href;
}
