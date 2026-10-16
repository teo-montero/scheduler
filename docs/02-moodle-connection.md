# 2. Moodle connection

Study Space 1.2.0 follows this flow: load enrolled modules, let the student select them, fetch one course index per selected module, save it locally, analyse it with Gemini, and schedule the resulting work. An optional calendar request adds Moodle deadline information.

## Source map

| File | Responsibility |
| --- | --- |
| [src/moodle.js](../src/moodle.js) | Same-origin AJAX requests inside the signed-in Moodle tab. |
| [src/background.js](../src/background.js) | Find Moodle tabs, validate selected courses and inject the reader. |
| [src/course-content.js](../src/course-content.js) | Normalise course indexes, validate AI output, create and reconcile tasks. |
| [src/modules.js](../src/modules.js) | Apply saved module choices and task planning flags. |
| [src/dashboard.js](../src/dashboard.js) | Checklist, pipeline progress, saves, retries and scheduling. |
| [src/analysis-client.js](../src/analysis-client.js) | Dashboard requests to the local analysis backend. |
| [server/index.js](../server/index.js) | Loopback HTTP server and request guards. |
| [server/course-analysis.js](../server/course-analysis.js) | Gemini prompt, structured output schema and provider request. |

## Authentication uses the current browser session

The service worker finds tabs matching `https://moodle.ucl.ac.uk/*` and uses `chrome.scripting.executeScript` with `world: 'MAIN'` to run `readMoodleInPage(options)` inside one. It tries active tabs first, continuing to another matching tab if necessary.

The injected reader gets the current `window.M.cfg.sesskey` and makes same-origin POST requests to:

```text
/lib/ajax/service.php?sesskey=<CURRENT_KEY>&info=<METHOD_NAME>
```

Each request contains the Moodle batch envelope:

```json
[{ "index": 0, "methodname": "core_courseformat_get_state", "args": { "courseid": 123 } }]
```

The browser supplies its existing session cookies through `credentials: 'include'`. The extension does not manually read cookies. The session key stays within the injected function; it is neither returned nor persisted. No copied curl headers, cookies or session key are embedded in the application. The helper checks HTTP, JSON and Moodle API errors and uses a 20-second timeout.

Injection uses a self-contained function because Chrome serialises it without its surrounding module scope. A missing tab or usable session produces a sign-in/refresh message. Requests are read operations and do not change enrolment, submissions or Moodle completion.

## 1. Load modules and show the checklist

**Sync Moodle** calls `core_course_get_enrolled_courses_by_timeline_classification` with `classification: 'all'`, `sort: 'fullname'`, an offset and a page size of 50. It requests the identity/display fields used by the dashboard. Pagination stops on a short page or `nextoffset === -1`, with a 1,000-course limit and warning.

Only `{ id, name, shortname }` is retained for each course. Dashboard sync opens **My modules**. Setup uses **Load modules**, then **Check selected course data**. Loading the checklist does not fetch course indexes, calendar actions or call AI.

Each **Include in my plan** checkbox updates `excludedCourseIds` in the workspace. Existing and newly discovered courses start included. Exclusions survive later syncs, and changing a selection in either page uses the same mechanism. Excluded course tasks remain saved and can be inspected from that course’s own task view.

Module exclusions affect task views, summaries, command matching and generated study work. Timetable appointments always reserve time. Independent personal tasks remain eligible.

## 2. Fetch and save selected course indexes

**Fetch & analyse selected** sends `FETCH_COURSE_STATE` for each selected course. The worker checks that the ID belongs to an enrolled, included module, then calls `core_courseformat_get_state` once for that course. Courses are processed sequentially. As with other Moodle reads, a failed tab may be retried using another signed-in tab.

The supplied export format has an outer Moodle result array whose `data` may itself be a JSON string. The parser accepts this and the corresponding object form, then reads `course`, `section` and `cm`.

Normalisation retains:

| Record | Fields used |
| --- | --- |
| Course | ID, display name and short name. |
| Section | ID, title, number and recognised teaching-week dates. |
| Activity | ID, name, plugin type, section ID, safe Moodle URL, description and completion status. |

Hidden activities/sections are filtered. Duplicate activity IDs are removed. Resource links must use HTTPS on `moodle.ucl.ac.uk`; session-related query parameters are stripped. A label without its own URL can link to its course anchor. Scripts/markup are removed from text labels and descriptions.

Completion is explicitly `complete`, `incomplete` or `unknown`; absent tracking is not proof that the student finished the work. A section such as `Week 3: 19 - 23 Oct. 2026` can establish when teaching starts, but never becomes a fabricated assessment deadline.

Each index is saved immediately under `workspace.courseContent[courseId]`, with `fetchedAt` and a SHA-256 fingerprint. Analysis starts after fetching, so content remains available if Gemini is unavailable. Failed course requests preserve previous data and do not discard successful fetches from other courses.

The fingerprint excludes completion status. If content is unchanged, the normal fetch/analyse action reuses saved Gemini suggestions while refreshing completion from Moodle. The shared service also supports `analyseSelectedCourses({ force: true })` to request fresh analysis without another Moodle fetch.

## 3. Analyse with Gemini through a local backend

Configure `.env` from [.env.example](../.env.example), set `GEMINI_API_KEY`, then run `npm run ai`. The default `GEMINI_MODEL` is `gemini-3.5-flash-lite`. The Node server listens on `127.0.0.1:8787`; there is no database and no server-side course persistence. Keep this process running during analysis.

The dashboard requests `/health` and POSTs the saved index to `/analyse`. Keeping the long provider request in the dashboard avoids relying on a service worker staying active for the whole analysis. The extension has host access to this loopback address.

The backend validates and normalises the input again, strips activity URLs from the upstream payload, and sends selected course titles, section labels, activity types and descriptions to Google’s Interactions API through `@google/genai`. It keeps the API key in the server environment. No key goes into the extension bundle or Chrome storage; `.env` is ignored by Git and excluded from `dist`.

The local API checks loopback hostnames, permits extension origins, requires a JSON POST with `X-Study-Space: extension`, caps request bodies at 2 MB, and accepts one analysis at a time. Its health response indicates whether a key is configured without disclosing it. These checks block ordinary webpage requests; it is a local development service, not an authenticated public deployment.

The prompt treats course text as untrusted data and asks for lecture notes, exercises, notebooks and assessed work, while excluding administrative headings and marking supporting material optional. It explicitly states that linked files have not been read. A whole coursework submission with unknown scope must receive a null estimate rather than an invented short upload task.

Gemini returns structured JSON with one record per selected activity:

```json
{
  "tasks": [{
    "activityId": "456",
    "title": "Work through Problem Sheet 1",
    "category": "exercise",
    "estimatedMinutes": 120,
    "optional": false,
    "confidence": "low",
    "reason": "Starting estimate based on the resource title; sheet length is unknown."
  }]
}
```

Both backend and dashboard validate the result. Every activity ID must exist in the saved course, IDs must be unique, categories must be allowed, and an estimate must be null or an integer from 15 to 6,000 minutes. Invalid or truncated results are rejected as a whole; partial tasks are not imported.

Original links, course identities, completion and teaching dates come from saved Moodle records. Gemini cannot supply replacement URLs or dates. Stable task IDs use `moodle-activity-<courseId>-<activityId>`. Each saved analysis includes suggestions, generated tasks, fingerprint, model, prompt version, timestamp and token usage.

## 4. Add deadlines and reconcile tasks

The optional **Refresh Moodle deadlines** action calls `core_calendar_get_action_events_by_timesort`, requesting pages of 50 records with `aftereventid`. Seen IDs prevent duplicate pagination results; the reader stops at a short/repeated page or 20 pages.

Calendar actions initially map to `moodle-<eventId>` tasks. Course IDs join records to modules. Labels become plain text; positive `timestart` or `timesort` timestamps become ISO dates. Non-actionable events are excluded. Calendar-only estimates default to 60 minutes for quizzes and 120 for other actions. These timestamps describe the returned action; they are not independently verified against assessment settings.

Reconciliation matches calendar actions to course-index tasks using course/activity IDs, including IDs extracted from `/mod/<plugin>/view.php?id=...` links. It attaches deadline information to the existing activity task instead of creating a second copy of the work. Where multiple actions match, due/close events are preferred, then earlier dates.

Local estimate edits, inclusion choices and completion overrides survive imports, including migration from legacy calendar-event task IDs. Completed records that disappear remain as history. Personal tasks remain untouched. Optional work starts outside the plan, and work needing an estimate stays unscheduled until the student supplies one. Gemini can propose study slots through the separate planning endpoint. A local validator enforces fixed commitments, travel, study windows, deadlines, workloads and breaks. Local edits replan immediately on-device; a failed AI plan uses a local fallback and reports that fact.

## Persistence, failures and verification

The entire workspace is stored in `chrome.storage.local`, restricted to trusted extension contexts. It includes normalised course indexes, saved analyses, task edits and plans. Clearing saved data removes them. The backend does not maintain a second copy. Large multi-course indexes can eventually reach Chrome’s local-storage quota; this hackathon version does not add a database or automatic eviction.

Each successful course analysis is persisted independently. Failed fetches/analyses retain previous tasks and show an error. Missing backend configuration leaves fetched content saved for later analysis. Worker/dashboard build IDs detect stale loaded extension code; after rebuilding, reload the extension and refresh its dashboard tab.

[tests/course-content.test.js](../tests/course-content.test.js) covers the supplied response shape, source validation, estimates, completion, fingerprint reuse and deduplication. [tests/gemini.test.js](../tests/gemini.test.js) verifies provider requests and local HTTP guards using synthetic responses. [tests/browser.mjs](../tests/browser.mjs) exercises the full checklist → fetch → save → analyse → calendar flow in isolated Chromium, including missing configuration and completion-only updates. The supplied course exports were also passed through normalisation locally, without adding private payloads to the repository. Live Moodle authentication and a paid Gemini call still require the student’s own configured account.

API reference: [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).
