/* Vikalp note: a small working model of the plugin's editor.

   window.Vikalp = { createSpan, createNote }

   createSpan(el, versions, opts) turns an element into a span with versions.
     versions: ['a', 'b', 'ai:c'] (an "ai:" prefix marks an AI version)
     opts: { kind, onChange(span), onEnter(span), onLeave(span), disabled() }

   createNote(host, data) renders a note and wires every interaction.
     data: { title, paragraphs: [[segment, ...], ...] }
     A segment is plain text or one of:
       { versions: [...], kind, id }       blue underline and dots; click swaps
       { fade: 'text', id }                faded text; click brings it back
       { strike: 'text', level: 1 to 3 }   struck by a Lab trim of that level or more
       { lint: 'text', rule, why, fix }    wavy mark; the side panel names the rule
       { cut: 'text', id }                 a line that can move to Overflow
     Fade, cut and lint start off; the page turns them on with fade(), cut() and lint().

   The side panel holds Versions, Overflow, Lint and the Lab. In a note narrower
   than 620px it becomes a tray under the text that shows one section at a time,
   and the text shows one paragraph at a time; view() picks both.

   Every animation reads its duration from the CSS tokens, so under
   prefers-reduced-motion (durations of 0ms) states change instantly. */
window.Vikalp = (() => {
  const root = document.documentElement;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const countWords = s => (String(s).match(/\S+/g) || []).length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const ms = name => {
    const v = getComputedStyle(root).getPropertyValue(name).trim();
    return v.endsWith('ms') ? parseFloat(v) || 0 : (parseFloat(v) || 0) * 1000;
  };
  const EASE = 'cubic-bezier(.2, .7, .2, 1)';
  const robot = () => '<svg class="vk-robot" aria-hidden="true"><use href="#vk-robot"/></svg>';

  document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="vk-robot" viewBox="0 0 16 16"><path d="M8 1.5v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/><circle cx="8" cy="1.4" r="1" fill="currentColor"/><rect x="2.5" y="4" width="11" height="9" rx="2" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="6" cy="8.2" r="1.2" fill="currentColor"/><circle cx="10" cy="8.2" r="1.2" fill="currentColor"/><path d="M6 11h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M1 8v2M15 8v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></symbol>
  </svg>`);

  /* ← → go to the focused span, or else the hovered one */
  let hovered = null;
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const span = (document.activeElement && document.activeElement.__vk) || hovered;
    if (!span || !span.enabled()) return;
    e.preventDefault();
    span.step(e.key === 'ArrowRight' ? 1 : -1);
  });

  const versionRows = (versions, current) => versions.map((v, k) =>
    `<li><button type="button" data-pick="${k}" class="${k === current ? 'on' : ''}${v.fresh ? ' is-new' : ''}" aria-pressed="${k === current}">` +
    `<span class="d${v.ai ? ' ai' : ''}"></span><span class="t">${esc(v.text)}</span>` +
    `<span class="tag">${v.ai ? robot() + 'AI' : ''}</span></button></li>`).join('');

  /* ---------- a span with versions ---------- */
  const parseVersion = v => (v.startsWith('ai:') ? { text: v.slice(3), ai: true } : { text: v, ai: false });

  function createSpan(el, list, opts = {}) {
    const versions = list.map(parseVersion);
    const span = { el, versions, kind: opts.kind || 'word', i: 0, prev: -1 };
    el.classList.add('vk-v');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = '<span class="vk-v-text"></span><span class="vk-anchor" aria-hidden="true"><span class="vk-dots"></span></span>';
    const text = el.querySelector('.vk-v-text');
    const dots = el.querySelector('.vk-dots');
    let timer = 0;

    const paintDots = () => {
      dots.innerHTML = versions.map((v, k) => `<i class="${v.ai ? 'ai' : ''}${k === span.i ? ' on' : ''}"></i>`).join('');
    };
    const paintText = () => {
      const v = versions[span.i];
      text.innerHTML = (v.ai ? robot() : '') + esc(v.text);
      el.setAttribute('aria-label', `${v.ai ? 'AI version: ' : ''}${v.text}. Version ${span.i + 1} of ${versions.length}. Arrow keys swap.`);
    };

    span.enabled = () => !(opts.disabled && opts.disabled());
    span.current = () => versions[span.i];
    span.set = k => {
      if (!span.enabled()) return;
      const n = versions.length;
      k = ((k % n) + n) % n;
      if (k === span.i) return;
      span.prev = span.i;
      span.i = k;
      paintDots();
      const d = ms('--dur-fast');
      clearTimeout(timer);
      const done = () => { paintText(); text.classList.remove('is-swapping'); opts.onChange && opts.onChange(span); };
      if (!d) { done(); return; }
      text.classList.add('is-swapping');
      timer = setTimeout(done, d);
    };
    span.step = d => span.set(span.i + d);
    span.pick = k => span.set(k);
    span.add = v => { versions.push(v); paintDots(); };
    span.removeAI = () => {
      if (versions[span.i].ai) { span.i = 0; span.prev = -1; paintText(); }
      for (let k = versions.length - 1; k >= 0; k--) if (versions[k].ai) versions.splice(k, 1);
      paintDots();
    };

    el.addEventListener('click', () => span.step(1));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); span.step(1); } });
    el.addEventListener('mouseenter', () => { hovered = span; opts.onEnter && opts.onEnter(span); });
    el.addEventListener('mouseleave', () => { if (hovered === span) hovered = null; opts.onLeave && opts.onLeave(span); });
    el.addEventListener('focus', () => opts.onEnter && opts.onEnter(span));
    el.addEventListener('blur', () => opts.onLeave && opts.onLeave(span));
    el.__vk = span;
    paintDots();
    paintText();
    return span;
  }

  /* ---------- small motion helpers ---------- */
  const wait = d => new Promise(done => setTimeout(done, d));

  // A copy of a cut line slides in a straight line between the text and Overflow.
  function fly(text, from, to, d) {
    const ghost = document.createElement('div');
    ghost.className = 'vk-fly';
    ghost.textContent = text;
    Object.assign(ghost.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px' });
    document.body.append(ghost);
    const anim = ghost.animate([
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`, opacity: 0.4 },
      { transform: 'none', opacity: 1 },
    ], { duration: d, easing: EASE });
    return anim.finished.then(() => ghost.remove(), () => ghost.remove());
  }

  // Run a DOM change, then ease the element's height from what it was to what it is.
  function easeHeight(el, change, d) {
    const before = el.offsetHeight;
    change();
    const after = el.offsetHeight;
    if (!d || before === after) return Promise.resolve();
    el.style.overflow = 'hidden';
    const anim = el.animate([{ height: before + 'px' }, { height: after + 'px' }], { duration: d, easing: EASE });
    return anim.finished.then(() => { el.style.overflow = ''; }, () => { el.style.overflow = ''; });
  }

  /* ---------- a whole note ---------- */
  const TRIMS = ['', 'Slight', 'Tighter', 'More'];

  function createNote(host, data) {
    const note = { clean: false, focused: null, trim: 0, lab: false, groups: { lint: false } };
    const recs = [];
    const byId = {};

    host.classList.add('vk-note');
    host.innerHTML =
      '<div class="vk-frame"><div class="vk-app">' +
        '<div class="vk-editor">' +
          (data.title ? `<h3 class="vk-title">${esc(data.title)}</h3>` : '') +
          '<div class="vk-body"></div>' +
          '<div class="vk-status"><span class="vk-count"><span class="vk-wc"></span><span class="vk-state"></span></span>' +
          '<button class="vk-switch" type="button" role="switch" aria-checked="false"><span class="vk-track" aria-hidden="true"></span>Read it clean</button></div>' +
        '</div>' +
        '<aside class="vk-panel" aria-label="Side panel" data-tray="versions">' +
          '<section class="vk-sec" data-sec="versions"><p class="vk-panel-h">Versions</p><ul class="vk-list"></ul></section>' +
          '<section class="vk-sec" data-sec="overflow"><p class="vk-panel-h">Overflow</p><div class="vk-overflow"></div></section>' +
          '<section class="vk-sec" data-sec="lint" hidden><p class="vk-panel-h">Lint</p><div class="vk-lintbox" aria-live="polite"></div></section>' +
          '<section class="vk-sec" data-sec="lab" hidden><p class="vk-panel-h">The Lab</p>' +
            '<div class="vk-trims" role="group" aria-label="Trim">' +
            [1, 2, 3].map(l => `<button type="button" data-trim="${l}" aria-pressed="false">${TRIMS[l]}</button>`).join('') +
            '</div><p class="vk-trimnums"></p></section>' +
        '</aside>' +
      '</div></div>';

    const body = host.querySelector('.vk-body');
    const panel = host.querySelector('.vk-panel');
    const versionList = host.querySelector('.vk-list');
    const overflow = host.querySelector('.vk-overflow');
    const lintBox = host.querySelector('.vk-lintbox');
    const sec = name => host.querySelector(`[data-sec="${name}"]`);
    const sw = host.querySelector('.vk-switch');
    const paras = [];
    // matches the container query in style.css
    const isTray = () => host.clientWidth <= 620;

    data.paragraphs.forEach(segs => {
      const p = document.createElement('p');
      p.className = 'vk-p';
      paras.push(p);
      segs.forEach(seg => {
        const r = makeSeg(seg);
        r.p = p;
        recs.push(r);
        if (seg.id) byId[seg.id] = r;
        p.append(r.el);
      });
      body.append(p);
    });
    const spans = recs.filter(r => r.type === 'versions');

    // Make a segment clickable (or plain again), keeping read-it-clean in mind.
    function clickable(el, on, label, pressed) {
      if (!on) { ['tabindex', 'role', 'aria-label', 'aria-pressed'].forEach(a => el.removeAttribute(a)); return; }
      el.tabIndex = note.clean ? -1 : 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', label);
      if (pressed !== undefined) el.setAttribute('aria-pressed', String(pressed));
    }
    function onActivate(el, act) {
      el.addEventListener('click', act);
      el.addEventListener('keydown', e => {
        if (el.getAttribute('role') === 'button' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act(); }
      });
    }

    function makeSeg(seg) {
      if (typeof seg === 'string') return { type: 'text', seg, el: document.createTextNode(seg), text: () => seg };
      const el = document.createElement('span');
      const r = { seg, el };

      if (seg.versions) {
        r.type = 'versions';
        r.span = createSpan(el, seg.versions, {
          kind: seg.kind,
          disabled: () => note.clean,
          onChange: () => { focus(r); setTray('versions'); update(); },
          onEnter: () => { if (!note.clean) focus(r); },
        });
        r.text = () => r.span.current().text;
        return r;
      }

      if ('fade' in seg) {
        r.type = 'fade';
        r.live = false;
        r.on = false;
        el.className = 'vk-fade';
        el.textContent = seg.fade;
        onActivate(el, () => { if (note.clean || !r.live) return; r.on = !r.on; update(); });
        r.text = () => (r.on ? '' : seg.fade);
        r.paint = () => {
          el.classList.toggle('is-faded', r.on);
          el.classList.toggle('is-live', r.live);
          clickable(el, r.live, r.on ? `Faded: ${seg.fade} Click to bring it back.` : `${seg.fade} Click to fade it.`, r.on);
        };
        return r;
      }

      if ('strike' in seg) {
        r.type = 'strike';
        r.kept = false;
        r.armed = () => note.trim >= seg.level;
        r.struck = () => r.armed() && !r.kept;
        el.className = 'vk-strike';
        el.textContent = seg.strike;
        onActivate(el, () => { if (note.clean || !r.armed()) return; r.kept = !r.kept; update(); });
        r.text = () => (r.struck() ? '' : seg.strike);
        r.paint = () => {
          el.classList.toggle('is-armed', r.armed());
          el.classList.toggle('is-struck', r.struck());
          clickable(el, r.armed(), r.struck() ? `Struck: ${seg.strike} Click to keep it.` : `${seg.strike} Click to strike it.`, r.struck());
        };
        return r;
      }

      if ('lint' in seg) {
        r.type = 'lint';
        r.fixed = false;
        el.className = 'vk-lint';
        el.textContent = seg.lint;
        r.live = () => note.groups.lint && !r.fixed;
        r.text = () => (r.fixed && seg.fix ? seg.fix : seg.lint);
        const show = () => { if (!note.clean && r.live()) { note.lintShown = r; setTray('lint'); update(); } };
        r.paint = () => {
          const on = r.live();
          el.classList.toggle('is-on', on);
          el.classList.toggle('is-active', on && note.lintShown === r && !note.clean);
          if (on) { el.tabIndex = note.clean ? -1 : 0; el.setAttribute('aria-label', `${seg.lint}. Lint: ${seg.rule}`); }
          else clickable(el, false);
        };
        el.addEventListener('mouseenter', show);
        el.addEventListener('focus', show);
        el.addEventListener('click', show);
        return r;
      }

      // a cut line: in the text, or in Overflow with a red ‸ where it was
      r.type = 'cut';
      r.live = false;
      r.on = false;
      r.state = null;
      r.text = () => (r.on ? '' : seg.cut);
      r.paint = () => {
        const state = r.on ? 'out' : r.live ? 'back' : 'plain';
        if (state !== r.state) {
          r.state = state;
          el.className = state === 'back' ? 'vk-cut-back' : '';
          el.innerHTML = r.on
            ? '<button type="button" class="vk-caret" aria-label="A line was cut here and moved to Overflow. Click to put it back.">‸</button>'
            : esc(seg.cut);
        }
        const caret = el.querySelector('.vk-caret');
        if (caret) caret.tabIndex = note.clean ? -1 : 0;
        clickable(el, state === 'back', `${seg.cut} Click to move it to Overflow.`);
      };
      onActivate(el, () => { if (!note.clean && r.live) moveCut(r, !r.on); });
      return r;
    }

    /* Moving a line to Overflow and back. One motion at a time: the line
       leaves, then its paragraph closes; going back, the paragraph opens,
       then the line arrives. */
    async function moveCut(r, out, animate = true) {
      if (r.busy || r.on === out) return;
      const d = animate ? ms('--dur-slow') : 0;
      const close = d * 0.7;
      r.busy = true;
      await setTray('overflow', animate);
      if (out) {
        const from = r.el.getBoundingClientRect();
        if (d) {
          const slot = overflow.getBoundingClientRect();
          r.el.style.visibility = 'hidden';
          await fly(r.seg.cut, { left: from.left, top: from.top }, { left: slot.left, top: slot.top, width: slot.width }, d);
        }
        await easeHeight(r.p, () => { r.on = true; update(); r.el.style.visibility = ''; }, close);
      } else {
        const from = overflow.querySelector(`[data-back="${recs.indexOf(r)}"]`).getBoundingClientRect();
        await easeHeight(r.p, () => { r.on = false; update(); if (d) r.el.style.visibility = 'hidden'; }, close);
        if (d) {
          const to = r.el.getBoundingClientRect();
          await fly(r.seg.cut, { left: from.left, top: from.top }, { left: to.left, top: to.top, width: from.width }, d);
          r.el.style.visibility = '';
        }
      }
      r.busy = false;
    }

    /* the focused span fills the Versions list */
    let listed = null;
    function focus(r) {
      note.focused = r;
      const listShown = !isTray() || panel.dataset.tray === 'versions';
      spans.forEach(x => x.el.classList.toggle('is-active', x === r && listShown && !note.clean));
      renderVersions();
    }
    function renderVersions() {
      const r = note.focused;
      if (!r) return;
      versionList.innerHTML = versionRows(r.span.versions, r.span.i);
      r.span.versions.forEach(v => { v.fresh = false; });
      if (listed && listed !== r && ms('--dur')) versionList.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('--dur'), easing: EASE });
      listed = r;
    }
    function renderOverflow() {
      const cut = recs.filter(r => r.type === 'cut' && r.on);
      overflow.innerHTML = cut.length
        ? '<ul class="vk-olist">' + cut.map(r => `<li><button type="button" data-back="${recs.indexOf(r)}">${esc(r.seg.cut)}<span class="tag">put it back</span></button></li>`).join('') + '</ul>'
        : '<p class="vk-empty">Lines you cut land here.</p>';
    }
    function renderLint() {
      const r = note.lintShown;
      if (!r || !r.live()) { lintBox.innerHTML = '<p class="vk-empty">Click a wavy line to see why it’s marked.</p>'; return; }
      lintBox.innerHTML = `<p class="vk-rule">${esc(r.seg.rule)}</p><p class="vk-why">${esc(r.seg.why)}</p>` +
        (r.seg.fix ? `<ul class="vk-list"><li><button type="button" data-fix><span class="d"></span><span class="t">${esc(r.seg.fix)}</span><span class="tag">use it</span></button></li></ul>` : '');
    }
    function renderLab(after) {
      host.querySelectorAll('[data-trim]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.trim === note.trim)));
      const struck = recs.filter(r => r.type === 'strike' && r.struck());
      const before = after + struck.reduce((n, r) => n + countWords(r.seg.strike), 0);
      host.querySelector('.vk-trimnums').textContent = note.trim ? `${before} → ${after} words` : 'Pick a trim to see what a model would cut.';
    }

    panel.addEventListener('click', e => {
      if (note.clean) return;
      const back = e.target.closest('[data-back]');
      if (back) { moveCut(recs[+back.dataset.back], false); return; }
      if (e.target.closest('[data-fix]')) { fixLint(note.lintShown); return; }
      const trimBtn = e.target.closest('[data-trim]');
      if (trimBtn) { const l = +trimBtn.dataset.trim; trim(note.trim === l ? 0 : l); return; }
      const pick = e.target.closest('[data-pick]');
      if (pick && note.focused) note.focused.span.set(+pick.dataset.pick);
    });

    /* word count: faded lines, struck words and lines in Overflow don't count */
    const words = () => recs.reduce((n, r) => n + countWords(r.text()), 0);
    function update() {
      recs.forEach(r => r.paint && r.paint());
      const count = words();
      const faded = recs.filter(r => r.type === 'fade' && r.on).length;
      const over = recs.filter(r => r.type === 'cut' && r.on).length;
      const extra = [];
      if (faded) extra.push(`${faded} faded`);
      if (over) extra.push(`${over} in Overflow`);
      host.querySelector('.vk-wc').textContent = plural(count, 'word', 'words');
      host.querySelector('.vk-state').textContent = extra.length ? ' · ' + extra.join(' · ') : '';
      renderVersions();
      renderOverflow();
      renderLint();
      renderLab(count);
    }

    function fixLint(r) {
      r.fixed = true;
      r.el.textContent = r.text();
      note.lintShown = recs.find(x => x.type === 'lint' && x.live()) || null;
      update();
    }

    /* Which section the tray shows. A no-op beside a wide note, where every section shows. */
    function setTray(name, animate = true) {
      if (panel.dataset.tray === name) return Promise.resolve();
      panel.dataset.tray = name;
      focus(note.focused);
      return wait(animate && isTray() ? ms('--dur') : 0);
    }
    function view({ paragraph, tray }, animate = true) {
      const shown = paras[paragraph];
      const moved = !shown.classList.contains('is-shown');
      paras.forEach(p => p.classList.toggle('is-shown', p === shown));
      return Promise.all([setTray(tray, animate), wait(moved && animate && isTray() ? ms('--dur') : 0)]);
    }

    function setClean(on) {
      note.clean = !!on;
      host.classList.toggle('is-clean', note.clean);
      sw.setAttribute('aria-checked', String(note.clean));
      focus(note.focused);
      update();
    }
    sw.addEventListener('click', () => setClean(!note.clean));

    /* ---------- driving the note from outside (the scroll story) ---------- */
    // Each returns a promise that settles when its motion ends.
    function fade(id, on) {
      const r = byId[id];
      r.live = on;
      r.on = on;
      update();
      return wait(on ? ms('--dur-slow') : 0);
    }
    function cut(id, on, animate) {
      const r = byId[id];
      if (on) { r.live = true; return moveCut(r, true, animate); }
      return moveCut(r, false, animate).then(() => { r.live = false; update(); });
    }
    function reveal(name, on) {
      sec(name).hidden = !on;
      if (on && ms('--dur') && !isTray()) sec(name).animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('--dur'), easing: EASE });
    }
    function lint(on) {
      note.groups.lint = on;
      note.lintShown = on ? recs.find(r => r.type === 'lint' && r.live()) : null;
      reveal('lint', on);
      update();
      return wait(ms('--dur-slow'));
    }
    function trim(level) {
      note.trim = level;
      recs.forEach(r => { if (r.type === 'strike') r.kept = false; });
      update();
      return wait(level ? ms('--dur-slow') : 0);
    }
    function lab(on) {
      note.lab = on;
      reveal('lab', on);
      return trim(on ? 2 : 0);
    }
    async function addAI(id, texts, animate) {
      const r = byId[id];
      if (note.focused !== r) { focus(r); await wait(animate ? ms('--dur') : 0); }
      for (const text of texts) {
        r.span.add({ text, ai: true, fresh: animate });
        renderVersions();
        if (animate) await wait(ms('--dur-slow'));
      }
    }
    function removeAI(id) {
      const r = byId[id];
      r.span.removeAI();
      update();
      return Promise.resolve();
    }

    new ResizeObserver(() => focus(note.focused)).observe(host);
    note.focused = spans[0] || null;
    paras[0].classList.add('is-shown');
    update();

    return {
      el: host, words, isClean: () => note.clean, setClean,
      fade, cut, lint, lab, trim, addAI, removeAI, view,
      focus: id => focus(byId[id]),
    };
  }

  return { createSpan, createNote };
})();
