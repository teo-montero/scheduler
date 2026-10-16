import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleTasks } from '../src/scheduler.js';
import { atTime, dateKey, addDays, weekStart } from '../src/dates.js';
import { parseCommand } from '../src/commands.js';
import { parseTimetable, validateCalendarUrl, calendarFetchUrl } from '../src/ical.js';
const monday = '2026-10-19';
const now = atTime(monday, 9);
const task = (id, minutes, day = 2) => ({ id, title: id, courseName: 'MATH0010', estimatedMinutes: minutes, dueDate: atTime(addDays(monday, day), 17).toISOString(), completed: false });
const total = blocks => blocks.reduce((n, b) => n + (new Date(b.end) - new Date(b.start)) / 60000, 0);
const overlaps = (a, b) => new Date(a.start) < new Date(b.end) && new Date(a.end) > new Date(b.start);
test('deadline-first scheduling respects classes, personal time, work hours and breaks', () => {
  const events = [{ start: atTime(monday, 10), end: atTime(monday, 12) }];
  const blocked = [{ start: atTime(monday, 14), end: atTime(monday, 18) }];
  const tasks = [task('later', 180, 4), task('early', 180, 1)];
  const plan = scheduleTasks({ tasks, events, blocked, now });
  assert.equal(plan.unscheduled.length, 0);
  assert.equal(total(plan.blocks), 360);
  assert.equal(plan.blocks[0].taskId, 'early');
  for (const b of plan.blocks) {
    assert.ok(new Date(b.start) >= now);
    assert.ok(new Date(b.end) <= new Date(tasks.find(t => t.id === b.taskId).dueDate));
    assert.ok([...events, ...blocked].every(e => !overlaps(b, e)));
    assert.ok(new Date(b.start) >= atTime(dateKey(b.start), 9));
    assert.ok(new Date(b.end) <= atTime(dateKey(b.start), 18));
  }
  for (let i = 1; i < plan.blocks.length; i++) assert.ok(new Date(plan.blocks[i].start) - new Date(plan.blocks[i - 1].end) >= 10 * 60000);
});
test('reports exact unplanned work and never places work after deadline', () => {
  const t = { ...task('urgent', 120), dueDate: atTime(monday, 10).toISOString() };
  const p = scheduleTasks({ tasks: [t], now });
  assert.equal(total(p.blocks), 50); assert.equal(p.unscheduled[0].minutes, 70);
  assert.ok(p.blocks.every(b => new Date(b.end) <= new Date(t.dueDate)));
});
test('ignores completed tasks, flags overdue ones and supports undated tasks', () => {
  const p = scheduleTasks({ tasks: [{ ...task('done', 50), completed: true }, { ...task('old', 50), dueDate: atTime(addDays(monday, -1), 17).toISOString() }, { ...task('undated', 90), dueDate: null }], now });
  assert.equal(total(p.blocks), 90); assert.equal(p.unscheduled.length, 1); assert.equal(p.unscheduled[0].reason, 'Deadline has passed');
});
test('day preference is honored without silently spilling into other days', () => {
  const p = scheduleTasks({ tasks: [task('maths', 180, 5)], preferences: { maths: { date: addDays(monday, 4) } }, now });
  assert.ok(p.blocks.every(b => dateKey(b.start) === addDays(monday, 4)));
  const noRoom = scheduleTasks({ tasks: [task('maths', 180, 5)], preferences: { maths: { date: addDays(monday, 4) } }, settings: { startHour: 9, endHour: 10 }, now });
  assert.equal(total(noRoom.blocks), 50); assert.equal(noRoom.unscheduled[0].minutes, 130);
});
test('weekends are skipped unless enabled', () => {
  const saturday = atTime('2026-10-17', 9), t = { ...task('weekend', 50), dueDate: atTime('2026-10-18', 18).toISOString() };
  assert.equal(scheduleTasks({ tasks: [t], now: saturday }).blocks.length, 0);
  assert.equal(total(scheduleTasks({ tasks: [t], settings: { weekends: true }, now: saturday }).blocks), 50);
});
test('London dates and scheduling remain correct across autumn clock change', () => {
  assert.equal(atTime('2026-10-23', 9).toISOString(), '2026-10-23T08:00:00.000Z');
  assert.equal(atTime('2026-10-26', 9).toISOString(), '2026-10-26T09:00:00.000Z');
  assert.equal(weekStart('2026-10-25'), '2026-10-19');
  const p = scheduleTasks({ tasks: [task('dst', 50, 12)], preferences: { dst: { date: '2026-10-26' } }, now });
  assert.equal(p.blocks[0].start, '2026-10-26T09:00:00.000Z');
});
const calendar = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n${body}\r\nEND:VCALENDAR`;
const vevent = body => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT`;
test('ICS handles TZID, weekly recurrence, exclusions, folding and escaped text', () => {
  const text = calendar(vevent('UID:weekly\r\nDTSTART;TZID=Europe/London:20261019T100000\r\nDTEND;TZID=Europe/London:20261019T110000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=Europe/London:20261026T100000\r\nSUMMARY:Algorithms\\, lecture and a long\r\n  title\r\nLOCATION:Roberts\\; G06'));
  const events = parseTimetable(text, { from: atTime('2026-10-18'), to: atTime('2026-11-10') });
  assert.equal(events.length, 2);
  assert.equal(events[0].start, '2026-10-19T09:00:00.000Z');
  assert.equal(events[1].start, '2026-11-02T10:00:00.000Z');
  assert.equal(events[0].title, 'Algorithms, lecture and a long title');
  assert.equal(events[0].location, 'Roberts; G06');
});
test('ICS handles UTC events and all-day blocking', () => {
  const text = calendar(vevent('UID:utc\r\nDTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\nSUMMARY:UTC lecture') + '\r\n' + vevent('UID:all-day\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021\r\nSUMMARY:Reading day'));
  const events = parseTimetable(text, { from: atTime('2026-10-18') });
  assert.equal(events.length, 2); assert.ok(events[1].allDay);
  const p = scheduleTasks({ tasks: [task('reading', 50)], events, preferences: { reading: { date: '2026-10-20' } }, now });
  assert.equal(p.blocks.length, 0);
});
test('ICS applies recurrence overrides and cancellations', () => {
  const master = vevent('UID:override\r\nDTSTART;TZID=Europe/London:20261019T100000\r\nDTEND;TZID=Europe/London:20261019T110000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Original');
  const moved = vevent('UID:override\r\nRECURRENCE-ID;TZID=Europe/London:20261026T100000\r\nDTSTART;TZID=Europe/London:20261026T140000\r\nDTEND;TZID=Europe/London:20261026T150000\r\nSUMMARY:Moved');
  const cancelled = vevent('UID:override\r\nRECURRENCE-ID;TZID=Europe/London:20261102T100000\r\nDTSTART;TZID=Europe/London:20261102T100000\r\nDTEND;TZID=Europe/London:20261102T110000\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled');
  const events = parseTimetable(calendar([master, moved, cancelled].join('\r\n')), { from: atTime('2026-10-18'), to: atTime('2026-11-10') });
  assert.equal(events.length, 2); assert.equal(events[1].title, 'Moved'); assert.equal(events[1].start, '2026-10-26T14:00:00.000Z');
});
test('private calendar URLs are restricted to expected UCL hosts and paths', () => {
  assert.equal(validateCalendarUrl('webcal://timetable.apps.ucl.ac.uk/icalendar/example'), 'https://timetable.apps.ucl.ac.uk/icalendar/example');
  for (const url of ['https://evil.test/icalendar/a', 'https://timetable.apps.ucl.ac.uk.evil.test/icalendar/a', 'http://timetable.apps.ucl.ac.uk/icalendar/a', 'https://user:pass@timetable.apps.ucl.ac.uk/icalendar/a', 'https://timetable.apps.ucl.ac.uk/not-calendar']) assert.throws(() => validateCalendarUrl(url));
  assert.throws(() => parseTimetable('<html>Sign in</html>'));
});
test('chat supports busy periods, completing tasks, moves and ambiguous matches', () => {
  const tasks = [{ ...task('maths sheet', 120, 6), title: 'Maths problem sheet 3' }, { ...task('maths quiz', 60, 6), title: 'Maths quiz' }];
  const busy = parseCommand('I’m busy Wednesday afternoon', tasks, now);
  assert.equal(busy.type, 'block'); assert.equal(busy.event.start, atTime('2026-10-21', 12).toISOString());
  assert.equal(parseCommand('Finished maths problem sheet', tasks, now).type, 'complete');
  assert.ok(parseCommand('Finished maths', tasks, now).error);
  assert.equal(parseCommand('Move maths problem sheet to Friday', tasks, now).date, '2026-10-23');
  assert.ok(parseCommand('What’s for lunch?', tasks, now).error);
  assert.ok(parseCommand('I’m busy Wednesday', tasks, now).error);
  assert.ok(parseCommand('I’m busy Wednesday 14:00–13:00', tasks, now).error);
  assert.equal(parseCommand('I’m busy Wednesday 14:00–17:00', tasks, now).type, 'block');
  assert.ok(parseCommand('I’m busy Wednesday 2–5pm', tasks, now).error);
});

test('UCL 307 redirect target is accepted and legacy feeds resolve directly to the mesh proxy', () => {
  const direct = 'https://timetable.mesh.ucl.ac.uk/online-timetable-api-proxy/v0.1/icalendar?key_identifier=synthetic-test-key';
  assert.equal(calendarFetchUrl('https://timetable.apps.ucl.ac.uk/icalendar/synthetic-test-key'), direct);
  assert.equal(calendarFetchUrl('webcal://timetable.apps.ucl.ac.uk/icalendar/synthetic-test-key'), direct);
  assert.equal(validateCalendarUrl(direct), direct);
  assert.equal(calendarFetchUrl(direct), direct);
  assert.throws(() => validateCalendarUrl('https://timetable.mesh.ucl.ac.uk/online-timetable-api-proxy/v0.1/icalendar'));
  assert.throws(() => validateCalendarUrl('https://evil.test/online-timetable-api-proxy/v0.1/icalendar?key_identifier=test'));
});
