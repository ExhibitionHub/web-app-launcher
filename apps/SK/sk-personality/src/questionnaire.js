/**
 * Questionnaire Management System - Personality Quiz Version
 * Handles question loading, trait scoring, and personality profile calculation
 */
class Questionnaire {
    constructor() {
        this.questions = [];
        this.profiles = [];
        this.currentQuestionIndex = 0;
        this.answers = [];
        this.userAnswers = [];
        this.traitScores = {
            organized: 0,
            impulsive: 0,
            control: 0,
            social: 0
        };
        this.lang = null;
        
        // Statistics are now fetched asynchronously from VoteManager
    }

    setLang(langData) {
        this.lang = langData;
    }

    getText(key, fallback = '') {
        if (!window.i18n || typeof window.i18n.t !== 'function') {
            return fallback;
        }

        const value = window.i18n.t(key);
        return value === key ? fallback : value;
    }

    /**
     * Load questions from JSON data
     */
    async loadQuestions() {
        try {
            if (window.i18n?.ready) {
                await window.i18n.ready;
            }

            const langData = this.lang || window.i18n?.data || {};
            if (langData && langData.questions && langData.profiles) {
                this.questions = langData.questions;
                this.profiles = this.normalizeProfiles(langData.profiles);
                return true;
            }
        } catch (error) {
            console.error('Error loading questions:', error);
            throw new Error(this.getText('ui.error.loadQuestions', 'Unable to load questions. Check that the language file is accessible.'));
        }

        throw new Error(this.getText('ui.error.loadQuestions', 'Unable to load questions. Check that the language file is accessible.'));
    }

    normalizeProfiles(profiles = []) {
        return profiles.map((profile = {}) => ({
            ...profile,
            id: profile.id || profile.type || '',
            traitSummary: this.extractTraitSummary(profile.traits)
        }));
    }

    extractTraitSummary(traits = {}) {
        const profileTraits = traits && typeof traits === 'object' ? traits : {};

        return {
            organized: this.findTraitValue(profileTraits, ['organized', 'Planning & Organization', 'Planung & Organisation']),
            impulsive: this.findTraitValue(profileTraits, ['impulsive', 'Impulse Control', 'Impulskontrolle']),
            control: this.findTraitValue(profileTraits, ['control', 'Need for Control', 'Kontrollbedürfnis']),
            social: this.findTraitValue(profileTraits, ['social', 'Social Facade', 'Soziale Fassade'])
        };
    }

    findTraitValue(traits = {}, candidates = []) {
        for (const key of candidates) {
            if (traits[key] !== undefined) {
                return traits[key];
            }
        }

        return null;
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
    recordAnswer(answerIndex) {
        const question = this.getCurrentQuestion();
        const selectedAnswer = question.answers[answerIndex];
        
        this.answers[this.currentQuestionIndex] = {
            questionId: question.id,
            answerIndex: answerIndex,
            traits: {
                organized: selectedAnswer.organized,
                impulsive: selectedAnswer.impulsive,
                control: selectedAnswer.control,
                social: selectedAnswer.social
            }
        };
        
        // Also store in userAnswers for easy access
        this.userAnswers[this.currentQuestionIndex] = {
            questionId: question.id,
            answerIndex: answerIndex
        };
    }

    /**
     * Get recorded answer for current question
     */
    getCurrentAnswer() {
        return this.answers[this.currentQuestionIndex];
    }

    /**
     * Calculate total trait scores
     */
    calculateTraitScores() {
        this.traitScores = {
            organized: 0,
            impulsive: 0,
            control: 0,
            social: 0
        };

        this.answers.forEach(answer => {
            if (answer && answer.traits) {
                this.traitScores.organized += answer.traits.organized;
                this.traitScores.impulsive += answer.traits.impulsive;
                this.traitScores.control += answer.traits.control;
                this.traitScores.social += answer.traits.social;
            }
        });

        return this.traitScores;
    }

    /**
     * Get personality profile based on trait scores
     */
    getPersonalityProfile() {
        this.calculateTraitScores();
        
        // Normalize scores to percentages (max possible is 75 per trait for 15 questions)
        const maxScore = this.questions.length * 5;
        const normalizedScores = {
            organized: (this.traitScores.organized / maxScore) * 100,
            impulsive: (this.traitScores.impulsive / maxScore) * 100,
            control: (this.traitScores.control / maxScore) * 100,
            social: (this.traitScores.social / maxScore) * 100
        };

        // Find matching profile
        let matchedProfile = this.profiles[this.profiles.length - 1]; // Default to balanced
        
        for (let profile of this.profiles) {
            const minScore = profile.minScore;
            
            if (normalizedScores.organized >= minScore.organized &&
                normalizedScores.impulsive >= minScore.impulsive &&
                normalizedScores.control >= minScore.control &&
                normalizedScores.social >= minScore.social) {
                matchedProfile = profile;
                break;
            }
        }

        return {
            profile: matchedProfile,
            scores: normalizedScores,
            rawScores: this.traitScores
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
        this.userAnswers = [];
        this.traitScores = {
            organized: 0,
            impulsive: 0,
            control: 0,
            social: 0
        };
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

    /**
     * Get real answer statistics from VoteManager
     * Returns percentages for each answer option
     */
    async getRealAnswerStatistics(questionIndex, tempVoteIndex = null) {
        if (!window.VoteManager) {
            console.warn('VoteManager not found, returning defaults');
            return [25, 25, 25, 25];
        }

        const stats = await window.VoteManager.getVoteStats();
        const options = stats.options || {};
        
        let totalForQuestion = 0;
        const counts = [];
        
        // Assuming 4 answers per question
        for (let i = 0; i < 4; i++) {
            const key = `q${questionIndex}_a${i}`;
            let count = options[key] || 0;

            // Add temporary vote if this is the selected answer
            if (tempVoteIndex !== null && i === tempVoteIndex) {
                count++;
            }

            // Laplace smoothing: Add 1 to every count to avoid 0% and handle empty state
            // "compte comme si il sont touse 1"
            count += 1;
            
            counts.push(count);
            totalForQuestion += count;
        }
        
        return counts.map(c => Math.round((c / totalForQuestion) * 100));
    }

    /**
     * Submit a vote for an answer
     */
    async submitAnswerVote(questionIndex, answerIndex) {
        if (window.VoteManager) {
            const key = `q${questionIndex}_a${answerIndex}`;
            await window.VoteManager.addVote(key);
        }
    }

    /**
     * Submit the final profile result
     */
    async submitProfileResult(profileType) {
        if (window.VoteManager) {
            const key = `profile_${this._sanitizeKey(profileType)}`;
            await window.VoteManager.addVote(key);
        }
    }

    /**
     * Get the percentage of players who got this profile
     */
    async getProfileShare(profileType) {
        if (!window.VoteManager) return 0;

        const stats = await window.VoteManager.getVoteStats();
        const options = stats.options || {};
        const targetKey = `profile_${this._sanitizeKey(profileType)}`;
        
        let totalProfiles = 0;
        for (const key in options) {
            if (key.startsWith('profile_')) {
                totalProfiles += options[key];
            }
        }
        
        if (totalProfiles === 0) return 0;
        return Math.round(((options[targetKey] || 0) / totalProfiles) * 100);
    }

    _sanitizeKey(str) {
        return str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    }

    /**
     * Calculate the average trait scores of the entire population
     * based on stored votes (with smoothing)
     */
    async getAveragePopulationScores() {
        if (!window.VoteManager) {
            return { organized: 50, impulsive: 50, control: 50, social: 50 };
        }

        const stats = await window.VoteManager.getVoteStats();
        const options = stats.options || {};
        
        const totalTraits = { organized: 0, impulsive: 0, control: 0, social: 0 };
        const maxPossibleScore = this.questions.length * 5; // Assuming max score per trait per question is 5

        // Iterate through all questions to build the average profile
        for (let qIndex = 0; qIndex < this.questions.length; qIndex++) {
            const question = this.questions[qIndex];
            let questionTotalVotes = 0;
            const answerCounts = [];

            // Get votes for each answer of this question
            for (let aIndex = 0; aIndex < question.answers.length; aIndex++) {
                const key = `q${qIndex}_a${aIndex}`;
                // Apply the same smoothing (+1) as the UI
                const count = (options[key] || 0) + 1;
                answerCounts[aIndex] = count;
                questionTotalVotes += count;
            }

            // Calculate weighted average for this question
            for (let aIndex = 0; aIndex < question.answers.length; aIndex++) {
                const answer = question.answers[aIndex];
                const weight = answerCounts[aIndex] / questionTotalVotes;

                if (answer) {
                    totalTraits.organized += (answer.organized || 0) * weight;
                    totalTraits.impulsive += (answer.impulsive || 0) * weight;
                    totalTraits.control += (answer.control || 0) * weight;
                    totalTraits.social += (answer.social || 0) * weight;
                }
            }
        }

        // Normalize to percentages
        return {
            organized: (totalTraits.organized / maxPossibleScore) * 100,
            impulsive: (totalTraits.impulsive / maxPossibleScore) * 100,
            control: (totalTraits.control / maxPossibleScore) * 100,
            social: (totalTraits.social / maxPossibleScore) * 100
        };
    }
}
