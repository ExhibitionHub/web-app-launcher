import { getResourcePath } from '../utils/fileLoader.js';
import { DATASET } from '../data/datasetConfig.js';

// Constants
const POPUP_Z_INDEX = 9999;


const CONNECTOR_LAYER_ID = 'popup-connector-layer';

function removePopupBackIfAny() {
  const back = document.getElementById('popup-back');
  if (back && back.parentNode) back.parentNode.removeChild(back);
}

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

const getUiLang = () => {
  try {
    const lang = (window.i18n && typeof window.i18n.lang === 'string') ? window.i18n.lang : '';
    return (lang || '').trim() || 'en';
  } catch {
    return 'en';
  }
};

const translateMaybeI18nKey = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return value;
  try {
    const t = (window.i18n && typeof window.i18n.t === 'function')
      ? window.i18n.t
      : null;
    if (!t) return value;
    const translated = t(raw);
    if (typeof translated === 'string' && translated && translated !== raw) return translated;
  } catch {
    // ignore
  }
  return value;
};

const readLocalizedField = (obj, ...aliases) => {
  const lang = String(getUiLang() || '').toLowerCase();
  if (lang.startsWith('fr')) {
    // Special case: many masters entries store translated long text in
    // Description_fr while Notes contains the latest English version.
    // Prefer Notes_fr first (keeps FR emphasis), then Description_fr fallback.
    const asksForNotes = aliases.some((a) => String(a || '').toLowerCase() === 'notes');
    if (asksForNotes) {
      const frNotes = readField(obj, 'Notes_fr', 'notes_fr');
      if (frNotes !== null && frNotes !== undefined && String(frNotes).trim() !== '') return frNotes;

      const frDesc = readField(obj, 'Description_fr', 'description_fr');
      if (frDesc !== null && frDesc !== undefined && String(frDesc).trim() !== '') return frDesc;
    }

    const frAliases = [];
    for (const alias of aliases) {
      if (!alias) continue;
      const a = String(alias);
      // Prefer explicit French sibling fields when present (e.g. Name_fr, Notes_fr).
      if (/^[a-z0-9_]+$/i.test(a)) frAliases.push(`${a}_fr`);
    }
    const frValue = readField(obj, ...frAliases);
    if (frValue !== null && frValue !== undefined && String(frValue).trim() !== '') return frValue;
  }
  return readField(obj, ...aliases);
};

const readFieldI18n = (obj, ...aliases) => translateMaybeI18nKey(readLocalizedField(obj, ...aliases));

const toCleanText = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return s;
};

const toSpeciesSlug = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatRichTextToHtml = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Support markdown bold (**text** / __text__) and existing HTML bold tags.
  // Use neutral markers to avoid collisions with markdown underscores.
  const withBoldTokens = raw
    .replace(/<\s*(strong|b)\s*>/gi, '[BOLD_OPEN]')
    .replace(/<\s*\/\s*(strong|b)\s*>/gi, '[BOLD_CLOSE]')
    .replace(/\*\*(.+?)\*\*/g, '[BOLD_OPEN]$1[BOLD_CLOSE]')
    .replace(/__(.+?)__/g, '[BOLD_OPEN]$1[BOLD_CLOSE]');

  const escaped = escapeHtml(withBoldTokens)
    .replace(/\[BOLD_OPEN\]/g, '<strong>')
    .replace(/\[BOLD_CLOSE\]/g, '</strong>');

  let paragraphs = escaped
    .split(/\n\s*\n/g)
    .map(p => p.trim())
    .filter(Boolean);

  // Some FR texts are authored with single newlines between paragraphs.
  const isFr = String(getUiLang() || '').toLowerCase().startsWith('fr');
  if (isFr && paragraphs.length <= 1 && /\n/.test(escaped)) {
    paragraphs = escaped
      .split(/\n/g)
      .map(p => p.trim())
      .filter(Boolean);
  }

  // Fallback emphasis for FR masters when source text has no explicit bold markup.
  // This keeps visual hierarchy without altering underlying data.
  if (isFr && DATASET && DATASET.key === 'masters') {
    const hasExplicitBold = paragraphs.some((p) => /<strong>.*?<\/strong>/i.test(p));
    if (!hasExplicitBold) {
      paragraphs = paragraphs.map((p) => {
        const m = p.match(/^(.+?[\.!?])(\s|$)/);
        if (!m || !m[1]) return p;
        const lead = m[1];
        return p.replace(lead, `<strong>${lead}</strong>`);
      });
    }
  }

  if (!paragraphs.length) return '';
  return paragraphs.map(p => `<p class='wonder-description-text'>${p.replace(/\n/g, '<br />')}</p>`).join('');
};

const buildQrDataUrl = (text) => {
  const payload = String(text || '').trim();
  if (!payload) return '';
  try {
    const qrFactory = (typeof window !== 'undefined' && typeof window.qrcode === 'function') ? window.qrcode : null;
    if (!qrFactory) return '';

    const qr = qrFactory(0, 'M');
    qr.addData(payload);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const margin = 2;
    const cellSize = 8;
    const size = (moduleCount + margin * 2) * cellSize;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';

    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (!qr.isDark(r, c)) continue;
        const x = (c + margin) * cellSize;
        const y = (r + margin) * cellSize;
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }

    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
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
      <img class='wonder-media-img' src='${imgSrc}' alt='${safeAlt}' onerror="this.onerror=null; const p=this.closest('.wonder-popup'); if (p) p.classList.add('wonder-popup--no-media'); const h=this.closest('.wonder-hero'); if (h) { h.classList.add('wonder-hero--no-media'); if (!h.querySelector('.wonder-hero-fallback')) { const d=document.createElement('div'); d.className='wonder-hero-fallback'; d.setAttribute('aria-hidden','true'); h.insertBefore(d, h.firstChild); } } const f=this.closest('.wonder-media-frame'); if (f) f.remove();" draggable="false" />
    </div>`;
};

const createComparisonMediaHtml = (aotbSrc, originalSrc, altText, t) => {
  const safeAlt = escapeHtml(altText);
  const leftLabel = escapeHtml(t('popup.compare.original'));
  const rightLabel = escapeHtml(t('popup.compare.aotb'));
  return `
    <div class='wonder-media-compare'>
      <div class='wonder-media-compare__pane'>
        <div class='wonder-media-compare__label'>${leftLabel}</div>
        <img class='wonder-media-compare__img' src='${originalSrc}' alt='${safeAlt}' draggable='false' />
      </div>
      <div class='wonder-media-compare__pane'>
        <div class='wonder-media-compare__label'>${rightLabel}</div>
        <img class='wonder-media-compare__img' src='${aotbSrc}' alt='${safeAlt}' draggable='false' />
      </div>
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
  // No global backdrop when opening popups.
  removePopupBackIfAny();
  const t = (key, vars) => (window.i18n && typeof window.i18n.t === 'function')
    ? window.i18n.t(key, vars)
    : key;

  const getViewportSize = () => ({
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0
  });
  const { width: screenW, height: screenH } = getViewportSize();
  
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
  
  const getDisplayName = () => toCleanText(readFieldI18n(w, 'Name', 'name')) || t('popup.profile');
  const displayName = getDisplayName();

  // Unique ID for the popup
  const safeName = (displayName || 'wonder').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
  const popupId = 'wonder-popup-' + safeName + '-' + left;
  
  // Keep multiple popups open (expo workflow: compare and move several cards).
  function removeConnectorForPopupId(id) {
    if (!id) return;
    const layer = document.getElementById(CONNECTOR_LAYER_ID);
    if (!layer) return;
    const sel = String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    layer.querySelectorAll(`path[data-popup-id="${sel}"]`).forEach((p) => p.remove());
  }
  
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
  popup.classList.remove('wonder-popup--dataset-perniciem', 'wonder-popup--dataset-masters', 'wonder-popup--dataset-postmasters', 'wonder-popup--dataset-all');
  if (DATASET && DATASET.key) popup.classList.add(`wonder-popup--dataset-${String(DATASET.key)}`);
  
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

  const originalImgPath = readField(w, 'originalImage', 'OriginalImage', 'referenceImage');
  const aotbImgPath = readField(w, 'aotbImage', 'AotbImage');
  const comparisonOriginalSrc = resolveAssetPath(originalImgPath) || mainImgSrc;
  const comparisonAotbSrc = resolveAssetPath(aotbImgPath) || mainImgSrc;
  const canCompareMasters = DATASET && DATASET.key === 'masters' && comparisonAotbSrc && comparisonOriginalSrc;
  popup.classList.toggle('wonder-popup--no-media', !mainImgSrc);

  const computeNickname = (nameForCompare) => {
    const nicknameRaw = toCleanText(readFieldI18n(w, 'scientificName', 'artist', 'Nickname / AKA', 'Nickname', 'AKA', 'aka', 'nickname'));
    return (nicknameRaw && normalizeForCompare(nicknameRaw) !== normalizeForCompare(nameForCompare)) ? nicknameRaw : '';
  };

  const nickname = computeNickname(displayName);
  const isPerniciem = DATASET && DATASET.key === 'perniciem';
  const speciesSlugSource = toCleanText(readField(w, 'Name', 'name', 'key')) || displayName;
  const speciesSlug = isPerniciem ? toSpeciesSlug(speciesSlugSource) : '';
  const adoptBaseUrl = (DATASET && typeof DATASET.adoptPageBaseUrl === 'string' && DATASET.adoptPageBaseUrl.trim())
    ? DATASET.adoptPageBaseUrl.trim()
    : `${window.location.origin}${window.location.pathname.replace(/[^/]+$/, '')}adopt.html`;
  const buildAdoptUrl = () => {
    const uiLang = String(getUiLang() || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
    if (!(isPerniciem && speciesSlug)) return '';
    return `${adoptBaseUrl}${adoptBaseUrl.includes('?') ? '&' : '?'}species=${encodeURIComponent(speciesSlug)}&lang=${encodeURIComponent(uiLang)}`;
  };
  const adoptUrl = buildAdoptUrl();

  // Build tags dynamically from DATASET config
  const popupFields = DATASET.popupFields || {};
  const tagDefs = popupFields.tags || [];
  const extraDefs = popupFields.extra || [];

  function resolveTagLabel(def, fallbackKey = '') {
    const key = fallbackKey || (def && def.key != null ? String(def.key) : '');
    if (key) {
      const i18nKey = `popup.meta.${key}`;
      const translated = t(i18nKey);
      if (translated && translated !== i18nKey) return translated;
    }

    const raw = def && def.label != null ? String(def.label) : '';
    if (raw) {
      if (raw.includes('.')) {
        const translated = t(raw);
        if (translated && translated !== raw) return translated;
      }
      return raw;
    }

    return key;
  }
  const buildBodyParts = () => {
    const tagEntries = tagDefs.map(def => {
      const key = def && def.key != null ? String(def.key) : '';
      return {
        key,
        label: resolveTagLabel(def, key),
        value: toCleanText(key ? readFieldI18n(w, key) : '')
      };
    });

    const extraEntries = extraDefs.map(def => {
      const key = def && def.key != null ? String(def.key) : '';
      return {
        key,
        label: resolveTagLabel(def, key),
        value: toCleanText(key ? readFieldI18n(w, key) : '')
      };
    });

    const notesOrSummary = toCleanText(readFieldI18n(w, 'Notes', 'Summary', 'summary', 'notes'));

    const fallbackDescriptionCandidates = [
      readFieldI18n(w, 'description', 'Description'),
      readFieldI18n(w, 'overview', 'Overview'),
      readFieldI18n(w, 'history', 'History')
    ]
      .map(text => typeof text === 'string' ? text.trim() : '')
      .filter(text => !!text);

    const descriptionText = notesOrSummary || fallbackDescriptionCandidates[0] || '';
    const descriptionHtml = formatRichTextToHtml(descriptionText);

    const allEntries = [...tagEntries, ...extraEntries]
      .filter(e => e && e.value)
      .filter((e, idx, arr) => {
        const key = `${normalizeForCompare(e.label)}:${normalizeForCompare(e.value)}`;
        return arr.findIndex(x => `${normalizeForCompare(x.label)}:${normalizeForCompare(x.value)}` === key) === idx;
      });

    const guessBubbleSize = (key) => {
      const k = normalizeKey(key);

      // Keep sizing stable by key only (not by value length),
      // so the same key always uses the same layout across cards.
      const halfishKeys = new Set([
        'cat', 'habitat',
        'status', 'conservationstatus',
        'population', 'declinerate',
        'weight', 'length', 'height', 'speed',
        'bricks', 'dimensions', 'dimensionscm',
        'labelnumber', 'date'
      ]);
      if (halfishKeys.has(k)) return 'half';
      return 'full';
    };

    const quickFactsHtml = (() => {
      if (!allEntries.length) return '';

      const sized = allEntries.map((entry) => {
        const rawKey = (entry && entry.key != null) ? String(entry.key) : String(entry.label || '');
        const size = guessBubbleSize(rawKey);
        return {
          key: rawKey,
          label: entry.label,
          value: entry.value,
          size
        };
      });

      // Group half bubbles together (pairs). If a half bubble is left alone,
      // promote it to full so layout stays tidy.
      const output = [];
      let halfBuffer = null;

      for (const item of sized) {
        if (item.size === 'half') {
          if (!halfBuffer) {
            halfBuffer = item;
          } else {
            output.push(halfBuffer);
            output.push(item);
            halfBuffer = null;
          }
          continue;
        }

        if (halfBuffer) {
          output.push({ ...halfBuffer, size: 'full' });
          halfBuffer = null;
        }
        output.push(item);
      }

      if (halfBuffer) {
        output.push({ ...halfBuffer, size: 'full' });
      }

      return output.map((item) => {
        const sizeClass = item.size === 'half' ? 'wonder-quickfact-bubble--half' : 'wonder-quickfact-bubble--full';
        return `
          <span class='wonder-quickfact-bubble ${sizeClass}' data-qf-key='${escapeHtml(item.key)}'>
            <span class='wonder-quickfact-label'>${escapeHtml(item.label)}</span>
            <span class='wonder-quickfact-sep'>:</span>
            <span class='wonder-quickfact-value'>${escapeHtml(item.value)}</span>
          </span>`;
      }).join('');
    })();

    const bodyFallbackHtml = (!quickFactsHtml && !descriptionHtml)
      ? `<p class='wonder-description-text wonder-description-text--empty'>${escapeHtml(t('popup.detailsToBeConfirmed'))}</p>`
      : '';

    return { quickFactsHtml, descriptionHtml, bodyFallbackHtml };
  };

  const bodyParts = buildBodyParts();

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
  const mediaHtml = mainImgSrc
    ? (canCompareMasters
      ? createComparisonMediaHtml(comparisonAotbSrc, comparisonOriginalSrc, displayName || t('popup.imageAlt'), t)
      : createMediaHtml(mainImgSrc, displayName || t('popup.imageAlt')))
    : '';
  const heroClass = mainImgSrc ? 'wonder-hero' : 'wonder-hero wonder-hero--no-media';
  const heroMedia = mainImgSrc ? mediaHtml : `<div class='wonder-hero-fallback' aria-hidden='true'></div>`;

  const keyInfosLabel = (() => {
    const k = 'popup.keyInfos';
    const translated = t(k);
    return (translated && translated !== k) ? translated : 'Infos clés';
  })();

  popup.innerHTML = `
    <div class='wonder-content'>
      <div class='wonder-shell'>
        <div class='wonder-pages' data-page-count='1'>
          <section class='wonder-page wonder-page--active' data-page-index='0' aria-hidden='false'>
            <div class='${heroClass}'>
              ${heroMedia}
              <div class='wonder-hero-overlay' aria-hidden='true'>
                <div class='wonder-hero-title'>${escapeHtml(displayName || '')}</div>
                <div class='wonder-hero-subtitle' ${nickname ? '' : 'hidden'}><em>${escapeHtml(nickname)}</em></div>
              </div>
            </div>
            <div class='wonder-body' tabindex='-1'>
              <div class='wonder-info-card'>
                <div class='wonder-info-grid wonder-info-grid--single'>
                  <div class='wonder-info-col wonder-info-col--stats'>
                    <div class='wonder-block-title'>${escapeHtml(keyInfosLabel)}</div>
                    <div class='wonder-quickfacts-bubbles'>
                      ${bodyParts.quickFactsHtml}
                    </div>
                  </div>
                  <div class='wonder-description-full'>
                    ${bodyParts.descriptionHtml}
                    ${bodyParts.bodyFallbackHtml}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
      <div class='wonder-footer'>
        ${isPerniciem && adoptUrl ? `
        <button class='wonder-adopt-btn' type='button' aria-label='${escapeHtml(t('popup.adoptSpecies'))}'>
          ${escapeHtml(t('popup.adoptSpecies'))}
        </button>
        ` : ''}
        <button class='wonder-close-btn' type='button' aria-label='${escapeHtml(t('popup.closeCard'))}'>
          ${escapeHtml(t('popup.close'))}
        </button>
      </div>
      ${isPerniciem && adoptUrl ? `
      <div class='wonder-adopt-modal' hidden>
        <div class='wonder-adopt-modal__backdrop'></div>
        <div class='wonder-adopt-modal__card' role='dialog' aria-modal='true' aria-label='${escapeHtml(t('popup.adoptSpecies'))}'>
          <div class='wonder-adopt-modal__title'>${escapeHtml(t('popup.adoptSpecies'))}</div>
          <img class='wonder-adopt-modal__qr' src='' alt='QR Code' />
          <button class='wonder-adopt-modal__close' type='button'>${escapeHtml(t('popup.close'))}</button>
        </div>
      </div>
      ` : ''}
    </div>
  `;

  const applyI18nToPopup = () => {
    const nextName = getDisplayName();
    const nextNickname = computeNickname(nextName);
    const nextBody = buildBodyParts();

    try {
      popup.setAttribute('aria-label', nextName || t('popup.profileDetails'));
    } catch { /* ignore */ }

    try {
      const titleEl = popup.querySelector('.wonder-hero-title');
      if (titleEl) titleEl.textContent = nextName || '';
    } catch { /* ignore */ }

    try {
      const nickEl = popup.querySelector('.wonder-hero-subtitle');
      if (nickEl) {
        nickEl.innerHTML = nextNickname ? `<em>${escapeHtml(nextNickname)}</em>` : '';
        if (nextNickname) nickEl.removeAttribute('hidden');
        else nickEl.setAttribute('hidden', '');
      }
    } catch { /* ignore */ }

    try {
      const qfEl = popup.querySelector('.wonder-quickfacts-bubbles');
      if (qfEl) qfEl.innerHTML = `${nextBody.quickFactsHtml}`;
    } catch { /* ignore */ }

    try {
      const descEl = popup.querySelector('.wonder-description-full');
      if (descEl) descEl.innerHTML = `${nextBody.descriptionHtml}${nextBody.bodyFallbackHtml}`;
    } catch { /* ignore */ }

    try {
      const blockTitle = popup.querySelector('.wonder-block-title');
      if (blockTitle) {
        const k = 'popup.keyInfos';
        const translated = t(k);
        blockTitle.textContent = (translated && translated !== k) ? translated : 'Infos clés';
      }
    } catch { /* ignore */ }

    try {
      const closeBtn = popup.querySelector('.wonder-close-btn');
      if (closeBtn) {
        closeBtn.textContent = t('popup.close');
        closeBtn.setAttribute('aria-label', t('popup.closeCard'));
      }
    } catch { /* ignore */ }

    try {
      const adoptBtn = popup.querySelector('.wonder-adopt-btn');
      if (adoptBtn) {
        adoptBtn.textContent = t('popup.adoptSpecies');
        adoptBtn.setAttribute('aria-label', t('popup.adoptSpecies'));
      }
      const adoptTitle = popup.querySelector('.wonder-adopt-modal__title');
      if (adoptTitle) adoptTitle.textContent = t('popup.adoptSpecies');

      const nextAdoptUrl = buildAdoptUrl();
      const adoptModalCard = popup.querySelector('.wonder-adopt-modal__card');
      if (adoptModalCard) adoptModalCard.setAttribute('aria-label', t('popup.adoptSpecies'));

      const qrImg = popup.querySelector('.wonder-adopt-modal__qr');
      if (qrImg) {
        const qrDataUrl = buildQrDataUrl(nextAdoptUrl);
        qrImg.setAttribute('src', qrDataUrl || '');
      }

      const adoptClose = popup.querySelector('.wonder-adopt-modal__close');
      if (adoptClose) adoptClose.textContent = t('popup.close');
    } catch { /* ignore */ }

    try {
      const imgEl = popup.querySelector('.wonder-media-img');
      if (imgEl) imgEl.setAttribute('alt', nextName || t('popup.imageAlt'));
    } catch { /* ignore */ }

    try { clampWithinBounds(); } catch { /* ignore */ }
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
  const focusTarget = popup.querySelector('.wonder-body');
  if (focusTarget && focusTarget.focus) focusTarget.focus();

  // --- Dragging & Positioning Logic ---
  function clampWithinBounds() {
    let currentLeft = parseFloat(popup.style.left) || 0;
    let currentTop = parseFloat(popup.style.top) || 0;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const vp = getViewportSize();

    currentLeft = clamp(currentLeft, 16, Math.max(16, vp.width - width - 16));
    currentTop = clamp(currentTop, 16, Math.max(16, vp.height - height - 16));

    popup.style.left = currentLeft + 'px';
    popup.style.top = currentTop + 'px';
    return { left: currentLeft, top: currentTop, width, height };
  }

  // Initial clamp
  clampWithinBounds();

  const onViewportResize = () => {
    try { clampWithinBounds(); } catch { /* ignore */ }
  };
  window.addEventListener('resize', onViewportResize);

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
    const vp = getViewportSize();
    const p = computeDockedPosition({
      anchorX,
      anchorY,
      popupW: rect.width || popupW,
      popupH: rect.height || popupH,
      screenW: vp.width,
      screenH: vp.height
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
  const adoptBtn = popup.querySelector('.wonder-adopt-btn');
  const adoptModal = popup.querySelector('.wonder-adopt-modal');
  const adoptModalBackdrop = popup.querySelector('.wonder-adopt-modal__backdrop');
  const adoptModalClose = popup.querySelector('.wonder-adopt-modal__close');

  function openAdoptModal() {
    if (!adoptModal) return;
    adoptModal.removeAttribute('hidden');
  }

  function closeAdoptModal() {
    if (!adoptModal) return;
    adoptModal.setAttribute('hidden', '');
  }
  
  function teardownNow() {
    document.onpointermove = null;
    document.onpointerup = null;
    popup.style.display = 'none';
    if (popup.parentNode) popup.parentNode.removeChild(popup);
    document.removeEventListener('keydown', onKeyDown);
    try { window.removeEventListener('i18n:change', onI18nChange); } catch { /* ignore */ }
    try { window.removeEventListener('resize', onViewportResize); } catch { /* ignore */ }
    if (connectorPath && connectorPath.parentNode) connectorPath.parentNode.removeChild(connectorPath);
    removePopupBackIfAny();
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

  if (adoptBtn) adoptBtn.onclick = () => openAdoptModal();
  if (adoptModalBackdrop) adoptModalBackdrop.onclick = () => closeAdoptModal();
  if (adoptModalClose) adoptModalClose.onclick = () => closeAdoptModal();

  function onKeyDown(e) {
    if (e.key === 'Escape' && adoptModal && !adoptModal.hasAttribute('hidden')) {
      closeAdoptModal();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Esc') {
      teardown();
      return;
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // Dragging across the whole popup except image, navigation, and close button
  let dragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;
  popup.style.cursor = 'grab';
  popup.onpointerdown = function(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.wonder-close-btn')) return;
    if (e.target.closest('.wonder-adopt-btn')) return;
    if (e.target.closest('.wonder-adopt-modal')) return;
    if (e.target.closest('.wonder-page-nav')) return;
    popup.style.zIndex = String(POPUP_Z_INDEX + 100 + Date.now() % 1000); // Bring to front
    dragging = true;
    userMoved = true;
    autoFollow = false;
    popup.style.cursor = 'grabbing';
    dragOffsetX = e.clientX - popup.offsetLeft;
    dragOffsetY = e.clientY - popup.offsetTop;
    document.onpointermove = function(ev) {
      if (dragging) {
        const vp = getViewportSize();
        let nx = ev.clientX - dragOffsetX;
        let ny = ev.clientY - dragOffsetY;
        nx = Math.max(16, Math.min(nx, vp.width - popup.offsetWidth - 16));
        ny = Math.max(16, Math.min(ny, vp.height - popup.offsetHeight - 16));
        popup.style.left = nx + 'px';
        popup.style.top = ny + 'px';
        clampWithinBounds();
        try {
          const a = resolveAnchorPointFallback();
          setConnectorPath(connectorPath, a.x, a.y, popup.getBoundingClientRect());
        } catch { /* ignore */ }
        dragOffsetX = ev.clientX - popup.offsetLeft;
        dragOffsetY = ev.clientY - popup.offsetTop;
      }
    };
    document.onpointerup = function() {
      dragging = false;
      popup.style.cursor = 'grab';
      document.onpointermove = null;
      document.onpointerup = null;
      clampWithinBounds();
      try {
        const a = resolveAnchorPointFallback();
        setConnectorPath(connectorPath, a.x, a.y, popup.getBoundingClientRect());
      } catch { /* ignore */ }
    };
  };
}
