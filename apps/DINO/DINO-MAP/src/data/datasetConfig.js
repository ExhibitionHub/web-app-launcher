// datasetConfig.js
// Dino-map configuration. This project currently ships a single dataset.
// (A legacy `?data=` query param is still accepted for compatibility.)

const params = new URLSearchParams(window.location.search);
const raw = (params.get('data') || '').toLowerCase().trim();

function normalizeDatasetKey(value) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return 'dino';
  // Legacy name used by older builds/scripts
  if (v === 'perniciem') return 'dino';
  if (v === 'dino' || v === 'dinos' || v === 'dinosaurs') return 'dino';
  return 'dino';
}

export const DATASET_KEY = normalizeDatasetKey(raw);

const CONFIGS = {
  dino: {
    key: 'dino',
    dataPath: 'Ressource/data/perniciem.points.json',
    popupFields: {
      subtitle: ['scientificName'],
      tags: [
        { key: 'family', labelKey: 'popup.meta.family' },
        { key: 'habitat', labelKey: 'popup.meta.habitat' },
        { key: 'diet', labelKey: 'popup.meta.diet' },
        { key: 'weight', labelKey: 'popup.meta.weight' }
      ],
      description: ['Notes'],
      extra: [
        { key: 'speed', labelKey: 'popup.meta.speed' },
        { key: 'reproduction', labelKey: 'popup.meta.reproduction' },
        { key: 'specimensFound', labelKey: 'popup.meta.specimensFound' },
        { key: 'attributes', labelKey: 'popup.meta.attributes' },
        { key: 'length', labelKey: 'popup.meta.length' },
        { key: 'height', labelKey: 'popup.meta.height' },
        { key: 'meaning', labelKey: 'popup.meta.meaning' },
        { key: 'Country', labelKey: 'popup.meta.region' }
      ]
    },
    // Theme accent colors (sampled from TOMBSTONE PDFs)
    accentHue: 'green',
    markerColor: 0x609468, // #609468
    markerEmissive: 0x243D2C,
    haloColor: 0x609468,
    contourColor: 0x609468,
    homeLatLon: { lat: 20, lon: 0 },
    homeZoom: 420
  }
};

export { CONFIGS };
export const DATASET = CONFIGS[DATASET_KEY] || CONFIGS.dino;
export default DATASET;
