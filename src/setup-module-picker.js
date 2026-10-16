export function mountSetupModulePicker(target, workspace) {
  const courses = Array.isArray(workspace.courses) ? workspace.courses : [];
  const excluded = new Set((workspace.excludedCourseIds || []).map(String));
  const selected = new Set(courses.filter(course => !excluded.has(String(course.id))).map(course => String(course.id)));
  target.innerHTML = `
    <div class="module-picker-heading"><div><h2 id="module-picker-title">Choose your modules</h2><p>Include the modules you want to make time for.</p></div></div>
    <div class="module-picker-toolbar"><span id="module-selection-count" role="status" aria-live="polite"></span><button type="button" class="module-select-all">Select all</button></div>
    <label class="module-search-label" for="module-search" hidden>Find a module</label><input id="module-search" type="search" placeholder="Search by name or module code" autocomplete="off" hidden>
    <fieldset class="module-options"><legend class="sr-only">Modules to include</legend><div class="module-options-list"></div><p class="module-no-results" hidden>No matching modules. Try another name or code.</p></fieldset>
    <p class="module-picker-note"></p>`;
  const list = target.querySelector('.module-options-list');
  const rows = [];
  for (const course of courses) {
    const row = document.createElement('label'); row.className = 'module-choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(course.id); input.dataset.setupCourse = String(course.id); input.checked = selected.has(String(course.id));
    const copy = document.createElement('span'); copy.className = 'module-choice-copy';
    const title = document.createElement('strong'); title.textContent = course.name || course.shortname || 'Untitled module';
    const code = document.createElement('span'); code.className = 'module-choice-code'; code.textContent = course.shortname && course.shortname !== course.name ? course.shortname : '';
    copy.append(title); if (code.textContent) copy.append(code);
    row.append(input, copy); list.append(row);
    rows.push({ row, input, search: `${course.name || ''} ${course.shortname || ''}`.toLowerCase() });
    input.addEventListener('change', () => { if (input.checked) selected.add(input.value); else selected.delete(input.value); refresh(); });
  }
  const all = target.querySelector('.module-select-all');
  function refresh() {
    target.querySelector('#module-selection-count').textContent = `${selected.size} of ${courses.length} selected`;
    all.textContent = selected.size === courses.length ? 'Deselect all' : 'Select all';
    all.disabled = !courses.length;
    rows.forEach(({ input }) => { input.checked = selected.has(input.value); });
  }
  all.addEventListener('click', () => {
    if (selected.size === courses.length) selected.clear();
    else courses.forEach(course => selected.add(String(course.id)));
    refresh();
  });
  const search = target.querySelector('#module-search');
  if (courses.length >= 8) {
    search.hidden = false; target.querySelector('.module-search-label').hidden = false;
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      rows.forEach(item => { item.row.hidden = !item.search.includes(query); });
      target.querySelector('.module-no-results').hidden = rows.some(item => !item.row.hidden);
    });
  }
  const note = target.querySelector('.module-picker-note');
  note.textContent = 'Choose modules above, then fetch their course data when you are ready.';
  if (!courses.length) {
    target.querySelector('.module-options').hidden = true;
    target.querySelector('.module-picker-toolbar').hidden = true;
    note.classList.add('module-picker-empty');
    note.textContent = 'No modules loaded yet. Sign in to Moodle, then choose Load modules. Nothing is fetched automatically.';
  }
  refresh();
}
