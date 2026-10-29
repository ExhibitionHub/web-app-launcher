import { CameraAddon } from './addons/cameraAddon.js?v=20260327b';
import { DocumentAddon } from './addons/documentAddon.js';

const DEFAULT_PROFILE_DATA = {};

class ResearchStation {
    constructor() {
        this.lang = window.i18n?.data || {};
        this.cameraAddon = null;
        this.documentAddon = new DocumentAddon({ lang: this.lang });
        this.currentProfile = null;
        this.capturedImage = null;
        this.panel = null;
        this.liveDocNotes = null;
        this.hasBaseDocument = false;
        this.liveRenderHandle = null;
        this.lastRenderTs = 0;
        this.isSendMode = false;
        this.sendSnapshot = null;
        this.emailPanel = null;
        this.emailInput = null;
        this.emailForm = null;
        this.emailStatus = null;
        this.sendSubmitBtn = null;
        this.sendBtn = null;
        this.virtualKeyboard = null;
        this.profileData = DEFAULT_PROFILE_DATA;
        this.runtimeConfigPromise = null;
        this.isSendingEmail = false;
        this.handleLanguageChange = this.handleLanguageChange.bind(this);
        this.handleProfileUpdate = this.handleProfileUpdate.bind(this);
        
        this.initUI();
        window.addEventListener('i18n:changed', this.handleLanguageChange);
        window.addEventListener('sk-personality:profile-updated', this.handleProfileUpdate);

        (window.i18n?.ready || Promise.resolve(true)).then(() => {
            const data = window.i18n?.data || {};
            this.lang = data;
            this.profileData = data.researchProfiles || DEFAULT_PROFILE_DATA;
            if (this.documentAddon?.setLang) {
                this.documentAddon.setLang(this.lang);
            }
            this.buildVirtualKeyboard();
        });
    }

    getApiUrl(path) {
        if (!path) {
            return window.location.pathname;
        }

        if (/^[a-z]+:\/\//i.test(path)) {
            return path;
        }

        return path.startsWith('/') ? path : `/${path}`;
    }

    initUI() {
        this.panel = document.querySelector('.research-panel');
        this.videoEl = document.getElementById('research-video');
        this.canvasEl = document.getElementById('research-canvas');
        this.previewCanvas = document.getElementById('document-preview-canvas');
        this.previewContainer = document.querySelector('.document-preview-container');
        this.sendBtn = document.getElementById('send-doc-btn');
        this.emailPanel = document.getElementById('email-panel');
        this.emailInput = document.getElementById('email-input');
        this.emailForm = document.getElementById('email-form');
        this.emailStatus = document.getElementById('email-status');
        this.virtualKeyboard = document.getElementById('virtual-keyboard');
        this.sendSubmitBtn = this.emailForm?.querySelector('button[type="submit"]') || null;
        this.sendModal = document.getElementById('send-modal-backdrop');
        this.sendModalClose = document.getElementById('send-modal-close');
        this.sendModalTitle = document.getElementById('send-modal-title');
        this.sendModalBody = document.getElementById('send-modal-body');
        this.sendModalSpinner = document.getElementById('send-modal-spinner');
        this.emailCancelBtn = document.getElementById('email-cancel-btn');

        // Listen for entry event
        window.addEventListener('enter-research-mode', (e) => this.enter(e.detail));
        window.addEventListener('exit-research-mode', () => this.exit());

        if (this.sendBtn) {
            this.sendBtn.addEventListener('click', () => this.openSendMode());
        }
        if (this.emailForm) {
            this.emailForm.addEventListener('submit', (e) => this.handleEmailSubmit(e));
        }
        if (this.emailInput) {
            this.emailInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleEmailSubmit(e);
                }
            });
            this.emailInput.addEventListener('input', () => this.setEmailStatus(''));
        }
        if (this.virtualKeyboard) {
            this.buildVirtualKeyboard();
        }
        if (this.sendModalClose) {
            this.sendModalClose.addEventListener('click', () => this.handleModalClose());
        }
        if (this.emailCancelBtn) {
            this.emailCancelBtn.addEventListener('click', () => this.handleEmailCancel());
        }
    }

    getText(key, fallback = '') {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            return value === key ? fallback : value;
        }
        return fallback;
    }

    async handleLanguageChange() {
        const data = window.i18n?.data || {};
        this.lang = data;
        this.profileData = data.researchProfiles || DEFAULT_PROFILE_DATA;

        if (this.documentAddon?.setLang) {
            this.documentAddon.setLang(this.lang);
        }

        this.buildVirtualKeyboard();

        if (!this.panel?.classList.contains('active') || !this.currentProfile) {
            return;
        }

        this.liveDocNotes = null;
        const renderOptions = {
            preserveLayout: true,
            includeStats: !this.isSendMode
        };

        if (this.isSendMode) {
            renderOptions.snapshotOverride = this.sendSnapshot || this.getLiveSnapshot() || null;
        }

        await this.renderDocumentOnce(renderOptions);
    }

    async handleProfileUpdate(event) {
        const profileData = event?.detail || event;
        if (!profileData) {
            return;
        }

        this.currentProfile = profileData;

        if (!this.panel?.classList.contains('active')) {
            return;
        }

        this.liveDocNotes = null;
        const renderOptions = {
            preserveLayout: true,
            includeStats: !this.isSendMode
        };

        if (this.isSendMode) {
            renderOptions.snapshotOverride = this.sendSnapshot || this.getLiveSnapshot() || null;
        }

        await this.renderDocumentOnce(renderOptions);
    }

    async getRuntimeConfig() {
        if (!this.runtimeConfigPromise) {
            this.runtimeConfigPromise = (async () => {
                const fallback = {
                    appKey: 'sk-personality',
                    language: window.i18n?.lang || 'en',
                    saveUrl: '/api/save/sk-personality',
                    mailUrl: '/api/mail/sk-personality',
                    clientLogUrl: '/api/log/client-error'
                };

                try {
                    const response = await fetch(this.getApiUrl('/api/runtime/app/sk-personality'), { cache: 'no-store' });
                    if (!response.ok) {
                        return fallback;
                    }

                    const payload = await response.json();
                    return {
                        appKey: payload.appKey || fallback.appKey,
                        language: payload.language || fallback.language,
                        saveUrl: payload.saveUrl || fallback.saveUrl,
                        mailUrl: payload.mailUrl || fallback.mailUrl,
                        clientLogUrl: payload.clientLogUrl || fallback.clientLogUrl
                    };
                } catch {
                    return fallback;
                }
            })();
        }

        return this.runtimeConfigPromise;
    }

    async logClientError(message, detail) {
        try {
            const runtime = await this.getRuntimeConfig();
            await fetch(this.getApiUrl(runtime.clientLogUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    source: 'sk-personality',
                    message,
                    detail,
                    url: window.location.href
                })
            });
        } catch {
        }
    }

    getLiveSnapshot() {
        if (!this.cameraAddon?.isReady?.()) {
            return null;
        }

        return this.cameraAddon.captureFrame() || this.canvasEl || null;
    }

    async enter(profileData) {
        if (!this.panel) {
            console.warn('Research panel not found; skipping research mode.');
            return;
        }

        this.currentProfile = profileData;
        this.panel.classList.add('active');
        
        // Reset state
        this.capturedImage = null;
        this.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        this.liveDocNotes = null;
        this.hasBaseDocument = false;
        this.panel.classList.remove('send-mode');
        this.resetEmailPanel();

        // Initialize camera
        if (!this.cameraAddon) {
            this.cameraAddon = new CameraAddon({
                videoEl: this.videoEl,
                outputCanvas: this.canvasEl
            });
        }
        
        try {
            await this.cameraAddon.init();
            await this.renderDocumentOnce();
            this.startLiveRender();
        } catch (error) {
            console.warn('Unable to start camera addon; continuing without live portrait.', error);
            await this.renderDocumentOnce({ snapshotOverride: null });
        }
    }

    async renderDocumentOnce(options = {}) {
        const { preserveLayout = false, includeStats = true } = options;
        const hasSnapshotOverride = Object.prototype.hasOwnProperty.call(options, 'snapshotOverride');
        const snapshotOverride = hasSnapshotOverride ? options.snapshotOverride : undefined;

        if (!this.currentProfile) {
            return;
        }

        if (!this.liveDocNotes) {
            const profileType = this.currentProfile.profile?.id || this.currentProfile.profile?.type || this.currentProfile.type;
            const pool = this.profileData || DEFAULT_PROFILE_DATA;
            const firstProfile = Object.values(pool)[0];
            const data = pool[profileType] || firstProfile || { notes: [], locations: [], alias: [] };
            const defaultAlias = this.documentAddon?.getDefault?.('aliases', '[REDACTED]') || '[REDACTED]';
            const randomNotes = [];
            const notesPool = [...data.notes];
            for(let i=0; i<3; i++) {
                if(notesPool.length === 0) break;
                const idx = Math.floor(Math.random() * notesPool.length);
                randomNotes.push(notesPool.splice(idx, 1)[0]);
            }
            this.liveDocNotes = {
                notes: randomNotes,
                aliases: data.alias && data.alias.length ? data.alias.join(', ') : defaultAlias,
                locations: data.locations,
                profileType
            };
        }

        // Capture current frame of the processed camera output
        const snapshot = hasSnapshotOverride ? snapshotOverride : this.getLiveSnapshot();

        const config = {
            profileType: this.liveDocNotes.profileType,
            notes: this.liveDocNotes.notes,
            organized: Math.round(this.currentProfile.scores.organized),
            impulsive: Math.round(this.currentProfile.scores.impulsive),
            control: Math.round(this.currentProfile.scores.control),
            social: Math.round(this.currentProfile.scores.social),
            aliases: this.liveDocNotes.aliases,
            locations: this.liveDocNotes.locations,
            profile: this.currentProfile.profile
        };

        this.documentAddon.build({
            canvas: this.previewCanvas,
            imageSource: snapshot,
            data: config,
            preserveLayout,
            includeStats
        });
        this.hasBaseDocument = true;
    }

    saveDocument() {
        if (!this.previewCanvas) return;
        this.refreshPhotoFrame(); // ensure latest frame is captured without rerandomizing
        const link = document.createElement('a');
        link.download = 'dossier.png';
        link.href = this.previewCanvas.toDataURL('image/png');
        link.click();
    }

    buildMailAttachment(maxBase64Length = 450000) {
        if (!this.previewCanvas) return null;

        const exportCanvas = document.createElement('canvas');
        const exportCtx = exportCanvas.getContext('2d');
        if (!exportCtx) return null;

        const scaleSteps = [1, 0.92, 0.84, 0.76, 0.68];
        const qualitySteps = [0.86, 0.78, 0.7, 0.62, 0.54];
        const maxAttachmentLength = Number.isFinite(maxBase64Length)
            ? Math.max(80000, Math.round(maxBase64Length))
            : 450000;
        let smallestAsset = null;

        for (const scale of scaleSteps) {
            const width = Math.max(1, Math.round(this.previewCanvas.width * scale));
            const height = Math.max(1, Math.round(this.previewCanvas.height * scale));

            exportCanvas.width = width;
            exportCanvas.height = height;
            exportCtx.imageSmoothingEnabled = true;
            exportCtx.imageSmoothingQuality = 'high';
            exportCtx.fillStyle = '#ffffff';
            exportCtx.fillRect(0, 0, width, height);
            exportCtx.drawImage(this.previewCanvas, 0, 0, width, height);

            for (const quality of qualitySteps) {
                const dataUrl = exportCanvas.toDataURL('image/jpeg', quality);
                const contentBase64 = String(dataUrl).split(',')[1] || '';
                const attachment = {
                    fileName: 'dossier.jpg',
                    contentType: 'image/jpeg',
                    contentBase64
                };

                if (!smallestAsset || contentBase64.length < smallestAsset.contentBase64.length) {
                    smallestAsset = attachment;
                }

                if (contentBase64.length <= maxAttachmentLength) {
                    return attachment;
                }
            }
        }

        return smallestAsset;
    }

    async sendMailRequest(mailUrl, payload) {
        const response = await fetch(this.getApiUrl(mailUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const responsePayload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(responsePayload.message || `Mail API failed with status ${response.status}`);
            error.status = response.status;
            throw error;
        }

        return responsePayload;
    }

    isRetriableMailTransportError(error) {
        if (!error) {
            return false;
        }

        if (typeof error.status === 'number' && (error.status === 413 || error.status === 431)) {
            return true;
        }

        const message = error instanceof Error ? error.message : String(error);
        return /networkerror|failed to fetch|load failed/i.test(message);
    }

    startLiveRender() {
        this.stopLiveRender();
        const tick = (ts = 0) => {
            // throttle to ~10fps to avoid overdraw
            if (ts - this.lastRenderTs > 100 && this.cameraAddon?.isReady()) {
                if (!this.hasBaseDocument) {
                    this.renderDocumentOnce();
                } else {
                    this.refreshPhotoFrame();
                }
                this.lastRenderTs = ts;
            }
            this.liveRenderHandle = requestAnimationFrame(tick);
        };
        this.liveRenderHandle = requestAnimationFrame(tick);
    }

    refreshPhotoFrame() {
        if (!this.hasBaseDocument) return;
        const snapshot = this.getLiveSnapshot();
        if (!snapshot) return;
        this.documentAddon.refreshPhoto({
            canvas: this.previewCanvas,
            imageSource: snapshot
        });
    }

    stopLiveRender() {
        if (this.liveRenderHandle) {
            cancelAnimationFrame(this.liveRenderHandle);
            this.liveRenderHandle = null;
        }
    }

    exit() {
        this.isSendMode = false;
        this.sendSnapshot = null;
        if (this.cameraAddon) {
            this.cameraAddon.stop();
        }
        this.stopLiveRender();
        document.querySelector('.result-container')?.classList.remove('send-mode');
        this.panel?.classList.remove('active');
        this.panel?.classList.remove('send-mode');
        if (this.previewCanvas) {
            const ctx = this.previewCanvas.getContext('2d');
            ctx?.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        }
        this.resetEmailPanel();
    }

    openSendMode() {
        if (!this.panel || this.isSendMode) return;

        const snapshot = this.getLiveSnapshot();
        this.sendSnapshot = snapshot;
        this.stopLiveRender();
        if (this.cameraAddon) {
            this.cameraAddon.pause();
        }

        this.renderDocumentOnce({ preserveLayout: true, includeStats: false, snapshotOverride: snapshot });
        this.isSendMode = true;
        document.querySelector('.result-container')?.classList.add('send-mode');
        this.panel.classList.add('send-mode');
        if (this.emailInput) {
            this.emailInput.value = '';
            this.emailInput.focus();
        }
        this.setEmailStatus(
            snapshot
                ? ''
                : this.getText('ui.research.statusNoCamera', 'Live photo unavailable on this connection. The dossier can still be sent.')
        );
    }

    async closeSendMode() {
        if (!this.panel) return;

        this.isSendMode = false;
        this.sendSnapshot = null;
        document.querySelector('.result-container')?.classList.remove('send-mode');
        this.panel.classList.remove('send-mode');
        this.resetEmailPanel();
        if (this.cameraAddon) {
            this.cameraAddon.resume();
        }
        this.startLiveRender();
    }

    buildVirtualKeyboard() {
        if (!this.virtualKeyboard) return;
        this.virtualKeyboard.innerHTML = '';
        const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
        const numbers = '0123456789'.split('');
        const specials = ['@', '.', '-', '_', '+'];
        const actions = [
            { label: this.getText('ui.research.keyboardBackspace', '←'), action: 'backspace' },
            { label: this.getText('ui.research.keyboardClear', 'Clear'), action: 'clear' }
        ];

        actions[0].label = this.getText('ui.research.keyboardBackspace', 'Delete');
        const keys = [...letters, ...numbers, ...specials];
        const fragment = document.createDocumentFragment();
        keys.forEach(key => {
            fragment.appendChild(this.createVirtualKeyButton({ label: key, key }));
        });

        actions.forEach(({ label, action }) => {
            fragment.appendChild(this.createVirtualKeyButton({ label, action }));
        });

        this.virtualKeyboard.appendChild(fragment);
    }

    createVirtualKeyButton({ label, key = null, action = null }) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'virtual-key';
        btn.textContent = label;
        if (key) {
            btn.dataset.key = key;
        }
        if (action) {
            btn.dataset.action = action;
        }
        btn.addEventListener('mousedown', (event) => event.preventDefault());
        btn.addEventListener('click', () => this.applyVirtualKey(action || key || ''));
        return btn;
    }

    getInputSelection(input) {
        if (!input) {
            return { start: 0, end: 0 };
        }

        const valueLength = input.value.length;
        const start = typeof input.selectionStart === 'number' ? input.selectionStart : valueLength;
        const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : valueLength;
        return { start, end };
    }

    setInputCursor(input, position) {
        if (!input) {
            return;
        }

        input.focus({ preventScroll: true });
        if (typeof input.setSelectionRange !== 'function') {
            return;
        }

        try {
            input.setSelectionRange(position, position);
        } catch {
        }
    }

    applyVirtualKey(key) {
        if (!this.emailInput) return;
        const input = this.emailInput;
        const action = (key || '').toLowerCase();
        const value = input.value;
        const { start: selectionStart, end: selectionEnd } = this.getInputSelection(input);

        if (action === 'backspace') {
            if (selectionStart !== selectionEnd) {
                input.value = `${value.slice(0, selectionStart)}${value.slice(selectionEnd)}`;
                this.setInputCursor(input, selectionStart);
            } else if (selectionStart > 0) {
                const cursor = selectionStart - 1;
                input.value = `${value.slice(0, cursor)}${value.slice(selectionEnd)}`;
                this.setInputCursor(input, cursor);
            }
        } else if (action === 'clear') {
            input.value = '';
            this.setInputCursor(input, 0);
        } else {
            input.value = `${value.slice(0, selectionStart)}${key}${value.slice(selectionEnd)}`;
            const cursor = selectionStart + key.length;
            this.setInputCursor(input, cursor);
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus({ preventScroll: true });
    }

    isEmailValid(email) {
        if (!email) {
            return false;
        }

        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    setEmailBusy(isBusy) {
        this.isSendingEmail = isBusy;
        if (this.emailInput) {
            this.emailInput.disabled = isBusy;
        }
        if (this.sendSubmitBtn) {
            this.sendSubmitBtn.disabled = isBusy;
            this.sendSubmitBtn.classList.toggle('is-disabled', isBusy);
        }
        if (this.emailCancelBtn) {
            this.emailCancelBtn.disabled = isBusy;
            this.emailCancelBtn.classList.toggle('is-disabled', isBusy);
        }
        if (this.virtualKeyboard) {
            this.virtualKeyboard.querySelectorAll('button').forEach((button) => {
                button.disabled = isBusy;
                button.classList.toggle('is-disabled', isBusy);
            });
        }
    }

    async handleEmailSubmit(event) {
        event.preventDefault();
        if (this.isSendingEmail || !this.emailInput || !this.previewCanvas) return;
        const email = this.emailInput.value.trim();
        if (!email) {
            this.setEmailStatus(this.getText('ui.research.statusMissing', 'Add a recipient to send the dossier.'));
            return;
        }
        if (!this.isEmailValid(email) || !this.emailInput.checkValidity()) {
            this.setEmailStatus(this.getText('ui.research.statusInvalid', 'Enter a valid email address.'));
            return;
        }

        this.emailInput.value = email;
        this.setEmailBusy(true);
        // ensure latest photo and stats hidden
        const snapshot = this.getLiveSnapshot() || this.sendSnapshot || null;
        this.sendSnapshot = snapshot;
        await this.renderDocumentOnce({ preserveLayout: true, includeStats: false, snapshotOverride: snapshot });
        const subject = this.getText('ui.research.mailSubject', 'Case File Attached: Personality Dossier');
        const bodyTemplate = this.getText('ui.research.mailBody', 'Your confidential dossier is attached.\n\nCompiled from your responses during the Personality Snapshot investigation, this file records the behavioural profile identified during your session.\n\nThank you for taking part in the investigation.\n\nExhibition Hub');
        const body = bodyTemplate.replace('{email}', email);

        this.setEmailStatus(this.getText('ui.research.statusSending', 'Sending...'));

        this.showSendModal({
            title: this.getText('ui.research.statusSending', 'Sending...'),
            body: this.getText('ui.modal.body', 'Please wait while we send your profile.'),
            loading: true
        });

        try {
            const runtime = await this.getRuntimeConfig();
            const htmlBody = body
                .split('\n\n')
                .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
                .join('');
            const attachmentBudgets = [450000, 220000];
            let payload = null;
            let lastError = null;

            for (const attachmentBudget of attachmentBudgets) {
                const attachment = this.buildMailAttachment(attachmentBudget);
                if (!attachment?.contentBase64) {
                    throw new Error('Unable to prepare dossier attachment.');
                }

                try {
                    payload = await this.sendMailRequest(runtime.mailUrl, {
                        to: email,
                        subject,
                        textBody: body,
                        htmlBody,
                        attachments: [attachment]
                    });
                    lastError = null;
                    break;
                } catch (error) {
                    lastError = error;
                    if (!this.isRetriableMailTransportError(error) || attachmentBudget === attachmentBudgets[attachmentBudgets.length - 1]) {
                        throw error;
                    }
                }
            }

            if (!payload && lastError) {
                throw lastError;
            }

            const deliveryStatus = String(payload.status || '').toLowerCase();
            if (deliveryStatus === 'failed') {
                throw new Error(payload.lastError || this.getText('ui.research.statusError', 'Unable to send your dossier.'));
            }

            if (deliveryStatus === 'queued') {
                const queuedMessage = this.getText('ui.research.statusQueued', 'Profile queued for delivery.');
                this.setEmailStatus(queuedMessage);
                this.updateSendModal({
                    title: this.getText('ui.modal.title', 'Profile sent'),
                    body: queuedMessage,
                    loading: false
                });
                return;
            }

            this.setEmailStatus(this.getText('ui.research.statusSuccess', 'Dossier sent.'));
            this.updateSendModal({
                title: this.getText('ui.modal.title', 'Profile sent'),
                body: this.getText('ui.modal.body', 'Your snapshot is on the way.'),
                loading: false
            });
        } catch (error) {
            console.error('Send failed', error);
            this.logClientError('Unable to send personality dossier.', error instanceof Error ? error.stack || error.message : String(error));
            const statusErrorMessage = this.getText('ui.research.statusError', 'Unable to send your dossier.');
            if (this.emailStatus) {
                this.emailStatus.textContent = statusErrorMessage;
            }

            this.updateSendModal({
                title: this.getText('ui.error.title', 'Error'),
                body: statusErrorMessage,
                loading: false
            });
        } finally {
            this.setEmailBusy(false);
        }
    }

    setEmailStatus(message) {
        if (this.emailStatus) {
            this.emailStatus.textContent = message;
        }
    }

    resetEmailPanel() {
        if (this.emailInput) this.emailInput.value = '';
        this.setEmailBusy(false);
        this.setEmailStatus('');
    }

    showSendModal({ title, body, loading = false } = {}) {
        if (!this.sendModal) {
            this.handleModalClose();
            return;
        }
        this.sendModal.classList.add('active');
        this.updateSendModal({ title, body, loading });
    }

    updateSendModal({ title, body, loading = false } = {}) {
        if (this.sendModalTitle && title) {
            this.sendModalTitle.textContent = title;
        }
        if (this.sendModalBody && body) {
            this.sendModalBody.textContent = body;
        }
        if (this.sendModalSpinner) {
            this.sendModalSpinner.style.display = loading ? 'inline-block' : 'none';
        }
        if (this.sendModal) {
            this.sendModal.classList.toggle('send-modal--loading', loading);
        }
        if (this.sendModalClose) {
            this.sendModalClose.disabled = loading;
            this.sendModalClose.classList.toggle('is-disabled', loading);
        }
    }

    handleModalClose() {
        if (this.sendModal) {
            this.sendModal.classList.remove('active');
        }
        window.dispatchEvent(new Event('exit-research-mode'));
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
            restartBtn.click();
        } else {
            window.location.reload();
        }
    }

    handleEmailCancel() {
        if (this.isSendingEmail) {
            return;
        }
        this.closeSendMode();
    }
}

// Initialize
new ResearchStation();
