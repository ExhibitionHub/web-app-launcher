export function createInactivityController(state, timeoutMs, onIdle, options = {}) {
  const clearTimers = () => {
    if (state.inactivityTimer) {
      window.clearTimeout(state.inactivityTimer);
      state.inactivityTimer = null;
    }

    if (state.inactivityCountdownTimer) {
      window.clearInterval(state.inactivityCountdownTimer);
      state.inactivityCountdownTimer = null;
    }
  };

  return {
    reset() {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;

      clearTimers();
      options.onClear?.();

      const startedAt = Date.now();
      const totalSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
      const tick = () => {
        const elapsedMs = Date.now() - startedAt;
        const remainingMs = Math.max(0, timeoutMs - elapsedMs);
        const remainingSeconds = Math.min(totalSeconds, Math.ceil(remainingMs / 1000));
        options.onTick?.(remainingSeconds, totalSeconds);
      };

      tick();
      state.inactivityCountdownTimer = window.setInterval(tick, 250);
      state.inactivityTimer = window.setTimeout(() => {
        clearTimers();
        onIdle();
      }, timeoutMs);
    },
    clear() {
      clearTimers();
      options.onClear?.();
    }
  };
}