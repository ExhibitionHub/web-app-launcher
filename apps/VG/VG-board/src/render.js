export function createRenderer({
  getState,
  currentStep,
  goHome,
  t,
  escapeHtml,
  resolveArtworkUrl,
  resolveHomeArtworkUrl,
  buildCategoryChoiceItems,
  buildRanking,
  sortDisplayRankingItems
}) {
  function artworkUrlStyle(artworkUrl, variableName = "--artwork-image", extraDeclarations = "") {
    if (!artworkUrl) {
      return "";
    }

    const declarations = [`${variableName}: url('${escapeHtml(artworkUrl)}');`];
    if (extraDeclarations) {
      declarations.push(extraDeclarations);
    }

    return `style="${declarations.join(" ")}"`;
  }

  function artworkStyle(fileName, variableName = "--artwork-image", extraDeclarations = "") {
    return artworkUrlStyle(resolveArtworkUrl(fileName), variableName, extraDeclarations);
  }

  function renderSceneArtwork(fileName, variantClass = "") {
    const artworkUrl = resolveArtworkUrl(fileName);
    if (!artworkUrl) {
      return "";
    }

    return `<div class="scene-artwork ${variantClass}" style="--scene-artwork-image: url('${escapeHtml(artworkUrl)}');" aria-hidden="true"></div>`;
  }

  function renderHomeFace(fileName, faceClass) {
    return `
      <span class="home-mosaic-face ${faceClass}" ${artworkUrlStyle(resolveHomeArtworkUrl(fileName), "--tile-image")}>
        <span class="home-mosaic-media home-mosaic-media-fill"></span>
        <span class="home-mosaic-media home-mosaic-media-shade"></span>
      </span>
    `;
  }

  function renderHomeTitle() {
    const state = getState();
    const title = String(t(state.experience.home.titleKey));
    const lowerTitle = title.toLowerCase();
    const breakToken = "painted ";
    const breakIndex = lowerTitle.indexOf(breakToken);

    if (breakIndex === -1) {
      return escapeHtml(title);
    }

    const firstLine = title.slice(0, breakIndex + "painted".length);
    const secondLine = title.slice(breakIndex + "painted".length).trimStart();
    return `
      <span class="home-title-line">${escapeHtml(firstLine)}</span>
      <span class="home-title-line">${escapeHtml(secondLine)}</span>
    `;
  }

  function renderHome() {
    const state = getState();

    return `
      <div class="scene-panel home-panel">
        <div class="home-mosaic" aria-hidden="true" data-home-mosaic>
          ${state.homeTiles
            .map(
              (fileName, index) => `
                <span class="home-mosaic-tile" data-home-tile-index="${index}">
                  <span class="home-mosaic-flip">
                    ${renderHomeFace(fileName, "home-mosaic-face-front")}
                    ${renderHomeFace("", "home-mosaic-face-back")}
                  </span>
                </span>
              `
            )
            .join("")}
        </div>
        <div class="home-hero">
          <div class="scene-copy home-copy">
            <h1 class="scene-title">${renderHomeTitle()}</h1>
            <p class="scene-text">${escapeHtml(t(state.experience.home.textKey))}</p>
          </div>
          <div class="home-actions">
            <button class="start-button" type="button" data-action="start">${escapeHtml(t(state.experience.home.buttonKey))}</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderResultOverlay(option) {
    if (!option) {
      return "";
    }

    const localizedLines = t(option.resultKey);
    const lines = Array.isArray(localizedLines) ? localizedLines : [String(localizedLines)];
    const [supraLine, ...bodyLines] = lines;

    return `
      <div class="result-card">
        <div class="result-card-backdrop" aria-hidden="true"></div>
        <div class="result-card-content">
          <p class="result-supratitle">${escapeHtml(supraLine)}</p>
          <div class="result-divider" aria-hidden="true"></div>
          <div class="result-body">
            ${bodyLines.map((line) => `<p class="result-body-line">${escapeHtml(line)}</p>`).join("")}
          </div>
        </div>
      </div>
      <div class="result-actions">
        <button class="text-action-button next-button" type="button" data-action="next" aria-label="${escapeHtml(t("aria.next"))}">
          <span>${escapeHtml(t("aria.next"))}</span>
          <span class="arrow-icon"></span>
        </button>
      </div>
    `;
  }

  function renderStep(options = {}) {
    const state = getState();
    const { showResultOverlay = false } = options;
    const step = currentStep();
    if (!step) {
      goHome();
      return "";
    }

    const selectedOption = showResultOverlay ? step.options?.[state.currentOptionIndex] : null;
    if (showResultOverlay && !selectedOption) {
      goHome();
      return "";
    }

    const hasCarried = Boolean(state.activeArtworkFile);
    const backgroundArtworkFile = showResultOverlay
      ? (state.activeArtworkFile || selectedOption?.backgroundFile || selectedOption?.imageFile || "")
      : state.activeArtworkFile;

    const rawText = String(t(step.textKey));
    const qIdx = rawText.lastIndexOf("?");
    const splitIdx = qIdx > 0 ? rawText.lastIndexOf(". ", qIdx) : -1;
    const textHtml =
      splitIdx !== -1
        ? `<span class="step-context">${escapeHtml(rawText.slice(0, splitIdx + 1))}</span><span class="step-question">${escapeHtml(rawText.slice(splitIdx + 2))}</span>`
        : escapeHtml(rawText);

    return `
      <div class="scene-panel choice-panel${hasCarried ? " has-carried" : ""}${showResultOverlay ? " has-result-overlay" : ""}">
        ${renderSceneArtwork(backgroundArtworkFile, showResultOverlay ? "is-result" : "is-carried")}
        ${hasCarried && !showResultOverlay ? '<div class="compare-glow" aria-hidden="true"></div>' : ""}
        ${showResultOverlay
          ? renderResultOverlay(selectedOption)
          : `
        <div class="scene-copy compare-copy">
          <h2 class="scene-title">${escapeHtml(t(step.titleKey))}</h2>
          <p class="scene-text">${textHtml}</p>
        </div>
        <div class="options-grid" data-count="${step.options.length}">
          ${step.options
            .map((option, optionIndex) => {
              const detail = option.detailKey ? ` ${t(option.detailKey)}` : "";
              return `
                <button class="option-card" type="button" data-action="select" data-option-index="${optionIndex}" ${artworkStyle(option.imageFile || option.backgroundFile, "--artwork-image", `--reveal-index: ${optionIndex};`)}>
                  <span class="option-copy">
                    <span class="option-title">${escapeHtml(t(option.labelKey))}</span>
                    <span class="option-year">${escapeHtml(`${t(option.yearKey)}${detail}`)}</span>
                  </span>
                </button>
              `;
            })
            .join("")}
        </div>`}
      </div>
    `;
  }

  function renderCategoryChoice() {
    const categoryItems = buildCategoryChoiceItems();
    if (!categoryItems.length) {
      goHome();
      return "";
    }

    return `
      <div class="scene-panel category-panel">
        <div class="scene-copy category-copy">
          <h2 class="scene-title">${escapeHtml(t("categoryChoice.title"))}</h2>
          <p class="scene-text">${escapeHtml(t("categoryChoice.text"))}</p>
        </div>
        <div class="category-options-grid">
          ${categoryItems
            .map(
              (item, index) => `
                <button
                  class="option-card category-option-card"
                  type="button"
                  data-action="select-category"
                  data-step-id="${escapeHtml(item.key)}"
                  ${artworkStyle(item.artworkFile, "--artwork-image", `--reveal-index: ${index};`)}
                >
                  <span class="option-copy category-option-copy">
                    <span class="option-title">${escapeHtml(t(item.titleKey))}</span>
                    <span class="option-year category-option-meta">${escapeHtml(item.artworkLabel)}</span>
                  </span>
                </button>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function renderFinal() {
    const state = getState();
    const ranking = sortDisplayRankingItems(buildRanking());
    const presentationRanking = ranking;
    const finalRanks = new Map(ranking.map((item, index) => [item.key, index + 1]));

    return `
      <div class="scene-panel final-panel">
        <div class="scene-copy final-copy">
          <h2 class="scene-title">${escapeHtml(t(state.experience.final.titleKey))}</h2>
          <p class="scene-text">${escapeHtml(t(state.experience.final.textKey))}</p>
        </div>
        <div class="final-board">
          <div class="ranking-list" data-ranking-list>
            ${presentationRanking.length
              ? presentationRanking
                  .map(
                    (item) => `
                      <article
                        class="ranking-card"
                        data-ranking-key="${item.key}"
                        data-ranking-count="${item.count}"
                        data-ranking-percentage="${item.percentage}"
                        data-ranking-seed="${item.seedIndex}"
                        data-final-rank="${finalRanks.get(item.key) || ""}"
                        ${artworkStyle(item.artworkFile, "--ranking-artwork-image")}
                      >
                        <div class="ranking-card-overlay"></div>
                        <div class="ranking-card-rank">${finalRanks.get(item.key) || ""}</div>
                        <div class="ranking-card-divider"></div>
                        <div class="ranking-card-copy">
                          <div class="ranking-card-title">${escapeHtml(t(item.titleKey))}</div>
                          <div class="ranking-card-subtitle">${escapeHtml(item.artworkLabel)}</div>
                          <div class="ranking-card-percentage">${escapeHtml(item.percentageLabel)}</div>
                          <div class="ranking-card-bar" aria-hidden="true">
                            <span class="ranking-card-bar-fill" style="width: ${item.percentage.toFixed(2)}%;"></span>
                          </div>
                        </div>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="ranking-empty">${escapeHtml(t("final.empty"))}</div>`}
          </div>
        </div>
      </div>
    `;
  }

  function renderCurrentView() {
    const state = getState();

    if (state.view === "home") {
      return renderHome();
    }

    if (state.view === "category") {
      return renderCategoryChoice();
    }

    if (state.view === "final") {
      return renderFinal();
    }

    return renderStep({ showResultOverlay: state.resultOverlayVisible });
  }

  return {
    artworkStyle,
    renderCurrentView,
    renderSceneArtwork
  };
}
