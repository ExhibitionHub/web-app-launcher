// cursorManager.js
// Manages the multi-touch visual halos (colors by screen zone).

const userColors = ['#ffb300', '#42a5f5', '#ab47bc'];
const userZones = [
  { xMin: 0, xMax: 1 / 3 },
  { xMin: 1 / 3, xMax: 2 / 3 },
  { xMin: 2 / 3, xMax: 1 }
];
const pointerColors = new Map();

function getZoneIndex(x) {
  const screenWidth = window.innerWidth || 1;
  const relX = x / screenWidth;
  for (let i = 0; i < userZones.length; i++) {
    if (relX >= userZones[i].xMin && relX < userZones[i].xMax) {
      return i;
    }
  }
  return userZones.length - 1;
}

function resolvePointerId(input) {
  if (input && input.pointerId != null) return input.pointerId;
  if (input && input.identifier != null) return input.identifier;
  return 'mouse';
}

export function createTouchCursor(touch) {
  const x = touch.clientX;
  const y = touch.clientY;
  const pointerId = resolvePointerId(touch);
  let color = pointerColors.get(pointerId);
  if (!color) {
    const zoneIdx = getZoneIndex(x);
    color = userColors[zoneIdx] || userColors[0];
    pointerColors.set(pointerId, color);
  }
  let cursor = document.getElementById('touch-cursor-' + pointerId);
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = 'touch-cursor-' + pointerId;
    cursor.className = 'touch-cursor';
    cursor.style.left = '0';
    cursor.style.top = '0';
    cursor.style.willChange = 'transform';
    document.body.appendChild(cursor);
  }
  if (cursor.dataset.color !== color) {
    cursor.style.boxShadow = `0 0 3.2rem 0.8rem ${color}, 0 0 0 0.4rem ${color}88`;
    cursor.dataset.color = color;
  }
  const halfSize = cursor.dataset.halfSize
    ? Number(cursor.dataset.halfSize)
    : (() => {
        const size = (cursor.getBoundingClientRect().width || 0) / 2;
        cursor.dataset.halfSize = String(size);
        return size;
      })();
  cursor.style.transform = `translate3d(${x - halfSize}px, ${y - halfSize}px, 0)`;
  cursor.style.display = 'block';
  return cursor;
}

export function removeTouchCursor(touch) {
  const pointerId = resolvePointerId(touch);
  const cursor = document.getElementById('touch-cursor-' + pointerId);
  if (cursor) cursor.style.display = 'none';
  pointerColors.delete(pointerId);
}

export function removeAllTouchCursors() {
  document.querySelectorAll('.touch-cursor').forEach(cursor => {
    cursor.style.display = 'none';
  });
  pointerColors.clear();
}

export function getPointerColor(input) {
  const pointerId = resolvePointerId(input);
  return pointerColors.get(pointerId);
}
