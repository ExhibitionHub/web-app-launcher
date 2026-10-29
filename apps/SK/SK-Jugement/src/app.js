const talliesKey = "aw-kiosk-tallies";
const talliesVersionKey = "aw-kiosk-tallies-version";
const voteKey = "aw-kiosk-vote";
const talliesVersion = "2";
const inactivityTimeoutMs = 1 * 60 * 1000;

const maxEvidenceItems = 6;

initKioskLock();

const baselineTallies = {
    death: 1,
    life: 1,
    insanity: 1
};

let language = null;
let labels = {};
let evidenceData = [];
let evidenceLoadState = "loading";

const kiosk = document.querySelector(".kiosk");
const screens = document.querySelectorAll(".screen");
const restartButton = document.querySelector('[data-action="restart"]');
const nextButton = document.querySelector('[data-action="next"]');
const evidenceList = document.getElementById("evidence-list");
const evidenceDetail = document.getElementById("evidence-detail");
const choiceButtons = document.querySelectorAll(".choice");
const verdictFeedback = document.getElementById("verdict-feedback");
const verdictTally = document.getElementById("verdict-tally");
const navAlert = document.getElementById("nav-alert");
const evidenceStatus = document.getElementById("evidence-status");
const chargesGrid = document.getElementById("charges-grid");
const howToList = document.getElementById("howto-list");
const titleTag = document.querySelector("title");
const evidenceNav = document.querySelector(".evidence__nav");

const chargesStep = Number(document.querySelector(".screen--charges")?.dataset.step) || null;
const evidenceStep =
    Number(document.querySelector(".screen--evidence")?.dataset.step) || (chargesStep ? chargesStep + 1 : 2);
const verdictStep = Number(document.querySelector(".screen--verdict")?.dataset.step) || evidenceStep + 1;
const resultsStepFromDom = Number(document.querySelector(".screen--results")?.dataset.step);

const totalSteps = screens.length;
const resultsStep = resultsStepFromDom || totalSteps;
let currentStep = Number(kiosk?.dataset.step) || 1;
let tallies = loadTallies();
let userVote = localStorage.getItem(voteKey);
const reviewedEvidence = new Set();
let navAlertTimeout = null;
let activeEvidence = null;
let inactivityTimer = null;
const judgementTracking = window.EHTracking
    ? window.EHTracking.createTracker({ exhibition: "SK", application: "SK-Jugement" })
    : null;

function getJudgementTrackingPercentage() {
    const activitySteps = Math.max(totalSteps - 1, 1);
    return window.EHTracking.calculateStepPercentage(Math.max(currentStep - 2, 0), activitySteps);
}

function trackJudgementProgress() {
    if (!judgementTracking || !window.EHTracking || currentStep <= 1) {
        return;
    }

    const percentage = getJudgementTrackingPercentage();
    if (!judgementTracking.hasStarted()) {
        void judgementTracking.start(percentage);
        return;
    }

    void judgementTracking.track(percentage);
}

choiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const choice = button.dataset.choice;
        registerVote(choice);
    });
});

window.addEventListener("i18n:changed", () => {
    void handleLanguageChange();
});

init();

function initKioskLock() {
    const prevent = (event) => {
        event.preventDefault();
        event.stopPropagation();
        return false;
    };

    document.addEventListener("contextmenu", prevent, { capture: true });
    document.addEventListener("selectstart", prevent, { capture: true });
    document.addEventListener("dragstart", prevent, { capture: true });
    document.addEventListener("drop", prevent, { capture: true });
    document.addEventListener("dragover", prevent, { capture: true });

    // Block right/middle clicks (keep left click working)
    document.addEventListener(
        "pointerdown",
        (event) => {
            if (typeof event.button === "number" && event.button !== 0) {
                prevent(event);
            }
        },
        { capture: true }
    );
    document.addEventListener(
        "auxclick",
        (event) => {
            if (typeof event.button === "number" && event.button !== 0) {
                prevent(event);
            }
        },
        { capture: true }
    );

    // Reduce accidental selections/zoom-on-double-click
    document.addEventListener("dblclick", prevent, { capture: true });

    // Prevent pinch zoom on touch
    const preventIfMultiTouch = (event) => {
        if (event.touches && event.touches.length > 1) {
            prevent(event);
        }
    };
    document.addEventListener("touchstart", preventIfMultiTouch, { capture: true, passive: false });
    document.addEventListener("touchmove", preventIfMultiTouch, { capture: true, passive: false });

    // Prevent Safari gesture zoom (iOS)
    window.addEventListener("gesturestart", prevent, { capture: true, passive: false });
    window.addEventListener("gesturechange", prevent, { capture: true, passive: false });
    window.addEventListener("gestureend", prevent, { capture: true, passive: false });

    // Prevent browser zoom via wheel/trackpad when modifier keys are held
    window.addEventListener(
        "wheel",
        (event) => {
            if (event.ctrlKey || event.metaKey) {
                prevent(event);
            }
        },
        { capture: true, passive: false }
    );

    // Prevent browser zoom shortcuts (Ctrl/Cmd +/-/0)
    window.addEventListener(
        "keydown",
        (event) => {
            const target = event.target;
            const isEditable =
                target instanceof Element &&
                (target.matches("input, textarea, select, [contenteditable='true']") ||
                    target.getAttribute("contenteditable") === "true");

            if (!isEditable) {
                // Kiosk: avoid any keyboard-driven interactions (navigation/zoom/etc).
                prevent(event);
                return;
            }

            if (!event.ctrlKey && !event.metaKey) {
                return;
            }
            const zoomKeys = new Set(["+", "=", "-", "_", "0"]);
            if (zoomKeys.has(event.key)) {
                prevent(event);
            }
        },
        { capture: true }
    );

    // If anything manages to select, immediately clear selection.
    document.addEventListener(
        "selectionchange",
        () => {
            const selection = window.getSelection?.();
            if (selection && selection.type !== "None") {
                selection.removeAllRanges();
            }
        },
        { passive: true }
    );

    // Disable dragging/callouts on images (including ones injected later).
    const lockMedia = (root = document) => {
        root.querySelectorAll?.("img").forEach((img) => {
            img.setAttribute("draggable", "false");
            img.addEventListener("dragstart", prevent, { capture: true });
            img.addEventListener("contextmenu", prevent, { capture: true });
        });
    };

    lockMedia(document);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (!(node instanceof Element)) {
                    return;
                }
                if (node.tagName === "IMG") {
                    lockMedia(node.parentElement || document);
                    return;
                }
                if (node.querySelector) {
                    lockMedia(node);
                }
            });
        });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

async function init() {
    await loadLanguage();
    initialiseStepper();
    setInitialVoteState();
    updateEvidenceStatus();
    renderEvidenceNav();
    renderTally();
    resetEvidenceDetail();
    startInactivityWatcher();
}

function loadTallies() {
    const storedVersion = localStorage.getItem(talliesVersionKey);
    const storedTallies = localStorage.getItem(talliesKey);
    if (storedVersion !== talliesVersion || !storedTallies) {
        const reset = { ...baselineTallies };
        persistTallies(reset);
        localStorage.setItem(talliesVersionKey, talliesVersion);
        localStorage.removeItem(voteKey);
        return reset;
    }
    try {
        const parsed = JSON.parse(storedTallies);
        const normalised = normalizeTallies(parsed);
        persistTallies(normalised);
        return normalised;
    } catch (err) {
        console.error("Failed to read stored tallies, resetting to baseline.");
        persistTallies(baselineTallies);
        localStorage.setItem(talliesVersionKey, talliesVersion);
        localStorage.removeItem(voteKey);
        return { ...baselineTallies };
    }
}

async function loadLanguage() {
    evidenceLoadState = "loading";
    try {
        if (window.i18n?.ready) {
            await window.i18n.ready;
        }

        const data = window.i18n?.data;
        if (!data || typeof data !== "object") {
            throw new Error("Failed to load language data from i18n runtime.");
        }

        language = data;
        labels = data?.verdict?.choices || {};
        evidenceData = Array.isArray(data?.evidenceData) ? data.evidenceData.slice(0, maxEvidenceItems) : [];
        evidenceLoadState = Array.isArray(evidenceData) ? "ready" : "error";
        applyLanguageCopy();
    } catch (error) {
        language = null;
        evidenceData = [];
        evidenceLoadState = "error";
        console.error("Failed to load language data.", error);
    }
}

async function handleLanguageChange() {
    await loadLanguage();
    syncEvidenceState();
    renderEvidenceNav();
    restoreActiveEvidence();
    updateEvidenceStatus();
    updateButtons();
    renderTally();
    refreshFeedback();
    updateNavButtons();
}

function syncEvidenceState() {
    const availableIds = new Set((Array.isArray(evidenceData) ? evidenceData : []).map((item) => item.id));

    Array.from(reviewedEvidence).forEach((id) => {
        if (!availableIds.has(id)) {
            reviewedEvidence.delete(id);
        }
    });

    if (activeEvidence && !availableIds.has(activeEvidence)) {
        activeEvidence = null;
    }
}

function restoreActiveEvidence() {
    if (!activeEvidence) {
        resetEvidenceDetail();
        return;
    }

    const item = evidenceData.find((entry) => entry.id === activeEvidence);
    if (!item) {
        resetEvidenceDetail();
        return;
    }

    renderEvidenceDetail(item);
    evidenceList?.querySelectorAll("button").forEach((button) => {
        const isActive = button.dataset.id === activeEvidence;
        button.dataset.active = isActive ? "true" : "false";
        button.dataset.reviewed = reviewedEvidence.has(button.dataset.id) ? "true" : "false";
    });
}

function applyLanguageCopy() {
    if (!language) {
        return;
    }
    setText(titleTag, language.meta?.pageTitle);
    setText(document.querySelector('[data-i18n="branding.eyebrow"]'), language.branding?.eyebrow);
    setText(document.querySelector('[data-i18n="branding.title"]'), language.branding?.title);
    setText(document.querySelector('[data-i18n="hero.title"]'), language.hero?.title);
    setText(document.querySelector('[data-i18n="hero.tagline"]'), language.hero?.tagline);
    setText(document.querySelector('[data-i18n="background.title"]'), language.background?.title);
    setText(document.querySelector('[data-i18n="background.copy"]'), language.background?.copy);
    setText(document.querySelector('[data-i18n="howTo.title"]'), language.howTo?.title);
    renderHowTo(language.howTo?.steps);
    setText(document.querySelector('[data-i18n="charges.title"]'), language.charges?.title);
    setText(document.querySelector('[data-i18n="charges.intro"]'), language.charges?.intro);
    renderCharges(language.charges?.items);
    setText(document.querySelector('[data-i18n="evidence.heading"]'), language.evidence?.heading);
    setText(document.querySelector('[data-i18n="evidence.subheading"]'), language.evidence?.subheading);
    setText(document.querySelector('[data-i18n="verdict.title"]'), language.verdict?.title);
    setText(document.querySelector('[data-i18n="verdict.prompt"]'), language.verdict?.prompt);
    setText(document.querySelector('[data-i18n="verdict.choices.death"]'), language.verdict?.choices?.death);
    setText(document.querySelector('[data-i18n="verdict.choices.life"]'), language.verdict?.choices?.life);
    setText(document.querySelector('[data-i18n="verdict.choices.insanity"]'), language.verdict?.choices?.insanity);
    setText(document.querySelector('[data-i18n="verdict.hint"]'), language.verdict?.hint);
    setText(document.querySelector('[data-i18n="results.title"]'), language.results?.title);
    setText(document.querySelector('[data-i18n="results.description"]'), language.results?.description);
    setText(document.querySelector('[data-i18n="results.footer"]'), language.results?.footer);
    setText(restartButton, getCopy("navigation.nextLabels.restart"));
    setText(nextButton, getCopy("navigation.continue"));
    setAttr(evidenceNav, "aria-label", getCopy("evidence.nav.ariaLabel"));
    resetEvidenceDetail();
}

function setText(node, text) {
    if (!node || typeof text !== "string") {
        return;
    }
    node.textContent = text;
}

function setAttr(node, attr, value) {
    if (!node || typeof attr !== "string" || typeof value !== "string") {
        return;
    }
    node.setAttribute(attr, value);
}

function renderHowTo(steps = []) {
    if (!howToList) {
        return;
    }
    howToList.innerHTML = "";
    steps.forEach((step) => {
        const li = document.createElement("li");
        li.textContent = step;
        howToList.appendChild(li);
    });
}

function renderCharges(items = []) {
    if (!chargesGrid) {
        return;
    }
    chargesGrid.innerHTML = "";
    items.forEach((item) => {
        const article = document.createElement("article");
        article.className = "charge-card";

        if (typeof item.image === "string" && item.image.trim() !== "") {
            article.classList.add("charge-card--image");
            const resolvedImage = new URL(item.image, document.baseURI).href;
            article.style.setProperty("--charge-bg", `url("${resolvedImage}")`);
        }

        const label = document.createElement("span");
        label.className = "charge-label";
        label.textContent = item.label;

        const title = document.createElement("h3");
        title.textContent = item.title;

        const summary = document.createElement("p");
        summary.textContent = item.summary;

        const factsList = document.createElement("ul");
        factsList.className = "charge-facts";
        item.facts?.forEach((fact) => {
            const factItem = document.createElement("li");
            const factLabel = document.createElement("span");
            factLabel.className = "charge-fact__label";
            factLabel.textContent = fact.label;
            factItem.appendChild(factLabel);
            factItem.append(` ${fact.text}`);
            factsList.appendChild(factItem);
        });

        article.appendChild(label);
        article.appendChild(title);
        article.appendChild(summary);
        article.appendChild(factsList);
        chargesGrid.appendChild(article);
    });
}

function initialiseStepper() {
    if (!kiosk || totalSteps === 0) {
        return;
    }

    goToStep(currentStep);

    restartButton?.addEventListener("click", () => {
        hideNavAlert();
        goToStep(1, { forceReset: true });
    });
    nextButton?.addEventListener("click", () => {
        if (currentStep === totalSteps) {
            goToStep(1);
        } else {
            goToStep(currentStep + 1);
        }
    });
}

function goToStep(step, options = {}) {
    if (!kiosk || totalSteps === 0) {
        return;
    }

    const forceReset = options.forceReset === true;
    const isRestart = forceReset || (currentStep === totalSteps && step === 1);
    let target = Math.min(Math.max(step, 1), totalSteps);

    if (target === verdictStep && !hasReviewedAllEvidence()) {
        showNavAlert(getCopy("navigation.alerts.reviewEvidenceFirst"));
        target = evidenceStep;
    } else if (target === resultsStep && !userVote) {
        showNavAlert(getCopy("navigation.alerts.castVoteToSeeResults"));
        target = verdictStep;
    } else {
        hideNavAlert();
    }

    if (isRestart) {
        resetExperience();
        judgementTracking?.reset();
    }

    currentStep = target;
    kiosk.dataset.step = String(currentStep);

    screens.forEach((section) => {
        section.dataset.active = section.dataset.step === String(currentStep) ? "true" : "false";
    });
    updateNavButtons();
    refreshFeedback();
    trackJudgementProgress();
}

function selectEvidence(id) {
    const item = evidenceData.find((entry) => entry.id === id);
    if (!item) {
        return;
    }
    reviewedEvidence.add(id);
    activeEvidence = id;
    evidenceList.querySelectorAll("button").forEach((button) => {
        const isActive = button.dataset.id === id;
        button.dataset.active = isActive ? "true" : "false";
        button.dataset.reviewed = reviewedEvidence.has(button.dataset.id) ? "true" : "false";
    });
    renderEvidenceDetail(item);
    updateEvidenceStatus();
    if (hasReviewedAllEvidence()) {
        hideNavAlert();
    }
    if (currentStep === evidenceStep) {
        updateNavButtons();
    }
}

function renderEvidenceDetail(item) {
    const detailItems = Array.isArray(item.details) ? item.details : [];
    const imageUrl = typeof item.image === "string" ? item.image.trim() : "";
    const imageMarkup = imageUrl
        ? `
            <aside class="detail-media" aria-label="${item.title}">
                <img src="${imageUrl}" alt="${item.title}" loading="lazy" decoding="async" />
            </aside>
        `
        : "";
    const detailMarkup = `
        <header class="detail-header">
            <h3>${item.title}</h3>
            <div class="detail-meta">
                <span>${item.type}</span>
            </div>
        </header>
        <div class="detail-body">
            <div class="detail-body__layout" data-has-image="${imageUrl ? "true" : "false"}">
                <div class="detail-text">
                    <p>${item.summary}</p>
                    <ul>
                        ${detailItems.map((paragraph) => `<li>${paragraph}</li>`).join("")}
                    </ul>
                    <p class="pull-quote">&ldquo;${item.quote}&rdquo;<br><span>${item.attribution}</span></p>
                </div>
                ${imageMarkup}
            </div>
        </div>
    `;
    evidenceDetail.innerHTML = detailMarkup;
}

function resetEvidenceDetail() {
    if (!evidenceDetail) {
        return;
    }
    const prompt = getCopy("evidence.nav.selectPrompt") || getCopy("placeholders.detailPrompt");
    evidenceDetail.innerHTML = `
        <div class="detail-placeholder">
            <p>${prompt || ""}</p>
        </div>
    `;
}

function renderEvidenceNav() {
    if (!evidenceList) {
        return;
    }
    evidenceList.innerHTML = "";
    if (!Array.isArray(evidenceData) || evidenceData.length === 0) {
        const placeholder = document.createElement("li");
        placeholder.className = "evidence__empty";
        const navCopy = language?.evidence?.nav || {};
        if (evidenceLoadState === "loading") {
            placeholder.textContent = navCopy.loading || "";
        } else if (evidenceLoadState === "error") {
            placeholder.textContent = navCopy.error || "";
        } else {
            placeholder.textContent = navCopy.empty || "";
        }
        evidenceList.appendChild(placeholder);
        return;
    }
    evidenceData.forEach((item) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.title;
        button.dataset.id = item.id;
        button.dataset.active = "false";
        button.dataset.reviewed = reviewedEvidence.has(item.id) ? "true" : "false";
        button.addEventListener("click", () => selectEvidence(item.id));
        li.appendChild(button);
        evidenceList.appendChild(li);
    });
}

function registerVote(choice) {
    const previous = userVote;
    if (previous === choice) {
        hideNavAlert();
        goToStep(resultsStep);
        return;
    }
    if (previous) {
        tallies[previous] = Math.max(0, tallies[previous] - 1);
    }
    tallies[choice] = (tallies[choice] || 0) + 1;
    userVote = choice;
    persistTallies(tallies);
    localStorage.setItem(voteKey, choice);
    updateButtons();
    renderTally();
    hideNavAlert();
    goToStep(resultsStep);
}

function setInitialVoteState() {
    updateButtons();
    refreshFeedback();
    updateNavButtons();
}

function updateButtons() {
    choiceButtons.forEach((button) => {
        const isActive = button.dataset.choice === userVote;
        button.dataset.active = isActive ? "true" : "false";
    });
}

function renderTally() {
    if (!verdictTally) {
        return;
    }
    const entries = Object.entries(labels);
    if (entries.length === 0) {
        verdictTally.innerHTML = "";
        return;
    }
    const total = Object.values(tallies).reduce((acc, value) => acc + value, 0);
    const rows = entries.map(([key, label]) => {
        const count = tallies[key];
        const percentage = total ? ((count / total) * 100).toFixed(1) : "0.0";
        const highlight = userVote === key;
        return `
            <div class="tally-row">
                <div class="tally-header">
                    <span class="tally-label">${label}</span>
                    <span class="tally-percentage">${percentage}%</span>
                </div>
                <div class="tally-bar">
                    <div class="tally-fill" data-highlight="${highlight}" style="width: ${percentage}%;"></div>
                </div>
            </div>
        `;
    });
    verdictTally.innerHTML = rows.join("");
}

function renderFeedback() {
    if (!verdictFeedback) {
        return;
    }
    if (!userVote) {
        verdictFeedback.textContent = getCopy("verdict.feedback.preVote");
        return;
    }
    const total = Object.values(tallies).reduce((acc, value) => acc + value, 0);
    const userShare = total ? ((tallies[userVote] / total) * 100).toFixed(1) : "0.0";
    const mostChosen = Object.keys(tallies).reduce(
        (prev, key) => (tallies[key] > tallies[prev] ? key : prev),
        Object.keys(tallies)[0]
    );
    const alignment =
        mostChosen === userVote
            ? getCopy("verdict.feedback.alignmentMatch")
            : getCopy("verdict.feedback.alignmentDifferent");
    const template = getCopy("verdict.feedback.template");
    verdictFeedback.textContent = formatString(template, {
        percentage: userShare,
        alignment: alignment
    });
}

function refreshFeedback() {
    if (!verdictFeedback) {
        return;
    }
    if (currentStep === resultsStep) {
        renderFeedback();
        return;
    }
    if (currentStep === verdictStep) {
        verdictFeedback.textContent = getCopy("verdict.feedback.verdictStep");
    } else {
        verdictFeedback.textContent = getCopy("verdict.feedback.otherStep");
    }
}

function getNextButtonLabel() {
    const nextLabels = language?.navigation?.nextLabels || {};
    if (currentStep === totalSteps) {
        return nextLabels.restart || "";
    }
    if (currentStep === 1) {
        return chargesStep ? nextLabels.seeCharges || nextLabels.continue || "" : nextLabels.reviewEvidence || "";
    }
    if (chargesStep && currentStep === chargesStep) {
        return nextLabels.reviewEvidence || "";
    }
    if (currentStep === evidenceStep) {
        return nextLabels.goToVerdict || nextLabels.continue || "";
    }
    if (currentStep === verdictStep) {
        return nextLabels.continue || "";
    }
    return nextLabels.continue || "";
}

function hasReviewedAllEvidence() {
    if (evidenceLoadState === "error") {
        return true;
    }
    if (evidenceLoadState !== "ready") {
        return false;
    }
    if (evidenceData.length === 0) {
        return true;
    }
    return reviewedEvidence.size >= evidenceData.length;
}

function updateEvidenceStatus() {
    if (!evidenceStatus) {
        return;
    }
    const statusCopy = language?.evidence?.status || {};
    if (evidenceLoadState === "loading") {
        evidenceStatus.textContent = statusCopy.loading || "";
        evidenceStatus.dataset.complete = "false";
        return;
    }
    if (evidenceLoadState === "error") {
        evidenceStatus.textContent = statusCopy.error || "";
        evidenceStatus.dataset.complete = "false";
        return;
    }
    const total = evidenceData.length;
    if (total === 0) {
        evidenceStatus.textContent = statusCopy.empty || "";
        evidenceStatus.dataset.complete = "true";
        return;
    }
    const reviewed = Math.min(reviewedEvidence.size, total);
    if (reviewed >= total) {
        evidenceStatus.textContent = statusCopy.complete || "";
        evidenceStatus.dataset.complete = "true";
    } else {
        const remaining = total - reviewed;
        evidenceStatus.textContent = formatString(statusCopy.incomplete, {
            reviewed,
            total,
            remaining
        });
        evidenceStatus.dataset.complete = "false";
    }
}

function updateNavButtons() {
    if (!nextButton) {
        return;
    }
    const disableOnEvidence = currentStep === evidenceStep && !hasReviewedAllEvidence();
    const disableOnVerdict = currentStep === verdictStep;
    const hideNext = currentStep === verdictStep || currentStep === resultsStep;
    const disableNext = disableOnEvidence || disableOnVerdict || hideNext;
    setButtonDisabled(nextButton, disableNext);
    nextButton.style.visibility = hideNext ? "hidden" : "";
    nextButton.textContent = getNextButtonLabel();
}

function setButtonDisabled(button, disabled) {
    if (!button) {
        return;
    }
    button.setAttribute("aria-disabled", disabled ? "true" : "false");
    button.disabled = disabled;
}

function showNavAlert(message) {
    if (!navAlert || !message) {
        return;
    }
    navAlert.textContent = message;
    navAlert.hidden = false;
    if (navAlertTimeout) {
        clearTimeout(navAlertTimeout);
    }
    navAlertTimeout = setTimeout(() => {
        hideNavAlert();
    }, 4000);
}

function hideNavAlert() {
    if (!navAlert) {
        return;
    }
    navAlert.textContent = "";
    navAlert.hidden = true;
    if (navAlertTimeout) {
        clearTimeout(navAlertTimeout);
        navAlertTimeout = null;
    }
}

function resetExperience() {
    if (userVote) {
        userVote = null;
        localStorage.removeItem(voteKey);
        updateButtons();
    }
    activeEvidence = null;
    reviewedEvidence.clear();
    renderEvidenceNav();
    resetEvidenceDetail();
    updateEvidenceStatus();
}

function getCopy(path, fallback = "") {
    if (!language || typeof path !== "string") {
        return fallback;
    }
    return path.split(".").reduce((acc, key) => {
        if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
            return acc[key];
        }
        return undefined;
    }, language) ?? fallback;
}

function formatString(template, values = {}) {
    if (typeof template !== "string") {
        return "";
    }
    return template.replace(/\{(\w+)\}/g, (_, key) => {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
            return values[key];
        }
        return `{${key}}`;
    });
}

function normalizeTallies(data) {
    const keys = Object.keys(baselineTallies);
    const normalised = { ...baselineTallies };
    keys.forEach((key) => {
        const value = Number(data?.[key]);
        normalised[key] = Number.isFinite(value) && value >= 0 ? value : baselineTallies[key];
    });
    return normalised;
}

function persistTallies(data) {
    localStorage.setItem(talliesKey, JSON.stringify(data));
}

function startInactivityWatcher() {
    // Kiosk: consider touch/click/scroll as activity.
    // Note: `scroll` does not bubble, so we attach it in capture phase.
    const events = ["pointerdown", "pointermove", "touchstart", "wheel"];
    events.forEach((eventName) => {
        document.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });

    document.addEventListener("scroll", resetInactivityTimer, { passive: true, capture: true });
    resetInactivityTimer();
}

function resetInactivityTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(handleInactivityTimeout, inactivityTimeoutMs);
}

function handleInactivityTimeout() {
    hideNavAlert();
    goToStep(1, { forceReset: true });
    resetInactivityTimer();
}
