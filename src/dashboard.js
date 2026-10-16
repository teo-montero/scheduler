import { prepareAssistantEvents, calendarEventType, calendarEventClass } from './assistant-events.js';
import { fetchAssistant } from './assistant-client.js';
import { createCalendarPreview } from './calendar-preview.js';
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
const CALENDAR_HOUR_HEIGHT = 72;
const CALENDAR_MINUTE_HEIGHT = CALENDAR_HOUR_HEIGHT / 60;
const COLORS = ['#5277a5', '#947147', '#7a68a2', '#43808a', '#a36572', '#777e40'];
const VIEWS = {
  week: { title: 'My week', description: 'Your timetable, study sessions and personal time, together.' },
  tasks: { title: 'All tasks', description: 'Review deadlines, adjust estimates and keep track of your progress.' },
  courses: { title: 'My modules', description: 'Your courses and their tasks in one place.' }
};
let state, currentWeek = weekStart(), currentView = 'week', selectedCourse = null, agendaDay = null, toastTimer, syncing = false, calendarSyncing = false, chatBusy = false;
const calendarPreview = createCalendarPreview({
  getEvents: () => [...(state?.events || []), ...(state?.blocks || []), ...(state?.blocked || [])],
  refresh: renderPreviewCalendar, openInfo: openEvent, announce: toast
});
function renderPreviewCalendar() {
  const events = calendarPreview.project(weekEvents());
  renderCalendar(events); renderAgenda(events); calendarPreview.sync();
}
function calendarHours(events = calendarPreview.project(weekEvents())) {
  const timed = events.filter(event => !event.allDay);
  return [Math.min(8, state.settings.startHour, ...timed.map(event => Math.floor(minutesOfDay(event.start) / 60))),
    Math.max(19, state.settings.endHour, ...timed.map(event => dateKey(event.end) !== dateKey(event.start) ? 24 : Math.ceil(minutesOfDay(event.end) / 60)))];
}
function courseColor(id) { const index = state.courses.findIndex(c => String(c.id) === String(id)); return COLORS[Math.max(0, index) % COLORS.length]; }
function emptyMarkup(name, title, description, action = '') {
  return `<div class="empty-state">${icon(name)}<strong class="empty-state-title">${escape(title)}</strong><p class="empty-state-copy">${escape(description)}</p>${action}</div>`;
}
const addTaskAction = () => `<button type="button" class="button secondary empty-state-action" data-add-task>${icon('plus')}Add task</button>`;
const syncMoodleAction = () => `<button type="button" class="button secondary empty-state-action" data-sync-moodle>${icon('sync')}Sync Moodle</button>`;
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
  renderViewHeader();
  $('#today-label').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  $('#mode-badge').innerHTML = `<span></span>${state.mode === 'demo' ? 'Sample workspace' : 'Your workspace'}`;
  $('#mode-badge').classList.toggle('connected', state.mode !== 'demo');
  $('#profile-mode').textContent = state.mode === 'demo' ? 'Demo workspace' : 'Saved on this device';
  const pending = state.tasks.filter(t => !t.completed);
  $('#nav-task-count').textContent = pending.length;
  $('#module-count').textContent = state.courses.length.toString().padStart(2, '0');
  $('#sidebar-courses').innerHTML = state.courses.length ? state.courses.slice(0, 8).map(c => `<button class="sidebar-course ${String(selectedCourse) === String(c.id) ? 'selected' : ''}" data-course="${escape(c.id)}"><span class="course-dot" style="--course-color:${courseColor(c.id)}"></span><span>${escape(c.shortname || c.name)}<small>${escape(c.name)}</small></span></button>`).join('') : '<p class="sidebar-empty">Connect Moodle to see your modules.</p>';
  $('#plan-caption').textContent = state.mode === 'demo' ? 'Sample plan · connect your timetable and Moodle.' : state.unscheduled.length ? `${state.unscheduled.length} task${state.unscheduled.length === 1 ? '' : 's'} need more time before the deadline.` : 'Plan includes your commitments and study breaks.';
  $('#plan-caption').classList.toggle('plan-warning', state.unscheduled.length > 0);
  renderPreviewCalendar();
  renderTasks(); renderCourses(); renderChat();
}
function renderCalendar(events) {
  $('#week-range').textContent = `${formatDate(atTime(currentWeek), { month: 'long' })} – ${formatDate(atTime(addDays(currentWeek, 6)), { month: 'long', year: 'numeric' })}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));
  const [startHour, endHour] = calendarHours();
  const height = (endHour - startHour) * CALENDAR_HOUR_HEIGHT;
  $('#calendar-head').innerHTML = `<div>GMT/BST</div>${days.map(key => `<div class="${key === dateKey() ? 'is-today' : ''}"><span class="day-name">${formatDate(atTime(key), { weekday: 'short' }).split(',')[0].split(' ')[0]}</span><span class="day-number">${Number(key.slice(-2))}</span></div>`).join('')}`;
  const axis = `<div class="time-axis">${Array.from({ length: endHour - startHour }, (_, i) => `<span class="time-label" style="top:${i * CALENDAR_HOUR_HEIGHT}px">${String(startHour + i).padStart(2, '0')}:00</span>`).join('')}</div>`;
  const columns = days.map((key, i) => {
    const dayStart = atTime(key, startHour).getTime(), dayEnd = atTime(key, endHour).getTime();
    const items = events.filter(e => new Date(e.start).getTime() < dayEnd && new Date(e.end).getTime() > dayStart).map(e => ({ ...e, top: Math.max(0, (new Date(e.start) - dayStart) / 60000 * CALENDAR_MINUTE_HEIGHT), bottom: Math.min(height, (new Date(e.end) - dayStart) / 60000 * CALENDAR_MINUTE_HEIGHT) })).sort((a, b) => a.top - b.top || b.bottom - a.bottom);
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
      const h = Math.max(14, e.bottom - e.top - 3), cls = calendarEventClass(e);
      const time = e.allDay ? 'All day' : `${formatTime(e.start)}–${formatTime(e.end)}`;
      const location = calendarEventType(e) === 'study' ? [e.courseName || 'Focus', e.location].filter(Boolean).join(' · ') : e.location;
      return `<button class="calendar-event ${cls} ${h < 56 ? 'short' : ''}" data-event="${escape(e.id)}" data-event-type="${calendarEventType(e)}" style="top:${e.top}px;height:${h}px;left:calc(${e.lane / e.lanes * 100}% + 3px);width:calc(${100 / e.lanes}% - 6px)" title="${escape(`${time} · ${e.title}${location ? ` · ${location}` : ''}`)}" aria-label="${escape(`${e.title}, ${time}`)}"><span class="event-time">${time}</span><strong>${escape(e.title)}</strong>${location && h >= 76 ? `<span class="event-location">${escape(location)}</span>` : ''}</button>`;
    }).join('');
    const minute = minutesOfDay(new Date()) - startHour * 60;
    const now = key === dateKey() && minute >= 0 && minute * CALENDAR_MINUTE_HEIGHT < height ? `<div class="now-line" style="top:${minute * CALENDAR_MINUTE_HEIGHT}px"></div>` : '';
    return `<div class="day-column ${i > 4 ? 'weekend' : ''} ${key === dateKey() ? 'today' : ''}" data-date="${key}">${markup}${now}</div>`;
  }).join('');
  $('#calendar-body').style.height = `${height}px`; $('#calendar-body').innerHTML = axis + columns;
}
function updateNowMarker() {
  const [startHour, endHour] = calendarHours();
  const minute = minutesOfDay(new Date()) - startHour * 60;
  const column = $(`#calendar-body .day-column[data-date="${dateKey()}"]`);
  let marker = $('#calendar-body .now-line');
  if (!column || minute < 0 || minute >= (endHour - startHour) * 60) { marker?.remove(); return; }
  if (marker?.parentElement !== column) { marker?.remove(); marker = null; }
  if (!marker) { marker = document.createElement('div'); marker.className = 'now-line'; column.append(marker); }
  marker.style.top = `${minute * CALENDAR_MINUTE_HEIGHT}px`;
}
function renderAgenda(events) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));
  if (!days.includes(agendaDay)) agendaDay = days.includes(dateKey()) ? dateKey() : currentWeek;
  const dayStart = atTime(agendaDay).getTime(), dayEnd = atTime(addDays(agendaDay, 1)).getTime();
  const items = events.filter(e => new Date(e.start).getTime() < dayEnd && new Date(e.end).getTime() > dayStart)
    .sort((a, b) => Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) || new Date(a.start) - new Date(b.start));
  const dayButtons = days.map(key => `<button type="button" class="agenda-day ${key === agendaDay ? 'active' : ''}" data-agenda-day="${key}" aria-pressed="${key === agendaDay}" aria-label="${escape(formatDate(atTime(key), { weekday: 'long', month: 'long' }))}"${key === dateKey() ? ' aria-current="date"' : ''}><span>${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(atTime(key))}</span><strong>${Number(key.slice(-2))}</strong></button>`).join('');
  const markup = items.map(event => {
    const kind = calendarEventClass(event);
    const label = kind === 'study' ? 'Study session' : kind === 'personal' ? 'Personal time' : 'Timetable';
    const time = event.allDay ? 'All day' : `${new Date(event.start).getTime() < dayStart ? '00:00' : formatTime(event.start)}–${new Date(event.end).getTime() >= dayEnd ? '24:00' : formatTime(event.end)}`;
    const detail = [kind === 'study' ? event.courseName : '', event.location].filter(Boolean).join(' · ');
    return `<button type="button" class="agenda-event ${kind}" data-event="${escape(event.id)}" data-event-type="${calendarEventType(event)}" aria-label="${escape(`${event.title}, ${time}, ${label}`)}"><span class="agenda-event-time">${escape(time)}</span><span class="agenda-event-info"><strong>${escape(event.title)}</strong><span class="agenda-event-meta">${escape(label)}${detail ? ` · ${escape(detail)}` : ''}</span></span>${icon('chevron')}</button>`;
  }).join('');
  $('#calendar-agenda').innerHTML = `<div class="agenda-days" role="group" aria-label="Select a day">${dayButtons}</div><h3 class="agenda-date" id="agenda-date">${escape(formatDate(atTime(agendaDay), { weekday: 'long', month: 'long' }))}</h3><div class="agenda-events" role="group" aria-labelledby="agenda-date">${markup || `<div class="agenda-empty">${emptyMarkup('calendar', 'No sessions scheduled', 'Choose another day or add a task to your plan.', addTaskAction())}</div>`}</div>`;
}
function renderTasks() {
  const filter = $('#task-filter').value;
  const tasks = sortedTasks().filter(t => (filter !== 'pending' || !t.completed) && (filter !== 'completed' || t.completed) && (selectedCourse === null || String(t.courseId) === String(selectedCourse)));
  let notice = '';
  if (selectedCourse !== null) notice += `<div class="filtered-note">Showing ${escape(state.courses.find(c => String(c.id) === String(selectedCourse))?.shortname || 'selected module')}<button data-clear-course>Show all modules</button></div>`;
  const relevantWarnings = state.unscheduled.filter(u => tasks.some(t => t.id === u.taskId));
  if (relevantWarnings.length) notice += `<div class="filtered-note plan-warning">${relevantWarnings.map(u => `${escape(state.tasks.find(t => t.id === u.taskId)?.title)}: ${durationLabel(u.minutes)} unplanned — ${escape(u.reason.toLowerCase())}.`).join('<br>')}</div>`;
  $('#all-tasks').innerHTML = notice + (tasks.length ? tasks.map(taskMarkup).join('') : emptyMarkup('check', filter === 'completed' ? 'No completed tasks yet' : 'No tasks to show', filter === 'completed' ? 'Tasks you complete will appear here.' : selectedCourse !== null ? 'This module has no tasks matching your filter.' : 'Add a task or connect Moodle to start planning.', filter === 'completed' ? '' : addTaskAction()));
}
function renderCourses() {
  $('#course-cards').innerHTML = state.courses.map(c => {
    const tasks = state.tasks.filter(t => String(t.courseId) === String(c.id)), completed = tasks.filter(t => t.completed).length;
    return `<article class="course-card"><span class="course-code"><span class="course-dot" style="--course-color:${courseColor(c.id)}"></span>${escape(c.shortname)}</span><h3>${escape(c.name)}</h3><div class="course-progress" aria-hidden="true"><span style="width:${tasks.length ? completed / tasks.length * 100 : 0}%"></span></div><p>${completed} of ${tasks.length} tasks completed</p><button data-course="${escape(c.id)}">View module tasks ${icon('arrow')}</button></article>`;
  }).join('') || emptyMarkup('book', 'Your modules will appear here', 'Connect Moodle to import your courses and deadlines.', syncMoodleAction());
}
function renderChat() {
  $('#chat-input').disabled = chatBusy;
  $('#chat-form button[type="submit"]').disabled = chatBusy;
  $('#chat-form').setAttribute('aria-busy', String(chatBusy));
  $('#chat-status').textContent = chatBusy ? 'Thinking…' : '';
  $$('[data-suggestion]').forEach(button => { button.disabled = chatBusy; });
  $('#chat-messages').innerHTML = state.messages.slice(-12).map(m => `<div class="chat-message ${m.role === 'user' ? 'user' : ''}">${escape(m.text)}</div>`).join('');
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}
function renderViewHeader() {
  const content = VIEWS[currentView];
  document.body.dataset.currentView = currentView;
  $('#page-title').textContent = content.title;
  $('#page-description').textContent = content.description;
  $('#breadcrumb-view').textContent = content.title;
  $$('.nav-item[data-view]').forEach(button => {
    const active = button.dataset.view === currentView;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}
function setView(view) {
  currentView = view;
  $('#week-view').hidden = view !== 'week'; $('#tasks-view').hidden = view !== 'tasks'; $('#courses-view').hidden = view !== 'courses';
  renderViewHeader();
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
// Presentation only: recurrence has no persistence or scheduling implementation.
function updateRepeatPreview() {
  const weekly = $('#task-repeat').checked;
  $('#task-repeat-help').hidden = !weekly;
  $('#task-deadline-label').textContent = weekly ? 'First deadline (London time)' : 'Deadline (London time)';
  $('#task-save-button').disabled = weekly;
  $('#task-save-button').textContent = weekly ? 'Save weekly task' : 'Save task';
}
function openTask(task = null) {
  $('#task-form').reset(); $('#task-error').textContent = '';
  $('#task-course').innerHTML = '<option value="0">Personal / independent study</option>' + state.courses.map(c => `<option value="${escape(c.id)}">${escape(c.shortname || c.name)}</option>`).join('');
  $('#task-id').value = task?.id || ''; $('#task-title').value = task?.title || ''; $('#task-course').value = task?.courseId || '0'; $('#task-estimate').value = task?.estimatedMinutes || 120;
  if (task?.dueDate) { const p = dateParts(task.dueDate); $('#task-due').value = `${dateKey(task.dueDate)}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; }
  const fromMoodle = task?.source === 'moodle';
  $('#task-repeat-row').hidden = Boolean(fromMoodle);
  $('#task-repeat').disabled = Boolean(fromMoodle);
  updateRepeatPreview();
  ['task-title', 'task-course', 'task-due'].forEach(id => { $(`#${id}`).disabled = Boolean(fromMoodle); });
  $('#task-source-note').hidden = !fromMoodle;
  $('#delete-task-button').hidden = !task || fromMoodle;
  $('#task-dialog-title').textContent = task ? 'Edit task' : 'Add task';
  $('#task-dialog').showModal(); $('#task-form input:not([type="hidden"]):not(:disabled)').focus();
}
function safeMoodleUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'moodle.ucl.ac.uk' ? url.href : null; } catch { return null; } }
function openEvent(id) {
  const event = calendarPreview.project([...state.events, ...state.blocks, ...state.blocked]).find(e => e.id === id);
  if (!event) return;
  const task = state.tasks.find(t => t.id === event.taskId), url = safeMoodleUrl(task?.url);
  $('#event-detail').innerHTML = `<h2 id="event-title">${escape(event.title)}</h2><p>${calendarEventType(event) === 'study' ? 'Study session' : calendarEventType(event) === 'user_time' ? 'Personal time' : 'Lecture'} · ${formatDate(event.start, { weekday: 'long' })}<br>${event.allDay ? 'All day' : `${formatTime(event.start)} – ${formatTime(event.end)}`} · London time${event.location ? `<br>${escape(event.location)}` : ''}</p>${event.description ? `<p class="event-detail-note">${escape(event.description)}</p>` : ''}${task ? `<p class="event-detail-note">Part of ${durationLabel(task.estimatedMinutes)} of planned work${task.dueDate ? ` · due ${formatDate(task.dueDate)}, ${formatTime(task.dueDate)}` : ''}. Complete the task when all its work is done.</p><button class="button primary" data-complete="${escape(task.id)}">${icon('check')}Mark task complete</button> <button class="button secondary" data-edit-task="${escape(task.id)}">Edit task</button>${url ? `<p><a class="text-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Open in Moodle ${icon('external')}</a></p>` : ''}` : ['personal', 'assistant'].includes(event.source) ? `<button class="button secondary" data-remove-block="${escape(event.id)}">Remove event</button>` : ''}`;
  $('#event-dialog').showModal();
}
// Existing task-list deletion; calendar preview removal never calls this action.
async function deleteTask(id, dialog) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || task.source === 'moodle') return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  delete state.preferences[id];
  await changeAndRender();
  dialog.close();
  if (document.body.dataset.input === 'keyboard') $('#page-title').focus({ preventScroll: true });
  toast('Task removed from your workspace.');
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
  if (chatBusy) return;
  // Keep the established local task completion/move shortcuts.
  if (/^(finished|completed|done|move|reschedule)\b/i.test(text)) return submitLocalCommand(text);
  chatBusy = true;
  state.messages.push({ role: 'user', text });
  renderChat();
  const workspace = state;
  let response;
  try {
    const payload = {
      messages: state.messages.slice(-12).map(({ role, text }) => ({ role, text: text.slice(0, 2000) })),
      selectedWeek: currentWeek,
      calendar: [...state.events, ...state.blocked].filter(event => new Date(event.end) >= new Date()).sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 500).map(({ title, start, end }) => ({ title: title.slice(0, 200), start, end }))
    };
    const { result } = isExtension ? await extensionRequest({ type: 'ASSISTANT_CHAT', payload }) : await fetchAssistant(payload);
    if (state !== workspace) { toast('Your workspace changed. Please send the request again.'); return; }
    const { additions, duplicates } = prepareAssistantEvents(result, [...state.events, ...state.blocked]);
    if (additions.length) {
      const blocked = [...state.blocked, ...additions];
      const plan = scheduleTasks({ tasks: state.tasks, events: state.events, blocked, preferences: state.preferences, settings: state.settings });
      Object.assign(state, { blocked, ...plan });
      currentWeek = weekStart(additions[0].start); agendaDay = dateKey(additions[0].start);
      response = 'Added to your calendar: ' + additions.map(event => event.title + ' · ' + formatDate(event.start, { weekday: 'short' }) + ', ' + formatTime(event.start) + '–' + formatTime(event.end)).join('; ') + '. London time.';
      if (duplicates) response += ' Already existing events were skipped.';
      if (state.unscheduled.length) response += ' Some study tasks need more time; check All tasks.';
    } else response = duplicates ? 'Those events are already in your calendar. No duplicates were added.' : result.message;
  } catch (error) { response = error.message; }
  finally { chatBusy = false; renderChat(); }
  if (state !== workspace) return;
  state.messages.push({ role: 'assistant', text: response }); state.messages = state.messages.slice(-30);
  await persist(); render();
}

async function submitLocalCommand(text) {
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
  document.body.dataset.input = 'pointer';
  document.addEventListener('keydown', () => { document.body.dataset.input = 'keyboard'; }, { capture: true });
  document.addEventListener('pointerdown', () => { document.body.dataset.input = 'pointer'; }, { capture: true });
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
  $$('.nav-item[data-view]').forEach(b => b.addEventListener('click', () => { selectedCourse = null; setView(b.dataset.view); render(); }));
  $('#all-modules-button').addEventListener('click', () => { selectedCourse = null; setView('courses'); render(); });
  $('#task-filter').addEventListener('change', renderTasks);
  $('#previous-week').addEventListener('click', () => { currentWeek = addDays(currentWeek, -7); agendaDay = null; render(); });
  $('#next-week').addEventListener('click', () => { currentWeek = addDays(currentWeek, 7); agendaDay = null; render(); });
  $('#today-button').addEventListener('click', () => { currentWeek = weekStart(); agendaDay = dateKey(); render(); });
  ['settings-button', 'connections-button', 'mode-badge'].forEach(id => $(`#${id}`).addEventListener('click', openSettings));
  $('#add-task-button').addEventListener('click', () => openTask());
  $('#planner-chat').addEventListener('toggle', () => {
    calendarPreview.sync();
    if ($('#planner-chat').open) $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  });
  $$('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));
  document.addEventListener('click', async e => {
    const complete = e.target.closest('[data-complete]'), edit = e.target.closest('[data-edit-task]'), course = e.target.closest('[data-course]'), event = e.target.closest('[data-event]'), remove = e.target.closest('[data-remove-block]');
    if (complete) {
      const task = state.tasks.find(t => t.id === complete.dataset.complete); if (!task) return;
      const list = complete.closest('#all-tasks, #upcoming-tasks');
      const index = list ? [...list.querySelectorAll('[data-complete]')].indexOf(complete) : -1;
      task.completed = !task.completed; $('#event-dialog').close(); await changeAndRender();
      if (list && document.body.dataset.input === 'keyboard') {
        const remaining = [...list.querySelectorAll('[data-complete]')];
        const next = remaining.find(button => button.dataset.complete === task.id) || remaining[Math.min(index, remaining.length - 1)];
        (next || $('#page-title')).focus({ preventScroll: true });
      }
      toast(task.completed ? 'Task complete. Your plan has been updated.' : 'Task reopened and added back to your plan.');
    }
    if (edit) { const task = state.tasks.find(t => t.id === edit.dataset.editTask); if (task) { $('#event-dialog').close(); openTask(task); } }
    if (course) { selectedCourse = course.dataset.course; $('#task-filter').value = 'all'; setView('tasks'); render(); if (document.body.dataset.input === 'keyboard') $('#page-title').focus({ preventScroll: true }); }
    if (e.target.closest('[data-clear-course]')) { selectedCourse = null; render(); }
    if (event) calendarPreview.select(event.dataset.event);
    if (remove) { state.blocked = state.blocked.filter(b => b.id !== remove.dataset.removeBlock); $('#event-dialog').close(); await changeAndRender(); renderBlocked(); toast('Personal time removed. Your plan has been updated.'); }
    const day = e.target.closest('[data-agenda-day]');
    if (day) {
      agendaDay = day.dataset.agendaDay; renderAgenda(calendarPreview.project(weekEvents())); calendarPreview.sync();
      $(`#calendar-agenda [data-agenda-day="${agendaDay}"]`).focus({ preventScroll: true });
    }
    if (e.target.closest('[data-add-task]')) openTask();
    if (e.target.closest('[data-sync-moodle]')) await syncMoodle();
  });
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
    $('#week-view').scrollIntoView({ block: 'start', behavior: 'auto' });
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
  $('#task-repeat').addEventListener('change', updateRepeatPreview);
  $('#task-form').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#task-repeat').checked) return; // UI preview must not create a one-off task.
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
  $('#delete-task-button').addEventListener('click', () => deleteTask($('#task-id').value, $('#task-dialog')));
  $('#chat-form').addEventListener('submit', async e => { e.preventDefault(); const text = $('#chat-input').value.trim(); if (!text || chatBusy) return; $('#chat-input').value = ''; await submitChat(text); });
  $$('[data-suggestion]').forEach(b => b.addEventListener('click', () => { $('#chat-input').value = b.dataset.suggestion; $('#chat-input').focus(); }));
  // Refresh the current-time marker without rescheduling an existing plan.
  setInterval(() => { if (document.visibilityState === 'visible' && currentView === 'week') updateNowMarker(); }, 60000);
}
init().catch(() => { document.body.innerHTML = '<main style="margin:40px"><h1>Let’s make a fresh start.</h1><p>The workspace could not load. Reload the extension and try again.</p></main>'; });
