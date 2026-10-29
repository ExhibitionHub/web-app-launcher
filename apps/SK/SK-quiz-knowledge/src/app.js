/**
 * Main Application Controller
 * Manages UI interactions and questionnaire flow with chart support
 */
class QuestionnaireApp {
    constructor() {
        this.questionnaire = new Questionnaire();
        this.currentScreen = 'welcome';
        this.selectedAnswerIndex = null;
        this.currentChart = null;
        this.insightChart = null;
        this.resultsChart = null;
        this.inactivityTimeout = 120000;
        this.inactivityTimer = null;
        this.tracking = window.EHTracking
            ? window.EHTracking.createTracker({ exhibition: 'SK', application: 'SK-quiz-knowledge' })
            : null;

        this.handleAnswerClick = this.handleAnswerClick.bind(this);
        this.handleNextClick = this.handleNextClick.bind(this);
        this.handleStartClick = this.handleStartClick.bind(this);
        this.handleRestartClick = this.handleRestartClick.bind(this);
        this.handleContinueClick = this.handleContinueClick.bind(this);
        this.handleLanguageChange = this.handleLanguageChange.bind(this);
        this.resetInactivityTimer = this.resetInactivityTimer.bind(this);
        this.handleInactivity = this.handleInactivity.bind(this);
        this.languageChangeInProgress = false;
    }

    getText(key, fallback = '', vars = null) {
        if (!window.i18n || typeof window.i18n.t !== 'function') {
            return fallback;
        }

        const value = window.i18n.t(key, vars);
        return value === key ? fallback : value;
    }

    getThemeColor(cssVarName, fallback) {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue(cssVarName)
            .trim();
        return value || fallback;
    }

    resolveColor(value, fallback) {
        if (!value) return fallback;
        if (Array.isArray(value)) {
            return value.map((entry) => this.resolveColor(entry, fallback));
        }
        if (typeof value !== 'string') return value;

        const trimmed = value.trim();
        if (trimmed.startsWith('var(')) {
            const match = trimmed.match(/var\((--[^)\s]+)\)/);
            if (match && match[1]) {
                return this.getThemeColor(match[1], fallback);
            }
        }

        return trimmed;
    }

    getChartTheme() {
        return {
            text: this.getThemeColor('--sk-text-on-dark', '#ffffff'),
            title: this.getThemeColor('--sk-color-red-900', '#8b0000'),
            grid: this.getThemeColor('--sk-color-gray-600', '#333333'),
            accent: this.getThemeColor('--sk-accent', 'rgba(204, 24, 44, 0.92)'),
            accent2: this.getThemeColor('--sk-accent-2', 'rgba(240, 60, 72, 0.92)'),
            border: this.getThemeColor('--sk-accent-border', 'rgba(204, 24, 44, 0.44)'),
        };
    }

    createChart(canvasId, chartData) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === 'undefined') {
            return null;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }

        if (canvasId === 'insight-chart' && this.insightChart) {
            this.insightChart.destroy();
        }
        if (canvasId === 'results-chart' && this.resultsChart) {
            this.resultsChart.destroy();
        }

        const theme = this.getChartTheme();

        const chart = new Chart(ctx, {
            type: chartData.type || 'bar',
            data: {
                labels: chartData.labels || [],
                datasets: [{
                    label: chartData.label || '',
                    data: chartData.data || [],
                    backgroundColor: this.resolveColor(chartData.backgroundColor, theme.accent),
                    borderColor: this.resolveColor(chartData.borderColor, theme.accent2),
                    borderWidth: 2,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: chartData.showLegend || false,
                        labels: {
                            color: theme.text,
                        },
                    },
                    title: {
                        display: Boolean(chartData.title),
                        text: chartData.title || '',
                        color: theme.title,
                    },
                },
                scales: chartData.type === 'pie' || chartData.type === 'doughnut'
                    ? {}
                    : {
                        y: {
                            beginAtZero: true,
                            ticks: { color: theme.text },
                            grid: { color: theme.grid },
                        },
                        x: {
                            ticks: { color: theme.text },
                            grid: { color: theme.grid },
                        },
                    },
            },
        });

        if (canvasId === 'insight-chart') {
            this.insightChart = chart;
        }
        if (canvasId === 'results-chart') {
            this.resultsChart = chart;
        }

        return chart;
    }

    async init() {
        console.log('Initializing questionnaire app...');

        try {
            if (window.i18n?.ready) {
                await window.i18n.ready;
            }

            await this.questionnaire.loadQuestions();
            this.setupEventListeners();
            this.startInactivityTimer();
            this.showScreen('welcome');
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showError(error.message);
        }
    }

    startExperienceTracking() {
        if (!this.tracking) {
            return;
        }

        void this.tracking.restart(5, { step: 'quiz-start' });
    }

    getTrackingCheckpointPercentage(stage = 'question') {
        const totalQuestions = Math.max(1, this.questionnaire.getTotalQuestions());
        const questionIndex = Math.max(0, Math.min(this.questionnaire.currentQuestionIndex, totalQuestions - 1));
        const experienceStart = 5;
        const completionReserve = 4;
        const usableRange = 100 - experienceStart - completionReserve;
        const questionSpan = usableRange / totalQuestions;
        const checkpointOffsets = {
            question: 0.15,
            answer: 0.52,
            insight: 0.82,
        };
        const checkpointOffset = checkpointOffsets[stage] ?? checkpointOffsets.question;

        return Math.min(
            99,
            Math.round(experienceStart + (questionIndex * questionSpan) + (questionSpan * checkpointOffset))
        );
    }

    trackQuizCheckpoint(stage) {
        if (!this.tracking) {
            return;
        }

        const questionNumber = Math.min(
            this.questionnaire.currentQuestionIndex + 1,
            Math.max(1, this.questionnaire.getTotalQuestions())
        );

        void this.tracking.track(this.getTrackingCheckpointPercentage(stage), {
            step: `question-${questionNumber}-${stage}`,
        });
    }

    setupEventListeners() {
        document.getElementById('start-btn')?.addEventListener('click', this.handleStartClick);
        document.getElementById('restart-top-btn')?.addEventListener('click', this.handleRestartClick);
        document.getElementById('next-btn')?.addEventListener('click', this.handleNextClick);
        document.getElementById('continue-btn')?.addEventListener('click', this.handleContinueClick);
        window.addEventListener('i18n:changed', this.handleLanguageChange);

        ['click', 'mousemove', 'touchstart', 'pointerdown', 'wheel'].forEach((eventName) => {
            document.addEventListener(eventName, this.resetInactivityTimer, { passive: true });
        });
    }

    showScreen(screenName) {
        document.querySelectorAll('.screen').forEach((screen) => {
            screen.classList.remove('active');
        });

        const targetScreen = document.getElementById(`${screenName}-screen`);
        targetScreen?.classList.add('active');
        this.currentScreen = screenName;
    }

    showError(message) {
        const welcomeScreen = document.getElementById('welcome-screen');
        const title = this.getText('ui.error.title', 'ERROR');
        const subtitle = this.getText('ui.error.subtitle', 'UNABLE TO LOAD');
        const description = this.getText(
            'ui.error.description',
            'Make sure a local server is running and that ressource/data/questions.json is accessible.'
        );
        const reloadLabel = this.getText('ui.error.reload', 'RELOAD');

        if (welcomeScreen) {
            welcomeScreen.innerHTML = `
                <div class="container">
                    <h1 class="title">${title}</h1>
                    <div class="subtitle">${subtitle}</div>
                    <p class="description">${message}<br><br>${description}</p>
                    <button onclick="location.reload()" class="btn-primary">${reloadLabel}</button>
                </div>
            `;
        }

        this.showScreen('welcome');
    }

    handleStartClick() {
        this.questionnaire.reset();
        this.selectedAnswerIndex = null;
        this.startExperienceTracking();
        this.showScreen('question');
        this.displayQuestion();
    }

    handleRestartClick() {
        this.resetToWelcome();
        this.resetInactivityTimer();
    }

    resetToWelcome() {
        this.questionnaire.reset();
        this.selectedAnswerIndex = null;
        if (this.insightChart) {
            this.insightChart.destroy();
            this.insightChart = null;
        }
        if (this.resultsChart) {
            this.resultsChart.destroy();
            this.resultsChart = null;
        }
        this.showScreen('welcome');
    }

    async handleLanguageChange() {
        if (this.languageChangeInProgress) {
            return;
        }

        this.languageChangeInProgress = true;

        try {
            await this.questionnaire.loadQuestions();
            this.resetToWelcome();
        } catch (error) {
            console.error('Failed to update language:', error);
            this.showError(error instanceof Error ? error.message : String(error));
        } finally {
            this.languageChangeInProgress = false;
            this.resetInactivityTimer();
        }
    }

    displayQuestion() {
        const question = this.questionnaire.getCurrentQuestion();
        if (!question) {
            return;
        }

        const questionText = document.getElementById('question-text');
        if (questionText) {
            questionText.textContent = question.question || '';
        }

        const questionCounter = document.getElementById('question-counter');
        if (questionCounter) {
            questionCounter.textContent = this.getText(
                'ui.question.counterTemplate',
                `Question ${this.questionnaire.currentQuestionIndex + 1} of ${this.questionnaire.getTotalQuestions()}`,
                {
                    current: this.questionnaire.currentQuestionIndex + 1,
                    total: this.questionnaire.getTotalQuestions(),
                }
            );
        }

        this.updateProgressBar();
        this.displayAnswers(question.answers || []);

        const savedAnswer = this.questionnaire.getCurrentAnswer();
        this.selectedAnswerIndex = savedAnswer ? savedAnswer.answerIndex : null;
        if (savedAnswer) {
            this.highlightAnswer(savedAnswer.answerIndex);
        }

        this.updateNavigationButtons();
        this.trackQuizCheckpoint('question');
    }

    displayAnswers(answers) {
        const container = document.getElementById('answers-container');
        if (!container) {
            return;
        }

        container.innerHTML = '';
        answers.forEach((answer, index) => {
            const answerElement = document.createElement('div');
            answerElement.className = 'answer';
            answerElement.textContent = answer.text || '';
            answerElement.dataset.index = String(index);
            answerElement.addEventListener('click', () => this.handleAnswerClick(index));
            container.appendChild(answerElement);
        });
    }

    handleAnswerClick(answerIndex) {
        const question = this.questionnaire.getCurrentQuestion();
        if (!question) {
            return;
        }

        this.selectedAnswerIndex = answerIndex;
        const isCorrect = answerIndex === question.correctAnswer;
        this.questionnaire.recordAnswer(answerIndex, isCorrect ? 1 : 0);
        this.highlightAnswer(answerIndex);
        this.updateNavigationButtons();
        this.trackQuizCheckpoint('answer');
    }

    highlightAnswer(answerIndex) {
        document.querySelectorAll('.answer').forEach((answer) => {
            answer.classList.remove('selected');
        });

        document.querySelector(`.answer[data-index="${answerIndex}"]`)?.classList.add('selected');
    }

    handleNextClick() {
        if (this.selectedAnswerIndex === null) {
            return;
        }

        this.showInsight();
    }

    handleContinueClick() {
        if (this.questionnaire.hasMoreQuestions()) {
            this.questionnaire.nextQuestion();
            this.selectedAnswerIndex = null;
            this.showScreen('question');
            this.displayQuestion();
            return;
        }

        this.showResults();
    }

    updateNavigationButtons() {
        const nextBtn = document.getElementById('next-btn');
        if (!nextBtn) {
            return;
        }

        nextBtn.disabled = this.selectedAnswerIndex === null;
        nextBtn.textContent = this.questionnaire.hasMoreQuestions()
            ? this.getText('ui.buttons.continue', 'CONTINUE')
            : this.getText('ui.buttons.viewResults', 'VIEW RESULTS');
    }

    updateProgressBar() {
        const progressFill = document.getElementById('progress-fill');
        if (progressFill) {
            progressFill.style.width = `${this.questionnaire.getProgressPercentage()}%`;
        }
    }

    showInsight() {
        const question = this.questionnaire.getCurrentQuestion();
        const answer = this.questionnaire.getCurrentAnswer();
        if (!question || !answer) {
            return;
        }

        const isCorrect = answer.answerIndex === question.correctAnswer;

        const insightProgressFill = document.getElementById('insight-progress-fill');
        if (insightProgressFill) {
            insightProgressFill.style.width = `${this.questionnaire.getProgressPercentage()}%`;
        }

        const insightCounter = document.getElementById('insight-counter');
        if (insightCounter) {
            insightCounter.textContent = this.getText(
                'ui.question.counterTemplate',
                `Question ${this.questionnaire.currentQuestionIndex + 1} of ${this.questionnaire.getTotalQuestions()}`,
                {
                    current: this.questionnaire.currentQuestionIndex + 1,
                    total: this.questionnaire.getTotalQuestions(),
                }
            );
        }

        const feedback = document.getElementById('answer-feedback');
        if (feedback) {
            feedback.className = `answer-feedback ${isCorrect ? 'correct' : 'incorrect'}`;
            feedback.querySelector('.feedback-icon').textContent = isCorrect ? '✓' : '✗';
            const correctAnswer = question.answers?.[question.correctAnswer]?.text || '';
            feedback.querySelector('.feedback-text').textContent = isCorrect
                ? this.getText('ui.feedback.correct', 'Correct')
                : this.getText('ui.feedback.incorrectWithAnswer', `Incorrect — Correct: ${correctAnswer}`, { answer: correctAnswer });
        }

        const insightText = document.getElementById('insight-text');
        if (insightText) {
            insightText.textContent = question.insight || '';
        }

        const insightChartContainer = document.getElementById('insight-chart-container');
        const chartData = question.insightChart || question.chartData;
        if (chartData && insightChartContainer) {
            insightChartContainer.style.display = 'block';
            this.createChart('insight-chart', chartData);
        } else if (insightChartContainer) {
            insightChartContainer.style.display = 'none';
        }

        const continueBtn = document.getElementById('continue-btn');
        if (continueBtn) {
            continueBtn.textContent = this.questionnaire.hasMoreQuestions()
                ? this.getText('ui.buttons.nextQuestion', 'NEXT QUESTION')
                : this.getText('ui.buttons.viewResults', 'VIEW RESULTS');
        }

        this.showScreen('insight');
        this.trackQuizCheckpoint('insight');
    }

    showResults() {
        const totalScore = this.questionnaire.calculateScore();
        const percentage = this.questionnaire.getScorePercentage();
        const conclusion = this.questionnaire.getConclusion();
        const totalQuestions = this.questionnaire.getTotalQuestions();
        const incorrectCount = Math.max(0, totalQuestions - totalScore);

        if (this.tracking) {
            void this.tracking.complete();
        }

        const scorePercentage = document.getElementById('score-percentage');
        if (scorePercentage) {
            scorePercentage.textContent = `${percentage}%`;
        }

        const scoreFraction = document.getElementById('score-fraction');
        if (scoreFraction) {
            scoreFraction.textContent = `${totalScore} / ${totalQuestions}`;
        }

        const conclusionText = document.getElementById('conclusion-text');
        if (conclusionText) {
            conclusionText.innerHTML = `
                <h3>${conclusion.title || ''}</h3>
                <p>${conclusion.message || ''}</p>
            `;
        }

        this.createChart('results-chart', {
            type: 'bar',
            title: this.getText('ui.result.correctAnswers', 'CORRECT ANSWERS'),
            labels: [
                this.getText('ui.result.chartLabels.correct', 'Correct'),
                this.getText('ui.result.chartLabels.incorrect', 'Incorrect'),
            ],
            data: [totalScore, incorrectCount],
            backgroundColor: ['var(--sk-accent)', 'var(--sk-accent-border)'],
            borderColor: ['var(--sk-accent-2)', 'var(--sk-accent-2)'],
        });

        this.showScreen('result');
    }

    startInactivityTimer() {
        this.clearInactivityTimer();
        this.inactivityTimer = setTimeout(this.handleInactivity, this.inactivityTimeout);
    }

    resetInactivityTimer() {
        this.startInactivityTimer();
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    handleInactivity() {
        this.handleRestartClick();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const app = new QuestionnaireApp();
    await app.init();
});

// Kiosk hardening: no right click, no selection, no drag, no zoom/gestures
(function enableKioskGuards() {
    const prevent = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    // Context menu (right-click / long-press menus)
    document.addEventListener('contextmenu', prevent, { capture: true });

    // Text selection + dragging
    document.addEventListener('selectstart', prevent, { capture: true });
    document.addEventListener('dragstart', prevent, { capture: true });

    // Block double-click zoom (desktop)
    document.addEventListener('dblclick', prevent, { capture: true });

    // Block Ctrl/⌘ + wheel zoom
    document.addEventListener(
        'wheel',
        (e) => {
            if (e.ctrlKey || e.metaKey) {
                prevent(e);
            }
        },
        { passive: false, capture: true }
    );

    // Block keyboard interactions entirely (kiosk: click/scroll only)
    document.addEventListener(
        'keydown',
        (e) => {
            // Allow browser/system keys to be handled by the OS where applicable.
            // We still prevent page interactions.
            prevent(e);
        },
        { capture: true }
    );

    // iOS Safari gesture zoom events
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
        document.addEventListener(eventName, prevent, { capture: true, passive: false });
    });

    // Reduce iOS double-tap zoom (best-effort)
    let lastTouchEnd = 0;
    document.addEventListener(
        'touchend',
        (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                prevent(e);
            }
            lastTouchEnd = now;
        },
        { passive: false, capture: true }
    );
})();
