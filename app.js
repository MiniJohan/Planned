(() => {
  'use strict';

  /* ================= DOM ================= */
  const $ = (s) => document.querySelector(s);
  const el = {
    list: $('#list'),
    add: $('#add'),
    date: $('#date'),
    dateMain: $('#dateMain'),
    dateSub: $('#dateSub'),
    prev: $('#prev'),
    next: $('#next'),
    tpl: $('#tpl'),
    sheet: $('#sheet'),
    sheetDone: $('#sheetDone'),
    slots: $('#slots'),
    scrim: $('#scrim'),
    toast: $('#toast'),
    toastMsg: $('#toastMsg'),
    toastUndo: $('#toastUndo'),
  };

  /* ================= State ================= */
  // { days: { "YYYY-MM-DD": [{id, text, time|null, done}] },
  //   templates: [ null | {name, items:[{text, time}]} ] x3 }
  const KEY = 'planned.v1';

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.days && Array.isArray(s.templates)) {
        while (s.templates.length < 3) s.templates.push(null);
        s.templates.length = 3; // hard cap: 3 slots
        return s;
      }
    } catch (e) { /* fall through to fresh state */ }
    return { days: {}, templates: [null, null, null] };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
  }

  const state = load();

  /* ================= Dates ================= */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const shift = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
  const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  let today = iso(new Date());
  let cur = today;

  /* ================= Helpers ================= */
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const dayItems = (d) => state.days[d] || [];

  // Timed items first (by time), then untimed in creation order.
  function sorted(d) {
    return dayItems(d)
      .map((it, i) => ({ it, i }))
      .sort((x, y) => {
        const a = x.it.time, b = y.it.time;
        if (a && b) return a.localeCompare(b) || x.i - y.i;
        if (a) return -1;
        if (b) return 1;
        return x.i - y.i;
      })
      .map((o) => o.it);
  }

  // "0930 gym" / "9:30 gym" -> { time: "09:30", text: "gym" }
  function parse(raw) {
    const s = raw.trim();
    const m = s.match(/^(\d{1,2}):(\d{2})\s+(.+)$/) || s.match(/^(\d{2})(\d{2})\s+(.+)$/);
    if (m) {
      const h = +m[1], mi = +m[2];
      if (h < 24 && mi < 60) return { time: `${pad(h)}:${pad(mi)}`, text: m[3].trim() };
    }
    return { time: null, text: s };
  }

  /* ================= Render ================= */
  let dragging = false;

  function render(scrollId) {
    const d = fromIso(cur);
    const diff = Math.round((d - fromIso(today)) / 864e5);
    const rel = { '-1': 'Yesterday', '0': 'Today', '1': 'Tomorrow' }[diff];
    el.dateMain.textContent = rel || d.toLocaleDateString(undefined, { weekday: 'long' });
    el.dateSub.textContent = rel
      ? d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

    const items = sorted(cur);
    el.list.replaceChildren();

    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Nothing planned';
      el.list.append(e);
      return;
    }

    let nextId = null;
    if (cur === today) {
      const now = hhmm(new Date());
      const n = items.find((i) => i.time && !i.done && i.time >= now);
      nextId = n ? n.id : null;
    }

    items.forEach((it) => el.list.append(buildRow(it, it.id === nextId)));

    if (scrollId) {
      const t = el.list.querySelector(`[data-id="${scrollId}"]`);
      if (t) t.scrollIntoView({ block: 'nearest' });
    }
  }

  function buildRow(it, isNext) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = it.id;

    const bg = document.createElement('div');
    bg.className = 'del';
    bg.textContent = 'Delete';

    const fg = document.createElement('div');
    fg.className = 'item' + (it.done ? ' done' : '') + (isNext ? ' next' : '');

    const chk = document.createElement('div');
    chk.className = 'check';

    const txt = document.createElement('div');
    txt.className = 'text';
    txt.textContent = it.text;

    fg.append(chk, txt);

    if (it.time) {
      const t = document.createElement('div');
      t.className = 'time';
      t.textContent = it.time;
      fg.append(t);
    }

    row.append(bg, fg);
    attachSwipe(row, fg, it.id);
    return row;
  }

  /* ================= Actions ================= */
  function addItem(raw) {
    const { time, text } = parse(raw);
    if (!text) return;
    const it = { id: uid(), text, time, done: false };
    (state.days[cur] ||= []).push(it);
    save();
    render(it.id);
  }

  function toggle(id) {
    const it = dayItems(cur).find((x) => x.id === id);
    if (!it) return;
    it.done = !it.done;
    save();
    render();
  }

  function removeItem(id) {
    const day = cur;
    const arr = state.days[day] || [];
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [it] = arr.splice(i, 1);
    if (!arr.length) delete state.days[day];
    save();

    toast('Deleted', () => {
      const a = (state.days[day] ||= []);
      a.splice(Math.min(i, a.length), 0, it);
      save();
      render(cur === day ? it.id : undefined);
    });
  }

  /* ================= Swipe to delete ================= */
  function attachSwipe(row, fg, id) {
    let pid = null, sx = 0, sy = 0, dx = 0, t0 = 0, lock = null, swiped = false;

    fg.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      pid = e.pointerId;
      sx = e.clientX; sy = e.clientY;
      dx = 0; lock = null; t0 = Date.now();
      swiped = false;
      dragging = true;
      fg.style.transition = 'none';
    });

    fg.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const mx = e.clientX - sx, my = e.clientY - sy;
      if (!lock) {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (lock === 'x') fg.setPointerCapture(pid);
      }
      if (lock !== 'x') return;
      dx = Math.min(0, mx); // left only
      fg.style.transform = `translateX(${dx}px)`;
    });

    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      dragging = false;
      fg.style.transition = '';
      swiped = lock === 'x';

      const flick = dx < -50 && Date.now() - t0 < 220;
      const commit = e.type === 'pointerup' && lock === 'x' && (dx < -100 || flick);

      if (commit) {
        fg.style.transform = `translateX(-${row.offsetWidth}px)`;
        row.style.height = row.offsetHeight + 'px';
        void row.offsetHeight; // force reflow so the collapse animates
        row.classList.add('gone');
        removeItem(id);
        setTimeout(() => { if (row.isConnected) render(); }, 200);
      } else {
        fg.style.transform = '';
      }
    };

    fg.addEventListener('pointerup', end);
    fg.addEventListener('pointercancel', end);

    // Tap anywhere on the row toggles done (ignored right after a swipe)
    fg.addEventListener('click', () => {
      if (swiped) { swiped = false; return; }
      toggle(id);
    });
  }

  /* ================= Toast ================= */
  let toastTimer = null, undoFn = null;

  function toast(msg, undo) {
    el.toastMsg.textContent = msg;
    undoFn = undo || null;
    el.toastUndo.hidden = !undo;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }

  function hideToast() {
    el.toast.classList.remove('show');
    undoFn = null;
  }

  el.toastUndo.addEventListener('click', () => {
    const f = undoFn;
    hideToast();
    if (f) f();
  });

  /* ================= Templates ================= */
  function openSheet() {
    el.add.blur();
    renderSlots();
    el.sheet.classList.add('open');
    el.scrim.classList.add('open');
    el.sheet.setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    el.sheet.classList.remove('open');
    el.scrim.classList.remove('open');
    el.sheet.setAttribute('aria-hidden', 'true');
  }

  const sheetOpen = () => el.sheet.classList.contains('open');

  function mk(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderSlots() {
    el.slots.replaceChildren();
    const dayHasItems = dayItems(cur).length > 0;

    state.templates.forEach((t, i) => {
      const slot = mk('div', 'slot');
      const top = mk('div', 'slot-top');

      if (t) {
        const name = mk('input', 'slot-name');
        name.type = 'text';
        name.value = t.name;
        name.maxLength = 24;
        name.setAttribute('aria-label', `Template ${i + 1} name`);
        name.addEventListener('change', () => {
          t.name = name.value.trim() || `Template ${i + 1}`;
          name.value = t.name;
          save();
        });
        top.append(name, mk('span', 'slot-meta', `${t.items.length} item${t.items.length === 1 ? '' : 's'}`));
      } else {
        top.append(mk('span', 'slot-name is-empty', 'Empty'), mk('span', 'slot-meta', `Slot ${i + 1}`));
      }

      const acts = mk('div', 'slot-acts');

      if (t) {
        const apply = mk('button', 'btn primary', 'Apply');
        apply.type = 'button';
        apply.addEventListener('click', () => applyTemplate(i));
        acts.append(apply);
      }

      const saveBtn = mk('button', 'btn', 'Save this day');
      saveBtn.type = 'button';
      saveBtn.disabled = !dayHasItems;
      saveBtn.addEventListener('click', () => saveTemplate(i));
      acts.append(saveBtn);

      if (t) {
        const clear = mk('button', 'btn quiet', 'Clear');
        clear.type = 'button';
        clear.addEventListener('click', () => clearTemplate(i));
        acts.append(clear);
      }

      slot.append(top, acts);
      el.slots.append(slot);
    });
  }

  function applyTemplate(i) {
    const t = state.templates[i];
    if (!t || !t.items.length) return;
    const day = cur;
    const added = t.items.map((x) => ({ id: uid(), text: x.text, time: x.time, done: false }));
    (state.days[day] ||= []).push(...added);
    save();
    closeSheet();
    render();

    const n = added.length;
    toast(`Added ${n} item${n === 1 ? '' : 's'}`, () => {
      const ids = new Set(added.map((a) => a.id));
      const left = (state.days[day] || []).filter((x) => !ids.has(x.id));
      if (left.length) state.days[day] = left; else delete state.days[day];
      save();
      render();
    });
  }

  function saveTemplate(i) {
    const items = sorted(cur).map(({ text, time }) => ({ text, time }));
    if (!items.length) return;
    const prev = state.templates[i];
    const name = prev ? prev.name : `Template ${i + 1}`;
    state.templates[i] = { name, items };
    save();
    closeSheet();
    toast(`Saved to ${name}`, () => {
      state.templates[i] = prev; // prev is null for a fresh slot
      save();
    });
  }

  function clearTemplate(i) {
    const prev = state.templates[i];
    if (!prev) return;
    state.templates[i] = null;
    save();
    renderSlots();
    toast('Template cleared', () => {
      state.templates[i] = prev;
      save();
      if (sheetOpen()) renderSlots();
    });
  }

  /* ================= Events ================= */
  el.add.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const v = el.add.value;
    if (!v.trim()) return;
    el.add.value = '';
    addItem(v); // input keeps focus: rapid entry
  });

  el.prev.addEventListener('click', () => { cur = shift(cur, -1); render(); });
  el.next.addEventListener('click', () => { cur = shift(cur, 1); render(); });
  el.date.addEventListener('click', () => { cur = today; render(); });

  el.tpl.addEventListener('click', openSheet);
  el.sheetDone.addEventListener('click', closeSheet);
  el.scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });

  /* ================= Day rollover + "next" refresh ================= */
  function tick() {
    const t = iso(new Date());
    if (t !== today) {
      const wasToday = cur === today;
      today = t;
      if (wasToday) cur = today;
    }
    if (!dragging) render();
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tick, 60000);

  /* ================= iOS keyboard fit ================= */
  // iOS doesn't shrink the layout viewport when the keyboard opens, so the
  // pinned input would hide behind it. Size the app to the visual viewport.
  const vv = window.visualViewport;
  function fit() {
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', h + 'px');
    document.body.classList.toggle('kb', window.innerHeight - h > 120);
    if (window.scrollY) window.scrollTo(0, 0);
  }
  if (vv) {
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
  }
  fit();

  /* ================= Init ================= */
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();