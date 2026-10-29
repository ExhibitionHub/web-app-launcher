(function () {
  class PanelsMobileApp {
    constructor() {
      this.views = ['home', 'scan', 'list', 'panel'];
      this.panelIds = [];
      this.panels = {};
      this.currentPanelId = '';
      this.currentView = 'home';
      this.statusKey = '';
      this.statusVars = null;
      this.scannerStatusKey = '';
      this.scannerStatusVars = null;
      this.stream = null;
      this.detector = null;
      this.scanFrame = 0;
      this.scanPending = false;
      this.scanActive = false;
      this.scanState = 'idle';
      this.tracker = window.EHTracking
        ? window.EHTracking.createTracker({
            exhibition: 'SK',
            application: 'SK-panels-mobile',
            getLanguage: () => window.i18n?.lang || 'en',
          })
        : null;

      this.handlePopState = this.handlePopState.bind(this);
      this.handleLanguageChange = this.handleLanguageChange.bind(this);
      this.handlePageHide = this.handlePageHide.bind(this);
      this.scanLoop = this.scanLoop.bind(this);
    }

    async init() {
      if (window.i18n?.ready) {
        await window.i18n.ready;
      }

      this.cacheElements();
      this.loadPanels();
      this.bindEvents();

      const initialState = this.getStateFromUrl();
      this.currentPanelId = initialState.panelId || this.getFirstPanelId();
      this.currentView = this.resolveView(initialState.view, this.currentPanelId);

      if (initialState.panelId && !this.resolvePanelId(initialState.panelId)) {
        this.setStatus('panelApp.status.unknownPanel');
      }

      if (!this.currentPanelId) {
        this.setStatus('panelApp.status.noPanels');
      }

      this.writeUrl({ view: this.currentView, panelId: this.currentPanelId }, true);
      this.bootstrapScannerState();
      this.render();
      this.startTracking();
    }

    cacheElements() {
      this.brandHomeBtn = document.getElementById('brand-home-btn');
      this.viewEyebrow = document.getElementById('view-eyebrow');
      this.viewLabel = document.getElementById('view-label');
      this.viewStack = document.getElementById('view-stack');
      this.viewElements = Array.from(document.querySelectorAll('.app-view'));
      this.navButtons = Array.from(document.querySelectorAll('[data-nav-view]'));

      this.homeScanBtn = document.getElementById('home-scan-btn');
      this.homeListBtn = document.getElementById('home-list-btn');
      this.homePanelBtn = document.getElementById('home-panel-btn');
      this.homeResumeCard = document.getElementById('home-resume-card');
      this.homeCurrentPanelTitle = document.getElementById('home-current-panel-title');
      this.homeCurrentPanelMeta = document.getElementById('home-current-panel-meta');
      this.homePanelCount = document.getElementById('home-panel-count');
      this.homeLanguageName = document.getElementById('home-language-name');

      this.scanToggleBtn = document.getElementById('scan-toggle-btn');
      this.scanListBtn = document.getElementById('scan-list-btn');
      this.scannerEl = document.getElementById('scanner');
      this.scannerPlaceholder = document.getElementById('scanner-placeholder');
      this.scannerPill = document.getElementById('scanner-pill');
      this.scannerVideo = document.getElementById('scanner-video');
      this.scannerStatusEl = document.getElementById('scanner-status');

      this.panelListEl = document.getElementById('panel-list');

      this.panelCard = document.getElementById('panel-card');
      this.panelKicker = document.getElementById('panel-kicker');
      this.panelCounter = document.getElementById('panel-counter');
      this.panelProgressFill = document.getElementById('panel-progress-fill');
      this.panelTitle = document.getElementById('panel-title');
      this.panelBody = document.getElementById('panel-body');
      this.panelListBtn = document.getElementById('panel-list-btn');
      this.panelScanBtn = document.getElementById('panel-scan-btn');
      this.prevBtn = document.getElementById('prev-btn');
      this.nextBtn = document.getElementById('next-btn');

      this.statusEl = document.getElementById('app-status');
    }

    bindEvents() {
      this.brandHomeBtn?.addEventListener('click', () => this.navigateTo('home', { trackStep: 'brand-home' }));

      this.navButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const targetView = button.getAttribute('data-nav-view') || 'home';
          this.navigateTo(targetView, { trackStep: `dock-${targetView}` });
        });
      });

      this.homeScanBtn?.addEventListener('click', () => this.navigateTo('scan', { trackStep: 'home-scan' }));
      this.homeListBtn?.addEventListener('click', () => this.navigateTo('list', { trackStep: 'home-list' }));
      this.homePanelBtn?.addEventListener('click', () => this.openPanel(this.currentPanelId, { trackStep: 'home-panel' }));

      this.scanToggleBtn?.addEventListener('click', () => {
        if (this.scanActive) {
          this.closeScanner();
          return;
        }

        void this.openScanner();
      });
      this.scanListBtn?.addEventListener('click', () => this.navigateTo('list', { trackStep: 'scan-list' }));

      this.panelListEl?.addEventListener('click', (event) => {
        const trigger = event.target instanceof Element ? event.target.closest('[data-panel-id]') : null;
        if (!trigger) {
          return;
        }

        this.openPanel(trigger.getAttribute('data-panel-id'), { trackStep: 'list-panel' });
      });

      this.panelListBtn?.addEventListener('click', () => this.navigateTo('list', { trackStep: 'panel-list' }));
      this.panelScanBtn?.addEventListener('click', () => this.navigateTo('scan', { trackStep: 'panel-scan' }));
      this.prevBtn?.addEventListener('click', () => this.stepPanel(-1));
      this.nextBtn?.addEventListener('click', () => this.stepPanel(1));

      window.addEventListener('popstate', this.handlePopState);
      window.addEventListener('i18n:changed', this.handleLanguageChange);
      window.addEventListener('pagehide', this.handlePageHide, { passive: true });
    }

    handlePopState() {
      const previousView = this.currentView;
      const state = this.getStateFromUrl();
      const resolvedPanelId = state.panelId || this.currentPanelId || this.getFirstPanelId();
      const resolvedView = this.resolveView(state.view, resolvedPanelId);

      if (previousView === 'scan' && resolvedView !== 'scan') {
        this.stopScanner();
        this.setScannerState('idle');
        this.setScannerStatus('panelApp.scanner.tapToStart');
      }

      if (resolvedPanelId) {
        this.currentPanelId = resolvedPanelId;
      }
      this.currentView = resolvedView;
      this.render(previousView);

      if (this.currentView === 'panel') {
        this.trackCurrentPanel('panel-popstate');
      } else {
        this.trackView('view-popstate');
      }
    }

    handleLanguageChange() {
      this.loadPanels();
      this.currentPanelId = this.resolvePanelId(this.currentPanelId) || this.getFirstPanelId();
      this.currentView = this.resolveView(this.currentView, this.currentPanelId);
      this.writeUrl({ view: this.currentView, panelId: this.currentPanelId }, true);
      this.render(this.currentView);
      this.renderStatus();
      this.renderScannerStatus();
      this.updateScannerUi();
      if (this.tracker) {
        void this.tracker.refresh({ step: 'language-change', language: window.i18n?.lang || 'en' });
      }
    }

    handlePageHide() {
      this.stopScanner();
    }

    loadPanels() {
      const order = window.i18n?.t('panels.order');
      const items = window.i18n?.t('panels.items');
      this.panels = items && typeof items === 'object' ? items : {};

      const orderedIds = Array.isArray(order)
        ? order.map((value) => this.normalizePanelId(value)).filter((value) => value && this.panels[value])
        : [];

      this.panelIds = orderedIds.length ? orderedIds : Object.keys(this.panels).map((value) => this.normalizePanelId(value)).filter(Boolean);
    }

    bootstrapScannerState() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        this.setScannerState('blocked');
        this.setScannerStatus('panelApp.scanner.secureContext');
        return;
      }

      this.detector = this.createDetector();
      if (!this.detector) {
        this.setScannerState('blocked');
        this.setScannerStatus('panelApp.scanner.unsupported');
        return;
      }

      this.setScannerState('idle');
      this.setScannerStatus('panelApp.scanner.tapToStart');
    }

    normalizePanelId(value) {
      return String(value || '').trim().toLowerCase();
    }

    resolveView(value, panelId = this.currentPanelId) {
      const normalized = String(value || '').trim().toLowerCase();
      if (this.views.includes(normalized)) {
        if (normalized === 'panel' && !panelId) {
          return 'home';
        }
        return normalized;
      }

      return panelId ? 'panel' : 'home';
    }

    getFirstPanelId() {
      return this.panelIds[0] || '';
    }

    resolvePanelId(value) {
      const normalized = this.normalizePanelId(value);
      return this.panelIds.includes(normalized) ? normalized : '';
    }

    getPanelIdFromUrl(url = new URL(window.location.href)) {
      const keys = ['panel', 'panelId', 'contentId', 'content', 'id'];
      for (const key of keys) {
        const value = this.resolvePanelId(url.searchParams.get(key));
        if (value) {
          return value;
        }
      }

      const hashValue = this.resolvePanelId(url.hash.replace(/^#/, ''));
      return hashValue || '';
    }

    getStateFromUrl(url = new URL(window.location.href)) {
      const panelId = this.getPanelIdFromUrl(url);
      const view = this.resolveView(url.searchParams.get('view'), panelId);
      return { view, panelId };
    }

    writeUrl({ view = this.currentView, panelId = this.currentPanelId } = {}, replaceState = false) {
      const url = new URL(window.location.href);
      const resolvedView = this.resolveView(view, panelId);
      const resolvedPanelId = this.resolvePanelId(panelId);

      url.searchParams.set('view', resolvedView);
      if (resolvedPanelId) {
        url.searchParams.set('panel', resolvedPanelId);
      } else {
        ['panel', 'panelId', 'contentId', 'content', 'id'].forEach((key) => url.searchParams.delete(key));
      }
      ['panelId', 'contentId', 'content', 'id'].forEach((key) => {
        if (key !== 'panel') {
          url.searchParams.delete(key);
        }
      });
      url.hash = '';

      const targetUrl = `${url.pathname}${url.search}${url.hash}`;
      const state = { view: resolvedView, panelId: resolvedPanelId };
      if (replaceState) {
        window.history.replaceState(state, '', targetUrl);
      } else {
        window.history.pushState(state, '', targetUrl);
      }
    }

    t(key, vars) {
      if (window.i18n?.t) {
        return window.i18n.t(key, vars);
      }

      return key;
    }

    setStatus(key, vars = null) {
      this.statusKey = key || '';
      this.statusVars = vars;
      this.renderStatus();
    }

    renderStatus() {
      if (!this.statusEl) {
        return;
      }

      const text = this.statusKey ? this.t(this.statusKey, this.statusVars || undefined) : '';
      this.statusEl.textContent = text;
      this.statusEl.hidden = !text;
    }

    setScannerStatus(key, vars = null) {
      this.scannerStatusKey = key || '';
      this.scannerStatusVars = vars;
      this.renderScannerStatus();
    }

    renderScannerStatus() {
      if (!this.scannerStatusEl) {
        return;
      }

      const text = this.scannerStatusKey
        ? this.t(this.scannerStatusKey, this.scannerStatusVars || undefined)
        : '';

      this.scannerStatusEl.textContent = text;
      if (this.scannerPlaceholder) {
        this.scannerPlaceholder.textContent = this.scanActive ? '' : text;
      }
    }

    setScannerState(state) {
      this.scanState = state || 'idle';
      this.updateScannerUi();
    }

    getCurrentLanguageName() {
      const label = this.t('meta.languageName');
      return label === 'meta.languageName' ? String(window.i18n?.lang || 'en').toUpperCase() : label;
    }

    updateScannerUi() {
      if (this.scannerEl) {
        this.scannerEl.dataset.state = this.scanState;
      }

      if (this.scanToggleBtn) {
        const labelKey = this.scanActive ? 'common.stopScan' : 'panelApp.scan.openButton';
        this.scanToggleBtn.textContent = this.t(labelKey);
        this.scanToggleBtn.setAttribute('aria-label', this.t(labelKey));
        this.scanToggleBtn.setAttribute('aria-pressed', String(this.scanActive));
        this.scanToggleBtn.classList.toggle('is-active', this.scanActive);
        this.scanToggleBtn.disabled = this.scanState === 'blocked';
      }

      if (this.scannerPill) {
        this.scannerPill.textContent = this.t(
          this.scanState === 'active'
            ? 'panelApp.scanner.pillLive'
            : this.scanState === 'matched'
              ? 'panelApp.scanner.pillMatch'
              : this.scanState === 'blocked'
                ? 'panelApp.scanner.pillOff'
                : 'panelApp.scanner.pillReady'
        );
      }
    }

    pulsePanel() {
      if (!this.panelCard) {
        return;
      }

      this.panelCard.classList.remove('is-refreshing');
      void this.panelCard.offsetWidth;
      this.panelCard.classList.add('is-refreshing');
    }

    render(previousView = '') {
      this.renderViewState(previousView);
      this.renderHome();
      this.renderList();
      this.renderPanel();
      this.renderStatus();
      this.renderScannerStatus();
      this.updateScannerUi();
    }

    renderViewState(previousView = '') {
      const currentIndex = this.views.indexOf(this.currentView);
      const previousIndex = this.views.indexOf(previousView);
      const direction = currentIndex >= previousIndex ? 'forward' : 'back';

      if (this.viewStack) {
        this.viewStack.dataset.view = this.currentView;
        this.viewStack.dataset.direction = direction;
      }

      this.viewElements.forEach((viewElement) => {
        const viewName = viewElement.getAttribute('data-view') || '';
        const viewIndex = this.views.indexOf(viewName);
        const isActive = viewName === this.currentView;
        viewElement.classList.toggle('is-active', isActive);
        viewElement.classList.toggle('is-before', viewIndex < currentIndex);
        viewElement.classList.toggle('is-after', viewIndex > currentIndex);
        viewElement.setAttribute('aria-hidden', String(!isActive));
      });

      this.navButtons.forEach((button) => {
        const targetView = button.getAttribute('data-nav-view') || '';
        const isActive = targetView === this.currentView;
        const panelButton = targetView === 'panel';
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        button.disabled = panelButton && !this.currentPanelId;
      });

      if (this.viewEyebrow) {
        this.viewEyebrow.textContent = this.t(`panelApp.views.${this.currentView}.eyebrow`);
      }
      if (this.viewLabel) {
        this.viewLabel.textContent = this.t(`panelApp.views.${this.currentView}.label`);
      }
    }

    renderHome() {
      if (!this.homeResumeCard || !this.homeCurrentPanelTitle) {
        return;
      }

      this.homeResumeCard.hidden = false;
      this.homeCurrentPanelTitle.textContent = this.t('panelApp.home.title');
    }

    renderList() {
      if (!this.panelListEl) {
        return;
      }

      this.panelListEl.innerHTML = '';
      if (!this.panelIds.length) {
        const emptyState = document.createElement('p');
        emptyState.className = 'scene-copy scene-copy--small';
        emptyState.textContent = this.t('panelApp.list.empty');
        this.panelListEl.appendChild(emptyState);
        return;
      }

      this.panelIds.forEach((panelId, index) => {
        const panel = this.panels[panelId];
        if (!panel) {
          return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'panel-list__item';
        button.setAttribute('data-panel-id', panelId);
        if (panelId === this.currentPanelId) {
          button.classList.add('is-active');
        }

        button.innerHTML = `
          <span class="panel-list__index">${panel.kicker || String(index + 1).padStart(2, '0')}</span>
          <span class="panel-list__copy">
            <strong class="panel-list__title">${this.escapeHtml(panel.title || '')}</strong>
          </span>
        `;

        this.panelListEl.appendChild(button);
      });
    }

    renderPanel() {
      const panel = this.panels[this.currentPanelId];

      if (!panel) {
        this.panelTitle.textContent = this.panelIds.length ? this.t('panelApp.status.unknownPanel') : this.t('panelApp.status.noPanels');
        this.panelBody.innerHTML = '';
      } else {
        this.panelTitle.textContent = panel.title || '';
        this.panelBody.innerHTML = '';

        const paragraphs = Array.isArray(panel.body)
          ? panel.body
          : panel.body
            ? [panel.body]
            : [];

        paragraphs.forEach((paragraph) => {
          const item = document.createElement('p');
          item.textContent = String(paragraph || '');
          this.panelBody.appendChild(item);
        });
      }

    }

    startTracking() {
      if (!this.tracker) {
        return;
      }

      void this.tracker.restart(4, {
        step: `open-${this.currentView}`,
        language: window.i18n?.lang || 'en',
      });

      if (this.currentView === 'panel') {
        this.trackCurrentPanel('open-panel');
      } else {
        this.trackView(`open-${this.currentView}`);
      }
    }

    trackView(step = '') {
      if (!this.tracker) {
        return;
      }

      const checkpoints = {
        home: 8,
        scan: 18,
        list: 30,
      };

      void this.tracker.track(checkpoints[this.currentView] || 8, {
        step: step || `view-${this.currentView}`,
        language: window.i18n?.lang || 'en',
      });
    }

    trackCurrentPanel(step = '') {
      if (!this.tracker || !this.currentPanelId) {
        return;
      }

      const index = Math.max(0, this.panelIds.indexOf(this.currentPanelId));
      const total = Math.max(1, this.panelIds.length - 1);
      const percentage = this.panelIds.length <= 1
        ? 76
        : Math.round(38 + ((index / total) * 60));

      void this.tracker.track(percentage, {
        step: step || `panel-${this.currentPanelId}`,
        language: window.i18n?.lang || 'en',
      });

      if (index === this.panelIds.length - 1) {
        void this.tracker.complete({
          step: `panel-${this.currentPanelId}-complete`,
          language: window.i18n?.lang || 'en',
        });
      }
    }

    navigateTo(view, { replaceState = false, panelId = '', trackStep = '' } = {}) {
      const previousView = this.currentView;
      const resolvedPanelId = this.resolvePanelId(panelId) || this.currentPanelId || this.getFirstPanelId();
      const nextView = this.resolveView(view, resolvedPanelId);

      if (previousView === 'scan' && nextView !== 'scan') {
        this.stopScanner();
        this.setScannerState('idle');
        this.setScannerStatus('panelApp.scanner.tapToStart');
      }

      this.currentPanelId = resolvedPanelId;
      this.currentView = nextView;
      this.writeUrl({ view: nextView, panelId: this.currentPanelId }, replaceState);
      this.render(previousView);

      if (nextView === 'panel') {
        this.pulsePanel();
        this.trackCurrentPanel(trackStep || 'view-panel');
      } else {
        this.trackView(trackStep || `view-${nextView}`);
      }
    }

    openPanel(panelId, { replaceState = false, trackStep = '' } = {}) {
      const resolved = this.resolvePanelId(panelId);
      if (!resolved) {
        this.setStatus('panelApp.status.unknownPanel');
        return false;
      }

      this.setStatus('');
      this.navigateTo('panel', { replaceState, panelId: resolved, trackStep: trackStep || `panel-${resolved}` });
      return true;
    }

    stepPanel(direction) {
      if (!this.currentPanelId) {
        return;
      }

      const index = this.panelIds.indexOf(this.currentPanelId);
      if (index < 0) {
        return;
      }

      const nextIndex = Math.max(0, Math.min(this.panelIds.length - 1, index + direction));
      if (nextIndex === index) {
        return;
      }

      this.openPanel(this.panelIds[nextIndex], { trackStep: direction > 0 ? 'panel-next' : 'panel-prev' });
    }

    createDetector() {
      if (typeof window.BarcodeDetector !== 'function') {
        return null;
      }

      try {
        return new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        try {
          return new window.BarcodeDetector();
        } catch {
          return null;
        }
      }
    }

    async openScanner() {
      this.scanActive = false;
      this.setScannerState('idle');
      this.setScannerStatus('');

      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        this.setScannerState('blocked');
        this.setScannerStatus('panelApp.scanner.secureContext');
        if (this.tracker) {
          void this.tracker.refresh({ step: 'scanner-secure-context', language: window.i18n?.lang || 'en' });
        }
        return;
      }

      this.detector = this.detector || this.createDetector();
      if (!this.detector) {
        this.setScannerState('blocked');
        this.setScannerStatus('panelApp.scanner.unsupported');
        if (this.tracker) {
          void this.tracker.refresh({ step: 'scanner-unsupported', language: window.i18n?.lang || 'en' });
        }
        return;
      }

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
          },
        });
      } catch (error) {
        this.setScannerState('idle');
        this.setScannerStatus(this.getScannerErrorKey(error));
        if (this.tracker) {
          void this.tracker.refresh({ step: 'scanner-error', language: window.i18n?.lang || 'en' });
        }
        return;
      }

      if (!this.scannerVideo) {
        return;
      }

      this.scannerVideo.srcObject = this.stream;
      try {
        await this.scannerVideo.play();
      } catch {
      }

      this.scanActive = true;
      this.setScannerState('active');
      this.setScannerStatus('panelApp.scanner.ready');
      if (this.tracker) {
        void this.tracker.refresh({ step: 'scanner-open', language: window.i18n?.lang || 'en' });
      }
      this.scanLoop();
    }

    closeScanner() {
      this.stopScanner();
      this.setScannerState('idle');
      this.setScannerStatus('panelApp.scanner.tapToStart');
      if (this.tracker) {
        void this.tracker.refresh({ step: 'scanner-close', language: window.i18n?.lang || 'en' });
      }
    }

    stopScanner() {
      this.scanActive = false;
      this.scanPending = false;
      if (this.scanFrame) {
        window.cancelAnimationFrame(this.scanFrame);
        this.scanFrame = 0;
      }

      if (this.scannerVideo) {
        try {
          this.scannerVideo.pause();
        } catch {
        }
        this.scannerVideo.srcObject = null;
      }

      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }

      this.updateScannerUi();
    }

    getScannerErrorKey(error) {
      const errorName = String(error?.name || '').trim();
      if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
        return 'panelApp.scanner.permissionDenied';
      }
      if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        return 'panelApp.scanner.noCamera';
      }
      return 'panelApp.scanner.unavailable';
    }

    scanLoop() {
      if (!this.scanActive) {
        return;
      }

      this.scanFrame = window.requestAnimationFrame(async () => {
        if (!this.scanActive) {
          return;
        }

        if (this.scanPending || !this.detector || !this.scannerVideo || this.scannerVideo.readyState < 2) {
          this.scanLoop();
          return;
        }

        this.scanPending = true;
        try {
          const detectedCodes = await this.detector.detect(this.scannerVideo);
          const rawValue = Array.isArray(detectedCodes)
            ? detectedCodes.map((item) => item?.rawValue).find(Boolean)
            : '';

          if (rawValue) {
            await this.handleScanResult(rawValue);
            return;
          }
        } catch {
        } finally {
          this.scanPending = false;
        }

        this.scanLoop();
      });
    }

    async handleScanResult(rawValue) {
      const target = this.resolveScanTarget(rawValue);
      if (!target) {
        this.setScannerStatus('panelApp.scanner.invalid');
        if (this.tracker) {
          void this.tracker.refresh({ step: 'qr-invalid', language: window.i18n?.lang || 'en' });
        }
        return;
      }

      if (this.tracker) {
        void this.tracker.track(56, { step: 'qr-detected', language: window.i18n?.lang || 'en' });
      }

      if (target.type === 'navigate') {
        this.stopScanner();
        window.location.assign(target.url.toString());
        return;
      }

      this.stopScanner();
      this.setScannerState('matched');
      this.setScannerStatus('panelApp.scanner.matched');
      this.openPanel(target.panelId, { trackStep: 'qr-panel' });
      window.setTimeout(() => {
        if (this.scanState === 'matched') {
          this.setScannerState('idle');
          this.setScannerStatus('panelApp.scanner.tapToStart');
        }
      }, 1200);
    }

    resolveScanTarget(rawValue) {
      const rawText = String(rawValue || '').trim();
      if (!rawText) {
        return null;
      }

      const directPanelId = this.resolvePanelId(rawText);
      if (directPanelId) {
        return { type: 'panel', panelId: directPanelId };
      }

      const looseParamPanelId = this.resolveLooseParamPanelId(rawText);
      if (looseParamPanelId) {
        return { type: 'panel', panelId: looseParamPanelId };
      }

      try {
        const url = new URL(rawText, window.location.href);
        const panelId = this.getPanelIdFromUrl(url);
        const samePage = url.origin === window.location.origin && url.pathname === window.location.pathname;
        const targetLang = String(url.searchParams.get('lang') || '').trim().toLowerCase();
        if (samePage && panelId && (!targetLang || targetLang === (window.i18n?.lang || '').toLowerCase())) {
          return { type: 'panel', panelId };
        }
        return { type: 'navigate', url };
      } catch {
        return null;
      }
    }

    resolveLooseParamPanelId(rawText) {
      const querySource = rawText.startsWith('?') ? rawText.slice(1) : rawText;
      if (!querySource.includes('=')) {
        return '';
      }

      const params = new URLSearchParams(querySource);
      return this.getPanelIdFromUrl(new URL(`${window.location.origin}${window.location.pathname}?${params.toString()}`));
    }

    escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  const app = new PanelsMobileApp();
  void app.init();
})();