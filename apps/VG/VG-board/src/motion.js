export function readDurationMs(variableName, fallbackMs) {
  const rootStyles = window.getComputedStyle(document.documentElement);
  const rawValue = rootStyles.getPropertyValue(variableName).trim();

  if (!rawValue) {
    return fallbackMs;
  }

  const numericValue = Number.parseFloat(rawValue);
  if (Number.isNaN(numericValue)) {
    return fallbackMs;
  }

  if (rawValue.endsWith("ms")) {
    return numericValue;
  }

  if (rawValue.endsWith("s")) {
    return numericValue * 1000;
  }

  return fallbackMs;
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
