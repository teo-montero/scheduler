export const TIME_ZONE = 'Europe/London';
const partsFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function dateParts(value = new Date(), timeZone = TIME_ZONE) {
  const format = timeZone === TIME_ZONE ? partsFormatter : new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return Object.fromEntries(format.formatToParts(new Date(value)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
export function dateKey(value = new Date()) {
  const p = dateParts(value);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
export function atTime(key, hours = 0, minutes = 0, timeZone = TIME_ZONE) {
  const [year, month, day] = key.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, hours, minutes);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = dateParts(guess, timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
export function addDays(key, count) { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); }
export function weekday(key) { return new Date(`${key}T12:00:00Z`).getUTCDay(); }
export function weekStart(value = new Date()) { const key = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateKey(value); return addDays(key, -((weekday(key) + 6) % 7)); }
export function minutesOfDay(value) { const p = dateParts(value); return p.hour * 60 + p.minute; }
export function formatTime(value) { return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
export function formatDate(value, options = {}) { return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', ...options }).format(new Date(value)); }
export function durationLabel(minutes) { return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`; }
