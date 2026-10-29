// countryCentroids.js
// Minimal country centroid list (lat/lon degrees).
// Used to place items by country when exact GPS is unavailable.

export const COUNTRY_CENTROIDS = {
  // Western / Central Europe
  'france': { lat: 48.8566, lon: 2.3522 }, // Paris
  'germany': { lat: 52.5200, lon: 13.4050 }, // Berlin
  'switzerland': { lat: 46.8182, lon: 8.2275 },
  'austria': { lat: 47.5162, lon: 14.5501 },
  'belgium': { lat: 50.5039, lon: 4.4699 },
  'netherlands': { lat: 52.1326, lon: 5.2913 },
  'luxembourg': { lat: 49.8153, lon: 6.1296 },
  'italy': { lat: 41.8719, lon: 12.5674 },
  'spain': { lat: 40.4637, lon: -3.7492 },
  'portugal': { lat: 39.3999, lon: -8.2245 },
  'united kingdom': { lat: 51.5074, lon: -0.1278 }, // London
  'uk': { lat: 51.5074, lon: -0.1278 },
  'england': { lat: 52.3555, lon: -1.1743 },
  'scotland': { lat: 56.4907, lon: -4.2026 },
  'wales': { lat: 52.1307, lon: -3.7837 },
  'ireland': { lat: 53.1424, lon: -7.6921 },

  // Nordics
  'denmark': { lat: 56.2639, lon: 9.5018 },
  'norway': { lat: 60.4720, lon: 8.4689 },
  'sweden': { lat: 60.1282, lon: 18.6435 },
  'finland': { lat: 61.9241, lon: 25.7482 },
  'iceland': { lat: 64.9631, lon: -19.0208 },

  // Central / Eastern Europe
  'poland': { lat: 51.9194, lon: 19.1451 },
  'czech republic': { lat: 50.0755, lon: 14.4378 }, // Prague
  'czechia': { lat: 50.0755, lon: 14.4378 },
  'slovakia': { lat: 48.6690, lon: 19.6990 },
  'hungary': { lat: 47.1625, lon: 19.5033 },
  'slovenia': { lat: 46.1512, lon: 14.9955 },
  'croatia': { lat: 45.1000, lon: 15.2000 },
  'bosnia and herzegovina': { lat: 43.9159, lon: 17.6791 },
  'serbia': { lat: 44.0165, lon: 21.0059 },
  'montenegro': { lat: 42.7087, lon: 19.3744 },
  'north macedonia': { lat: 41.6086, lon: 21.7453 },
  'albania': { lat: 41.1533, lon: 20.1683 },
  'romania': { lat: 45.9432, lon: 24.9668 },
  'bulgaria': { lat: 42.7339, lon: 25.4858 },
  'greece': { lat: 39.0742, lon: 21.8243 },
  'ukraine': { lat: 48.3794, lon: 31.1656 },
  'belarus': { lat: 53.7098, lon: 27.9534 },
  'moldova': { lat: 47.4116, lon: 28.3699 },

  // Baltics
  'estonia': { lat: 58.5953, lon: 25.0136 },
  'latvia': { lat: 56.8796, lon: 24.6032 },
  'lithuania': { lat: 55.1694, lon: 23.8813 },

  // Neighbors / often present in datasets
  'russia': { lat: 55.7558, lon: 37.6173 }, // Moscow (more intuitive than centroid)
  'united states': { lat: 38.9072, lon: -77.0369 }, // Washington DC
  'usa': { lat: 38.9072, lon: -77.0369 },
  'united states of america': { lat: 38.9072, lon: -77.0369 },
  'china': { lat: 39.9042, lon: 116.4074 }, // Beijing
  'chile': { lat: -33.4489, lon: -70.6693 }, // Santiago
  'colombia': { lat: 4.7110, lon: -74.0721 }, // Bogotá
  'south africa': { lat: -25.7479, lon: 28.2293 }, // Pretoria
  'turkey': { lat: 38.9637, lon: 35.2433 },
  'georgia': { lat: 42.3154, lon: 43.3569 },
  'armenia': { lat: 40.0691, lon: 45.0382 },
  'azerbaijan': { lat: 40.1431, lon: 47.5769 }
};

export function normalizeCountryName(country) {
  if (!country) return '';
  const s = String(country)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  // Common aliases
  if (s === 'united kingdom of great britain and northern ireland') return 'united kingdom';
  if (s === 'great britain') return 'united kingdom';
  if (s === 'us') return 'united states';
  if (s === 'u s') return 'united states';
  if (s === 'u s a') return 'usa';
  if (s === 'u s a ') return 'usa';
  if (s === 'czech republic') return 'czech republic';
  return s;
}
