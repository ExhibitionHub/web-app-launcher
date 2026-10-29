import {
  CARRY_TRANSITION_FADE_MS,
  CARRY_TRANSITION_MIDPOINT_MS,
  FULLSCREEN_TRANSITION_OVERSCAN,
  SELECTION_BRUSH_PASS_DURATION_MS,
  SELECTION_TRANSITION_FADE_MS,
  SELECTION_TRANSITION_FUSION_MS,
  SELECTION_TRANSITION_MIDPOINT_MS,
  SELECTION_TRANSITION_MS,
  STAGE_HEIGHT,
  STAGE_WIDTH
} from "./config.js";
import { prefersReducedMotion } from "./motion.js";

export function createTransitionController({
  appStage,
  sceneFrame,
  resolveArtworkUrl,
  scheduleTransientTimeout,
  isTransitionTokenCurrent,
  playPendingResultIntro,
  playPendingFinalIntro
}) {
  let artworkTransitionLayer = null;
  let sceneHandoffAnimation = null;
  let sceneRevealAnimation = null;
  const selectionBrushPasses = createSelectionBrushPasses();

  function getFullscreenTransitionRect(scale = FULLSCREEN_TRANSITION_OVERSCAN) {
    const stageWidth = appStage?.clientWidth || STAGE_WIDTH;
    const stageHeight = appStage?.clientHeight || STAGE_HEIGHT;

    return expandRectFromCenter(
      {
        left: 0,
        top: 0,
        width: stageWidth,
        height: stageHeight
      },
      scale
    );
  }

  function hasActiveArtworkTransition() {
    return Boolean(artworkTransitionLayer?.classList.contains("is-active"));
  }

  function getElementStageRect(element) {
    const elementRect = element?.getBoundingClientRect?.();
    const stageRect = appStage?.getBoundingClientRect?.();
    if (!elementRect || !stageRect?.width || !stageRect?.height) {
      return null;
    }

    const scaleX = (appStage.clientWidth || STAGE_WIDTH) / stageRect.width;
    const scaleY = (appStage.clientHeight || STAGE_HEIGHT) / stageRect.height;

    return {
      left: (elementRect.left - stageRect.left) * scaleX,
      top: (elementRect.top - stageRect.top) * scaleY,
      width: elementRect.width * scaleX,
      height: elementRect.height * scaleY
    };
  }

  function resetArtworkTransitionLayer() {
    sceneHandoffAnimation?.cancel();
    sceneRevealAnimation?.cancel();
    sceneHandoffAnimation = null;
    sceneRevealAnimation = null;

    if (!artworkTransitionLayer) {
      sceneFrame.classList.remove("is-artwork-handoff");
      return;
    }

    const transitionNodes = [artworkTransitionLayer, ...artworkTransitionLayer.querySelectorAll("*")];

    transitionNodes.forEach((node) => {
      node.getAnimations().forEach((animation) => {
        animation.cancel();
      });
    });

    artworkTransitionLayer.classList.remove("is-active", "is-fullscreen");
    sceneFrame.classList.remove("is-artwork-handoff");
    artworkTransitionLayer.removeAttribute("style");

    artworkTransitionLayer
      .querySelectorAll(".artwork-transition-image, .artwork-transition-pass, .artwork-transition-grain, .artwork-transition-shade")
      .forEach((node) => {
        node.removeAttribute("style");
      });
  }

  function ensureArtworkTransitionLayer() {
    if (artworkTransitionLayer) {
      return artworkTransitionLayer;
    }

    artworkTransitionLayer = document.createElement("div");
    artworkTransitionLayer.className = "artwork-transition-layer";
    artworkTransitionLayer.innerHTML = `
      <div class="artwork-transition-image"></div>
      ${selectionBrushPasses.map(() => '<div class="artwork-transition-pass"></div>').join("")}
      <div class="artwork-transition-grain"></div>
      <div class="artwork-transition-shade"></div>
    `;
    appStage.appendChild(artworkTransitionLayer);
    return artworkTransitionLayer;
  }

  async function playSelectionTransition(selectedCard, artworkFile, transitionToken, onMidpoint) {
    if (!selectedCard || !artworkFile || prefersReducedMotion()) {
      if (isTransitionTokenCurrent(transitionToken)) {
        onMidpoint();
      }
      return;
    }

    const layer = ensureArtworkTransitionLayer();
    const image = layer.querySelector(".artwork-transition-image");
    const shade = layer.querySelector(".artwork-transition-shade");
    const grain = layer.querySelector(".artwork-transition-grain");
    const passes = Array.from(layer.querySelectorAll(".artwork-transition-pass"));
    const artworkUrl = resolveArtworkUrl(artworkFile);
    const targetVisualRect = getFullscreenTransitionRect();
    const selectedVisualRect = getElementStageRect(selectedCard);
    const canUseBrushReveal = passes.length === selectionBrushPasses.length && supportsBrushReveal();
    let renderedSceneArtwork = null;
    let renderedSceneArtworkOpacity = 1;

    if (!image || !shade || !artworkUrl) {
      if (isTransitionTokenCurrent(transitionToken)) {
        onMidpoint();
      }
      return;
    }

    setTransitionArtwork(layer, artworkUrl);
    setTransitionSurfaceRect(image, targetVisualRect, "0px");
    passes.forEach((pass) => setTransitionSurfaceRect(pass, targetVisualRect, "0px"));
    prepareTransitionBrushPasses(passes, selectionBrushPasses, canUseBrushReveal);
    image.style.opacity = "0";
    if (grain) {
      grain.style.opacity = "0";
    }
    shade.style.opacity = "0";
    layer.classList.add("is-active");
    sceneHandoffAnimation?.cancel();
    sceneHandoffAnimation = sceneFrame.animate(
      [
        { opacity: 1 },
        { opacity: 0.72, offset: 0.48 },
        { opacity: 0 }
      ],
      {
        duration: SELECTION_TRANSITION_MIDPOINT_MS,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards"
      }
    );

    const initialClipPath = buildInsetClipPath(selectedVisualRect, targetVisualRect, 28);

    const imageAnimation = image.animate(
      canUseBrushReveal
        ? [
            {
              opacity: 0.04,
              clipPath: initialClipPath,
              transform: "translate3d(0, 8px, 0) scale(1.018)"
            },
            {
              opacity: 0.1,
              clipPath: initialClipPath,
              offset: 0.12,
              transform: "translate3d(0, 6px, 0) scale(1.014)"
            },
            {
              opacity: 0.18,
              clipPath: "inset(0px 0px 0px 0px round 0px)",
              offset: 0.58,
              transform: "translate3d(0, 2px, 0) scale(1.004)"
            },
            {
              opacity: 1,
              clipPath: "inset(0px 0px 0px 0px round 0px)",
              transform: "translate3d(0, 0, 0) scale(1)"
            }
          ]
        : [
            {
              opacity: 0,
              clipPath: initialClipPath,
              transform: "translate3d(0, 8px, 0) scale(1.018)"
            },
            {
              opacity: 0.94,
              clipPath: initialClipPath,
              offset: 0.14,
              transform: "translate3d(0, 6px, 0) scale(1.014)"
            },
            {
              opacity: 1,
              clipPath: "inset(0px 0px 0px 0px round 0px)",
              transform: "translate3d(0, 0, 0) scale(1)"
            }
          ],
      {
        duration: SELECTION_TRANSITION_MS,
        easing: "cubic-bezier(0.33, 0, 0.2, 1)",
        fill: "forwards"
      }
    );
    const shadeAnimation = shade.animate(
      [
        { opacity: 0 },
        { opacity: 0.08, offset: 0.58 },
        { opacity: 0.04 }
      ],
      {
        duration: SELECTION_TRANSITION_MS,
        easing: "linear",
        fill: "forwards"
      }
    );
    const passAnimations = canUseBrushReveal
      ? passes.map((pass, index) => {
          const motion = selectionBrushPasses[index];

          return pass.animate(
            [
              {
                opacity: 0,
                transform: `translate3d(${motion.startX}px, ${motion.startY}px, 0) rotate(${motion.rotate}deg) scaleX(0.06) scaleY(0.82)`
              },
              {
                opacity: 0.84,
                offset: 0.46,
                transform: `translate3d(${motion.startX * 0.18}px, ${motion.startY * 0.16}px, 0) rotate(${motion.rotate * 0.18}deg) scaleX(0.76) scaleY(0.98)`
              },
              {
                opacity: 0.96,
                offset: 0.72,
                transform: "translate3d(0, 0, 0) rotate(0deg) scaleX(1.018) scaleY(1.01)"
              },
              {
                opacity: 0.88,
                transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)"
              }
            ],
            {
              duration: SELECTION_BRUSH_PASS_DURATION_MS,
              delay: motion.delay,
              easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
              fill: "forwards"
            }
          );
        })
      : [];
    const grainAnimation = canUseBrushReveal && grain
      ? grain.animate(
          [
            { opacity: 0 },
            { opacity: 0.085, offset: 0.52 },
            { opacity: 0.025 }
          ],
          {
            duration: SELECTION_TRANSITION_MS,
            easing: "linear",
            fill: "forwards"
          }
        )
      : null;

    scheduleTransientTimeout(() => {
      if (!isTransitionTokenCurrent(transitionToken)) {
        return;
      }

      sceneFrame.classList.add("is-artwork-handoff");
      sceneHandoffAnimation?.cancel();
      sceneHandoffAnimation = null;
      onMidpoint();

      renderedSceneArtwork = sceneFrame.querySelector(".scene-artwork");
      if (renderedSceneArtwork) {
        const resolvedOpacity = Number.parseFloat(window.getComputedStyle(renderedSceneArtwork).opacity);
        renderedSceneArtworkOpacity = Number.isNaN(resolvedOpacity) ? 1 : resolvedOpacity;
      }

      const introDelayMs = Math.max(
        0,
        SELECTION_TRANSITION_MS - SELECTION_TRANSITION_MIDPOINT_MS - 360
      );

      scheduleTransientTimeout(() => {
        if (!isTransitionTokenCurrent(transitionToken)) {
          return;
        }

        playPendingResultIntro();
        playPendingFinalIntro();
      }, introDelayMs);
    }, SELECTION_TRANSITION_MIDPOINT_MS);

    await waitForAnimationPromises(
      [
        imageAnimation.finished,
        shadeAnimation.finished,
        grainAnimation?.finished,
        ...passAnimations.map((animation) => animation.finished)
      ],
      SELECTION_TRANSITION_MS + 140
    );

    if (!isTransitionTokenCurrent(transitionToken)) {
      return;
    }

    if (renderedSceneArtwork) {
      sceneFrame.classList.remove("is-artwork-handoff");
      renderedSceneArtwork.style.opacity = "0";
      sceneRevealAnimation?.cancel();
      sceneRevealAnimation = sceneFrame.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: SELECTION_TRANSITION_FUSION_MS,
          easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
          fill: "forwards"
        }
      );

      const fusionAnimations = [
        layer.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          {
            duration: SELECTION_TRANSITION_FUSION_MS,
            easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
            fill: "forwards"
          }
        ).finished,
        renderedSceneArtwork.animate(
          [
            { opacity: 0 },
            { opacity: renderedSceneArtworkOpacity }
          ],
          {
            duration: SELECTION_TRANSITION_FUSION_MS,
            easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
            fill: "forwards"
          }
        ).finished,
        sceneRevealAnimation.finished
      ];

      await waitForAnimationPromises(
        fusionAnimations,
        SELECTION_TRANSITION_FUSION_MS + 220
      );

      if (!isTransitionTokenCurrent(transitionToken)) {
        return;
      }

      renderedSceneArtwork.style.removeProperty("opacity");
      sceneRevealAnimation?.cancel();
      sceneRevealAnimation = null;
      resetArtworkTransitionLayer();
      return;
    }

    sceneFrame.classList.remove("is-artwork-handoff");
    sceneRevealAnimation?.cancel();
    sceneRevealAnimation = sceneFrame.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: SELECTION_TRANSITION_FADE_MS,
        easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        fill: "forwards"
      }
    );
    const fadeAnimation = layer.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: SELECTION_TRANSITION_FADE_MS,
        easing: "cubic-bezier(0.35, 0, 0.2, 1)",
        fill: "forwards"
      }
    );

    await waitForAnimationPromises(
      [fadeAnimation.finished, sceneRevealAnimation.finished],
      SELECTION_TRANSITION_FADE_MS + 220
    );

    if (!isTransitionTokenCurrent(transitionToken)) {
      return;
    }

    sceneRevealAnimation?.cancel();
    sceneRevealAnimation = null;
    resetArtworkTransitionLayer();
  }

  async function playCarryTransition(artworkFile, transitionToken, onMidpoint) {
    if (!artworkFile || prefersReducedMotion()) {
      if (isTransitionTokenCurrent(transitionToken)) {
        onMidpoint();
      }
      return;
    }

    const layer = ensureArtworkTransitionLayer();
    const image = layer.querySelector(".artwork-transition-image");
    const shade = layer.querySelector(".artwork-transition-shade");
    const artworkUrl = resolveArtworkUrl(artworkFile);
    const fullscreenRect = getFullscreenTransitionRect();

    if (!image || !shade || !artworkUrl) {
      if (isTransitionTokenCurrent(transitionToken)) {
        onMidpoint();
      }
      return;
    }

    setTransitionArtwork(layer, artworkUrl);
    setTransitionSurfaceRect(image, fullscreenRect, "0px");
    image.style.opacity = "0";
    shade.style.opacity = "0";
    layer.classList.add("is-active");

    const takeoverAnimation = image.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: CARRY_TRANSITION_MIDPOINT_MS,
        easing: "cubic-bezier(0.33, 0, 0.2, 1)",
        fill: "forwards"
      }
    );
    const holdAnimation = shade.animate(
      [{ opacity: 0 }, { opacity: 0.14 }],
      { duration: CARRY_TRANSITION_MIDPOINT_MS, easing: "linear", fill: "forwards" }
    );

    await waitForAnimationPromises(
      [takeoverAnimation.finished, holdAnimation.finished],
      CARRY_TRANSITION_MIDPOINT_MS + 180
    );

    if (!isTransitionTokenCurrent(transitionToken)) {
      return;
    }

    sceneFrame.classList.add("is-artwork-handoff");
    onMidpoint();

    const carriedArtwork = sceneFrame.querySelector(".scene-artwork.is-carried");
    if (carriedArtwork) {
      carriedArtwork.style.opacity = "1";
    }

    sceneFrame.classList.remove("is-artwork-handoff");

    const fadeAnimation = layer.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: CARRY_TRANSITION_FADE_MS,
        easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        fill: "forwards"
      }
    );

    const carriedFadeAnimation = carriedArtwork
      ? carriedArtwork.animate(
          [{ opacity: 1 }, { opacity: 0.85 }],
          {
            duration: CARRY_TRANSITION_FADE_MS,
            easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
            fill: "forwards"
          }
        )
      : null;

    await waitForAnimationPromises(
      [fadeAnimation.finished, carriedFadeAnimation?.finished],
      CARRY_TRANSITION_FADE_MS + 180
    );

    if (!isTransitionTokenCurrent(transitionToken)) {
      return;
    }

    if (carriedArtwork) {
      carriedFadeAnimation?.cancel();
      carriedArtwork.style.removeProperty("opacity");
    }

    resetArtworkTransitionLayer();
  }

  return {
    ensureArtworkTransitionLayer,
    hasActiveArtworkTransition,
    playCarryTransition,
    playSelectionTransition,
    resetArtworkTransitionLayer
  };
}

function setTransitionArtwork(layer, artworkUrl) {
  layer.style.setProperty("--transition-artwork-image", `url('${artworkUrl}')`);
}

function setTransitionSurfaceRect(element, rect, borderRadius = "0px") {
  if (!element) {
    return;
  }

  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
  element.style.borderRadius = borderRadius;
}

function createSelectionBrushPasses() {
  return [
    {
      delay: 0,
      startX: -110,
      startY: -18,
      rotate: -2.2,
      origin: "left center",
      mask: buildBrushMask(
        "M -60 118 C 140 76 310 142 488 124 S 760 92 1060 148",
        "M -25 160 C 160 132 315 176 490 154 S 760 130 1015 172",
        58,
        3
      )
    },
    {
      delay: 140,
      startX: 105,
      startY: -6,
      rotate: 1.8,
      origin: "right center",
      mask: buildBrushMask(
        "M 1060 236 C 850 190 700 270 510 238 S 220 195 -60 258",
        "M 1020 278 C 830 244 680 302 500 276 S 205 242 -20 292",
        62,
        7
      )
    },
    {
      delay: 280,
      startX: -95,
      startY: 8,
      rotate: -1.5,
      origin: "left center",
      mask: buildBrushMask(
        "M -55 348 C 145 306 318 374 500 350 S 770 322 900 384",
        "M -15 390 C 160 362 320 414 492 390 S 720 374 860 414",
        57,
        11
      )
    },
    {
      delay: 420,
      startX: 100,
      startY: 18,
      rotate: 2.1,
      origin: "right center",
      mask: buildBrushMask(
        "M 1060 472 C 850 430 710 506 525 474 S 270 435 120 488",
        "M 1020 514 C 835 486 700 536 530 516 S 300 488 165 530",
        54,
        17
      )
    }
  ];
}

function buildBrushMask(mainPath, accentPath, strokeWidth, seed) {
  const accentWidth = Math.max(9, Math.round(strokeWidth * 0.2));
  const bristleOffset = Math.max(9, Math.round(strokeWidth * 0.22));
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 563" preserveAspectRatio="none">
      <defs>
        <filter id="rough" x="-12%" y="-18%" width="124%" height="136%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.075" numOctaves="2" seed="${seed}" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <mask id="brush" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="563">
          <rect width="1000" height="563" fill="black"/>
          <g fill="none" stroke="white" stroke-linecap="round" filter="url(#rough)">
            <path d="${mainPath}" stroke-width="${strokeWidth}"/>
            <path d="${accentPath}" stroke-width="${accentWidth}" opacity="0.78"/>
          </g>
          <g fill="none" stroke="black" stroke-linecap="round" opacity="0.24">
            <path d="${mainPath}" transform="translate(0 -${bristleOffset})" stroke-width="1.4" stroke-dasharray="38 126 15 91" stroke-dashoffset="${seed * 7}"/>
            <path d="${mainPath}" transform="translate(0 ${bristleOffset})" stroke-width="1.1" stroke-dasharray="19 84 44 152" stroke-dashoffset="${seed * 11}"/>
          </g>
        </mask>
      </defs>
      <rect width="1000" height="563" fill="white" mask="url(#brush)"/>
    </svg>
  `.trim();

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function prepareTransitionBrushPasses(passes, configs, enabled) {
  passes.forEach((pass, index) => {
    const config = configs[index];
    if (!enabled || !config) {
      pass.style.display = "none";
      return;
    }

    pass.style.display = "block";
    pass.style.webkitMaskImage = config.mask;
    pass.style.maskImage = config.mask;
    pass.style.transformOrigin = config.origin;
    pass.style.opacity = "0";
  });
}

function supportsBrushReveal() {
  return typeof CSS !== "undefined"
    && typeof CSS.supports === "function"
    && (
      CSS.supports("mask-image", "linear-gradient(black, transparent)")
      || CSS.supports("-webkit-mask-image", "linear-gradient(black, transparent)")
    );
}

function buildInsetClipPath(rect, bounds, borderRadius = 0) {
  if (!rect || !bounds) {
    return "inset(42% 42% 42% 42% round 28px)";
  }

  const top = Math.max(0, rect.top - bounds.top);
  const left = Math.max(0, rect.left - bounds.left);
  const right = Math.max(0, bounds.width - left - rect.width);
  const bottom = Math.max(0, bounds.height - top - rect.height);

  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${borderRadius}px)`;
}

function waitForAnimationPromises(animationPromises, fallbackMs) {
  const pendingPromises = animationPromises.filter(Boolean);
  if (!pendingPromises.length) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let didResolve = false;
    const finish = () => {
      if (didResolve) {
        return;
      }

      didResolve = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, fallbackMs);

    Promise.allSettled(pendingPromises).then(finish);
  });
}

function expandRectFromCenter(rect, scale) {
  const scaledWidth = rect.width * scale;
  const scaledHeight = rect.height * scale;

  return {
    left: rect.left - (scaledWidth - rect.width) / 2,
    top: rect.top - (scaledHeight - rect.height) / 2,
    width: scaledWidth,
    height: scaledHeight
  };
}
