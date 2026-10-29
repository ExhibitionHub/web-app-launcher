/**
 * Questionnaire Management System
 * Handles question loading, scoring, and result calculation
 */
class Questionnaire {
    constructor() {
        this.questions = [];
        this.conclusions = [];
        this.currentQuestionIndex = 0;
        this.answers = [];
        this.totalScore = 0;
    }

    getText(key, vars) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            return window.i18n.t(key, vars);
        }
        return key;
    }

    /**
     * Load questions from JSON data
     */
    async loadQuestions() {
        try {
            // Ensure language file is loaded before building question text from i18n.
            if (window.i18n && window.i18n.ready) {
                try { await window.i18n.ready; } catch { /* ignore */ }
            }

            const response = await fetch('ressource/data/questions.json', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            // Build full question objects from i18n strings.
            this.questions = (data.questions || []).map((q) => {
                const id = q.id;
                const baseKey = `quizApp.questions.${id}`;
                const correctAnswer = Number(q.correctAnswer);

                const answers = [0, 1, 2, 3].map((idx) => ({
                    text: this.getText(`${baseKey}.answers.${idx}.text`),
                    score: idx === correctAnswer ? 1 : 0
                }));

                return {
                    ...q,
                    question: this.getText(`${baseKey}.question`),
                    answers,
                    correctAnswer,
                    insight: this.getText(`${baseKey}.insight`)
                };
            });

            // Build conclusions from i18n strings.
            this.conclusions = (data.conclusions || []).map((c) => {
                const id = String(c.id || 'undetermined');
                const baseKey = `quizApp.conclusions.${id}`;
                return {
                    ...c,
                    id,
                    title: this.getText(`${baseKey}.title`),
                    message: this.getText(`${baseKey}.message`)
                };
            });

            return true;
        } catch (error) {
            console.error('Error loading questions:', error);
            throw new Error(this.getText('quizApp.error.unableToLoadQuestions'));
        }
    }

    /**
     * Get current question
     */
    getCurrentQuestion() {
        return this.questions[this.currentQuestionIndex];
    }

    /**
     * Check if there are more questions
     */
    hasMoreQuestions() {
        return this.currentQuestionIndex < this.questions.length - 1;
    }

    /**
     * Move to next question
     */
    nextQuestion() {
        if (this.hasMoreQuestions()) {
            this.currentQuestionIndex++;
            return true;
        }
        return false;
    }

    /**
     * Move to previous question
     */
    previousQuestion() {
        if (this.currentQuestionIndex > 0) {
            this.currentQuestionIndex--;
            return true;
        }
        return false;
    }

    /**
     * Record answer for current question
     */
    recordAnswer(answerIndex, score) {
        this.answers[this.currentQuestionIndex] = {
            questionId: this.getCurrentQuestion().id,
            answerIndex: answerIndex,
            score: score
        };
    }

    /**
     * Get recorded answer for current question
     */
    getCurrentAnswer() {
        return this.answers[this.currentQuestionIndex];
    }

    /**
     * Calculate total score
     */
    calculateScore() {
        this.totalScore = this.answers.reduce((sum, answer) => {
            return sum + (answer ? answer.score : 0);
        }, 0);
        return this.totalScore;
    }

    /**
     * Get result percentage (0-100)
     */
    getScorePercentage() {
        const maxPossibleScore = this.questions.length; // Calcul automatique basé sur le nombre de questions
        return Math.round((this.totalScore / maxPossibleScore) * 100);
    }

    /**
     * Get conclusion based on score
     */
    getConclusion() {
        for (let conclusion of this.conclusions) {
            if (this.totalScore >= conclusion.minScore && this.totalScore <= conclusion.maxScore) {
                return conclusion;
            }
        }
        // Fallback conclusion
        return {
            title: this.getText('quizApp.conclusions.undetermined.title'),
            message: this.getText('quizApp.conclusions.undetermined.message')
        };
    }

    /**
     * Get progress percentage for current question
     */
    getProgressPercentage() {
        return Math.round(((this.currentQuestionIndex + 1) / this.questions.length) * 100);
    }

    /**
     * Reset questionnaire for new session
     */
    reset() {
        this.currentQuestionIndex = 0;
        this.answers = [];
        this.totalScore = 0;
    }

    /**
     * Check if all questions have been answered
     */
    isComplete() {
        return this.answers.length === this.questions.length && 
               this.answers.every(answer => answer !== undefined);
    }

    /**
     * Get total number of questions
     */
    getTotalQuestions() {
        return this.questions.length;
    }
}