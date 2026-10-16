import { addDays, atTime, weekStart } from './dates.js';
import { scheduleTasks, DEFAULT_SETTINGS } from './scheduler.js';
export function createDemo(now = new Date()) {
  const monday = weekStart(now);
  const courses = [
    { id: 1, shortname: 'COMP0005', name: 'Algorithms' },
    { id: 2, shortname: 'COMP0004', name: 'Object-Oriented Programming' },
    { id: 3, shortname: 'MATH0010', name: 'Mathematical Methods' },
    { id: 4, shortname: 'COMP0011', name: 'Database and Information Management' }
  ];
  const tasks = [
    { id: 'demo-algorithms', courseId: 1, courseName: 'COMP0005', title: 'Algorithm analysis coursework', type: 'assignment', dueDate: atTime(addDays(monday, 4), 17).toISOString(), estimatedMinutes: 180 },
    { id: 'demo-maths', courseId: 3, courseName: 'MATH0010', title: 'Maths problem sheet 3', type: 'assignment', dueDate: atTime(addDays(monday, 6), 23, 59).toISOString(), estimatedMinutes: 120 },
    { id: 'demo-java', courseId: 2, courseName: 'COMP0004', title: 'Java practice: inheritance', type: 'assignment', dueDate: atTime(addDays(monday, 7), 16).toISOString(), estimatedMinutes: 150 },
    { id: 'demo-database', courseId: 4, courseName: 'COMP0011', title: 'Relational databases quiz', type: 'quiz', dueDate: atTime(addDays(monday, 9), 12).toISOString(), estimatedMinutes: 90 },
    { id: 'demo-reading', courseId: 1, courseName: 'COMP0005', title: 'Read: asymptotic notation', type: 'resource', dueDate: atTime(addDays(monday, 2), 12).toISOString(), estimatedMinutes: 30, completed: true }
  ].map(t => ({ ...t, completed: Boolean(t.completed), source: 'demo', url: null }));
  const events = [];
  for (let week = 0; week < 4; week++) {
    for (const [day, hour, length, title, courseId, location] of [
      [0, 10, 1, 'Algorithms · lecture', 1, 'Roberts G06'], [0, 14, 2, 'Programming · lab', 2, 'Malet Place 1.05'],
      [1, 11, 1, 'Mathematical methods', 3, 'Christopher Ingold XLG2'], [1, 15, 1, 'Databases · seminar', 4, 'Pearson G22'],
      [2, 10, 2, 'Algorithms · workshop', 1, 'Roberts 508'], [3, 9, 1, 'Programming · lecture', 2, 'Darwin B40'],
      [3, 14, 1, 'Mathematics · tutorial', 3, '25 Gordon Street'], [4, 11, 1, 'Databases · lecture', 4, 'Roberts G06']
    ]) events.push({ id: `demo-event-${week}-${day}-${hour}`, title, courseId, location, start: atTime(addDays(monday, day + week * 7), hour).toISOString(), end: atTime(addDays(monday, day + week * 7), hour + length).toISOString(), source: 'ucl-timetable' });
  }
  const plan = scheduleTasks({ tasks, events, now: atTime(monday, 9) });
  return { version: 1, mode: 'demo', courseContent: {}, moodleCalendarTasks: [], excludedCourseIds: [], courses, tasks, events, blocked: [], preferences: {}, settings: { ...DEFAULT_SETTINGS }, calendarUrl: '', moodleSyncedAt: null, calendarSyncedAt: null, ...plan, messages: [] };
}
export function emptyWorkspace(settings = DEFAULT_SETTINGS) {
  return { version: 1, mode: 'live', courseContent: {}, moodleCalendarTasks: [], excludedCourseIds: [], courses: [], tasks: [], events: [], blocked: [], preferences: {}, settings: { ...settings }, calendarUrl: '', moodleSyncedAt: null, calendarSyncedAt: null, blocks: [], unscheduled: [], messages: [] };
}
