import { Camera } from './camera.js';

let selfieSegmentationScriptPromise = null;
const selfieSegmentationAssetAliases = {
    'selfie_segmentation.binarypb': 'selfie_segmentation.binarypb.bin',
    'selfie_segmentation.tflite': 'selfie_segmentation.tflite.bin',
    'selfie_segmentation_landscape.tflite': 'selfie_segmentation_landscape.tflite.bin',
    'selfie_segmentation_solution_simd_wasm_bin.data': 'selfie_segmentation_solution_simd_wasm_bin.data.bin'
};

function isSelfieSegmentationEnabled() {
    return document.querySelector('meta[name="selfie-segmentation"]')?.content?.trim().toLowerCase() === 'true';
}

function resolveSelfieSegmentationAssetUrl(file) {
    const fileName = selfieSegmentationAssetAliases[file] || file;
    return new URL(`../vendor/@mediapipe/selfie_segmentation/${fileName}`, window.location.href).toString();
}

export class CameraAddon {
    constructor({ videoEl, outputCanvas, backgroundSrc = 'ressource/research/Background.jpg' }) {
        this.video = videoEl;
        this.canvas = outputCanvas;
        this.bgSrc = backgroundSrc;
        this.camera = new Camera(this.video);

        this.compositeCanvas = document.createElement('canvas');
        this.compositeCtx = this.compositeCanvas.getContext('2d');
        this.outputCtx = this.canvas.getContext('2d');

        this.bgImage = null;
        this.noiseCanvas = null;
        this.isRunning = false;
        this.paused = false;
        this.selfieSegmentation = null;
    }

    async init(options = {}) {
        const constraints = options.constraints || {
            width: { ideal: 480 },
            height: { ideal: 360 },
            facingMode: "user",
            frameRate: { ideal: 30, max: 30 }
        };

        this.paused = false;
        await this.camera.start(constraints);

        const w = this.video.videoWidth || 640;
        const h = this.video.videoHeight || 480;

        this.canvas.width = w;
        this.canvas.height = h;
        this.compositeCanvas.width = w;
        this.compositeCanvas.height = h;

        this.noiseCanvas = this.generateNoise(w, h);
        await this.loadBackground();
        await ensureSelfieSegmentationLoaded();
        const hasSegmentation = this.setupSegmentation();

        this.isRunning = true;
        requestAnimationFrame(() => this.process());

        if (!hasSegmentation) {
            this.drawRawFrame();
        }
    }

    setupSegmentation() {
        const SegmentationClass = window.SelfieSegmentation?.SelfieSegmentation || window.SelfieSegmentation;
        if (!SegmentationClass) {
            if (isSelfieSegmentationEnabled()) {
                console.warn('SelfieSegmentation unavailable, falling back to raw camera feed.');
            }
            this.selfieSegmentation = null;
            return false;
        }

        this.selfieSegmentation = new SegmentationClass({
            locateFile: (file) => resolveSelfieSegmentationAssetUrl(file)
        });
        this.selfieSegmentation.setOptions({
            modelSelection: 1,
            selfieMode: false,
            useCpuInference: true
        });
        this.selfieSegmentation.onResults((results) => this.onResults(results));
        return true;
    }

    async loadBackground() {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.bgImage = img;
                resolve();
            };
            img.onerror = () => {
                this.bgImage = this.generateFallbackBackground();
                resolve();
            };
            img.src = this.bgSrc;
        });
    }

    generateFallbackBackground() {
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = 640;
        bgCanvas.height = 480;
        const bgCtx = bgCanvas.getContext('2d');
        
        const grad = bgCtx.createLinearGradient(0, 0, 0, 480);
        grad.addColorStop(0, "#ccc");
        grad.addColorStop(0.6, "#eee");
        grad.addColorStop(0.6, "#333");
        grad.addColorStop(1, "#111");
        
        bgCtx.fillStyle = grad;
        bgCtx.fillRect(0, 0, 640, 480);
        
        bgCtx.fillStyle = "#222";
        bgCtx.fillRect(50, 320, 80, 100);
        bgCtx.fillRect(450, 280, 120, 140);
        
        bgCtx.beginPath();
        bgCtx.moveTo(300, 350);
        bgCtx.lineTo(320, 280);
        bgCtx.lineTo(340, 350);
        bgCtx.fill();

        return bgCanvas;
    }

    generateNoise(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            if (Math.random() < 0.2) {
                const isWhite = Math.random() < 0.5;
                const val = isWhite ? 255 : 0;
                data[i] = val;
                data[i + 1] = val;
                data[i + 2] = val;
                data[i + 3] = 32;
            } else {
                data[i + 3] = 0;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    async process() {
        if (!this.isRunning) return;

        if (!this.paused && this.video.videoWidth > 0) {
            if (this.selfieSegmentation) {
                try {
                    await this.selfieSegmentation.send({ image: this.video });
                } catch (e) {
                    if (this.isRunning) {
                        console.warn('Segmentation send error:', e);
                    }
                }
            } else {
                this.drawRawFrame();
            }
        }

        if (this.isRunning) {
            requestAnimationFrame(() => this.process());
        }
    }

    onResults(results) {
        if (!this.isRunning) return;

        const ctx = this.compositeCtx;
        ctx.save();
        ctx.clearRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);

        ctx.drawImage(results.segmentationMask, 0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
        ctx.globalCompositeOperation = 'source-in';
        ctx.drawImage(results.image, 0, 0, this.compositeCanvas.width, this.compositeCanvas.height);

        ctx.globalCompositeOperation = 'destination-over';
        if (this.bgImage) {
            ctx.drawImage(this.bgImage, 0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
        }

        ctx.globalCompositeOperation = 'overlay';
        if (this.noiseCanvas) {
            const ox = Math.floor(Math.random() * 10) - 5;
            const oy = Math.floor(Math.random() * 10) - 5;
            ctx.drawImage(this.noiseCanvas, ox, oy, this.compositeCanvas.width, this.compositeCanvas.height);
        }

        ctx.restore();

        this.outputCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.outputCtx.drawImage(this.compositeCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }

    drawRawFrame() {
        if (!this.outputCtx || !this.video) return;
        this.outputCtx.save();
        this.outputCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.outputCtx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        this.outputCtx.restore();
    }

    captureFrame() {
        const clone = document.createElement('canvas');
        clone.width = this.canvas.width;
        clone.height = this.canvas.height;
        const cloneCtx = clone.getContext('2d');
        cloneCtx.drawImage(this.canvas, 0, 0);
        return clone;
    }

    pause() {
        this.paused = true;
    }

    resume() {
        if (!this.isRunning) return;
        this.paused = false;
    }

    stop() {
        this.isRunning = false;
        this.paused = false;
        this.camera.stop();
        this.outputCtx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.compositeCtx?.clearRect(0, 0, this.compositeCanvas.width, this.compositeCanvas.height);
        if (this.selfieSegmentation?.close) {
            try {
                this.selfieSegmentation.close();
            } catch (e) {
                console.warn('SelfieSegmentation already closed', e);
            }
            this.selfieSegmentation = null;
        }
    }

    isReady() {
        return this.isRunning;
    }
}

function ensureSelfieSegmentationLoaded() {
    const isEnabled = isSelfieSegmentationEnabled();
    if (!isEnabled) {
        return Promise.resolve(false);
    }

    if (window.SelfieSegmentation) {
        return Promise.resolve(true);
    }

    if (selfieSegmentationScriptPromise) {
        return selfieSegmentationScriptPromise;
    }

    selfieSegmentationScriptPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = resolveSelfieSegmentationAssetUrl('selfie_segmentation.js');
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });

    return selfieSegmentationScriptPromise;
}
