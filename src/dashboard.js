import { BUILD_ID, TIMETABLE_ORIGINS } from './protocol.js';
import { addDays, atTime, dateKey, dateParts, weekStart, minutesOfDay, formatTime, formatDate, durationLabel } from './dates.js';
import { scheduleTasks } from './scheduler.js';
import { createDemo, emptyWorkspace } from './demo.js';
import { parseCommand } from './commands.js';
import { parseTimetable, validateCalendarUrl } from './ical.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isExtension = Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local);
const COLORS = ['#b5c7a1', '#d7c3aa', '#bcb0d0', '#a8c6ca', '#d4b4b5', '#c7cc99'];
let state, currentWeek = weekStart(), currentView = 'week', selectedCourse = null, toastTimer, syncing = false, calendarSyncing = false;
function courseColor(id) { const index = state.courses.findIndex(c => String(c.id) === String(id)); return COLORS[Math.max(0, index) % COLORS.length]; }
function toast(message, long = false) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), long ? 10000 : 5000); }
async function persist() {
  try {
    if (isExtension) await chrome.storage.local.set({ workspace: state });
    else localStorage.setItem('studyspace-workspace-v1', JSON.stringify(state));
  } catch { toast('Your browser could not save this workspace. Changes will last only while this page is open.', true); }
}
function regenerate() {
  const plan = scheduleTasks({ tasks: state.tasks, events: state.events, blocked: state.blocked, preferences: state.preferences, settings: state.settings });
  state.blocks = plan.blocks; state.unscheduled = plan.unscheduled;
}
async function changeAndRender(replan = true) { if (replan) regenerate(); await persist(); render(); }
function weekEvents() {
  const start = atTime(currentWeek), end = atTime(addDays(currentWeek, 7));
  return [...state.events, ...state.blocks, ...state.blocked].filter(e => new Date(e.end) > start && new Date(e.start) < end);
}
function dueLabel(task) {
  if (!task.dueDate) return { text: 'No deadline', className: '' };
  const due = new Date(task.dueDate), today = dateKey();
  if (due < new Date()) return { text: 'Overdue', className: 'overdue' };
  if (dateKey(due) === today) return { text: `Today, ${formatTime(due)}`, className: 'urgent' };
  if (dateKey(due) === addDays(today, 1)) return { text: 'Tomorrow', className: 'urgent' };
  return { text: formatDate(due, { weekday: 'short' }), className: '' };
}
function sortedTasks(tasks = state.tasks) { return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)); }
function taskMarkup(task) {
  const due = dueLabel(task);
  return `<article class="task-item ${task.completed ? 'task-completed' : ''}"><button class="task-check ${task.completed ? 'checked' : ''}" data-complete="${escape(task.id)}" aria-label="${task.completed ? 'Reopen' : 'Complete'} ${escape(task.title)}" aria-pressed="${task.completed}">${icon('check')}</button><div class="task-info"><div class="task-course"><span class="course-dot" style="--course-color:${courseColor(task.courseId)}"></span>${escape(task.courseName || 'Personal')}</div><button class="task-title" data-edit-task="${escape(task.id)}">${escape(task.title)}</button><div class="task-bottom"><span class="due-label ${task.completed ? '' : due.className}">${task.completed ? 'Completed' : escape(due.text)}</span><span class="task-estimate">${icon('clock')}${durationLabel(task.estimatedMinutes)}</span></div></div></article>`;
}
function render() {
  $('#today-label').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
  $('#sample-banner').hidden = state.mode !== 'demo';
  $('#mode-badge').innerHTML = `<span></span>${state.mode === 'demo' ? 'Sample workspace' : 'Your workspace'}`;
  $('#mode-badge').classList.toggle('connected', state.mode !== 'demo');
  $('#profile-mode').textContent = state.mode === 'demo' ? 'Demo workspace' : 'Saved on this device';
  const pending = state.tasks.filter(t => !t.completed), done = state.tasks.filter(t => t.completed).length;
  $('#nav-task-count').textContent = pending.length;
  $('#module-count').textContent = state.courses.length.toString().padStart(2, '0');
  $('#sidebar-courses').innerHTML = state.courses.length ? state.courses.slice(0, 8).map(c => `<button class="sidebar-course ${String(selectedCourse) === String(c.id) ? 'selected' : ''}" data-course="${escape(c.id)}"><span class="course-dot" style="--course-color:${courseColor(c.id)}"></span><span>${escape(c.shortname || c.name)}<small>${escape(c.name)}</small></span></button>`).join('') : '<p class="field-help" style="padding:0 12px;font-size:10px;color:#98a18d">Sync Moodle to see your modules.</p>';
  const events = weekEvents();
  const focusMinutes = events.filter(e => e.source === 'study').reduce((sum, e) => sum + (new Date(e.end) - new Date(e.start)) / 60000, 0);
  $('#stat-focus').innerHTML = `${durationLabel(focusMinutes)} <span>planned</span>`;
  $('#stat-focus-detail').textContent = `${events.filter(e => e.source === 'study').length} focus sessions, with room to pause.`;
  $('#stat-tasks').innerHTML = `${pending.length} <span>${pending.length === 1 ? 'task' : 'tasks'} to go</span>`;
  $('#stat-tasks-detail').textContent = done ? `${done} ${done === 1 ? 'task' : 'tasks'} already checked off. Nice work.` : 'One small step at a time.';
  $('#stat-health').textContent = state.unscheduled.length ? `${state.unscheduled.length} need space` : pending.length ? 'Looking balanced' : 'A fresh start';
  $('#stat-health-detail').textContent = state.unscheduled.length ? 'Some work won’t fit. Check your tasks.' : `${state.settings.breakMinutes}-minute breaks are built in.`;
  $('#stat-health').classList.toggle('plan-warning', state.unscheduled.length > 0);
  $('#plan-caption').textContent = state.mode === 'demo' ? 'Sample plan · connect your data to make it yours.' : state.unscheduled.length ? `${state.unscheduled.length} task${state.unscheduled.length === 1 ? '' : 's'} need more time before the deadline.` : 'Your plan leaves room for breaks.';
  $('#plan-caption').classList.toggle('plan-warning', state.unscheduled.length > 0);
  renderCalendar(events);
  $('#upcoming-tasks').innerHTML = sortedTasks(pending).slice(0, 4).map(taskMarkup).join('') || `<div class="empty-state">${icon('check')}${state.tasks.length ? 'All caught up. Take a breath.' : 'A fresh page. Sync Moodle or add your first task.'}</div>`;
  renderTasks(); renderCourses(); renderChat();
}
function renderCalendar(events) {
  $('#week-range').textContent = `${formatDate(atTime(currentWeek), { month: 'long' })} – ${formatDate(atTime(addDays(currentWeek, 6)), { month: 'long', year: 'numeric' })}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));
  const startHour = Math.min(8, state.settings.startHour), endHour = Math.max(19, state.settings.endHour);
  const height = (endHour - startHour) * 60;
  $('#calendar-head').innerHTML = `<div>GMT/BST</div>${days.map(key => `<div class="${key === dateKey() ? 'is-today' : ''}"><span class="day-name">${formatDate(atTime(key), { weekday: 'short' }).split(',')[0].split(' ')[0]}</span><span class="day-number">${Number(key.slice(-2))}</span></div>`).join('')}`;
  const axis = `<div class="time-axis">${Array.from({ length: endHour - startHour }, (_, i) => `<span class="time-label" style="top:${i * 60}px">${String(startHour + i).padStart(2, '0')}:00</span>`).join('')}</div>`;
  const columns = days.map((key, i) => {
    const dayStart = atTime(key, startHour).getTime(), dayEnd = atTime(key, endHour).getTime();
    const items = events.filter(e => new Date(e.start).getTime() < dayEnd && new Date(e.end).getTime() > dayStart).map(e => ({ ...e, top: Math.max(0, (new Date(e.start) - dayStart) / 60000), bottom: Math.min(height, (new Date(e.end) - dayStart) / 60000) })).sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    // Assign lanes within each connected overlap group, so simultaneous classes remain visible.
    let group = [], groupEnd = -1;
    function assignGroup() {
      const laneEnds = [];
      for (const item of group) { let lane = laneEnds.findIndex(end => end <= item.top); if (lane < 0) lane = laneEnds.length; laneEnds[lane] = item.bottom; item.lane = lane; }
      group.forEach(item => { item.lanes = laneEnds.length; });
    }
    for (const item of items) { if (item.top >= groupEnd && group.length) { assignGroup(); group = []; groupEnd = -1; } group.push(item); groupEnd = Math.max(groupEnd, item.bottom); }
    assignGroup();
    const markup = items.map(e => {
      const h = Math.max(14, e.bottom - e.top - 3), cls = e.source === 'study' ? 'study' : e.source === 'personal' ? 'personal' : 'lecture';
      const time = e.allDay ? 'All day' : `${formatTime(e.start)}–${formatTime(e.end)}`;
      const location = e.source === 'study' ? `Focus · ${e.courseName || 'Personal'}` : e.location;
      return `<button class="calendar-event ${cls} ${h < 32 ? 'short' : ''}" data-event="${escape(e.id)}" style="top:${e.top}px;height:${h}px;left:calc(${e.lane / e.lanes * 100}% + 3px);width:calc(${100 / e.lanes}% - 6px)" title="${escape(`${time} · ${e.title}${location ? ` · ${location}` : ''}`)}" aria-label="${escape(`${e.title}, ${time}`)}"><span class="event-time">${time}</span><strong>${escape(e.title)}</strong>${location && h > 55 ? `<span class="event-location">${escape(location)}</span>` : ''}</button>`;
    }).join('');
    const minute = minutesOfDay(new Date()) - startHour * 60;
    const now = key === dateKey() && minute >= 0 && minute < height ? `<div class="now-line" style="top:${minute}px"></div>` : '';
    return `<div class="day-column ${i > 4 ? 'weekend' : ''} ${key === dateKey() ? 'today' : ''}">${markup}${now}</div>`;
  }).join('');
  $('#calendar-body').style.height = `${height}px`; $('#calendar-body').innerHTML = axis + columns;
}
function renderTasks() {
  const filter = $('#task-filter').value;
  const tasks = sortedTasks().filter(t => (filter !== 'pending' || !t.completed) && (filter !== 'completed' || t.completed) && (selectedCourse === null || String(t.courseId) === String(selectedCourse)));
  let notice = '';
  if (selectedCourse !== null) notice += `<div class="filtered-note">Showing ${escape(state.courses.find(c => String(c.id) === String(selectedCourse))?.shortname || 'selected module')}<button data-clear-course>Show all modules</button></div>`;
  const relevantWarnings = state.unscheduled.filter(u => tasks.some(t => t.id === u.taskId));
  if (relevantWarnings.length) notice += `<div class="filtered-note plan-warning">${relevantWarnings.map(u => `${escape(state.tasks.find(t => t.id === u.taskId)?.title)}: ${durationLabel(u.minutes)} unplanned — ${escape(u.reason.toLowerCase())}.`).join('<br>')}</div>`;
  $('#all-tasks').innerHTML = notice + (tasks.length ? tasks.map(taskMarkup).join('') : `<div class="empty-state">${icon('check')}No tasks here. Enjoy a little breathing room.</div>`);
}
function renderCourses() {
  $('#course-cards').innerHTML = state.courses.map(c => {
    const tasks = state.tasks.filter(t => String(t.courseId) === String(c.id)), completed = tasks.filter(t => t.completed).length;
    return `<article class="course-card"><span class="course-code"><span class="course-dot" style="--course-color:${courseColor(c.id)}"></span>${escape(c.shortname)}</span><h3>${escape(c.name)}</h3><div class="course-progress"><span style="width:${tasks.length ? completed / tasks.length * 100 : 0}%"></span></div><p>${completed} of ${tasks.length} tasks completed</p><button data-course="${escape(c.id)}">View module tasks ↗</button></article>`;
  }).join('') || `<div class="empty-state">${icon('book')}Sync Moodle to bring your modules into one space.</div>`;
}
function renderChat() {
  $('#chat-messages').innerHTML = state.messages.slice(-12).map(m => `<div class="chat-message ${m.role === 'user' ? 'user' : ''}">${escape(m.text)}</div>`).join('');
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}
function setView(view) {
  currentView = view;
  $('#week-view').hidden = view !== 'week'; $('#tasks-view').hidden = view !== 'tasks'; $('#courses-view').hidden = view !== 'courses';
  $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#breadcrumb-view').textContent = { week: 'My week', tasks: 'All tasks', courses: 'My modules' }[view];
}
function openSettings() {
  $('#calendar-error').textContent = '';
  $('#calendar-url').value = state.calendarUrl || '';
  $('#moodle-status').textContent = state.moodleSyncedAt ? `Last synced ${formatDate(state.moodleSyncedAt)}, ${formatTime(state.moodleSyncedAt)}` : 'Not connected';
  showCalendarResult();
  $('#planner-version').textContent = isExtension ? `Study Space ${chrome.runtime.getManifest().version}` : 'Browser preview · live sync requires the extension';
  $('#start-hour').value = state.settings.startHour; $('#end-hour').value = state.settings.endHour; $('#block-minutes').value = state.settings.blockMinutes; $('#break-minutes').value = state.settings.breakMinutes; $('#weekends').checked = state.settings.weekends;
  $('#settings-error').textContent = ''; renderBlocked(); $('#settings-dialog').showModal();
}
function renderBlocked() {
  $('#blocked-list').innerHTML = state.blocked.length ? [...state.blocked].sort((a, b) => new Date(a.start) - new Date(b.start)).map(e => `<div class="blocked-row"><div>${escape(e.title)}<small>${formatDate(e.start, { weekday: 'short' })} · ${formatTime(e.start)}–${formatTime(e.end)}</small></div><button type="button" class="icon-button" data-remove-block="${escape(e.id)}" aria-label="Remove ${escape(e.title)}">${icon('x')}</button></div>`).join('') : '<p class="field-help">Ask your planner to block time, e.g. “I’m busy Wednesday afternoon”.</p>';
}
function openTask(task = null) {
  $('#task-form').reset(); $('#task-error').textContent = '';
  $('#task-course').innerHTML = '<option value="0">Personal / independent study</option>' + state.courses.map(c => `<option value="${escape(c.id)}">${escape(c.shortname || c.name)}</option>`).join('');
  $('#task-id').value = task?.id || ''; $('#task-title').value = task?.title || ''; $('#task-course').value = task?.courseId || '0'; $('#task-estimate').value = task?.estimatedMinutes || 120;
  if (task?.dueDate) { const p = dateParts(task.dueDate); $('#task-due').value = `${dateKey(task.dueDate)}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; }
  const fromMoodle = task?.source === 'moodle';
  ['task-title', 'task-course', 'task-due'].forEach(id => { $(`#${id}`).disabled = Boolean(fromMoodle); });
  $('#task-source-note').hidden = !fromMoodle;
  $('#delete-task-button').hidden = !task || fromMoodle;
  $('#task-dialog-title').textContent = task ? 'A little adjustment.' : 'Make a little progress.';
  $('#task-dialog').showModal(); $('#task-title').focus();
}
function safeMoodleUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'moodle.ucl.ac.uk' ? url.href : null; } catch { return null; } }
function openEvent(id) {
  const event = [...state.events, ...state.blocks, ...state.blocked].find(e => e.id === id);
  if (!event) return;
  const task = state.tasks.find(t => t.id === event.taskId), url = safeMoodleUrl(task?.url);
  $('#event-detail').innerHTML = `<span class="task-course">${event.source === 'study' ? 'FOCUS SESSION' : event.source === 'personal' ? 'PERSONAL TIME' : 'UCL TIMETABLE'}</span><h2>${escape(event.title)}</h2><p>${formatDate(event.start, { weekday: 'long' })}<br>${event.allDay ? 'All day' : `${formatTime(event.start)} – ${formatTime(event.end)}`} · London time${event.location ? `<br>${escape(event.location)}` : ''}</p>${task ? `<p class="event-detail-note">Part of ${durationLabel(task.estimatedMinutes)} of planned work${task.dueDate ? ` · due ${formatDate(task.dueDate)}, ${formatTime(task.dueDate)}` : ''}. Complete the task when all its work is done.</p><button class="button primary" data-complete="${escape(task.id)}">${icon('check')}Mark task complete</button> <button class="button secondary" data-edit-task="${escape(task.id)}">Edit task</button>${url ? `<p><a class="text-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Open in Moodle ↗</a></p>` : ''}` : event.source === 'personal' ? `<button class="button secondary" data-remove-block="${escape(event.id)}">Remove personal time</button>` : ''}`;
  $('#event-dialog').showModal();
}
async function extensionRequest(message) {
  if (!isExtension) throw new Error('Live sync works in the Chrome extension. Run npm run build, load the dist folder in chrome://extensions, then open Study Space from the toolbar.');
  let result;
  try { result = await chrome.runtime.sendMessage({ ...message, buildId: BUILD_ID }); }
  catch { throw new Error('This planner tab lost its extension connection. Reload Study Space in chrome://extensions, then refresh this tab.'); }
  if (result?.buildId !== BUILD_ID) throw new Error('An older extension worker is still running. Reload Study Space in chrome://extensions, then refresh this planner tab.');
  if (!result?.ok) throw new Error(result?.error || 'The extension could not complete the sync. Reload it and try again.');
  return result;
}
async function syncMoodle() {
  if (syncing) return;
  syncing = true; $('#sync-button').disabled = true; $('#sync-button svg').classList.add('spin'); $('#sync-button span').textContent = 'Syncing…';
  try {
    const result = await extensionRequest({ type: 'SYNC_MOODLE' });
    if (state.mode === 'demo') state = emptyWorkspace(state.settings);
    const existing = new Map(state.tasks.map(t => [t.id, t]));
    if (result.tasks !== null) state.tasks = [...state.tasks.filter(t => t.source !== 'moodle' || (t.completed && !result.tasks.some(incoming => incoming.id === t.id))), ...result.tasks.map(t => ({ ...t, completed: existing.get(t.id)?.completed || false, estimatedMinutes: existing.get(t.id)?.estimatedMinutes ?? t.estimatedMinutes }))];
    state.courses = result.courses; state.moodleSyncedAt = new Date().toISOString(); selectedCourse = null;
    await changeAndRender();
    toast(result.warnings?.length ? result.warnings.join(' ') : `${result.courses.length} modules and ${result.tasks.length} deadlines synced. Your plan is up to date.`, Boolean(result.warnings?.length));
  } catch (error) { toast(error.message, true); }
  finally { syncing = false; $('#sync-button').disabled = false; $('#sync-button svg').classList.remove('spin'); $('#sync-button span').textContent = 'Sync Moodle'; }
}
async function replaceTimetable(events, url = '') {
  if (state.mode === 'demo') state = emptyWorkspace(state.settings);
  state.events = events; state.calendarUrl = url; state.calendarSyncedAt = new Date().toISOString();
  await changeAndRender();
  showCalendarResult();
  $('#moodle-status').textContent = state.moodleSyncedAt ? `Last synced ${formatDate(state.moodleSyncedAt)}` : 'Not connected';
  toast(`${events.length} timetable events imported. Your plan has been updated.`);
}
function showCalendarResult(meta = null) {
  const connected = Boolean(state.calendarSyncedAt);
  $('#calendar-result').hidden = !connected;
  $('#calendar-status').textContent = connected ? `${state.events.length} event${state.events.length === 1 ? '' : 's'} imported · updated ${formatDate(state.calendarSyncedAt)}, ${formatTime(state.calendarSyncedAt)}.` : 'Paste your subscription link and click Sync timetable to download its classes.';
  $('#calendar-status').classList.toggle('calendar-success', connected);
  if (!connected) return;
  const upcoming = state.events.filter(e => new Date(e.end) >= new Date()).slice(0, 4);
  $('#calendar-result-summary').textContent = state.events.length ? `Your calendar is connected.${meta ? ` Downloaded ${meta.entryCount} calendar entries.` : ''} Here are your next classes:` : 'The feed was downloaded, but it contains no classes in the next 120 days. Check the subscription and its dates.';
  $('#calendar-preview').innerHTML = upcoming.map(e => `<div class="calendar-preview-event"><strong>${escape(e.title)}</strong><span>${formatDate(e.start, { weekday: 'short' })} · ${formatTime(e.start)}–${formatTime(e.end)}${e.location ? ` · ${escape(e.location)}` : ''}</span></div>`).join('');
  $('#view-imported-calendar').hidden = state.events.length === 0;
}
async function syncTimetableFromForm() {
  if (calendarSyncing) return false;
  const button = $('#sync-calendar-button');
  $('#settings-error').textContent = '';
  $('#calendar-error').textContent = '';
  let url;
  try {
    url = validateCalendarUrl($('#calendar-url').value);
    if (!isExtension) throw new Error('Live calendar subscriptions require the Chrome extension. Open Study Space from its Chrome toolbar icon, or import an .ics file in this preview.');
    // This call stays inside the button/form's user gesture. Chrome shows a
    // permission prompt only if access to the requested UCL hosts was withheld.
    const permission = chrome.permissions.request({ origins: TIMETABLE_ORIGINS });
    calendarSyncing = true; button.disabled = true;
    $('#save-preferences-button').disabled = true;
    button.innerHTML = `${icon('sync')}Downloading…`;
    button.querySelector('svg').classList.add('spin');
    $('#calendar-status').classList.remove('calendar-success');
    $('#calendar-status').textContent = 'Downloading your calendar from UCL…';
    if (!await permission) throw new Error('Calendar access was not allowed. Click Sync timetable again and allow the two UCL timetable sites.');
    const result = await extensionRequest({ type: 'SYNC_TIMETABLE', url });
    $('#calendar-status').textContent = 'Adding your classes to the calendar…';
    await replaceTimetable(result.events, url);
    showCalendarResult(result.meta);
    return true;
  } catch (error) {
    $('#calendar-error').textContent = error.message;
    $('#calendar-error').scrollIntoView({ block: 'nearest' });
    $('#calendar-status').textContent = state.calendarSyncedAt ? 'Sync failed. Your previous calendar has been kept.' : 'Calendar not connected. See the message below.';
    return false;
  } finally {
    calendarSyncing = false; button.disabled = false;
    $('#save-preferences-button').disabled = false;
    button.innerHTML = `${icon('sync')}Sync timetable`;
  }
}
async function submitChat(text) {
  state.messages.push({ role: 'user', text });
  const command = parseCommand(text, state.tasks);
  let response;
  if (command.error) response = command.error;
  else if (command.type === 'block') {
    if (state.blocked.some(e => e.id === command.event.id)) response = 'That time is already blocked in your calendar.';
    else { state.blocked.push(command.event); regenerate(); response = `Your ${formatDate(command.event.start, { weekday: 'long' })}, ${formatTime(command.event.start)}–${formatTime(command.event.end)}, is now protected. I’ve moved your study sessions around it. Your timetable commitments stay in place.`; }
  } else if (command.type === 'complete') {
    command.task.completed = true; regenerate(); response = `“${command.task.title}” is checked off. I’ve cleared its study sessions and updated your plan. Enjoy a little extra breathing room.`;
  } else if (command.type === 'move') {
    state.preferences[command.task.id] = { date: command.date }; regenerate();
    const missing = state.unscheduled.find(u => u.taskId === command.task.id);
    response = missing ? `I’ve kept “${command.task.title}” on ${formatDate(atTime(command.date), { weekday: 'long' })}, but ${durationLabel(missing.minutes)} won’t fit before the deadline. Try another day or extend your study hours in Preferences.` : `“${command.task.title}” is now planned for ${formatDate(atTime(command.date), { weekday: 'long' })}. I’ve worked around your commitments and kept breaks between sessions.`;
  }
  if (!command.error && command.type !== 'move' && state.unscheduled.length) response += ` ${state.unscheduled.length} task${state.unscheduled.length === 1 ? '' : 's'} still need more time; check All tasks for details.`;
  state.messages.push({ role: 'assistant', text: response }); state.messages = state.messages.slice(-30);
  await persist(); render();
}

async function init() {
  try {
    state = isExtension ? (await chrome.storage.local.get('workspace')).workspace : JSON.parse(localStorage.getItem('studyspace-workspace-v1') || 'null');
    if (state?.version !== 1 || !Array.isArray(state.tasks) || !Array.isArray(state.events)) state = createDemo();
    state.preferences ||= {}; state.blocked ||= []; state.messages ||= [];
  } catch { state = createDemo(); }
  for (let hour = 5; hour <= 23; hour++) {
    if (hour <= 21) $('#start-hour').add(new Option(`${String(hour).padStart(2, '0')}:00`, hour));
    if (hour >= 6) $('#end-hour').add(new Option(`${String(hour).padStart(2, '0')}:00`, hour));
  }
  render();
  $$('[data-view]').forEach(b => b.addEventListener('click', () => { selectedCourse = null; setView(b.dataset.view); render(); }));
  $('#see-all-tasks').addEventListener('click', () => { selectedCourse = null; setView('tasks'); renderTasks(); });
  $('#all-modules-button').addEventListener('click', () => { selectedCourse = null; setView('courses'); render(); });
  $('#task-filter').addEventListener('change', renderTasks);
  $('#previous-week').addEventListener('click', () => { currentWeek = addDays(currentWeek, -7); render(); });
  $('#next-week').addEventListener('click', () => { currentWeek = addDays(currentWeek, 7); render(); });
  $('#today-button').addEventListener('click', () => { currentWeek = weekStart(); render(); });
  ['settings-button', 'connections-button', 'start-button', 'mode-badge'].forEach(id => $(`#${id}`).addEventListener('click', openSettings));
  ['add-task-button', 'quick-add-task'].forEach(id => $(`#${id}`).addEventListener('click', () => openTask()));
  $$('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));
  document.addEventListener('click', async e => {
    const complete = e.target.closest('[data-complete]'), edit = e.target.closest('[data-edit-task]'), course = e.target.closest('[data-course]'), event = e.target.closest('[data-event]'), remove = e.target.closest('[data-remove-block]');
    if (complete) { const task = state.tasks.find(t => t.id === complete.dataset.complete); if (!task) return; task.completed = !task.completed; $('#event-dialog').close(); await changeAndRender(); toast(task.completed ? 'One less thing on your mind. Task complete.' : 'Task reopened and added back to your plan.'); }
    if (edit) { const task = state.tasks.find(t => t.id === edit.dataset.editTask); if (task) { $('#event-dialog').close(); openTask(task); } }
    if (course) { selectedCourse = course.dataset.course; $('#task-filter').value = 'all'; setView('tasks'); render(); }
    if (e.target.closest('[data-clear-course]')) { selectedCourse = null; render(); }
    if (event) openEvent(event.dataset.event);
    if (remove) { state.blocked = state.blocked.filter(b => b.id !== remove.dataset.removeBlock); $('#event-dialog').close(); await changeAndRender(); renderBlocked(); toast('Personal time removed. Your plan has been updated.'); }
  });
  $('#generate-button').addEventListener('click', async () => { await changeAndRender(); toast(state.unscheduled.length ? `Plan updated. ${state.unscheduled.length} tasks need more time; see All tasks for details.` : 'A fresh plan, with room for breaks. You’re ready to go.'); });
  $('#sync-button').addEventListener('click', syncMoodle);
  $('#settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const config = { ...state.settings, startHour: Number($('#start-hour').value), endHour: Number($('#end-hour').value), blockMinutes: Number($('#block-minutes').value), breakMinutes: Number($('#break-minutes').value), weekends: $('#weekends').checked };
    try {
      if (config.endHour <= config.startHour) throw new Error('Choose study hours that end after they start.');
      const rawUrl = $('#calendar-url').value.trim(), url = rawUrl ? validateCalendarUrl(rawUrl) : '';
      // Saving a new subscription must download it, not merely store its URL.
      if (url && (url !== state.calendarUrl || !state.calendarSyncedAt)) {
        if (!await syncTimetableFromForm()) return;
      }
      state.settings = config; state.calendarUrl = isExtension ? url : ''; await changeAndRender(); $('#settings-dialog').close();
      toast('Preferences saved. Your study plan has been updated.');
    } catch (error) { $('#settings-error').textContent = error.message; }
  });
  $('#sync-calendar-button').addEventListener('click', syncTimetableFromForm);
  $('#view-imported-calendar').addEventListener('click', () => {
    const next = state.events.find(e => new Date(e.end) >= new Date());
    currentWeek = weekStart(next?.start || new Date()); setView('week'); render(); $('#settings-dialog').close();
    $('#week-view').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  $('#ics-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error('This file is too large. Import a calendar smaller than 10 MB.');
      const events = parseTimetable(await file.text(), { from: atTime(addDays(dateKey(), -7)) });
      await replaceTimetable(events); $('#calendar-url').value = ''; $('#settings-error').textContent = ''; $('#calendar-error').textContent = '';
    } catch (error) { $('#settings-error').textContent = `Could not import calendar. ${error.message}`; }
    e.target.value = '';
  });
  $('#load-demo-button').addEventListener('click', async () => {
    if (!confirm('Replace the current workspace with sample data? Your saved tasks, calendar and preferences will be removed.')) return;
    state = createDemo(); currentWeek = weekStart(); selectedCourse = null; await changeAndRender(false); $('#settings-dialog').close(); setView('week'); toast('Sample workspace loaded. Explore a calmer kind of productive.');
  });
  $('#clear-data-button').addEventListener('click', async () => {
    if (!confirm('Clear all saved tasks, calendar events, timetable URL and preferences from this device?')) return;
    state = emptyWorkspace(); selectedCourse = null; await changeAndRender(false); $('#settings-dialog').close(); setView('week'); toast('Saved data cleared. A little room for a fresh start.');
  });
  $('#task-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const title = $('#task-title').value.trim(), estimatedMinutes = Number($('#task-estimate').value);
      if (!title) throw new Error('Give your task a title.');
      if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 15 || estimatedMinutes > 6000) throw new Error('Choose an estimate between 15 and 6,000 minutes.');
      const value = $('#task-due').value; let dueDate = null;
      if (value) { const [day, time] = value.split('T'), [h, m] = time.split(':').map(Number); dueDate = atTime(day, h, m).toISOString(); }
      const id = $('#task-id').value, courseId = Number($('#task-course').value), course = state.courses.find(c => Number(c.id) === courseId);
      const existing = state.tasks.find(t => t.id === id);
      const data = { title, estimatedMinutes, courseId, courseName: course?.shortname || 'Personal', dueDate };
      if (existing) { Object.assign(existing, data); delete state.preferences[existing.id]; }
      else state.tasks.push({ id: `personal-${crypto.randomUUID()}`, ...data, type: 'other', url: null, completed: false, source: 'personal' });
      await changeAndRender(); $('#task-dialog').close(); toast('Task saved. Your study plan has been updated.');
    } catch (error) { $('#task-error').textContent = error.message; }
  });
  $('#delete-task-button').addEventListener('click', async () => { const id = $('#task-id').value; state.tasks = state.tasks.filter(t => t.id !== id); delete state.preferences[id]; await changeAndRender(); $('#task-dialog').close(); toast('Task removed from your workspace.'); });
  $('#chat-form').addEventListener('submit', async e => { e.preventDefault(); const text = $('#chat-input').value.trim(); if (!text) return; $('#chat-input').value = ''; await submitChat(text); });
  $$('[data-suggestion]').forEach(b => b.addEventListener('click', () => { $('#chat-input').value = b.dataset.suggestion; $('#chat-input').focus(); }));
  // Refresh the current-time marker without rescheduling an existing plan.
  setInterval(() => { if (document.visibilityState === 'visible' && currentView === 'week') renderCalendar(weekEvents()); }, 60000);
}
init().catch(() => { document.body.innerHTML = '<main style="margin:40px"><h1>Let’s make a fresh start.</h1><p>The workspace could not load. Reload the extension and try again.</p></main>'; });
