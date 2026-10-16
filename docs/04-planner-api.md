# UI-independent planner API

Both setup and dashboard bind to [src/planner/index.js](../src/planner/index.js). No core module imports a page, selector, component or stylesheet. The redesign’s layout and CSS are preserved. Fetching and planning can be tested independently by replacing their adapters.

| Layer | Files | Role |
| --- | --- | --- |
| Source connectors | `src/integrations/timetable.js`, `src/integrations/moodle.js` | Fetch UCL ICS or Moodle JSON independently. No scheduling, storage or DOM. |
| Extension transport | `src/integrations/client.js`, `src/background.js` | Typed message actions, host access and MAIN-world Moodle execution. Accepts setup and dashboard pages. |
| Persistence | `src/planner/storage.js` | Existing `chrome.storage.local.workspace` format and browser-preview storage, with migration defaults. No credentials. |
| Orchestration | `src/planner/service.js` | Sequence fetch/save/analyse/plan operations. Each course is saved before AI starts. |
| Events and constraints | `src/planner/planning.js` | Expand recurring personal commitments, generate travel, constrain location, validate AI slots and provide local fallback. |
| Chat changes | `src/planner/chat.js` | Apply only whitelisted changes to personal blocks or known tasks. |
| Gemini backend | `server/gemini.js`, `server/course-analysis.js`, `server/planning.js` | SDK transport, extraction and scheduling/chat prompts. Key remains on the server. |
| View bindings | `src/setup.js`, `src/dashboard.js` | Read existing form values, call service methods and render returned state/status. |

## Connect the UI

```js
import { createBrowserPlanner } from './planner/index.js';
const planner = createBrowserPlanner();
const unsubscribe = planner.subscribe(event => {
  // event.type === 'progress': stage, course, index, total
  // event.type === 'saved': workspace
});

await planner.connectTimetable(subscriptionUrl); // Independent of Moodle/AI.
await planner.openMoodle();                     // Sign in in the Moodle tab.
const { workspace } = await planner.loadCourses();
await planner.selectCourses([111, 222]);        // IDs from workspace.courses.
const fetched = await planner.fetchSelectedCourses(); // No AI.
// fetched.workspace.courseContent[id].state contains sections/activities.
// fetched.errors contains {courseId, message} per failed course.
```

The setup’s **Check selected course data** performs exactly this fetch-only path. A successful check displays section/activity counts and three example titles. Zero selected courses fetches nothing. Connection failures keep previous data, and one failed module does not discard successful ones. No sesskey or cookie leaves the injected Moodle reader.

```js
await planner.savePersonal({
  personal: { commuteMinutes: 30, studyLocation: 'home' },
  weeklyActivities: [{ id: 'football', title: 'Football training',
    days: [1, 3], startTime: '18:00', endTime: '19:00' }]
});
await planner.analyseSelectedCourses();          // Gemini, cached by content.
const plan = await planner.createPlan();         // Gemini proposes slots.
const chat = await planner.chat('This afternoon must be free; I’m meeting friends');
```

`days` uses Sunday=0 through Saturday=6. Times are London wall-clock times, including BST/GMT changes. Activities may cross midnight. Blank optional commute/location answers become zero commute and `either`; no distance or journey duration is guessed.

Other operations are `getWorkspace()`, `saveWorkspace(state)`, `importTimetable(icsText)`, `refreshDeadlines()` and `analyseSelectedCourses({ force: true })`. A method persists before returning success; a failed storage write is surfaced. Service operations queue within one instance. Views should use one service per page and listen for storage changes when another extension page edits the workspace. Returned workspace objects are snapshots; save explicit edits before starting another operation.

## Planning contract

Source classes remain in `workspace.events`. One-off personal time is in `blocked`; recurring definitions are in `weeklyActivities`. Generated recurring instances and travel live in `personalEvents`. Study sessions live in `blocks`, each linked to its task/source. The rendered calendar combines these four collections.

Priority is lecture (3), fixed personal routine (2), study (1). Existing fixed conflicts are retained and reported in `planning.conflicts`; the model cannot silently change either source record. The interface flags these clashes for review.

A home preference reserves travel before the first campus class and after the last, and schedules home study outside that campus span. A campus preference allows a daytime campus study window and reserves one journey each way. `either` uses campus on class days and home otherwise. Online/remote-labelled and all-day events reserve time without automatically creating a campus journey. Unknown weekly activity locations receive no invented travel time. Travel outside 06:00–23:00 is flagged for review when fixed class times force it. This is a conservative daily campus/home model; it does not optimise multiple trips between classes or calculate routes.

Gemini receives tasks, fixed events, study windows, busy intervals and an initial local candidate. Its response can contain only study slots `{taskId,start,end,location}` and a note. Validation rejects unknown IDs, overlaps, wrong locations, passed deadlines, future teaching violations, excess workload, excessive daily study and missing breaks. Unallocated minutes are calculated locally, rather than trusting a model’s claim that all work fits.

A valid proposal sets `planning.engine` to `ai`, with provider/model/token usage. Ordinary checkbox/estimate edits use immediate local planning. Failed AI scheduling produces `local-fallback` and an explicit warning. Extraction failures keep the previous tasks and save course metadata for retry. Ambiguous chat returns a clarification without changing the plan. Unsupported or fabricated chat actions are rejected atomically.

## Gemini setup and verification

Use Node.js 20.12+ and `npm install`. Put the Google AI Studio key in the ignored `.env` file as `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`.

Run `npm run ai:check` for a small live key/model/structured-output check, then `npm run ai` to serve the extension at `http://127.0.0.1:8787`. The backend uses `GoogleGenAI` from `@google/genai` and `client.interactions.create`, matching the [Google Interactions guide](https://ai.google.dev/gemini-api/docs/interactions). It requests JSON with a schema and `store: false`; no interaction ID is persisted for server-side chat history. The app still sends the selected metadata to Google for inference. [Structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output) describes the response format.

Local endpoints are `GET /health`, `POST /analyse`, `POST /plan`, `POST /chat`. Health reports configuration only; it does not prove a key works. The separate check script performs that live request. Browser tests and provider tests use synthetic data and mocked API replies; they do not sign in to the student’s real Moodle account. The backend is loopback-only with extension-origin checks and is not ready to expose as a public hosted API.
