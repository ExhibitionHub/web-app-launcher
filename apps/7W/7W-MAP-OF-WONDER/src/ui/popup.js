import { getResourcePath } from '../utils/fileLoader.js';

// Constants
const POPUP_Z_INDEX = 9999;
const PLACEHOLDER_IMG = 'Ressource/Background.png';

const t = (key, vars, fallback = '') => {
  try {
    const i18n = window.i18n;
    const translate = i18n && typeof i18n.t === 'function' ? i18n.t : null;
    if (!translate) return String(fallback || key || '');
    const translated = translate(String(key), vars);
    if (translated && translated !== key) return translated;
  } catch {
  }

  return String(fallback || key || '');
};

const formatPageNumber = (value) => String(value).padStart(2, '0');

const getLocalizedCategory = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return t(`mapApp.categories.${raw.toLowerCase()}`, null, raw);
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
const createMediaHtml = (imgSrc, altText, caption, isPlaceholder = false) => {
  const placeholderSrc = getResourcePath(PLACEHOLDER_IMG);
  // Text overlay removed as per request
  // const credits = caption ? `<p class='wonder-media-caption'>${caption}</p>` : '';
  // const mediaMetaHtml = credits ? `<div class='wonder-media-meta'>${credits}</div>` : '';
  
  return `
    <div class='wonder-media-frame ${isPlaceholder ? 'is-placeholder' : ''}' style="--media-src: url('${imgSrc}')">
      <img class='wonder-media-img' src='${imgSrc}' alt='${altText}' onerror="this.src='${placeholderSrc}'" draggable="false" />
      ${isPlaceholder ? `<span class='wonder-media-placeholder-label'>${t('mapApp.popup.imageUnavailable', null, 'Image unavailable')}</span>` : ''}
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
export function showWonderPanel(w, clickX, clickY) {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  
  // Calculate dimensions
  const popupW = Math.round(Math.min(screenH * 0.42, screenW * 0.48));
  const popupH = Math.round(screenH * 0.72);
  
  // Calculate position
  let left = clickX - popupW / 2;
  let top = clickY - 32;
  left = Math.max(16, Math.min(left, screenW - popupW - 16));
  top = Math.max(16, Math.min(top, screenH - popupH - 16));
  
  // Unique ID for the popup
  const safeName = (w.name || 'wonder').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
  const popupId = 'wonder-popup-' + safeName + '-' + left;
  
  // Remove existing popups that are close
  document.querySelectorAll('.wonder-popup.window-popup').forEach(p => {
    const px = parseInt(p.style.left || '0', 10);
    if (Math.abs(px - left) < popupW * 0.75) {
      p.style.display = 'none';
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
    popup.setAttribute('aria-label', w.name || t('mapApp.popup.cardAriaFallback', null, 'Wonder details'));
    document.body.appendChild(popup);
  }
  
  // Apply styles
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.position = 'fixed';
  popup.style.zIndex = POPUP_Z_INDEX;
  popup.style.userSelect = 'none';

  const placeholderSrc = getResourcePath(PLACEHOLDER_IMG);

  // --- Prepare Content ---

  // 1. Main Page
  const primaryImage = (w && w.primaryImage) || {};
  const preferredImgPath = w.img || primaryImage.asset || w.image;
  let mainImgSrc = resolveAssetPath(preferredImgPath) || placeholderSrc;
  let isMainPlaceholder = !preferredImgPath;
  if (isMainPlaceholder) mainImgSrc = placeholderSrc;

  const mainMediaHtml = createMediaHtml(mainImgSrc, w.name || t('mapApp.popup.imageAltFallback', null, 'Image'), primaryImage.caption, isMainPlaceholder);

  const descriptionCandidates = [w.description, w.overview, w.history]
    .map(text => typeof text === 'string' ? text.trim() : '')
    .filter(text => !!text);
  
  // Deduplicate descriptions
  const uniqueDescriptions = [...new Set(descriptionCandidates.map(t => t.toLowerCase()))]
    .map(key => descriptionCandidates.find(t => t.toLowerCase() === key));

  const overviewHtml = uniqueDescriptions.length
    ? uniqueDescriptions.map((text, idx) => `<p class='wonder-overview ${idx > 0 ? 'wonder-overview--secondary' : ''}'>${text}</p>`).join('')
    : `<p class='wonder-overview wonder-overview--empty'>${t('mapApp.popup.detailsPending', null, 'Details to be confirmed.')}</p>`;

  const metaEntries = [
    { label: t('mapApp.popup.meta.location', null, 'Location'), value: w.location },
    { label: t('mapApp.popup.meta.built', null, 'Built'), value: w.dateBuilt },
    { label: t('mapApp.popup.meta.destroyed', null, 'Destroyed'), value: w.dateDestroyed }
  ];
  const metaHtml = createMetaHtml(metaEntries);

  const pages = [];
  
  // Add Main Page
  pages.push(createPageHtml({
    index: 0,
    title: null, // Placeholder header
    tip: null,
    mediaHtml: mainMediaHtml,
    bodyHtml: metaHtml + overviewHtml
  }));

  // 2. Quick Facts Pages
  const quickFacts = Array.isArray(w.quickFacts) ? w.quickFacts : [];
  const quickFactsData = quickFacts.map(fact => typeof fact === 'string' ? { text: fact } : (fact || {}));

  quickFactsData.forEach((factData, factIdx) => {
    const factAssetRaw = factData.asset || factData.image || factData.img;
    const factImgSrc = resolveAssetPath(factAssetRaw) || placeholderSrc;
    const hasFactAsset = !!factAssetRaw;
    const factNumber = factIdx + 1;
    const paddedFactNumber = formatPageNumber(factNumber);
    
    const factMediaHtml = createMediaHtml(
      factImgSrc, 
      t('mapApp.popup.quickFactAlt', { name: w.name || t('mapApp.popup.cardAriaFallback', null, 'Wonder details'), number: factNumber }, `${w.name || 'Wonder'} - fact ${factNumber}`), 
      factData.caption, 
      !hasFactAsset
    );

    const factTextHtml = factData.text
      ? `<p class='wonder-overview'>${factData.text}</p>`
      : `<p class='wonder-overview wonder-overview--empty'>${t('mapApp.popup.quickFactFallback', null, 'Quick fact coming soon.')}</p>`;

    pages.push(createPageHtml({
      index: factNumber,
      title: t('mapApp.popup.quickFact', { number: paddedFactNumber }, `Fact ${paddedFactNumber}`),
      tip: `${paddedFactNumber} / ${formatPageNumber(quickFactsData.length)}`,
      mediaHtml: factMediaHtml,
      bodyHtml: factTextHtml,
      type: 'facts'
    }));
  });

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

  // --- Navigation & Shell ---
  const totalPages = pages.length;
  const pageNavHtml = totalPages > 1
    ? `<div class='wonder-page-nav' role='tablist' aria-label='${t('mapApp.popup.navigationAria', null, 'Card navigation')}'>
        <button class='wonder-page-btn wonder-page-btn--prev' data-page-dir='prev' type='button' aria-label='${t('mapApp.popup.previousPage', null, 'Previous page')}'>
          <span aria-hidden='true'>&lsaquo;</span>
        </button>
        <div class='wonder-page-indicators'>
          ${pages.map((_, idx) => `
            <button class='wonder-page-dot ${idx === 0 ? 'is-active' : ''}' data-page='${idx}' type='button' aria-label='${t('mapApp.popup.goToPage', { number: idx + 1 }, `Go to page ${idx + 1}`)}'></button>
          `).join('')}
        </div>
        <button class='wonder-page-btn wonder-page-btn--next' data-page-dir='next' type='button' aria-label='${t('mapApp.popup.nextPage', null, 'Next page')}'>
          <span aria-hidden='true'>&rsaquo;</span>
        </button>
      </div>`
    : '';
  
  const pageHintHtml = totalPages > 1
    ? `<p class='wonder-page-hint'>${t('mapApp.popup.pageHint', null, 'Use the arrows or dots to change the content.')}</p>`
    : '';

  const category = getLocalizedCategory(w.cat);

  popup.innerHTML = `
    <div class='wonder-content'>
      <div class='wonder-shell'>
        <header class='wonder-header'>
          <div class='wonder-header-text'>
            <h2 class='wonder-title'>${w.name || ''}</h2>
            ${category ? `<p class='wonder-cat'>${category}</p>` : ''}
          </div>
        </header>
        <div class='wonder-pages' data-page-count='${totalPages}'>
          ${pages.join('')}
        </div>
        ${pageHintHtml}
        ${pageNavHtml}
      </div>
      <div class='wonder-footer'>
        <button class='wonder-close-btn' type='button' aria-label='${t('mapApp.popup.closeAria', null, 'Close the card')}'>
          ${t('mapApp.popup.close', null, 'Close')}
        </button>
      </div>
    </div>
  `;

  // --- Interaction Logic ---
  const pageSections = Array.from(popup.querySelectorAll('.wonder-page'));
  const prevBtn = popup.querySelector('[data-page-dir="prev"]');
  const nextBtn = popup.querySelector('[data-page-dir="next"]');
  const pageDots = Array.from(popup.querySelectorAll('.wonder-page-dot'));
  let currentPageIndex = 0;

  const syncPageState = () => {
    pageSections.forEach((section, idx) => {
      const isActive = idx === currentPageIndex;
      section.classList.toggle('wonder-page--active', isActive);
      section.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      
      if (isActive) {
        // Re-clamp after transition to ensure it stays on screen if it grows
        setTimeout(() => clampWithinBounds(), 450);
      }
    });
    pageDots.forEach((dot, idx) => {
      dot.classList.toggle('is-active', idx === currentPageIndex);
    });
    if (prevBtn) prevBtn.disabled = currentPageIndex === 0;
    if (nextBtn) nextBtn.disabled = currentPageIndex >= pageSections.length - 1;
  };

  const goToPage = targetIndex => {
    if (targetIndex < 0 || targetIndex >= pageSections.length) return;
    currentPageIndex = targetIndex;
    syncPageState();
  };

  // Initial sync
  syncPageState();

  // Event Listeners for Navigation
  if (prevBtn) prevBtn.addEventListener('click', () => goToPage(currentPageIndex - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => goToPage(currentPageIndex + 1));
  
  pageDots.forEach(dot => {
    dot.addEventListener('click', () => {
      const target = Number(dot.getAttribute('data-page'));
      if (!Number.isNaN(target)) goToPage(target);
    });
  });

  // Focus first scrollable element
  const firstScrollable = popup.querySelector('.wonder-page--active [tabindex="0"]');
  if (firstScrollable) firstScrollable.focus();

  // --- Dragging & Positioning Logic ---
  function clampWithinBounds() {
    let currentTop = parseFloat(popup.style.top) || 0;
    const height = popup.offsetHeight;
    if (currentTop < 16) currentTop = 16;
    if (currentTop + height > screenH - 16) {
      currentTop = Math.max(16, screenH - height - 16);
    }
    popup.style.top = currentTop + 'px';
    return currentTop;
  }

  // Initial clamp
  clampWithinBounds();

  const closeBtn = popup.querySelector('.wonder-close-btn');
  
  function teardown() {
    document.onpointermove = null;
    document.onpointerup = null;
    popup.style.display = 'none';
    if (popup.parentNode) popup.parentNode.removeChild(popup);
    document.removeEventListener('keydown', onKeyDown);
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
    if (pageSections.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      goToPage(currentPageIndex + delta);
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
    if (e.target.closest('.wonder-page-nav')) return;
    if (e.target.classList.contains('wonder-media-img') || e.target.closest('.wonder-media-frame')) return;
    popup.style.zIndex = String(POPUP_Z_INDEX + 100 + Date.now() % 1000); // Bring to front
    dragging = true;
    popup.style.cursor = 'grabbing';
    dragOffsetX = e.clientX - popup.offsetLeft;
    dragOffsetY = e.clientY - popup.offsetTop;
    document.onpointermove = function(ev) {
      if (dragging) {
        let nx = ev.clientX - dragOffsetX;
        let ny = ev.clientY - dragOffsetY;
        nx = Math.max(16, Math.min(nx, screenW - popup.offsetWidth - 16));
        ny = Math.max(16, Math.min(ny, screenH - popup.offsetHeight - 16));
        popup.style.left = nx + 'px';
        popup.style.top = ny + 'px';
        clampWithinBounds();
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
    };
  };
}
