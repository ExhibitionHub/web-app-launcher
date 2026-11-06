/*
 * The quiz flow: attract screen, start, one question per artwork, answer reveal, final score, reset.
 * All content comes from config/quiz.json. All fixed texts come from lang/<code>.json.
 * What the visitor sees is built by screens.js.
 */
(function (K) {
  'use strict';

  var T = K.i18n;
  var V = K.screens;
  var stage = document.getElementById('stage');
  var DEFAULT_BRAND = { title: 'THE ART OF THE BRICK', short: 'ART OF THE BRICK', accent: 'CHALLENGE' };
  var HEARTBEAT_MS = 5000;
  var MAX_UPTIME_MS = 6 * 60 * 60 * 1000;

  var cfg = null;
  var art = [];
  var S = null;
  var gamesThisLoad = 0;

  /* ---------- helpers ---------- */

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search || '');
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* ---------- content ---------- */

  /** "brand" in quiz.json: { title, short, accent }. An older list of lines still works: the last line is the accent. */
  function brandOf(b) {
    if (Array.isArray(b) && b.length) {
      var main = b.length > 1 ? b.slice(0, -1).join(' ') : b[0];
      return { title: main, short: main, accent: b.length > 1 ? b[b.length - 1] : '' };
    }
    if (b && typeof b === 'object' && b.title) return { title: b.title, short: b.short || b.title, accent: b.accent || '' };
    return DEFAULT_BRAND;
  }

  function normalize(raw) {
    var kiosk = (raw && raw.kiosk) || {};
    var languages = Array.isArray(kiosk.languages) && kiosk.languages.length ? kiosk.languages : ['en'];
    // The App Hub (or "languages" in launcher.json) can narrow the language buttons: ?availableLangs=en,es,ca
    var allowed = String(param('availableLangs') || '')
      .toLowerCase()
      .split(',')
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    var kept = languages.filter(function (code) {
      return allowed.indexOf(code) >= 0;
    });
    if (kept.length) languages = kept;
    var out = {
      brand: brandOf(raw.brand),
      languages: languages,
      defaultLanguage: languages.indexOf(kiosk.defaultLanguage) >= 0 ? kiosk.defaultLanguage : languages[0],
      orientation: kiosk.orientation || 'auto',
      idleSeconds: Number(kiosk.idleSeconds) > 0 ? Number(kiosk.idleSeconds) : 60,
      reloadAfterGames: Number(kiosk.reloadAfterGames) > 0 ? Number(kiosk.reloadAfterGames) : 20,
      defaultSeed: raw.defaults && raw.defaults.seed ? raw.defaults.seed : null,
      results: Array.isArray(raw.results) ? raw.results.slice() : [],
    };
    out.results.sort(function (a, b) {
      return (b.minScore || 0) - (a.minScore || 0);
    });
    art = [];
    (raw.artworks || []).forEach(function (a, index) {
      var ok =
        a &&
        a.question &&
        Array.isArray(a.answers) &&
        a.answers.length >= 2 &&
        a.answers.length <= 6 &&
        Number.isInteger(a.correct) &&
        a.correct >= 0 &&
        a.correct < a.answers.length;
      if (!ok) {
        K.host.log('artwork ' + index + ' skipped: not complete');
        return;
      }
      art.push({
        id: String(a.id || 'art-' + index),
        image: a.image || '',
        bg: /^#[0-9a-fA-F]{3,8}$/.test(a.bg || '') ? a.bg : '',
        name: a.name || '',
        question: a.question,
        answers: a.answers,
        correct: a.correct,
        fact: a.fact || '',
        seed: a.seed || out.defaultSeed,
      });
    });
    return out;
  }

  function newState() {
    return { screen: 'attract', qi: 0, score: 0, results: [], picked: -1, popup: false, locked: false };
  }

  function applyOrientation() {
    var mode = String(param('orientation') || param('mode') || (cfg && cfg.orientation) || 'auto').toLowerCase();
    // the App Hub says "vertical" and "horizontal"; the launcher and the content file say "portrait" and "landscape"
    var wantsPortrait = mode === 'portrait' || mode === 'vertical';
    var wantsLandscape = mode === 'landscape' || mode === 'horizontal';
    var portrait = wantsPortrait || (!wantsLandscape && window.innerHeight > window.innerWidth);
    document.documentElement.classList.toggle('portrait', portrait);
  }

  /* ---------- render and flow ---------- */

  var FIT_STEPS = [1, 0.94, 0.88, 0.82, 0.76, 0.7];

  // Position on the page without the entrance animations (offsets ignore transforms).
  function pageBottom(el) {
    var y = 0;
    var node = el;
    while (node) {
      y += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return y + el.offsetHeight;
  }

  function bottomOf(el) {
    var own = pageBottom(el);
    var last = el.lastElementChild ? pageBottom(el.lastElementChild) : own;
    return Math.max(own, last);
  }

  /** Text comes from the content file, so its length is not known in advance: shrink it until everything is on screen. */
  function fitContent() {
    var roots = stage.querySelectorAll('[data-fit]');
    if (!roots.length) return;
    var rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    var limit = window.innerHeight - 1.6 * rem;
    for (var i = 0; i < FIT_STEPS.length; i++) {
      stage.style.setProperty('--fit', String(FIT_STEPS[i]));
      var fits = true;
      for (var j = 0; j < roots.length; j++) {
        if (bottomOf(roots[j]) > limit || roots[j].scrollWidth > roots[j].clientWidth + 2) fits = false;
      }
      if (fits) return;
    }
  }

  function render(animate) {
    V.stopLoop();
    stage.replaceChildren(V.build({ stage: stage, cfg: cfg, art: art, state: S }, animate));
    stage.setAttribute('data-screen', S.screen);
    if (K.bricks) K.bricks.show(stage);
    fitContent();
    if (S.screen === 'attract') V.startLoop();
    if (animate === true) K.touch.lockFor(420);
  }

  function go(screen) {
    S.screen = screen;
    render(true);
  }

  function reset() {
    S = newState();
    T.reset();
    render(true);
  }

  function startGame() {
    S.qi = 0;
    S.score = 0;
    S.results = [];
    S.picked = -1;
    S.popup = false;
    S.locked = false;
    go('question');
  }

  function answer(i) {
    var a = art[S.qi];
    if (!a || S.locked || S.screen !== 'question') return;
    S.locked = true;
    S.picked = i;
    S.popup = true;
    var ok = i === a.correct;
    S.results[S.qi] = ok;
    if (ok) S.score += 1;
    K.store.recordAnswer(a.id, ok);
    render('reveal');
    K.touch.lockFor(900);
  }

  /** CONTINUE on the pop-up: close it and show the story of the artwork. */
  function closePopup() {
    if (S.screen !== 'question' || S.picked < 0 || !S.popup) return;
    S.popup = false;
    render('continue');
    K.touch.lockFor(500);
  }

  function next() {
    if (S.screen !== 'question' || S.picked < 0 || S.popup) return;
    if (S.qi + 1 < art.length) {
      S.qi += 1;
      S.picked = -1;
      S.popup = false;
      S.locked = false;
      render(true);
    } else {
      K.store.recordGame();
      gamesThisLoad += 1;
      go('final');
    }
  }

  function onAction(el) {
    var action = el.getAttribute('data-action');
    if (action === 'enter' && S.screen === 'attract') go('welcome');
    else if (action === 'play' && S.screen === 'welcome') startGame();
    else if (action === 'answer') answer(Number(el.getAttribute('data-i')));
    else if (action === 'continue') closePopup();
    else if (action === 'next') next();
    else if (action === 'again' && S.screen === 'final') startGame();
    else if (action === 'home' && S.screen === 'final') reset();
    else if (action === 'lang') {
      if (T.setLang(el.getAttribute('data-lang'))) render(false);
    }
  }

  function maybeReload() {
    var tooManyGames = gamesThisLoad >= cfg.reloadAfterGames;
    var tooLong = window.performance && performance.now() > MAX_UPTIME_MS;
    if (S.screen === 'attract' && (tooManyGames || tooLong)) {
      K.lockdown.allowUnload();
      window.location.reload();
    }
  }

  function onIdle() {
    if (S.screen !== 'attract') reset();
    maybeReload();
  }

  /* ---------- start ---------- */

  function start(raw, bundle) {
    cfg = normalize(raw);
    T.init(bundle, cfg.languages, param('lang') || param('primaryLang') || cfg.defaultLanguage);
    if (param('lang') || param('primaryLang')) {
      // a language chosen outside the app becomes the language every visitor starts with
      cfg.defaultLanguage = T.lang();
    }
    K.store.init(K.host.initialStats);
    if (K.bricks) K.bricks.mount();
    applyOrientation();
    window.addEventListener('resize', applyOrientation);
    art.forEach(function (a) {
      var pre = new Image();
      pre.src = a.image || V.FALLBACK_IMAGE;
    });

    S = newState();
    window.addEventListener('resize', fitContent);
    K.touch.install(onAction);
    K.idle.start(cfg.idleSeconds, onIdle);
    render(true);
    setInterval(function () {
      K.host.heartbeat(S.screen);
    }, HEARTBEAT_MS);
    K.host.heartbeat(S.screen);
    document.documentElement.setAttribute('data-ready', '1');
  }

  /** Every bundled font face is loaded before the first screen, also the ones the first screen does not use. */
  function fontsReady() {
    var faces = [];
    if (document.fonts && document.fonts.forEach) {
      document.fonts.forEach(function (face) {
        faces.push(face.load().catch(function () {}));
      });
    }
    var ready = Promise.all(faces).then(function () {
      return document.fonts && document.fonts.ready;
    });
    var limit = new Promise(function (resolve) {
      setTimeout(resolve, 2500);
    });
    return Promise.race([ready, limit]);
  }

  function waitingScreen() {
    // content not readable yet: show only the logo, try again soon
    stage.replaceChildren(V.waiting(DEFAULT_BRAND));
    setTimeout(boot, 8000);
  }

  function boot() {
    K.lockdown.install();
    K.errors.install(function () {
      if (S) reset();
    });
    Promise.all([K.config.load('config/quiz.json', 'AOTB_CONFIG'), K.config.loadLang()])
      .then(function (r) {
        return fontsReady().then(function () {
          if (document.documentElement.getAttribute('data-ready')) return;
          start(r[0], r[1]);
        });
      })
      .catch(function (e) {
        K.host.log('content not loaded: ' + e);
        waitingScreen();
      });
  }

  boot();
})((window.Kiosk = window.Kiosk || {}));
