function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

// Browser screen dimensions cannot identify the surface chosen in getDisplayMedia.
// Map desktop placement only when a selected native surface is known explicitly.
export function captureBounds(settings, bounds) {
  if (!['monitor', 'window'].includes(settings?.displaySurface)) return null;
  if (!bounds || !['left', 'top', 'width', 'height'].every(key => Number.isFinite(bounds[key])) || bounds.width <= 0 || bounds.height <= 0) return null;
  return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
}

export function windowFromAnchor(anchor, bounds, layout) {
  const diameter = layout.radius * 2 * Math.min(bounds.width / layout.width, bounds.height / layout.height);
  return { left: Math.round(bounds.left + anchor.cx / layout.width * bounds.width - diameter / 2), top: Math.round(bounds.top + anchor.cy / layout.height * bounds.height - diameter / 2), width: Math.round(diameter), height: Math.round(diameter) };
}

export function anchorFromWindow(windowBounds, displayBounds, layout) {
  const x = (windowBounds.left + windowBounds.width / 2 - displayBounds.left) / displayBounds.width;
  const y = (windowBounds.top + windowBounds.height / 2 - displayBounds.top) / displayBounds.height;
  const margin = layout.radius + 12;
  return {
    cx: clamp(x * layout.width, margin, layout.width - margin),
    cy: clamp(y * layout.height, margin, layout.height - margin)
  };
}

export function anchorFromPreviewPointer(pointer, wrap, source, dragOffset = { x: 0, y: 0 }) {
  const scale = Math.min(wrap.width / source.width, wrap.height / source.height);
  const shownWidth = source.width * scale, shownHeight = source.height * scale;
  const offsetX = (wrap.width - shownWidth) / 2, offsetY = (wrap.height - shownHeight) / 2;
  return {
    x: clamp((pointer.x - wrap.left - offsetX - dragOffset.x) / shownWidth, 0, 1),
    y: clamp((pointer.y - wrap.top - offsetY - dragOffset.y) / shownHeight, 0, 1)
  };
}

export function nearbyPlacements({ width, height, cx, cy, radius }, anchor = { cx, cy }) {
  const margin = radius + 12;
  cx = clamp(anchor.cx, margin, width - margin);
  cy = clamp(anchor.cy, margin, height - margin);
  const dx = Math.min(radius * 2.2, width * 0.16);
  const dy = Math.min(radius * 2.2, height * 0.22);
  const xShift = cx > width / 2 ? -dx : dx;
  const yShift = cy > height / 2 ? -dy : dy;
  return [
    { cx, cy },
    { cx, cy: clamp(cy + yShift, margin, height - margin) },
    { cx: clamp(cx + xShift, margin, width - margin), cy },
    { cx: clamp(cx + xShift, margin, width - margin), cy: clamp(cy + yShift, margin, height - margin) }
  ];
}

export function scorePlacements(frame, previous, width, height, spots, radius) {
  const light = (x, y, pixels) => {
    const i = (y * width + x) * 4;
    return (pixels[i] * 3 + pixels[i + 1] * 6 + pixels[i + 2]) / 10;
  };
  return spots.map(({ cx, cy }) => {
    let total = 0, count = 0;
    const minX = Math.max(1, Math.floor(cx - radius));
    const maxX = Math.min(width - 2, Math.ceil(cx + radius));
    const minY = Math.max(1, Math.floor(cy - radius));
    const maxY = Math.min(height - 2, Math.ceil(cy + radius));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
      const value = light(x, y, frame);
      const edges = (Math.abs(value - light(x + 1, y, frame)) + Math.abs(value - light(x, y + 1, frame))) / 2;
      const movement = previous ? Math.abs(value - light(x, y, previous)) : 0;
      total += edges + movement * 0.8;
      count++;
    }
    return count ? total / count : Infinity;
  });
}

export function choosePlacement(scores, current, lastMoveAt, now) {
  if (now - lastMoveAt < 3000) return current;
  const best = scores.indexOf(Math.min(...scores));
  if (best < 0 || best === current) return current;
  return scores[current] - scores[best] >= 8 && scores[current] > scores[best] * 1.35 ? best : current;
}
