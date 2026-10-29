import {
  ARTWORK_ASPECT_RATIOS,
  ASSET_VERSION,
  DEFAULT_HOME_TILE_FADE_MS,
  DEFAULT_LOCALE,
  DEFAULT_SCENE_OUT_MS,
  EXPERIENCE_PATH,
  HOME_FLIP_BURST_STAGGER_MS,
  HOME_TILE_RATIO_HINTS,
  LANGUAGE_PATH,
  RESULT_ACTION_ENTER_MS,
  RESULT_ACTION_EXIT_MS,
  RESULT_BACKDROP_ENTER_MS,
  RESULT_BACKDROP_EXIT_MS,
  RESULT_CONTENT_ENTER_MS,
  RESULT_CONTENT_EXIT_MS,
  RESULT_EXIT_CARRY_HEADSTART_MS,
  STAGE_HEIGHT,
  STAGE_WIDTH
} from "./config.js";
import {
  prefersReducedMotion,
  readDurationMs
} from "./motion.js";
import { escapeHtml, shuffleArray } from "./utils.js";
import { createRenderer } from "./render.js";
import { createTransitionController } from "./transitions.js";

const sceneFrame = document.getElementById("sceneFrame");
const homeButton = document.getElementById("homeButton");
const appShell = document.querySelector(".app-shell");
const appStage = document.getElementById("appStage");

const preloadedArtworkUrls = new Set();
const activeArtworkPreloads = new Map();

const state = {
  experience: null,
  messages: null,
  locale: "en",
  artworkPool: [],
  artworkMetadata: new Map(Object.entries(ARTWORK_ASPECT_RATIOS)),
  homeTiles: [],
  homeFlipTimers: new Set(),
  currentStepIndex: 0,
  currentOptionIndex: null,
  view: "home",
  resultOverlayVisible: false,
  resultOverlayAnimationFrame: 0,
  finalPanelAnimationFrame: 0,
  inactivityTimer: 0,
  transitionTimer: 0,
  activeArtworkFile: "",
  transitionLock: false,
  pendingNext: false,
  pendingSelection: null,
  transitionToken: 0,
  transientTimeouts: new Set(),
  isReady: false
};
const boardTracking = window.EHTracking
  ? window.EHTracking.createTracker({
      exhibition: "VG",
      application: "VG-board",
      getLanguage: () => state.locale || window.i18n?.lang || document.documentElement.lang
    })
  : null;

function getBoardSelectionPercentage() {
  const totalSteps = state.experience?.steps?.length || 0;
  if (!totalSteps) {
    return 50;
  }

  return Math.max(10, Math.min(90, Math.round(((state.currentStepIndex + 1) / (totalSteps + 1)) * 100)));
}

function startBoardExperienceTracking() {
  if (!boardTracking) {
    return;
  }

  void boardTracking.restart(0, { step: 'experience' });
}

function trackBoardProgress(percentage) {
  if (!boardTracking) {
    return;
  }

  void boardTracking.track(percentage);
}

const { renderCurrentView } = createRenderer({
  getState: () => state,
  currentStep,
  goHome,
  t,
  escapeHtml,
  resolveArtworkUrl,
  resolveHomeArtworkUrl,
  buildCategoryChoiceItems,
  buildRanking,
  sortDisplayRankingItems
});

const {
  ensureArtworkTransitionLayer,
  hasActiveArtworkTransition,
  playCarryTransition,
  playSelectionTransition,
  resetArtworkTransitionLayer
} = createTransitionController({
  appStage,
  sceneFrame,
  resolveArtworkUrl,
  scheduleTransientTimeout,
  isTransitionTokenCurrent: (transitionToken) => transitionToken === state.transitionToken,
  playPendingResultIntro,
  playPendingFinalIntro
});

init().catch((error) => {
  console.error(error);
  void renderFatalError(error);
});

async function init() {
  const experience = await fetchJson(EXPERIENCE_PATH);
  const localePack = await loadMessages(
    getRequestedLocale(experience.meta.defaultLocale),
    experience.meta.defaultLocale
  );

  state.experience = experience;
  state.messages = localePack.messages;
  state.locale = localePack.locale;
  state.artworkPool = buildArtworkPool();
  state.homeTiles = createHomeTiles();
  state.isReady = true;

  syncStageScale();
  setupKioskGuards();
  ensureArtworkTransitionLayer();

  syncLocalizedChrome();
  homeButton.setAttribute("aria-label", t("aria.home"));
  homeButton.addEventListener("click", handleHomeClick);
  sceneFrame.addEventListener("click", handleSceneClick);
  window.addEventListener("resize", syncStageScale, { passive: true });

  const activityEvents = ["pointerdown", "keydown", "wheel", "touchstart"];
  activityEvents.forEach((eventName) => {
    window.addEventListener(eventName, resetInactivityTimer, { passive: true });
  });

  window.addEventListener("i18n:changed", handleLanguageChange);

  render({ initial: true });
  resetInactivityTimer();
  queueBackgroundTask(() => {
    preloadStepArtwork(0);
  });
}

async function loadMessages(locale, fallbackLocale) {
  const requestedLocale = normalizeLocale(locale) || normalizeLocale(fallbackLocale) || DEFAULT_LOCALE;
  const safeFallbackLocale = normalizeLocale(fallbackLocale) || DEFAULT_LOCALE;

  try {
    return {
      locale: requestedLocale,
      messages: await fetchJson(`${LANGUAGE_PATH}/${requestedLocale}.json`)
    };
  } catch (error) {
    if (!safeFallbackLocale || requestedLocale === safeFallbackLocale) {
      throw error;
    }

    console.warn(`Falling back to locale ${safeFallbackLocale} after failing to load ${requestedLocale}.`, error);
    return {
      locale: safeFallbackLocale,
      messages: await fetchJson(`${LANGUAGE_PATH}/${safeFallbackLocale}.json`)
    };
  }
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    const error = new Error(`LOAD_FAILED:${path}`);
    error.name = "LoadError";
    throw error;
  }
  return response.json();
}

function normalizeLocale(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function getRequestedLocale(fallbackLocale = DEFAULT_LOCALE) {
  const preferredLocale = normalizeLocale(window.i18n?.lang);
  if (preferredLocale) {
    return preferredLocale;
  }

  const requestedLocale = normalizeLocale(new URLSearchParams(window.location.search).get("lang"));
  if (requestedLocale) {
    return requestedLocale;
  }

  return normalizeLocale(fallbackLocale) || DEFAULT_LOCALE;
}

async function handleLanguageChange(event) {
  if (!state.experience) {
    return;
  }

  const nextLocale = normalizeLocale(event.detail?.lang);
  if (!nextLocale || nextLocale === state.locale) {
    return;
  }

  try {
    const localePack = await loadMessages(nextLocale, state.experience.meta.defaultLocale || DEFAULT_LOCALE);
    state.messages = localePack.messages;
    state.locale = localePack.locale;
    syncLocalizedChrome();
    render({ initial: true, skipSceneAnimation: true });
  } catch (error) {
    console.error("Unable to switch language.", error);
  }
}

function syncLocalizedChrome() {
  document.documentElement.lang = state.locale || DEFAULT_LOCALE;
  document.title = t("app.title");

  const homeButtonLabel = homeButton?.querySelector(".home-pill-label");
  if (homeButtonLabel) {
    homeButtonLabel.textContent = t("aria.home");
  }
}

function setupKioskGuards() {
  const preventDefault = (event) => {
    event.preventDefault();
  };

  window.addEventListener("contextmenu", preventDefault);
  window.addEventListener("dblclick", preventDefault);
  window.addEventListener("dragstart", preventDefault);
  window.addEventListener("selectstart", preventDefault);
  window.addEventListener("gesturestart", preventDefault);
  window.addEventListener("gesturechange", preventDefault);
  window.addEventListener("gestureend", preventDefault);
  window.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    },
    { passive: false }
  );
  window.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  window.addEventListener(
    "keydown",
    (event) => {
      const blockedKeys = new Set([
        "F5",
        "F11",
        "F12",
        "BrowserBack",
        "BrowserForward",
        "Backspace"
      ]);

      const blockedShortcutKeys = new Set(["r", "p", "s", "o", "n", "t", "w", "l", "i", "u"]);
      const isModifierShortcut = (event.ctrlKey || event.metaKey) && blockedShortcutKeys.has(event.key.toLowerCase());
      const isHistoryShortcut = event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key);

      if (blockedKeys.has(event.key) || isModifierShortcut || isHistoryShortcut) {
        event.preventDefault();
      }
    },
    { capture: true }
  );

  window.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    },
    { passive: false }
  );
}

function handleHomeClick() {
  goHome();
}

function syncStageScale() {
  if (!appStage) {
    return;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || STAGE_WIDTH;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || STAGE_HEIGHT;
  const scale = Math.min(viewportWidth / STAGE_WIDTH, viewportHeight / STAGE_HEIGHT);

  appShell.style.setProperty("--stage-scale", String(scale));
}

function getSceneSwapDelayMs() {
  return readDurationMs("--scene-out-duration", DEFAULT_SCENE_OUT_MS);
}

function getHomeTileFadeDurationMs() {
  return readDurationMs("--home-tile-fade-duration", DEFAULT_HOME_TILE_FADE_MS);
}

function getResultOverlayDurationMs(variableName, fallbackMs) {
  return readDurationMs(variableName, fallbackMs);
}

function scheduleTransientTimeout(callback, delay) {
  const timeoutId = window.setTimeout(() => {
    state.transientTimeouts.delete(timeoutId);
    callback();
  }, delay);

  state.transientTimeouts.add(timeoutId);
  return timeoutId;
}

function clearTransientTimeouts() {
  state.transientTimeouts.forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });
  state.transientTimeouts.clear();
}

function cancelOngoingVisualTransitions() {
  state.transitionToken += 1;
  state.transitionLock = false;
  window.clearTimeout(state.transitionTimer);
  state.transitionTimer = 0;
  cancelResultOverlayAnimationFrame();
  cancelFinalPanelAnimationFrame();
  clearHomeFlipTimer();
  clearTransientTimeouts();
  resetArtworkTransitionLayer();
}

function scheduleHomeTimeout(callback, delay) {
  const timeoutId = window.setTimeout(() => {
    state.homeFlipTimers.delete(timeoutId);
    callback();
  }, delay);

  state.homeFlipTimers.add(timeoutId);
  return timeoutId;
}

function handleSceneClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const { action } = actionTarget.dataset;

  if (action === "start") {
    startBoardExperienceTracking();
    state.currentStepIndex = 0;
    state.currentOptionIndex = null;
    state.resultOverlayVisible = false;
    state.view = "step";
    render();
    return;
  }

  if (action === "next") {
    if (state.transitionLock && state.resultOverlayVisible) {
      state.pendingNext = true;
      return;
    }

    void moveNext();
    return;
  }

  if (action === "home") {
    goHome();
    return;
  }

  if (action === "select-category") {
    const stepId = String(actionTarget.dataset.stepId || "");
    void commitCategorySelection(stepId, actionTarget);
    return;
  }

  if (action === "select") {
    const optionIndex = Number(actionTarget.dataset.optionIndex);

    if (state.transitionLock && !state.resultOverlayVisible) {
      state.pendingSelection = {
        optionIndex,
        stepIndex: state.currentStepIndex
      };
      return;
    }

    void commitSelection(optionIndex, actionTarget);
  }
}

async function moveNext() {
  if (state.transitionLock) {
    return;
  }

  state.pendingNext = false;
  const currentArtworkFile = state.activeArtworkFile;

  if (currentArtworkFile) {
    const transitionToken = state.transitionToken + 1;
    state.transitionToken = transitionToken;
    state.transitionLock = true;
    state.pendingSelection = null;

    try {
      const resultExitPromise = state.resultOverlayVisible
        ? animateResultContentOut()
        : Promise.resolve();

      if (state.resultOverlayVisible && RESULT_EXIT_CARRY_HEADSTART_MS > 0) {
        await new Promise((resolve) => {
          scheduleTransientTimeout(resolve, RESULT_EXIT_CARRY_HEADSTART_MS);
        });
      }

      await Promise.allSettled([
        playCarryTransition(currentArtworkFile, transitionToken, () => {
          if (transitionToken !== state.transitionToken) {
            return;
          }

          advanceStep();
        }),
        resultExitPromise
      ]);
    } finally {
      if (transitionToken === state.transitionToken) {
        state.transitionLock = false;
        flushPendingSelection();
      }
    }

    return;
  }

  if (state.resultOverlayVisible) {
    await animateResultContentOut();
  }

  advanceStep();
}

function advanceStep() {
  if (state.currentStepIndex >= state.experience.steps.length - 1) {
    state.currentOptionIndex = null;
    state.resultOverlayVisible = false;
    state.activeArtworkFile = "";
    state.view = "category";
    render({ skipSceneAnimation: true, animateContent: true });
    return;
  }

  state.currentStepIndex += 1;
  state.currentOptionIndex = null;
  state.resultOverlayVisible = false;
  state.view = "step";
  render({ skipSceneAnimation: true, animateContent: true });
}

async function commitSelection(optionIndex, selectedCard) {
  if (state.transitionLock) {
    return;
  }

  state.pendingNext = false;
  state.pendingSelection = null;

  const step = currentStep();
  const option = step?.options?.[optionIndex];
  if (!option) {
    return;
  }

  const artworkFile = option.backgroundFile || option.imageFile || "";
  const votes = loadVotes();
  incrementVote(votes, option.rankingKey);
  incrementVote(votes, getOptionVoteKey(step.id, optionIndex));
  saveVotes(votes);

  const transitionToken = state.transitionToken + 1;
  state.transitionToken = transitionToken;
  state.transitionLock = true;

  try {
    await playSelectionTransition(selectedCard, artworkFile, transitionToken, () => {
      if (transitionToken !== state.transitionToken) {
        return;
      }

      state.currentOptionIndex = optionIndex;
      state.resultOverlayVisible = true;
      state.activeArtworkFile = artworkFile;
      state.view = "step";
      render({ skipSceneAnimation: true });
      queueBackgroundTask(() => {
        preloadStepArtwork(state.currentStepIndex + 1);
      });
      trackBoardProgress(getBoardSelectionPercentage());
    });
  } finally {
    if (transitionToken === state.transitionToken) {
      state.transitionLock = false;
      flushPendingSelection();
      flushPendingNext();
    }
  }
}

async function commitCategorySelection(stepId, selectedCard) {
  if (state.transitionLock) {
    return;
  }

  const categoryItem = buildCategoryChoiceItems().find((item) => item.key === stepId);
  if (!categoryItem) {
    return;
  }

  const votes = loadVotes();
  incrementVote(votes, getCategoryVoteKey(stepId));
  saveVotes(votes);

  const transitionToken = state.transitionToken + 1;
  state.transitionToken = transitionToken;
  state.transitionLock = true;

  try {
    await playSelectionTransition(selectedCard, categoryItem.artworkFile, transitionToken, () => {
      if (transitionToken !== state.transitionToken) {
        return;
      }

      state.currentOptionIndex = null;
      state.resultOverlayVisible = false;
      state.activeArtworkFile = "";
      state.view = "final";
      render({ skipSceneAnimation: true });
      trackBoardProgress(100);
    });
  } finally {
    if (transitionToken === state.transitionToken) {
      state.transitionLock = false;
    }
  }
}

function goHome() {
  const isAlreadyHome =
    state.view === "home" &&
    state.currentStepIndex === 0 &&
    state.currentOptionIndex === null &&
    !state.resultOverlayVisible &&
    !state.activeArtworkFile;

  if (isAlreadyHome) {
    return;
  }

  cancelOngoingVisualTransitions();
  state.homeTiles = createHomeTiles();
  state.currentStepIndex = 0;
  state.currentOptionIndex = null;
  state.resultOverlayVisible = false;
  state.activeArtworkFile = "";
  state.pendingNext = false;
  state.pendingSelection = null;
  state.view = "home";
  render();
}

function resetInactivityTimer() {
  if (!state.isReady) {
    return;
  }

  window.clearTimeout(state.inactivityTimer);
  state.inactivityTimer = window.setTimeout(() => {
    goHome();
  }, state.experience.meta.inactivityMs);
}

function clearHomeFlipTimer() {
  state.homeFlipTimers.forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });
  state.homeFlipTimers.clear();
}

function currentStep() {
  return state.experience.steps[state.currentStepIndex];
}

function render(options = {}) {
  const { initial = false, skipSceneAnimation = false, animateContent = false } = options;
  const previousView = appShell.dataset.view || state.view;
  const sceneTransition = `${previousView}-to-${state.view}`;

  appShell.dataset.view = state.view;
  homeButton.classList.toggle("hidden", state.view === "home");
  window.clearTimeout(state.transitionTimer);
  state.transitionTimer = 0;
  clearTransientTimeouts();

  if (initial || skipSceneAnimation) {
    delete sceneFrame.dataset.sceneTransition;
    sceneFrame.innerHTML = renderCurrentView();
    sceneFrame.classList.remove("is-leaving", "is-entering", "is-content-entering", "is-initial-entering");
    sceneFrame.classList.add("scene-frame-ready");
    if (initial && !skipSceneAnimation && !prefersReducedMotion()) {
      void sceneFrame.offsetHeight;
      sceneFrame.classList.add("is-initial-entering");
    }
    if (animateContent && !prefersReducedMotion()) {
      void sceneFrame.offsetHeight;
      sceneFrame.classList.add("is-content-entering");
    }
    afterRender();
    return;
  }

  sceneFrame.dataset.sceneTransition = sceneTransition;
  sceneFrame.classList.remove("scene-frame-ready", "is-entering", "is-content-entering", "is-initial-entering");
  sceneFrame.classList.add("is-leaving");

  let hasSwappedScene = false;
  const finishSceneSwap = () => {
    if (hasSwappedScene) {
      return;
    }

    hasSwappedScene = true;
    sceneFrame.removeEventListener("animationend", handleSceneExit);
    window.clearTimeout(state.transitionTimer);
    state.transitionTimer = 0;
    sceneFrame.innerHTML = renderCurrentView();
    sceneFrame.classList.remove("is-leaving", "scene-frame-ready");
    sceneFrame.classList.add("is-entering");
    afterRender();
  };

  const handleSceneExit = (event) => {
    if (event.target !== sceneFrame || event.animationName !== "scene-out") {
      return;
    }

    finishSceneSwap();
  };

  sceneFrame.addEventListener("animationend", handleSceneExit);
  state.transitionTimer = window.setTimeout(finishSceneSwap, getSceneSwapDelayMs() + 72);
}

function afterRender() {
  clearHomeFlipTimer();

  if (state.view === "home") {
    scheduleHomeFlip();
  }

  if (state.resultOverlayVisible) {
    if (sceneFrame.classList.contains("is-artwork-handoff")) {
      sceneFrame.dataset.pendingResultIntro = "true";
    } else {
      delete sceneFrame.dataset.pendingResultIntro;
      animateResultContentIn();
    }
  } else {
    delete sceneFrame.dataset.pendingResultIntro;
  }

  if (state.view === "final") {
    const finalPanel = getFinalPanel();
    if (finalPanel && hasActiveArtworkTransition()) {
      finalPanel.dataset.finalPanelState = "hidden";
      sceneFrame.dataset.pendingFinalIntro = "true";
      return;
    }

    delete sceneFrame.dataset.pendingFinalIntro;
    animateFinalPanelIn();
    return;
  }

  delete sceneFrame.dataset.pendingFinalIntro;
}

function playPendingResultIntro() {
  if (sceneFrame.dataset.pendingResultIntro !== "true") {
    return;
  }

  delete sceneFrame.dataset.pendingResultIntro;
  if (state.resultOverlayVisible) {
    animateResultContentIn();
  }
}

function getFinalPanel() {
  return sceneFrame.querySelector(".final-panel");
}

function cancelFinalPanelAnimationFrame() {
  if (!state.finalPanelAnimationFrame) {
    return;
  }

  window.cancelAnimationFrame(state.finalPanelAnimationFrame);
  state.finalPanelAnimationFrame = 0;
}

function animateFinalPanelIn() {
  const finalPanel = getFinalPanel();
  if (!finalPanel) {
    return;
  }

  cancelFinalPanelAnimationFrame();

  if (prefersReducedMotion()) {
    finalPanel.dataset.finalPanelState = "visible";
    return;
  }

  finalPanel.dataset.finalPanelState = "hidden";
  void finalPanel.offsetHeight;
  state.finalPanelAnimationFrame = window.requestAnimationFrame(() => {
    state.finalPanelAnimationFrame = window.requestAnimationFrame(() => {
      state.finalPanelAnimationFrame = 0;

      if (state.view !== "final") {
        return;
      }

      const currentFinalPanel = getFinalPanel();
      if (!currentFinalPanel) {
        return;
      }

      currentFinalPanel.dataset.finalPanelState = "visible";
    });
  });
}

function playPendingFinalIntro() {
  if (sceneFrame.dataset.pendingFinalIntro !== "true") {
    return;
  }

  delete sceneFrame.dataset.pendingFinalIntro;
  if (state.view === "final") {
    animateFinalPanelIn();
  }
}

function getResultOverlayPanel() {
  return sceneFrame.querySelector(".choice-panel.has-result-overlay");
}

function cancelResultOverlayAnimationFrame() {
  if (!state.resultOverlayAnimationFrame) {
    return;
  }

  window.cancelAnimationFrame(state.resultOverlayAnimationFrame);
  state.resultOverlayAnimationFrame = 0;
}

function animateResultContentIn() {
  const resultOverlayPanel = getResultOverlayPanel();
  if (!resultOverlayPanel) {
    return;
  }

  cancelResultOverlayAnimationFrame();

  if (prefersReducedMotion()) {
    resultOverlayPanel.dataset.resultOverlayState = "visible";
    return;
  }

  delete resultOverlayPanel.dataset.resultOverlayState;
  void resultOverlayPanel.offsetHeight;
  state.resultOverlayAnimationFrame = window.requestAnimationFrame(() => {
    state.resultOverlayAnimationFrame = window.requestAnimationFrame(() => {
      state.resultOverlayAnimationFrame = 0;

      if (!state.resultOverlayVisible) {
        return;
      }

      const currentResultOverlayPanel = getResultOverlayPanel();
      if (!currentResultOverlayPanel) {
        return;
      }

      currentResultOverlayPanel.dataset.resultOverlayState = "visible";
    });
  });
}

async function animateResultContentOut() {
  const resultOverlayPanel = getResultOverlayPanel();
  if (!resultOverlayPanel) {
    return;
  }

  cancelResultOverlayAnimationFrame();
  delete resultOverlayPanel.dataset.resultOverlayState;

  if (prefersReducedMotion()) {
    return;
  }

  const exitDurationMs = Math.max(
    getResultOverlayDurationMs("--result-backdrop-exit-duration", RESULT_BACKDROP_EXIT_MS),
    getResultOverlayDurationMs("--result-content-exit-duration", RESULT_CONTENT_EXIT_MS),
    getResultOverlayDurationMs("--result-action-exit-duration", RESULT_ACTION_EXIT_MS)
  );

  await new Promise((resolve) => {
    window.setTimeout(resolve, exitDurationMs + 20);
  });
}

function scheduleHomeFlip() {
  if (state.view !== "home") {
    return;
  }

  scheduleHomeTimeout(() => {
    startHomeFlipBurst();
  }, state.experience.meta.homeFlipMs);
}

function startHomeFlipBurst() {
  if (state.view !== "home") {
    return;
  }

  const availableTileIndices = getAvailableHomeTileIndices();
  if (!availableTileIndices.length) {
    scheduleHomeFlip();
    return;
  }

  const burstCount = Math.min(
    availableTileIndices.length,
    Math.random() < 0.68 ? 1 : 2
  );
  const selectedTileIndices = shuffleArray(availableTileIndices).slice(0, burstCount);

  selectedTileIndices.forEach((tileIndex, index) => {
    scheduleHomeTimeout(() => {
      if (state.view !== "home") {
        return;
      }

      const tile = sceneFrame.querySelector(`[data-home-tile-index="${tileIndex}"]`);
      if (tile) {
        refreshHomeTile(tileIndex, tile);
      }

      if (index === selectedTileIndices.length - 1) {
        scheduleHomeFlip();
      }
    }, index * HOME_FLIP_BURST_STAGGER_MS);
  });
}

function getAvailableHomeTileIndices() {
  return Array.from(sceneFrame.querySelectorAll("[data-home-tile-index]"))
    .map((tile) => {
      const tileIndex = Number(tile.dataset.homeTileIndex);
      if (!Number.isInteger(tileIndex) || tile.dataset.flipping === "true") {
        return null;
      }

      return tileIndex;
    })
    .filter((tileIndex) => tileIndex !== null);
}

function refreshHomeTile(tileIndex, tileElement = null) {
  const tile = tileElement || sceneFrame.querySelector(`[data-home-tile-index="${tileIndex}"]`);
  if (!tile || !tile.isConnected || tile.dataset.flipping === "true") {
    return;
  }

  const frontFace = tile.querySelector(".home-mosaic-face-front");
  const backFace = tile.querySelector(".home-mosaic-face-back");
  if (!frontFace || !backFace) {
    return;
  }

  const nextArtworkFile = pickRandomArtwork({
    excludedFile: state.homeTiles[tileIndex],
    targetRatio: getHomeTileTargetRatio(tileIndex, tile),
    disallowedFiles: state.homeTiles
  });
  if (!nextArtworkFile) {
    return;
  }

  const fadeDurationMs = getHomeTileFadeDurationMs();
  let hasFinalized = false;

  const finalizeCrossfade = () => {
    if (hasFinalized || !tile.isConnected) {
      return;
    }

    hasFinalized = true;
    backFace.removeEventListener("transitionend", handleBackFadeEnd);
    state.homeTiles[tileIndex] = nextArtworkFile;
    setHomeArtworkVariable(frontFace, nextArtworkFile);

    window.requestAnimationFrame(() => {
      if (!tile.isConnected) {
        return;
      }

      tile.classList.add("is-resetting");
      tile.classList.remove("is-crossfading");

      window.requestAnimationFrame(() => {
        if (!tile.isConnected) {
          return;
        }

        backFace.style.removeProperty("--tile-image");
        tile.classList.remove("is-resetting", "is-flipping");
        tile.dataset.flipping = "false";
      });
    });
  };

  const handleBackFadeEnd = (event) => {
    if (
      event.target !== backFace ||
      event.propertyName !== "opacity" ||
      !tile.classList.contains("is-crossfading")
    ) {
      return;
    }

    finalizeCrossfade();
  };

  setHomeArtworkVariable(backFace, nextArtworkFile);
  tile.dataset.flipping = "true";
  tile.classList.add("is-flipping");
  backFace.addEventListener("transitionend", handleBackFadeEnd);

  window.requestAnimationFrame(() => {
    if (!tile.isConnected) {
      return;
    }

    tile.classList.add("is-crossfading");
  });

  scheduleHomeTimeout(() => {
    finalizeCrossfade();
  }, fadeDurationMs + 96);
}

function buildRanking() {
  const rankedItems = sortDisplayRankingItems(buildCategoryEntries());
  const smoothedItems = applyLeaderboardDisplaySmoothing(rankedItems);
  const totalDisplayScore = smoothedItems.reduce((sum, item) => sum + item.displayScore, 0);

  return smoothedItems.map((item) => {
    const share = totalDisplayScore ? item.displayScore / totalDisplayScore : 0;
    const percentage = share * 100;
    return {
      ...item,
      total: totalDisplayScore,
      share,
      percentage,
      percentageLabel: formatRankingPercentage(percentage)
    };
  });
}

function buildCategoryChoiceItems() {
  return buildCategoryEntries();
}

function buildCategoryEntries() {
  const votes = loadVotes();

  return state.experience.steps.map((step, seedIndex) => {
    const representative = getCategoryRepresentativeChoice(step, votes);
    return {
      key: step.id,
      titleKey: step.titleKey,
      artworkFile: representative.artworkFile,
      artworkLabel: representative.label || String(t(step.titleKey)),
      count: votes[getCategoryVoteKey(step.id)] || 0,
      proxyScore: getCategoryProxyScore(representative, seedIndex),
      seedIndex
    };
  });
}

function getCategoryRepresentativeChoice(step, votes) {
  const rankedOptions = step.options
    .map((option, optionIndex) => ({
      optionIndex,
      artworkFile: option.backgroundFile || option.imageFile || "",
      label: formatOptionLeaderboardLabel(option),
      count: getRepresentativeChoiceCount(step, option, optionIndex, votes),
      rankingCount: votes[option.rankingKey] || 0
    }))
    .sort((left, right) => {
      const countDelta = right.count - left.count;
      if (countDelta !== 0) {
        return countDelta;
      }

      const rankingDelta = right.rankingCount - left.rankingCount;
      if (rankingDelta !== 0) {
        return rankingDelta;
      }

      return left.optionIndex - right.optionIndex;
    });

  const winner = rankedOptions[0] || { artworkFile: "", label: "", count: 0, optionIndex: 0 };
  const total = rankedOptions.reduce((sum, option) => sum + option.count, 0);

  return {
    ...winner,
    total,
    share: total ? winner.count / total : 0
  };
}

function getCategoryProxyScore(representative, seedIndex) {
  const totalInfluence = Math.log1p(representative.total || 0) * 0.42;
  const winnerInfluence = representative.share * 2.2;
  const selectionInfluence = Math.min(representative.count || 0, 12) * 0.08;
  const seedInfluence = (state.experience.steps.length - seedIndex) * 0.035;

  return 1.35 + totalInfluence + winnerInfluence + selectionInfluence + seedInfluence;
}

function getRepresentativeChoiceCount(step, option, optionIndex, votes) {
  const directChoiceCount = votes[getOptionVoteKey(step.id, optionIndex)] || 0;
  if (directChoiceCount > 0) {
    return directChoiceCount;
  }

  return votes[option.rankingKey] || 0;
}

function formatOptionLeaderboardLabel(option) {
  const label = String(t(option.labelKey));
  const year = option.yearKey ? String(t(option.yearKey)) : "";
  const detail = option.detailKey ? ` ${String(t(option.detailKey))}` : "";

  if (year) {
    return `${label} - ${year}${detail}`;
  }

  return `${label}${detail}`;
}

function sortRankingItems(items) {
  return [...items].sort((left, right) => {
    const countDelta = right.count - left.count;
    if (countDelta !== 0) {
      return countDelta;
    }

    const proxyDelta = (right.proxyScore || 0) - (left.proxyScore || 0);
    if (Math.abs(proxyDelta) > Number.EPSILON) {
      return proxyDelta;
    }

    return left.seedIndex - right.seedIndex;
  });
}

function sortDisplayRankingItems(items) {
  return sortRankingItems(items);
}

function applyLeaderboardDisplaySmoothing(items) {
  const rankedItems = sortRankingItems(items);
  const minGap = rankedItems.length > 5 ? 0.2 : 0.26;
  let previousScore = Number.POSITIVE_INFINITY;

  return rankedItems.map((item, index) => {
    const rankBoost = (rankedItems.length - index) * 0.34;
    const rawDisplayScore = 1.6 + (item.count * 2.9) + item.proxyScore + rankBoost;

    if (!Number.isFinite(previousScore)) {
      previousScore = rawDisplayScore;
      return { ...item, displayScore: rawDisplayScore };
    }

    const floorScore = Math.max(0.72, 0.72 + ((rankedItems.length - index - 1) * minGap));
    const cappedScore = Math.min(rawDisplayScore, previousScore - minGap);
    const displayScore = Math.max(floorScore, cappedScore);

    previousScore = displayScore;
    return { ...item, displayScore };
  });
}

function formatRankingPercentage(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function loadVotes() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(state.experience.meta.storageKey)) || {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
        .map(([key, value]) => [key, Number(value)])
    );
  } catch {
    return {};
  }
}

function saveVotes(votes) {
  window.localStorage.setItem(state.experience.meta.storageKey, JSON.stringify(votes));
}

function incrementVote(votes, key) {
  votes[key] = (votes[key] || 0) + 1;
}

function getOptionVoteKey(stepId, optionIndex) {
  return `option.${stepId}.${optionIndex}`;
}

function getCategoryVoteKey(stepId) {
  return `category.${stepId}`;
}

function getRankingArtworkFile(rankingKey) {
  for (const step of state.experience.steps) {
    for (const option of step.options) {
      if (option.rankingKey === rankingKey) {
        return option.backgroundFile || option.imageFile || "";
      }
    }
  }

  return "";
}

function setArtworkVariable(element, fileName, variableName = "--artwork-image") {
  const artworkUrl = resolveArtworkUrl(fileName);
  if (!artworkUrl) {
    element.style.removeProperty(variableName);
    return;
  }

  element.style.setProperty(variableName, `url('${artworkUrl}')`);
}

function flushPendingSelection() {
  const pendingSelection = state.pendingSelection;
  state.pendingSelection = null;

  if (
    !pendingSelection
    || state.view !== "step"
    || state.resultOverlayVisible
    || pendingSelection.stepIndex !== state.currentStepIndex
  ) {
    return;
  }

  const selectedCard = sceneFrame.querySelector(
    `[data-action="select"][data-option-index="${pendingSelection.optionIndex}"]`
  );

  if (selectedCard) {
    void commitSelection(pendingSelection.optionIndex, selectedCard);
  }
}

function flushPendingNext() {
  const shouldMoveNext = state.pendingNext;
  state.pendingNext = false;

  if (
    shouldMoveNext
    && !state.transitionLock
    && state.view === "step"
    && state.resultOverlayVisible
  ) {
    void moveNext();
  }
}

function setHomeArtworkVariable(element, fileName) {
  const artworkUrl = resolveHomeArtworkUrl(fileName);
  if (!artworkUrl) {
    element.style.removeProperty("--tile-image");
    return;
  }

  element.style.setProperty("--tile-image", `url('${artworkUrl}')`);
}

function resolveArtworkUrl(fileName) {
  if (!fileName) {
    return "";
  }

  const assetUrl = new URL(`../ressource/images/artworks/${fileName}`, import.meta.url);
  assetUrl.searchParams.set("v", ASSET_VERSION);
  return assetUrl.href;
}

function resolveHomeArtworkUrl(fileName) {
  if (!fileName) {
    return "";
  }

  const assetUrl = new URL(`../ressource/images/artworks/thumbs/${fileName}`, import.meta.url);
  assetUrl.searchParams.set("v", ASSET_VERSION);
  return assetUrl.href;
}

function buildArtworkPool() {
  return [...new Set(
    state.experience.steps
      .flatMap((step) => step.options)
      .map((option) => option.imageFile || option.backgroundFile)
      .filter(Boolean)
  )];
}

function getHomeTileTargetRatio(tileIndex, tileElement = null) {
  const rect = tileElement?.getBoundingClientRect?.();
  if (rect?.width && rect?.height) {
    return rect.width / rect.height;
  }

  return HOME_TILE_RATIO_HINTS[tileIndex] || 1;
}

function getArtworkAspectScore(artworkRatio, targetRatio) {
  if (!artworkRatio || !targetRatio) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(Math.log(artworkRatio / targetRatio));
}

function filterCandidatesByTargetRatio(candidates, targetRatio) {
  if (!targetRatio) {
    return candidates;
  }

  const candidateRatios = candidates
    .map((fileName) => ({ fileName, ratio: state.artworkMetadata.get(fileName) || 0 }))
    .filter((candidate) => candidate.ratio);

  const filters = [];

  if (targetRatio >= 1.9) {
    filters.push((candidate) => candidate.ratio >= 1.75);
  } else if (targetRatio >= 1.35) {
    filters.push((candidate) => candidate.ratio >= 1.08);
  } else if (targetRatio <= 0.85) {
    filters.push((candidate) => candidate.ratio <= 0.95);
  } else {
    filters.push((candidate) => candidate.ratio >= 0.9 && candidate.ratio <= 1.4);
  }

  for (const filter of filters) {
    const filteredCandidates = candidateRatios.filter(filter).map((candidate) => candidate.fileName);
    if (filteredCandidates.length) {
      return filteredCandidates;
    }
  }

  return candidates;
}

function createHomeTiles() {
  const usedFiles = new Set();

  return Array.from({ length: 18 }, (_, tileIndex) => {
    const artworkFile = pickRandomArtwork({
      targetRatio: getHomeTileTargetRatio(tileIndex),
      disallowedFiles: [...usedFiles]
    });

    if (artworkFile) {
      usedFiles.add(artworkFile);
    }

    return artworkFile;
  });
}

function pickRandomArtwork(options = {}) {
  const {
    excludedFile = "",
    targetRatio = 0,
    disallowedFiles = []
  } = options;

  const bannedFiles = new Set(disallowedFiles.filter(Boolean));
  if (excludedFile) {
    bannedFiles.add(excludedFile);
  }

  let candidates = state.artworkPool.filter((fileName) => !bannedFiles.has(fileName));
  if (!candidates.length) {
    candidates = state.artworkPool.filter((fileName) => fileName !== excludedFile);
  }
  if (!candidates.length) {
    return excludedFile || "";
  }

  if (!targetRatio || !state.artworkMetadata.size) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  candidates = filterCandidatesByTargetRatio(candidates, targetRatio);

  const scoredCandidates = candidates
    .map((fileName) => ({
      fileName,
      score: getArtworkAspectScore(state.artworkMetadata.get(fileName), targetRatio)
    }))
    .sort((left, right) => left.score - right.score);

  const bestScore = scoredCandidates[0]?.score ?? Number.POSITIVE_INFINITY;
  const shortlist = scoredCandidates
    .filter((candidate) => candidate.score <= bestScore + 0.1)
    .slice(0, 4);

  const weightedPool = shortlist.length ? shortlist : scoredCandidates.slice(0, 3);
  const totalWeight = weightedPool.reduce(
    (sum, candidate) => sum + (1 / (candidate.score + 0.06)),
    0
  );

  let threshold = Math.random() * totalWeight;
  for (const candidate of weightedPool) {
    threshold -= 1 / (candidate.score + 0.06);
    if (threshold <= 0) {
      return candidate.fileName;
    }
  }

  return weightedPool[weightedPool.length - 1]?.fileName || candidates[0];
}

function preloadStepArtwork(stepIndex) {
  const step = state.experience?.steps?.[stepIndex];
  if (!step) {
    return;
  }

  const urls = new Set(
    step.options
      .flatMap((option) => [option.imageFile, option.backgroundFile])
      .map(resolveArtworkUrl)
      .filter(Boolean)
  );

  urls.forEach(preloadArtworkUrl);
}

function preloadArtworkUrl(url) {
  if (!url || preloadedArtworkUrls.has(url)) {
    return;
  }

  preloadedArtworkUrls.add(url);
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "low";
  activeArtworkPreloads.set(url, image);

  const release = () => {
    image.onload = null;
    image.onerror = null;
    activeArtworkPreloads.delete(url);
  };

  image.onload = release;
  image.onerror = release;
  image.src = url;
}

function queueBackgroundTask(task) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => task(), { timeout: 1200 });
    return;
  }

  window.setTimeout(task, 0);
}

function t(path) {
  const value = path.split(".").reduce((current, segment) => current?.[segment], state.messages);
  return value ?? path;
}

async function renderFatalError(error) {
  if (!sceneFrame) {
    return;
  }

  if (!state.messages) {
    try {
      const localePack = await loadMessages(DEFAULT_LOCALE, DEFAULT_LOCALE);
      state.messages = localePack.messages;
      state.locale = localePack.locale;
      syncLocalizedChrome();
    } catch (loadError) {
      console.error(loadError);
    }
  }

  sceneFrame.classList.remove("is-leaving", "is-entering");
  sceneFrame.classList.add("scene-frame-ready");
  sceneFrame.innerHTML = `
    <div class="scene-panel final-panel">
      <div class="scene-copy final-copy">
        <h1 class="scene-title">${escapeHtml(t("errors.experienceLoad.title"))}</h1>
        <p class="scene-text">${escapeHtml(t("errors.experienceLoad.text"))}</p>
      </div>
    </div>
  `;
}
