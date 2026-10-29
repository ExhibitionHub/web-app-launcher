export function createInitialWorkflowState() {
  return {
    currentStep: 'phone.select',
    unlockedSources: new Set(['phone']),
    completedSources: new Set(),
    revealedFacts: new Set(),
    viewedConversationThreads: new Set(),
    plottedCellPings: {
      karim: new Set(),
      samir: new Set(),
    },
    completedCellularPaths: new Set(),
    viewedGoogleEvents: new Set(),
    coachDismissedSteps: new Set(),
    loadingEvidenceKey: '',
    plottingCellularPath: '',
  };
}

export function createInitialState() {
  return {
    screen: 'language',
    hasStarted: false,
    selectedSource: '',
    selectedSuspect: 'karim',
    openedConversationThread: 'neighbor',
    currentTimelineFocus: '',
    hasVisitedTimeline: false,
    isConclusionUnlocked: false,
    revealedSources: new Set(),
    workflow: createInitialWorkflowState(),
    inactivityTimer: null,
    inactivityCountdownTimer: null,
  };
}
