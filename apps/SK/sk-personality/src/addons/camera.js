function getCameraSessionApi() {
    try {
        if (window.__skPersonalityCameraSessionApi) {
            return window.__skPersonalityCameraSessionApi;
        }

        if (window.top?.__skPersonalityCameraSessionApi) {
            return window.top.__skPersonalityCameraSessionApi;
        }
    } catch {
    }

    return null;
}

function buildFallbackConstraints(videoConstraints) {
    return {
        video: {
            width: videoConstraints?.width || { ideal: 1280 },
            height: videoConstraints?.height || { ideal: 720 }
        },
        audio: false
    };
}

const CAMERA_SECURE_CONTEXT_ERROR = 'Camera access requires HTTPS or localhost on the kiosk browser.';

function getTranslatedCameraText(key, fallback) {
    if (typeof window !== 'undefined' && typeof window.t === 'function') {
        return window.t(key, fallback);
    }

    return fallback;
}

function getCameraErrorDetail(error) {
    const errorName = String(error?.name || '').trim();
    const errorMessage = String(error?.message || '');
    const detailKeys = {
        AbortError: 'ui.camera.errors.generic',
        ConstraintNotSatisfiedError: 'ui.camera.errors.overconstrained',
        DevicesNotFoundError: 'ui.camera.errors.notFound',
        NotAllowedError: 'ui.camera.errors.notAllowed',
        NotFoundError: 'ui.camera.errors.notFound',
        NotReadableError: 'ui.camera.errors.notReadable',
        OverconstrainedError: 'ui.camera.errors.overconstrained',
        PermissionDeniedError: 'ui.camera.errors.notAllowed',
        TrackStartError: 'ui.camera.errors.notReadable'
    };

    if (errorMessage === CAMERA_SECURE_CONTEXT_ERROR) {
        return getTranslatedCameraText('ui.camera.errors.secureContext', CAMERA_SECURE_CONTEXT_ERROR);
    }

    if (detailKeys[errorName]) {
        return getTranslatedCameraText(detailKeys[errorName], 'Camera access failed.');
    }

    return getTranslatedCameraText('ui.camera.errors.generic', 'Camera access failed.');
}

export class Camera {
    constructor(videoElement) {
        this.video = videoElement;
        this.stream = null;
        this.isMirrored = false;
        this.usesSharedStream = false;
    }

    async start(videoConstraints = null) {
        this.stop(); // Ensure previous stream is stopped

        try {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                throw new Error(CAMERA_SECURE_CONTEXT_ERROR);
            }

            const constraints = {
                video: videoConstraints || {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: "user"
                },
                audio: false
            };

            const cameraSessionApi = getCameraSessionApi();
            if (cameraSessionApi?.requestStream) {
                this.stream = await cameraSessionApi.requestStream(
                    constraints,
                    buildFallbackConstraints(constraints.video)
                );
                this.usesSharedStream = true;
            } else {
                try {
                    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
                } catch (firstError) {
                    console.warn("Primary constraints failed, retrying with fallback...", firstError);
                    this.stream = await navigator.mediaDevices.getUserMedia(buildFallbackConstraints(constraints.video));
                }

                this.usesSharedStream = false;
            }

            this.video.srcObject = this.stream;
            
            // Log actual settings for debugging
            const track = this.stream.getVideoTracks()[0];
            if (track) {
                console.log("Camera active:", track.label);
                console.log("Settings:", track.getSettings());
            }

            return new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.video.play().catch(e => console.error("Error playing video:", e));
                    resolve();
                };
            });
        } catch (err) {
            console.error("Error accessing camera:", err);
            const template = getTranslatedCameraText(
                'ui.camera.permissionError',
                'Could not access camera. Please ensure you have a camera connected and have granted permission.\n\nDetails: {error}'
            );
            alert(template.replace('{error}', getCameraErrorDetail(err)));
        }
    }

    stop() {
        if (this.stream) {
            if (!this.usesSharedStream) {
                this.stream.getTracks().forEach(track => track.stop());
            }

            try {
                this.video.pause();
            } catch {
            }

            this.video.srcObject = null;
            this.stream = null;
            this.usesSharedStream = false;
        }
    }

    setMirror(mirrored) {
        this.isMirrored = mirrored;
        this.video.style.transform = mirrored ? "scaleX(-1)" : "none";
    }

    capture(canvas) {
        if (!this.stream) return;
        const context = canvas.getContext('2d');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        
        context.save();
        if (this.isMirrored) {
            context.translate(canvas.width, 0);
            context.scale(-1, 1);
        }
        context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        context.restore();
    }
}
