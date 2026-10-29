// datasetConfig.js
// Routes between the datasets based on ?data= URL parameter.
// ?data=perniciem  → Endangered species (PERNiCiEM collection)
// ?data=masters    → Past Masters
// ?data=postmasters → Post Masters (Originals)
// ?data=all        → Both datasets combined
const params = new URLSearchParams(window.location.search);
const raw = (params.get('data') || '').toLowerCase().trim();

export const DATASET_KEY = (raw === 'masters') ? 'masters'
                         : (raw === 'postmasters') ? 'postmasters'
                         : (raw === 'all')     ? 'all'
                         : 'perniciem';

const CONFIGS = {
  perniciem: {
    key: 'perniciem',
    title: 'PERNiCiEM — Endangered Species',
    shortTitle: 'Endangered Species',
    logoAlt: 'Endangered Species Interactive Map',
    subtitle: 'Our Planet Is Changing. Discover the Species in Danger all around the world.',
    openingTitle: 'Our Planet Is Changing.\nDiscover the Species in Danger all around the world.',
    openingCta: 'Tap to Explore',
    idleTimeoutMs: 60000,
    adoptPageBaseUrl: `${window.location.origin}${window.location.pathname.replace(/[^/]+$/, '')}adopt.html`,
    loading: 'Loading…',
    searchTitle: 'Search',
    searchPlaceholder: 'Search by species, habitat, region…',
    searchHint: 'Search by species, habitat, region…',
    countryAll: 'All regions',
    countryUnknown: 'Unknown region',
    dataPath: 'Ressource/data/perniciem.points.json',
    // No images/positions JSON needed — data is self-contained
    imagesPath: null,
    positionsPath: null,
    // Popup field mapping
    popupFields: {
      subtitle: ['scientificName'],
      tags: [
        { key: 'conservationStatus', label: 'Status' },
        { key: 'population', label: 'Population' },
        { key: 'cat', label: 'Habitat' },
        { key: 'declineRate', label: 'Decline' }
      ],
      description: ['Notes'],
      extra: []
    },
    // Theme accent colors (exhibition palette)
    accentHue: 'yellow',  // primary accent
    markerColor: 0xE3D000, // exhibition yellow
    markerEmissive: 0x4A4500,
    haloColor: 0xE3D000,
    contourColor: 0x2962FF, // exhibition blue
    homeLatLon: { lat: 20, lon: 0 },
    homeZoom: 420
  },
  masters: {
    key: 'masters',
    title: 'Past Masters — Artworks Map',
    shortTitle: 'Past Masters',
    logoAlt: 'Past Masters Interactive Map',
    subtitle: 'Step into the world of the Masters.',
    openingTitle: 'Step into the world of the Masters.',
    openingCta: 'Tap to explore.',
    loading: 'Loading…',
    searchTitle: 'Search',
    searchPlaceholder: 'Search by artwork…',
    searchHint: 'Search by artwork…',
    countryAll: 'All countries',
    countryUnknown: 'Unknown',
    dataPath: 'Ressource/data/masters.points.json',
    imagesPath: null,
    positionsPath: null,
    popupFields: {
      subtitle: ['artist'],
      tags: [
        { key: 'date', label: 'Date' },
        { key: 'medium', label: 'Medium' },
        { key: 'dimensions', label: 'Dimensions' }
      ],
      description: [],
      extra: []
    },
    accentHue: 'red',
    markerColor: 0xDA291C, // exhibition red
    markerEmissive: 0x3D0A07,
    haloColor: 0xDA291C,
    contourColor: 0xE3D000,
    homeLatLon: { lat: 48, lon: 2 },
    homeZoom: 320
  },
  postmasters: {
    key: 'postmasters',
    title: 'Post Masters — Artworks Map',
    shortTitle: 'Post Masters',
    logoAlt: 'Post Masters Interactive Map',
    subtitle: 'Discover the original artworks in the room',
    loading: 'Loading…',
    searchTitle: 'Search',
    searchPlaceholder: 'Search by artwork…',
    searchHint: 'Search by artwork…',
    countryAll: 'All countries',
    countryUnknown: 'Unknown',
    dataPath: 'Ressource/data/postmasters.points.json',
    imagesPath: null,
    positionsPath: null,
    popupFields: {
      subtitle: [],
      tags: [
        { key: 'dimensions', label: 'Dimensions' },
        { key: 'dimensionsCm', label: 'Dimensions (cm)' },
        { key: 'bricks', label: 'Bricks' },
        { key: 'labelNumber', label: 'Label' }
      ],
      description: ['Description'],
      extra: [
        { key: 'QRcode', label: 'QR' }
      ]
    },
    accentHue: 'blue',
    markerColor: 0x2962FF, // exhibition blue
    markerEmissive: 0x0B1B4A,
    haloColor: 0x2962FF,
    contourColor: 0xE3D000,
    homeLatLon: { lat: 48, lon: 2 },
    homeZoom: 320
  },
  all: {
    key: 'all',
    title: 'Art of the Brick Interactive Map',
    shortTitle: 'AOTB Map',
    logoAlt: 'Art of the Brick Interactive Map',
    subtitle: 'Explore all collections on the map',
    loading: 'Loading…',
    searchTitle: 'Search',
    searchPlaceholder: 'Search by name, species, artwork…',
    searchHint: 'Search by name, species, artwork…',
    countryAll: 'All regions',
    countryUnknown: 'Unknown',
    // dataPath is an array — wonders.js merges both
    dataPath: [
      'Ressource/data/perniciem.points.json',
      'Ressource/data/masters.points.json'
    ],
    imagesPath: null,
    positionsPath: null,
    popupFields: {
      subtitle: ['scientificName', 'artist'],
      tags: [
        { key: 'conservationStatus', label: 'Status' },
        { key: 'date', label: 'Date' },
        { key: 'medium', label: 'Medium' },
        { key: 'movement', label: 'Movement' },
        { key: 'cat', label: 'Habitat' }
      ],
      description: ['Notes'],
      extra: [
        { key: 'threats', label: 'Threats' },
        { key: 'artistBio', label: 'About the Artist' },
        { key: 'population', label: 'Population' },
        { key: 'dimensions', label: 'Dimensions' }
      ]
    },
    accentHue: 'yellow',
    markerColor: 0xE3D000,
    markerEmissive: 0x4A4500,
    haloColor: 0xE3D000,
    contourColor: 0x2962FF,
    homeLatLon: { lat: 20, lon: 0 },
    homeZoom: 420
  }
};

export { CONFIGS };
export const DATASET = CONFIGS[DATASET_KEY];
export default DATASET;
