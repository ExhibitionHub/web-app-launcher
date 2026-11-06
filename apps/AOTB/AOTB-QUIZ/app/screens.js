/*
 * The screens: builds what the visitor sees at each step (the look).
 * quiz.js owns the flow and asks for a screen with K.screens.build(view).
 * Keep the data-action, data-part and data-fit markers: see docs/DESIGN-CONTRACT.md.
 */
(function (K) {
  'use strict';

  var T = K.i18n;
  var FALLBACK_IMAGE = 'img/art/fallback.svg';
  var DECO = { blur: 'img/deco/brick-blur.webp', gold: 'img/deco/brick-gold.webp', dark: 'img/deco/brick-dark.webp' };
  var LETTERS = 'ABCDEF';
  var ATTRACT_STEP_MS = 3600;

  // what quiz.js gives at every build
  var stage = null;
  var cfg = null;
  var art = [];
  var S = null;

  var attractTimer = null;
  var attractStep = 0;

  /* ---------- small helpers ---------- */

  function h(tag, props, children) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  var ICONS = {
    check:
      '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    arrow:
      '<path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    back: '<path d="M20 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    bulb: '<path d="M9.2 17.5h5.6M10 20.5h4M12 3.2a6.2 6.2 0 0 0-3.7 11.2c.7.5 1 1.3 1 2.1v.4h5.4v-.4c0-.8.4-1.6 1-2.1A6.2 6.2 0 0 0 12 3.2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  function icon(name, cls) {
    var span = h('span', { class: 'icon' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' + ICONS[name] + '</svg>';
    return span;
  }

  function img(src, cls) {
    var el = h('img', { class: cls || '', 'data-part': 'artwork-img', alt: '', draggable: 'false' });
    el.onerror = function () {
      el.onerror = null;
      el.src = FALLBACK_IMAGE;
    };
    el.src = src || FALLBACK_IMAGE;
    return el;
  }

  /** A brick picture. With 3D on, vendor/bricks.js draws a live brick in its place (data-brick, data-soft). */
  function deco(name, cls) {
    return h('img', {
      class: 'deco ' + cls,
      src: DECO[name],
      alt: '',
      draggable: 'false',
      'aria-hidden': 'true',
      'data-brick': name,
      'data-soft': name === 'blur',
    });
  }

  /* ---------- building blocks ---------- */

  function title(size) {
    return h('div', { class: 'title title--' + size }, [
      h('span', { class: 'title-main', text: cfg.brand.title }),
      h('span', { class: 'title-accent', text: cfg.brand.accent }),
    ]);
  }

  function frame(a, caption) {
    var box = h('div', { class: 'frame', 'data-part': 'artwork' }, [img(a && a.image, 'frame-img')]);
    if (a && a.bg) box.style.background = a.bg; // colour behind a picture that is not square
    if (caption && a) box.appendChild(h('span', { class: 'frame-caption', text: T.pick(a.name) }));
    return box;
  }

  function langBar() {
    var current = T.lang();
    var buttons = cfg.languages.map(function (code) {
      var on = code === current;
      return h(
        'div',
        {
          class: 'lang' + (on ? ' is-on' : ''),
          role: 'button',
          'data-action': 'lang',
          'data-lang': code,
          'aria-pressed': on ? 'true' : 'false',
          'aria-label': T.t('lang.name', null, code),
          lang: code,
        },
        [h('span', { text: code.toUpperCase() })]
      );
    });
    return h('div', { class: 'langs', role: 'group', 'aria-label': T.t('lang.pick') }, buttons);
  }

  function topbar() {
    var welcome = S.screen === 'welcome';
    var brand = welcome
      ? h('div', { class: 'brand' })
      : h('div', { class: 'brand' }, [
          h('span', { class: 'brand-title', text: cfg.brand.short }),
          h('span', { class: 'brand-accent', text: cfg.brand.accent }),
        ]);
    var tagline = h('div', { class: 'tagline' }, [
      welcome ? deco('gold', 'tagline-brick') : null,
      h('span', { class: 'tagline-text', text: T.t('brand.tagline') }),
    ]);
    return h('header', { class: 'topbar' }, [brand, h('div', { class: 'topbar-end' }, [tagline, langBar()])]);
  }

  function progress() {
    var steps = art.map(function (a, i) {
      var state = 'todo';
      if (S.results[i] === true) state = 'right';
      else if (S.results[i] === false) state = 'wrong';
      else if (i === S.qi) state = 'now';
      return h('i', { class: 'step step--' + state, 'data-part': 'progress-step', 'data-state': state });
    });
    return h('div', { class: 'progress' }, [
      h('div', { class: 'counter', 'data-part': 'counter', text: T.t('question.counter', { i: S.qi + 1, n: art.length }) }),
      h('div', { class: 'steps', 'aria-hidden': 'true' }, steps),
    ]);
  }

  function button(label, action, variant, iconName, iconFirst) {
    var ic = iconName ? icon(iconName) : null;
    return h('div', { class: 'btn btn--' + variant, role: 'button', 'data-action': action }, [
      iconFirst ? ic : null,
      h('span', { class: 'btn-label', text: label }),
      iconFirst ? null : ic,
    ]);
  }

  /* ---------- attract ---------- */

  function cycle(key, part, cls) {
    return h(
      'span',
      { class: 'cycle ' + cls, 'data-part': part },
      cfg.languages.map(function (code, i) {
        return h('span', { 'data-on': i === 0, lang: code, text: T.t(key, null, code) });
      })
    );
  }

  function attractScreen() {
    var slides = h('div', { class: 'attract-art', 'data-part': 'attract-art', 'aria-hidden': 'true' });
    art.slice(0, 12).forEach(function (a, i) {
      var f = frame(a, true);
      if (i === 0) f.setAttribute('data-on', '');
      slides.appendChild(f);
    });
    var cta = h('div', { class: 'cta', role: 'button', 'data-part': 'attract-cta' }, [
      cycle('attract.touch', 'attract-touch', 'cycle--cta'),
      icon('arrow'),
    ]);
    return h('section', { class: 'screen attract', 'data-action': 'enter' }, [
      deco('blur', 'deco--blur'),
      deco('dark', 'deco--dark'),
      h('div', { class: 'attract-text' }, [
        title('lg'),
        h('p', { class: 'attract-sub' }, [cycle('attract.sub', 'attract-sub', 'cycle--sub')]),
        cta,
      ]),
      slides,
    ]);
  }

  function startAttractLoop() {
    stopAttractLoop();
    attractStep = 0;
    attractTimer = setInterval(function () {
      attractStep += 1;
      var subs = stage.querySelectorAll('.cycle--sub > span');
      var ctas = stage.querySelectorAll('.cycle--cta > span');
      var frames = stage.querySelectorAll('.attract-art .frame');
      var li = attractStep % Math.max(1, subs.length);
      for (var i = 0; i < subs.length; i++) {
        subs[i].toggleAttribute('data-on', i === li);
        if (ctas[i]) ctas[i].toggleAttribute('data-on', i === li);
      }
      if (frames.length) {
        var fi = attractStep % frames.length;
        for (var j = 0; j < frames.length; j++) frames[j].toggleAttribute('data-on', j === fi);
      }
    }, ATTRACT_STEP_MS);
  }

  function stopAttractLoop() {
    if (attractTimer) clearInterval(attractTimer);
    attractTimer = null;
  }

  /* ---------- welcome ---------- */

  function rulesText() {
    var sizes = art.map(function (a) {
      return a.answers.length;
    });
    var same = sizes.every(function (n) {
      return n === sizes[0];
    });
    return same ? T.t('welcome.rules', { n: art.length, k: sizes[0] }) : T.t('welcome.rulesMixed', { n: art.length });
  }

  function welcomeScreen() {
    return h('section', { class: 'screen welcome' }, [
      deco('blur', 'deco--blur'),
      h('div', { class: 'welcome-main', 'data-fit': '' }, [
        title('lg'),
        h('p', { class: 'lead', text: T.t('welcome.lead') }),
        h('p', { class: 'rules', 'data-part': 'rules', text: rulesText() }),
        h('p', { class: 'tip', text: T.t('welcome.tip') }),
        button(T.t('welcome.play'), 'play', 'gold', 'arrow'),
        deco('dark', 'deco--dark'),
      ]),
    ]);
  }

  /* ---------- question ---------- */

  /** revealed: the answer is given (no more taps). shown: right and wrong are drawn (after the pop-up). */
  function answerNode(a, i, revealed, shown) {
    var cls = 'answer';
    var state = null;
    var tag = null;
    var mark = null;
    if (revealed) {
      if (i === a.correct) {
        cls += ' is-right';
        state = 'right';
        tag = T.t('answer.correct');
        mark = icon('check', 'mark');
      } else if (i === S.picked) {
        cls += ' is-wrong';
        state = 'wrong';
        tag = T.t('answer.yours');
        mark = icon('cross', 'mark');
      } else {
        cls += ' is-dim';
        state = 'dim';
      }
      if (!shown) {
        cls = 'answer';
        tag = null;
        mark = null;
      }
    }
    return h(
      'div',
      { class: cls, role: 'button', 'data-part': 'answer', 'data-state': state, 'data-action': revealed ? false : 'answer', 'data-i': i },
      [
        h('span', { class: 'letter', 'data-part': 'letter', text: LETTERS.charAt(i) }),
        h('span', { class: 'a-text' }, [
          h('span', { class: 'a-main', text: T.pick(a.answers[i]) }),
          tag ? h('span', { class: 'a-tag', text: tag }) : null,
        ]),
        mark,
      ]
    );
  }

  function statNode(a) {
    var pct = K.store.percent(a.id, a.seed);
    if (pct == null) return null;
    return h('div', { class: 'stat' }, [
      h('div', { class: 'stat-pct', 'data-part': 'stat-pct', text: pct + '%' }),
      h('p', { class: 'stat-text', 'data-part': 'stat-text', text: T.t(pct < 50 ? 'stat.only' : 'stat.share', { pct: pct }) }),
    ]);
  }

  function factCard(a, animate) {
    var fact = T.pick(a.fact);
    var last = S.qi + 1 >= art.length;
    return h('div', { class: 'reveal' + (animate ? ' reveal--in' : ''), 'data-part': 'reveal' }, [
      h('div', { class: 'fact-card' }, [
        h('div', { class: 'fact-head' }, [icon('bulb', 'fact-icon'), h('h2', { class: 'fact-title', text: T.t('fact.title') })]),
        fact ? h('p', { class: 'fact-text', 'data-part': 'fact', text: fact }) : null,
      ]),
      button(T.t(last ? 'next.score' : 'next.question'), 'next', 'gold', 'arrow'),
    ]);
  }

  /** The same block, invisible and not touchable: keeps the room for the story so nothing moves when it appears. */
  function ghost(el) {
    el.classList.add('reveal--ghost');
    el.setAttribute('aria-hidden', 'true');
    [el].concat([].slice.call(el.querySelectorAll('*'))).forEach(function (n) {
      n.removeAttribute('data-action');
      n.removeAttribute('data-part');
    });
    return el;
  }

  function popup(a) {
    var ok = S.picked === a.correct;
    var text = ok ? T.t('popup.right') : T.t('popup.wrong', { letter: LETTERS.charAt(a.correct), answer: T.pick(a.answers[a.correct]) });
    return h('div', { class: 'veil' }, [
      h(
        'div',
        {
          class: 'popup popup--' + (ok ? 'right' : 'wrong'),
          'data-part': 'verdict',
          'data-result': ok ? 'right' : 'wrong',
          role: 'dialog',
        },
        [
          icon(ok ? 'check' : 'cross', 'popup-icon'),
          h('h2', { class: 'popup-title', text: T.t(ok ? 'feedback.right' : 'feedback.wrong') }),
          h('p', { class: 'popup-text', text: text }),
          statNode(a),
          button(T.t('popup.continue'), 'continue', 'gold', 'arrow'),
        ]
      ),
    ]);
  }

  function questionScreen(animate) {
    var a = art[S.qi];
    var revealed = S.picked >= 0;

    var main = h('div', { class: 'q-main' }, [
      h('h2', { class: 'q-name', text: T.pick(a.name) }),
      h('h1', { class: 'q-text', 'data-part': 'question', text: T.pick(a.question) }),
      h(
        'div',
        { class: 'answers', 'data-part': 'answers' },
        a.answers.map(function (_, i) {
          return answerNode(a, i, revealed, revealed && !S.popup);
        })
      ),
    ]);

    var foot =
      revealed && !S.popup
        ? h('div', { class: 'q-foot' }, [factCard(a, animate === 'continue')])
        : h('div', { class: 'q-foot' }, [
            revealed ? null : h('p', { class: 'hint', text: T.t('question.hint') }),
            ghost(factCard(a, false)),
          ]);

    return h('section', { class: 'screen question' + (revealed ? ' is-revealed' : '') }, [
      h('div', { class: 'q-page', 'data-fit': '' }, [
        progress(),
        h('div', { class: 'q-body' }, [h('div', { class: 'q-media' }, [frame(a)]), main]),
        foot,
      ]),
      revealed && S.popup ? popup(a) : null,
    ]);
  }

  /* ---------- final ---------- */

  function result(ratio) {
    for (var i = 0; i < cfg.results.length; i++) {
      if (ratio >= (cfg.results[i].minScore || 0)) return cfg.results[i];
    }
    return null;
  }

  function ring(score, n) {
    var pct = n ? Math.round((score / n) * 100) : 0;
    var box = h('div', { class: 'ring' });
    box.innerHTML =
      '<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">' +
      '<circle class="ring-track" cx="60" cy="60" r="52"/>' +
      (pct > 0 ? '<circle class="ring-fill" cx="60" cy="60" r="52" pathLength="100" style="--p:' + pct + '"/>' : '') +
      '</svg>';
    box.appendChild(h('div', { class: 'ring-num', 'data-part': 'score' }, [String(score), h('small', { text: '/' + n })]));
    return box;
  }

  function finalScreen() {
    var n = art.length;
    var r = result(n ? S.score / n : 0);
    return h('section', { class: 'screen final' }, [
      h('div', { class: 'final-main', 'data-fit': '' }, [
        h('h1', { class: 'final-title', text: T.t('final.title') }),
        h('div', { class: 'score-label', text: T.t('final.label') }),
        ring(S.score, n),
        r && r.title ? h('h2', { class: 'result-title', text: T.pick(r.title) }) : null,
        h('p', { class: 'msg', 'data-part': 'message', text: r ? T.pick(r.text) : '' }),
        h('p', { class: 'thanks', text: T.t('final.thanks') }),
        h('div', { class: 'btn-row' }, [
          button(T.t('final.home'), 'home', 'dark', 'back', true),
          button(T.t('final.again'), 'again', 'gold', 'arrow'),
        ]),
      ]),
    ]);
  }

  /* ---------- what quiz.js uses ---------- */

  /** view = { stage, cfg, art, state }. Gives back the whole page for the current screen. */
  function build(view, animate) {
    stage = view.stage;
    cfg = view.cfg;
    art = view.art;
    S = view.state;
    var body;
    if (S.screen === 'attract') body = attractScreen();
    else if (S.screen === 'welcome') body = welcomeScreen();
    else if (S.screen === 'question') body = questionScreen(animate);
    else body = finalScreen();

    if (animate === true) body.classList.add('screen-in');

    var page = document.createDocumentFragment();
    if (S.screen !== 'attract') page.appendChild(topbar());
    page.appendChild(body);
    return page;
  }

  /** Shown while the content cannot be read: only the title. */
  function waiting(brand) {
    cfg = cfg || { brand: brand };
    return h('section', { class: 'screen attract attract--waiting' }, [h('div', { class: 'attract-text' }, [title('lg')])]);
  }

  K.screens = {
    FALLBACK_IMAGE: FALLBACK_IMAGE,
    build: build,
    waiting: waiting,
    startLoop: startAttractLoop,
    stopLoop: stopAttractLoop,
  };
})((window.Kiosk = window.Kiosk || {}));
