/**
 * Main Application Controller
 * Manages UI interactions and questionnaire flow
 */
class QuestionnaireApp {
    constructor() {
        this.questionnaire = new Questionnaire();
        this.currentScreen = 'welcome';
        this.selectedAnswerIndex = null;
        this.tracking = window.EHTracking
            ? window.EHTracking.createTracker({ exhibition: 'SK', application: 'SK-quiz-stats' })
            : null;
        
        // Bind methods to preserve context
        this.handleAnswerClick = this.handleAnswerClick.bind(this);
        this.handleNextClick = this.handleNextClick.bind(this);
        this.handlePrevClick = this.handlePrevClick.bind(this);
        this.handleStartClick = this.handleStartClick.bind(this);
        this.handleRestartClick = this.handleRestartClick.bind(this);
        this.handleContinueClick = this.handleContinueClick.bind(this);
        this.handleLanguageChange = this.handleLanguageChange.bind(this);
        this.languageChangeInProgress = false;
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing questionnaire app...');
        
        try {
            // Ensure i18n is loaded before we build question text/UI strings.
            if (window.i18n && window.i18n.ready) {
                await window.i18n.ready;
            }

            // Load questions data
            await this.questionnaire.loadQuestions();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Show welcome screen
            this.showScreen('welcome');
            
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
        const prevBtn = document.getElementById('prev-btn');
        
        if (nextBtn) {
            nextBtn.addEventListener('click', this.handleNextClick);
        }
        
        if (prevBtn) {
            prevBtn.addEventListener('click', this.handlePrevClick);
        }

        // Result screen
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
            restartBtn.addEventListener('click', this.handleRestartClick);
        }

        // Insight screen
        const continueBtn = document.getElementById('continue-btn');
        if (continueBtn) {
            continueBtn.addEventListener('click', this.handleContinueClick);
            console.log('Continue button event listener added');
        } else {
            console.error('Continue button not found');
        }

        window.addEventListener('i18n:changed', this.handleLanguageChange);

        // Keyboard navigation for accessibility
        document.addEventListener('keydown', (e) => {
            if (this.currentScreen === 'question') {
                if (e.key === 'ArrowRight' || e.key === 'Enter') {
                    this.handleNextClick();
                } else if (e.key === 'ArrowLeft') {
                    this.handlePrevClick();
                } else if (e.key >= '1' && e.key <= '4') {
                    const answerIndex = parseInt(e.key) - 1;
                    const answers = document.querySelectorAll('.answer');
                    if (answers[answerIndex]) {
                        this.handleAnswerClick(answerIndex);
                    }
                }
            } else if (this.currentScreen === 'insight') {
                if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') {
                    this.handleContinueClick();
                }
            } else if (this.currentScreen === 'welcome' && e.key === 'Enter') {
                this.handleStartClick();
            } else if (this.currentScreen === 'result' && e.key === 'Enter') {
                this.handleRestartClick();
            }
        });
    }

    /**
     * Show specified screen
     */
    showScreen(screenName) {
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
    }

    /**
     * Show error message
     */
    showError(message) {
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            const t = (key, vars) => (window.i18n && typeof window.i18n.t === 'function')
                ? window.i18n.t(key, vars)
                : key;

            welcomeScreen.innerHTML = `
                <div class="container">
                    <h1 class="title">${t('quizApp.error.title')}</h1>
                    <div class="subtitle">${t('quizApp.error.subtitle')}</div>
                    <p class="description">
                        ${message}
                        <br><br>
                        ${t('quizApp.error.helpHtml')}
                    </p>
                    <button onclick="location.reload()" class="btn-primary">${t('quizApp.error.reload')}</button>
                </div>
            `;
        }
        this.showScreen('welcome');
    }

    /**
     * Handle start button click
     */
    handleStartClick() {
        console.log('Starting questionnaire...');
        this.questionnaire.reset();
        this.startExperienceTracking();
        this.showScreen('question');
        this.displayQuestion();
    }

    /**
     * Handle restart button click
     */
    handleRestartClick() {
        console.log('Restarting questionnaire...');
        this.resetToWelcome();
    }

    resetToWelcome() {
        this.questionnaire.reset();
        this.selectedAnswerIndex = null;
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
        }
    }

    /**
     * Display current question
     */
    displayQuestion() {
        const question = this.questionnaire.getCurrentQuestion();
        if (!question) {
            console.error('No question to display');
            return;
        }

        const t = (key, vars) => (window.i18n && typeof window.i18n.t === 'function')
            ? window.i18n.t(key, vars)
            : key;

        // Update question text
        const questionText = document.getElementById('question-text');
        if (questionText) {
            questionText.textContent = question.question;
        }

        // Update question counter
        const questionCounter = document.getElementById('question-counter');
        if (questionCounter) {
            questionCounter.textContent = t('quizApp.questionCounter', {
                current: this.questionnaire.currentQuestionIndex + 1,
                total: this.questionnaire.getTotalQuestions()
            });
        }

        // Update progress bar
        this.updateProgressBar();

        // Display answers
        this.displayAnswers(question.answers);

        // Restore previous answer if exists
        const savedAnswer = this.questionnaire.getCurrentAnswer();
        if (savedAnswer) {
            this.selectedAnswerIndex = savedAnswer.answerIndex;
            this.highlightAnswer(this.selectedAnswerIndex);
        } else {
            this.selectedAnswerIndex = null;
        }

        // Update navigation buttons (after setting selectedAnswerIndex)
        this.updateNavigationButtons();
        this.trackQuizCheckpoint('question');
    }

    /**
     * Display answers for current question
     */
    displayAnswers(answers) {
        const container = document.getElementById('answers-container');
        if (!container) return;

        container.innerHTML = '';

        answers.forEach((answer, index) => {
            const answerElement = document.createElement('div');
            answerElement.className = 'answer';
            answerElement.textContent = answer.text;
            answerElement.setAttribute('data-index', index);
            answerElement.addEventListener('click', () => this.handleAnswerClick(index));
            
            container.appendChild(answerElement);
        });
    }

    /**
     * Handle answer selection
     */
    handleAnswerClick(answerIndex) {
        this.selectedAnswerIndex = answerIndex;
        
        // Get current question and selected answer
        const question = this.questionnaire.getCurrentQuestion();
        const selectedAnswer = question.answers[answerIndex];
        
        // Record the answer
        this.questionnaire.recordAnswer(answerIndex, selectedAnswer.score);
        
        // Update visual feedback
        this.highlightAnswer(answerIndex);
        
        // Enable next button
        this.updateNavigationButtons();
        this.trackQuizCheckpoint('answer');
        
        console.log(`Answer selected: ${answerIndex}, Score: ${selectedAnswer.score}`);
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
     * Handle next button click
     */
    handleNextClick() {
        if (this.selectedAnswerIndex === null) {
            console.log('No answer selected');
            return;
        }

        // Show insight for the current question
        this.showInsight();
    }

    /**
     * Handle continue button click (from insight screen)
     */
    handleContinueClick() {
        console.log('Continue button clicked!');
        if (this.questionnaire.hasMoreQuestions()) {
            console.log('Moving to next question...');
            this.questionnaire.nextQuestion();
            this.selectedAnswerIndex = null; // Reset selection for new question
            this.showScreen('question');
            this.displayQuestion();
        } else {
            console.log('Showing final results...');
            // Show results
            this.showResults();
        }
    }

    /**
     * Handle previous button click
     */
    handlePrevClick() {
        if (this.questionnaire.previousQuestion()) {
            this.displayQuestion();
        }
    }

    /**
     * Update navigation buttons state
     */
    updateNavigationButtons() {
        const nextBtn = document.getElementById('next-btn');
        const prevBtn = document.getElementById('prev-btn');

        const t = (key, vars) => (window.i18n && typeof window.i18n.t === 'function')
            ? window.i18n.t(key, vars)
            : key;

        const setPseudoDisabled = (btn, isDisabled) => {
            if (!btn) return;

            // Do not use native `disabled` in kiosk: some browsers still allow a context menu
            // on disabled controls (and they may not dispatch events for our blockers).
            try { btn.disabled = false; } catch { /* ignore */ }

            btn.classList.toggle('is-disabled', !!isDisabled);
            btn.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');

            // Keep disabled buttons out of the tab order (closest behavior to native disabled).
            if (isDisabled) btn.setAttribute('tabindex', '-1');
            else btn.removeAttribute('tabindex');
        };

        setPseudoDisabled(prevBtn, this.questionnaire.currentQuestionIndex === 0);
        setPseudoDisabled(nextBtn, this.selectedAnswerIndex === null);

        if (nextBtn) {
            // Update button text for last question
            if (!this.questionnaire.hasMoreQuestions()) {
                nextBtn.textContent = t('quizApp.nav.seeResult');
            } else {
                nextBtn.textContent = t('quizApp.nav.next');
            }
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
     * Show insight screen
     */
    showInsight() {
        const question = this.questionnaire.getCurrentQuestion();

        const t = (key, vars) => (window.i18n && typeof window.i18n.t === 'function')
            ? window.i18n.t(key, vars)
            : key;

        // Update progress bar
        const insightProgressFill = document.getElementById('insight-progress-fill');
        if (insightProgressFill) {
            const percentage = this.questionnaire.getProgressPercentage();
            insightProgressFill.style.width = `${percentage}%`;
        }

        // Update counter
        const insightCounter = document.getElementById('insight-counter');
        if (insightCounter) {
            insightCounter.textContent = t('quizApp.questionCounter', {
                current: this.questionnaire.currentQuestionIndex + 1,
                total: this.questionnaire.getTotalQuestions()
            });
        }

        // Show if answer is correct or incorrect
        const answerResultDisplay = document.getElementById('answer-result');
        if (answerResultDisplay) {
            const isCorrect = this.selectedAnswerIndex === question.correctAnswer;
            answerResultDisplay.textContent = isCorrect ? t('quizApp.insight.answerCorrect') : t('quizApp.insight.answerIncorrect');

            // Reset classes then apply the correct semantic class
            answerResultDisplay.classList.remove('correct', 'incorrect');
            answerResultDisplay.classList.add(isCorrect ? 'correct' : 'incorrect');
        }

        // Update insight text
        const insightText = document.getElementById('insight-text');
        if (insightText) {
            insightText.textContent = question.insight;
        }

        // Update continue button text
        const continueBtn = document.getElementById('continue-btn');
        if (continueBtn) {
            if (this.questionnaire.hasMoreQuestions()) {
                continueBtn.textContent = t('quizApp.nav.nextQuestion');
            } else {
                continueBtn.textContent = t('quizApp.nav.seeResults');
            }
        }

        console.log('Showing insight screen...');
        this.showScreen('insight');
        this.trackQuizCheckpoint('insight');
        
        // Debug: Vérifier que l'écran et le bouton sont visibles
        setTimeout(() => {
            const insightScreen = document.getElementById('insight-screen');
            const continueBtn = document.getElementById('continue-btn');
            console.log('Insight screen visible:', insightScreen?.classList.contains('active'));
            console.log('Continue button exists:', !!continueBtn);
            console.log('Continue button visible:', continueBtn?.offsetParent !== null);
        }, 200);
    }

    /**
     * Show results screen
     */
    showResults() {
        console.log('Showing results...');
        if (this.tracking) {
            void this.tracking.complete();
        }
        
        // Calculate final score
        const totalScore = this.questionnaire.calculateScore();
        const percentage = this.questionnaire.getScorePercentage();
        const conclusion = this.questionnaire.getConclusion();

        console.log(`Total Score: ${totalScore}, Percentage: ${percentage}%`);

        // Update score display
        const scorePercentage = document.getElementById('score-percentage');
        if (scorePercentage) {
            scorePercentage.textContent = `${percentage}%`;
        }

        // Update conclusion
        const conclusionText = document.getElementById('conclusion-text');
        if (conclusionText) {
            conclusionText.innerHTML = `
                <h3>${conclusion.title}</h3>
                <p>${conclusion.message}</p>
            `;
        }

        // Show results screen
        this.showScreen('result');

        // Animate score counter
        this.animateScore(percentage);
    }

    /**
     * Animate score counter
     */
    animateScore(targetPercentage) {
        const scoreElement = document.getElementById('score-percentage');
        if (!scoreElement) return;

        let currentScore = 0;
        const increment = targetPercentage / 50; // Animation over ~50 frames
        
        const timer = setInterval(() => {
            currentScore += increment;
            if (currentScore >= targetPercentage) {
                currentScore = targetPercentage;
                clearInterval(timer);
            }
            scoreElement.textContent = `${Math.round(currentScore)}%`;
        }, 20);
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    const app = new QuestionnaireApp();
    app.init();
});

// Kiosk hardening (local safety net even if kiosk.js is not loaded/cached)
const prevent = (e) => {
    try { e.preventDefault(); } catch { /* ignore */ }
};

window.addEventListener('contextmenu', prevent, { capture: true });
document.addEventListener('contextmenu', prevent, { capture: true });
document.addEventListener('selectstart', prevent, { capture: true });
document.addEventListener('dragstart', prevent, { capture: true });
window.addEventListener('mousedown', (e) => {
    if (e && typeof e.button === 'number' && e.button === 2) prevent(e);
}, { capture: true, passive: false });
