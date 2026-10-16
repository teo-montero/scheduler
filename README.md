# Study Space · UCL Planner

A Manifest V3 Chrome extension with a full-page study planner. It combines Moodle action deadlines with a UCL iCalendar timetable and schedules focus sessions around classes and personal time. No backend, account, API key or AI service is needed.

## Implementation guides

- [Calendar connection](docs/01-calendar-connection.md): URL handling, downloading ICS, recurrence, timezones and import feedback.
- [Moodle connection](docs/02-moodle-connection.md): session authentication, MAIN-world execution, AJAX calls and task mapping.
- [UI design and data assignment](docs/03-ui-and-data-assignment.md): visual structure, state models, calendar rendering and scheduling, with a worked example.

## Run it

1. In this folder, run `npm install` and `npm run build`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this project folder (`scheduler-extension`). You can also select `dist` for a clean package.
4. Click the extension’s toolbar icon. The planner opens in a normal browser tab.
5. Start with the labelled sample workspace, or connect your data.

After code changes, run `npm run build`, click **Reload** on the extension card, then refresh its dashboard tab. Both the project root and `dist` contain the manifest and runtime files after building. Selecting `src`, a parent directory, or a zip file will not work.

For a browser preview: `npm run build && npm run dev`, then open http://127.0.0.1:4173. The preview supports sample data, manual tasks, ICS file imports, and scheduling. Live Moodle/timetable URL sync requires the loaded extension.

## Connect your data

**Moodle:** Open https://moodle.ucl.ac.uk/my/ in another tab and sign in. In the planner, click **Sync Moodle**. The extension reads the current `window.M.cfg.sesskey` in that tab’s MAIN world and calls Moodle’s same-origin AJAX API. It pages through enrolled courses and calendar action events. If deadlines fail but courses succeed, it keeps previous deadlines and displays a warning.

**Calendar editing preview:** Click once to select an event. Drag its body to move it or its top/bottom edge to resize it in 30-minute steps; nearby events move to avoid overlaps. Earlier/Later and −30m/+30m controls work on mobile too. The upper-left cross removes only that event from the preview. Double-click or choose Details for information. With a selected event focused, use arrow keys to move, Shift + arrow keys to change duration, Enter for details, Delete to remove, and Escape to finish. All-day entries support details and preview removal. Reset preview or reload restores the saved calendar; these edits never change tasks, integrations or saved schedules.

**Timetable:** Open **Preferences** or **Manage connections**. Paste your UCL timetable iCalendar subscription URL and click **Sync timetable**. The legacy `https://timetable.apps.ucl.ac.uk/icalendar/…` subscription is resolved directly to UCL’s `https://timetable.mesh.ucl.ac.uk/online-timetable-api-proxy/v0.1/icalendar?key_identifier=…` API, avoiding its HTTP 307 redirect. You can paste either URL. Only these UCL timetable hosts and recognised paths are allowed. The button shows download progress, then a preview of your next classes and **View my calendar**. If Chrome has withheld timetable site access, it requests the necessary UCL host permissions. Saving preferences with a new subscription URL also downloads it immediately. Alternatively, import an `.ics` file. Timetable imports expand recurring events for the next 120 days, with a one-week lookback. Refresh the feed periodically using **Sync timetable**.

The first successful real integration replaces the sample workspace. Real feeds are never mixed with sample classes or assignments. Importing a timetable does not automatically sync Moodle; connect both feeds. Syncing and file importing save immediately. The preferences form’s Cancel button dismisses unsaved study-hour/URL edits. Failed downloads retain the previous calendar and display an error beside the subscription controls.

## Use the planner

- Add personal tasks, deadlines and work estimates. Estimates are starting points: Moodle assignments default to 120 minutes and quizzes to 60.
- Click a calendar session for its details, or a task title to edit it. Moodle titles/deadlines are refreshed from Moodle; estimates and local completion survive syncs.
- Mark a task complete when all its work is finished. Completion affects this planner only; it does not submit work or change Moodle.
- **Regenerate plan** uses the current time and plans up to 28 days ahead, prioritising the earliest deadlines. It respects study hours, weekends, timetable events, personal time, and breaks.
- Work that cannot fit is reported in **All tasks**. The planner never silently schedules it beyond its deadline.
- Existing saved plans stay in place when reopening the dashboard. Regenerate to update them for the current time.
- Initial sample plans illustrate a complete week, including earlier days; any edits/regeneration use the actual current time.

## Study assistant (OpenAI)

Requires Node.js 22+ and a local server for both the preview and extension. No API key is sent to the browser or bundled into the extension.

1. Put your OpenAI API key in the existing ignored `.env.local`: `OPENAI_API_KEY=your-key`. On a fresh clone, copy `.env.example` to `.env.local` first.
2. Run `npm run build`, then `npm run dev`. Restart the server after changing the key. The default model is `gpt-4.1-mini`; `OPENAI_MODEL` can override it with a model supporting strict Structured Outputs.
3. Open the preview at http://127.0.0.1:4173 or reload the unpacked extension and its dashboard. The extension must have localhost site access and the local server must stay running.
4. Open Study assistant and ask, for example: “Add an algorithms lecture tomorrow 10:00–11:00 in Roberts G06”, “Schedule revision tomorrow from 14:00 to 15:00”, or “Añade gimnasio mañana de 18:00 a 19:00”.

OpenAI receives the last 12 chat messages, the viewed week, today's London date/time and up to 500 upcoming fixed commitments (title/start/end). It does not receive the Moodle session, calendar subscription URL, API key in the prompt, or credentials file. Responses use `store: false`. This does not override OpenAI's API data retention policies.

The server calls the Responses API with a strict JSON schema. Missing information triggers a clarification; finite weekly requests expand into at most 24 events after specifying an end date/count. Each event has `type` (`lecture`, `study`, `user_time`), `title`, `description`, `date`, `startTime`, `endDate`, `endTime`, and `location`. Dates and times are London wall times. The frontend validates the entire response again, converts to ISO timestamps, assigns local IDs and colours by type:

```json
{
  "id": "assistant-generated-uuid",
  "type": "study",
  "title": "Algorithms revision",
  "description": "Review sorting exercises",
  "start": "2026-11-02T14:00:00.000Z",
  "end": "2026-11-02T15:00:00.000Z",
  "timeZone": "Europe/London",
  "location": "Library",
  "source": "assistant"
}
```

Lecture uses the timetable colour, study uses the study colour, and user_time uses the personal-time colour. All three retain their details on reload. Assistant-created events are fixed commitments in the existing `workspace.blocked` collection; they survive timetable sync and automatically reserve time from the task scheduler. They are not exported to UCL, Moodle or an external calendar. New events jump into view. Conflicts reject the whole batch, duplicates are skipped, and malformed JSON/API failures never add events. Times in the missing/repeated daylight-saving hour are rejected rather than guessed. Use Preferences or the event's Details → Remove event to remove a saved assistant event; the timetable cross/drag/resize still affect only the temporary UI preview.

The established “Finished maths problem sheet” and “Move maths problem sheet to Friday” shortcuts still run locally. Natural-language event creation uses OpenAI. If the key/server is missing the chat displays an actionable error. No live API call is needed to run tests: automated coverage uses synthetic Responses API replies and checks all three event types, persistence, clarifications, conflicts and failures.

## Data and scope

- Uses `chrome.storage.local` restricted to trusted extension contexts. No analytics, remote scripts or remote fonts. Assistant requests send the limited context described above to OpenAI.
- Never reads or saves session cookies. The session key stays inside the Moodle page’s sync function and is not returned or persisted.
- The private calendar URL is saved locally in the extension only. Never paste it into source files or commit it. Clearing saved data removes it.
- The previous starter files contained a hardcoded session key and private calendar URL; both were removed.
- All planner times use **Europe/London**, including BST/GMT transitions, independently of the device timezone.
- Calendar parsing uses bundled `ical.js`: timezone definitions, TZID dates, UTC, all-day events, recurrence, exclusions, overrides and cancellations are supported. Floating dates use London time; timezone IDs without embedded definitions use the browser’s timezone database.
- Moodle sync reads actionable calendar events, not every course activity, document or assessment. Site-specific UCL availability of these internal APIs still requires validation against your authenticated account.
- To discover further course/resource APIs, inspect DevTools Network on your signed-in course page, filter for `lib/ajax/service.php`, and inspect method names/arguments. Do not share request URLs containing session keys. No endpoint discovery or access to a real student account was performed by this implementation.

## Checks

`npm run check` validates syntax, runs scheduling/calendar/command/Moodle tests, and rebuilds the extension.

`npm run test:browser` tests both unpacked folders in isolated Chromium profiles, covers dashboard interactions, calendar previews, network failure recovery, importing on Save, and exercises the full MAIN-world Moodle sync with simulated responses. Install the test browser once with `npx playwright install chromium`. It never uses your real Chrome profile or Moodle account.

Source is in `src/`; `dashboard.html` and `styles.css` define the UI; `scripts/build.mjs` bundles all dependencies locally into root runtime files and copies a clean distribution to `dist/`.

API references: [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [Moodle calendar external API](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/calendar/externallib.php), [ical.js](https://github.com/kewisch/ical.js).
