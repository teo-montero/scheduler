# Study Space · UCL Planner

A Manifest V3 Chrome extension with a full-page study planner. It reads selected Moodle course indexes, uses Gemini to identify study tasks and estimate effort, and schedules focus sessions around a UCL iCalendar timetable and personal time. Course data and plans stay in Chrome local storage; a small local backend holds the Gemini API key. No database is needed.

## Implementation guides

- [Calendar connection](docs/01-calendar-connection.md): URL handling, downloading ICS, recurrence, timezones and import feedback.
- [Moodle connection](docs/02-moodle-connection.md): session authentication, MAIN-world execution, AJAX calls and task mapping.
- [UI design and data assignment](docs/03-ui-and-data-assignment.md): visual structure, state models, calendar rendering and scheduling, with a worked example.

## Run it

1. In this folder, run `npm install` and `npm run build`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this project folder (`scheduler-extension`). You can also select `dist` for a clean package.
4. Click the extension’s toolbar icon. Until setup is completed, the four-step setup opens: timetable URL, Moodle course selection/content, study preferences, then weekly activities. Existing workspace data is prefilled and retained.
5. Finish the last step to analyse courses, create the plan and open the calendar. Later toolbar launches open that calendar. **Skip setup** opens the calendar for this visit; unfinished setup still opens next time. Fresh workspaces start empty.

After code changes, run `npm run build`, click **Reload** on the extension card, then refresh its dashboard tab. Both the project root and `dist` contain the manifest and runtime files after building. Selecting `src`, a parent directory, or a zip file will not work.

For a browser preview: `npm run build && npm run dev`, then open http://127.0.0.1:4173. The preview supports sample data, manual tasks, ICS file imports, and scheduling. Live Moodle/timetable URL sync requires the loaded extension.

## Direct Moodle check

Version 1.2.6 includes **Run Moodle API call** beside **Sync Moodle**. It injects a standalone script into an open UCL Moodle tab using `chrome.scripting.executeScript` in the MAIN world. That script immediately makes one POST to `core_course_get_enrolled_courses_by_timeline_classification`, with the supplied request body (offset 0, limit 24). Chrome supplies the current Moodle cookies and browser headers. The script does not load RequireJS, run Moodle core/ajax, paginate, or start the planner/Gemini. The button displays the HTTP status, returned course names/IDs and raw response; the Moodle tab console logs the request and response.

The ignored `moodle-local.json` can enable a local sesskey override (`enabled: true` and `sesskey`). The build copies this ignored file into the local extension package when present. Otherwise the script uses `window.M.cfg.sesskey`. Credentials are redacted from diagnostic output.

After building, reload Study Space in `chrome://extensions`, then refresh its dashboard tab. Open a signed-in Moodle tab and click **Run Moodle API call**. No AppleScript/browser automation setting is needed. Sample workspaces never call Gemini, including plan regeneration and free-form chat.

## Moodle mock fallbacks

Course listing and each selected course-state request use the same direct POST script inside the signed-in Moodle tab. Normal course listing paginates in batches of 24; **Run Moodle API call** remains a single request.

The user-supplied responses are saved in `fixtures/moodle`: the 11 enrolled modules, COMP0017 (56435) and BENG0095 (58243). The live request is always attempted first. If it fails, the matching recorded response is returned with `dataSource: "mock"`, the original failure reason and an explicit **MOCK FALLBACK** message in the console and existing status text. The diagnostic button labels recorded responses without claiming an HTTP 200. Saved workspace/course snapshots retain their source. No content is invented for other module IDs; those fetches report their errors. A successful empty live response remains empty and does not trigger fallback. Timetable calls are unaffected.

## Check connections before running AI

1. Open **Set up your workspace** (or the extension’s `setup.html`).
2. Enter your UCL timetable URL and continue. The status reports how many calendar events were fetched and saved.
3. Open Moodle, sign in, return to setup and click **Load modules**.
4. Select the courses you want, then click **Check selected course data**.
5. Inspect the section/activity counts and expand each course’s details to see sample resource titles. This fetches and saves source data only; it makes no AI calls.

Finishing the final setup step starts course analysis and AI planning. If Gemini is unavailable, course content stays saved for retry. A planning failure is labelled as a local fallback. The setup also saves your one-way commute, home/campus preference and weekly activities. The dashboard uses those same records.

## Gemini connection check

The ignored local `.env` file contains `GEMINI_API_KEY` and `GEMINI_MODEL`. Run `npm run ai:check` to make one small live structured-output request with the configured key/model. This uses no Moodle or timetable data and prints only success, provider/model and token usage. `npm run ai` starts the backend needed by the extension; keep it running during AI requests.

The [planner API guide](docs/04-planner-api.md) explains the UI-independent service, integration boundaries and method contracts.

## Connect your data

**Moodle:** Open https://moodle.ucl.ac.uk/my/ in another tab and sign in. Click **Sync Moodle** to load enrolled modules, then choose the modules in **My modules**. **Fetch & analyse selected** makes one `core_courseformat_get_state` request per selected module, saves its course index locally, and asks Gemini to identify tasks and estimate their workload. The app then schedules eligible tasks into its own calendar. Moodle authentication uses the current tab’s session, without copied cookies or session keys.

**Gemini setup:** Use Node.js 20.12 or later. Copy `.env.example` to `.env`, set `GEMINI_API_KEY` there, then run `npm run ai` in a separate terminal and leave it running. `.env` is ignored by Git and excluded from the extension build. The MVP uses `gemini-3.5-flash-lite` (live structured-output check passed). `gemini-3.8-flash` was returning a temporary high-demand error; set it later through `GEMINI_MODEL` if desired. Change `GEMINI_MODEL` to use another model supporting structured outputs. Use a key from Google AI Studio. The backend uses the JavaScript `@google/genai` SDK and `interactions.create`, with `store: false` so this app does not use Google’s stored conversation history.

The backend listens at `http://127.0.0.1:8787` and forwards selected course metadata to Google Gemini only when analysis starts. It does not persist course content. Course fetches still save successfully without the backend/key; use **Fetch & analyse selected** once configured. **Fetch & analyse selected** reuses saved analysis if the content is unchanged. Completion-only changes update locally without another Gemini call.

Course indexes usually contain names, sections, activity types and links, rather than the contents of linked PDFs/notebooks. Estimates reflect that limited context and are editable. Optional material starts outside the plan; coursework with insufficient scope requires an estimate. Open a task to review its source, reasoning, estimate and **Include in my plan** choice. The app does not invent deadlines from week labels. **Refresh deadlines** optionally enriches tasks from Moodle’s calendar API, matching activity IDs to avoid duplicate work.

**Timetable:** Open **Preferences** or **Manage connections**. Paste your UCL timetable iCalendar subscription URL and click **Sync timetable**. The legacy `https://timetable.apps.ucl.ac.uk/icalendar/…` subscription is resolved directly to UCL’s `https://timetable.mesh.ucl.ac.uk/online-timetable-api-proxy/v0.1/icalendar?key_identifier=…` API, avoiding its HTTP 307 redirect. You can paste either URL. Only these UCL timetable hosts and recognised paths are allowed. The button shows download progress, then a preview of your next classes and **View my calendar**. If Chrome has withheld timetable site access, it requests the necessary UCL host permissions. Saving preferences with a new subscription URL also downloads it immediately. Alternatively, import an `.ics` file. Timetable imports expand recurring events for the next 120 days, with a one-week lookback. Refresh the feed periodically using **Sync timetable**.

The first successful real integration replaces the sample workspace. Real feeds are never mixed with sample classes or assignments. Importing a timetable does not automatically sync Moodle; connect both feeds. Syncing and file importing save immediately. The preferences form’s Cancel button dismisses unsaved study-hour/URL edits. Failed downloads retain the previous calendar and display an error beside the subscription controls.

## Choose your modules

The first successful Moodle sync opens **My modules**. Toggle **Include in my plan** for each enrolled module, in setup or the module overview. Changes save immediately and regenerate the study plan.

Module choices control the overall task list, upcoming deadlines, task totals, chat task matching and generated study sessions. Open a module directly to inspect its saved tasks even when it is excluded. Its tasks, estimates and completion history are retained, and exclusions survive later Moodle syncs. Existing and newly discovered modules are included by default until you exclude them. Independent personal tasks remain included.

All imported timetable commitments continue to reserve time. Choosing modules changes which work you plan for; it does not change your university timetable.

## Use the planner

- Add personal tasks, deadlines and work estimates. Gemini estimates are starting points. Standalone Moodle calendar actions use defaults of 120 minutes for assignments and 60 for quizzes; coursework with unknown scope in the course analysis requires your estimate.
- Click a calendar session for its details, or a task title to edit it. Source titles/deadlines are refreshed from Moodle; estimates and local completion survive syncs. Optional resources can be included from the task editor.
- Mark a task complete when all its work is finished. Completion affects this planner only; it does not submit work or change Moodle.
- **Regenerate plan** asks Gemini to allocate work up to 28 days ahead. Local validation protects lectures first, then weekly/personal commitments, and puts study tasks into remaining slots. It respects study hours, commute/home-campus preferences, deadlines, a default six-hour daily study cap and breaks. Fixed clashes are reported rather than silently moving lectures.
- Work that cannot fit is reported in **All tasks**. The planner never silently schedules it beyond its deadline.
- Existing saved plans stay in place when reopening the dashboard. Regenerate to update them for the current time.
- Initial sample plans illustrate a complete week, including earlier days; any edits/regeneration use the actual current time.

The command box handles these common commands locally and asks Gemini to interpret other requests. Calendar replanning can use Gemini after either kind of command:

- `I’m busy Wednesday afternoon` → blocks 12:00–18:00 and replans.
- `I’m busy tomorrow 14:00–17:00` → blocks that time.
- `Finished maths problem sheet` → completes the matching task and replans.
- `Move maths problem sheet to Friday` → constrains its work to that day and reports any time that will not fit.

Day names mean the next matching day, including today. Morning is 08:00–12:00, afternoon 12:00–18:00, evening 17:00–23:00. Use “all day” or a 24-hour range for other times. Ambiguous task matches request a more specific title. To clear a task’s day preference, save it in the task editor. Remove personal-time blocks in Preferences or by clicking them on the calendar. These blocks move study sessions; they do not change your university timetable.

## Data and scope

- Uses `chrome.storage.local` restricted to trusted extension contexts. No analytics, remote scripts or remote fonts. Course analysis sends selected course titles, section labels and activity metadata to Google through the local backend. AI planning sends task names/estimates, event times/labels, availability and commute preferences. Free-form chat sends your request and a task index. Linked documents are not downloaded; calendar subscription URLs and original resource URLs are excluded from model input. The key never enters Chrome storage or the extension bundle.
- Never reads or saves session cookies. The session key stays inside the Moodle page’s sync function and is not returned or persisted.
- The private calendar URL is saved locally in the extension only. Never paste it into source files or commit it. Clearing saved data removes it.
- The previous starter files contained a hardcoded session key and private calendar URL; both were removed.
- All planner times use **Europe/London**, including BST/GMT transitions, independently of the device timezone.
- Calendar parsing uses bundled `ical.js`: timezone definitions, TZID dates, UTC, all-day events, recurrence, exclusions, overrides and cancellations are supported. Floating dates use London time; timezone IDs without embedded definitions use the browser’s timezone database.
- The course index is fetched with the internal Moodle APIs supplied for this project. Hidden activities are filtered and duplicate activity IDs rejected. Folder contents and linked files need additional API calls if you want deeper analysis later.
- Course states and Gemini outputs were checked with supplied export formats and simulated browser/API responses. Live signed-in Moodle and live Gemini billing calls have not been verified by automated tests. Never commit request captures containing cookies or session keys.

## Checks

`npm run check` validates syntax, runs scheduling/calendar/command/Moodle/Gemini-backend tests, and rebuilds the extension.

`npm run test:browser` tests both unpacked folders in isolated Chromium profiles, covers dashboard interactions, calendar previews, network failure recovery, importing on Save, and exercises module selection, MAIN-world course fetching, durable saves, cached analysis and task import with simulated Moodle/Gemini responses. Install the test browser once with `npx playwright install chromium`. It never uses your real Chrome profile or Moodle account.

Source is in `src/`; `dashboard.html` and `styles.css` define the UI; `scripts/build.mjs` bundles all dependencies locally into root runtime files and copies a clean distribution to `dist/`.

API references: [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [Moodle calendar external API](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/calendar/externallib.php), [ical.js](https://github.com/kewisch/ical.js), [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

## API console logs

Open DevTools on the extension setup/dashboard and filter Console for `[Study Space]`. The connection bridge logs each operation and the returned course/event/activity counts. Moodle AJAX requests also log their method name, pagination, course ID, HTTP status and elapsed time in the signed-in Moodle tab’s Console. Timetable download/status/import counts are logged in the extension service worker Console (`chrome://extensions` → Study Space → Service worker). Gemini request/status/token summaries appear in the terminal running `npm run ai`. Logs include full request payloads, response bodies, parsed Moodle state, timetable ICS and parsed events. Gemini payloads/responses appear in the backend terminal. Authentication values and private subscription identifiers remain redacted.

## Moodle session diagnostics

Version 1.2.3 resolves the sesskey from Moodle’s `core/config`, falls back to `window.M.cfg`, then page form/logout links. It reports the source and whether a key was found without exposing the key. Moodle’s `core/ajax` client is used when available. The fetch fallback sends the JSON Accept header from a normal Moodle AJAX call and distinguishes login redirects, browser challenges and other non-JSON replies.

For a temporary local test only, an ignored `moodle-local.json` can contain `{ "enabled": true, "sesskey": "your-current-session-key" }`. Build copies it into your local unpacked extension. It forces the fetch path and still uses Chrome’s own current cookies. Logs report whether the override matches the extracted page key. Delete this file and rebuild to return to automatic extraction. Do not share a packaged extension containing that local file. No Moodle session cookie is stored in the project.

Requests execute in the signed-in Moodle tab: inspect that tab’s DevTools → Network → `service.php`, rather than the extension page’s Network panel. A response titled “Just a moment…” is a browser/security challenge, not evidence that the sesskey is missing.
