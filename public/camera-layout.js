export function cameraLayout(screenWidth, screenHeight, cameraWidth, cameraHeight) {
  const scale = Math.min(1, 1920 / screenWidth, 1080 / screenHeight);
  const width = Math.max(1, Math.round(screenWidth * scale));
  const height = Math.max(1, Math.round(screenHeight * scale));
  const radius = Math.max(24, Math.round(Math.min(width, height) * 0.11));
  const margin = Math.max(12, Math.round(Math.min(width, height) * 0.025));
  const edge = Math.min(radius, Math.floor((Math.min(width, height) - margin * 2) / 2));
  const size = Math.min(cameraWidth, cameraHeight);
  return {
    width, height,
    cx: width - margin - edge,
    cy: height - margin - edge,
    radius: edge,
    crop: { x: Math.floor((cameraWidth - size) / 2), y: Math.floor((cameraHeight - size) / 2), size }
  };
}
