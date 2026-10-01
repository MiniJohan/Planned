(() => {
  'use strict';

  /* ================= DOM ================= */
  const $ = (s) => document.querySelector(s);
  const el = {
    date: $('#date'), dateMain: $('#dateMain'), dateSub: $('#dateSub'),
    prev: $('#prev'), next: $('#next'), tpl: $('#tpl'), add: $('#add'),
    scroll: $('#scroll'), tl: $('#tl'), grid: $('#grid'), blocks: $('#blocks'),
    nowLine: $('#nowLine'), nowPill: $('#nowPill'), hint: $('#hint'),
    scrim: $('#scrim'),
    edit: $('#editSheet'), eTitle: $('#eTitle'), eStart: $('#eStart'), eEnd: $('#eEnd'),
    chips: $('#chips'), eDelete: $('#eDelete'), eDone: $('#eDone'),
    tplSheet: $('#tplSheet'), tplDone: $('#tplDone'), slots: $('#slots'),
    toast: $('#toast'), toastMsg: $('#toastMsg'), toastUndo: $('#toastUndo'),
  };

  function mk(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ================= Constants + time math ================= */
  const HOUR = 72;    // px per hour
  const PAD = 12;     // top/bottom padding inside the timeline
  const SNAP = 15;    // minutes
  const MIN_DUR = 15; // minimum block length
  const DAY = 1440;

  const Y = (m) => PAD + (m * HOUR) / 60;
  const fromY = (y) => ((y - PAD) * 60) / HOUR;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const snap = (m) => Math.round(m / SNAP) * SNAP;
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const toInput = (m) => (m >= DAY ? '23:59' : fmt(m));
  const fromInput = (v, isEnd) => {
    if (!v) return null;
    if (isEnd && v === '23:59') return DAY;
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  };
  const nowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  /* ================= State ================= */
  // { days: { "YYYY-MM-DD": [{ id, title, start, end }] },   (minutes from midnight)
  //   templates: [ null | { name, items: [{ title, start, end }] } ] x3 }
  const KEY = 'planned.v2';

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.days && Array.isArray(s.templates)) {
        while (s.templates.length < 3) s.templates.push(null);
        s.templates.length = 3; // hard cap: 3 slots
        return s;
      }
    } catch (e) { /* fresh state below */ }
    return { days: {}, templates: [null, null, null] };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* blocked or full */ }
  }
  const state = load();

  /* ================= Dates ================= */
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const shift = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };

  let today = iso(new Date());
  let cur = today;

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const dayItems = (d) => state.days[d] || [];
  const item = (id) => dayItems(cur).find((x) => x.id === id);

  /* ================= Grid (built once) ================= */
  function buildGrid() {
    el.tl.style.height = (24 * HOUR + PAD * 2) + 'px';
    const f = document.createDocumentFragment();
    for (let h = 0; h <= 24; h++) {
      const line = mk('div', 'hl');
      line.style.top = Y(h * 60) + 'px';
      f.append(line);
      if (h < 24) {
        const label = mk('div', 'hlabel', fmt(h * 60));
        label.style.top = Y(h * 60) + 'px';
        const half = mk('div', 'hl half');
        half.style.top = Y(h * 60 + 30) + 'px';
        f.append(label, half);
      }
    }
    el.grid.append(f);
  }

  /* ================= Overlap layout ================= */
  // Overlapping blocks share the row side by side.
  function layout(list) {
    const out = [];
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      const cols = [];
      cluster.forEach((b) => {
        let c = cols.findIndex((end) => end <= b.start);
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = b.end;
        b.col = c;
      });
      cluster.forEach((b) => { b.cols = cols.length; });
      out.push(...cluster);
      cluster = [];
    };
    list.forEach((b) => {
      if (cluster.length && b.start >= clusterEnd) { flush(); clusterEnd = -1; }
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.end);
    });
    if (cluster.length) flush();
    return out;
  }

  /* ================= Render ================= */
  function geom(d, s, e) {
    const h = Math.max(((e - s) * HOUR) / 60 - 2, 22);
    d.style.top = (Y(s) + 1) + 'px';
    d.style.height = h + 'px';
    d.classList.toggle('short', h < 48);
    d.classList.toggle('tiny', h < 30);
    d.querySelector('.time').textContent = `${fmt(s)}–${fmt(e)}`;
  }

  function buildBlock(b, status) {
    const d = mk('div', 'block' + (status ? ' ' + status : '') + (b.cols > 1 ? ' multi' : ''));
    d.dataset.id = b.id;
    d.style.left = `${(b.col / b.cols) * 100}%`;
    d.style.width = `calc(${100 / b.cols}% - 4px)`;
    const t = mk('div', 'title', b.title || 'New block');
    if (!b.title) t.classList.add('placeholder');
    const grip = mk('div', 'grip');
    d.append(t, mk('div', 'time'), grip);
    geom(d, b.start, b.end);
    wireBlock(d, b.id, grip);
    return d;
  }

  function render(opts) {
    // header
    const d = fromIso(cur);
    const diff = Math.round((d - fromIso(today)) / 864e5);
    const rel = { '-1': 'Yesterday', '0': 'Today', '1': 'Tomorrow' }[diff];
    el.dateMain.textContent = rel || d.toLocaleDateString(undefined, { weekday: 'long' });
    el.dateSub.textContent = rel
      ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

    // blocks
    const items = dayItems(cur).map((x) => ({ ...x })).sort((a, b) => a.start - b.start || a.end - b.end);
    const nowMin = nowMinutes();
    el.blocks.replaceChildren();
    layout(items).forEach((b) => {
      let status = '';
      if (cur === today) status = b.end <= nowMin ? 'past' : b.start <= nowMin ? 'now' : '';
      el.blocks.append(buildBlock(b, status));
    });

    // now marker
    const isToday = cur === today;
    el.nowLine.style.display = el.nowPill.style.display = isToday ? 'block' : 'none';
    if (isToday) {
      const y = Y(nowMin) + 'px';
      el.nowLine.style.top = y;
      el.nowPill.style.top = y;
      el.nowPill.textContent = fmt(nowMin);
    }

    el.hint.classList.toggle('on', items.length === 0);
    if (opts && opts.scroll) scrollDefault();
  }

  function scrollDefault() {
    let m;
    if (cur === today) m = nowMinutes() - 90;
    else {
      const items = dayItems(cur);
      m = items.length ? Math.min(...items.map((x) => x.start)) - 60 : 6 * 60 - 30;
    }
    el.scroll.scrollTop = Math.max(0, Y(Math.max(0, m)) - 8);
  }

  function ensureVisible(it) {
    const sc = el.scroll;
    const avail = sc.clientHeight - el.edit.offsetHeight; // part of the timeline not under the sheet
    const top = Y(it.start), bot = Y(it.end);
    if (top < sc.scrollTop + 8 || bot > sc.scrollTop + avail - 8) sc.scrollTop = Math.max(0, top - 24);
  }

  /* ================= Create / delete ================= */
  function createAt(start) {
    const it = { id: uid(), title: '', start, end: Math.min(start + 60, DAY) };
    (state.days[cur] ||= []).push(it);
    save();
    render();
    openEditor(it.id, true);
  }

  function removeItem(id) {
    const day = cur;
    const arr = state.days[day] || [];
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [it] = arr.splice(i, 1);
    if (!arr.length) delete state.days[day];
    save();
    return { it, day };
  }

  function deleteWithUndo(id) {
    const r = removeItem(id);
    if (!r) return;
    render();
    toast('Deleted', () => {
      (state.days[r.day] ||= []).push(r.it);
      save();
      if (cur === r.day) render();
    });
  }

  // Tap empty timeline -> new block at that quarter-hour
  el.tl.addEventListener('click', (e) => {
    if (justDragged || e.target.closest('.block')) return;
    const m = Math.floor(fromY(e.clientY - el.tl.getBoundingClientRect().top) / SNAP) * SNAP;
    createAt(clamp(m, 0, DAY - SNAP));
  });

  // "+" -> next quarter-hour today, 09:00 on other days
  el.add.addEventListener('click', () => {
    const s = cur === today ? Math.ceil(nowMinutes() / SNAP) * SNAP : 9 * 60;
    createAt(clamp(s, 0, DAY - SNAP));
  });

  /* ================= Move + resize ================= */
  let drag = null, justDragged = false, raf = 0, lastY = 0;
  const tlY = (cy) => cy - el.tl.getBoundingClientRect().top;

  // Once a long-press has lifted a block, stop the page from scrolling under the finger.
  document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });

  function wireBlock(d, id, grip) {
    let timer = null, pid = null, sx = 0, sy = 0, cx = 0, cy = 0;
    const cancelTimer = () => { clearTimeout(timer); timer = null; };

    // Long-press the body to lift and move
    d.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target === grip) return;
      pid = e.pointerId; sx = cx = e.clientX; sy = cy = e.clientY;
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        const it = item(id);
        if (!it) return;
        drag = { type: 'move', id, d, pid, dur: it.end - it.start, cur: it.start, grab: tlY(cy) - Y(it.start) };
        lastY = cy;
        d.classList.add('lifted');
        try { d.setPointerCapture(pid); } catch (_) { /* pointer already gone */ }
        startLoop();
      }, 320);
    });

    d.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      cx = e.clientX; cy = e.clientY;
      if (drag && drag.type === 'move') { lastY = cy; applyMove(); return; }
      if (timer && Math.hypot(cx - sx, cy - sy) > 8) cancelTimer(); // it's a scroll, not a lift
    });

    const up = (e) => {
      if (e.pointerId !== pid) return;
      cancelTimer();
      pid = null;
      if (drag && drag.type === 'move') endDrag(e.type === 'pointerup');
    };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    d.addEventListener('contextmenu', (e) => e.preventDefault());

    // Tap -> edit
    d.addEventListener('click', () => { if (!justDragged) openEditor(id, false); });

    // Bottom grip -> resize (touch-action:none, so it never scrolls)
    grip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const it = item(id);
      if (!it) return;
      drag = { type: 'resize', id, d, pid: e.pointerId, start: it.start, cur: it.end, off: Y(it.end) - tlY(e.clientY) };
      lastY = e.clientY;
      grip.setPointerCapture(e.pointerId);
      startLoop();
    });
    grip.addEventListener('pointermove', (e) => {
      if (drag && drag.type === 'resize' && e.pointerId === drag.pid) { lastY = e.clientY; applyResize(); }
    });
    const gend = (e) => {
      if (drag && drag.type === 'resize' && e.pointerId === drag.pid) endDrag(e.type === 'pointerup');
    };
    grip.addEventListener('pointerup', gend);
    grip.addEventListener('pointercancel', gend);
  }

  function applyMove() {
    const s = clamp(snap(fromY(tlY(lastY) - drag.grab)), 0, DAY - drag.dur);
    if (s !== drag.cur) { drag.cur = s; geom(drag.d, s, s + drag.dur); }
  }

  function applyResize() {
    const e = clamp(snap(fromY(tlY(lastY) + drag.off)), drag.start + MIN_DUR, DAY);
    if (e !== drag.cur) { drag.cur = e; geom(drag.d, drag.start, e); }
  }

  function endDrag(commit) {
    const dg = drag;
    drag = null;
    cancelAnimationFrame(raf);
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 60);
    const it = item(dg.id);
    if (commit && it) {
      if (dg.type === 'move') { it.start = dg.cur; it.end = dg.cur + dg.dur; }
      else it.end = dg.cur;
      save();
    }
    render();
  }

  // Auto-scroll while dragging near the top/bottom edge
  function startLoop() {
    cancelAnimationFrame(raf);
    const step = () => {
      if (!drag) return;
      const r = el.scroll.getBoundingClientRect();
      let v = 0;
      if (lastY < r.top + 70) v = -Math.min(14, (r.top + 70 - lastY) / 5);
      else if (lastY > r.bottom - 70) v = Math.min(14, (lastY - (r.bottom - 70)) / 5);
      if (v) {
        el.scroll.scrollTop += v;
        if (drag.type === 'move') applyMove(); else applyResize();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /* ================= Sheets ================= */
  function show(n) {
    n.removeAttribute('inert');
    n.classList.add('open');
    el.scrim.classList.add('open');
  }
  function hide(n) {
    n.classList.remove('open');
    n.setAttribute('inert', '');
    el.scrim.classList.remove('open');
  }
  const tplOpen = () => el.tplSheet.classList.contains('open');

  function closeAny() {
    if (editing) closeEditor();
    else if (tplOpen()) hide(el.tplSheet);
  }
  el.scrim.addEventListener('click', closeAny);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAny(); });

  /* ================= Block editor ================= */
  let editing = null; // { id, isNew }

  function syncChips(it) {
    const dur = it.end - it.start;
    el.chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', +c.dataset.d === dur));
  }

  function openEditor(id, isNew) {
    const it = item(id);
    if (!it) return;
    editing = { id, isNew };
    el.eTitle.value = it.title;
    el.eStart.value = toInput(it.start);
    el.eEnd.value = toInput(it.end);
    syncChips(it);
    show(el.edit);
    ensureVisible(it);
    if (isNew) el.eTitle.focus({ preventScroll: true });
  }

  function closeEditor() {
    if (!editing) return;
    const { id, isNew } = editing;
    editing = null;
    const it = item(id);
    if (it) {
      const t = el.eTitle.value.trim();
      if (!t && isNew) removeItem(id);          // never typed a title: discard
      else { it.title = t || 'Untitled'; save(); }
    }
    hide(el.edit);
    el.eTitle.blur();
    render();
  }

  el.eTitle.addEventListener('input', () => {
    const it = editing && item(editing.id);
    if (!it) return;
    it.title = el.eTitle.value;
    save();
    render();
  });
  el.eTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); closeEditor(); }
  });

  // Changing start keeps the duration; changing end can't go before start.
  el.eStart.addEventListener('input', () => {
    const it = editing && item(editing.id);
    const v = fromInput(el.eStart.value, false);
    if (!it || v == null) return;
    const dur = it.end - it.start;
    it.start = clamp(v, 0, DAY - MIN_DUR);
    it.end = Math.min(it.start + dur, DAY);
    el.eEnd.value = toInput(it.end);
    syncChips(it); save(); render();
  });
  el.eEnd.addEventListener('input', () => {
    const it = editing && item(editing.id);
    const v = fromInput(el.eEnd.value, true);
    if (!it || v == null) return;
    it.end = clamp(v, it.start + MIN_DUR, DAY);
    syncChips(it); save(); render();
  });
  el.eEnd.addEventListener('change', () => {
    const it = editing && item(editing.id);
    if (it) el.eEnd.value = toInput(it.end); // snap the field back if the pick was invalid
  });

  el.chips.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    const it = editing && item(editing.id);
    if (!c || !it) return;
    it.end = Math.min(it.start + +c.dataset.d, DAY);
    el.eEnd.value = toInput(it.end);
    syncChips(it); save(); render();
  });

  el.eDone.addEventListener('click', closeEditor);
  el.eDelete.addEventListener('click', () => {
    if (!editing) return;
    const { id, isNew } = editing;
    const empty = !el.eTitle.value.trim();
    editing = null;
    hide(el.edit);
    el.eTitle.blur();
    if (isNew && empty) { removeItem(id); render(); } else deleteWithUndo(id);
  });

  /* ================= Templates ================= */
  el.tpl.addEventListener('click', () => { renderSlots(); show(el.tplSheet); });
  el.tplDone.addEventListener('click', () => hide(el.tplSheet));

  function renderSlots() {
    el.slots.replaceChildren();
    const hasBlocks = dayItems(cur).length > 0;

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
        const n = t.items.length;
        top.append(name, mk('span', 'slot-meta', `${n} block${n === 1 ? '' : 's'}`));
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
      saveBtn.disabled = !hasBlocks;
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
    const added = t.items.map((x) => ({ id: uid(), title: x.title, start: x.start, end: x.end }));
    (state.days[day] ||= []).push(...added);
    save();
    hide(el.tplSheet);
    render({ scroll: true });

    const n = added.length;
    toast(`Added ${n} block${n === 1 ? '' : 's'}`, () => {
      const ids = new Set(added.map((a) => a.id));
      const left = (state.days[day] || []).filter((x) => !ids.has(x.id));
      if (left.length) state.days[day] = left; else delete state.days[day];
      save();
      if (cur === day) render();
    });
  }

  function saveTemplate(i) {
    const items = dayItems(cur)
      .slice()
      .sort((a, b) => a.start - b.start)
      .map(({ title, start, end }) => ({ title, start, end }));
    if (!items.length) return;
    const prev = state.templates[i];
    const name = prev ? prev.name : `Template ${i + 1}`;
    state.templates[i] = { name, items };
    save();
    hide(el.tplSheet);
    toast(`Saved to ${name}`, () => { state.templates[i] = prev; save(); });
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
      if (tplOpen()) renderSlots();
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
  function hideToast() { el.toast.classList.remove('show'); undoFn = null; }
  el.toastUndo.addEventListener('click', () => { const f = undoFn; hideToast(); if (f) f(); });

  /* ================= Navigation ================= */
  el.prev.addEventListener('click', () => { cur = shift(cur, -1); render({ scroll: true }); });
  el.next.addEventListener('click', () => { cur = shift(cur, 1); render({ scroll: true }); });
  el.date.addEventListener('click', () => { cur = today; render({ scroll: true }); });

  /* ================= Clock ================= */
  function tick() {
    const t = iso(new Date());
    let rolled = false;
    if (t !== today) {
      const wasToday = cur === today;
      today = t;
      if (wasToday) { cur = today; rolled = true; }
    }
    if (!drag && !editing) render(rolled ? { scroll: true } : undefined);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tick, 60000);

  /* ================= iOS keyboard fit ================= */
  // iOS doesn't shrink the layout viewport when the keyboard opens. Size the app
  // to the visual viewport so the sheet sits directly above the keyboard.
  const vv = window.visualViewport;
  function fit() {
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', h + 'px');
    document.body.classList.toggle('kb', window.innerHeight - h > 120);
    if (window.scrollY) window.scrollTo(0, 0);
    if (editing) {
      const it = item(editing.id);
      if (it) requestAnimationFrame(() => ensureVisible(it));
    }
  }
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
  fit();

  /* ================= Init ================= */
  buildGrid();
  render({ scroll: true });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();