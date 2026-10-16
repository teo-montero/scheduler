---
version: 1
slug: "dashboard-html"
primary_target: "dashboard.html"
related_targets: ["styles.css","src/dashboard.js"]
---

# Dashboard redesign

Mode: Operate. Scope: week, tasks, modules, task/event dialogs and preferences, including narrow screens.

## Direction contract

THESIS: A precise campus planning desk. The timetable is the working surface; promotional headings, decorative metrics and nested cards give way to content and action.

OWN-WORLD: Midnight ink navigation, cool near-white workspace, white calendar, restrained blue selection and primary action. One system sans family, readable compact text, 8px controls and 12px panel corners. Timetable, study and personal time have distinct soft fills and dark labels.

STORY: Choose week, tasks or modules; understand current workload; act on one deadline or adjust available time. Sample mode stays explicit. Preferences remain reachable at every size.

FIRST VIEWPORT: A 216px navigation rail, compact contextual heading with Add task primary, a low weekly summary strip, and a broad seven-day calendar beside a deadline list. At narrow widths the rail becomes labelled top navigation and the calendar becomes a seven-day selector plus a readable daily agenda. This agenda selection is the signature interaction; changes are immediate.

FORM: University course information system, candidate 7, seed 22ad8b5c. Grounded candidates considered: student diary, library index, seminar schedule, transit timetable, assessment ledger, departmental noticeboard, university course information system. User delegated visual decisions; code-led implementation follows the existing stack. No standing workflow preference is inferred.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

Preserve all existing functions and IDs. No API, scheduler or storage changes. Use local assets and system type. Motion only for occasional modal/toast feedback; keyboard and reduced-motion actions remain immediate. No new raster assets.

## Direction judgement

All catalog challengers declined on audience identification and product clarity: acetate manual (opaque control grammar), star atlas (unrelated exploration), bitmap specimen (legibility), record catalog (coded labels), character roster (decorative hierarchy), split-flap board (unnecessary movement). Kept disciplines: manual's clear division of sections, atlas's coordinate alignment, specimen's consistent scale, catalog's restraint, roster's recognisable entities and board's stable columns. These strengthen the selected working interface without importing decorative materials.

## Finish record

Independent review disposition: ship. The two review findings (cropped short-event text and redundant event-dialog headings) were corrected and verified in fresh captures. The selected seed was corroborated; no additional QUALITY BAR ceiling was certified.

Validation: 12 unit tests; expanded Chromium suite against root and dist, including simulated Moodle and timetable integrations; 24 captures across widths 320, 390, 820, 1280, 1440 and 1920; no page errors or horizontal overflow. Automated accessibility checks found no violations in eight states. No new shipping raster assets.