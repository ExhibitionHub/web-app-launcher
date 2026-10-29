(function initializeSharedCameraSession() {
    const sessionKey = '__skPersonalityCameraSession';
    const apiKey = '__skPersonalityCameraSessionApi';

    const isSameOriginWindow = (candidate) => {
        try {
            return Boolean(candidate) && !candidate.closed && candidate.location.origin === window.location.origin;
        } catch {
            return false;
        }
    };

    const ownerWindow = isSameOriginWindow(window.top) ? window.top : window;

    if (ownerWindow[apiKey]) {
        window[apiKey] = ownerWindow[apiKey];
        return;
    }

    const session = ownerWindow[sessionKey] || (ownerWindow[sessionKey] = {
        stream: null,
        pending: null,
        cleanupRegistered: false,
    });

    const hasLiveStream = (stream) => Boolean(
        stream &&
        typeof stream.getTracks === 'function' &&
        stream.getTracks().some((track) => track.readyState === 'live')
    );

    const getActiveStream = () => hasLiveStream(session.stream) ? session.stream : null;

    const clearStream = () => {
        if (session.stream && typeof session.stream.getTracks === 'function') {
            session.stream.getTracks().forEach((track) => {
                try {
                    track.stop();
                } catch {
                }
            });
        }

        session.stream = null;
        session.pending = null;
    };

    const attachTrackCleanup = (stream) => {
        if (!stream || typeof stream.getTracks !== 'function') {
            return;
        }

        stream.getTracks().forEach((track) => {
            track.addEventListener('ended', () => {
                if (!hasLiveStream(stream) && session.stream === stream) {
                    session.stream = null;
                }
            }, { once: true });
        });
    };

    const ensureCleanupRegistered = () => {
        if (session.cleanupRegistered) {
            return;
        }

        session.cleanupRegistered = true;
        ownerWindow.addEventListener('pagehide', clearStream);
        ownerWindow.addEventListener('beforeunload', clearStream);
    };

    const requestStream = async (primaryConstraints, fallbackConstraints) => {
        const activeStream = getActiveStream();
        if (activeStream) {
            return activeStream;
        }

        if (session.pending) {
            return session.pending;
        }

        if (!ownerWindow.isSecureContext || !ownerWindow.navigator?.mediaDevices?.getUserMedia) {
            throw new Error('Camera access requires HTTPS or localhost on the kiosk browser.');
        }

        ensureCleanupRegistered();

        session.pending = (async () => {
            try {
                try {
                    session.stream = await ownerWindow.navigator.mediaDevices.getUserMedia(primaryConstraints);
                } catch (primaryError) {
                    if (!fallbackConstraints) {
                        throw primaryError;
                    }

                    console.warn('Primary shared camera request failed, retrying with fallback...', primaryError);
                    session.stream = await ownerWindow.navigator.mediaDevices.getUserMedia(fallbackConstraints);
                }

                attachTrackCleanup(session.stream);
                return session.stream;
            } finally {
                session.pending = null;
            }
        })();

        return session.pending;
    };

    const api = {
        getActiveStream,
        requestStream,
        stopSharedStream: clearStream,
    };

    ownerWindow[apiKey] = api;
    window[apiKey] = api;
})();