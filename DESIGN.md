---
name: "Study Space"
description: "A precise campus planning desk for coursework, classes and personal time."
colors:
  bg: "#f5f6fa"
  paper: "#fff"
  ink: "#202a3d"
  muted: "#626d80"
  line: "#dfe3ec"
  line-soft: "#edf0f5"
  accent: "#3658cf"
  accent-hover: "#2846ae"
  accent-soft: "#edf1ff"
  sidebar-bg: "#182338"
  sidebar-ink: "#d2d9e7"
  sidebar-muted: "#a5b1c7"
  success: "#28634e"
  warning: "#875015"
  danger: "#ae3838"
  lecture-bg: "#eaf2ec"
  lecture-ink: "#315c42"
  study-bg: "#edf0fe"
  study-ink: "#384fa2"
  personal-bg: "#fcf0df"
  personal-ink: "#805218"
  focus-ring: "#5479ef"
  nav-active: "#304369"
  nav-hover: "#2a3852"
  secondary-ink: "#3d4960"
  secondary-border: "#cfd5e1"
  field-border: "#bfc9da"
  due-bg: "#e9edf4"
  due-ink: "#515f76"
  urgent-bg: "#f9ecd9"
  urgent-ink: "#875019"
  overdue-bg: "#fbe9e8"
  overdue-ink: "#a33633"
typography:
  headline:
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
  title:
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-.015em"
  body:
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  metadata:
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  metadata: "4px"
  event: "5px"
  compact: "6px"
  agenda: "7px"
  control: "8px"
  message: "10px"
  panel: "12px"
  dialog: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.secondary-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-small:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.secondary-ink}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
  nav-item:
    textColor: "{colors.sidebar-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  nav-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.paper}"
  due-label:
    backgroundColor: "{colors.due-bg}"
    textColor: "{colors.due-ink}"
    rounded: "{rounded.metadata}"
    padding: "3px 7px"
  due-label-urgent:
    backgroundColor: "{colors.urgent-bg}"
    textColor: "{colors.urgent-ink}"
  due-label-overdue:
    backgroundColor: "{colors.overdue-bg}"
    textColor: "{colors.overdue-ink}"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  task-row:
    textColor: "{colors.ink}"
    padding: "19px 0"
  calendar-event:
    backgroundColor: "{colors.lecture-bg}"
    textColor: "{colors.lecture-ink}"
    rounded: "{rounded.event}"
    padding: "4px 6px"
  calendar-event-study:
    backgroundColor: "{colors.study-bg}"
    textColor: "{colors.study-ink}"
  calendar-event-personal:
    backgroundColor: "{colors.personal-bg}"
    textColor: "{colors.personal-ink}"
  agenda-day:
    textColor: "#5a6780"
    rounded: "{rounded.agenda}"
    padding: "5px 2px"
  agenda-day-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
  agenda-event:
    backgroundColor: "{colors.lecture-bg}"
    textColor: "{colors.lecture-ink}"
    rounded: "{rounded.agenda}"
    padding: "12px"
---

# Design System: Study Space

## Overview

**Creative North Star: "A precise campus planning desk"**

Study Space is a precise campus planning desk: a restrained, information-led workspace for the week, tasks and modules. Midnight ink anchors navigation, a cool near-white canvas separates the working areas, and white surfaces carry the content. Blue identifies primary actions and selection; schedule categories retain their own muted fills.

The interface uses the installed system sans family, compact headings and aligned rows. Borders and spacing establish hierarchy before shadows. The existing Study Space mark remains local, as do the inline SVG icons; no remote font or decorative image is required.

**Key Characteristics:**

- Clear separation between navigation and work surfaces.
- Compact, sentence-case headings with tabular time and count values.
- Soft category fills with readable dark event labels.
- A daily agenda replaces the seven-column calendar on phones.
- Visible focus, labelled controls and immediate reduced-motion feedback.

This records the implemented dashboard in `styles.css`, `dashboard.html` and `src/dashboard.js`. Frontmatter primitives are extracted from that implementation; names for reused literal values describe their current roles. It does not introduce a new visual language. Product constraints remain in `PRODUCT.md` and the dashboard composition brief remains in `.impeccable/surfaces/dashboard-html.md`.

## Colors

A cool neutral foundation supports restrained blue actions and muted schedule categories. The frontmatter contains the exact values; CSS custom properties remain the implementation source.

### Primary

- **Action blue** (`accent`): primary buttons, selected day, checkbox completion, action links and focused-work controls. `accent-hover` is its stronger hover state; `accent-soft` supports filters and subtle interaction feedback.
- **Study blue** (`study-bg`, `study-ink`): the paired fill and text for planned study sessions.

### Secondary

- **Timetable green** (`lecture-bg`, `lecture-ink`): university timetable sessions.
- **Personal amber** (`personal-bg`, `personal-ink`): blocked personal time.
- **Status colours** (`success`, `warning`, `danger`): successful imports, planning warnings and destructive/error text. Deadline badges use their own extracted neutral, urgent and overdue pairs.

### Neutral

- **Workspace paper** (`bg`, `paper`): cool outer canvas and white content surfaces.
- **Content ink** (`ink`, `muted`): primary information and supporting copy.
- **Dividers** (`line`, `line-soft`): panel boundaries and quieter internal/calendar lines.
- **Navigation ink** (`sidebar-bg`, `sidebar-ink`, `sidebar-muted`): the dark shell and its readable text levels. Selected navigation uses `nav-active`.
- **Focus blue** (`focus-ring`): keyboard focus outlines. Field and secondary-control borders remain separate from panel dividers.

**The Semantic Colour Rule.** Use the existing timetable, study and personal colour pairs consistently in both calendar and agenda representations. Keep text and accessible labels alongside colour.

Module markers additionally use the six existing data-driven colours in `src/dashboard.js`. They identify modules in small square markers; they do not replace schedule category fills.

## Typography

**Interface font:** the local system sans stack in `typography.body`. There is no imported display or body font. The Moodle integration mark retains its existing serif treatment as an integration identifier, not a second interface typeface.

The hierarchy is compact and functional. The frontmatter records desktop base roles, with component-specific sizes retained in the sidecar examples.

- **Headline:** the page title; reduced to 25px at the 760px breakpoint.
- **Title:** section headings. Dialog headers use 22px, and the event-detail title uses 23px.
- **Body:** the base document text. Task titles and controls commonly use 13px; wide task-list titles use 14px.
- **Label:** semibold action text. Form labels use 12px at weight 500; small utility buttons use 12px at weight 500.
- **Metadata:** timestamps, module attribution, badges and calendar labels. Longer helper copy uses 12px with a 1.7 line height.

Time labels, dates, estimates, navigation counts and summary numbers use tabular numerals where implemented. On phones, command and dialog inputs use 16px text. Headings remain sentence case; there is no oversized promotional display tier.

**The Content Hierarchy Rule.** Use the existing compact heading scale; let spacing, weight and alignment distinguish the working sections.

## Layout

The desktop shell has a fixed navigation rail (216px) and a main workspace offset by the same width. The top bar is 64px high. Content is centred within a maximum width of 1800px with 32px horizontal padding. A compact summary precedes the calendar; the calendar and deadline column form a flexible main column plus a 272px sidebar, with a 24px gap.

Reused spacing steps are recorded in frontmatter. They are an extracted vocabulary, not a claim that every existing one-off measurement belongs to a rigid scale. Panels commonly use 24px padding; controls use more compact horizontal and vertical spacing.

| Viewport condition | Implemented response |
| --- | --- |
| At least 1700px | Rail grows to 236px; outer horizontal padding becomes 40px; deadline column becomes 300px with a 32px gap. |
| At most 1300px | Calendar takes the full working width; deadlines and the personal-time note move below it. Outer padding becomes 24px. |
| At most 1050px | Rail becomes sticky top navigation with three labelled destinations and reachable preferences; the main offset becomes zero. |
| At most 760px | Heading, summaries and task rows tighten; lower supporting content becomes a single column. |
| At most 640px | Outer padding becomes 16px. Header actions occupy a row below the title. A seven-day selector and daily agenda replace the desktop calendar; forms and module summaries become single-column. |
| At most 360px | Calendar toolbar wraps to retain usable controls. |

The desktop calendar has a 50px time axis, seven equal day columns and a minimum inner width of 660px. Day headers stay visible within its scroll area. Rendered time scales at 72px per hour; the displayed span expands to include the configured study hours. Simultaneous events use adjacent lanes. On phones, selected-day buttons are at least 58px tall, and agenda event rows are at least 78px tall. Heading actions and primary navigation gain 44px touch heights.

## Elevation & Depth

White panels, quiet borders and the dark navigation surface establish depth. Ordinary calendars, task/module surfaces and command panels carry no shadow. Dialogs and transient feedback use the two existing soft shadows.

- **Dialog overlay:** `--shadow-overlay` carries `0 20px 64px #17213933`. A dim backdrop separates the modal from the page.
- **Toast:** `0 8px 28px #18233829` lifts feedback above the working surface.

**The Overlay Depth Rule.** Keep ordinary panels flat and bordered. Reserve the existing shadows for dialogs and toasts.

Dialog entrances and toasts use opacity and a small transform over 180ms with the existing ease-out curve. Pointer button presses scale to .97 over 120ms. Keyboard input removes modal/toast transitions and pointer press motion is not applied to keyboard actions. Reduced-motion preferences disable transitions and animations, including the sync spinner. Navigation and agenda changes render immediately.

## Shapes

Controls and larger work panels use the distinct control and panel corner tokens. Compact badges and event tiles use smaller corners; dialogs use the largest regular corner token, reducing to the panel radius on phones. List and module sections use separators rather than independent rounded shells. Circular silhouettes are limited to identity/status markers already present.

Borders are generally one pixel. Calendar category tiles use paired category borders as well as fill and text. The current-time rule is a one-pixel line with a small circular marker. The hour grid uses a repeating linear gradient strictly as a grid-line construction, not as a decorative surface treatment.

## Components

### Buttons

Primary actions use the action-blue fill with white text; secondary and small utility actions use white fill and a quiet border. Base buttons have a 40px minimum height and the frontmatter padding; utility buttons reduce to 34px. Icon buttons use a 36px square footprint. Text actions remain unboxed and use action blue; destructive text actions use danger.

Hover styles are restricted to fine pointers with hover capability. Primary controls darken; secondary controls gain a pale fill; text actions underline. Disabled controls use explicit muted text and fill with a not-allowed cursor. Global visible focus is a 3px outline with a 3px offset. Buttons retain the keyboard and reduced-motion behavior described above.

### Navigation

Labelled icon-and-text destinations use the dark shell, with a filled active state and optional compact count badge. The selected destination carries `aria-current="page"`. On tablets and phones, the same destinations form a top row. Preferences remains accessible by a labelled icon button when its visible word label is hidden.

### Fields

Fields are white, bordered and at least 42px tall on desktop. Labels and help copy are separate, readable elements. The command field groups its input and send button inside a shared border and receives a 2px focus-within outline; ordinary fields retain global visible focus. Dialog fields use 46px minimum height and 16px text on phones. Error copy is explicit text using danger, and disabled imported task fields retain a visible muted treatment.

### Deadline badges and status

Deadline badges are small rounded rectangles with neutral, urgent or overdue colour pairs and readable text. Workspace state has its own small badge and, for sample data, an explanatory banner. These are contextual signals rather than decorative pills.

### Panels and lists

The calendar, alternate task/module view and command area use flat bordered surfaces. Task rows separate completion, module attribution, the editable title, deadline and estimate. Completed tasks combine a checked control with a struck-through title. Module summaries use divided rows with a thin progress track and a text action. Empty states provide a concise title, explanation and relevant action.

### Calendar and mobile agenda

Calendar event buttons use the category pairs, compact corners, time and a clamped title. Short tiles prioritise the title; complete time and title remain available in the accessible label and event dialog. Location appears only where the tile has enough height. Focus moves above nearby events with an inset outline.

On phones, the seven-day selector uses `aria-pressed` for selection and `aria-current="date"` for today. Agenda rows show time, title, category and available location/module details, then open the same event dialog. Event details lead with the event title and follow with source and timing metadata. Native dialogs retain labelled headings, close controls and footer actions.

The sidecar contains ten self-contained examples extracted from these components. Its token references have source-value fallbacks for standalone preview. Example content and event geometry are illustrative; the snippets are visual specimens, not an alternate behavior implementation. Tonal ramps are preview-only derived colour metadata, not additional production palette tokens.

## Do's and Don'ts

### Do:

- Do reuse the existing colour pairs, control radii and system font stack.
- Do keep the week, tasks and modules navigation labelled at every viewport size.
- Do retain the visible sample-workspace state and actionable empty-state buttons.
- Do preserve visible keyboard focus and the reduced-motion overrides.
- Do keep event titles and complete details accessible when the calendar uses a compact event treatment.

### Don't:

- Don't add remote fonts, remote imagery or decorative gradients to this local workspace.
- Don't turn list rows or module summaries into stacks of elevated cards.
- Don't rely on colour alone to explain event categories, selection or status.
- Don't shrink the desktop calendar into seven unreadable phone columns.
- Don't animate navigation changes or bypass the keyboard and reduced-motion behavior.
