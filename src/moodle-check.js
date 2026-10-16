import { createExtensionConnections } from './integrations/client.js';
import { BUILD_ID } from './protocol.js';

// A separate entry point: no workspace queue, sample data, planner or AI imports.
const connection = createExtensionConnections();
const button = document.querySelector('#get-moodle-courses');
const status = document.querySelector('#moodle-direct-status');
const results = document.querySelector('#moodle-direct-results');
console.info('[Study Space][Moodle check] Ready', { buildId: BUILD_ID });
button.addEventListener('click', async () => {
  console.info('[Study Space][Moodle check] Button clicked', { buildId: BUILD_ID });
  button.disabled = true; button.textContent = 'Fetching courses…'; status.hidden = false; results.replaceChildren();
  status.className = 'field-help'; status.textContent = 'Calling core_course_get_enrolled_courses_by_timeline_classification…';
  try {
    if (globalThis.chrome?.runtime?.id && chrome.permissions?.request && !await chrome.permissions.request({ origins: ['https://moodle.ucl.ac.uk/*'] })) throw new Error('Allow Moodle site access for this extension, then try again.');
    const response = await connection.moodle.listCourses();
    console.info('[Study Space][Moodle check] Actual Moodle response', response);
    const courses = response.courses || [];
    status.textContent = `Moodle returned ${courses.length} courses at ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })}. These are fetched from Moodle; no Gemini request was made.`;
    const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ul');
    summary.textContent = 'Show returned course names and IDs'; details.open = true;
    for (const course of courses) { const item = document.createElement('li'); item.textContent = `${course.shortname || ''} · ${course.name} (ID: ${course.id})`; list.append(item); }
    details.append(summary, list); results.append(details);
  } catch (error) {
    console.warn('[Study Space][Moodle check] Failed', { message: error.message });
    status.className = 'form-error'; status.textContent = error.message;
  } finally { button.disabled = false; button.textContent = 'Get Moodle courses'; }
});
