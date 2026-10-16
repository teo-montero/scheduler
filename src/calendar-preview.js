import { addDays, atTime, dateKey, formatTime } from './dates.js';

const STEP = 30 * 60000;
// UI simulation only. This module never mutates workspace data or writes storage.
export function adjustPreviewDay(events, id, action, steps) {
  const target = events.find(event => event.id === id);
  if (!target || target.allDay) return null;
  const day = dateKey(target.start), low = +atTime(day), high = +atTime(addDays(day, 1));
  const rows = events.filter(event => !event.allDay && dateKey(event.start) === day)
    .map(event => ({ ...event, start: +new Date(event.start), end: +new Date(event.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const index = rows.findIndex(event => event.id === id), row = rows[index];
  const original = rows.map(event => ({ ...event })), delta = steps * STEP;
  if (action === 'move' || action === 'start') row.start += delta;
  if (action === 'move' || action === 'end') row.end += delta;
  if (row.end <= row.start) return null;
  // Pull a nearby following run closer when a session becomes shorter.
  if (action === 'end' && delta < 0) {
    for (let i = index + 1; i < rows.length; i++) {
      if (original[i].start - original[i - 1].end > STEP) break;
      rows[i].start += delta; rows[i].end += delta;
    }
  }
  if (action === 'start' && delta > 0) {
    for (let i = index - 1; i >= 0; i--) {
      if (original[i + 1].start - original[i].end > STEP) break;
      rows[i].start += delta; rows[i].end += delta;
    }
  }
  // Preserve order and duration; ripple collisions away from the edited event.
  for (let i = index - 1; i >= 0; i--) {
    const overlap = Math.max(0, rows[i].end - rows[i + 1].start);
    rows[i].start -= overlap; rows[i].end -= overlap;
  }
  for (let i = index + 1; i < rows.length; i++) {
    const overlap = Math.max(0, rows[i - 1].end - rows[i].start);
    rows[i].start += overlap; rows[i].end += overlap;
  }
  if (rows.some(event => event.start < low || event.end > high)) return null;
  return rows.map(event => ({ ...event, start: new Date(event.start).toISOString(), end: new Date(event.end).toISOString() }));
}

export function createCalendarPreview({ getEvents, refresh, openInfo, announce }) {
  let overrides = new Map(), removed = new Set(), selected = null, drag = null, suppressClickUntil = 0;
  const $ = selector => document.querySelector(selector);
  const project = events => events.filter(event => !removed.has(event.id)).map(event => ({ ...event, ...overrides.get(event.id) }));
  const all = () => project(getEvents());
  const current = () => all().find(event => event.id === selected);
  const nodes = () => [...document.querySelectorAll('[data-event]')];
  function focusEvent() {
    const node = nodes().find(node => node.dataset.event === selected && node.getClientRects().length);
    (node || $('#calendar-heading')).focus({ preventScroll: true });
  }
  function sync() {
    const event = current();
    if (!event || !nodes().some(node => node.dataset.event === selected)) selected = null;
    const active = selected ? event : null;
    $('#calendar-editor').hidden = !active;
    nodes().forEach(node => {
      const chosen = node.dataset.event === selected;
      node.classList.toggle('is-editing', chosen);
      node.setAttribute('aria-pressed', String(chosen));
      node.setAttribute('aria-describedby', 'calendar-edit-help');
    });
    $('#calendar-editor-title').textContent = active?.title || 'Click an event to edit';
    $('#calendar-editor-time').textContent = active ? active.allDay ? 'All day' : `${formatTime(active.start)}–${formatTime(active.end)} · London time` : 'Move and resize directly on your calendar.';
    $('#calendar-edit-actions').hidden = !active;
    $('#calendar-edit-help').textContent = active?.allDay ? 'All-day event · open details or remove it from this preview.' : '30-minute steps · Drag to move, resize the edges · Double-click for details.';
    $('#calendar-preview-reset').disabled = !(overrides.size || removed.size);
    $('#calendar-preview-reset').hidden = $('#calendar-preview-reset').disabled;
    document.querySelectorAll('[data-preview-action]').forEach(button => {
      button.disabled = !active || !adjustPreviewDay(all(), selected, button.dataset.previewAction, Number(button.dataset.steps));
    });
    document.querySelectorAll('.preview-decoration').forEach(node => node.remove());
    if (!active) return;
    nodes().filter(node => node.dataset.event === selected).forEach(node => {
      const decoration = document.createElement('div');
      decoration.className = 'preview-decoration';
      Object.assign(decoration.style, { top: `${node.offsetTop}px`, left: `${node.offsetLeft}px`, width: `${node.offsetWidth}px`, height: `${node.offsetHeight}px` });
      decoration.innerHTML = '<button type="button" class="preview-remove" data-preview-remove aria-label="Remove event from preview" title="Remove event from preview"><svg aria-hidden="true"><use href="#i-x"/></svg></button>';
      if (!active.allDay && node.classList.contains('calendar-event')) {
        decoration.innerHTML += '<button type="button" class="preview-edge preview-edge-start" data-preview-resize="start" aria-label="Resize start in 30-minute steps" title="Drag to resize start · arrow keys adjust 30 minutes"></button><button type="button" class="preview-edge preview-edge-end" data-preview-resize="end" aria-label="Resize end in 30-minute steps" title="Drag to resize end · arrow keys adjust 30 minutes"></button>';
      }
      node.parentElement.append(decoration);
    });
  }
  function select(id) {
    if (performance.now() < suppressClickUntil) return;
    selected = id; sync();
  }
  function apply(action, steps, source = all()) {
    const result = adjustPreviewDay(source, selected, action, steps);
    if (!result) return false;
    result.forEach(event => overrides.set(event.id, { start: event.start, end: event.end }));
    refresh();
    return true;
  }
  function report() {
    const event = current();
    if (event) announce(`${event.title}: ${formatTime(event.start)} to ${formatTime(event.end)}. Preview only.`);
  }
  function remove() {
    if (!selected) return;
    removed.add(selected); selected = null; refresh();
    $('#calendar-heading').focus({ preventScroll: true });
    announce('Event removed from this preview. Reset preview restores it.');
  }
  function finishDrag(cancel = false) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if ($('#calendar-body').hasPointerCapture(previous.pointerId)) $('#calendar-body').releasePointerCapture(previous.pointerId);
    document.body.classList.remove('calendar-dragging');
    if (cancel) { overrides = previous.overrides; refresh(); }
    if (previous.moved) { suppressClickUntil = performance.now() + 400; if (!cancel) report(); }
  }
  document.addEventListener('click', event => {
    // Keep editing controls usable and ignore the click produced by a completed drag.
    if (selected && !drag && performance.now() >= suppressClickUntil &&
        !event.target.closest('[data-event], .preview-decoration, #calendar-editor, #calendar-preview-reset, dialog')) {
      selected = null;
      sync();
    }
    const button = event.target.closest('[data-preview-action]');
    if (button) {
      if (apply(button.dataset.previewAction, Number(button.dataset.steps))) report();
      if (button.disabled) $('#calendar-heading').focus({ preventScroll: true });
    }
    if (event.target.closest('[data-preview-remove]')) remove();
    if (event.target.closest('#calendar-preview-reset')) {
      overrides.clear(); removed.clear(); selected = null; refresh();
      $('#calendar-heading').focus({ preventScroll: true });
      announce('Original calendar restored.');
    }
    if (event.target.closest('#calendar-preview-done')) { selected = null; sync(); $('#calendar-heading').focus({ preventScroll: true }); }
    if (event.target.closest('#calendar-preview-info') && selected) openInfo(selected);
  });
  document.addEventListener('dblclick', event => {
    const node = event.target.closest('[data-event]');
    if (node && performance.now() >= suppressClickUntil) { selected = node.dataset.event; openInfo(selected); }
  });
  document.addEventListener('keydown', event => {
    if (event.target.closest('dialog, input, textarea, select')) return;
    if (event.key === 'Escape' && selected) {
      if (drag) finishDrag(true);
      else { const id = selected; selected = null; sync(); nodes().find(node => node.dataset.event === id && node.getClientRects().length)?.focus(); }
      return;
    }
    const node = event.target.closest('[data-event]'), edge = event.target.closest('[data-preview-resize]');
    if (!node && !edge) return;
    if (node && event.key === 'Enter' && selected === node.dataset.event) { event.preventDefault(); openInfo(selected); return; }
    if (node?.dataset.event !== selected && !edge) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const action = edge?.dataset.previewResize || (event.shiftKey ? 'end' : 'move');
    if (apply(action, event.key === 'ArrowUp' ? -1 : 1)) { focusEvent(); report(); }
  });
  $('#calendar-body').addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    const edge = event.target.closest('[data-preview-resize]'), node = event.target.closest('[data-event]');
    if (!edge && (!node || node.dataset.event !== selected)) return;
    if (current()?.allDay) return;
    drag = { pointerId: event.pointerId, y: event.clientY, scroll: $('#calendar-scroll').scrollTop, events: all(), overrides: new Map(overrides), action: edge?.dataset.previewResize || 'move', steps: 0, moved: false };
    // Capture after crossing the drag threshold, preserving ordinary double-clicks.
  });
  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const scroller = $('#calendar-scroll'), rect = scroller.getBoundingClientRect();
    if (Math.abs(event.clientY - drag.y) < 6 && !drag.moved) return;
    if (!drag.moved) { drag.moved = true; $('#calendar-body').setPointerCapture(event.pointerId); document.body.classList.add('calendar-dragging'); }
    if (event.clientY > rect.bottom - 28) scroller.scrollTop += 12;
    else if (event.clientY < rect.top + 75) scroller.scrollTop -= 12;
    const steps = Math.round((event.clientY - drag.y + scroller.scrollTop - drag.scroll) / 36);
    if (steps === drag.steps) return;
    if (steps === 0) { overrides = new Map(drag.overrides); refresh(); drag.steps = 0; }
    else if (apply(drag.action, steps, drag.events)) drag.steps = steps;
  });
  document.addEventListener('pointerup', () => finishDrag());
  document.addEventListener('pointercancel', () => finishDrag(true));
  window.addEventListener('blur', () => finishDrag(true));
  window.addEventListener('resize', sync);
  return { project, sync, select };
}
