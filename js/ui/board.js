import { periodDays, pokemonTileDates } from '../core.js';
import { create, button } from './dom.js';

// The final row spans the full image, including 29-, 30- and 31-day months.
// Tile IDs stay fixed; opaque areas take priority within the seeded order.
export function tileGeometry(index, count) {
  if (count === 7) {
    const row = index < 2 ? 0 : index < 5 ? 1 : 2;
    const span = row === 1 ? 2 : 3;
    const position = index - (row === 0 ? 0 : row === 1 ? 2 : 5);
    return { columns: 6, rows: 3, row, column: position * span, span };
  }
  const rows = Math.ceil(count / 7);
  const row = Math.floor(index / 7);
  const remaining = count - (rows - 1) * 7;
  const lastRow = row === rows - 1;
  const position = index % 7;
  const column = lastRow ? Math.floor(position * 7 / remaining) : position;
  const span = lastRow
    ? Math.floor((position + 1) * 7 / remaining) - column
    : 1;
  return { columns: 7, rows, row, column, span };
}

export async function withCoverage(artwork) {
  if (artwork?.artType !== 'pokemon' || !artwork.artwork) return artwork;
  const url = URL.createObjectURL(artwork.artwork);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 280;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 280, 280);
    const pixels = context.getImageData(0, 0, 280, 280).data;
    const count = periodDays(artwork.id).length;
    const priority = [];
    for (let index = 0; index < count; index++) {
      const { columns, rows, row, column, span } = tileGeometry(index, count);
      let opaque = 0;
      let total = 0;
      for (let y = Math.floor(row * 280 / rows); y < Math.floor((row + 1) * 280 / rows); y++) {
        for (let x = Math.floor(column * 280 / columns); x < Math.floor((column + span) * 280 / columns); x++) {
          if (pixels[(y * 280 + x) * 4 + 3] > 32) opaque++;
          total++;
        }
      }
      if (opaque / total >= .08) priority.push(index);
    }
    return { ...artwork, priority };
  } catch {
    // A damaged legacy/imported PNG must not prevent access to the records.
    return artwork;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function paintTile(tile, url, geometry) {
  const { columns, rows, row, column, span } = geometry;
  tile.style.backgroundImage = `url("${url}"), var(--board-ground)`;
  tile.style.backgroundSize = `${columns * 100 / span}% ${rows * 100}%`;
  tile.style.backgroundPosition = `${span === columns ? 0 : column * 100 / (columns - span)}% ${rows === 1 ? 0 : row * 100 / (rows - 1)}%`;
}

export function fillMosaic(grid, month, entries, artwork, imageURL, options = {}) {
  const { thumbnail = false, onDay, revealIndex = -1 } = options;
  const dates = periodDays(month);
  const pokemon = artwork?.artType === 'pokemon' && imageURL;
  const opened = pokemon ? pokemonTileDates(entries, month, artwork.pokemonId, artwork.priority) : null;
  grid.replaceChildren();
  const { columns, rows } = tileGeometry(0, dates.length);
  grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  for (let index = 0; index < dates.length; index++) {
    const date = pokemon ? opened.get(index) : dates[index];
    const dayEntries = date ? entries.filter(entry => entry.date === date) : [];
    const isOpen = dayEntries.length > 0;
    const self = dayEntries.some(entry => entry.selfStarted);
    const tile = thumbnail
      ? create('span', 'album-tile')
      : button(pokemon ? '' : String(index + 1), 'month-cell', () => onDay(date));
    tile.dataset.tile = String(index);
    tile.classList.toggle('open', isOpen);
    tile.classList.toggle('self', self);
    tile.classList.toggle('just-opened', isOpen && revealIndex === index);
    const geometry = tileGeometry(index, dates.length);
    tile.style.gridColumn = `span ${geometry.span}`;
    if (pokemon && isOpen) paintTile(tile, imageURL, geometry);
    if (!thumbnail) {
      tile.disabled = !isOpen;
      tile.setAttribute('aria-label', isOpen
        ? `${Number(date.slice(-2))}日の記録${dayEntries.length}件${self ? '、自分からやった' : ''}`
        : 'まだ開いていません');
    }
    grid.append(tile);
  }
}
