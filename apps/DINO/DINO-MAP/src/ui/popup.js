import { getResourcePath } from '../utils/fileLoader.js';
import { DATASET } from '../data/datasetConfig.js';

// Constants
const POPUP_Z_INDEX = 9999;

const CONNECTOR_LAYER_ID = 'popup-connector-layer';

function ensurePopupConnectorLayer() {
  let svg = document.getElementById(CONNECTOR_LAYER_ID);
  if (svg) return svg;

  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', CONNECTOR_LAYER_ID);
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'fixed';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = '100vw';
  svg.style.height = '100vh';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = String(POPUP_Z_INDEX - 1);
  svg.style.overflow = 'visible';
  document.body.appendChild(svg);
  return svg;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rectContainsPoint(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function centerPointOnRect(rect) {
  return {
    x: rect.left + (rect.right - rect.left) * 0.5,
    y: rect.top + (rect.bottom - rect.top) * 0.5
  };
}

function setConnectorPath(pathEl, anchorX, anchorY, popupRect) {
  if (!pathEl) return;
  if (!popupRect || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
    pathEl.setAttribute('d', '');
    return;
  }

  // Always attach the string to the popup center (x,y middle of the div).
  const target = centerPointOnRect(popupRect);

  const mx = (anchorX + target.x) * 0.5;
  const my = (anchorY + target.y) * 0.5;
  const dx = target.x - anchorX;
  const dy = target.y - anchorY;
  const len = Math.max(1, Math.hypot(dx, dy));

  // Slight sag so it reads like a "string".
  const bow = clamp(len * 0.10, 10, 36);
  const cx = mx;
  const cy = my + bow;

  pathEl.setAttribute('d', `M ${anchorX.toFixed(1)} ${anchorY.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${target.x.toFixed(1)} ${target.y.toFixed(1)}`);
}

function computeDockedPosition({ anchorX, anchorY, popupW, popupH, screenW, screenH, margin = 16, gap = 22 }) {
  const candidates = [
    // Right
    { left: anchorX + gap, top: anchorY - popupH * 0.2 },
    // Left
    { left: anchorX - popupW - gap, top: anchorY - popupH * 0.2 },
    // Bottom
    { left: anchorX - popupW * 0.5, top: anchorY + gap },
    // Top
    { left: anchorX - popupW * 0.5, top: anchorY - popupH - gap }
  ];

  function clampPos(pos) {
    return {
      left: clamp(pos.left, margin, Math.max(margin, screenW - popupW - margin)),
      top: clamp(pos.top, margin, Math.max(margin, screenH - popupH - margin))
    };
  }

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    const p = clampPos(c);
    const rect = { left: p.left, top: p.top, right: p.left + popupW, bottom: p.top + popupH };
    const contains = rectContainsPoint(rect, anchorX, anchorY);
    // Score: heavily penalize covering the anchor.
    const score = contains ? 1e9 : 0;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best || clampPos(candidates[0]);
}
const normalizeKey = (key) => String(key || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const buildNormalizedFieldMap = (obj) => {
  const map = new Map();
  if (!obj || typeof obj !== 'object') return map;
  Object.keys(obj).forEach((k) => {
    map.set(normalizeKey(k), obj[k]);
  });
  return map;
};

const readField = (obj, ...aliases) => {
  if (!obj || typeof obj !== 'object') return null;
  const normMap = buildNormalizedFieldMap(obj);
  for (const alias of aliases) {
    if (alias in obj) return obj[alias];
    const norm = normalizeKey(alias);
    if (normMap.has(norm)) return normMap.get(norm);
  }
  return null;
};

const toCleanText = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return s;
};

const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const normalizeForCompare = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

const createTagsHtml = (tags) => {
  const safeTags = (tags || [])
    .filter(t => t && t.value)
    .filter((t, idx, arr) => {
      const key = `${normalizeForCompare(t.label)}:${normalizeForCompare(t.value)}`;
      return arr.findIndex(x => `${normalizeForCompare(x.label)}:${normalizeForCompare(x.value)}` === key) === idx;
    });
  if (!safeTags.length) return '';
  const t = (key, vars) => (window.i18n && typeof window.i18n.t === 'function')
    ? window.i18n.t(key, vars)
    : key;
  return `<div class='wonder-tags' aria-label='${escapeHtml(t('popup.tagsLabel'))}'>
    ${safeTags.map(t => `<span class='wonder-tag'><span class='wonder-tag-label'>${escapeHtml(t.label)}:</span> ${escapeHtml(t.value)}</span>`).join('')}
  </div>`;
};

const resolveProfileImagePath = (w) => {
  const primaryImage = (w && w.primaryImage) || {};
  const candidate =
    readField(w, 'img', 'image', 'profileImage', 'photo') ||
    primaryImage.asset ||
    readField(w, 'Primary image', 'PrimaryImage');
  return candidate;
};

/**
 * Resolves the path for an asset.
 */
const resolveAssetPath = (maybePath) => {
  if (!maybePath) return null;
  if (/^https?:/i.test(maybePath) || maybePath.startsWith('data:')) {
    return maybePath;
  }
  return getResourcePath(maybePath);
};

/**
 * Generates HTML for a media frame (image).
 */
const createMediaHtml = (imgSrc, altText) => {
  // No placeholder: if the image is missing, remove the whole media frame.
  const safeAlt = escapeHtml(altText);
  return `
    <div class='wonder-media-frame' style="--media-src: url('${imgSrc}')">
      <img class='wonder-media-img' src='${imgSrc}' alt='${safeAlt}' onerror="this.onerror=null; const p=this.closest('.wonder-popup'); if (p) p.classList.add('wonder-popup--no-media'); const f=this.closest('.wonder-media-frame'); if (f) f.remove();" draggable="false" />
    </div>`;
};

/**
 * Generates HTML for a video frame.
 */
const createVideoHtml = (videoSrc, posterSrc) => {
  return `
    <div class='wonder-media-frame'>
      <video class='wonder-media-video' src='${videoSrc}' controls playsinline poster='${posterSrc}' preload='none'></video>
    </div>`;
};

/**
 * Generates HTML for the metadata list.
 */
const createMetaHtml = (entries) => {
  const safeEntries = (entries || []).filter(entry => entry && entry.value);
  if (!safeEntries.length) return '';
  return `<dl class='wonder-meta'>
      ${safeEntries.map(entry => `
        <div class='wonder-meta-item'>
          <dt>${entry.label}</dt>
          <dd>${entry.value}</dd>
        </div>
      `).join('')}
    </dl>`;
};

/**
 * Generates HTML for a page section.
 */
const createPageHtml = ({ index, title, tip, mediaHtml, bodyHtml, type = '' }) => {
  const isActive = index === 0;
  const extraClass = type ? `wonder-page--${type}` : '';
  const headerClass = !title ? 'wonder-quickfacts-header--placeholder' : '';
  const ariaHidden = !title ? 'true' : 'false'; // Header visibility
  
  return `
    <section class='wonder-page ${isActive ? 'wonder-page--active' : ''} ${extraClass}' data-page-index='${index}' aria-hidden='${!isActive}'>
      <header class='wonder-quickfacts-header ${headerClass}' aria-hidden='${ariaHidden}'>
        <div class='wonder-quickfacts-title'>${title || '&nbsp;'}</div>
        <p class='wonder-quickfacts-tip'>${tip || '&nbsp;'}</p>
      </header>
      ${mediaHtml}
      <div class='wonder-body ${type === 'video' ? 'wonder-body--video' : ''}' tabindex='-1'>
        ${bodyHtml}
      </div>
    </section>`;
};

/**
 * Main function to show the wonder details popup.
 */
export function showWonderPanel(w, clickX, clickY, opts = {}) {
  const t = (key, vars) => (window.i18n && typeof window.i18n.t === 'function')
    ? window.i18n.t(key, vars)
    : key;

  const langHint = (() => {
    // Best-effort language hint for fallbacks (in case i18n isn't ready yet).
    try {
      const v = window.i18n && typeof window.i18n.lang === 'string' ? window.i18n.lang : '';
      const s = String(v || '').trim();
      if (s) return s.toLowerCase();
    } catch { /* ignore */ }

    const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
    const defaultLang = String(meta('i18n-default-lang') || 'en').trim() || 'en';

    const lockedRaw = String(meta('i18n-lock-lang') || '').trim();
    if (lockedRaw) {
      const locked = (lockedRaw === '1' || lockedRaw.toLowerCase() === 'true') ? defaultLang : lockedRaw;
      if (locked) return String(locked).trim().toLowerCase();
    }

    try {
      const url = new URL(window.location.href);
      const fromQuery = url.searchParams.get('primaryLang') || url.searchParams.get('lang');
      if (fromQuery) return String(fromQuery).trim().toLowerCase();
    } catch { /* ignore */ }

    try {
      const fromStorage = window.localStorage.getItem('lang');
      if (fromStorage) return String(fromStorage).trim().toLowerCase();
    } catch { /* ignore */ }

    return defaultLang.toLowerCase();
  })();
  const SUPPORTED_LANGS = ['fr', 'en', 'es'];
  const normalizeLang = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const base = raw.split(/[-_]/)[0];
    return SUPPORTED_LANGS.includes(base) ? base : '';
  };

  const getCurrentLang = () => {
    const fromI18n = (() => {
      try {
        const v = window.i18n && typeof window.i18n.lang === 'string' ? window.i18n.lang : '';
        return normalizeLang(v);
      } catch {
        return '';
      }
    })();
    if (fromI18n) return fromI18n;

    const fromDom = (() => {
      try { return normalizeLang(document.documentElement.lang); } catch { return ''; }
    })();
    if (fromDom) return fromDom;

    const fromStorage = (() => {
      try { return normalizeLang(window.localStorage.getItem('lang')); } catch { return ''; }
    })();
    if (fromStorage) return fromStorage;

    return normalizeLang(langHint) || 'fr';
  };

  const getFallbacks = () => {
    const lang = getCurrentLang();
    const pick = (fr, en, es) => (lang === 'fr') ? fr : ((lang === 'es') ? es : en);
    return {
      close: pick('Fermer', 'Close', 'Cerrar'),
      closeCard: pick('Fermer la fiche', 'Close the card', 'Cerrar la ficha'),
      detailsToBeConfirmed: pick('Détails à confirmer.', 'Details to be confirmed.', 'Detalles por confirmar.'),
      tagsLabel: pick('Détails', 'Details', 'Detalles'),
      imageAlt: pick('Image', 'Image', 'Imagen'),
      profileDetails: pick('Détails', 'Details', 'Detalles'),
      quickFacts: pick('Infos clés', 'Quick facts', 'Datos clave'),
      keyTraits: pick('Traits clés', 'Key traits', 'Rasgos clave'),
      overview: pick('Aperçu', 'Overview', 'Resumen'),
      behavior: pick('Comportement', 'Behavior', 'Comportamiento'),
    };
  };
  const FALLBACKS = getFallbacks();

  const safeT = (key, vars, fallback) => {
    const out = t(key, vars);
    if (!out || out === key) return fallback != null ? fallback : key;
    return out;
  };

  const maybeResolveI18nPointer = (value) => {
    const s = toCleanText(value);
    if (!s) return '';
    // Treat values like "beninmask.masters.desc" as i18n pointers if a translation exists.
    // This enables migrating datasets away from *Fr/*En fields without needing prefixes.
    const looksLikeKey = /^[a-z0-9]+(?:\.[a-z0-9]+)+$/i.test(s);
    if (!looksLikeKey) return s;
    const out = t(s);
    return (out && out !== s) ? out : s;
  };

  const readLocalizedField = (obj, key) => {
    if (!obj || typeof obj !== 'object') return null;
    const baseKey = String(key || '').trim();
    if (!baseKey) return null;
    // If the caller already asks for a specific language, respect it.
    if (/(?:Fr|En|Es)$/.test(baseKey)) return maybeResolveI18nPointer(readField(obj, baseKey));

    const lang = getCurrentLang();
    const suffixByLang = { fr: 'Fr', en: 'En', es: 'Es' };
    const first = suffixByLang[lang] || 'Fr';
    const fallbacks = ['Fr', 'En'].filter(suffix => suffix !== first);
    return maybeResolveI18nPointer(readField(
      obj,
      `${baseKey}${first}`,
      ...fallbacks.map(suffix => `${baseKey}${suffix}`),
      baseKey
    ));
  };

  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  
  // Calculate dimensions
  const popupW = Math.round(Math.min(screenH * 0.34, screenW * 0.34));
  const popupH = Math.round(screenH * 0.72);
  
  const anchorWonderId = (opts && opts.anchorWonderId != null)
    ? String(opts.anchorWonderId)
    : ((w && w.id != null) ? String(w.id) : null);

  function escapeAttrForSelector(value) {
    const s = String(value ?? '');
    // Prefer standards-based escape when available.
    try {
      if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(s);
    } catch {
      // ignore
    }
    // Fallback: id values here are numeric, so this is just extra safety.
    return s.replace(/\\/g, '\\\\').replace(/\"/g, '\\"');
  }

  function resolveAnchorPointFallback() {
    // Try to anchor to the actual on-screen marker (cross) so it stays attached
    // when the map/camera moves.
    if (anchorWonderId) {
      const widSel = escapeAttrForSelector(anchorWonderId);
      const markerEl = document.querySelector(`.wonder-bubble[data-wonder-id=\"${widSel}\"]`);
      if (markerEl && markerEl.getBoundingClientRect) {
        const r = markerEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: true };
        }
      }
    }
    return { x: clickX, y: clickY, ok: false };
  }

  const initialAnchor = resolveAnchorPointFallback();

  // Calculate initial position: dock beside anchor (not on top of the point).
  const initialDock = computeDockedPosition({
    anchorX: initialAnchor.x,
    anchorY: initialAnchor.y,
    popupW,
    popupH,
    screenW,
    screenH
  });
  let left = initialDock.left;
  let top = initialDock.top;
  
  const displayName = toCleanText(readField(w, 'Name', 'name')) || t('popup.profile');

  // Unique ID for the popup
  const safeName = (displayName || 'wonder').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
  const popupId = 'wonder-popup-' + safeName + '-' + left;
  
  // Remove existing popups that are close
  function removeConnectorForPopupId(id) {
    if (!id) return;
    const layer = document.getElementById(CONNECTOR_LAYER_ID);
    if (!layer) return;
    const sel = String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    layer.querySelectorAll(`path[data-popup-id="${sel}"]`).forEach((p) => p.remove());
  }

  document.querySelectorAll('.wonder-popup.window-popup').forEach(p => {
    const px = parseInt(p.style.left || '0', 10);
    if (Math.abs(px - left) < popupW * 0.75) {
      p.style.display = 'none';
      removeConnectorForPopupId(p.id);
      p.remove();
    }
  });
  
  // Create or get popup element
  let popup = document.getElementById(popupId);
  if (!popup) {
    popup = document.createElement('div');
    popup.id = popupId;
    popup.className = 'wonder-popup window-popup';
    // Accessibility
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'false');
    popup.setAttribute('aria-label', displayName || t('popup.profileDetails'));
    document.body.appendChild(popup);
  }

  popup.classList.remove('is-closing');
  popup.classList.remove('is-open');
  
  // Apply styles
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.position = 'fixed';
  popup.style.zIndex = POPUP_Z_INDEX;
  popup.style.userSelect = 'none';

  if (anchorWonderId) {
    try { popup.dataset.anchorWonderId = anchorWonderId; } catch { /* ignore */ }
  }

  const isLegacyPlaceholderImage = (src) => {
    if (!src || typeof src !== 'string') return false;
    const s = src.toLowerCase();
    return (
      s.includes('ressource/background.webp') ||
      s.includes('ressource/images/placeholders/background.webp') ||
      s.includes('ressource/images/placeholders/default.webp')
    );
  };

  // --- Prepare Content ---

  const preferredImgPath = resolveProfileImagePath(w);
  const resolvedPreferred = resolveAssetPath(preferredImgPath);
  const mainImgSrc = (resolvedPreferred && !isLegacyPlaceholderImage(resolvedPreferred) && !isLegacyPlaceholderImage(preferredImgPath))
    ? resolvedPreferred
    : null;
  popup.classList.toggle('wonder-popup--no-media', !mainImgSrc);

  const nicknameRaw = toCleanText(maybeResolveI18nPointer(readField(w, 'scientificName', 'artist', 'Nickname / AKA', 'Nickname', 'AKA', 'aka', 'nickname')));
  const family = (nicknameRaw && normalizeForCompare(nicknameRaw) !== normalizeForCompare(displayName)) ? nicknameRaw : '';

  // Build tags dynamically from DATASET config
  const popupFields = DATASET.popupFields || {};
  const tagDefs = popupFields.tags || [];
  const extraDefs = popupFields.extra || [];
  const resolveFieldLabel = (def) => {
    if (!def) return '';
    const key = def.labelKey || def.i18nKey;
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) return translated;
    }
    return def.label || def.key || '';
  };
  const buildBodyInnerHtml = () => {
    const fb = getFallbacks();

    const defsByKey = new Map();
    [...tagDefs, ...extraDefs].forEach((def) => {
      if (!def || !def.key) return;
      defsByKey.set(String(def.key), def);
    });

    const statsOrder = [
      'habitat',
      'diet',
      'weight',
      'length',
      'height',
      'speed',
      'specimensFound',
      'meaning',
    ];

    const statsRows = statsOrder
      .map((key) => {
        const def = defsByKey.get(key) || { key, label: key };
        return {
          key,
          label: resolveFieldLabel(def) || key,
          value: toCleanText(readLocalizedField(w, key)),
          layout: 'full'
        };
      })
      .filter((row) => !!row.value);

    // Layout rules: only make these pairs half-width when both exist.
    const byKey = new Map(statsRows.map((r) => [String(r.key), r]));
    const setHalfIfBoth = (a, b) => {
      const ra = byKey.get(a);
      const rb = byKey.get(b);
      if (ra && rb) {
        ra.layout = 'half';
        rb.layout = 'half';
      }
    };
    setHalfIfBoth('weight', 'length');
    setHalfIfBoth('height', 'speed');

    const statsHtml = statsRows.length
      ? `<div class='wonder-quickfacts-bubbles'>
          ${statsRows.map((row) => `
            <span class='wonder-quickfact-bubble ${row.layout === 'half' ? 'wonder-quickfact-bubble--half' : 'wonder-quickfact-bubble--full'}' data-qf-key='${escapeHtml(row.key)}'>
              <span class='wonder-quickfact-label'>${escapeHtml(row.label)}</span>
              <span class='wonder-quickfact-sep'>:</span>
              <span class='wonder-quickfact-value'>${escapeHtml(row.value)}</span>
            </span>
          `).join('')}
        </div>`
      : '';

    const normalizeTag = (value) => String(value || '').trim().replace(/\s+/g, ' ');

    const splitTags = (value) => {
      const raw = normalizeTag(value);
      if (!raw) return [];
      const parts = raw
        .replace(/\r/g, '\n')
        .split(/\n|•|;|\|/g)
        .map((s) => normalizeTag(s))
        .filter(Boolean);
      return parts.length ? parts : [raw];
    };

    // Key traits removed (was derived from attributes/meaning).
    const highlightsHtml = '';

    const notesOrSummary = (
      toCleanText(readLocalizedField(w, 'Notes')) ||
      toCleanText(readField(w, 'Summary', 'summary', 'notes'))
    );

    const fallbackDescriptionCandidates = [
      readField(w, 'description', 'Description'),
      readField(w, 'overview', 'Overview'),
      readField(w, 'history', 'History')
    ]
      .map(text => typeof text === 'string' ? text.trim() : '')
      .filter(text => !!text);

    const fullDescription = notesOrSummary || fallbackDescriptionCandidates[0] || '';
    const descriptionText = String(fullDescription || '').trim();
    const descriptionHtml = descriptionText
      ? `<div class='wonder-description-full'>
          <p class='wonder-description-text'>${escapeHtml(descriptionText)}</p>
        </div>`
      : '';

    const hasAny = !!(statsHtml || descriptionHtml);
    if (!hasAny) {
      return `<p class='wonder-overview wonder-overview--empty'>${escapeHtml(safeT('popup.detailsToBeConfirmed', null, fb.detailsToBeConfirmed))}</p>`;
    }

    return `
      <div class='wonder-info-card'>
        <div class='wonder-info-grid wonder-info-grid--single'>
          <div class='wonder-info-col wonder-info-col--stats'>
            <div class='wonder-block-title'>${escapeHtml(safeT('popup.sections.quickFacts', null, fb.quickFacts))}</div>
            ${statsHtml}
          </div>
          ${descriptionHtml}
        </div>
      </div>
    `;
  };

  // 3. Video Page - REMOVED
  /*
  if (w.video) {
    const videoPageIndex = pages.length;
    const videoHtml = createVideoHtml(w.video, mainImgSrc);
    const videoBodyHtml = `<p class='wonder-overview wonder-overview--video'>Press play to discover the animation.</p>`;
    
    pages.push(createPageHtml({
      index: videoPageIndex,
      title: 'Video',
      tip: String(videoPageIndex).padStart(2, '0'),
      mediaHtml: videoHtml,
      bodyHtml: videoBodyHtml,
      type: 'video'
    }));
  }
  */

  // --- Shell ---
  // If there is no image, render a compact text-only card.
  const mediaHtml = mainImgSrc ? createMediaHtml(mainImgSrc, displayName || t('popup.imageAlt')) : '';

  popup.innerHTML = `
    <div class='wonder-content'>
      <div class='wonder-shell'>
        <div class='wonder-pages' data-page-count='1'>
          <section class='wonder-page wonder-page--active' data-page-index='0' aria-hidden='false'>
            <div class='wonder-hero ${mainImgSrc ? '' : 'wonder-hero--no-media'}'>
              ${mediaHtml || `<div class='wonder-hero-fallback'></div>`}
              <div class='wonder-hero-overlay' aria-hidden='true'>
                <div class='wonder-hero-title'>${escapeHtml(displayName || '')}</div>
                ${family ? `<div class='wonder-hero-subtitle'><em>${escapeHtml(family)}</em></div>` : ''}
              </div>
            </div>
            <div class='wonder-body' tabindex='-1'>
              ${buildBodyInnerHtml()}
            </div>
          </section>
        </div>
      </div>
      <div class='wonder-footer'>
        <button class='wonder-close-btn' type='button' aria-label='${escapeHtml(safeT('popup.closeCard', null, FALLBACKS.closeCard))}'>
          ${escapeHtml(safeT('popup.close', null, FALLBACKS.close))}
        </button>
      </div>
    </div>
  `;

  const applyI18nToPopup = () => {
    if (!popup || !popup.isConnected) return;
    const fb = getFallbacks();

    try {
      popup.setAttribute('aria-label', displayName || safeT('popup.profileDetails', null, fb.profileDetails));
    } catch { /* ignore */ }

    try {
      const btn = popup.querySelector('.wonder-close-btn');
      if (btn) {
        btn.textContent = safeT('popup.close', null, fb.close);
        btn.setAttribute('aria-label', safeT('popup.closeCard', null, fb.closeCard));
      }
    } catch { /* ignore */ }

    try {
      const imgEl = popup.querySelector('.wonder-media-img');
      if (imgEl) imgEl.setAttribute('alt', displayName || safeT('popup.imageAlt', null, fb.imageAlt));
    } catch { /* ignore */ }

    try {
      const bodyEl = popup.querySelector('.wonder-body');
      if (bodyEl) bodyEl.innerHTML = buildBodyInnerHtml();
    } catch { /* ignore */ }
  };

  // Initial pass (in case i18n is already ready), and refresh once i18n finishes loading.
  applyI18nToPopup();
  const onI18nChange = () => applyI18nToPopup();
  try {
    window.addEventListener('i18n:change', onI18nChange);
    if (window.i18n && window.i18n.ready && typeof window.i18n.ready.then === 'function') {
      window.i18n.ready.then(() => applyI18nToPopup()).catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }

  // --- Interaction Logic ---
  const pageSections = Array.from(popup.querySelectorAll('.wonder-page'));

  // Focus first scrollable element
  const firstScrollable = popup.querySelector('.wonder-page--active [tabindex="0"]');
  if (firstScrollable) firstScrollable.focus();

  // --- Dragging & Positioning Logic ---
  function clampWithinBounds() {
    let currentLeft = parseFloat(popup.style.left) || 0;
    let currentTop = parseFloat(popup.style.top) || 0;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;

    currentLeft = clamp(currentLeft, 16, Math.max(16, screenW - width - 16));
    currentTop = clamp(currentTop, 16, Math.max(16, screenH - height - 16));

    popup.style.left = currentLeft + 'px';
    popup.style.top = currentTop + 'px';
    return { left: currentLeft, top: currentTop, width, height };
  }

  // Initial clamp
  clampWithinBounds();

  // --- Anchor + Connector ---
  const followAnchor = !!(opts && opts.followAnchor != null ? opts.followAnchor : anchorWonderId);
  let autoFollow = !!followAnchor;
  let userMoved = false;

  const connectorSvg = ensurePopupConnectorLayer();
  const connectorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  connectorPath.classList.add('popup-connector-path');
  try { connectorPath.dataset.popupId = popupId; } catch { /* ignore */ }
  connectorSvg.appendChild(connectorPath);

  function dockToAnchor(anchorX, anchorY) {
    const rect = popup.getBoundingClientRect();
    const p = computeDockedPosition({
      anchorX,
      anchorY,
      popupW: rect.width || popupW,
      popupH: rect.height || popupH,
      screenW,
      screenH
    });
    popup.style.left = `${p.left}px`;
    popup.style.top = `${p.top}px`;
    clampWithinBounds();
  }

  function tickAnchorAndConnector() {
    if (!popup || !popup.isConnected) {
      if (connectorPath && connectorPath.parentNode) connectorPath.parentNode.removeChild(connectorPath);
      return;
    }

    const a = resolveAnchorPointFallback();
    if (autoFollow && !userMoved && a.ok) {
      dockToAnchor(a.x, a.y);
    }

    const popupRect = popup.getBoundingClientRect();
    // Only draw the string when the marker is actually on the map.
    if (a.ok) setConnectorPath(connectorPath, a.x, a.y, popupRect);
    else setConnectorPath(connectorPath, NaN, NaN, null);
    requestAnimationFrame(tickAnchorAndConnector);
  }
  requestAnimationFrame(tickAnchorAndConnector);

  // Play open animation after the element is in the DOM and positioned.
  requestAnimationFrame(() => {
    popup.classList.add('is-open');
  });

  const closeBtn = popup.querySelector('.wonder-close-btn');
  
  function teardownNow() {
    document.onpointermove = null;
    document.onpointerup = null;
    popup.style.display = 'none';
    if (popup.parentNode) popup.parentNode.removeChild(popup);
    document.removeEventListener('keydown', onKeyDown);
    try { window.removeEventListener('i18n:change', onI18nChange); } catch { /* ignore */ }
    if (connectorPath && connectorPath.parentNode) connectorPath.parentNode.removeChild(connectorPath);
  }

  function teardown() {
    popup.classList.add('is-closing');
    popup.classList.remove('is-open');
    // Remove after the CSS transition.
    window.setTimeout(teardownNow, 220);
  }

  closeBtn.onclick = teardown;
  closeBtn.onkeyup = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      teardown();
    }
  };

  function onKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      teardown();
      return;
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // Dragging: allow dragging from anywhere in the popup.
  // For touch, keep vertical scroll inside the scrollable page when the gesture is mostly vertical.
  let dragging = false;
  let pendingDrag = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;
  let dragPointerId = null;
  let dragPointerType = '';
  let startedInScrollable = false;
  const DRAG_THRESHOLD_PX = 6;

  function cleanupDragHandlers() {
    pendingDrag = false;
    dragging = false;
    document.onpointermove = null;
    document.onpointerup = null;
    try {
      if (dragPointerId != null && popup && typeof popup.releasePointerCapture === 'function') {
        popup.releasePointerCapture(dragPointerId);
      }
    } catch { /* ignore */ }
    dragPointerId = null;
    popup.style.cursor = 'grab';
  }

  popup.style.cursor = 'grab';
  popup.onpointerdown = function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.wonder-close-btn')) return;
    if (e.target.closest('.wonder-page-nav')) return;

    popup.style.zIndex = String(POPUP_Z_INDEX + 100 + (Date.now() % 1000));
    userMoved = true;
    autoFollow = false;

    pendingDrag = true;
    dragging = false;
    dragPointerId = e.pointerId;
    dragPointerType = e.pointerType || '';
    startedInScrollable = !!e.target.closest('.wonder-page--active');
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartLeft = popup.offsetLeft;
    dragStartTop = popup.offsetTop;
    popup.style.cursor = 'grabbing';

    try {
      if (dragPointerId != null && popup && typeof popup.setPointerCapture === 'function') {
        popup.setPointerCapture(dragPointerId);
      }
    } catch { /* ignore */ }

    document.onpointermove = function (ev) {
      if (!pendingDrag) return;
      const dx = ev.clientX - dragStartX;
      const dy = ev.clientY - dragStartY;
      const dist = Math.hypot(dx, dy);

      if (!dragging) {
        if (dist < DRAG_THRESHOLD_PX) return;
        // Touch heuristic: if starting in scrollable area and the gesture is mostly vertical,
        // assume the user is scrolling rather than dragging the card.
        if (dragPointerType === 'touch' && startedInScrollable && Math.abs(dy) > Math.abs(dx) * 1.2) {
          cleanupDragHandlers();
          return;
        }
        dragging = true;
      }

      let nx = dragStartLeft + dx;
      let ny = dragStartTop + dy;
      nx = Math.max(16, Math.min(nx, screenW - popup.offsetWidth - 16));
      ny = Math.max(16, Math.min(ny, screenH - popup.offsetHeight - 16));
      popup.style.left = nx + 'px';
      popup.style.top = ny + 'px';
      clampWithinBounds();
      try {
        const a = resolveAnchorPointFallback();
        setConnectorPath(connectorPath, a.x, a.y, popup.getBoundingClientRect());
      } catch { /* ignore */ }
    };

    document.onpointerup = function () {
      cleanupDragHandlers();
      clampWithinBounds();
      try {
        const a = resolveAnchorPointFallback();
        setConnectorPath(connectorPath, a.x, a.y, popup.getBoundingClientRect());
      } catch { /* ignore */ }
    };
  };
}
