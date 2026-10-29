(function () {
  const DEFAULT_HTTP_ENDPOINT = 'http://45.9.188.69:3000/api/track';
  const DEFAULT_HTTPS_ENDPOINT = 'https://srv1731081.hstgr.cloud/api/track';
  const PENDING_STORAGE_PREFIX = 'eh-tracking-pending-v1:';
  const MAX_PENDING_LAUNCHES = 12;

  function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function clampPercentage(value) {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) {
      return 0;
    }

    return Number(Math.max(0, Math.min(100, parsedValue)).toFixed(1));
  }

  function getDefaultEndpoints() {
    if (window.location.protocol === 'https:') {
      return [DEFAULT_HTTPS_ENDPOINT];
    }

    return [DEFAULT_HTTP_ENDPOINT, DEFAULT_HTTPS_ENDPOINT];
  }

  function getPendingStorageKey(exhibition, application) {
    return PENDING_STORAGE_PREFIX + cleanText(exhibition).toLowerCase() + ':' + cleanText(application).toLowerCase();
  }

  function getStorage() {
    try {
      return window.localStorage || null;
    } catch {
      return null;
    }
  }

  function readPendingPayloads(storageKey) {
    const storage = getStorage();
    if (!storage || !storageKey) {
      return [];
    }

    try {
      const rawValue = storage.getItem(storageKey);
      if (!rawValue) {
        return [];
      }

      const parsedValue = JSON.parse(rawValue);
      return Array.isArray(parsedValue) ? parsedValue.filter((item) => item && typeof item === 'object') : [];
    } catch {
      return [];
    }
  }

  function writePendingPayloads(storageKey, payloads) {
    const storage = getStorage();
    if (!storage || !storageKey) {
      return;
    }

    try {
      if (!payloads.length) {
        storage.removeItem(storageKey);
        return;
      }

      storage.setItem(storageKey, JSON.stringify(payloads.slice(-MAX_PENDING_LAUNCHES)));
    } catch {
    }
  }

  function mergePendingPayload(existingPayload, nextPayload) {
    const mergedPayload = {
      ...existingPayload,
      ...nextPayload,
      percentage: clampPercentage(Math.max(Number(existingPayload?.percentage) || 0, Number(nextPayload?.percentage) || 0)),
    };

    ['exhibition', 'exposition', 'application', 'launchId', 'step', 'language', 'country', 'city'].forEach((key) => {
      mergedPayload[key] = cleanText(nextPayload?.[key]) || cleanText(existingPayload?.[key]);
    });

    ['latitude', 'longitude', 'accuracy'].forEach((key) => {
      const nextValue = nextPayload?.[key];
      if (nextValue === '' || nextValue === undefined || nextValue === null) {
        mergedPayload[key] = existingPayload?.[key] ?? '';
      }
    });

    return mergedPayload;
  }

  function queuePendingPayload(storageKey, payload) {
    const launchId = cleanText(payload?.launchId);
    if (!storageKey || !launchId) {
      return;
    }

    const payloads = readPendingPayloads(storageKey);
    const existingIndex = payloads.findIndex((item) => cleanText(item?.launchId) === launchId);

    if (existingIndex >= 0) {
      payloads[existingIndex] = mergePendingPayload(payloads[existingIndex], payload);
    } else {
      payloads.push(payload);
    }

    writePendingPayloads(storageKey, payloads);
  }

  function removePendingPayload(storageKey, launchId) {
    const normalizedLaunchId = cleanText(launchId);
    if (!storageKey || !normalizedLaunchId) {
      return;
    }

    const remainingPayloads = readPendingPayloads(storageKey)
      .filter((item) => cleanText(item?.launchId) !== normalizedLaunchId);

    writePendingPayloads(storageKey, remainingPayloads);
  }

  function getMetaContent(name) {
    try {
      return cleanText(document.querySelector('meta[name="' + name + '"]')?.getAttribute('content'));
    } catch {
      return '';
    }
  }

  function getQueryValue(keys) {
    try {
      const params = new URL(window.location.href).searchParams;
      for (const key of keys) {
        const value = cleanText(params.get(key));
        if (value) {
          return value;
        }
      }
    } catch {
      return '';
    }

    return '';
  }

  function normalizeLanguage(value) {
    const normalized = cleanText(value).toLowerCase().replace(/_/g, '-');
    if (!normalized) {
      return '';
    }

    const parts = normalized.split('-').filter(Boolean);
    return parts[0] || normalized;
  }

  function normalizeCoordinate(value, min, max) {
    const parsedValue = Number.parseFloat(value);
    if (!Number.isFinite(parsedValue)) {
      return null;
    }

    return Number(Math.max(min, Math.min(max, parsedValue)).toFixed(6));
  }

  function normalizeAccuracy(value) {
    const parsedValue = Number.parseFloat(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return null;
    }

    return Number(parsedValue.toFixed(1));
  }

  function resolveNumericValue(values, normalizer) {
    for (const value of values) {
      const normalizedValue = normalizer(value);
      if (normalizedValue !== null) {
        return normalizedValue;
      }
    }

    return null;
  }

  function normalizeEndpointList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => cleanText(item)).filter(Boolean);
    }

    const endpoint = cleanText(value);
    return endpoint ? [endpoint] : [];
  }

  function hasGeoCoordinates(geo) {
    return Boolean(geo)
      && Number.isFinite(geo.latitude)
      && Number.isFinite(geo.longitude);
  }

  function requestBrowserGeolocation(timeoutMs = 4000) {
    if (!window.isSecureContext || !navigator.geolocation) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let settled = false;

      function finish(value) {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      }

      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const latitude = normalizeCoordinate(position?.coords?.latitude, -90, 90);
            const longitude = normalizeCoordinate(position?.coords?.longitude, -180, 180);

            if (latitude === null || longitude === null) {
              finish(null);
              return;
            }

            finish({
              latitude,
              longitude,
              accuracy: normalizeAccuracy(position?.coords?.accuracy),
            });
          },
          () => finish(null),
          {
            enableHighAccuracy: false,
            timeout: timeoutMs,
            maximumAge: 5 * 60 * 1000,
          }
        );
      } catch {
        finish(null);
      }
    });
  }

  function resolveValue(explicitValue, resolver, fallbackResolver) {
    const resolverValue = typeof resolver === 'function' ? resolver() : '';
    const fallbackValue = typeof fallbackResolver === 'function' ? fallbackResolver() : '';
    return cleanText(explicitValue) || cleanText(resolverValue) || cleanText(fallbackValue) || '';
  }

  function getDefaultLanguage() {
    return normalizeLanguage(
      resolveValue(
        '',
        () => window.i18n?.lang || window.i18n?.locale,
        () => document.documentElement.lang || getQueryValue(['lang', 'locale', 'language'])
      )
    );
  }

  function getDefaultCountry() {
    return resolveValue(
      '',
      () => document.documentElement.dataset.country,
      () => getQueryValue(['country', 'pays', 'geoCountry', 'geo_country']) || getMetaContent('tracking-country')
    );
  }

  function getDefaultCity() {
    return resolveValue(
      '',
      () => document.documentElement.dataset.city,
      () => getQueryValue(['city', 'ville', 'geoCity', 'geo_city']) || getMetaContent('tracking-city')
    );
  }

  function createLaunchId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }

    return 'launch-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function calculateStepPercentage(currentIndex, totalSteps) {
    const safeTotalSteps = Number(totalSteps);
    if (!Number.isFinite(safeTotalSteps) || safeTotalSteps <= 1) {
      return 100;
    }

    const safeIndex = Math.max(0, Math.min(safeTotalSteps - 1, Number(currentIndex) || 0));
    return clampPercentage((safeIndex / (safeTotalSteps - 1)) * 100);
  }

  function sendTrackingRequest(endpoints, payload, state) {
    const endpointList = normalizeEndpointList(endpoints);
    if (!endpointList.length) {
      return Promise.resolve(null);
    }

    const preferredEndpoint = cleanText(state?.preferredEndpoint);
    const orderedEndpoints = preferredEndpoint && endpointList.includes(preferredEndpoint)
      ? [preferredEndpoint, ...endpointList.filter((endpoint) => endpoint !== preferredEndpoint)]
      : endpointList;

    function attemptRequest(index) {
      const endpoint = orderedEndpoints[index];

      try {
        return window.fetch(endpoint, {
          method: 'POST',
          mode: 'cors',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }).then((response) => {
          if (!response.ok) {
            throw new Error('Tracking request failed with status ' + response.status + '.');
          }

          if (state) {
            state.preferredEndpoint = endpoint;
          }

          return response.json().catch(() => null);
        }).catch((error) => {
          if (index < orderedEndpoints.length - 1) {
            return attemptRequest(index + 1);
          }

          console.warn('[EHTracking]', error);
          return null;
        });
      } catch (error) {
        if (index < orderedEndpoints.length - 1) {
          return attemptRequest(index + 1);
        }

        console.warn('[EHTracking]', error);
        return Promise.resolve(null);
      }
    }

    return attemptRequest(0);
  }

  function createTracker(options) {
    const configuredEndpoint = cleanText(options?.endpoint) || getMetaContent('tracking-endpoint');
    const config = {
      endpoints: configuredEndpoint ? [configuredEndpoint] : getDefaultEndpoints(),
      exhibition: cleanText(options?.exhibition),
      application: cleanText(options?.application),
      getLanguage: typeof options?.getLanguage === 'function' ? options.getLanguage : null,
      getCountry: typeof options?.getCountry === 'function' ? options.getCountry : null,
      getCity: typeof options?.getCity === 'function' ? options.getCity : null,
      enableGeolocation: options?.enableGeolocation !== false,
    };

    if (!config.exhibition || !config.application) {
      throw new Error('EHTracking requires both exhibition and application.');
    }

    const state = {
      launchId: '',
      highestPercentage: -1,
      started: false,
      queue: Promise.resolve(),
      storageKey: getPendingStorageKey(config.exhibition, config.application),
      sessionLanguage: '',
      geo: null,
      geoPromise: null,
      geoAppliedLaunchId: '',
      lastPayloadHadGeo: false,
      preferredEndpoint: configuredEndpoint || '',
    };

    function flushPendingPayloads() {
      const pendingPayloads = readPendingPayloads(state.storageKey);
      if (!pendingPayloads.length) {
        return Promise.resolve(true);
      }

      function sendPendingPayload(index) {
        if (index >= pendingPayloads.length) {
          writePendingPayloads(state.storageKey, []);
          return Promise.resolve(true);
        }

        return sendTrackingRequest(config.endpoints, pendingPayloads[index], state).then((result) => {
          if (!result) {
            writePendingPayloads(state.storageKey, pendingPayloads.slice(index));
            return false;
          }

          return sendPendingPayload(index + 1);
        });
      }

      return sendPendingPayload(0);
    }

    function flushPendingOnNextOpportunity() {
      state.queue = state.queue.catch(() => null).then(() => flushPendingPayloads());
      return state.queue;
    }

    function applyResolvedGeoToCurrentLaunch(geo) {
      if (!hasGeoCoordinates(geo) || !state.started || state.geoAppliedLaunchId === state.launchId) {
        return Promise.resolve(geo);
      }

      state.geoAppliedLaunchId = state.launchId;
      return enqueueTracking(Math.max(state.highestPercentage, 0), geo, true).then(() => geo);
    }

    function ensureGeoContext() {
      if (!config.enableGeolocation) {
        return Promise.resolve(null);
      }

      if (hasGeoCoordinates(state.geo)) {
        return Promise.resolve(state.geo);
      }

      if (state.geoPromise) {
        return state.geoPromise;
      }

      state.geoPromise = requestBrowserGeolocation().then((geo) => {
        state.geoPromise = null;
        if (hasGeoCoordinates(geo)) {
          state.geo = geo;

          if (!state.started) {
            return geo;
          }

          state.queue = state.queue.catch(() => null).then(() => {
            if (!state.started || state.geoAppliedLaunchId === state.launchId || state.lastPayloadHadGeo) {
              return geo;
            }

            return applyResolvedGeoToCurrentLaunch(geo);
          });

          return state.queue.then(() => geo);
        }

        return geo;
      });

      return state.geoPromise;
    }

    function buildPayload(percentage, extra = {}) {
      const explicitLanguage = normalizeLanguage(extra.language);
      const latitude = resolveNumericValue([
        extra.latitude,
        state.geo?.latitude,
      ], (value) => normalizeCoordinate(value, -90, 90));

      const longitude = resolveNumericValue([
        extra.longitude,
        extra.lng,
        extra.lon,
        state.geo?.longitude,
      ], (value) => normalizeCoordinate(value, -180, 180));

      const accuracy = resolveNumericValue([
        extra.accuracy,
        state.geo?.accuracy,
      ], normalizeAccuracy);

      state.lastPayloadHadGeo = latitude !== null && longitude !== null;

      if (state.lastPayloadHadGeo) {
        state.geoAppliedLaunchId = state.launchId;
      }

      return {
        exhibition: config.exhibition,
        exposition: config.exhibition,
        application: config.application,
        launchId: state.launchId,
        percentage,
        step: cleanText(extra.step),
        language: explicitLanguage || state.sessionLanguage,
        country: resolveValue(extra.country, config.getCountry, getDefaultCountry),
        city: resolveValue(extra.city, config.getCity, getDefaultCity),
        latitude: latitude === null ? '' : latitude,
        longitude: longitude === null ? '' : longitude,
        accuracy: accuracy === null ? '' : accuracy,
      };
    }

    function startNewSession(extra = {}) {
      state.launchId = createLaunchId();
      state.highestPercentage = -1;
      state.started = true;
      state.sessionLanguage = normalizeLanguage(resolveValue(extra.language, config.getLanguage, getDefaultLanguage));
      state.geoAppliedLaunchId = '';
      state.lastPayloadHadGeo = false;
      void ensureGeoContext();
    }

    function enqueueTracking(percentage, extra = {}, allowRepeat = false) {
      const safePercentage = clampPercentage(percentage);
      if (!state.started) {
        startNewSession(extra);
      }

      if (!allowRepeat && safePercentage <= state.highestPercentage) {
        return Promise.resolve(false);
      }

      state.highestPercentage = Math.max(state.highestPercentage, safePercentage);
      const payload = buildPayload(safePercentage, extra);

      state.queue = state.queue.catch(() => null).then(() => {
        return flushPendingPayloads().catch(() => false).then(() => sendTrackingRequest(config.endpoints, payload, state)).then((result) => {
          if (!result) {
            queuePendingPayload(state.storageKey, payload);
            return false;
          }

          removePendingPayload(state.storageKey, payload.launchId);
          const responseLaunchId = cleanText(result?.launchId);
          if (responseLaunchId) {
            state.launchId = responseLaunchId;
          }

          return true;
        });
      });

      return state.queue;
    }

    function track(percentage, extra = {}) {
      return enqueueTracking(percentage, extra, false);
    }

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        void flushPendingOnNextOpportunity();
      }, { passive: true });
    }

    void flushPendingOnNextOpportunity();

    return {
      start(percentage = 0, extra = {}) {
        startNewSession(extra);
        return track(percentage, extra);
      },
      restart(percentage = 0, extra = {}) {
        startNewSession(extra);
        return track(percentage, extra);
      },
      track,
      refresh(extra = {}) {
        const currentPercentage = Math.max(state.highestPercentage, 0);

        if (!state.started) {
          startNewSession();
        }

        return enqueueTracking(currentPercentage, extra, true);
      },
      complete(extra = {}) {
        return track(100, extra);
      },
      reset() {
        state.launchId = '';
        state.highestPercentage = -1;
        state.started = false;
        state.sessionLanguage = '';
      },
      getLaunchId() {
        return state.launchId;
      },
      hasStarted() {
        return state.started;
      }
    };
  }

  window.EHTracking = {
    createTracker,
    calculateStepPercentage
  };
})();