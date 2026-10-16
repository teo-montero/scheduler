import { createExtensionConnections } from './integrations/client.js';
import { BUILD_ID } from './protocol.js';

// A separate entry point: no workspace queue, sample data, planner or AI imports.
const connection = createExtensionConnections();
const button = document.querySelector('#get-moodle-courses');
const status = document.querySelector('#moodle-direct-status');
const results = document.querySelector('#moodle-direct-results');
function showRawResponse(response) {
  if (!response) return;
  const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
  summary.textContent = response.source === 'mock' ? 'Recorded Moodle response · MOCK FALLBACK' : `Raw Moodle response · HTTP ${response.status}`; details.open = true;
  pre.style.whiteSpace = 'pre-wrap'; pre.style.overflowWrap = 'anywhere';
  pre.textContent = JSON.stringify(response, null, 2);
  details.append(summary, pre); results.append(details);
}
console.info('[Study Space][Moodle check] Ready', { buildId: BUILD_ID });
button.addEventListener('click', async () => {
  console.info('[Study Space][Moodle check] Button clicked', { buildId: BUILD_ID });
  button.disabled = true; button.textContent = 'Fetching courses…'; status.hidden = false; results.replaceChildren();
  status.className = 'field-help'; status.textContent = 'Calling core_course_get_enrolled_courses_by_timeline_classification…';
  try {
    if (globalThis.chrome?.runtime?.id && chrome.permissions?.request && !await chrome.permissions.request({ origins: ['https://moodle.ucl.ac.uk/*'] })) throw new Error('Allow Moodle site access for this extension, then try again.');
    const response = await connection.moodle.runExactCoursesCall();
    console.info('[Study Space][Moodle check] Response', { dataSource: response.dataSource, response });
    const session = response.diagnostics;
    if (session?.sessionKeyFound) console.info('[Study Space][Moodle check] Sesskey extraction confirmed', { found: session.sessionKeyFound, source: session.sessionKeySource, length: session.sessionKeyLength, tabId: session.tabId, page: session.page, transport: session.transport, pageKeyMatchesOverride: session.pageKeyMatchesOverride });
    const courses = response.courses || [];
    status.textContent = response.dataSource === 'mock' ? response.warnings.join(' ') : `HTTP ${response.rawResponse.status}. Direct POST completed inside Moodle: ${courses.length} courses returned (offset 0, limit 24).`;
    const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ul');
    summary.textContent = 'Show returned course names and IDs'; details.open = true;
    for (const course of courses) { const item = document.createElement('li'); item.textContent = `${course.shortname || ''} · ${course.name} (ID: ${course.id})`; list.append(item); }
    details.append(summary, list); results.append(details);
    showRawResponse(response.rawResponse);
  } catch (error) {
    console.warn('[Study Space][Moodle check] Failed', { message: error.message, diagnostics: error.diagnostics });
    status.className = 'form-error';
    const tabs = error.diagnostics?.tabs || [], session = tabs.find(tab => tab.sessionKeyFound);
    status.textContent = `${session ? `Sesskey found in ${session.sessionKeySource} (${session.sessionKeyLength} characters). ${typeof session.pageKeyMatchesOverride === 'boolean' ? `Supplied key ${session.pageKeyMatchesOverride ? 'matches' : 'does not match'} the key extracted from the page. ` : ''}` : ''}${error.message} Requests are made in the Moodle tab; inspect that tab’s Network panel for service.php.`;
    showRawResponse(tabs.find(tab => tab.response)?.response);
  } finally { button.disabled = false; button.textContent = 'Run Moodle API call'; }
});
