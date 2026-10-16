import { createBrowserPlanner } from './planner/index.js';
import { isCourseIncluded } from './modules.js';
import { TIMETABLE_ORIGINS } from './protocol.js';
const planner = createBrowserPlanner();
let workspace, coursesLoaded = false, moodleAttempted = false, busy = false;
const status = document.querySelector('.setup-preview');
status.id = 'setup-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
status.textContent = 'Connect your sources and check the fetched data before creating your plan.';
const connectionNote = document.querySelector('.setup-connection-note');
connectionNote.textContent = 'After signing in, load your modules and check course data. These checks do not call AI.';
const courseControls = document.createElement('div');
courseControls.innerHTML = '<button type="button" id="setup-load-courses" class="button secondary">Load modules</button> <button type="button" id="setup-check-courses" class="button secondary" disabled>Check selected course data</button><div id="setup-course-list"></div>';
connectionNote.after(courseControls);

const form = document.querySelector('#setup-form');
const panels = [...document.querySelectorAll('.setup-panel')];
const steps = [...document.querySelectorAll('.setup-steps li')];
const back = document.querySelector('#setup-back');
const next = document.querySelector('#setup-next');
const activities = document.querySelector('#setup-activities');
const addActivity = document.querySelector('#add-activity');
let step = 0, activityId = 0;

function showStep(index) {
  step = index;
  panels.forEach((panel, i) => { panel.hidden = i !== step; });
  steps.forEach((item, i) => {
    if (i === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.classList.toggle('step-visited', i < step);
  });
  back.disabled = step === 0;
  document.querySelector('#setup-progress').textContent = `Step ${step + 1} of 4`;
  next.firstChild.textContent = step === 3 ? 'Go to my week ' : 'Continue ';
  const title = panels[step].querySelector('h1');
  document.querySelector('.skip-link').href = `#${title.id}`;
  document.title = `${title.textContent} · Study Space`;
  title.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function selectedCourseIds() { return [...document.querySelectorAll('[data-setup-course]:checked')].map(input => input.value); }
function renderCourses() {
  const target = document.querySelector('#setup-course-list'); target.replaceChildren();
  for (const course of workspace.courses) {
    const label = document.createElement('label'); label.className = 'checkbox-label';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = course.id; input.dataset.setupCourse = course.id; input.checked = isCourseIncluded(workspace, course.id);
    label.append(input, document.createTextNode(`${course.shortname || ''} · ${course.name}`)); target.append(label);
    const saved = workspace.courseContent?.[course.id]?.state;
    if (saved) {
      const detail = document.createElement('details'), summary = document.createElement('summary'), samples = document.createElement('p');
      summary.textContent = `${saved.sections.length} sections · ${saved.activities.length} activities fetched${saved.dataSource === 'mock' ? ' · MOCK FALLBACK' : ''}`;
      samples.className = 'setup-help'; samples.textContent = saved.activities.slice(0, 3).map(item => item.name).join(' · ') || 'No visible activities in the response.';
      detail.append(summary, samples); target.append(detail);
    }
  }
  document.querySelector('#setup-check-courses').disabled = !workspace.courses.length;
}
async function withBusy(operation) {
  if (busy) return; busy = true; next.disabled = true; back.disabled = true;
  document.querySelector('#setup-load-courses').disabled = true; document.querySelector('#setup-check-courses').disabled = true;
  try { await operation(); }
  catch (error) { status.textContent = error.message; status.setAttribute('role', 'alert'); }
  finally { busy = false; next.disabled = false; back.disabled = step === 0; document.querySelector('#setup-load-courses').disabled = false; document.querySelector('#setup-check-courses').disabled = !workspace?.courses.length; }
}
async function loadCourses() {
  status.textContent = 'Reading your enrolled modules from Moodle…';
  const result = await planner.loadCourses(); workspace = result.workspace; coursesLoaded = true; renderCourses();
  status.textContent = `${workspace.courses.length} enrolled modules fetched. Select the modules to check. ${result.warnings.join(' ')}`;
}
async function checkCourseData() {
  workspace = await planner.selectCourses(selectedCourseIds());
  const result = await planner.fetchSelectedCourses(); workspace = result.workspace; renderCourses();
  const selected = workspace.courses.filter(course => isCourseIncluded(workspace, course.id));
  const count = selected.reduce((sum, course) => sum + (workspace.courseContent[course.id]?.state.activities.length || 0), 0);
  status.textContent = result.errors.length ? result.errors.map(error => `${error.courseId}: ${error.message}`).join(' ') : `${selected.length} selected course indexes fetched and saved · ${count} visible activities. No AI calls have been made.`;
  if (result.warnings?.length) status.textContent += ` ${result.warnings.join(' ')}`;
  if (result.errors.length) throw new Error(status.textContent);
}
planner.subscribe(event => { if (event.type === 'progress') status.textContent = `${event.stage === 'fetching' ? 'Fetching' : 'Analysing'} ${event.course.shortname || event.course.name} (${event.index}/${event.total})…`; });
document.querySelector('#setup-load-courses').addEventListener('click', () => withBusy(loadCourses));
document.querySelector('#setup-check-courses').addEventListener('click', () => withBusy(checkCourseData));
document.querySelector('#setup-moodle-link').addEventListener('click', () => { moodleAttempted = true; status.textContent = 'Sign in to Moodle, return here, then click Load modules.'; });
form.addEventListener('submit', event => {
  event.preventDefault();
  const invalid = [...panels[step].querySelectorAll('input')].find(input => !input.checkValidity());
  if (invalid) { invalid.reportValidity(); return; }
  withBusy(async () => {
    status.setAttribute('role', 'status');
    if (step === 0) {
      const url = document.querySelector('#setup-timetable').value.trim();
      if (url && (workspace.calendarUrl !== url || !workspace.calendarSyncedAt)) {
        const permission = globalThis.chrome?.permissions?.request({ origins: TIMETABLE_ORIGINS });
        status.textContent = 'Fetching your UCL timetable…';
        if (permission && !await permission) throw new Error('Allow access to the UCL timetable sites, then try again.');
        const result = await planner.connectTimetable(url); workspace = result.workspace;
        status.textContent = `${workspace.events.length} timetable events fetched and saved.`;
      }
    }
    if (step === 1) {
      if (!coursesLoaded && moodleAttempted) { await loadCourses(); return; }
      if (coursesLoaded) await checkCourseData();
    }
    if (step === 2) workspace = await planner.savePersonal({ personal: { commuteMinutes: Number(document.querySelector('#setup-commute').value || 0), studyLocation: document.querySelector('[name="study-place"]:checked')?.value || 'either' } });
    if (step < panels.length - 1) { showStep(step + 1); return; }
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weeklyActivities = [...activities.children].map(row => ({ id: row.dataset.activityId, title: row.querySelector('[name^="activity-"]').value,
      days: [...row.querySelectorAll('input[type="checkbox"]:checked')].map(input => days.indexOf(input.value)), startTime: row.querySelector('[name^="activity-start-"]').value, endTime: row.querySelector('[name^="activity-end-"]').value }));
    workspace = await planner.savePersonal({ weeklyActivities });
    const analysed = await planner.analyseSelectedCourses();
    workspace = await planner.createPlan();
    workspace.analysisWarnings = analysed.errors.map(error => error.message);
    workspace.setupComplete = true; workspace.setupCompletedAt = new Date().toISOString();
    await planner.saveWorkspace(workspace);
    window.location.assign('dashboard.html');
  });
});
back.addEventListener('click', () => { if (step > 0) showStep(step - 1); });

function refreshActivities() {
  const rows = [...activities.children];
  document.querySelector('#activities-empty').hidden = rows.length > 0;
  rows.forEach((row, index) => {
    row.querySelector('h2').textContent = `Activity ${index + 1}`;
    row.querySelector('.activity-remove').setAttribute('aria-label', `Remove activity ${index + 1}`);
  });
}

function addActivityRow(activity = {}) {
  const id = ++activityId;
  const row = document.createElement('section');
  row.className = 'setup-activity'; row.dataset.activityId = activity.id || `weekly-${crypto.randomUUID()}`;
  row.setAttribute('aria-labelledby', `activity-title-${id}`);
  row.innerHTML = `<div class="activity-heading"><h2 id="activity-title-${id}"></h2><button type="button" class="activity-remove">Remove</button></div>
    <label for="activity-name-${id}">Activity name</label><input id="activity-name-${id}" name="activity-${id}" maxlength="100" placeholder="e.g. Football training" autocomplete="off">
    <fieldset class="activity-days"><legend>Repeats every</legend><div class="activity-day-options">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `<label class="activity-day"><input type="checkbox" name="activity-days-${id}" value="${day}" aria-label="${day}"><span aria-hidden="true">${day.slice(0, 3)}</span></label>`).join('')}</div></fieldset>
    <div class="activity-times"><label for="activity-start-${id}">Starts at<input id="activity-start-${id}" name="activity-start-${id}" type="time"></label><label for="activity-end-${id}">Ends at<input id="activity-end-${id}" name="activity-end-${id}" type="time"></label></div>`;
  activities.append(row);
  refreshActivities();
  row.querySelector('input').value = activity.title || '';
  row.querySelector('[name^="activity-start-"]').value = activity.startTime || '';
  row.querySelector('[name^="activity-end-"]').value = activity.endTime || '';
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  row.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = (activity.days || []).includes(dayNames.indexOf(input.value)); });
  row.querySelector('input').focus();
  document.querySelector('#activity-announcement').textContent = 'Activity added.';
}
addActivity.addEventListener('click', () => addActivityRow());
activities.addEventListener('click', event => {
  const remove = event.target.closest('.activity-remove');
  if (!remove) return;
  const row = remove.closest('.setup-activity');
  const focusTarget = row.nextElementSibling?.querySelector('input') || row.previousElementSibling?.querySelector('input') || addActivity;
  row.remove();
  refreshActivities();
  focusTarget.focus();
  document.querySelector('#activity-announcement').textContent = 'Activity removed.';
});

async function init() {
  workspace = await planner.getWorkspace();
  document.querySelector('#setup-timetable').value = workspace.calendarUrl || '';
  document.querySelector('#setup-commute').value = workspace.personal?.commuteMinutes || '';
  const location = workspace.personal?.studyLocation;
  if (location === 'home' || location === 'campus') document.querySelector(`[name="study-place"][value="${location}"]`).checked = true;
  (workspace.weeklyActivities || []).forEach(activity => addActivityRow(activity));
  coursesLoaded = workspace.mode !== 'demo' && Boolean(workspace.moodleSyncedAt);
  if (coursesLoaded) renderCourses();
  showStep(0);
}
next.disabled = true;
init().then(() => { next.disabled = false; }).catch(error => { status.textContent = error.message; });
