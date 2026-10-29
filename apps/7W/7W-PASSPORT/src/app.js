import { ERA_ORDER, WONDER_BY_ID, WONDERS } from './wonders.js';

const STORAGE_KEY = '7w-passport-progress-v1';
const STICKER_ASSET_VERSION = '20260420k';

const ASSET_PATHS = Object.freeze({
  goodStamp: './ressource/images/good.png',
});

const WONDER_STICKER_PATHS = Object.freeze({
  'machu-picchu': `./ressource/images/stick-machu.png?v=${STICKER_ASSET_VERSION}`,
  'great-wall': `./ressource/images/stick-mur.png?v=${STICKER_ASSET_VERSION}`,
  colosseum: `./ressource/images/stick-rome.png?v=${STICKER_ASSET_VERSION}`,
  'taj-mahal': `./ressource/images/stick-taj.png?v=${STICKER_ASSET_VERSION}`,
});

const WONDER_HERO_PHOTO_PATHS = Object.freeze({
  'great-wall': './ressource/images/photo-mur.png',
});

const DECOR_STICKER_PATHS = Object.freeze([
  `./ressource/images/stick-deco-01.png?v=${STICKER_ASSET_VERSION}`,
  `./ressource/images/stick-deco-02.png?v=${STICKER_ASSET_VERSION}`,
  `./ressource/images/stick-deco-03.png?v=${STICKER_ASSET_VERSION}`,
  `./ressource/images/stick-deco-04.png?v=${STICKER_ASSET_VERSION}`,
]);

const HOME_EXTRA_STICKER_PATHS = Object.freeze([
  `./ressource/images/stick-deco-05.png?v=${STICKER_ASSET_VERSION}`,
]);

const root = document.documentElement;
const app = document.getElementById('app');
const passportTracking = window.EHTracking
  ? window.EHTracking.createTracker({ exhibition: '7W', application: '7W-PASSPORT' })
  : null;

const state = {
  screen: 'home',
  activeEra: ERA_ORDER[0] || 'ancient',
  currentWonderId: WONDERS[0]?.id || '',
  answers: loadAnswers(),
};

init().catch(markError);

async function init() {
  if (window.i18n?.ready && typeof window.i18n.ready.then === 'function') {
    await window.i18n.ready;
  }

  bindEvents();
  syncOrientationMode();
  root.classList.add('is-ready');

  if (app) {
    app.setAttribute('aria-busy', 'false');
  }

  render();
}

function bindEvents() {
  if (!app) {
    return;
  }

  app.addEventListener('click', onAppClick);
  window.addEventListener('i18n:changed', render);
  window.addEventListener('resize', syncOrientationMode);
  window.addEventListener('orientationchange', syncOrientationMode);
}

function onAppClick(event) {
  const control = event.target.closest('[data-action]');
  if (!control) {
    return;
  }

  const action = control.getAttribute('data-action');
  if (!action) {
    return;
  }

  if (action === 'start') {
    if (passportTracking && !passportTracking.hasStarted()) {
      void passportTracking.start(0, {
        step: 'open-passport',
        language: window.i18n?.lang || '',
      });
    }

    state.screen = 'catalog';
    state.activeEra = state.activeEra || ERA_ORDER[0] || 'ancient';
    state.currentWonderId = getWondersForActiveEra()[0]?.id || WONDERS[0]?.id || '';
    render();
    return;
  }

  if (action === 'go-home') {
    passportTracking?.reset();
    state.screen = 'home';
    render();
    return;
  }

  if (action === 'go-catalog') {
    state.screen = 'catalog';
    render();
    return;
  }

  if (action === 'switch-era') {
    const era = control.getAttribute('data-era');
    if (!era || !ERA_ORDER.includes(era)) {
      return;
    }

    state.activeEra = era;
    const eraWonders = getWondersForActiveEra();
    if (!eraWonders.some((wonder) => wonder.id === state.currentWonderId)) {
      state.currentWonderId = eraWonders[0]?.id || state.currentWonderId;
    }
    render();
    return;
  }

  if (action === 'open-wonder') {
    const wonderId = control.getAttribute('data-wonder-id');
    if (!wonderId || !WONDER_BY_ID.has(wonderId)) {
      return;
    }

    state.currentWonderId = wonderId;
    state.activeEra = WONDER_BY_ID.get(wonderId)?.era || state.activeEra;
    state.screen = 'detail';
    render();
    return;
  }

  if (action === 'answer') {
    const wonder = getCurrentWonder();
    if (!wonder || isStamped(wonder.id)) {
      return;
    }

    const optionId = control.getAttribute('data-option-id');
    if (!optionId) {
      return;
    }

    state.answers[wonder.id] = optionId;
    saveAnswers();
    render();
    return;
  }

  if (action === 'open-next') {
    state.currentWonderId = getNextWonderId(state.currentWonderId);
    state.screen = 'detail';
    render();
  }
}

function syncOrientationMode() {
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  root.classList.toggle('is-landscape', isLandscape);
  root.classList.toggle('is-portrait', !isLandscape);

  const angle = Number(window.screen?.orientation?.angle ?? window.orientation ?? 0);
  const safeAngle = Number.isFinite(angle) ? angle : 0;
  root.style.setProperty('--phone-angle', String(safeAngle));
}

function render() {
  if (!app) {
    return;
  }

  app.innerHTML = renderScreen();
  window.i18n?.apply?.(app);
}

function renderScreen() {
  if (state.screen === 'catalog') {
    return renderCatalogScreen();
  }

  if (state.screen === 'detail') {
    return renderDetailScreen();
  }

  return renderHomeScreen();
}

function renderHomeScreen() {
  const stampedAncient = getStampedCountForEra('ancient');
  const stampedNew = getStampedCountForEra('new');
  const totalAncient = getWonderCountForEra('ancient');
  const totalNew = getWonderCountForEra('new');

  return `
    <section class="screen home-page">
      ${renderStickers('home')}

      <article class="title-banner">
        <p>${escapeHtml(t('home.bannerTop'))}</p>
        <p>${escapeHtml(t('home.bannerMiddle'))}</p>
        <p>${escapeHtml(t('home.bannerBottom'))}</p>
      </article>

      <div class="home-center-copy">
        <h1>${escapeHtml(t('home.welcomeTitle'))}</h1>
        <p>${escapeHtml(t('home.welcomeCopy'))}</p>
      </div>

      <div class="home-bottom-zone">
        <button class="cta-open-passport" type="button" data-action="start">${escapeHtml(t('home.start'))}</button>

        <p class="stamp-counter-title">${escapeHtml(t('home.progressTitle'))}</p>
        <div class="home-progress-grid">
          ${renderHomeProgressGroup(getEraLabel('ancient'), stampedAncient, totalAncient)}
          ${renderHomeProgressGroup(getEraLabel('new'), stampedNew, totalNew)}
        </div>
      </div>
    </section>
  `;
}

function renderCatalogScreen() {
  const eraWonders = getWondersForActiveEra();
  const stamped = getStampedCountForActiveEra();
  const total = getWonderCountForEra(state.activeEra);

  return `
    <section class="screen list-page">
      ${renderStickers('list')}

      <header class="list-topbar">
        <button class="mini-nav-btn" type="button" data-action="go-home">${escapeHtml(t('common.home'))}</button>
        <p class="list-title">${escapeHtml(t('catalog.listTitle'))}</p>
        <span class="era-progress">${formatEraProgress(state.activeEra, stamped, total)}</span>
      </header>

      <div class="era-switch">
        ${ERA_ORDER.map((era) => `
          <button
            type="button"
            class="era-switch__btn${state.activeEra === era ? ' is-active' : ''}"
            data-action="switch-era"
            data-era="${escapeHtml(era)}"
          >
            ${escapeHtml(getEraLabel(era, 'tab'))}
          </button>
        `).join('')}
      </div>

      <div class="wonder-tile-grid">
        ${eraWonders.map((wonder) => renderWonderTile(wonder)).join('')}
      </div>
    </section>
  `;
}

function renderWonderTile(wonder) {
  const stamped = isStamped(wonder.id);
  const stickerPath = getWonderStickerPath(wonder.id);
  const stickerJitter = getStickerJitter(wonder.id);
  const stickerMarkup = stickerPath
    ? `<img class="wonder-tile__sticker-img" style="--sticker-rotate:${escapeHtml(String(stickerJitter.rotateDeg))}deg; --sticker-shift-x:${escapeHtml(String(stickerJitter.shiftX))}; --sticker-shift-y:${escapeHtml(String(stickerJitter.shiftY))}; --sticker-scale:${escapeHtml(String(stickerJitter.scale))};" src="${escapeHtml(stickerPath)}" alt="" loading="lazy" decoding="async" />`
    : '<span class="wonder-tile__sticker-fallback">★</span>';
  const stampMarkup = stamped
    ? `<img class="wonder-tile__stamp-img" src="${escapeHtml(ASSET_PATHS.goodStamp)}" alt="" loading="lazy" decoding="async" />`
    : escapeHtml(wonder.stampCode);

  return `
    <button
      class="wonder-tile${stamped ? ' is-stamped' : ''}"
      type="button"
      data-action="open-wonder"
      data-wonder-id="${escapeHtml(wonder.id)}"
      style="--wonder-accent:${escapeHtml(wonder.accent)}"
    >
      <span class="wonder-tile__sticker" aria-hidden="true">${stickerMarkup}</span>
      <span class="wonder-tile__copy">
        <span class="wonder-tile__name">${escapeHtml(t(`wonders.${wonder.id}.name`))}</span>
        <span class="wonder-tile__location">${escapeHtml(t(`wonders.${wonder.id}.location`))}</span>
      </span>
      <span class="wonder-tile__stamp${stamped ? ' is-stamped' : ''}">${stampMarkup}</span>
    </button>
  `;
}

function renderDetailScreen() {
  const wonder = getCurrentWonder();
  if (!wonder) {
    state.screen = 'catalog';
    return renderCatalogScreen();
  }

  const selectedAnswer = state.answers[wonder.id] || '';
  const stamped = isStamped(wonder.id);
  const feedbackClass = stamped ? ' is-correct' : selectedAnswer ? ' is-incorrect' : '';
  const feedbackKey = stamped
    ? 'detail.correct'
    : selectedAnswer
      ? 'detail.incorrect'
      : 'detail.questionHint';
  const heroPhotoPath = getWonderHeroPhotoPath(wonder.id);
  const heroVisualClass = `wonder-hero-visual${heroPhotoPath ? ' has-photo' : ''}`;
  const heroPhotoMarkup = heroPhotoPath
    ? `<img class="wonder-hero-photo" src="${escapeHtml(heroPhotoPath)}" alt="" loading="lazy" decoding="async" />`
    : '';
  const stampStatusLabel = t(stamped ? 'detail.stampValidated' : 'detail.stampPending');
  const stampStatusIcon = stamped
    ? `<img class="stamp-state-pill__img" src="${escapeHtml(ASSET_PATHS.goodStamp)}" alt="" loading="lazy" decoding="async" />`
    : '';

  return `
    <section class="screen wonder-page" style="--wonder-accent:${escapeHtml(wonder.accent)}">
      ${renderStickers('wonder')}

      <header class="wonder-topbar">
        <button class="mini-nav-btn" type="button" data-action="go-catalog">${escapeHtml(t('detail.back'))}</button>
        <span class="wonder-era-chip">${escapeHtml(getEraLabel(wonder.era, 'chip'))}</span>
      </header>

      <article class="${heroVisualClass}">
        ${heroPhotoMarkup}
        <span class="wonder-hero-veil"></span>
        <p class="wonder-hero-title">${escapeHtml(t(`wonders.${wonder.id}.name`))}</p>
        <p class="wonder-hero-location">${escapeHtml(t(`wonders.${wonder.id}.location`))}</p>
      </article>

      <article class="wonder-info-copy">
        <p class="wonder-summary">${escapeHtml(t(`wonders.${wonder.id}.summary`))}</p>
        <p class="wonder-note">${escapeHtml(t(`wonders.${wonder.id}.passportNote`))}</p>
      </article>

      <section class="wonder-question-panel">
        <p class="question-title">${escapeHtml(t(`wonders.${wonder.id}.question.prompt`))}</p>
        <div class="answer-grid">
          ${wonder.options.map((optionId) => renderAnswerOption(wonder, optionId, selectedAnswer, stamped)).join('')}
        </div>
        <p class="question-feedback${feedbackClass}">${escapeHtml(t(feedbackKey))}</p>
      </section>

      <footer class="wonder-footer-actions">
        <span class="stamp-state-pill${stamped ? ' is-stamped' : ''}">${stampStatusIcon}<span>${stampStatusLabel}</span></span>
        ${stamped ? `<button class="next-wonder-btn" type="button" data-action="open-next">${escapeHtml(t('detail.next'))}</button>` : ''}
      </footer>
    </section>
  `;
}

function renderAnswerOption(wonder, optionId, selectedAnswer, stamped) {
  const isSelected = selectedAnswer === optionId;
  const isCorrect = wonder.correctOption === optionId;
  const classNames = [
    'answer-option',
    isSelected ? 'is-selected' : '',
    stamped && isCorrect ? 'is-correct' : '',
    stamped && !isCorrect ? 'is-locked' : '',
  ].filter(Boolean).join(' ');

  return `
    <button
      class="${classNames}"
      type="button"
      data-action="answer"
      data-option-id="${escapeHtml(optionId)}"
      style="--option-accent:${escapeHtml(wonder.accent)}"
      ${stamped ? 'disabled' : ''}
    >
      ${escapeHtml(t(`countries.${optionId}`))}
    </button>
  `;
}

function renderHomeDots(stampedCount) {
  return renderStampDots(stampedCount, 7);
}

function renderHomeProgressGroup(label, stampedCount, totalCount) {
  return `
    <div class="home-progress-group">
      <p class="home-progress-label">${escapeHtml(t('home.progressGroup', { era: label, current: stampedCount, total: totalCount }))}</p>
      <div class="stamp-dot-row" aria-hidden="true">
        ${renderStampDots(stampedCount, totalCount)}
      </div>
    </div>
  `;
}

function renderStampDots(stampedCount, totalCount) {
  return Array.from({ length: totalCount }, (_, index) => {
    const isFilled = index < stampedCount;
    return `<span class="stamp-dot${isFilled ? ' is-filled' : ''}"></span>`;
  }).join('');
}

function formatEraProgress(era, stampedCount, totalCount) {
  return t('catalog.progressCompact', {
    era: getEraLabel(era, 'compact'),
    current: stampedCount,
    total: totalCount,
  });
}

function getEraLabel(era, variant = 'short') {
  const isAncient = era === 'ancient';

  if (variant === 'compact') {
    return t(isAncient ? 'eras.ancientCompact' : 'eras.newCompact');
  }

  if (variant === 'tab') {
    return t(isAncient ? 'eras.ancientTab' : 'eras.newTab');
  }

  if (variant === 'chip') {
    return t(isAncient ? 'detail.ancientChip' : 'detail.newChip');
  }

  return t(isAncient ? 'eras.ancientShort' : 'eras.newShort');
}

function renderStickers(scope) {
  const scopeClass = escapeHtml(scope);

  const baseMarkup = DECOR_STICKER_PATHS.map((stickerPath, index) => {
    const stickerSlot = String.fromCharCode(97 + index);
    if (scope === 'home' && stickerSlot === 'b') {
      return '';
    }
    return `
      <span class="sticker sticker--${stickerSlot} sticker--${scopeClass}" aria-hidden="true">
        <img class="sticker__img" src="${escapeHtml(stickerPath)}" alt="" loading="lazy" decoding="async" />
      </span>
    `;
  }).join('');

  if (scope !== 'home') {
    return baseMarkup;
  }

  const extraMarkup = HOME_EXTRA_STICKER_PATHS.map((stickerPath, index) => {
    const stickerSlot = String.fromCharCode(101 + index);
    return `
      <span class="sticker sticker--${stickerSlot} sticker--${scopeClass}" aria-hidden="true">
        <img class="sticker__img" src="${escapeHtml(stickerPath)}" alt="" loading="lazy" decoding="async" />
      </span>
    `;
  }).join('');

  return `
    ${baseMarkup}
    ${extraMarkup}
  `;
}

function getStickerJitter(seed) {
  const source = String(seed || 'default');
  const rotateRnd = hashString(`${source}:rotate`) / 0xffffffff;
  const xRnd = hashString(`${source}:x`) / 0xffffffff;
  const yRnd = hashString(`${source}:y`) / 0xffffffff;
  const scaleRnd = hashString(`${source}:scale`) / 0xffffffff;

  return {
    rotateDeg: roundTo(mapRange(rotateRnd, -8.5, 8.5), 2),
    shiftX: roundTo(mapRange(xRnd, -4.5, 4.5), 2),
    shiftY: roundTo(mapRange(yRnd, -5.8, -0.8), 2),
    scale: roundTo(mapRange(scaleRnd, 0.96, 1.05), 3),
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mapRange(value, min, max) {
  return min + value * (max - min);
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function getWonderStickerPath(wonderId) {
  if (!wonderId) {
    return '';
  }

  return WONDER_STICKER_PATHS[wonderId] || '';
}

function getWonderHeroPhotoPath(wonderId) {
  if (!wonderId) {
    return '';
  }

  return WONDER_HERO_PHOTO_PATHS[wonderId] || '';
}

function getCurrentWonder() {
  return WONDER_BY_ID.get(state.currentWonderId) || WONDERS[0] || null;
}

function getWondersForActiveEra() {
  return WONDERS.filter((wonder) => wonder.era === state.activeEra);
}

function getWonderCountForEra(era) {
  return WONDERS.filter((wonder) => wonder.era === era).length;
}

function getStampedCountForEra(era) {
  return WONDERS.filter((wonder) => wonder.era === era && isStamped(wonder.id)).length;
}

function getStampedCountForActiveEra() {
  return getStampedCountForEra(state.activeEra);
}

function isStamped(wonderId) {
  const wonder = WONDER_BY_ID.get(wonderId);
  return Boolean(wonder && state.answers[wonderId] === wonder.correctOption);
}

function getNextWonderId(currentWonderId) {
  const eraWonders = getWondersForActiveEra();
  const sourceWonders = eraWonders.length ? eraWonders : WONDERS;
  const currentIndex = sourceWonders.findIndex((wonder) => wonder.id === currentWonderId);
  if (currentIndex === -1) {
    return sourceWonders[0]?.id || '';
  }

  const ordered = sourceWonders.slice(currentIndex + 1).concat(sourceWonders.slice(0, currentIndex + 1));
  const nextUnstamped = ordered.find((wonder) => wonder.id !== currentWonderId && !isStamped(wonder.id));

  if (nextUnstamped) {
    return nextUnstamped.id;
  }

  return ordered[0]?.id || currentWonderId;
}

function loadAnswers() {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([wonderId, optionId]) => WONDER_BY_ID.has(wonderId) && typeof optionId === 'string')
    );
  } catch {
    return {};
  }
}

function saveAnswers() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.answers));
  } catch {
  }
}

function t(key, vars) {
  if (window.i18n?.t) {
    return window.i18n.t(key, vars);
  }

  return key;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markError(error) {
  console.error('Unable to initialise 7W-PASSPORT.', error);
  root.classList.add('is-i18n-error');

  if (!app) {
    return;
  }

  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `
    <div class="screen error-screen">
      <section class="error-card">
        <p class="section-label">7W Passport</p>
        <h1>Unable to load the passport</h1>
        <p>Check the local language files and reload the page.</p>
      </section>
    </div>
  `;
}