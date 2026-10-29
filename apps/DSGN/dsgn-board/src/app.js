// DSGN Board — investigation app
const STATE = {
  data: null,
  answered: new Map(), // questionId -> { blame, correct }
  reviewedStations: new Set(), // stationIds completed by opening when no question exists
  currentStation: null,
  carIndex: 0,
  carImages: [],
  network: null,
  networkTab: null,
  networkTabAnswered: -1,
};

const KIOSK_BASE = { width: 1920, height: 1080 };
const APP_VERSION = 'final-feedback-flow-4';
const ANSWER_ANIMATION_MS = 1450;
const INACTIVITY_RESET_MS = 60000;
const STATION_QUESTION_ORDER = {
  network: ['q4', 'q2', 'q9', 'q10', 'q12'],
};
const QUESTION_EVIDENCE_INDEX = {
  light: { q3: 0, q16: 1 },
};
const LIGHT_SPECTRUM_CROSS_IMAGE = 'ressource/images/evidence/light/als-a-68.webp';
const TOXICOLOGY_FOLDERS = [
  { key: 'substance', image: 'ressource/images/board/folder-substance.webp', label: 'Substance folder' },
  { key: 'coroner', image: 'ressource/images/board/folder-coroner.webp', label: 'Coroner folder' },
];
const TOXICOLOGY_QUESTION_FOLDER = {
  q1: 'coroner',
  q8: 'substance',
  q13: 'coroner',
  q15: 'coroner',
};
const BOARD_SOURCE_PATHS = {
  stations: 'data/stations.json',
  localizedStations: (lang) => `lang/data/stations.${lang}.json`,
};

let inactivityTimer = null;
const PHONE_MAP_BASE = '../map-phone';
const NETWORK_MAP_CONFIG = {
  bounds: { north: 34.042, south: 33.985, west: -6.878, east: -6.818 },
  pinZoom: 1.05,
  pinOffsetX: -4,
  pinOffsetY: 23,
};
const NETWORK_PIN_FALLBACKS = {
  victim: { x: 67, y: 59.921 },
  police: { x: 57.2, y: 55.868 },
  karim: { x: 74, y: 52.737 },
};
const NETWORK_SOURCE_PATHS = {
  messages: 'data/messages.json',
  events: 'data/events.json',
  locations: 'data/locations.json',
  uiFlow: 'data/ui-flow.json',
  i18n: (lang) => `lang/${lang}.json`,
  localized: {
    messages: (lang) => `lang/data/messages.${lang}.json`,
    events: (lang) => `lang/data/events.${lang}.json`,
    locations: (lang) => `lang/data/locations.${lang}.json`,
    uiFlow: (lang) => `lang/data/ui-flow.${lang}.json`,
  },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const boardTracking = window.EHTracking
  ? window.EHTracking.createTracker({
      exhibition: 'DSGN',
      application: 'dsgn-board',
      getLanguage: () => getBoardLanguage(),
    })
  : null;

async function init() {
  syncKioskScale();
  window.addEventListener('resize', syncKioskScale, { passive: true });

  await waitForI18n();
  STATE.data = await loadBoardData();
  STATE.network = await loadNetworkSourceData();

  bindBoard();
  bindPopup();
  bindReveal();
  bindI18nRefresh();
  bindUtilityControls();
  bindInactivityReset();
  refreshTablet();
}

async function waitForI18n() {
  if (!window.i18n?.ready) return;
  try {
    await window.i18n.ready;
  } catch (err) {
    console.warn('[dsgn-board] i18n failed, using inline English fallbacks', err);
  }
}

async function loadBoardData() {
  const lang = getBoardLanguage();
  const base = await fetchJson(BOARD_SOURCE_PATHS.stations);
  if (!lang || lang === 'en') return base;

  const localized = await fetchJson(BOARD_SOURCE_PATHS.localizedStations(lang), { optional: true });
  return localized ? mergeDeep(base, localized) : base;
}

async function fetchJson(path, { optional = false } = {}) {
  const url = `${path}?v=${APP_VERSION}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      if (optional) return null;
      throw new Error(`${res.status} ${url}`);
    }
    return await res.json();
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}

function bindI18nRefresh() {
  window.addEventListener('i18n:changed', () => {
    updateLanguageControls();
    void reloadLocalizedContent().catch((err) => {
      console.error('[dsgn-board] language refresh failed', err);
    });
  });
}

function bindUtilityControls() {
  $('#goHome')?.addEventListener('click', () => goHome());

  $$('[data-lang-option]').forEach((button) => {
    button.addEventListener('click', () => {
      void setBoardLanguage(button.dataset.langOption);
    });
  });

  updateLanguageControls();
}

async function setBoardLanguage(lang) {
  const nextLang = String(lang || '').toLowerCase();
  if (!nextLang || nextLang === getBoardLanguage()) {
    updateLanguageControls();
    return;
  }

  try {
    await window.i18n?.setLang(nextLang);
  } catch (err) {
    console.error('[dsgn-board] language switch failed', err);
  } finally {
    resetInactivityTimer();
  }
}

function updateLanguageControls() {
  const currentLang = getBoardLanguage();
  $$('[data-lang-option]').forEach((button) => {
    const active = button.dataset.langOption === currentLang;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function bindInactivityReset() {
  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, resetInactivityTimer, { capture: true, passive: true });
  });
  resetInactivityTimer();
}

function resetInactivityTimer() {
  window.clearTimeout(inactivityTimer);
  inactivityTimer = window.setTimeout(() => resetSession({ reason: 'idle' }), INACTIVITY_RESET_MS);
}

function goHome() {
  resetSession({ reason: 'home' });
}

function resetSession({ reason = 'manual' } = {}) {
  boardTracking?.reset();
  STATE.answered.clear();
  STATE.reviewedStations.clear();
  STATE.currentStation = null;
  STATE.carIndex = 0;
  STATE.carImages = [];
  STATE.networkTab = null;
  STATE.networkTabAnswered = -1;

  closePopup();
  $('#reveal')?.setAttribute('hidden', '');
  $$('.answer-particle').forEach((particle) => particle.remove());
  $$('.obj.is-activated').forEach((obj) => obj.classList.remove('is-activated'));

  refreshTablet();
  if (reason === 'idle') {
    $('#boardHint').textContent = boardText('ui.hints.idleReset', 'Session reset after inactivity.');
  }
  resetInactivityTimer();
}

async function reloadLocalizedContent() {
  const currentStationId = STATE.currentStation?.id || null;
  STATE.data = await loadBoardData();
  STATE.network = await loadNetworkSourceData();

  if (currentStationId) {
    const station = stationById(currentStationId);
    STATE.currentStation = station || null;
    if (station) {
      renderStationCopy(station);
      updatePopupMode(currentStationId);
      renderCarousel();
      renderQuestions(currentStationId);
    }
  }

  refreshTablet();
}

async function loadNetworkSourceData() {
  const lang = getBoardLanguage();
  const [messages, events, locations, uiFlow, text] = await Promise.all([
    loadPhoneMapData('messages', lang),
    loadPhoneMapData('events', lang),
    loadPhoneMapData('locations', lang),
    loadPhoneMapData('uiFlow', lang),
    fetchJsonFromPhoneMap(NETWORK_SOURCE_PATHS.i18n(lang), { optional: true })
      .then((data) => data || fetchJsonFromPhoneMap(NETWORK_SOURCE_PATHS.i18n('en'), { optional: true })),
  ]);

  return {
    lang,
    mapImage: `${PHONE_MAP_BASE}/ressource/images/map-rabat.png`,
    messages: messages || {},
    events: events || {},
    locations: locations || {},
    uiFlow: uiFlow || {},
    text: text || {},
  };
}

async function loadPhoneMapData(key, lang) {
  const base = await fetchJsonFromPhoneMap(NETWORK_SOURCE_PATHS[key], { optional: true }) || {};
  if (!lang || lang === 'en') return base;
  const localizedPath = NETWORK_SOURCE_PATHS.localized[key]?.(lang);
  if (!localizedPath) return base;
  const localized = await fetchJsonFromPhoneMap(localizedPath, { optional: true });
  return localized ? mergeDeep(base, localized) : base;
}

async function fetchJsonFromPhoneMap(path, { optional = false } = {}) {
  const url = `${PHONE_MAP_BASE}/${path}?v=${APP_VERSION}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      if (optional) return null;
      throw new Error(`${res.status} ${url}`);
    }
    return await res.json();
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}

function getBoardLanguage() {
  return (window.i18n?.lang || document.documentElement.lang || $('meta[name="i18n-default-lang"]')?.content || 'en').toLowerCase().split('-')[0];
}

function mergeDeep(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    if (!Array.isArray(base) || !Array.isArray(override)) return override === undefined ? base : override;
    if (canMergeArrayById(base, override)) {
      const overridesById = new Map(override.map((item) => [item.id, item]));
      return base.map((item) => overridesById.has(item.id) ? mergeDeep(item, overridesById.get(item.id)) : item);
    }
    if (base.every(isPlainObject) && override.every(isPlainObject)) {
      return base.map((item, index) => override[index] ? mergeDeep(item, override[index]) : item);
    }
    return override;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const merged = { ...base };
  Object.keys(override).forEach((key) => {
    merged[key] = mergeDeep(base[key], override[key]);
  });
  return merged;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canMergeArrayById(base, override) {
  return base.every((item) => isPlainObject(item) && Object.prototype.hasOwnProperty.call(item, 'id'))
    && override.every((item) => isPlainObject(item) && Object.prototype.hasOwnProperty.call(item, 'id'));
}

function syncKioskScale() {
  const scale = Math.min(window.innerWidth / KIOSK_BASE.width, window.innerHeight / KIOSK_BASE.height);
  document.documentElement.style.setProperty('--kiosk-scale', Math.max(scale, 0.1).toFixed(4));
}

function bindBoard() {
  $$('.obj[data-station]').forEach((btn) => {
    btn.addEventListener('click', () => openStation(btn.dataset.station));
  });
}

function isStationComplete(stationId) {
  const qs = questionsFor(stationId);
  return qs.length ? qs.every((q) => STATE.answered.has(q.id)) : STATE.reviewedStations.has(stationId);
}

function refreshStationAura() {
  $$('.obj[data-station]').forEach((btn) => {
    const done = isStationComplete(btn.dataset.station);
    btn.classList.toggle('is-complete', done);
    btn.classList.toggle('is-pending', !done);
  });
}

function stationById(id) {
  return STATE.data.stations.find((s) => s.id === id);
}

function questionsFor(stationId) {
  const questions = STATE.data.questions.filter((q) => q.stationId === stationId);
  const preferredOrder = STATION_QUESTION_ORDER[stationId];
  if (!preferredOrder) return questions;

  const orderIndex = new Map(preferredOrder.map((id, index) => [id, index]));
  return questions.slice().sort((a, b) => {
    const aIndex = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

function questionlessStations() {
  return STATE.data.stations.filter((s) => !questionsFor(s.id).length);
}

function completionProgress() {
  const noQuestionDone = questionlessStations().filter((s) => STATE.reviewedStations.has(s.id)).length;
  const total = STATE.data.questions.length + questionlessStations().length;
  return { completed: STATE.answered.size + noQuestionDone, total };
}

function openStation(stationId) {
  const station = stationById(stationId);
  if (!station) return;

  if (boardTracking && !boardTracking.hasStarted()) {
    void boardTracking.start(0, {
      step: 'station-open',
      language: getBoardLanguage(),
    });
  }

  pulseStationObject(stationId);

  STATE.currentStation = station;
  STATE.carImages = (station.evidence || []).slice();
  STATE.carIndex = 0;

  renderStationCopy(station);

  if (!questionsFor(stationId).length) {
    STATE.reviewedStations.add(stationId);
  }

  updatePopupMode(stationId);
  renderCarousel();
  renderQuestions(stationId);
  refreshTablet();

  const popup = $('#popup');
  $('.board')?.classList.add('has-popup');
  popup.hidden = false;
  popup.setAttribute('aria-hidden', 'false');
  syncTabletPreview();
  animateEvidenceEntrance(stationId);
}

function renderStationCopy(station) {
  $('#popupKicker').textContent = station.kicker || boardText('ui.popup.evidenceKicker', 'EVIDENCE');
  $('#popupTitle').textContent = station.title;
  $('#popupConclusion').textContent = station.conclusion;
}

function closePopup() {
  const popup = $('#popup');
  popup.hidden = true;
  popup.setAttribute('aria-hidden', 'true');
  $('.board')?.classList.remove('has-popup');
  $('#tabletPreviewMount').innerHTML = '';
  STATE.currentStation = null;
  $('.popup-card')?.classList.remove('is-network', 'is-toxicology', 'is-fingerprints', 'is-floating-evidence', 'station-complete');
  const conclusion = $('.popup-conclusion');
  conclusion?.classList.add('is-hidden');
  conclusion?.setAttribute('aria-hidden', 'true');
}

function renderCarousel() {
  const evidence = $('.popup-evidence');
  const card = $('.popup-card');
  const carousel = $('#carousel');
  const networkStage = $('#networkStage');
  const img = $('#carImg');
  const dots = $('#carDots');
  const prev = $('#carPrev');
  const next = $('#carNext');

  if (STATE.currentStation?.id === 'network') {
    renderNetworkEvidence();
    return;
  }

  if (STATE.currentStation?.id === 'toxicology') {
    renderToxicologyEvidence();
    return;
  }

  const displayImages = carouselImagesForCurrentStation();
  const hasImages = displayImages.length > 0;
  if (STATE.carIndex >= displayImages.length) STATE.carIndex = 0;
  evidence.hidden = !hasImages;
  card.classList.toggle('has-no-evidence', !hasImages);
  carousel.hidden = false;
  networkStage.hidden = true;
  networkStage.className = 'network-stage';
  dots.hidden = displayImages.length <= 1;
  prev.hidden = displayImages.length <= 1;
  next.hidden = displayImages.length <= 1;
  dots.innerHTML = '';
  if (!hasImages) {
    img.removeAttribute('src');
    return;
  }

  const nextSrc = displayImages[STATE.carIndex];
  if (nextSrc) img.src = nextSrc;
  else img.removeAttribute('src');
  displayImages.forEach((_, i) => {
    const d = document.createElement('button');
    d.className = 'dot' + (i === STATE.carIndex ? ' is-active' : '');
    d.setAttribute('aria-label', boardText('ui.carousel.imageLabel', `Image ${i + 1}`, { number: i + 1 }));
    d.addEventListener('click', () => { STATE.carIndex = i; renderCarousel(); });
    dots.appendChild(d);
  });
}

function carouselImagesForCurrentStation() {
  const stationId = STATE.currentStation?.id;
  const baseImages = STATE.carImages.slice();
  const activeQuestion = activeQuestionForStation(stationId);

  if (stationId === 'light' && activeQuestion) {
    const index = QUESTION_EVIDENCE_INDEX.light?.[activeQuestion.id];
    if (Number.isInteger(index) && baseImages[index]) return [baseImages[index]];
  }

  if (stationId === 'fingerprints' && activeQuestion?.id === 'q7') {
    return [LIGHT_SPECTRUM_CROSS_IMAGE, ...baseImages];
  }

  return baseImages;
}

function renderToxicologyEvidence() {
  const evidence = $('.popup-evidence');
  const card = $('.popup-card');
  const carousel = $('#carousel');
  const networkStage = $('#networkStage');
  const dots = $('#carDots');
  const img = $('#carImg');
  const activeQuestion = activeQuestionForStation('toxicology');
  const activeFolder = activeQuestion ? TOXICOLOGY_QUESTION_FOLDER[activeQuestion.id] : null;

  evidence.hidden = false;
  card.classList.remove('has-no-evidence');
  carousel.hidden = true;
  dots.hidden = true;
  dots.innerHTML = '';
  img.removeAttribute('src');
  networkStage.hidden = false;
  networkStage.className = [
    'network-stage',
    'toxicology-stage',
    activeFolder ? `is-${activeFolder}-active` : 'is-complete',
  ].join(' ');

  networkStage.innerHTML = `
    <div class="toxicology-folders" aria-hidden="true">
      ${TOXICOLOGY_FOLDERS.map((folder) => renderToxicologyFolder(folder, activeFolder)).join('')}
    </div>
  `;
}

function animateEvidenceEntrance(stationId) {
  if (!shouldFloatEvidence(stationId)) return;

  const source = measureStationObject(stationId);
  if (!source) return;

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (STATE.currentStation?.id !== stationId) return;

      if (stationId === 'toxicology') {
        syncToxicologyFolderScale(source);
        return;
      }

      const img = $('#carImg');
      if (!img || !img.getAttribute('src')) return;

      const run = () => {
        if (STATE.currentStation?.id !== stationId) return;
        playEvidenceImageEntrance(img, source);
      };

      if (img.complete) run();
      else img.addEventListener('load', run, { once: true });
    });
  });
}

function shouldFloatEvidence(stationId) {
  const station = stationById(stationId);
  if (!stationId || stationId === 'network') return false;
  return stationId === 'toxicology' || (Array.isArray(station?.evidence) && station.evidence.length > 0);
}

function measureStationObject(stationId) {
  const el = $(`.obj[data-station="${stationId}"]`);
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  return {
    rect,
    centerX: rect.left + rect.width * 0.5,
    centerY: rect.top + rect.height * 0.5,
    rotation: getComputedStyle(el).getPropertyValue('--rot').trim() || '0deg',
  };
}

function playEvidenceImageEntrance(img, source) {
  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  const scale = clampNumber(Math.min(source.rect.width / rect.width, source.rect.height / rect.height), 0.24, 1);

  img.style.setProperty('--evidence-from-x', `${(source.centerX - centerX).toFixed(2)}px`);
  img.style.setProperty('--evidence-from-y', `${(source.centerY - centerY).toFixed(2)}px`);
  img.style.setProperty('--evidence-from-scale', scale.toFixed(3));
  img.style.setProperty('--evidence-from-rotate', source.rotation);

  img.classList.remove('is-entering');
  void img.offsetWidth;
  img.classList.add('is-entering');

  window.setTimeout(() => {
    img.classList.remove('is-entering');
  }, 860);
}

function syncToxicologyFolderScale(source) {
  const stage = $('#networkStage');
  if (!stage) return;

  const stageRect = stage.getBoundingClientRect();
  if (!stageRect.width) return;

  const desiredWidth = clampNumber(source.rect.width * 1.45, 340, stageRect.width * 0.84);
  stage.style.setProperty('--toxicology-source-width', `${desiredWidth.toFixed(2)}px`);
}

function renderToxicologyFolder(folder, activeFolder) {
  const active = activeFolder === folder.key;
  const classes = ['toxicology-folder', `toxicology-folder--${folder.key}`, active ? 'is-active' : ''].filter(Boolean).join(' ');
  return `
    <div class="${classes}" data-toxicology-folder="${escapeHtml(folder.key)}">
      <img src="${escapeHtml(folder.image)}" alt="${escapeHtml(folder.label)}" />
    </div>
  `;
}

function renderNetworkEvidence() {
  const evidence = $('.popup-evidence');
  const card = $('.popup-card');
  const carousel = $('#carousel');
  const networkStage = $('#networkStage');
  const dots = $('#carDots');
  const img = $('#carImg');
  const { answered, total, complete } = stationQuestionProgress('network');
  const faradayAnswered = STATE.answered.has('q4');
  const motiveAnswered = STATE.answered.has('q2');
  const activeQuestionId = activeQuestionForStation('network')?.id || null;
  const mapBlurred = !faradayAnswered;
  const showDeletion = faradayAnswered;
  const showMessages = faradayAnswered;
  const tabs = getNetworkTabs({ mapBlurred, showDeletion, showMessages });
  const activeTab = syncNetworkTab(answered, tabs, activeQuestionId);

  evidence.hidden = false;
  card.classList.remove('has-no-evidence');
  carousel.hidden = true;
  dots.hidden = true;
  dots.innerHTML = '';
  img.removeAttribute('src');
  networkStage.hidden = false;
  networkStage.className = [
    'network-stage',
    mapBlurred ? 'is-map-blurred' : '',
    showDeletion && activeTab === 'map' ? 'is-map-revealed' : '',
    showDeletion ? 'has-deletion' : '',
    showMessages ? 'has-messages' : '',
    `is-${activeTab}`,
    complete ? 'is-complete' : '',
  ].filter(Boolean).join(' ');

  networkStage.innerHTML = `
    <header class="network-head">
      <div>
        <p class="kicker">${escapeHtml(boardText('ui.network.kicker', 'DIGITAL EVIDENCE'))}</p>
        <h3>${escapeHtml(getNetworkTabTitle(activeTab))}</h3>
      </div>
      <p class="network-progress">${Math.min(answered, total)} / ${total}</p>
    </header>
    ${renderNetworkTabs(tabs, activeTab)}
    <section class="network-panel network-panel--${escapeHtml(activeTab)}">
      ${renderNetworkPanel(activeTab, { mapBlurred, showDeletion, activeQuestionId })}
    </section>
  `;

  bindNetworkTabs(networkStage, answered);
}

function getNetworkTabs({ mapBlurred, showDeletion, showMessages }) {
  const tabs = [
    {
      key: 'map',
      label: networkText('sources.cellular.label', 'Cell Map'),
      status: mapBlurred ? boardText('ui.network.status.locked', 'LOCKED') : boardText('ui.network.status.located', 'LOCATED'),
    },
  ];

  if (showDeletion) {
    tabs.push({
      key: 'google',
      label: networkText('sources.google.label', 'Google'),
      status: networkText('evidenceUi.status.blocked', 'BLOCKED'),
    });
  }

  if (showMessages) {
    tabs.push({
      key: 'messages',
      label: networkText('sources.conversations.label', 'Messages'),
      status: networkText('evidenceUi.status.extracted', 'EXTRACTED'),
    });
  }

  return tabs;
}

function syncNetworkTab(answered, tabs, activeQuestionId = null) {
  const tabKeys = tabs.map((tab) => tab.key);
  const preferred = activeQuestionId === 'q2' || activeQuestionId === 'q10'
    ? 'messages'
    : activeQuestionId === 'q9' || activeQuestionId === 'q12'
      ? 'google'
      : STATE.answered.has('q4') ? 'map' : (tabKeys[0] || 'map');
  const recommended = tabKeys.includes(preferred) ? preferred : (tabKeys[0] || 'map');

  if (STATE.networkTabAnswered !== answered || !tabKeys.includes(STATE.networkTab)) {
    STATE.networkTab = recommended;
    STATE.networkTabAnswered = answered;
  }

  return STATE.networkTab || recommended;
}

function getNetworkTabTitle(tabKey) {
  if (tabKey === 'google') return networkText('evidenceUi.google.tagTitle', 'Google Account — Remote Activity Log');
  if (tabKey === 'messages') return networkText('sources.conversations.label', 'Conversations');
  return networkText('analysis.map.title', 'Rabat reconstruction');
}

function renderNetworkTabs(tabs, activeTab) {
  return `
    <div class="network-tabs" role="tablist" aria-label="${escapeHtml(boardText('ui.network.tabsAriaLabel', 'Digital evidence source'))}">
      ${tabs.map((tab, index) => `
        <button class="network-tab network-tab--${escapeHtml(tab.key)}${tab.key === activeTab ? ' is-active' : ''}"
                type="button"
                role="tab"
                aria-selected="${tab.key === activeTab}"
                data-network-tab="${escapeHtml(tab.key)}">
          <span class="network-tab__index">${String(index + 1).padStart(2, '0')}</span>
          <span class="network-tab__copy">
            <strong>${escapeHtml(tab.label)}</strong>
            <small>${escapeHtml(tab.status)}</small>
          </span>
          <span class="network-tab__status" aria-hidden="true"></span>
        </button>
      `).join('')}
    </div>
  `;
}

function renderNetworkPanel(activeTab, { mapBlurred, showDeletion, activeQuestionId }) {
  if (activeTab === 'google') return renderNetworkGooglePanel();
  if (activeTab === 'messages') return renderNetworkThreads(activeQuestionId);
  return renderNetworkMapPanel({ mapBlurred, showDeletion });
}

function bindNetworkTabs(networkStage, answered) {
  networkStage.querySelectorAll('[data-network-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      STATE.networkTab = button.dataset.networkTab;
      STATE.networkTabAnswered = answered;
      renderNetworkEvidence();
    });
  });
}

function renderNetworkMapPanel({ mapBlurred, showDeletion }) {
  return `
    <div class="network-map-panel${mapBlurred ? ' has-lock-note' : ''}">
      <div class="network-map">
      <img src="${escapeHtml(STATE.network?.mapImage || `${PHONE_MAP_BASE}/ressource/images/map-rabat.png`)}" alt="${escapeHtml(networkText('analysis.map.ariaLabel', 'Forensic map of Rabat'))}" />
      <div class="network-map-pins" aria-hidden="true">
        ${renderNetworkMapPins(showDeletion)}
      </div>
      <div class="network-lock">${escapeHtml(boardText('ui.network.mapLocked', 'MAP LOCKED'))}</div>
      <div class="network-alert">${escapeHtml(networkText('evidenceUi.status.blocked', 'BLOCKED'))} — ${escapeHtml(networkText('evidenceUi.google.rows.resetTitle', 'Remote factory reset'))}</div>
      </div>
      ${mapBlurred ? renderNetworkLockedPanel() : ''}
    </div>
  `;
}

function renderNetworkMapPins(showDeletion) {
  const locations = STATE.network?.locations?.locations || {};
  const victim = locations.victimHouse || {};
  const police = locations.policeStation || {};
  const karim = locations.karimLocation || {};
  const pins = [
    { key: 'victim', label: victim.name || boardText('ui.network.pins.victim.label', 'Victim House'), context: victim.context || boardText('ui.network.pins.victim.context', 'Medina district'), ...networkPinPoint(victim, 'victim') },
    { key: 'police', label: police.name || boardText('ui.network.pins.police.label', 'Police Station'), context: police.context || boardText('ui.network.pins.police.context', 'Commissariat Central'), ...networkPinPoint(police, 'police') },
    { key: 'karim', label: karim.name || boardText('ui.network.pins.karim.label', 'Karim Last Known'), context: karim.context || boardText('ui.network.pins.karim.context', 'Hassan district'), ...networkPinPoint(karim, 'karim'), hidden: !showDeletion },
  ];

  return pins.filter((pin) => !pin.hidden).map((pin) => `
    <div class="network-pin network-pin--${escapeHtml(pin.key)}" style="--pin-x:${escapeHtml(pin.x)}%; --pin-y:${escapeHtml(pin.y)}%">
      <span class="network-pin__dot"></span>
      <span class="network-pin__label">
        <strong>${escapeHtml(pin.label)}</strong>
        <small>${escapeHtml(pin.context)}</small>
      </span>
    </div>
  `).join('');
}

function networkPinPoint(location, fallbackKey) {
  const fallback = NETWORK_PIN_FALLBACKS[fallbackKey] || { x: 50, y: 50 };
  const match = String(location?.coordinates || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return fallback;

  const lat = Number(match[1]);
  const lon = Number(match[2]);
  const { bounds, pinZoom, pinOffsetX, pinOffsetY } = NETWORK_MAP_CONFIG;
  const rawX = ((lon - bounds.west) / (bounds.east - bounds.west)) * 100;
  const rawY = ((bounds.north - lat) / (bounds.north - bounds.south)) * 100;

  return {
    x: roundPinCoord(50 + (rawX - 50) * pinZoom + pinOffsetX),
    y: roundPinCoord(50 + (rawY - 50) * pinZoom + pinOffsetY),
  };
}

function roundPinCoord(value) {
  return Number(value.toFixed(3));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderNetworkLockedPanel() {
  return `
    <article class="network-source-card">
      <span>${escapeHtml(networkText('analysis.coach.googleSelect.title', 'Open Google account activity'))}</span>
      <p>${escapeHtml(networkText('analysis.mapCaption.google', 'A login appears from Karim’s area, but the isolated device at the police station cannot be erased.'))}</p>
    </article>
  `;
}

function renderNetworkGooglePanel() {
  const googleRows = [
    {
      status: networkText('evidenceUi.status.alert', 'ALERT'),
      title: networkText('evidenceUi.google.rows.loginTitle', 'New sign-in detected'),
      meta: networkText('evidenceUi.google.rows.loginMeta', 'May 18, 07:24 · Hassan district, Rabat · Samsung Galaxy'),
      tone: 'warn',
    },
    {
      status: networkText('evidenceUi.status.blocked', 'BLOCKED'),
      title: networkText('evidenceUi.google.rows.resetTitle', 'Remote factory reset — blocked'),
      meta: networkText('evidenceUi.google.rows.resetMeta', 'May 18, 07:26 · Faraday isolation active'),
      tone: 'blocked',
    },
    {
      status: networkText('evidenceUi.status.blocked', 'BLOCKED'),
      title: networkText('evidenceUi.google.rows.wipeTitle', 'Account data wipe — blocked'),
      meta: networkText('evidenceUi.google.rows.wipeMeta', 'May 18, 07:29 · Faraday isolation active'),
      tone: 'blocked',
    },
  ];
  const pathItems = STATE.network?.events?.movementPaths?.remoteDeletion || [];

  return `
    <section class="network-google">
      <header>
        <span>${escapeHtml(networkText('evidenceUi.google.tagTitle', 'Google Account — Remote Activity Log'))}</span>
        <strong>${escapeHtml(networkText('evidenceUi.google.alertTitle', 'Critical security alert'))}</strong>
      </header>
      <p>${escapeHtml(networkText('evidenceUi.google.alertBody', 'Your account was signed in from an unfamiliar location and two deletion attempts were made and blocked.'))}</p>
      <div class="network-log-list">
        ${googleRows.map((row) => `
          <article class="network-log network-log--${escapeHtml(row.tone)}">
            <span>${escapeHtml(row.status)}</span>
            <strong>${escapeHtml(row.title)}</strong>
            <small>${escapeHtml(row.meta)}</small>
          </article>
        `).join('')}
      </div>
      <ol class="network-path">
        ${pathItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ol>
    </section>
  `;
}

function renderNetworkThreads(activeQuestionId = null) {
  const threads = STATE.network?.messages?.details?.conversations?.threads || {};
  const includeWitness = activeQuestionId === 'q10' || STATE.answered.has('q10');
  const selected = ['karim', 'samir', includeWitness ? 'neighbor' : null].filter((key) => key && threads[key]);
  if (!selected.length) return '';

  return `
    <div class="network-messages" aria-label="${escapeHtml(boardText('ui.network.messagesAriaLabel', 'Text message evidence'))}">
      ${includeWitness ? renderCleanerEvidenceCard() : ''}
      ${selected.map((key) => renderNetworkThread(key, threads[key])).join('')}
    </div>
  `;
}

function renderCleanerEvidenceCard() {
  return `
    <article class="network-thread network-thread--witness-note">
      <header>
        <span>${escapeHtml(boardText('ui.network.cleaner.badge', 'Cleaner interview'))}</span>
        <strong>${escapeHtml(boardText('ui.network.cleaner.title', 'First visitor details'))}</strong>
      </header>
      <ul class="network-witness-list">
        <li>${escapeHtml(boardText('ui.network.cleaner.arrival', 'The first visitor arrived before dawn, around 05:00.'))}</li>
        <li>${escapeHtml(boardText('ui.network.cleaner.drunk', 'The cleaner described the visitor as drunk.'))}</li>
        <li>${escapeHtml(boardText('ui.network.cleaner.short', 'The cleaner remembered the visitor as short.'))}</li>
      </ul>
    </article>
  `;
}

function renderNetworkThread(key, thread) {
  const label = thread.label || (key === 'karim' ? 'Karim thread' : 'Samir thread');
  const badge = thread.badge || '';
  const summary = thread.summary || '';

  return `
    <article class="network-thread network-thread--${escapeHtml(key)}">
      <header>
        <span>${escapeHtml(badge)}</span>
        <strong>${escapeHtml(label)}</strong>
      </header>
      <div class="network-chat">
        ${(thread.messages || []).map((message) => renderNetworkMessage(message)).join('')}
      </div>
      <p>${escapeHtml(summary)}</p>
    </article>
  `;
}

function renderNetworkMessage(message) {
  const isOut = isVictimMessageAuthor(message.author);
  return `
    <div class="network-bubble-row ${isOut ? 'is-out' : 'is-in'}">
      <span class="network-bubble">${escapeHtml(message.text || '')}</span>
      <small>${escapeHtml(message.time || '')}</small>
    </div>
  `;
}

function bindPopup() {
  $('#popupClose').addEventListener('click', closePopup);
  $('#popup').addEventListener('click', (e) => {
    if (e.target.id === 'popup') closePopup();
  });
  $('#carPrev').addEventListener('click', () => {
    const images = carouselImagesForCurrentStation();
    if (!images.length) return;
    STATE.carIndex = (STATE.carIndex - 1 + images.length) % images.length;
    renderCarousel();
  });
  $('#carNext').addEventListener('click', () => {
    const images = carouselImagesForCurrentStation();
    if (!images.length) return;
    STATE.carIndex = (STATE.carIndex + 1) % images.length;
    renderCarousel();
  });
}

function renderQuestions(stationId) {
  const root = $('#popupQuestion');
  const qs = questionsFor(stationId);
  const station = stationById(stationId);
  root.innerHTML = '';
  if (!qs.length) {
    root.appendChild(renderStationConclusion(station));
    return;
  }

  const firstOpenIndex = qs.findIndex((q) => !STATE.answered.has(q.id));
  const indexToShow = firstOpenIndex >= 0 ? firstOpenIndex : qs.length - 1;
  const complete = firstOpenIndex < 0;
  const visibleQuestions = qs.length > 1 ? [qs[indexToShow]] : qs;

  if (!complete && syncEvidenceToQuestion(stationId, visibleQuestions[0]?.id)) {
    renderCarousel();
  }

  if (qs.length > 1) {
    renderQuestionSequence(root, qs, complete ? -1 : indexToShow);
  }

  if (complete) {
    root.appendChild(renderStationConclusion(station));
    return;
  }

  visibleQuestions.forEach((q) => {
    const qIndex = qs.indexOf(q);
    const block = document.createElement('div');
    block.className = 'qblock';
    const options = Array.isArray(q.options) ? q.options : [];
    const hasOptions = options.length > 0;
    const isMulti = !!q.multi;
    const already = STATE.answered.get(q.id);

    block.innerHTML = `
      <p class="kicker">${escapeHtml(qs.length > 1
        ? boardText('ui.questions.numberedKicker', `QUESTION ${qIndex + 1} / ${qs.length}`, { current: qIndex + 1, total: qs.length })
        : boardText('ui.questions.kicker', 'QUESTION'))}</p>
      <p class="qprompt">${escapeHtml(q.prompt)}</p>
      <p class="qhint">${escapeHtml(!hasOptions
        ? boardText('ui.questions.reviewOnlyHint', 'Review this evidence before continuing.')
        : isMulti
        ? boardText('ui.questions.multiHint', `Select ${q.multi} answers`, { count: q.multi })
        : boardText('ui.questions.singleHint', 'Select one answer'))}</p>
    `;

    if (hasOptions) {
      const list = document.createElement('div');
      list.className = 'qoptions';
      options.forEach((opt, i) => {
        const row = document.createElement('label');
        row.className = 'qopt';
        row.innerHTML = `
          <input type="${isMulti ? 'checkbox' : 'radio'}" name="${q.id}" value="${i}" ${already ? 'disabled' : ''} />
          <span>${escapeHtml(opt.label)}</span>
        `;
        list.appendChild(row);
      });
      block.appendChild(list);
    }

    const validate = document.createElement('button');
    validate.className = 'btn-validate';
    validate.textContent = already
      ? boardText('ui.questions.recorded', 'RECORDED')
      : hasOptions
        ? boardText('ui.questions.recordAnswer', 'RECORD ANSWER')
        : boardText('ui.questions.markReviewed', 'MARK REVIEWED');
    validate.disabled = !!already;
    validate.addEventListener('click', () => onValidate(q, block, validate));
    block.appendChild(validate);

    if (already) {
      const fb = document.createElement('p');
      fb.className = 'qfeedback';
      fb.textContent = boardText('ui.questions.feedback', 'Answer recorded for final analysis.');
      block.appendChild(fb);
    }

    root.appendChild(block);
  });
}

function renderQuestionSequence(root, qs, activeIndex) {
  const sequence = document.createElement('div');
  sequence.className = 'qsequence';
  sequence.innerHTML = qs.map((q, i) => {
    const classes = [i === activeIndex ? 'is-active' : '', STATE.answered.has(q.id) ? 'is-done' : ''].filter(Boolean).join(' ');
    return `<span class="${classes}">${i + 1}</span>`;
  }).join('');
  root.appendChild(sequence);
}

function renderStationConclusion(station) {
  const block = document.createElement('div');
  block.className = 'qconclusion';
  block.innerHTML = `
    <p class="kicker">${escapeHtml(boardText('ui.questions.conclusionKicker', 'CONCLUSION'))}</p>
    <h3>${escapeHtml(station?.title || boardText('ui.questions.reviewedKicker', 'EVIDENCE REVIEWED'))}</h3>
    ${renderConclusionContent(station)}
  `;

  const closeButton = document.createElement('button');
  closeButton.className = 'btn-conclusion';
  closeButton.type = 'button';
  closeButton.textContent = boardText('ui.questions.closeStation', 'Close evidence');
  closeButton.addEventListener('click', closePopup);
  block.appendChild(closeButton);

  return block;
}

function activeQuestionForStation(stationId) {
  const qs = questionsFor(stationId);
  return qs.find((q) => !STATE.answered.has(q.id)) || null;
}

function syncEvidenceToQuestion(stationId, questionId) {
  const stationMap = QUESTION_EVIDENCE_INDEX[stationId];
  if (!stationMap || !questionId) return false;
  const nextIndex = stationMap[questionId];
  if (!Number.isInteger(nextIndex) || !STATE.carImages[nextIndex] || STATE.carIndex === nextIndex) return false;
  STATE.carIndex = nextIndex;
  return true;
}

function renderConclusionContent(station) {
  if (!station?.conclusion) return '<div class="qconclusion__body"></div>';
  if (station.id === 'toxicology') return renderToxicologyConclusion(station.conclusion);

  const parts = splitConclusionText(station.conclusion);
  return `<ul class="qconclusion__body qconclusion-list">
    ${parts.map((part) => `<li>${escapeHtml(part)}</li>`).join('')}
  </ul>`;
}

function renderToxicologyConclusion(text) {
  const { coroner, substance } = splitToxicologyConclusion(text);
  return `
    <div class="qconclusion__body qconclusion-sections">
      <section>
        <h4>${escapeHtml(boardText('ui.conclusions.coroner', 'CORONER'))}</h4>
        <ul>${splitConclusionText(coroner).map((part) => `<li>${escapeHtml(part)}</li>`).join('')}</ul>
      </section>
      <section>
        <h4>${escapeHtml(boardText('ui.conclusions.substanceReport', 'SUBSTANCE REPORT'))}</h4>
        <ul>${splitConclusionText(substance).map((part) => `<li>${escapeHtml(part)}</li>`).join('')}</ul>
      </section>
    </div>
  `;
}

function splitToxicologyConclusion(text) {
  const markers = [
    /Substance analysis\s*:/i,
    /Analyse de substance\s*:/i,
    /Analisis de sustancia\s*:/i,
    /تحليل المادة\s*:/,
  ];
  const marker = markers.find((pattern) => pattern.test(text));
  if (!marker) return { coroner: text, substance: '' };
  const match = text.match(marker);
  const coroner = text.slice(0, match.index).replace(/^(Coroner|Forense|Médecin légiste|الطبيب الشرعي)\s*:\s*/i, '').trim();
  const substance = text.slice(match.index + match[0].length).trim();
  return { coroner, substance };
}

function splitConclusionText(text) {
  const parts = String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?:\.\s+|;\s+|،\s+)/)
    .map((part) => part.trim().replace(/[.]$/, ''))
    .filter(Boolean);

  return parts.reduce((result, part) => {
    if (/^[—-]/.test(part) && result.length) result[result.length - 1] = `${result[result.length - 1]} ${part}`;
    else result.push(part);
    return result;
  }, []);
}

async function onValidate(q, block, btn) {
  if (btn.disabled) return;
  const options = Array.isArray(q.options) ? q.options : [];
  const inputs = block.querySelectorAll(`input[name="${q.id}"]`);
  if (!options.length) {
    STATE.answered.set(q.id, { blame: '', correct: true });
    btn.textContent = boardText('ui.questions.recorded', 'RECORDED');
    btn.disabled = true;
    btn.classList.add('is-recording');

    const fb = document.createElement('p');
    fb.className = 'qfeedback';
    fb.textContent = boardText('ui.questions.feedback', 'Answer recorded for final analysis.');
    block.appendChild(fb);

    const stationId = STATE.currentStation?.id;
    refreshTablet();
    if (!stationId) return;
    updatePopupMode(stationId);
    renderCarousel();
    await animateReviewToTablet(btn);
    if (STATE.currentStation?.id !== stationId) return;
    if (isStationComplete(stationId) || questionsFor(stationId).length > 1) {
      renderQuestions(stationId);
    }
    return;
  }

  const picked = [...inputs].map((el, i) => ({ el, opt: q.options[i] })).filter((x) => x.el.checked);
  if (!picked.length) return;
  if (q.multi && picked.length !== q.multi) return;

  // Correctness: picked indices must equal the set of correct indices
  const correctIdxs = q.options.map((o, i) => o.correct ? i : -1).filter((i) => i >= 0);
  const pickedIdxs = [...inputs].map((el, i) => el.checked ? i : -1).filter((i) => i >= 0);
  const correct = arraysEqual(pickedIdxs.slice().sort(), correctIdxs.slice().sort());
  const pickedRows = picked.map((x) => x.el.closest('.qopt')).filter(Boolean);

  // Blame attribution follows the picked answer source, because some correct
  // PDF questions establish facts about Samir rather than the killer.
  const blames = picked.map((x) => x.opt.blame);
  const blame = majority(blames) || (correct ? STATE.data.killer : flip(STATE.data.killer));

  STATE.answered.set(q.id, { blame, correct });
  inputs.forEach((el) => { el.disabled = true; });
  pickedRows.forEach((row) => row.classList.add('is-picked'));
  btn.textContent = boardText('ui.questions.recorded', 'RECORDED');
  btn.disabled = true;
  btn.classList.add('is-recording');

  const fb = document.createElement('p');
  fb.className = 'qfeedback';
  fb.textContent = boardText('ui.questions.feedback', 'Answer recorded for final analysis.');
  block.appendChild(fb);

  const stationId = STATE.currentStation?.id;
  refreshTablet();
  if (!stationId) return;
  updatePopupMode(stationId);
  renderCarousel();
  await animateAnswerToProgress(blame, pickedRows);
  if (STATE.currentStation?.id !== stationId) return;

  if (isStationComplete(stationId)) {
    btn.classList.remove('is-recording');
    updatePopupMode(stationId);
    renderCarousel();
    renderQuestions(stationId);
  } else if (questionsFor(stationId).length > 1) {
    renderQuestions(stationId);
  }
}

function stationQuestionProgress(stationId) {
  const qs = questionsFor(stationId);
  const answered = qs.filter((q) => STATE.answered.has(q.id)).length;
  return { answered, total: qs.length, complete: qs.length ? answered >= qs.length : STATE.reviewedStations.has(stationId) };
}

function updatePopupMode(stationId) {
  const card = $('.popup-card');
  const conclusion = $('.popup-conclusion');
  const isNetwork = stationId === 'network';
  const isToxicology = stationId === 'toxicology';
  const isFingerprints = stationId === 'fingerprints';
  const isFloatingEvidence = shouldFloatEvidence(stationId);
  const complete = isStationComplete(stationId);
  const hideConclusion = true;

  card.classList.toggle('is-network', isNetwork);
  card.classList.toggle('is-toxicology', isToxicology);
  card.classList.toggle('is-fingerprints', isFingerprints);
  card.classList.toggle('is-floating-evidence', isFloatingEvidence);
  card.classList.toggle('station-complete', complete);
  conclusion.classList.toggle('is-hidden', hideConclusion);
  conclusion.setAttribute('aria-hidden', String(hideConclusion));
}

function pulseStationObject(stationId) {
  const obj = $(`.obj[data-station="${stationId}"]`);
  if (!obj) return;
  obj.classList.remove('is-activated');
  void obj.offsetWidth;
  obj.classList.add('is-activated');
  setTimeout(() => obj.classList.remove('is-activated'), 680);
}

function animateReviewToTablet(sourceEl) {
  const target = $('#tabletPreviewMount .tablet-screen') || $('#tablet .tablet-screen');
  if (!target || !sourceEl) return Promise.resolve();

  const pulseTarget = () => {
    const tablet = target.closest('.tablet');
    tablet?.classList.add('is-review-hit');
    setTimeout(() => tablet?.classList.remove('is-review-hit'), 520);
  };

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    pulseTarget();
    return delay(220);
  }

  const sourceRect = sourceEl.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width * 0.5;
  const startY = sourceRect.top + sourceRect.height * 0.5;
  const endX = targetRect.left + targetRect.width * 0.54;
  const endY = targetRect.top + targetRect.height * 0.28;
  const starts = [0, 1, 2, 3, 4, 5];
  const staggerMs = 46;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp01 = (value) => Math.max(0, Math.min(1, value));

  starts.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'answer-particle answer-particle--review';
    dot.style.left = `${startX}px`;
    dot.style.top = `${startY}px`;
    dot.style.setProperty('--size', `${5 + (i % 2)}px`);
    document.body.appendChild(dot);

    const delayMs = i * staggerMs;
    const startedAt = performance.now() + delayMs;
    const dx = endX - startX;
    const dy = endY - startY;
    const drift = (i % 2 ? -1 : 1) * (7 + i * 0.6);

    const tick = (now) => {
      const raw = (now - startedAt) / 820;
      if (raw < 0) {
        requestAnimationFrame(tick);
        return;
      }

      const t = clamp01(raw);
      const eased = ease(t);
      const wave = Math.sin(Math.PI * eased);
      dot.style.opacity = String(Math.min(clamp01(t / 0.1), clamp01((1 - t) / 0.16)));
      dot.style.transform = `translate3d(${dx * eased + drift * wave}px, ${dy * eased - 24 * wave}px, 0) scale(${0.86 + wave * 0.18})`;

      if (t < 1) requestAnimationFrame(tick);
      else dot.remove();
    };

    requestAnimationFrame(tick);
  });

  const totalMs = 820 + (starts.length - 1) * staggerMs;
  setTimeout(pulseTarget, totalMs - 180);
  return delay(totalMs + 120);
}

function animateAnswerToProgress(blame, sourceEls) {
  const target = $(`#tabletPreviewMount [data-suspect="${blame}"] .profile-meter`) || $(`[data-suspect="${blame}"] .profile-meter`);
  const fill = $(`#tabletPreviewMount [data-fill="${blame}"]`) || $(`[data-fill="${blame}"]`);
  const bar = fill?.closest('.bar');
  const profile = target?.closest('.profile');
  const sources = (Array.isArray(sourceEls) ? sourceEls : [sourceEls]).filter(Boolean);
  if (!target || !fill || !bar || !sources.length) return Promise.resolve();

  const pulseTarget = () => {
    profile?.classList.add('is-hit');
    fill?.classList.add('is-hit');
    setTimeout(() => {
      profile?.classList.remove('is-hit');
      fill?.classList.remove('is-hit');
    }, 820);
  };

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    pulseTarget();
    return delay(220);
  }

  const barRect = bar.getBoundingClientRect();
  const fillPct = Math.max(0, Math.min(100, parseFloat(fill.style.width || '0')));
  const endX = barRect.left + (barRect.width * fillPct / 100);
  const endY = barRect.top + barRect.height * 0.5;
  const starts = [
    { x: 0.2, y: 0.3 }, { x: 0.38, y: 0.22 }, { x: 0.58, y: 0.28 },
    { x: 0.78, y: 0.36 }, { x: 0.28, y: 0.56 }, { x: 0.48, y: 0.5 },
    { x: 0.68, y: 0.58 }, { x: 0.84, y: 0.64 },
  ];
  const staggerMs = 36;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp01 = (value) => Math.max(0, Math.min(1, value));

  for (let i = 0; i < starts.length; i += 1) {
    const sourceRect = sources[i % sources.length].getBoundingClientRect();
    const start = starts[i];
    const startX = sourceRect.left + sourceRect.width * start.x;
    const startY = sourceRect.top + sourceRect.height * start.y;
    const dot = document.createElement('span');
    dot.className = 'answer-particle';
    dot.style.left = `${startX}px`;
    dot.style.top = `${startY}px`;
    dot.style.setProperty('--size', `${4 + (i % 2)}px`);
    document.body.appendChild(dot);

    const delayMs = i * staggerMs;
    const startedAt = performance.now() + delayMs;
    const dx = endX - startX;
    const dy = endY - startY;
    const arc = 16 + (i % 3) * 5;
    const drift = (i % 2 ? -1 : 1) * (5 + i * 0.35);

    const tick = (now) => {
      const raw = (now - startedAt) / ANSWER_ANIMATION_MS;
      if (raw < 0) {
        requestAnimationFrame(tick);
        return;
      }

      const t = clamp01(raw);
      const eased = ease(t);
      const wave = Math.sin(Math.PI * eased);
      const fadeIn = clamp01(t / 0.1);
      const fadeOut = clamp01((1 - t) / 0.18);
      const opacity = Math.min(fadeIn, fadeOut);
      const x = dx * eased + drift * wave;
      const y = dy * eased - arc * wave;
      const scale = 0.82 + wave * 0.18;

      dot.style.opacity = String(opacity);
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;

      if (t < 1) requestAnimationFrame(tick);
      else dot.remove();
    };

    requestAnimationFrame(tick);
  }

  const totalMs = ANSWER_ANIMATION_MS + (starts.length - 1) * staggerMs;
  setTimeout(pulseTarget, totalMs - 220);
  return delay(totalMs + 180);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function networkText(path, fallback = '') {
  const value = getPath(STATE.network?.text, path);
  return typeof value === 'string' ? value : fallback;
}

function boardText(path, fallback = '', vars = null) {
  const value = window.i18n?.t?.(path, vars);
  return typeof value === 'string' && value !== path ? value : fallback;
}

function getPath(obj, path) {
  return String(path || '').split('.').reduce((current, key) => current?.[key], obj);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function isVictimMessageAuthor(author) {
  const normalized = String(author || '').trim().toLowerCase();
  return ['youssef', 'يوسف'].includes(normalized);
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function majority(arr) {
  const counts = {};
  arr.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  let best = null, bestN = 0;
  for (const k in counts) if (counts[k] > bestN) { best = k; bestN = counts[k]; }
  return best;
}

function flip(suspect) {
  return suspect === 'karim' ? 'samir' : 'karim';
}

function refreshTablet() {
  const totalQ = STATE.data.questions.length;
  const progress = completionProgress();
  const tally = { karim: 0, samir: 0 };
  STATE.answered.forEach(({ blame }) => { tally[blame] = (tally[blame] || 0) + 1; });

  const pctKarim = Math.round((tally.karim / totalQ) * 100);
  const pctSamir = Math.round((tally.samir / totalQ) * 100);

  $('[data-fill="karim"]').style.width = pctKarim + '%';
  $('[data-fill="samir"]').style.width = pctSamir + '%';
  $('[data-pct="karim"]').textContent = pctKarim + '%';
  $('[data-pct="samir"]').textContent = pctSamir + '%';

  const cta = $('#ctaAnalyze');
  const tablet = $('#tablet');
  const allComplete = progress.completed >= progress.total;
  cta.disabled = !allComplete;
  cta.classList.toggle('is-ready', allComplete);
  tablet.classList.toggle('is-ready', allComplete);
  tablet.setAttribute('aria-disabled', String(!allComplete));

  refreshStationAura();

  const hint = $('#boardHint');
  if (allComplete) {
    hint.textContent = boardText('ui.hints.complete', 'All evidence reviewed. Tap anywhere on the tablet to close the case.');
  } else {
    hint.textContent = boardText('ui.hints.progress', `Evidence reviewed: ${progress.completed} / ${progress.total}. Tap an item on the desk.`, {
      completed: progress.completed,
      total: progress.total,
    });
  }
  syncTabletPreview();
}

function syncTabletPreview() {
  const mount = $('#tabletPreviewMount');
  const tablet = $('#tablet');
  if (!mount || !tablet || !$('.board')?.classList.contains('has-popup')) return;

  mount.innerHTML = '';
  const clone = tablet.cloneNode(true);
  clone.id = 'tabletPreview';
  clone.classList.add('tablet-preview');
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  clone.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  mount.appendChild(clone);
}

function bindReveal() {
  const cta = $('#ctaAnalyze');
  const tablet = $('#tablet');

  const openReveal = () => {
    if (cta.disabled) return;
    const tally = { karim: 0, samir: 0 };
    STATE.answered.forEach(({ blame }) => { tally[blame] = (tally[blame] || 0) + 1; });
    const accused = tally.karim >= tally.samir ? 'karim' : 'samir';
    const truth = STATE.data.killer;
    const win = accused === truth;

    const sus = STATE.data.suspects[truth];
    $('#revealKicker').textContent = win ? boardText('ui.reveal.caseSolved', 'CASE SOLVED') : boardText('ui.reveal.caseInconclusive', 'CASE INCONCLUSIVE');
    $('#revealTitle').textContent = win ? boardText('ui.reveal.killerIs', 'The killer is…') : boardText('ui.reveal.wrongAccused', 'You accused the wrong person. The killer was…');
    renderRevealProfile(truth);
    $('#revealName').textContent = sus.name;
    $('#revealText').textContent = win
      ? boardText('ui.reveal.winText', 'The forensic evidence converges: motive (fake cocaine), hidden initials on the brick under UV, fiber match between the lost button and the broken branch, and the wiped chair confirm the killer.')
      : boardText('ui.reveal.loseText', 'Re-examine the evidence: the fake cocaine brick, the hidden UV initials, the fiber match and the wiped chair all point to a single person.');

    $('#reveal').hidden = false;
  };

  cta.addEventListener('click', (e) => {
    e.stopPropagation();
    openReveal();
  });

  tablet.addEventListener('click', (e) => {
    if (!cta.disabled && !e.target.closest('#ctaAnalyze')) openReveal();
  });

  $('#revealClose').addEventListener('click', () => {
    goHome();
  });
}

function renderRevealProfile(suspectId) {
  const mount = $('#revealProfile');
  const source = $(`#tablet .profile[data-suspect="${suspectId}"]`);
  if (!mount || !source) return;

  const clone = source.cloneNode(true);
  clone.classList.add('reveal-profile-card');
  clone.removeAttribute('data-suspect');
  clone.querySelectorAll('[data-fill], [data-pct]').forEach((el) => {
    el.removeAttribute('data-fill');
    el.removeAttribute('data-pct');
  });
  mount.replaceChildren(clone);
}

init().catch((err) => {
  console.error('[dsgn-board] init failed', err);
});
