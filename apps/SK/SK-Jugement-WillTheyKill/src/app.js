let profiles = [];
let peerInsights = [];
let totalSteps = 0;
let translations = {};
let peerStats = {};
let userChoices = {};
let afkTimerId = null;

enableKioskHardening();

const PEER_STATS_STORAGE_KEY = "wtk_peer_stats";
const USER_CHOICES_STORAGE_KEY = "wtk_user_choices";
const AFK_TIMEOUT_MS = 60 * 1000;

function enableKioskHardening() {
    const stopEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };

    document.addEventListener("contextmenu", stopEvent, { capture: true });
    document.addEventListener("selectstart", stopEvent, { capture: true });
    document.addEventListener("dragstart", stopEvent, { capture: true });
    document.addEventListener("dblclick", stopEvent, { capture: true });
    document.addEventListener("copy", stopEvent, { capture: true });
    document.addEventListener("cut", stopEvent, { capture: true });
    document.addEventListener("paste", stopEvent, { capture: true });

    document.addEventListener(
        "wheel",
        (event) => {
            if (event.ctrlKey || event.metaKey) {
                stopEvent(event);
            }
        },
        { passive: false, capture: true },
    );

    document.addEventListener(
        "touchstart",
        (event) => {
            if (event.touches && event.touches.length > 1) {
                stopEvent(event);
            }
        },
        { passive: false, capture: true },
    );

    document.addEventListener(
        "touchmove",
        (event) => {
            if (event.touches && event.touches.length > 1) {
                stopEvent(event);
            }
        },
        { passive: false, capture: true },
    );

    document.addEventListener("gesturestart", stopEvent, { passive: false, capture: true });
    document.addEventListener("gesturechange", stopEvent, { passive: false, capture: true });
    document.addEventListener("gestureend", stopEvent, { passive: false, capture: true });

    document.addEventListener(
        "pointerdown",
        (event) => {
            if (event.button === 2) {
                stopEvent(event);
            }
        },
        { capture: true },
    );

    document.addEventListener("auxclick", stopEvent, { capture: true });

    window.addEventListener(
        "keydown",
        (event) => {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }

            const zoomKeys = new Set(["+", "-", "0", "=", "_"]);
            if (zoomKeys.has(event.key)) {
                stopEvent(event);
            }
        },
        { capture: true },
    );

    const disableImageDragging = () => {
        document.querySelectorAll("img").forEach((img) => {
            img.setAttribute("draggable", "false");
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", disableImageDragging, { once: true });
    } else {
        disableImageDragging();
    }
}

const experience = document.querySelector(".experience");
const screens = Array.from(document.querySelectorAll(".screen"));
const nextButton = document.querySelector('.nav-button[data-action="next"]');
const resetButton = document.querySelector('.nav-button[data-action="reset"]');
const brandingEyebrow = document.querySelector(".branding__eyebrow");
const brandingTitle = document.querySelector(".branding__title");
const introHeroTitle = document.getElementById("intro-hero-title");
const introHeroCopy = document.getElementById("intro-hero-copy");
const introHowTitle = document.getElementById("intro-how-title");
const introHowSteps = document.getElementById("intro-how-steps");
const introGoalTitle = document.getElementById("intro-goal-title");
const introGoalCopy = document.getElementById("intro-goal-copy");
const profileProgressLabel = document.getElementById("profile-progress-label");
const profileProgressConnector = document.getElementById("profile-progress-connector");
const profileTagline = document.getElementById("profile-tagline");
const profileAlias = document.getElementById("profile-alias");
const profileEra = document.getElementById("profile-era");
const profilePhotoImg = document.getElementById("profile-photo-img");
const profilePhotoFallback = document.getElementById("profile-photo-fallback");
const profileSummary = document.getElementById("profile-summary");
const profileHighlights = document.getElementById("profile-highlights");
const profileIndexLabel = document.getElementById("profile-index");
const profileTotalLabel = document.getElementById("profile-total");
const profileReveal = document.getElementById("profile-reveal");
const profileDecision = document.querySelector(".profile__decision");
const decisionButtons = Array.from(document.querySelectorAll(".decision-button"));
const decisionTitle = document.getElementById("decision-title");
const decisionPrompt = document.getElementById("decision-prompt");
const scoreSummary = document.getElementById("score-summary");
const scoreTotal = document.getElementById("score-total");
const scoreNote = document.getElementById("score-note");
const scoreEyebrow = document.getElementById("score-eyebrow");
const scoreTitle = document.getElementById("score-title");
const scoreDialLabel = document.getElementById("score-dial-label");
const scoreDiscussionTitle = document.getElementById("score-discussion-title");
const peerLabelYes = document.getElementById("peer-label-yes");
const peerLabelNo = document.getElementById("peer-label-no");
const peerChart = document.getElementById("peer-chart");
const progressTrack = document.getElementById("experience-progress");
const progressFill = progressTrack
    ? progressTrack.querySelector(".experience__progress-fill")
    : null;

const state = {
    currentStep: 0,
    answers: [],
};
const willTheyKillTracking = window.EHTracking
    ? window.EHTracking.createTracker({ exhibition: "SK", application: "SK-Jugement-WillTheyKill" })
    : null;

function getWillTheyKillTrackingPercentage() {
    const activitySteps = Math.max(totalSteps - 1, 1);
    return window.EHTracking.calculateStepPercentage(Math.max(state.currentStep - 1, 0), activitySteps);
}

function trackWillTheyKillProgress() {
    if (!willTheyKillTracking || !window.EHTracking || state.currentStep === 0) {
        return;
    }

    const percentage = getWillTheyKillTrackingPercentage();
    if (!willTheyKillTracking.hasStarted()) {
        void willTheyKillTracking.start(percentage);
        return;
    }

    void willTheyKillTracking.track(percentage);
}

window.addEventListener("i18n:changed", () => {
    void handleLanguageChange();
});

bootstrap();

async function bootstrap() {
    try {
        if (window.i18n?.ready) {
            await window.i18n.ready;
        }

        const loadedTranslations = window.i18n?.data;
        const loadedProfiles = await fetchJson("ressource/data/profiles.json");

        if (!loadedTranslations || typeof loadedTranslations !== "object") {
            throw new Error("Unable to load translation data from i18n runtime.");
        }

        applyTranslationsData(loadedTranslations);
        applyProfileData(loadedProfiles);
        hydratePeerStats();
        init();
    } catch (error) {
        handleDataLoadError(error);
    }
}

async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
        const errorTemplate = t("errors.fetchFailed");
        const errorMessage = formatTemplate(errorTemplate, { path, status: response.status });
        throw new Error(errorMessage);
    }
    return response.json();
}

function applyTranslationsData(data) {
    translations = data || {};
    applyStaticCopy();
}

async function handleLanguageChange() {
    if (window.i18n?.ready) {
        await window.i18n.ready;
    }

    const loadedTranslations = window.i18n?.data;
    if (!loadedTranslations || typeof loadedTranslations !== "object") {
        console.error("Unable to load translation data from i18n runtime.");
        return;
    }

    applyTranslationsData(loadedTranslations);
    syncPeerStatLabels();
    renderStep();
}

function syncPeerStatLabels() {
    profiles.forEach((profile, index) => {
        const key = getProfileKey(profile, index);
        const entry = ensurePeerStatEntry(key, profile, index);
        const defaultProfileLabel = t("profile.defaultProfilePrefix") + String(index + 1).padStart(2, "0");
        const labelFromCopy = profile?.copyKey ? t(`${profile.copyKey}.label`, "") : "";
        const identityFromCopy = profile?.copyKey ? t(`${profile.copyKey}.reveal.identity`, "") : "";

        entry.alias = labelFromCopy || defaultProfileLabel;
        entry.name = identityFromCopy || "";
    });

    updatePeerInsights();
}

function applyProfileData(data) {
    profiles = Array.isArray(data) ? data : [];
    totalSteps = profiles.length + 2;
    state.currentStep = 0;
    state.answers = Array(profiles.length).fill(null);
}

function handleDataLoadError(error) {
    const errorPrefix = t("errors.bootstrap");
    console.error(errorPrefix, error);
    if (experience) {
        const errorMessage = t("errors.profiles");
        experience.innerHTML = `<p class="experience__error">${errorMessage}</p>`;
    }
}

function applyStaticCopy() {
    document.title = t("meta.title");

    setElementText(brandingEyebrow, "branding.eyebrow");
    setElementText(brandingTitle, "branding.title");
    setElementText(introHeroTitle, "intro.heroTitle");
    setElementText(introHeroCopy, "intro.heroCopy");
    setElementText(introHowTitle, "intro.howTitle");
    renderList(introHowSteps, t("intro.howSteps", []));
    setElementText(introGoalTitle, "intro.goalTitle");
    setElementText(introGoalCopy, "intro.goalCopy");
    setElementText(decisionTitle, "profile.decisionTitle");
    setElementText(decisionPrompt, "profile.decisionPrompt");

    decisionButtons.forEach((button) => {
        const key =
            button.dataset.choice === "yes"
                ? t("profile.choiceYes")
                : t("profile.choiceNo");
        button.textContent = key;
    });

    setElementText(scoreEyebrow, "score.eyebrow");
    setElementText(scoreTitle, "score.title");
    setElementText(scoreDialLabel, "score.dialLabel");
    setElementText(scoreDiscussionTitle, "score.discussionTitle");
    setElementText(peerLabelYes, "score.peerYes");
    setElementText(peerLabelNo, "score.peerNo");
    setElementText(scoreSummary, "score.calculating");
    setElementText(resetButton, "navigation.restart");

    if (profileProgressLabel) {
        const label = t("profile.progressLabel");
        profileProgressLabel.textContent = label ? `${label} ` : "";
    }
    if (profileProgressConnector) {
        const connector = t("profile.progressConnector");
        profileProgressConnector.textContent = connector ? ` ${connector} ` : "";
    }

    if (progressTrack) {
        const progressLabel = t("experience.progressAria");
        progressTrack.setAttribute("aria-label", progressLabel);
    }
}

function hydratePeerStats() {
    userChoices = loadUserChoices();
    peerStats = loadPeerStats(profiles);
    updatePeerInsights();
    savePeerStats();
}

function init() {
    attachNavigation();
    attachDecisionHandlers();
    attachResetHandler();
    setupAfkTimer();
    renderStep();
}

function attachNavigation() {
    nextButton.addEventListener("click", () => {
        if (state.currentStep === totalSteps - 1) {
            restartExperience();
            return;
        }

        if (state.currentStep === 0) {
            goToStep(1);
            return;
        }

        if (isProfileStep(state.currentStep)) {
            const profileIndex = state.currentStep - 1;
            if (!state.answers[profileIndex]) {
                flagDecisionAttention();
                return;
            }
        }

        goToStep(state.currentStep + 1);
    });
}

function attachDecisionHandlers() {
    decisionButtons.forEach((button) => {
        button.addEventListener("click", () => {
            if (!isProfileStep(state.currentStep)) {
                return;
            }
            const choice = button.dataset.choice;
            const profileIndex = state.currentStep - 1;
            state.answers[profileIndex] = choice;
            recordPeerChoice(profileIndex, choice);
            profileDecision.classList.remove("is-attention");
            renderProfile(profileIndex);
            updateNavigationState();
        });
    });
}

function attachResetHandler() {
    if (!resetButton) {
        return;
    }
    resetButton.addEventListener("click", () => {
        restartExperience(true);
    });
}

function renderStep() {
    if (experience) {
        experience.setAttribute("data-step-index", String(state.currentStep));
        experience.setAttribute("data-step-key", getStepKey(state.currentStep));
    }

    screens.forEach((screen) => {
        const isActive = screen.dataset.screen === getStepKey(state.currentStep);
        screen.setAttribute("data-active", isActive ? "true" : "false");
    });

    updateProgressBar();
    updateNavigationState();

    if (state.currentStep === 0) {
        return;
    }

    if (isProfileStep(state.currentStep)) {
        renderProfile(state.currentStep - 1);
        return;
    }

    renderScore();
}

function renderProfile(index) {
    const profile = profiles[index];
    if (!profile) {
        return;
    }

    const profileCopy = profile.copyKey ? t(profile.copyKey, {}) : {};
    const profileRevealCopy = profile.copyKey ? t(`${profile.copyKey}.reveal`, {}) : {};

    renderProfilePhoto(profile, Boolean(state.answers[index]));

    profileIndexLabel.textContent = String(index + 1).padStart(2, "0");
    profileTotalLabel.textContent = String(profiles.length).padStart(2, "0");
    profileTagline.textContent = profileCopy.tagline || t("profile.taglineFallback");
    profileAlias.textContent = profileCopy.alias || t("profile.aliasFallback");
    profileEra.textContent = profileCopy.era || "";
    profileSummary.textContent = profileCopy.summary || "";

    const highlights = Array.isArray(profileCopy.highlights) ? profileCopy.highlights : [];
    profileHighlights.innerHTML = highlights.map((item) => `<li>${item}</li>`).join("");

    decisionButtons.forEach((button) => {
        const isActive = state.answers[index] === button.dataset.choice;
        button.setAttribute("data-active", isActive ? "true" : "false");
    });

    if (!state.answers[index]) {
        profileDecision.classList.remove("is-revealed");
        const placeholder = t(
            "profile.revealPlaceholder"
        );
        profileReveal.innerHTML = `<p class="reveal-placeholder">${placeholder}</p>`;
        return;
    }

    const { outcome } = profile.reveal || {};
    const identity = profileRevealCopy.identity || "";
    const verdict = profileRevealCopy.verdict || "";
    const detail = profileRevealCopy.detail || "";
    const userChoice = state.answers[index];
    const correctAnswer = profile.correctAnswer;
    const isCorrect = Boolean(userChoice && correctAnswer && userChoice === correctAnswer);
    const outcomeLabel =
        outcome === "yes"
            ? t("profile.outcomeYes")
            : t("profile.outcomeNo");
    const isLastProfile = index === profiles.length - 1;
    const nextLabel = isLastProfile
        ? t("profile.revealFinal")
        : t("profile.revealNext");
    const revealLabel = t("profile.revealLabel");

    profileDecision.classList.add("is-revealed");

    const verdictTitle = t("profile.verdictTitle");
    const detailTitle = t("profile.detailTitle");
    const correctLabel = t("profile.correctLabel");
    const incorrectLabel = t("profile.incorrectLabel");
    const statusLabel = isCorrect ? correctLabel : incorrectLabel;

    profileReveal.innerHTML = `
        <div class="reveal__status" data-correct="${isCorrect ? "true" : "false"}">
            <span class="reveal__badge">${statusLabel}</span>
            <h4>${identity || ""}</h4>
        </div>
        <p class="reveal-outcome" data-outcome="${outcome}">${outcomeLabel}</p>
        <div class="reveal__body">
            <div class="reveal__item">
                <h5 class="reveal__title">${verdictTitle}</h5>
                <p>${verdict || ""}</p>
            </div>
            <div class="reveal__item">
                <h5 class="reveal__title">${detailTitle}</h5>
                <p>${detail || ""}</p>
            </div>
        </div>
        <button type="button" class="reveal-next">${nextLabel}</button>
    `;

    const revealNextButton = profileReveal.querySelector(".reveal-next");
    if (revealNextButton) {
        revealNextButton.addEventListener("click", () => {
            goToStep(state.currentStep + 1);
        });
    }
}

function formatChoiceShort(value) {
    if (value === "yes") {
        return t("profile.choiceYesShort");
    }
    if (value === "no") {
        return t("profile.choiceNoShort");
    }
    return t("formatAnswer.none");
}

function renderProfilePhoto(profile, isRevealed) {
    if (!profilePhotoImg || !profilePhotoFallback) {
        return;
    }

    if (!isRevealed) {
        const maskedSrc = profile?.reveal?.maskedImage || profile?.maskedImage || "";
        if (maskedSrc) {
            profilePhotoImg.src = maskedSrc;
            profilePhotoImg.style.display = "block";
            profilePhotoFallback.style.display = "none";
            profilePhotoFallback.textContent = "";
            return;
        }

        profilePhotoImg.removeAttribute("src");
        profilePhotoImg.style.display = "none";
        profilePhotoFallback.style.display = "grid";
        profilePhotoFallback.textContent = t("profile.fallbackImage");
        return;
    }

    const identity = profile?.copyKey ? t(`${profile.copyKey}.reveal.identity`, "") : "";
    const imageSrc = profile?.reveal?.image || profile?.image || "";

    if (imageSrc) {
        profilePhotoImg.src = imageSrc;
        profilePhotoImg.style.display = "block";
        profilePhotoFallback.style.display = "none";
        profilePhotoFallback.textContent = "";
        return;
    }

    profilePhotoImg.removeAttribute("src");
    profilePhotoImg.style.display = "none";
    profilePhotoFallback.style.display = "grid";
    profilePhotoFallback.textContent = getInitials(identity) || t("profile.fallbackImage");
}

function getInitials(name) {
    if (!name || typeof name !== "string") {
        return "";
    }
    const parts = name
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
    const first = parts[0]?.[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
    return (first + last).toUpperCase();
}

function renderScore() {
    const correctCount = state.answers.reduce((total, answer, index) => {
        return total + (answer === profiles[index].correctAnswer ? 1 : 0);
    }, 0);

    const summaryTemplate = t("score.summaryTemplate");
    scoreSummary.textContent = formatTemplate(summaryTemplate, { count: profiles.length });
    scoreTotal.textContent = `${correctCount} / ${profiles.length}`;
    scoreNote.textContent = buildScoreNote(correctCount, profiles.length);

    renderPeerChart();
}

function renderPeerChart() {
    if (!peerChart) {
        return;
    }

    const yesLabel = t("score.peerYes");
    const noLabel = t("score.peerNo");
    const ariaTemplate = t("peer.ariaLabel");

    peerChart.innerHTML = peerInsights
        .map((insight) => {
            const yesValue = Math.round(insight.yes);
            const noValue = Math.round(insight.no);
            const profileLabel = extractProfileLabel(insight.alias);
            const displayName = insight.name || "";
            const ariaLabel = formatTemplate(ariaTemplate, {
                name: displayName || profileLabel,
                yes: yesValue,
                no: noValue,
                yesLabel,
                noLabel,
            });
            return `
                <li class="peer-chart__item">
                    <span class="peer-chart__profile">${profileLabel}</span>
                    <span class="peer-chart__name">${displayName}</span>
                    <div class="peer-chart__track" role="img" aria-label="${ariaLabel}">
                        <span class="peer-chart__fill" style="width: ${yesValue}%"></span>
                    </div>
                    <span class="peer-chart__stats">
                        <span data-choice="yes">${yesLabel} ${yesValue}%</span>
                        <span aria-hidden="true">${t("score.separator")}</span>
                        <span data-choice="no">${noLabel} ${noValue}%</span>
                    </span>
                </li>
            `;
        })
        .join("");
}

function updatePeerInsights() {
    peerInsights = Object.values(peerStats).map((entry) => {
        const yesCount = normalizeCount(entry.yes);
        const noCount = normalizeCount(entry.no);
        const total = Math.max(1, yesCount + noCount);
        return {
            alias: entry.alias,
            name: entry.name,
            yes: (yesCount / total) * 100,
            no: (noCount / total) * 100,
        };
    });
}

function recordPeerChoice(profileIndex, choice) {
    const profile = profiles[profileIndex];
    if (!profile || !choice) {
        return;
    }

    const key = getProfileKey(profile, profileIndex);
    const statsEntry = ensurePeerStatEntry(key, profile, profileIndex);
    const previousChoice = userChoices[key];

    if (previousChoice === choice) {
        return;
    }

    if (previousChoice && statsEntry[previousChoice] !== undefined) {
        statsEntry[previousChoice] = Math.max(1, statsEntry[previousChoice] - 1);
    }

    statsEntry[choice] = normalizeCount(statsEntry[choice]) + 1;
    userChoices[key] = choice;
    savePeerStats();
    saveUserChoices();
    updatePeerInsights();
}

function loadPeerStats(profileList) {
    const stored = parseStoredValue(PEER_STATS_STORAGE_KEY);
    const stats = {};

    profileList.forEach((profile, index) => {
        const key = getProfileKey(profile, index);
        const entry = stored[key] || {};
        const defaultProfileLabel = t("profile.defaultProfilePrefix") + String(index + 1).padStart(2, "0");
        const labelFromCopy = profile?.copyKey ? t(`${profile.copyKey}.label`, "") : "";
        const identityFromCopy = profile?.copyKey ? t(`${profile.copyKey}.reveal.identity`, "") : "";
        stats[key] = {
            alias: labelFromCopy || defaultProfileLabel,
            name: identityFromCopy || "",
            yes: normalizeCount(entry.yes),
            no: normalizeCount(entry.no),
        };
    });

    return stats;
}

function savePeerStats() {
    if (typeof localStorage === "undefined") {
        return;
    }
    localStorage.setItem(PEER_STATS_STORAGE_KEY, JSON.stringify(peerStats));
}

function loadUserChoices() {
    return parseStoredValue(USER_CHOICES_STORAGE_KEY);
}

function saveUserChoices() {
    if (typeof localStorage === "undefined") {
        return;
    }
    localStorage.setItem(USER_CHOICES_STORAGE_KEY, JSON.stringify(userChoices));
}

function ensurePeerStatEntry(key, profile, index) {
    if (!peerStats[key]) {
        const defaultProfileLabel = t("profile.defaultProfilePrefix") + String(index + 1).padStart(2, "0");
        const labelFromCopy = profile?.copyKey ? t(`${profile.copyKey}.label`, "") : "";
        const identityFromCopy = profile?.copyKey ? t(`${profile.copyKey}.reveal.identity`, "") : "";
        peerStats[key] = {
            alias: labelFromCopy || defaultProfileLabel,
            name: identityFromCopy || "",
            yes: 1,
            no: 1,
        };
    }
    return peerStats[key];
}

function removeUserContributions() {
    Object.entries(userChoices || {}).forEach(([key, choice]) => {
        const entry = peerStats[key];
        if (entry && entry[choice] !== undefined) {
            entry[choice] = Math.max(1, normalizeCount(entry[choice]) - 1);
        }
    });
    userChoices = {};
    savePeerStats();
    saveUserChoices();
    updatePeerInsights();
}

function extractProfileLabel(alias) {
    if (!alias) {
        return t("profile.profileLabelDefault");
    }
    const [label] = alias.split("-");
    const normalized = label ? label.trim() : alias;
    return normalized || t("profile.profileLabelDefault");
}

function getProfileKey(profile, index) {
    if (profile?.id) {
        return profile.id;
    }
    return `profile-${index + 1}`;
}

function normalizeCount(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) {
        return 1;
    }
    return numberValue;
}

function parseStoredValue(key) {
    if (typeof localStorage === "undefined") {
        return {};
    }
    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        const warningTemplate = t("errors.storageWarning");
        const warningMessage = formatTemplate(warningTemplate, { key });
        console.warn(warningMessage, error);
        return {};
    }
}

function buildScoreNote(correct, total) {
    const ratio = correct / total;
    if (ratio === 1) {
        return t("score.notes.perfect");
    }
    if (ratio >= 0.75) {
        return t("score.notes.high");
    }
    if (ratio >= 0.5) {
        return t("score.notes.medium");
    }
    return t("score.notes.low");
}

function formatAnswer(answer) {
    if (answer === "yes") {
        return t("formatAnswer.yes");
    }
    if (answer === "no") {
        return t("formatAnswer.no");
    }
    return t("formatAnswer.none");
}

function updateProgressBar() {
    if (!progressTrack || !totalSteps) {
        return;
    }

    const currentValue = state.currentStep + 1;
    const constrainedValue = Math.min(Math.max(currentValue, 1), totalSteps);
    const fillPercent = (constrainedValue / totalSteps) * 100;
    progressTrack.setAttribute("aria-valuemax", String(totalSteps));
    progressTrack.setAttribute("aria-valuenow", String(constrainedValue));

    if (progressFill) {
        progressFill.style.width = `${fillPercent}%`;
    }
}

function updateNavigationState() {
    const isIntro = state.currentStep === 0;
    const isScore = state.currentStep === totalSteps - 1;

    if (resetButton) {
        resetButton.style.display = isIntro ? "none" : "";
    }

    if (isIntro) {
        setButtonDisabled(nextButton, false);
        if (nextButton) {
            nextButton.style.display = "";
        }
        nextButton.textContent = t("navigation.start");
        return;
    }

    if (isScore) {
        setButtonDisabled(nextButton, false);
        if (nextButton) {
            nextButton.style.display = "none";
            nextButton.removeAttribute("data-needs-answer");
            nextButton.classList.remove("nav-button--attention");
        }
        return;
    }

    if (isProfileStep(state.currentStep)) {
        const profileIndex = state.currentStep - 1;
        const isAnswered = Boolean(state.answers[profileIndex]);
        setButtonDisabled(nextButton, !isAnswered);
        nextButton.textContent =
            profileIndex === profiles.length - 1
                ? t("navigation.viewFinal")
                : t("navigation.nextProfile");
        if (nextButton) {
            nextButton.setAttribute("data-needs-answer", isAnswered ? "false" : "true");
            nextButton.classList.toggle("nav-button--attention", !isAnswered);
            nextButton.style.display = "none";
        }
        return;
    }

    setButtonDisabled(nextButton, false);
    if (nextButton) {
        nextButton.removeAttribute("data-needs-answer");
        nextButton.classList.remove("nav-button--attention");
        nextButton.style.display = "";
    }
    nextButton.textContent = t("navigation.continue");
}

function setButtonDisabled(button, disabled) {
    if (!button) {
        return;
    }

    button.disabled = disabled;
    if (disabled) {
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("disabled", "disabled");
    } else {
        button.removeAttribute("disabled");
        button.removeAttribute("aria-disabled");
    }
}

function flagDecisionAttention() {
    profileDecision.classList.add("is-attention");
    profileDecision.addEventListener(
        "animationend",
        () => profileDecision.classList.remove("is-attention"),
        { once: true }
    );
}

function goToStep(stepIndex) {
    state.currentStep = Math.min(Math.max(stepIndex, 0), totalSteps - 1);
    renderStep();
    trackWillTheyKillProgress();
}

function restartExperience(clearUserData = true) {
    if (clearUserData) {
        removeUserContributions();
    }
    state.currentStep = 0;
    state.answers = Array(profiles.length).fill(null);
    decisionButtons.forEach((button) => button.removeAttribute("data-active"));
    profileDecision.classList.remove("is-revealed");
    const placeholder = t("profile.revealPlaceholder");
    profileReveal.innerHTML = `<p class="reveal-placeholder">${placeholder}</p>`;
    willTheyKillTracking?.reset();
    renderStep();
}

function isProfileStep(step) {
    return step > 0 && step < totalSteps - 1;
}

function getStepKey(step) {
    if (step === 0) {
        return "intro";
    }
    if (step === totalSteps - 1) {
        return "score";
    }
    return "profile";
}

function setElementText(element, key, fallback = "") {
    if (!element) {
        return;
    }
    element.textContent = t(key, fallback);
}

function renderList(listElement, items) {
    if (!listElement) {
        return;
    }

    if (!Array.isArray(items)) {
        listElement.innerHTML = "";
        return;
    }

    listElement.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function t(path, fallback = "") {
    if (!path) {
        return fallback;
    }

    const value = path.split(".").reduce((accumulator, part) => {
        if (accumulator && Object.prototype.hasOwnProperty.call(accumulator, part)) {
            return accumulator[part];
        }
        return undefined;
    }, translations);

    return value ?? fallback;
}

function formatTemplate(template, values = {}) {
    if (typeof template !== "string") {
        return "";
    }

    return template.replace(/\{(\w+)\}/g, (_, token) => {
        if (Object.prototype.hasOwnProperty.call(values, token)) {
            return values[token];
        }
        return "";
    });
}

function setupAfkTimer() {
    const resetAfkTimer = () => {
        if (afkTimerId) {
            clearTimeout(afkTimerId);
        }
        afkTimerId = window.setTimeout(handleAfkTimeout, AFK_TIMEOUT_MS);
    };

    ["pointerdown", "touchstart", "click", "scroll"].forEach((eventName) => {
        window.addEventListener(eventName, resetAfkTimer, { passive: true });
    });

    resetAfkTimer();
}

function handleAfkTimeout() {
    restartExperience(true);
}
