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

    getText(key, fallback = '') {
        if (!window.i18n || typeof window.i18n.t !== 'function') {
            return fallback;
        }

        const value = window.i18n.t(key);
        return value === key ? fallback : value;
    }

    isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    cloneValue(value) {
        if (Array.isArray(value)) {
            return value.map((entry) => this.cloneValue(entry));
        }

        if (this.isPlainObject(value)) {
            return Object.fromEntries(
                Object.entries(value).map(([key, entryValue]) => [key, this.cloneValue(entryValue)])
            );
        }

        return value;
    }

    mergeLocalizedValue(baseValue, localizedValue) {
        if (localizedValue === undefined) {
            return this.cloneValue(baseValue);
        }

        if (Array.isArray(localizedValue)) {
            return this.cloneValue(localizedValue);
        }

        if (this.isPlainObject(baseValue) && this.isPlainObject(localizedValue)) {
            const mergedValue = this.cloneValue(baseValue);

            Object.entries(localizedValue).forEach(([key, entryValue]) => {
                mergedValue[key] = this.mergeLocalizedValue(baseValue[key], entryValue);
            });

            return mergedValue;
        }

        return this.cloneValue(localizedValue);
    }

    getLocalizedContent() {
        if (!window.i18n || typeof window.i18n.t !== 'function') {
            return {};
        }

        const localizedContent = window.i18n.t('content');
        return this.isPlainObject(localizedContent) ? localizedContent : {};
    }

    async loadQuestions() {
        try {
            if (window.i18n?.ready) {
                try {
                    await window.i18n.ready;
                } catch {
                }
            }

            const response = await fetch('ressource/data/questions.json', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Unable to load ressource/data/questions.json (${response.status})`);
            }

            const data = await response.json();
            const localizedContent = this.getLocalizedContent();
            const localizedQuestions = this.isPlainObject(localizedContent.questions)
                ? localizedContent.questions
                : {};
            const localizedConclusions = this.isPlainObject(localizedContent.conclusions)
                ? localizedContent.conclusions
                : {};

            this.questions = Array.isArray(data.questions)
                ? data.questions.map((question) => {
                    const localizedQuestion = localizedQuestions[String(question.id)];
                    return this.mergeLocalizedValue(question, localizedQuestion);
                })
                : [];

            this.conclusions = Array.isArray(data.conclusions)
                ? data.conclusions.map((conclusion, index) => {
                    const localizedConclusion = localizedConclusions[String(conclusion.id || index)];
                    return this.mergeLocalizedValue(conclusion, localizedConclusion);
                })
                : [];

            return true;
        } catch (error) {
            console.error('Error loading questions:', error);
            throw new Error(this.getText('ui.error.loadQuestions', 'Unable to load quiz content.'));
        }
    }

    getCurrentQuestion() {
        return this.questions[this.currentQuestionIndex];
    }

    hasMoreQuestions() {
        return this.currentQuestionIndex < this.questions.length - 1;
    }

    nextQuestion() {
        if (!this.hasMoreQuestions()) {
            return false;
        }

        this.currentQuestionIndex += 1;
        return true;
    }

    recordAnswer(answerIndex, score) {
        this.answers[this.currentQuestionIndex] = {
            questionId: this.getCurrentQuestion()?.id,
            answerIndex,
            score,
        };
    }

    getCurrentAnswer() {
        return this.answers[this.currentQuestionIndex];
    }

    calculateScore() {
        this.totalScore = this.answers.reduce((sum, answer) => sum + (answer?.score || 0), 0);
        return this.totalScore;
    }

    getScorePercentage() {
        if (this.questions.length === 0) {
            return 0;
        }

        return Math.round((this.totalScore / this.questions.length) * 100);
    }

    getConclusion() {
        const matchedConclusion = this.conclusions.find((conclusion) => {
            return this.totalScore >= conclusion.minScore && this.totalScore <= conclusion.maxScore;
        });

        if (matchedConclusion) {
            return matchedConclusion;
        }

        return {
            title: '',
            message: '',
        };
    }

    getProgressPercentage() {
        if (this.questions.length === 0) {
            return 0;
        }

        return Math.round(((this.currentQuestionIndex + 1) / this.questions.length) * 100);
    }

    reset() {
        this.currentQuestionIndex = 0;
        this.answers = [];
        this.totalScore = 0;
    }

    isComplete() {
        return this.questions.length > 0 && this.answers.length === this.questions.length && this.answers.every(Boolean);
    }

    getTotalQuestions() {
        return this.questions.length;
    }
}
