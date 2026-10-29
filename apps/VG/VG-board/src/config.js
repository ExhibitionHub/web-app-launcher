export const EXPERIENCE_PATH = "./ressource/data/experience.json";
export const LANGUAGE_PATH = "./lang";
export const DEFAULT_LOCALE = "en";
export const ASSET_VERSION = "20260824k";
export const DEFAULT_SCENE_OUT_MS = 760;
export const DEFAULT_HOME_TILE_FADE_MS = 1500;
export const SELECTION_TRANSITION_MS = 1120;
export const SELECTION_TRANSITION_MIDPOINT_MS = 520;
export const SELECTION_TRANSITION_FADE_MS = 480;
export const SELECTION_TRANSITION_FUSION_MS = 480;
export const SELECTION_BRUSH_PASS_DURATION_MS = 760;
export const CARRY_TRANSITION_MIDPOINT_MS = 420;
export const CARRY_TRANSITION_FADE_MS = 650;
export const RESULT_CONTENT_ENTER_MS = 850;
export const RESULT_CONTENT_EXIT_MS = 420;
export const RESULT_BACKDROP_ENTER_MS = 900;
export const RESULT_BACKDROP_EXIT_MS = 440;
export const RESULT_ACTION_ENTER_MS = 800;
export const RESULT_ACTION_EXIT_MS = 380;
export const RESULT_EXIT_CARRY_HEADSTART_MS = 0;
export const HOME_FLIP_BURST_STAGGER_MS = 220;
export const FULLSCREEN_TRANSITION_OVERSCAN = 1;
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;
export const HOME_TILE_RATIO_HINTS = [
  1.01, 1.59, 1.64, 1.64, 1.59, 1.01,
  0.74, 0.73,
  1.31, 2.15, 1.30, 2.14,
  0.99, 1.57, 1.63, 1.62, 1.57, 0.99
];

// Kept in code so the home mosaic can choose well-shaped thumbnails without
// downloading and decoding every full-resolution artwork at startup.
export const ARTWORK_ASPECT_RATIOS = Object.freeze({
  "almond-blossom-1890.webp": 1.264637,
  "bedroom-in-arles-1888.webp": 1.260210,
  "bedroom-in-arles-1889-chicago.webp": 1.281139,
  "bedroom-in-arles-1889-orsay.webp": 1.278107,
  "cafe-terrace-at-night-1888.webp": 0.802778,
  "gauguin-chair-1888.webp": 0.762037,
  "green-wheatfield-with-cypress-1889.webp": 1.216216,
  "irises-1889.webp": 1.307506,
  "joseph-roulin-1888-blue.webp": 0.800926,
  "joseph-roulin-1888-floral.webp": 0.827778,
  "joseph-roulin-1889-green.webp": 0.830556,
  "road-with-cypress-and-star-1890.webp": 0.793519,
  "roses-1890.webp": 1.261682,
  "starry-night-over-the-rhone-1888.webp": 1.290323,
  "sunflowers-1888-variant-1.webp": 0.809259,
  "sunflowers-1888-variant-2.webp": 0.799074,
  "sunflowers-1888-variant-3.webp": 0.792593,
  "sunflowers-1889.webp": 0.758333,
  "the-starry-night-1889.webp": 1.263158,
  "van-gogh-chair-1888.webp": 0.779630,
  "wheatfield-under-thunderclouds-1890.webp": 2.033898,
  "wheatfield-with-crows-1890.webp": 2.101167,
  "wheatfields-near-auvers-1890.webp": 2.049336
});
