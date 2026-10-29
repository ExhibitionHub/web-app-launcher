/**
 * Main Application Controller
 * Manages UI interactions and questionnaire flow
 */
function getCameraSessionApi() {
    try {
        if (window.__skPersonalityCameraSessionApi) {
            return window.__skPersonalityCameraSessionApi;
        }

        if (window.top?.__skPersonalityCameraSessionApi) {
            return window.top.__skPersonalityCameraSessionApi;
        }
    } catch {
    }

    return null;
}

const CAMERA_SECURE_CONTEXT_ERROR = 'Camera access requires HTTPS or localhost on the kiosk browser.';

class QuestionnaireApp {
    constructor() {
        this.questionnaire = new Questionnaire();
        this.currentScreen = 'welcome';
        this.selectedAnswerIndex = null;
        this.revealedStats = new Set();
        this.currentResult = null;
        this.idleTimer = null;
        this.lang = {};
        this.cameraPermissionState = 'idle';
        this.cameraPermissionPromise = null;
        this.startInProgress = false;
        this.languageChangePromise = null;
        this.tracking = window.EHTracking
            ? window.EHTracking.createTracker({ exhibition: 'SK', application: 'sk-personality' })
            : null;
        
        // Bind methods to preserve context
        this.handleAnswerClick = this.handleAnswerClick.bind(this);
        this.handleNextClick = this.handleNextClick.bind(this);
        this.handleStartClick = this.handleStartClick.bind(this);
        this.handleRestartClick = this.handleRestartClick.bind(this);
        this.handleLanguageChange = this.handleLanguageChange.bind(this);
        this.resetIdleTimer = this.resetIdleTimer.bind(this);
        this.handleIdleTimeout = this.handleIdleTimeout.bind(this);
        this.autoAdvanceTimeout = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing questionnaire app...');
        
        // Kiosk Mode: Disable context menu and developer shortcuts
        document.addEventListener('contextmenu', event => event.preventDefault());
        document.addEventListener('keydown', event => {
            // Disable F5, F12, Ctrl+R, Ctrl+Shift+I, Alt+F4 (browser level)
            if (
                event.key === 'F5' ||
                event.key === 'F12' ||
                (event.ctrlKey && event.key === 'r') ||
                (event.ctrlKey && event.shiftKey && event.key === 'I') ||
                (event.altKey && event.key === 'F4')
            ) {
                event.preventDefault();
            }
        });

        // Disable file drop
        document.addEventListener('dragover', event => event.preventDefault());
        document.addEventListener('drop', event => event.preventDefault());

        try {
            // Ensure language is loaded first
            if (window.i18n?.ready) {
                await window.i18n.ready;
            }

            this.lang = window.i18n?.data || {};
            if (this.questionnaire.setLang) {
                this.questionnaire.setLang(this.lang);
            }

            // Load questions data
            await this.questionnaire.loadQuestions();

            // Setup event listeners
            this.setupEventListeners();
            this.setupIdleTimer();
            window.addEventListener('i18n:changed', this.handleLanguageChange);
            
            // Apply static translations on first load
            if (window.i18n?.apply) {
                window.i18n.apply();
            }
            
            // Show welcome screen
            this.showScreen('welcome');
            this.ensureCameraPermission();

            console.log('App initialized successfully');
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showError(error.message);
        }
    }

    startExperienceTracking() {
        if (!this.tracking) {
            return;
        }

        void this.tracking.restart(5, { step: 'personality-start' });
    }

    getTrackingCheckpointPercentage(stage = 'question') {
        const totalQuestions = Math.max(1, this.questionnaire.getTotalQuestions());
        const questionIndex = Math.max(0, Math.min(this.questionnaire.currentQuestionIndex, totalQuestions - 1));
        const experienceStart = 5;
        const completionReserve = 4;
        const usableRange = 100 - experienceStart - completionReserve;
        const questionSpan = usableRange / totalQuestions;
        const checkpointOffsets = {
            question: 0.18,
            answer: 0.72,
        };
        const checkpointOffset = checkpointOffsets[stage] ?? checkpointOffsets.question;

        return Math.min(
            99,
            Math.round(experienceStart + (questionIndex * questionSpan) + (questionSpan * checkpointOffset))
        );
    }

    trackQuestionCheckpoint(stage) {
        if (!this.tracking) {
            return;
        }

        const questionNumber = Math.min(
            this.questionnaire.currentQuestionIndex + 1,
            Math.max(1, this.questionnaire.getTotalQuestions())
        );

        void this.tracking.track(this.getTrackingCheckpointPercentage(stage), {
            step: `profile-${questionNumber}-${stage}`,
        });
    }

    getText(key, fallback = '') {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            return value === key ? fallback : value;
        }
        return fallback;
    }

    getCameraPermissionErrorMessage(error) {
        const detail = this.getCameraErrorDetail(error);
        const template = this.getText(
            'ui.camera.permissionError',
            'Could not access camera. Please ensure you have a camera connected and have granted permission.\n\nDetails: {error}'
        );
        return template.replace('{error}', detail);
    }

    getCameraErrorDetail(error) {
        const errorName = String(error?.name || '').trim();
        const errorMessage = String(error?.message || '');
        const detailKeys = {
            AbortError: 'ui.camera.errors.generic',
            ConstraintNotSatisfiedError: 'ui.camera.errors.overconstrained',
            DevicesNotFoundError: 'ui.camera.errors.notFound',
            NotAllowedError: 'ui.camera.errors.notAllowed',
            NotFoundError: 'ui.camera.errors.notFound',
            NotReadableError: 'ui.camera.errors.notReadable',
            OverconstrainedError: 'ui.camera.errors.overconstrained',
            PermissionDeniedError: 'ui.camera.errors.notAllowed',
            TrackStartError: 'ui.camera.errors.notReadable'
        };

        if (errorMessage === CAMERA_SECURE_CONTEXT_ERROR) {
            return this.getText('ui.camera.errors.secureContext', CAMERA_SECURE_CONTEXT_ERROR);
        }

        if (detailKeys[errorName]) {
            return this.getText(detailKeys[errorName], 'Camera access failed.');
        }

        return this.getText('ui.camera.errors.generic', 'Camera access failed.');
    }

    async handleLanguageChange() {
        if (this.languageChangePromise) {
            return this.languageChangePromise;
        }

        this.languageChangePromise = (async () => {
            this.lang = window.i18n?.data || {};

            if (this.questionnaire.setLang) {
                this.questionnaire.setLang(this.lang);
            }

            await this.questionnaire.loadQuestions();

            if (window.i18n?.apply) {
                window.i18n.apply();
            }

            if (this.currentScreen === 'question') {
                await this.displayQuestion();
                return;
            }

            if (this.currentScreen === 'result' && this.questionnaire.isComplete()) {
                await this.renderResults({
                    submitProfileVote: false,
                    activateScreen: false,
                    launchResearch: false
                });
                return;
            }
        })().finally(() => {
            this.languageChangePromise = null;
        });

        return this.languageChangePromise;
    }

    buildPrimaryCameraConstraints() {
        return {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: false
        };
    }

    buildFallbackCameraConstraints() {
        return {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };
    }

    async requestCameraPermissionStream() {
        const cameraSessionApi = getCameraSessionApi();
        if (cameraSessionApi?.requestStream) {
            return cameraSessionApi.requestStream(
                this.buildPrimaryCameraConstraints(),
                this.buildFallbackCameraConstraints()
            );
        }

        try {
            return await navigator.mediaDevices.getUserMedia(this.buildPrimaryCameraConstraints());
        } catch (primaryError) {
            console.warn('Primary camera warmup failed, retrying with fallback constraints...', primaryError);
            return navigator.mediaDevices.getUserMedia(this.buildFallbackCameraConstraints());
        }
    }

    async ensureCameraPermission({ showAlert = false } = {}) {
        const cameraSessionApi = getCameraSessionApi();
        if (cameraSessionApi?.getActiveStream?.()) {
            this.cameraPermissionState = 'ready';
            return true;
        }

        if (this.cameraPermissionState === 'ready') {
            return true;
        }

        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            this.cameraPermissionState = 'unsupported';
            if (showAlert) {
                alert(this.getCameraPermissionErrorMessage(new Error(CAMERA_SECURE_CONTEXT_ERROR)));
            }
            return false;
        }

        if (this.cameraPermissionPromise) {
            return this.cameraPermissionPromise;
        }

        this.cameraPermissionState = 'requesting';

        this.cameraPermissionPromise = (async () => {
            try {
                const stream = await this.requestCameraPermissionStream();

                if (!cameraSessionApi) {
                    stream.getTracks().forEach((track) => track.stop());
                }

                this.cameraPermissionState = 'ready';
                return true;
            } catch (error) {
                console.warn('Camera permission warmup failed.', error);
                this.cameraPermissionState = 'blocked';
                if (showAlert) {
                    alert(this.getCameraPermissionErrorMessage(error));
                }
                return false;
            } finally {
                this.cameraPermissionPromise = null;
            }
        })();

        return this.cameraPermissionPromise;
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Welcome screen
        const startBtn = document.getElementById('start-btn');
        if (startBtn) {
            startBtn.addEventListener('click', this.handleStartClick);
        }

        // Question screen navigation
        const nextBtn = document.getElementById('next-btn');
        
        if (nextBtn) {
            nextBtn.addEventListener('click', this.handleNextClick);
        }

        // Result screen
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
            restartBtn.addEventListener('click', this.handleRestartClick);
        }
        const restartGlobalBtn = document.getElementById('restart-global-btn');
        if (restartGlobalBtn) {
            restartGlobalBtn.addEventListener('click', this.handleRestartClick);
        }

        // Keyboard navigation for accessibility
        document.addEventListener('keydown', (e) => {
            if (this.currentScreen === 'question') {
                if (e.key === 'ArrowRight' || e.key === 'Enter') {
                    this.handleNextClick();
                } else if (e.key >= '1' && e.key <= '4') {
                    const answerIndex = parseInt(e.key) - 1;
                    const answers = document.querySelectorAll('.answer');
                    if (answers[answerIndex]) {
                        this.handleAnswerClick(answerIndex);
                    }
                }
            } else if (this.currentScreen === 'welcome' && e.key === 'Enter') {
                this.handleStartClick();
            } else if (this.currentScreen === 'result' && e.key === 'Enter') {
                this.handleRestartClick();
            }
            this.resetIdleTimer();
        });

        // Pointer/touch activity resets idle timer
        ['pointerdown', 'pointermove', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, this.resetIdleTimer, { passive: true });
        });
    }

    /**
     * Show specified screen
     */
    showScreen(screenName) {
        const previousScreen = this.currentScreen;
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Show target screen
        const targetScreen = document.getElementById(`${screenName}-screen`);
        if (targetScreen) {
            setTimeout(() => {
                targetScreen.classList.add('active');
            }, 100);
        }

        this.currentScreen = screenName;

        // If leaving the result screen, stop research/camera
        if (previousScreen === 'result' && screenName !== 'result') {
            window.dispatchEvent(new Event('exit-research-mode'));
        }

        this.resetIdleTimer();
    }

    /**
     * Show error message
     */
    showError(message) {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            const title = this.getText('ui.error.title', 'ERROR');
            const subtitle = this.getText('ui.error.subtitle', 'Unable to load quiz data');
            const desc = this.getText('ui.error.message', 'Make sure your local server is running and that the language files are accessible.');
            const reloadLabel = this.getText('ui.error.reload', 'Reload');
            welcomeScreen.innerHTML = `
                <div class="container">
                    <h1 class="title">${title}</h1>
                    <div class="subtitle">${subtitle}</div>
                    <p class="description">
                        ${message}
                        <br><br>
                        ${desc}
                    </p>
                    <button onclick="location.reload()" class="btn-primary">${reloadLabel}</button>
                </div>
            `;
        }
        this.showScreen('welcome');
    }

    /**
     * Handle start button click
     */
    async handleStartClick() {
        if (this.startInProgress) {
            return;
        }

        this.startInProgress = true;
        console.log('Starting questionnaire...');
        const startBtn = document.getElementById('start-btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.classList.add('is-disabled');
        }

        try {
            await this.ensureCameraPermission();

            this.clearAutoAdvanceTimer();
            this.questionnaire.reset();
            this.selectedAnswerIndex = null;
            this.revealedStats.clear();
            this.startExperienceTracking();
            this.showScreen('question');
            this.displayQuestion();
            this.resetIdleTimer();
        } finally {
            this.startInProgress = false;
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.classList.remove('is-disabled');
            }
        }
    }

    /**
     * Handle restart button click
     */
    handleRestartClick() {
        console.log('Restarting questionnaire...');
        this.clearAutoAdvanceTimer();
        this.questionnaire.reset();
        this.selectedAnswerIndex = null;
        this.revealedStats.clear();
        this.showScreen('welcome');
        this.resetIdleTimer();
    }

    /**
     * Display current question
     */
    async displayQuestion() {
        this.clearAutoAdvanceTimer();

        const question = this.questionnaire.getCurrentQuestion();
        if (!question) {
            console.error('No question to display');
            return;
        }

        // Update question text
        const questionText = document.getElementById('question-text');
        if (questionText) {
            questionText.textContent = question.question;
        }

        // Update question counter
        const questionCounter = document.getElementById('question-counter');
        if (questionCounter) {
            const prefix = this.getText('ui.question.counterPrefix', 'Profile');
            questionCounter.textContent = `${prefix} ${String(this.questionnaire.currentQuestionIndex + 1).padStart(2, '0')} / ${this.questionnaire.getTotalQuestions()}`;
        }

        // Update progress bar
        this.updateProgressBar();

        const savedAnswer = this.questionnaire.getCurrentAnswer();
        const hasAnswer = Boolean(savedAnswer);
        if (hasAnswer) {
            this.revealedStats.add(this.questionnaire.currentQuestionIndex);
        }

        const shouldRevealStats = hasAnswer || this.revealedStats.has(this.questionnaire.currentQuestionIndex);

        // Get real stats asynchronously
        const stats = await this.questionnaire.getRealAnswerStatistics(this.questionnaire.currentQuestionIndex);

        // Display answers with contextual options
        this.displayAnswers(question.answers, stats, {
            revealStats: shouldRevealStats,
            locked: hasAnswer
        });

        // Restore previous answer if exists
        if (savedAnswer) {
            this.selectedAnswerIndex = savedAnswer.answerIndex;
            this.highlightAnswer(this.selectedAnswerIndex);
            this.setAnswerLockState(true);
        } else {
            this.selectedAnswerIndex = null;
            this.setAnswerLockState(false);
        }

        this.updateQuestionStatus(hasAnswer);
        this.trackQuestionCheckpoint('question');
    }

    /**
     * Display answers for current question with statistics
     */
    displayAnswers(answers, stats, options = {}) {
        const container = document.getElementById('answers-container');
        if (!container) return;

        container.innerHTML = '';
        container.classList.remove('locked-warning');

        const { revealStats = false, locked = false } = options;
        container.classList.toggle('locked', locked);
        container.classList.toggle('stats-visible', revealStats);

        answers.forEach((answer, index) => {
            const answerElement = document.createElement('div');
            answerElement.className = 'answer';
            answerElement.setAttribute('role', 'button');
            answerElement.setAttribute('data-index', index);
            
            const percentage = stats ? stats[index] : 0;
            const formattedIndex = String(index + 1).padStart(2, '0');
            const altTemplate = this.getText('ui.question.visualAlt', 'Visual clue {index}');
            const altText = altTemplate.replace('{index}', formattedIndex);
            
            const imagePath = (answer.image || '').trim();
            const hasImage = Boolean(imagePath);
            const sanitizedImagePath = imagePath.replace(/"/g, '&quot;');
            const imageMarkup = hasImage ? `
                <div class="answer-media">
                    <img src="${sanitizedImagePath}" alt="${altText}" loading="lazy" decoding="async">
                    <div class="answer-media-tint"></div>
                </div>
            ` : '';

            answerElement.innerHTML = `
                ${imageMarkup}
                <div class="answer-body">
                    <div class="answer-label">
                        <span class="answer-index">${formattedIndex}</span>
                        <span class="answer-text">${answer.text}</span>
                    </div>
                </div>
                <div class="answer-stats ${revealStats ? 'visible' : ''}">
                    <div class="answer-stat-bar">
                        <div class="answer-stat-fill" data-percentage="${percentage}" style="width: ${revealStats ? percentage : 0}%"></div>
                    </div>
                    <span class="answer-stat-number">${percentage}%</span>
                </div>
            `;

            if (hasImage) {
                answerElement.classList.add('answer--has-image');
            } else {
                answerElement.classList.remove('answer--has-image');
            }

            if (!locked) {
                answerElement.addEventListener('click', () => this.handleAnswerClick(index));
                answerElement.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        this.handleAnswerClick(index);
                    }
                });
            } else {
                answerElement.setAttribute('aria-disabled', 'true');
            }
            
            container.appendChild(answerElement);
        });

        if (revealStats) {
            this.revealStatsForCurrentQuestion();
        }
    }

    /**
     * Handle answer selection
     */
    async handleAnswerClick(answerIndex) {
        const alreadyAnswered = this.questionnaire.getCurrentAnswer();
        if (alreadyAnswered) {
            this.signalLockedState();
            return;
        }

        this.selectedAnswerIndex = answerIndex;
        
        // Record the answer locally
        this.questionnaire.recordAnswer(answerIndex);
        
        // Submit vote to global storage (fire and forget)
        this.questionnaire.submitAnswerVote(this.questionnaire.currentQuestionIndex, answerIndex);

        this.revealedStats.add(this.questionnaire.currentQuestionIndex);
        
        // Update visual feedback
        this.highlightAnswer(answerIndex);

        // Fetch updated stats including the new vote immediately
        const updatedStats = await this.questionnaire.getRealAnswerStatistics(this.questionnaire.currentQuestionIndex, answerIndex);
        
        // Update the DOM with new stats
        const container = document.getElementById('answers-container');
        if (container) {
            const answers = container.querySelectorAll('.answer');
            answers.forEach((answer, index) => {
                const percentage = updatedStats[index];
                const fill = answer.querySelector('.answer-stat-fill');
                const number = answer.querySelector('.answer-stat-number');
                
                if (fill) {
                    fill.setAttribute('data-percentage', percentage);
                }
                if (number) {
                    number.textContent = `${percentage}%`;
                }
            });
        }
        
        this.revealStatsForCurrentQuestion();
        this.setAnswerLockState(true);
        this.updateQuestionStatus(true);
        this.trackQuestionCheckpoint('answer');
        this.scheduleAutoAdvance();
        
        console.log(`Answer selected: ${answerIndex}`);
    }

    /**
     * Clear any pending auto-advance timers
     */
    clearAutoAdvanceTimer() {
        if (this.autoAdvanceTimeout) {
            clearTimeout(this.autoAdvanceTimeout);
            this.autoAdvanceTimeout = null;
        }
    }

    /**
     * Automatically advance after a short dwell
     */
    scheduleAutoAdvance() {
        this.clearAutoAdvanceTimer();
        this.autoAdvanceTimeout = setTimeout(() => {
            this.handleNextClick();
        }, 2400);
    }

    /**
     * Highlight selected answer
     */
    highlightAnswer(answerIndex) {
        // Remove previous selection
        document.querySelectorAll('.answer').forEach(answer => {
            answer.classList.remove('selected');
        });

        // Highlight selected answer
        const selectedAnswer = document.querySelector(`[data-index="${answerIndex}"]`);
        if (selectedAnswer) {
            selectedAnswer.classList.add('selected');
        }
    }

    /**
     * Toggle answer lock UI state
     */
    setAnswerLockState(isLocked) {
        const container = document.getElementById('answers-container');
        if (!container) return;

        container.classList.toggle('locked', isLocked);

        container.querySelectorAll('.answer').forEach(answer => {
            if (isLocked) {
                answer.setAttribute('aria-disabled', 'true');
            } else {
                answer.removeAttribute('aria-disabled');
            }
        });
    }

    /**
     * Reveal percentage bars once the player locks an answer
     */
    revealStatsForCurrentQuestion() {
        const container = document.getElementById('answers-container');
        if (!container) return;

        container.classList.add('stats-visible');

        container.querySelectorAll('.answer-stats').forEach(stats => {
            stats.classList.add('visible');
            const fill = stats.querySelector('.answer-stat-fill');
            if (fill) {
                const pct = fill.getAttribute('data-percentage') || '0';
                requestAnimationFrame(() => {
                    fill.style.width = `${pct}%`;
                });
            }
        });
    }

    /**
     * Update contextual helper text below each question
     */
    updateQuestionStatus(isLocked) {
        const status = document.getElementById('question-status');
        if (!status) return;

        if (isLocked) {
            status.textContent = this.getText('ui.question.statusLocked', 'Choice locked. Move to the next dossier.');
            status.classList.add('locked');
        } else {
            status.textContent = this.getText('ui.question.statusOpen', 'Choose once to reveal the secret stats.');
            status.classList.remove('locked');
        }
    }

    /**
     * Quick visual feedback when attempting to change a locked choice
     */
    signalLockedState() {
        const container = document.getElementById('answers-container');
        if (!container) return;

        container.classList.add('locked-warning');
        setTimeout(() => container.classList.remove('locked-warning'), 600);
    }

    /**
     * Handle next button click
     */
    handleNextClick() {
        this.clearAutoAdvanceTimer();

        if (this.selectedAnswerIndex === null) {
            console.log('No answer selected');
            return;
        }

        // Move to next question or show results
        if (this.questionnaire.hasMoreQuestions()) {
            this.questionnaire.nextQuestion();
            this.selectedAnswerIndex = null;
            this.displayQuestion();
        } else {
            this.showResults();
        }
    }

    /**
     * Update progress bar
     */
    updateProgressBar() {
        const progressFill = document.getElementById('progress-fill');
        if (progressFill) {
            const percentage = this.questionnaire.getProgressPercentage();
            progressFill.style.width = `${percentage}%`;
        }
    }

    /**
     * Show results screen with personality profile and charts
     */
    async showResults() {
        await this.renderResults({
            submitProfileVote: true,
            activateScreen: true,
            launchResearch: true
        });

        if (this.tracking) {
            void this.tracking.complete();
        }
    }

    async renderResults({ submitProfileVote = false, activateScreen = false, launchResearch = false } = {}) {
        console.log('Showing results...');
        this.clearAutoAdvanceTimer();
        
        // Calculate personality profile
        const result = this.questionnaire.getPersonalityProfile();
        const profile = result.profile;
        const scores = result.scores;

        const profileKey = profile?.id || profile?.type;

        this.currentResult = {
            // Keep a stable key for research lookups + VoteManager stats
            type: profileKey,
            profile,
            scores: scores
        };

        console.log('Profile:', profileKey);
        console.log('Scores:', scores);

        // Submit profile result to global storage
        if (submitProfileVote) {
            await this.questionnaire.submitProfileResult(profileKey);
        }

        // Display characteristics
        this.displayStats(profile.characteristics, scores);

        // Show profile summary with peer percentage
        await this.displayProfileSummary(profile);

        // Get real population average scores
        const avgScores = await this.questionnaire.getAveragePopulationScores();

        // Create comparison chart
        this.createComparisonChart(scores, avgScores);

        // Show results screen
        if (activateScreen) {
            this.showScreen('result');
        }

        window.dispatchEvent(new CustomEvent('sk-personality:profile-updated', {
            detail: this.currentResult
        }));

        if (launchResearch) {
            requestAnimationFrame(() => this.launchResearchPanel());
        }
    }

    /**
     * Auto-launch research mode with current profile
     */
    launchResearchPanel() {
        if (!this.currentResult) return;
        const event = new CustomEvent('enter-research-mode', { 
            detail: this.currentResult 
        });
        window.dispatchEvent(event);
    }

    /**
     * Display statistics grid
     */
    displayStats(characteristics, scores) {
        const statsGrid = document.getElementById('stats-grid');
        if (!statsGrid) return;

        statsGrid.innerHTML = '';
        const traitLabels = (this.lang?.ui?.result?.traits) || {};

        // Create stat cards for main traits
        const traits = [
            { label: traitLabels.organized || this.getText('ui.result.traits.organized', 'Organization'), value: Math.round(scores.organized), key: 'organized' },
            { label: traitLabels.impulsive || this.getText('ui.result.traits.impulsive', 'Impulsivity'), value: Math.round(scores.impulsive), key: 'impulsive' },
            { label: traitLabels.control || this.getText('ui.result.traits.control', 'Control Need'), value: Math.round(scores.control), key: 'control' },
            { label: traitLabels.social || this.getText('ui.result.traits.social', 'Social Mask'), value: Math.round(scores.social), key: 'social' }
        ];

        traits.forEach((trait, index) => {
            const statCard = document.createElement('div');
            statCard.className = 'stat-card';
            statCard.innerHTML = `
                <div class="stat-value">${trait.value}%</div>
                <div class="stat-label">${trait.label}</div>
                <div class="stat-bar">
                    <div class="stat-bar-fill" style="width: 0%"></div>
                </div>
            `;
            statsGrid.appendChild(statCard);

            // Animate the bar fill
            setTimeout(() => {
                const barFill = statCard.querySelector('.stat-bar-fill');
                if (barFill) {
                    barFill.style.width = `${trait.value}%`;
                }
            }, 100 + (index * 100));
        });

        this.renderProfileHighlights(characteristics);
    }

    /**
     * Surface qualitative characteristics next to the stat cards
     */
    renderProfileHighlights(characteristics = []) {
        const highlightCard = document.getElementById('profile-highlights');
        if (!highlightCard) return;

        if (!characteristics || characteristics.length === 0) {
            highlightCard.innerHTML = '';
            highlightCard.classList.remove('visible');
            return;
        }

        const items = characteristics.map(item => `<li>${item}</li>`).join('');
        highlightCard.innerHTML = `
            <h3>${this.getText('ui.result.highlightsTitle', 'Key tendencies')}</h3>
            <ul>${items}</ul>
        `;
        highlightCard.classList.add('visible');
    }

    /**
     * Display profile summary with audience share
     */
    async displayProfileSummary(profile) {
        const container = document.getElementById('profile-summary');
        if (!container) return;

        const profileKey = profile?.id || profile?.type;
        const profileLabel = profile?.label || profile?.type || '';
        const audienceShare = await this.questionnaire.getProfileShare(profileKey);
        const shareTemplate = this.getText('ui.result.profileSummaryShare', 'Profile strength: {value}%');
        const labelTemplate = this.getText('ui.result.profileSummaryLabel', 'You lean toward: {type}');
        const shareText = shareTemplate.replace('{value}', audienceShare);
        const labelText = labelTemplate.replace('{type}', profileLabel);

        container.innerHTML = `
            <div class="profile-summary-percentage">${shareText}</div>
            <div class="profile-summary-note">${labelText}</div>
            <div class="profile-summary-brief">${profile.description}</div>
            <div class="profile-summary-brief" style="opacity:0.8;">${profile.realWorldPattern}</div>
        `;
    }

    /**
     * Create comparison chart showing user vs population
     */
    createComparisonChart(userScores, avgScores) {
        const canvas = document.getElementById('comparison-chart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const traitLabels = (this.lang?.ui?.result?.traits) || {};
        const labels = [
            traitLabels.organized || this.getText('ui.result.traits.organized', 'Structure'),
            traitLabels.impulsive || this.getText('ui.result.traits.impulsive', 'Spontaneity'),
            traitLabels.control || this.getText('ui.result.traits.control', 'Agency'),
            traitLabels.social || this.getText('ui.result.traits.social', 'Social Ease')
        ];
        const youLabel = this.getText('ui.chart.you', 'You');
        const averageLabel = this.getText('ui.chart.average', 'Reference');

        // Destroy existing chart if it exists
        if (this.comparisonChart) {
            this.comparisonChart.destroy();
        }

        // Use provided average scores or fallback to defaults if missing
        const populationData = avgScores || {
            organized: 50,
            impulsive: 50,
            control: 50,
            social: 50
        };

        this.comparisonChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: youLabel,
                        data: [
                            Math.round(userScores.organized),
                            Math.round(userScores.impulsive),
                            Math.round(userScores.control),
                            Math.round(userScores.social)
                        ],
                        backgroundColor: 'rgba(242, 12, 43, 0.85)',
                        borderColor: '#f20c2b',
                        borderWidth: 2
                    },
                    {
                        label: averageLabel,
                        data: [
                            Math.round(populationData.organized),
                            Math.round(populationData.impulsive),
                            Math.round(populationData.control),
                            Math.round(populationData.social)
                        ],
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        borderColor: 'rgba(255, 255, 255, 0.65)',
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            color: '#f5f5f5',
                            stepSize: 20
                        },
                        grid: {
                            color: 'rgba(255,255,255,0.08)'
                        }
                    },
                    x: {
                        ticks: {
                            color: '#f5f5f5'
                        },
                        grid: {
                            color: 'rgba(255,255,255,0.05)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#ffffff',
                            font: {
                                size: 14
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Idle timer: return to start after 2 minutes of inactivity
     */
    setupIdleTimer() {
        this.resetIdleTimer();
    }

    resetIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(this.handleIdleTimeout, 120000);
    }

    handleIdleTimeout() {
        console.log('Idle timeout reached, returning to start.');
        this.handleRestartClick();
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    const app = new QuestionnaireApp();
    app.init();
});

// Prevent context menu and text selection for kiosk mode
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
