# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

UCL students organising coursework, classes and personal time. This audience is established by the existing README, interface and integrations; the redesign preserves it.

## Product Purpose

Study Space turns Moodle deadlines and a university timetable into a practical weekly study plan, with editable estimates and protected breaks.

## Operating Context

A Chrome Manifest V3 extension with a browser preview. Students review their week, add or complete tasks, inspect module progress, import a timetable, and adjust availability through local commands.

## Capabilities and Constraints

Calendar editing and onboarding remain UI-only previews. The user explicitly expanded scope for Study assistant: OpenAI generates validated event JSON, the frontend interprets lecture/study/user_time types and saves events locally. A local server holds the API key and performs the OpenAI request.

Calendar editing is a temporary UI preview: selection, drag, resize, collision spacing and event removal use a separate in-memory projection. Reset or reload restores the saved calendar. Never pass this projection to persistence or the scheduler.

- Preserve Moodle sync, calendar subscription and ICS import, task management, module filtering, scheduling preferences, personal time, and local commands.
- Preserve existing integrations and London timezone handling. Assistant events add an explicit type and description to the existing calendar model.
- Calendar storage remains local. Chat messages and minimal upcoming calendar context are sent to OpenAI only when using the assistant; disclose this in the chat UI. No analytics, remote scripts or remote fonts.
- Use the existing JavaScript modules, HTML, CSS, SVG icons and esbuild stack.
- Sample workspace data is illustrative and must remain clearly labelled.

## Brand Commitments

Preserve the Study Space name, existing mark and English product language. The user requests a substantial, sober, professional redesign: clear navigation, restrained colour, consistent components, balanced density and accessible responsive layouts. Avoid decorative cards, unnecessary gradients, oversized headings and gratuitous motion. Visual decisions are explicitly delegated to the agent in the user's brief.

## Product Principles

- Make the schedule and next actionable deadline easy to find.
- Keep study, timetable and personal commitments distinguishable.
- Preserve functionality while improving navigation and hierarchy.
- Show the current workspace mode and explain actionable errors.

## Accessibility & Inclusion

The user's brief requires keyboard focus, clear interactive states, basic accessibility and solid desktop, laptop, tablet and mobile behaviour. Target WCAG AA text contrast and reduced-motion support.

## Scraping integration

The upstream Moodle and UCL adapters and planner services are present. Existing Sync Moodle collects modules, full course snapshots and deadlines without invoking AI. Preserve the timetable, OpenAI chat and setup preview; upstream Gemini planning and the diagnostic panel are available but not activated by this merge.
