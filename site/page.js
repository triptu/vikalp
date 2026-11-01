/* Page wiring: the theme toggle, the swap sound, the hero word, the scroll story and the clip lightbox. */
(() => {
  const root = document.documentElement;
  const theme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 860px)');
  const wait = d => new Promise(done => setTimeout(done, d));

  /* ---------- theme toggle ---------- */
  // The button shows where it goes: a sun in dark mode, a moon in light mode.
  const themeBtn = document.getElementById('themeBtn');
  const paintThemeBtn = () => {
    const label = `Switch to ${theme() === 'dark' ? 'light' : 'dark'} theme`;
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  };
  themeBtn.addEventListener('click', () => {
    root.dataset.theme = theme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('vk-theme', root.dataset.theme); } catch (e) {}
  });
  new MutationObserver(paintThemeBtn).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  paintThemeBtn();

  /* ---------- a soft tap when the visitor swaps a version ---------- */
  document.addEventListener('vk-swap', () => VikalpSound.play());

  /* ---------- hero: one word, its other versions pencilled above it ---------- */
  const heroAlts = document.getElementById('heroAlts');
  const paintAlts = span => {
    heroAlts.replaceChildren(...span.versions.flatMap((v, k) => {
      if (k === span.i) return [];
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.textContent = v.text;
      if (k === span.prev) b.className = 'was';
      b.addEventListener('click', e => { e.stopPropagation(); span.set(k); });
      return [b];
    }));
  };
  paintAlts(Vikalp.createSpan(document.getElementById('heroWord'), ['right', 'exact', 'plain', 'true'], { onChange: paintAlts }));

  /* ---------- the story's note ---------- */
  const noteHost = document.getElementById('storyNote');
  const story = Vikalp.createNote(noteHost, {
    title: 'The night bus',
    paragraphs: [
      [
        'We took the night bus', { strike: ' to Kanpur', level: 3 }, '. The seats were ',
        { versions: ['hard', 'narrow', 'thin'], kind: 'word', id: 'hard' },
        ', and the man beside me fell asleep on my shoulder', { strike: ' before we left the city', level: 2 }, '. ',
        { versions: ['I let him sleep.', 'I didn’t have the heart to wake him.'], kind: 'sentence', id: 'sleep' },
      ],
      [
        'Around two we stopped at a dhaba', { strike: ' by the highway', level: 1 }, ' for tea. ',
        { fade: 'The driver knew everyone there.', id: 'fade' },
        ' The tea was ', { strike: 'far ', level: 1 }, 'too sweet, and I drank two. ',
        { cut: 'A TV above the counter was showing an old cricket match.', id: 'tv' },
      ],
      [
        'We reached Kanpur ', { strike: 'just ', level: 1 }, 'before five. ',
        { lint: 'I sort of wanted', rule: 'Hedging', why: '“Sort of” softens what you mean.', fix: 'I wanted' },
        ' the ride to go on. ',
        { lint: 'My bag was handed down by the driver.', rule: 'Passive voice', why: 'Say who did it.', fix: 'The driver handed down my bag.' },
        ' ',
        { lint: 'It was a journey I will never forget.', rule: 'AI-sounding line', why: 'A stock closing line. It could end any travel story.' },
      ],
    ],
  });

  /* ---------- the story: each step makes one change to the note ---------- */
  const AI_VERSIONS = ['I stayed still and let him sleep.', 'I didn’t move until Unnao.'];

  // The order changes land in going forward; going back, they lift off in reverse.
  const ORDER = ['fade', 'cut', 'ai', 'lint', 'lab', 'clean'];
  const CHANGES = {
    fade: on => story.fade('fade', on),
    cut: (on, animate) => story.cut('tv', on, animate),
    ai: (on, animate) => (on ? story.addAI('sleep', AI_VERSIONS, animate) : story.removeAI('sleep')),
    lint: on => story.lint(on),
    lab: on => story.lab(on),
    clean: on => { story.setClean(on); return wait(400); },
  };

  // Each step, by its clip name: the change it makes, what it marks once the
  // change lands (blue for versions and AI, red for cuts), and in a narrow note
  // the paragraph it acts on and the panel section the tray shows.
  const inNote = sel => () => [...noteHost.querySelectorAll(sel)];
  const STEPS = {
    alternatives: {
      view: { paragraph: 0, tray: 'versions' },
      mark: { tone: 'blue', parts: () => [story.part('hard'), story.part('sleep')] },
    },
    ghost: {
      change: { fade: true },
      view: { paragraph: 1, tray: 'fade' },
      mark: { tone: 'red', parts: () => [story.part('fade')] },
    },
    overflow: {
      change: { cut: true },
      view: { paragraph: 1, tray: 'overflow' },
      mark: { tone: 'red', parts: inNote('.vk-caret, .vk-olist button') },
    },
    ai: {
      change: { ai: true },
      view: { paragraph: 0, tray: 'versions' },
      mark: { tone: 'blue', parts: () => [story.part('sleep'), ...inNote('.vk-list .d.ai')().map(d => d.closest('button'))] },
    },
    lint: {
      change: { lint: true },
      view: { paragraph: 2, tray: 'lint' },
      mark: { tone: 'blue', parts: inNote('.vk-lint.is-on') },
    },
    lab: {
      change: { lint: false, lab: true },
      view: { paragraph: 1, tray: 'lab' },
      mark: { tone: 'red', parts: inNote('.vk-strike.is-struck') },
    },
    read: {
      change: { clean: true },
      view: { paragraph: 1, tray: 'lab' },
    },
  };
  // Phones get four steps; the other three stay out of the page there.
  const LAYOUTS = {
    wide: ['alternatives', 'ghost', 'overflow', 'ai', 'lint', 'lab', 'read'],
    phone: ['alternatives', 'ghost', 'ai', 'lab'],
  };
  const steps = [...document.querySelectorAll('.step')];
  // The current layout's steps in order, each with the whole note state it leads to.
  function layout() {
    const names = LAYOUTS[narrow.matches ? 'phone' : 'wide'];
    steps.forEach(s => { s.hidden = !names.includes(s.dataset.clip); });
    let state = {};
    return names.map(name => {
      state = { ...state, ...STEPS[name].change };
      return { ...STEPS[name], state, el: steps.find(s => s.dataset.clip === name) };
    });
  }
  let plan = layout();

  // One change at a time. Going forward, a narrow note first turns to the
  // step's paragraph and then changes; going back, it changes and then turns.
  // Scrolling past several steps at once applies the skipped ones without
  // motion, so the note never plays catch-up.
  let target = -1, back = false, running = false;
  const applied = {};
  async function run(change, animate) {
    if (animate) return change(true);
    root.classList.add('vk-instant');
    await change(false);
    void noteHost.offsetHeight;
    root.classList.remove('vk-instant');
  }
  async function settle() {
    if (running) return;
    running = true;
    for (;;) {
      const want = plan[Math.max(0, target)].state;
      const differs = k => !!want[k] !== !!applied[k];
      const key = (back ? [...ORDER].reverse() : ORDER).find(differs);
      const animate = !reduced.matches && ORDER.filter(differs).length <= 1;
      if (!back || !key) await run(a => story.view(plan[Math.max(0, target)].view, a), animate);
      if (!key) break;
      applied[key] = !!want[key];
      await run(a => CHANGES[key](applied[key], a), animate);
      if (animate) await wait(80);
    }
    running = false;
    const m = plan[target]?.mark;
    if (m) story.mark(m.parts, m.tone);
  }

  /* ---------- which step is being read ---------- */
  const stage = document.getElementById('storyStage');
  const frame = noteHost.querySelector('.vk-frame');
  let active = -1, raf = 0;

  // Touch screens tap rather than click. Only text is rewritten, so icons in a hint stay.
  if (matchMedia('(hover: none)').matches) {
    document.querySelectorAll('.say-tap').forEach(p => {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) n.data = n.data.replace(/\bclick\b/g, 'tap').replace(/\bClick\b/g, 'Tap');
    });
  }

  // The phone caption: a copy of each phone step, stacked in one cell so the
  // caption keeps the tallest step's height. Only the active one shows. Above
  // them, a row of dots says which step this is and that more follow.
  const capSteps = LAYOUTS.phone.map(name => steps.find(s => s.dataset.clip === name));
  const captions = capSteps.map(step => {
    const c = document.createElement('div');
    c.className = 'story-cap';
    c.append(...[...step.children].map(n => n.cloneNode(true)));
    c.querySelector('.step-clip').tabIndex = -1;
    return c;
  });
  const progress = document.createElement('p');
  progress.className = 'story-progress';
  progress.innerHTML = capSteps.map(() => '<i></i>').join('') + '<span></span>';
  const dots = [...progress.querySelectorAll('i')];
  const paintProgress = k => {
    dots.forEach((d, n) => d.classList.toggle('on', n === k));
    progress.lastChild.textContent = `${k + 1} of ${capSteps.length}`;
  };
  document.getElementById('storyCaption').append(progress, ...captions);
  captions[0].classList.add('is-active');
  paintProgress(0);

  const el = k => plan[k].el;
  // A step is its text, heading through the "In Obsidian" line, not its tall box.
  const text = k => {
    const top = el(k).querySelector('h3').getBoundingClientRect().top;
    return { top, bottom: el(k).querySelector('.step-keys').getBoundingClientRect().bottom };
  };
  // On desktop, a step starts when its heading reaches the middle of the screen
  // going down, and the one before comes back when its last line comes down to
  // it going up. On narrow screens the steps are empty markers under the pinned
  // note: one starts when its top slides under the note, and ends when it comes
  // back out a little way, so a resting thumb never flips between two.
  function pick() {
    raf = 0;
    let i = Math.max(-1, active);
    const last = plan.length - 1;
    if (narrow.matches) {
      const line = stage.getBoundingClientRect().bottom;
      const top = k => el(k).getBoundingClientRect().top;
      while (i < last && top(i + 1) < line) i++;
      while (i >= 0 && top(i) > line + 24) i--;
    } else {
      const line = innerHeight * 0.5;
      while (i < last && text(i + 1).top < line) i++;
      while (i >= 0 && (i === 0 ? text(0).top > line : text(i - 1).bottom > line)) i--;
    }
    if (i === active) return;
    back = i < active;
    active = i;
    steps.forEach(s => s.classList.toggle('is-active', s === plan[i]?.el));
    const cap = Math.max(0, i);
    captions.forEach((c, k) => c.classList.toggle('is-active', k === cap));
    paintProgress(cap);
    target = i;
    story.mark(null);
    settle();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(pick); };

  // The note keeps one height through every step. On desktop it sits in the
  // middle of the screen; on phones CSS centres the note and caption together.
  function measure() {
    frame.style.minHeight = '';
    const h = frame.offsetHeight;
    frame.style.minHeight = h + 'px';
    stage.style.setProperty('--stage-top', Math.max(16, Math.round((innerHeight - h) / 2)) + 'px');
    stage.style.setProperty('--stage-h', stage.offsetHeight + 'px');
    schedule();
  }
  // Crossing the phone breakpoint swaps the step list; the note then settles
  // into the state of whichever step is on screen in the new list.
  narrow.addEventListener('change', () => {
    plan = layout();
    active = -2;
    measure();
  });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', measure);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(measure);
  measure();

  /* ---------- "See it in Obsidian": the real clip in a lightbox ---------- */
  const dialog = document.getElementById('clip');
  const video = document.getElementById('clipVideo');
  let clip = null;
  function loadClip(keepTime) {
    const t = keepTime ? video.currentTime : 0;
    video.poster = `media/${clip}-${theme()}-v3.jpg`;
    video.src = `media/${clip}-${theme()}-v3.mp4`;
    video.currentTime = t;
    video.play().catch(() => {});
  }
  steps.forEach(step => {
    const open = () => {
      clip = step.dataset.clip;
      document.getElementById('clipTitle').textContent = `${step.querySelector('h3').textContent}, in Obsidian`;
      dialog.showModal();
      loadClip(false);
    };
    const own = step.querySelector('.step-clip');
    own.addEventListener('click', open);
    const copy = captions[capSteps.indexOf(step)]?.querySelector('.step-clip');
    if (!copy) return;
    copy.addEventListener('click', open);
    // On narrow screens the step's own button is visually hidden, so its copy shows the focus.
    own.addEventListener('focus', () => copy.classList.toggle('is-focus', own.matches(':focus-visible')));
    own.addEventListener('blur', () => copy.classList.remove('is-focus'));
  });
  document.getElementById('clipClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { video.pause(); video.removeAttribute('src'); video.load(); clip = null; });
  new MutationObserver(() => { if (clip) loadClip(true); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- the tour: one play button, then the browser's own controls ----------
     The short and full tours were each recorded in Obsidian's light and dark
     themes; the page plays the one that matches its own theme. */
  const tour = document.getElementById('trailer');
  const tourFrame = tour.closest('.trailer-frame');
  const tourSrc = kind => `media/tour-${kind}-${theme()}-v1`;
  const paintPoster = () => { tour.poster = `media/tour-poster-${theme()}-v2.jpg`; };
  paintPoster();
  new MutationObserver(paintPoster).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  function playTour(kind) {
    const base = tourSrc(kind);
    if (tour.dataset.src !== base) {
      tour.dataset.src = base;
      tour.dataset.tour = kind;
      tour.src = base + '.mp4';
      tour.querySelector('track').src = base + '.vtt';
    }
    tourFrame.classList.add('is-playing');
    tour.controls = true;
    tour.play().catch(() => {});
  }
  document.getElementById('trailerPlay').addEventListener('click', () => playTour('short'));
  tour.addEventListener('click', () => { if (!tour.controls) playTour('short'); });
  document.getElementById('tourFull').addEventListener('click', () => {
    playTour('full');
    tourFrame.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'center' });
  });

  window.__story = { note: story, get steps() { return plan.map(p => p.el); }, active: () => active, settled: () => !running && target === active };
})();
