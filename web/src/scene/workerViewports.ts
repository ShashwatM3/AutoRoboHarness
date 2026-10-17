/** DOM tiles and WebGL scissor views share the same grid and camera height. */
export function workerViewports(width: number, height: number, count: number) {
  const columns = width < 640 ? 1 : Math.min(count, 2);
  const rows = Math.ceil(count / columns);
  const gap = 10;
  const tileWidth = (width - gap * (columns - 1)) / columns;
  const tileHeight = (height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, i) => ({
    x: (i % columns) * (tileWidth + gap),
    y: height - Math.floor(i / columns) * (tileHeight + gap) - tileHeight * 0.64,
    width: tileWidth,
    height: tileHeight * 0.64,
  }));
}
