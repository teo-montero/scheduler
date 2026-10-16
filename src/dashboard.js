import { createBrowserPlanner } from './planner/index.js';
import { createWorkspaceStorage } from './planner/storage.js';
import { generateWorkspacePlan } from './planner/planning.js';
import { consideredTasks, isCourseIncluded } from './modules.js';
import { TIMETABLE_ORIGINS } from './protocol.js';
import { addDays, atTime, dateKey, dateParts, weekStart, minutesOfDay, formatTime, formatDate, durationLabel } from './dates.js';
import { createDemo, emptyWorkspace } from './demo.js';
import { validateCalendarUrl } from './ical.js';

const planner = createBrowserPlanner();
const workspaceStorage = createWorkspaceStorage();
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
let state, currentWeek = weekStart(), currentView = 'week', selectedCourse = null, agendaDay = null, toastTimer, syncing = false, calendarSyncing = false;
function courseColor(id) { const index = state.courses.findIndex(c => String(c.id) === String(id)); return COLORS[Math.max(0, index) % COLORS.length]; }
function emptyMarkup(name, title, description, action = '') {
  return `<div class="empty-state">${icon(name)}<strong class="empty-state-title">${escape(title)}</strong><p class="empty-state-copy">${escape(description)}</p>${action}</div>`;
}
const addTaskAction = () => `<button type="button" class="button secondary empty-state-action" data-add-task>${icon('plus')}Add task</button>`;
const syncMoodleAction = () => `<button type="button" class="button secondary empty-state-action" data-sync-moodle>${icon('sync')}Sync Moodle</button>`;
function toast(message, long = false) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), long ? 10000 : 5000); }
async function persist() {
  try { await workspaceStorage.save(state); }
  catch (error) { toast('Your browser could not save this workspace. Free some storage and try again.', true); throw error; }
}
async function regenerate() { state = await generateWorkspacePlan(state, { useAI: false }); }
async function changeAndRender(replan = true) { if (replan) await regenerate(); await persist(); render(); }
function weekEvents() {
  const start = atTime(currentWeek), end = atTime(addDays(currentWeek, 7));
  return [...state.events, ...state.blocks, ...state.blocked, ...(state.personalEvents || [])].filter(e => new Date(e.end) > start && new Date(e.start) < end);
}
function dueLabel(task) {
  if (!task.dueDate) return { text: 'No deadline', className: '' };
  const due = new Date(task.dueDate), today = dateKey();
  if (due < new Date()) return { text: 'Overdue', className: 'overdue' };
  if (dateKey(due) === today) return { text: `Today, ${formatTime(due)}`, className: 'urgent' };
  if (dateKey(due) === addDays(today, 1)) return { text: 'Tomorrow', className: 'urgent' };
  return { text: formatDate(due, { weekday: 'short' }), className: '' };
}
function sortedTasks(tasks = consideredTasks(state)) { return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)); }
function taskMarkup(task) {
  const due = dueLabel(task);
  return `<article class="task-item ${task.completed ? 'task-completed' : ''}"><button class="task-check ${task.completed ? 'checked' : ''}" data-complete="${escape(task.id)}" aria-label="${task.completed ? 'Reopen' : 'Complete'} ${escape(task.title)}" aria-pressed="${task.completed}">${icon('check')}</button><div class="task-info"><div class="task-course"><span class="course-dot" style="--course-color:${courseColor(task.courseId)}"></span>${escape(task.courseName || 'Personal')}</div><button class="task-title" data-edit-task="${escape(task.id)}">${escape(task.title)}</button><div class="task-bottom"><span class="due-label ${task.completed ? '' : due.className}">${task.completed ? 'Completed' : escape(due.text)}</span><span class="task-estimate">${icon('clock')}${task.needsEstimate ? 'Estimate needed' : `${['ai', 'gemini', 'claude'].includes(task.estimateSource) ? '~' : ''}${durationLabel(task.estimatedMinutes)}`}${task.includeInPlan === false ? ' · Not planned' : ''}</span></div></div></article>`;
}
function render() {
  renderViewHeader();
  $('#today-label').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  $('#sample-banner').hidden = state.mode !== 'demo';
  $('#mode-badge').innerHTML = `<span></span>${state.mode === 'demo' ? 'Sample workspace' : 'Your workspace'}`;
  $('#mode-badge').classList.toggle('connected', state.mode !== 'demo');
  $('#profile-mode').textContent = state.mode === 'demo' ? 'Demo workspace' : 'Saved on this device';
  const conflicts = state.planning?.conflicts?.length || 0;
  const estimatesNeeded = consideredTasks(state).filter(task => !task.completed && task.needsEstimate).length;
  const pending = consideredTasks(state).filter(t => !t.completed), done = consideredTasks(state).filter(t => t.completed).length;
  $('#nav-task-count').textContent = pending.length;
  $('#module-count').textContent = state.courses.length.toString().padStart(2, '0');
  $('#sidebar-courses').innerHTML = state.courses.length ? state.courses.slice(0, 8).map(c => `<button class="sidebar-course ${String(selectedCourse) === String(c.id) ? 'selected' : ''}" data-course="${escape(c.id)}"><span class="course-dot" style="--course-color:${courseColor(c.id)}"></span><span>${escape(c.shortname || c.name)}<small>${escape(c.name)}</small></span></button>`).join('') : '<p class="sidebar-empty">Connect Moodle to see your modules.</p>';
  const events = weekEvents();
  const focusMinutes = events.filter(e => e.source === 'study').reduce((sum, e) => sum + (new Date(e.end) - new Date(e.start)) / 60000, 0);
  $('#stat-focus').innerHTML = `${durationLabel(focusMinutes)} <span>planned</span>`;
  const sessions = events.filter(e => e.source === 'study').length;
  $('#stat-focus-detail').textContent = `${sessions} study ${sessions === 1 ? 'session' : 'sessions'} this week`;
  $('#stat-tasks').innerHTML = `${pending.length} <span>${pending.length === 1 ? 'task' : 'tasks'} to go</span>`;
  $('#stat-tasks-detail').textContent = `${done} ${done === 1 ? 'task' : 'tasks'} completed`;
  $('#stat-health').textContent = conflicts ? `${conflicts} commitment clashes` : estimatesNeeded ? `${estimatesNeeded} need estimates` : state.unscheduled.length ? 'Needs attention' : pending.length ? 'All work planned' : state.tasks.length ? 'All tasks complete' : 'No tasks yet';
  $('#stat-health-detail').textContent = conflicts ? 'Review overlapping fixed events; lectures keep their times.' : estimatesNeeded ? 'Open tasks to add work estimates.' : state.unscheduled.length ? `${state.unscheduled.length} ${state.unscheduled.length === 1 ? 'task needs' : 'tasks need'} more time` : `${state.settings.breakMinutes}-minute breaks between sessions`;
  $('#stat-health').classList.toggle('plan-warning', state.unscheduled.length > 0 || conflicts > 0 || estimatesNeeded > 0);
  $('#plan-caption').textContent = state.mode === 'demo' ? 'Sample plan · connect your timetable and Moodle.' : conflicts ? `${conflicts} fixed commitments overlap. Review your routine.` : state.unscheduled.length ? `${state.unscheduled.length} task${state.unscheduled.length === 1 ? '' : 's'} need more time before the deadline.` : 'Plan includes your commitments and study breaks.';
  $('#plan-caption').classList.toggle('plan-warning', state.unscheduled.length > 0 || conflicts > 0 || estimatesNeeded > 0);
  renderCalendar(events);
  renderAgenda(events);
  $('#upcoming-tasks').innerHTML = sortedTasks(pending).slice(0, 4).map(taskMarkup).join('') || emptyMarkup('check', state.tasks.length ? 'All tasks complete' : 'No tasks yet', state.tasks.length ? 'New deadlines will appear here.' : 'Add a task or connect Moodle to start planning.', addTaskAction());
  renderTasks(); renderCourses(); renderChat();
}
function renderCalendar(events) {
  $('#week-range').textContent = `${formatDate(atTime(currentWeek), { month: 'long' })} – ${formatDate(atTime(addDays(currentWeek, 6)), { month: 'long', year: 'numeric' })}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));
  const startHour = Math.min(8, state.settings.startHour), endHour = Math.max(19, state.settings.endHour);
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
      const h = Math.max(14, e.bottom - e.top - 3), cls = e.source === 'study' ? 'study' : e.source === 'personal' ? 'personal' : 'lecture';
      const time = e.allDay ? 'All day' : `${formatTime(e.start)}–${formatTime(e.end)}`;
      const location = e.source === 'study' ? `Focus · ${e.courseName || 'Personal'}` : e.location;
      return `<button class="calendar-event ${cls} ${h < 56 ? 'short' : ''}" data-event="${escape(e.id)}" style="top:${e.top}px;height:${h}px;left:calc(${e.lane / e.lanes * 100}% + 3px);width:calc(${100 / e.lanes}% - 6px)" title="${escape(`${time} · ${e.title}${location ? ` · ${location}` : ''}`)}" aria-label="${escape(`${e.title}, ${time}`)}"><span class="event-time">${time}</span><strong>${escape(e.title)}</strong>${location && h >= 76 ? `<span class="event-location">${escape(location)}</span>` : ''}</button>`;
    }).join('');
    const minute = minutesOfDay(new Date()) - startHour * 60;
    const now = key === dateKey() && minute >= 0 && minute * CALENDAR_MINUTE_HEIGHT < height ? `<div class="now-line" style="top:${minute * CALENDAR_MINUTE_HEIGHT}px"></div>` : '';
    return `<div class="day-column ${i > 4 ? 'weekend' : ''} ${key === dateKey() ? 'today' : ''}" data-date="${key}">${markup}${now}</div>`;
  }).join('');
  $('#calendar-body').style.height = `${height}px`; $('#calendar-body').innerHTML = axis + columns;
}
function updateNowMarker() {
  const startHour = Math.min(8, state.settings.startHour), endHour = Math.max(19, state.settings.endHour);
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
    const kind = event.source === 'study' ? 'study' : event.source === 'personal' ? 'personal' : 'lecture';
    const label = kind === 'study' ? 'Study session' : kind === 'personal' ? 'Personal time' : 'Timetable';
    const time = event.allDay ? 'All day' : `${new Date(event.start).getTime() < dayStart ? '00:00' : formatTime(event.start)}–${new Date(event.end).getTime() >= dayEnd ? '24:00' : formatTime(event.end)}`;
    const detail = kind === 'study' ? event.courseName : event.location;
    return `<button type="button" class="agenda-event ${kind}" data-event="${escape(event.id)}" aria-label="${escape(`${event.title}, ${time}, ${label}`)}"><span class="agenda-event-time">${escape(time)}</span><span class="agenda-event-info"><strong>${escape(event.title)}</strong><span class="agenda-event-meta">${escape(label)}${detail ? ` · ${escape(detail)}` : ''}</span></span>${icon('chevron')}</button>`;
  }).join('');
  $('#calendar-agenda').innerHTML = `<div class="agenda-days" role="group" aria-label="Select a day">${dayButtons}</div><h3 class="agenda-date" id="agenda-date">${escape(formatDate(atTime(agendaDay), { weekday: 'long', month: 'long' }))}</h3><div class="agenda-events" role="group" aria-labelledby="agenda-date">${markup || `<div class="agenda-empty">${emptyMarkup('calendar', 'No sessions scheduled', 'Choose another day or add a task to your plan.', addTaskAction())}</div>`}</div>`;
}
function renderTasks() {
  const filter = $('#task-filter').value;
  const tasks = sortedTasks(selectedCourse === null ? consideredTasks(state) : state.tasks).filter(t => (filter !== 'pending' || !t.completed) && (filter !== 'completed' || t.completed) && (selectedCourse === null || String(t.courseId) === String(selectedCourse)));
  let notice = '';
  if (selectedCourse !== null) notice += `<div class="filtered-note">Showing ${escape(state.courses.find(c => String(c.id) === String(selectedCourse))?.shortname || 'selected module')}<button data-clear-course>Show all modules</button></div>`;
  const relevantWarnings = state.unscheduled.filter(u => tasks.some(t => t.id === u.taskId));
  if (relevantWarnings.length) notice += `<div class="filtered-note plan-warning">${relevantWarnings.map(u => `${escape(state.tasks.find(t => t.id === u.taskId)?.title)}: ${durationLabel(u.minutes)} unplanned — ${escape(u.reason.toLowerCase())}.`).join('<br>')}</div>`;
  $('#all-tasks').innerHTML = notice + (tasks.length ? tasks.map(taskMarkup).join('') : emptyMarkup('check', filter === 'completed' ? 'No completed tasks yet' : 'No tasks to show', filter === 'completed' ? 'Tasks you complete will appear here.' : selectedCourse !== null ? 'This module has no tasks matching your filter.' : 'Add a task or connect Moodle to start planning.', filter === 'completed' ? '' : addTaskAction()));
}
function renderCourses() {
  if (!$('#analyse-modules-button')) {
    const actions = document.createElement('div');
    actions.innerHTML = '<button id="analyse-modules-button" class="small-button">Fetch & analyse selected</button> <button id="refresh-deadlines-button" class="small-button">Refresh deadlines</button>';
    $('#courses-view .section-heading').append(actions);
    $('#analyse-modules-button').addEventListener('click', buildCoursePlan);
    $('#refresh-deadlines-button').addEventListener('click', async () => {
      try { const result = await planner.refreshDeadlines(); state = result.workspace; render(); toast(result.warnings.join(' ') || 'Moodle deadlines refreshed.'); }
      catch (error) { toast(error.message, true); }
    });
  }
  $('#analyse-modules-button').disabled = syncing || state.mode === 'demo' || !state.courses.length;
  $('#refresh-deadlines-button').disabled = syncing || state.mode === 'demo' || !state.courses.length;
  $('#course-cards').innerHTML = state.courses.map(c => {
    const tasks = state.tasks.filter(t => String(t.courseId) === String(c.id)), completed = tasks.filter(t => t.completed).length;
    return `<article class="course-card"><span class="course-code"><span class="course-dot" style="--course-color:${courseColor(c.id)}"></span>${escape(c.shortname)}</span><h3>${escape(c.name)}</h3><div class="course-progress" aria-hidden="true"><span style="width:${tasks.length ? completed / tasks.length * 100 : 0}%"></span></div><p>${completed} of ${tasks.length} tasks completed</p><label class="checkbox-label"><input type="checkbox" data-toggle-course="${escape(c.id)}" ${isCourseIncluded(state, c.id) ? 'checked' : ''} ${syncing ? 'disabled' : ''}> Include in my plan</label><p class="field-help">${state.courseContent?.[c.id] ? `${state.courseContent[c.id].state.activities.length} resources saved${state.courseContent[c.id].analysis ? ' · Analysis saved' : ' · Analysis pending'}` : 'Course content not fetched yet'}</p><button data-course="${escape(c.id)}">View module tasks ${icon('arrow')}</button></article>`;
  }).join('') || emptyMarkup('book', 'Your modules will appear here', 'Connect Moodle to import your courses and deadlines.', syncMoodleAction());
}
function renderChat() {
  $('#chat-messages').innerHTML = state.messages.slice(-12).map(m => `<div class="chat-message ${m.role === 'user' ? 'user' : ''}">${escape(m.text)}</div>`).join('');
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}
function renderViewHeader() {
  const content = VIEWS[currentView];
  document.body.dataset.currentView = currentView;
  $('#page-title').textContent = content.title;
  $('#page-description').textContent = content.description;
  $('#breadcrumb-view').textContent = content.title;
  $('#focus-summary').hidden = currentView !== 'week';
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
function openTask(task = null) {
  if (!$('#task-plan-included')) {
    const choice = document.createElement('label'); choice.className = 'checkbox-label'; choice.id = 'task-plan-choice';
    choice.innerHTML = '<input type="checkbox" id="task-plan-included"> Include in my plan'; $('#task-source-note').after(choice);
  }
  $('#task-plan-choice').hidden = task?.source !== 'moodle-content';

  $('#task-form').reset(); $('#task-error').textContent = '';
  $('#task-plan-included').checked = task?.includeInPlan !== false;
  $('#task-course').innerHTML = '<option value="0">Personal / independent study</option>' + state.courses.map(c => `<option value="${escape(c.id)}">${escape(c.shortname || c.name)}</option>`).join('');
  $('#task-id').value = task?.id || ''; $('#task-title').value = task?.title || ''; $('#task-course').value = task?.courseId || '0'; $('#task-estimate').value = task?.needsEstimate ? '' : task?.estimatedMinutes || 120;
  if (task?.dueDate) { const p = dateParts(task.dueDate); $('#task-due').value = `${dateKey(task.dueDate)}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; }
  const fromMoodle = String(task?.source).startsWith('moodle');
  ['task-title', 'task-course', 'task-due'].forEach(id => { $(`#${id}`).disabled = Boolean(fromMoodle); });
  $('#task-source-note').hidden = !fromMoodle;
  $('#task-source-note').textContent = task?.source === 'moodle-content' ? `${task.sectionName || ''}. AI estimate (${task.estimateConfidence} confidence): ${task.estimateReason} Moodle completion: ${task.moodleCompletionStatus}.` : 'Title, module and deadline come from Moodle. You can adjust the estimate here.';
  const resourceUrl = safeMoodleUrl(task?.url);
  if (resourceUrl) { const link = document.createElement('a'); link.href = resourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'text-link'; link.textContent = ' Open source in Moodle'; $('#task-source-note').append(link); }
  $('#delete-task-button').hidden = !task || fromMoodle;
  $('#task-dialog-title').textContent = task ? 'Edit task' : 'Add task';
  $('#task-dialog').showModal(); $('#task-form input:not([type="hidden"]):not(:disabled)').focus();
}
function safeMoodleUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'moodle.ucl.ac.uk' ? url.href : null; } catch { return null; } }
function openEvent(id) {
  const event = [...state.events, ...state.blocks, ...state.blocked, ...(state.personalEvents || [])].find(e => e.id === id);
  if (!event) return;
  const task = state.tasks.find(t => t.id === event.taskId), url = safeMoodleUrl(task?.url);
  $('#event-detail').innerHTML = `<h2 id="event-title">${escape(event.title)}</h2><p>${event.source === 'study' ? 'Study session' : event.source === 'personal' ? 'Personal time' : 'UCL timetable'} · ${formatDate(event.start, { weekday: 'long' })}<br>${event.allDay ? 'All day' : `${formatTime(event.start)} – ${formatTime(event.end)}`} · London time${event.location ? `<br>${escape(event.location)}` : ''}</p>${task ? `<p class="event-detail-note">Part of ${task.needsEstimate ? 'Estimate needed' : `${['ai', 'gemini', 'claude'].includes(task.estimateSource) ? '~' : ''}${durationLabel(task.estimatedMinutes)}`}${task.includeInPlan === false ? ' · Not planned' : ''} of planned work${task.dueDate ? ` · due ${formatDate(task.dueDate)}, ${formatTime(task.dueDate)}` : ''}. Complete the task when all its work is done.</p><button class="button primary" data-complete="${escape(task.id)}">${icon('check')}Mark task complete</button> <button class="button secondary" data-edit-task="${escape(task.id)}">Edit task</button>${url ? `<p><a class="text-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Open in Moodle ${icon('external')}</a></p>` : ''}` : event.kind === 'weekly' || event.kind === 'commute' ? '<p><a class="text-link" href="setup.html">Edit your routine in setup</a></p>' : event.source === 'personal' ? `<button class="button secondary" data-remove-block="${escape(event.id)}">Remove personal time</button>` : ''}`;
  $('#event-dialog').showModal();
}
async function syncMoodle() {
  if (syncing) return;
  syncing = true; $('#sync-button').disabled = true; $('#sync-button span').textContent = 'Syncing…';
  try {
    const result = await planner.loadCourses(); state = result.workspace; selectedCourse = null; setView('courses'); render();
    toast(result.warnings.join(' ') || `${state.courses.length} modules loaded. Choose modules, then fetch and analyse selected.`, true);
  } catch (error) { toast(error.message, true); }
  finally { syncing = false; $('#sync-button').disabled = false; $('#sync-button span').textContent = 'Sync Moodle'; renderCourses(); }
}
async function buildCoursePlan() {
  if (syncing) return;
  syncing = true; $('#sync-button').disabled = true; renderCourses();
  const unsubscribe = planner.subscribe(event => { if (event.type === 'progress') toast(`${event.stage === 'fetching' ? 'Saving' : 'Analysing'} ${event.course.shortname || event.course.name} (${event.index}/${event.total})…`, true); });
  try {
    const fetched = await planner.fetchSelectedCourses();
    const analysed = await planner.analyseSelectedCourses();
    state = await planner.createPlan(); render();
    const errors = [...fetched.errors, ...analysed.errors];
    toast(errors.length ? `Course content saved. ${errors.map(error => error.message).join(' ')}` : state.planning.warning || 'Study tasks extracted and your calendar updated.', true);
  } catch (error) { state = await planner.getWorkspace(); render(); toast(error.message, true); }
  finally { unsubscribe(); syncing = false; $('#sync-button').disabled = false; renderCourses(); }
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
    const result = await planner.connectTimetable(url);
    state = result.workspace; render();
    $('#moodle-status').textContent = state.moodleSyncedAt ? `Last synced ${formatDate(state.moodleSyncedAt)}` : 'Not connected';
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
  const button = $('#chat-form button'); button.disabled = true;
  try {
    await persist();
    const result = await planner.chat(text); state = result.workspace;
    if (!result.applied) { state.messages.push({ role: 'user', text }, { role: 'assistant', text: result.reply }); await persist(); }
    if (state.planning?.warning) toast(state.planning.warning, true);
  } catch (error) {
    state.messages.push({ role: 'user', text }, { role: 'assistant', text: error.message }); await persist();
  } finally { button.disabled = false; render(); }
}

async function init() {
  document.body.dataset.input = 'pointer';
  document.addEventListener('keydown', () => { document.body.dataset.input = 'keyboard'; }, { capture: true });
  document.addEventListener('pointerdown', () => { document.body.dataset.input = 'pointer'; }, { capture: true });
  try { state = await planner.getWorkspace(); } catch { state = createDemo(); }
  for (let hour = 5; hour <= 23; hour++) {
    if (hour <= 21) $('#start-hour').add(new Option(`${String(hour).padStart(2, '0')}:00`, hour));
    if (hour >= 6) $('#end-hour').add(new Option(`${String(hour).padStart(2, '0')}:00`, hour));
  }
  render();
  if (state.analysisWarnings?.length || state.planning?.warning) toast([...(state.analysisWarnings || []), state.planning?.warning].filter(Boolean).join(' '), true);
  if (isExtension) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.workspace?.newValue) { state = changes.workspace.newValue; render(); } });
  $$('.nav-item[data-view]').forEach(b => b.addEventListener('click', () => { selectedCourse = null; setView(b.dataset.view); render(); }));
  $('#see-all-tasks').addEventListener('click', () => { selectedCourse = null; setView('tasks'); renderTasks(); });
  $('#all-modules-button').addEventListener('click', () => { selectedCourse = null; setView('courses'); render(); });
  $('#task-filter').addEventListener('change', renderTasks);
  document.addEventListener('change', async event => {
    if (!event.target.matches('[data-toggle-course]')) return;
    const ids = state.courses.filter(c => String(c.id) === event.target.dataset.toggleCourse ? event.target.checked : isCourseIncluded(state, c.id)).map(c => c.id);
    try { state = await planner.selectCourses(ids); render(); } catch (error) { toast(error.message, true); }
  });
  $('#previous-week').addEventListener('click', () => { currentWeek = addDays(currentWeek, -7); agendaDay = null; render(); });
  $('#next-week').addEventListener('click', () => { currentWeek = addDays(currentWeek, 7); agendaDay = null; render(); });
  $('#today-button').addEventListener('click', () => { currentWeek = weekStart(); agendaDay = dateKey(); render(); });
  ['settings-button', 'connections-button', 'mode-badge'].forEach(id => $(`#${id}`).addEventListener('click', openSettings));
  ['add-task-button', 'quick-add-task'].forEach(id => $(`#${id}`).addEventListener('click', () => openTask()));
  $$('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));
  document.addEventListener('click', async e => {
    const complete = e.target.closest('[data-complete]'), edit = e.target.closest('[data-edit-task]'), course = e.target.closest('[data-course]'), event = e.target.closest('[data-event]'), remove = e.target.closest('[data-remove-block]');
    if (complete) {
      const task = state.tasks.find(t => t.id === complete.dataset.complete); if (!task) return;
      const list = complete.closest('#all-tasks, #upcoming-tasks');
      const index = list ? [...list.querySelectorAll('[data-complete]')].indexOf(complete) : -1;
      task.completed = !task.completed; task.completionOverride = task.completed; $('#event-dialog').close(); await changeAndRender();
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
    if (event) openEvent(event.dataset.event);
    if (remove) { state.blocked = state.blocked.filter(b => b.id !== remove.dataset.removeBlock); $('#event-dialog').close(); await changeAndRender(); renderBlocked(); toast('Personal time removed. Your plan has been updated.'); }
    const day = e.target.closest('[data-agenda-day]');
    if (day) {
      agendaDay = day.dataset.agendaDay; renderAgenda(weekEvents());
      $(`#calendar-agenda [data-agenda-day="${agendaDay}"]`).focus({ preventScroll: true });
    }
    if (e.target.closest('[data-add-task]')) openTask();
    if (e.target.closest('[data-sync-moodle]')) await syncMoodle();
  });
  $('#generate-button').addEventListener('click', async () => { const button = $('#generate-button'); button.disabled = true; try { await persist(); state = await planner.createPlan(); render(); toast(state.planning.warning || 'Your plan has been updated.', true); } catch (error) { toast(error.message, true); } finally { button.disabled = false; } });
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
      state = await planner.importTimetable(await file.text()); render(); showCalendarResult(); $('#calendar-url').value = ''; $('#settings-error').textContent = ''; $('#calendar-error').textContent = '';
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
      const data = { title, estimatedMinutes, courseId, courseName: course?.shortname || course?.name || 'Personal', dueDate, estimateEdited: true, estimateSource: 'user', needsEstimate: false };
      if (existing?.source === 'moodle-content') { data.includeInPlan = $('#task-plan-included').checked; data.planInclusionEdited = true; }
      if (existing) { Object.assign(existing, data); delete state.preferences[existing.id]; }
      else state.tasks.push({ id: `personal-${crypto.randomUUID()}`, ...data, type: 'other', url: null, completed: false, source: 'personal' });
      await changeAndRender(); $('#task-dialog').close(); toast('Task saved. Your study plan has been updated.');
    } catch (error) { $('#task-error').textContent = error.message; }
  });
  $('#delete-task-button').addEventListener('click', async () => { const id = $('#task-id').value; state.tasks = state.tasks.filter(t => t.id !== id); delete state.preferences[id]; await changeAndRender(); $('#task-dialog').close(); toast('Task removed from your workspace.'); });
  $('#chat-form').addEventListener('submit', async e => { e.preventDefault(); const text = $('#chat-input').value.trim(); if (!text) return; $('#chat-input').value = ''; await submitChat(text); });
  $$('[data-suggestion]').forEach(b => b.addEventListener('click', () => { $('#chat-input').value = b.dataset.suggestion; $('#chat-input').focus(); }));
  // Refresh the current-time marker without rescheduling an existing plan.
  setInterval(() => { if (document.visibilityState === 'visible' && currentView === 'week') updateNowMarker(); }, 60000);
}
init().catch(() => { document.body.innerHTML = '<main style="margin:40px"><h1>Let’s make a fresh start.</h1><p>The workspace could not load. Reload the extension and try again.</p></main>'; });
