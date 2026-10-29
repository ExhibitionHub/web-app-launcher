import { WantedPoster } from './poster.js';

export class DocumentAddon {
    constructor({ width = 1240, height = 1754, assetsBasePath = 'ressource/research', lang = null } = {}) {
        this.width = width;
        this.height = height;
        this.lang = lang || window.langData || {};
        this.poster = new WantedPoster({ assetsBasePath, lang: this.lang.poster });
        this.lastPhotoPlacement = null;
        this.lastCanvas = null;
        this.basePhotoRegion = null;
        this.lastBuildOptions = null;
        this.pendingLogoRender = false;
    }

    randomizeGlobals() {
        this.poster.regenerateGlobalData();
    }

    setLang(langData = {}) {
        this.lang = langData || {};
        this.poster.setLang(this.lang.poster);
    }

    build({ canvas, imageSource, data = {}, preserveLayout = false, includeStats = true } = {}) {
        const targetCanvas = canvas || document.createElement('canvas');
        targetCanvas.width = this.width;
        targetCanvas.height = this.height;
        this.lastCanvas = targetCanvas;
        this.lastBuildOptions = { canvas: targetCanvas, imageSource, data, preserveLayout, includeStats };

        // New dossier => refresh numbers/layout unless we want to keep them frozen
        if (!preserveLayout) {
            this.randomizeGlobals();
        }

        const { profile, notes, locations, ...rest } = data;

        if (profile) {
            this.poster.setProfile(profile);
        }

        const composedNotes = this.composeNotes({
            profile,
            profileType: rest.profileType,
            notes,
            locations,
            stats: {
                organized: rest.organized,
                impulsive: rest.impulsive,
                control: rest.control,
                social: rest.social
            },
            includeStats
        });

        const configOverrides = {
            ...rest,
            aliases: rest.aliases || this.getDefault('aliases', '[REDACTED]'),
            notes: composedNotes
        };

        // Remove undefined values so defaults/redactions remain
        const cleanedConfig = Object.fromEntries(
            Object.entries(configOverrides).filter(([, value]) => value !== undefined)
        );

        this.poster.updateConfig(cleanedConfig);

        // If the exhibition logo is not yet loaded, schedule a redraw once it is.
        const logoImg = this.poster.exhibitionLogoImg;
        if (logoImg && !logoImg.complete && !this.pendingLogoRender) {
            this.pendingLogoRender = true;
            logoImg.onload = () => {
                this.pendingLogoRender = false;
                if (this.lastBuildOptions) {
                    this.build({ ...this.lastBuildOptions, preserveLayout: true });
                }
            };
            logoImg.onerror = () => { this.pendingLogoRender = false; };
        }
        const ctx = targetCanvas.getContext('2d');
        const drawResult = this.poster.draw(ctx, targetCanvas.width, targetCanvas.height, imageSource);
        if (drawResult?.photoPlacement) {
            this.lastPhotoPlacement = drawResult.photoPlacement;
            this.basePhotoRegion = this.capturePhotoRegion(ctx, drawResult.photoPlacement);
        }

        return {
            canvas: targetCanvas,
            png: targetCanvas.toDataURL('image/png')
        };
    }

    refreshPhoto({ canvas, imageSource } = {}) {
        const targetCanvas = canvas || this.lastCanvas;
        if (!targetCanvas || !imageSource || !this.lastPhotoPlacement) return;

        const ctx = targetCanvas.getContext('2d');
        const { x, y, width, height, rotation } = this.lastPhotoPlacement;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        if (this.basePhotoRegion?.imageData) {
            ctx.putImageData(this.basePhotoRegion.imageData, this.basePhotoRegion.x, this.basePhotoRegion.y);
        }
        this.poster.drawPolaroidFrame(ctx, -width / 2, -height / 2, width, height, imageSource);
        ctx.restore();
    }

    capturePhotoRegion(ctx, placement) {
        if (!placement) return null;
        const { x, y, width, height } = placement;
        const padX = width * 0.35;
        const padY = height * 0.35;
        const sx = Math.max(0, Math.floor(x - width / 2 - padX));
        const sy = Math.max(0, Math.floor(y - height / 2 - padY));
        const sw = Math.min(ctx.canvas.width - sx, Math.ceil(width + padX * 2));
        const sh = Math.min(ctx.canvas.height - sy, Math.ceil(height + padY * 2));
        if (sw <= 0 || sh <= 0) return null;
        const imageData = ctx.getImageData(sx, sy, sw, sh);
        return { imageData, x: sx, y: sy };
    }

    getDefault(key, fallback = '') {
        return this.lang?.poster?.defaults?.[key] ?? fallback;
    }

    getText(path, fallback = '') {
        const parts = path.split('.');
        let node = this.lang?.poster;
        for (const p of parts) {
            if (!node || typeof node !== 'object') return fallback;
            node = node[p];
        }
        return node ?? fallback;
    }

    composeNotes({ profile, profileType, notes = [], locations = [], stats = {}, includeStats = true } = {}) {
        const lines = [];
        const profileLabel = profile?.label || profile?.type || profileType || null;
        const compose = this.lang?.poster?.compose || {};
        const subjectTemplate = compose.subjectProfile || 'SUBJECT PROFILE: {type}';
        const locationLabel = compose.knownLocations || 'KNOWN LOCA.';
        const statsTemplate = compose.stats || 'STATS O:{o}% I:{i}% C:{c}% S:{s}%';
        if (profileLabel) {
            lines.push(subjectTemplate.replace('{type}', profileLabel));
        }

        notes.forEach(note => lines.push(note));

        if (locations.length) {
            lines.push(locationLabel);
            locations.slice(0, 2).forEach(loc => lines.push(`- ${loc}`));
        }

        if (includeStats && stats && [stats.organized, stats.impulsive, stats.control, stats.social].some(v => v !== undefined)) {
            const o = Math.round(stats.organized ?? 0);
            const i = Math.round(stats.impulsive ?? 0);
            const c = Math.round(stats.control ?? 0);
            const s = Math.round(stats.social ?? 0);
            lines.push(
                statsTemplate
                    .replace('{o}', o)
                    .replace('{i}', i)
                    .replace('{c}', c)
                    .replace('{s}', s)
            );
        }

        // Keep reasonable length to fit layout
        return lines.slice(0, 8);
    }
}
