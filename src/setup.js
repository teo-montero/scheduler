// UI-only setup prototype. No workspace reads/writes, imports or scheduling.
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

form.addEventListener('submit', event => {
  event.preventDefault();
  const invalid = [...panels[step].querySelectorAll('input')].find(input => !input.checkValidity());
  if (invalid) { invalid.reportValidity(); return; }
  if (step < panels.length - 1) showStep(step + 1);
  else window.location.assign('dashboard.html');
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

addActivity.addEventListener('click', () => {
  const id = ++activityId;
  const row = document.createElement('section');
  row.className = 'setup-activity';
  row.setAttribute('aria-labelledby', `activity-title-${id}`);
  row.innerHTML = `<div class="activity-heading"><h2 id="activity-title-${id}"></h2><button type="button" class="activity-remove">Remove</button></div>
    <label for="activity-name-${id}">Activity name</label><input id="activity-name-${id}" name="activity-${id}" maxlength="100" placeholder="e.g. Football training" autocomplete="off">
    <fieldset class="activity-days"><legend>Repeats every</legend><div class="activity-day-options">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `<label class="activity-day"><input type="checkbox" name="activity-days-${id}" value="${day}" aria-label="${day}"><span aria-hidden="true">${day.slice(0, 3)}</span></label>`).join('')}</div></fieldset>
    <div class="activity-times"><label for="activity-start-${id}">Starts at<input id="activity-start-${id}" name="activity-start-${id}" type="time"></label><label for="activity-end-${id}">Ends at<input id="activity-end-${id}" name="activity-end-${id}" type="time"></label></div>`;
  activities.append(row);
  refreshActivities();
  row.querySelector('input').focus();
  document.querySelector('#activity-announcement').textContent = 'Activity added.';
});
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
