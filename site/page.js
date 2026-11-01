/* Page wiring: the theme toggle, the hero word, the scroll story and the clip lightbox. */
(() => {
  const root = document.documentElement;
  const theme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 860px)');
  const wait = d => new Promise(done => setTimeout(done, d));

  /* ---------- theme toggle ---------- */
  const themeLabel = document.getElementById('themeLabel');
  const paintThemeLabel = () => { themeLabel.textContent = theme() === 'dark' ? 'Light' : 'Dark'; };
  document.getElementById('themeBtn').addEventListener('click', () => {
    root.dataset.theme = theme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('vk-theme', root.dataset.theme); } catch (e) {}
  });
  new MutationObserver(paintThemeLabel).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  paintThemeLabel();

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
        { versions: ['hard', 'narrow', 'thin'], kind: 'word' },
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

  /* ---------- the story: each step is a state of the note ---------- */
  const AI_VERSIONS = ['I stayed still and let him sleep.', 'I didn’t move until Unnao.'];
  const STATES = [{}];
  const then = change => STATES.push({ ...STATES[STATES.length - 1], ...change });
  then({ fade: true });
  then({ cut: true });
  then({ ai: true });
  then({ lint: true });
  then({ lint: false, lab: true });
  then({ clean: true });

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

  // In a narrow note, the paragraph each step acts on and the panel section the tray shows.
  const VIEWS = [
    { paragraph: 0, tray: 'versions' },
    { paragraph: 1, tray: 'fade' },
    { paragraph: 1, tray: 'overflow' },
    { paragraph: 0, tray: 'versions' },
    { paragraph: 2, tray: 'lint' },
    { paragraph: 1, tray: 'lab' },
    { paragraph: 1, tray: 'lab' },
  ];

  // One change at a time. Going forward, a narrow note first turns to the
  // step's paragraph and then changes; going back, it changes and then turns.
  // Scrolling past several steps at once applies the skipped ones without
  // motion, so the note never plays catch-up.
  let target = 0, back = false, running = false;
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
      const want = STATES[target];
      const differs = k => !!want[k] !== !!applied[k];
      const key = (back ? [...ORDER].reverse() : ORDER).find(differs);
      const animate = !reduced.matches && ORDER.filter(differs).length <= 1;
      if (!back || !key) await run(a => story.view(VIEWS[target], a), animate);
      if (!key) break;
      applied[key] = !!want[key];
      await run(a => CHANGES[key](applied[key], a), animate);
      if (animate) await wait(80);
    }
    running = false;
  }

  /* ---------- which step is being read ---------- */
  const stage = document.getElementById('storyStage');
  const steps = [...document.querySelectorAll('.step')];
  const frame = noteHost.querySelector('.vk-frame');
  let active = 0, raf = 0;

  function readingLine() {
    if (!narrow.matches) return innerHeight * 0.55;
    const below = stage.getBoundingClientRect().bottom;
    return below + (innerHeight - below) * 0.4;
  }
  function pick() {
    raf = 0;
    const line = readingLine();
    let i = 0;
    steps.forEach((s, k) => { if (s.getBoundingClientRect().top < line) i = k; });
    if (i === active) return;
    back = i < active;
    active = i;
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    target = i;
    settle();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(pick); };

  // The note keeps one height through every step, and on desktop sits in the middle of the screen.
  function measure() {
    frame.style.minHeight = '';
    const h = frame.offsetHeight;
    frame.style.minHeight = h + 'px';
    stage.style.setProperty('--stage-top', Math.max(16, Math.round((innerHeight - h) / 2)) + 'px');
    stage.parentElement.style.setProperty('--stage-h', stage.offsetHeight + 'px');
    schedule();
  }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', measure);
  steps[0].classList.add('is-active');
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(measure);
  measure();

  if (matchMedia('(hover: none)').matches) {
    document.querySelectorAll('.step-try').forEach(p => { p.textContent = p.textContent.replace(/\bclick\b/g, 'tap'); });
  }

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
    step.querySelector('.step-clip').addEventListener('click', () => {
      clip = step.dataset.clip;
      document.getElementById('clipTitle').textContent = `${step.querySelector('h3').textContent}, in Obsidian`;
      dialog.showModal();
      loadClip(false);
    });
  });
  document.getElementById('clipClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { video.pause(); video.removeAttribute('src'); video.load(); clip = null; });
  new MutationObserver(() => { if (clip) loadClip(true); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  window.__story = { note: story, steps, active: () => active, settled: () => !running && target === active };
})();
