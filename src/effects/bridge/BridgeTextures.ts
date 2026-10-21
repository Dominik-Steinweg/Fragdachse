import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import { ensureCanvasTexture } from '../EffectUtils';

/** Stone abutment band drawn onto the bank at both deck ends, in px. */
export const BRIDGE_ABUTMENT_OVERHANG_PX = 10;
/** Railing beams overhang the deck edges slightly, in px. */
export const BRIDGE_RAIL_OVERHANG_PX = 3;

/** Canvas size of a bridge texture drawn for horizontal travel (rotated for vertical bridges). */
export function bridgeTextureSize(spanCells: number, deckWidthCells: number): { width: number; height: number } {
  return {
    width: spanCells * CELL_SIZE + BRIDGE_ABUTMENT_OVERHANG_PX * 2,
    height: deckWidthCells * CELL_SIZE + BRIDGE_RAIL_OVERHANG_PX * 2,
  };
}

function seededRandom(seedText: string): () => number {
  let seed = 0x811c9dc5;
  for (let i = 0; i < seedText.length; i++) seed = Math.imul(seed ^ seedText.charCodeAt(i), 0x01000193);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WOOD = ['#6e5a45', '#75604a', '#665341', '#7c674f', '#6a5846', '#5f4e3d'];
const STONE = ['#6c6860', '#77726a', '#615d56', '#807b72'];

function shade(hex: string, factor: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 0xff) * factor)));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function drawAbutment(ctx: CanvasRenderingContext2D, x0: number, width: number, height: number, rng: () => number): void {
  ctx.fillStyle = '#3d3a35';
  ctx.fillRect(x0, 0, width, height);
  for (let y = 1; y < height - 1;) {
    const rowHeight = 5 + Math.floor(rng() * 4);
    for (let x = x0 + 1; x < x0 + width - 1;) {
      const stoneWidth = Math.min(x0 + width - 1 - x, 4 + Math.floor(rng() * 6));
      ctx.fillStyle = STONE[Math.floor(rng() * STONE.length)]!;
      ctx.fillRect(x, y, Math.max(1, stoneWidth - 1), Math.min(rowHeight - 1, height - 1 - y));
      ctx.fillStyle = 'rgba(255,248,230,0.10)';
      ctx.fillRect(x, y, Math.max(1, stoneWidth - 1), 1);
      x += stoneWidth;
    }
    y += rowHeight;
  }
  // Moss creeps up from the waterline into the joints.
  for (let i = 0; i < height / 3; i++) {
    ctx.fillStyle = `rgba(78,92,56,${0.18 + rng() * 0.22})`;
    ctx.fillRect(x0 + rng() * width, rng() * height, 1 + rng() * 2, 1 + rng() * 2);
  }
}

function drawPlank(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string,
  rng: () => number, worn: boolean): void {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  // Grain runs along the plank (across the travel direction).
  for (let g = 0; g < 3; g++) {
    ctx.fillStyle = `rgba(40,30,20,${0.12 + rng() * 0.14})`;
    ctx.fillRect(x + 1 + Math.floor(rng() * Math.max(1, w - 2)), y, 1, h);
  }
  ctx.fillStyle = 'rgba(255,240,210,0.08)';
  ctx.fillRect(x, y, 1, h);
  if (worn) {
    // The walking track in the middle is lighter and scuffed.
    const top = y + h * 0.3, bottom = h * 0.4;
    ctx.fillStyle = 'rgba(214,196,160,0.10)';
    ctx.fillRect(x, top, w, bottom);
  }
  if (rng() < 0.28) {
    ctx.fillStyle = 'rgba(38,28,18,0.45)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + rng() * h, Math.max(1, w * 0.3), 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Iron nails where the plank rests on the outer stringers.
  ctx.fillStyle = '#3b3d3f';
  for (const fy of [0.16, 0.84]) {
    ctx.fillRect(x + Math.floor(w / 2) - 1, y + Math.floor(h * fy), 2, 2);
  }
}

function drawRailing(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, rng: () => number): void {
  ctx.fillStyle = '#4a3a2b';
  ctx.fillRect(x0, y, x1 - x0, 5);
  ctx.fillStyle = 'rgba(255,236,200,0.14)';
  ctx.fillRect(x0, y, x1 - x0, 1);
  ctx.fillStyle = 'rgba(20,14,8,0.35)';
  ctx.fillRect(x0, y + 4, x1 - x0, 1);
  for (let x = x0 + 2; x < x1 - 4; x += 26 + Math.floor(rng() * 6)) {
    ctx.fillStyle = '#3a2d21';
    ctx.fillRect(x, y - 1, 7, 7);
    // Iron angle bracket on each post.
    ctx.fillStyle = '#6a6e70';
    ctx.fillRect(x, y - 1, 7, 2);
    ctx.fillRect(x, y - 1, 2, 7);
    ctx.fillStyle = '#2f3133';
    ctx.fillRect(x + 4, y + 2, 1, 1);
  }
}

/** Standing deck: weathered plank floor between stone abutments, railings along both edges. */
export function ensureBridgeDeckTexture(textures: Phaser.Textures.TextureManager, key: string,
  spanCells: number, deckWidthCells: number, seedText: string): void {
  const { width, height } = bridgeTextureSize(spanCells, deckWidthCells);
  ensureCanvasTexture(textures, key, width, height, (ctx) => {
    const rng = seededRandom(seedText);
    const over = BRIDGE_ABUTMENT_OVERHANG_PX, rail = BRIDGE_RAIL_OVERHANG_PX;
    drawAbutment(ctx, 0, over + 4, height, rng);
    drawAbutment(ctx, width - over - 4, over + 4, height, rng);
    ctx.fillStyle = '#231c15';
    ctx.fillRect(over, rail, width - over * 2, height - rail * 2);
    for (let x = over; x < width - over;) {
      const plank = Math.min(width - over - x, 5 + Math.floor(rng() * 3));
      const base = WOOD[Math.floor(rng() * WOOD.length)]!;
      drawPlank(ctx, x, rail + 1, plank - 1, height - rail * 2 - 2, shade(base, 0.92 + rng() * 0.16), rng, true);
      x += plank;
    }
    // Iron straps tie the deck to both abutments.
    ctx.fillStyle = '#55595b';
    ctx.fillRect(over, rail, 2, height - rail * 2);
    ctx.fillRect(width - over - 2, rail, 2, height - rail * 2);
    // Damp, darker planks along the railings and a little moss in the corners.
    const edge = ctx.createLinearGradient(0, rail, 0, height - rail);
    edge.addColorStop(0, 'rgba(24,20,14,0.30)');
    edge.addColorStop(0.18, 'rgba(24,20,14,0)');
    edge.addColorStop(0.82, 'rgba(24,20,14,0)');
    edge.addColorStop(1, 'rgba(24,20,14,0.30)');
    ctx.fillStyle = edge;
    ctx.fillRect(over, rail, width - over * 2, height - rail * 2);
    for (let i = 0; i < spanCells * 3; i++) {
      ctx.fillStyle = `rgba(82,96,58,${0.16 + rng() * 0.2})`;
      const y = rng() < 0.5 ? rail + 4 + rng() * 4 : height - rail - 8 + rng() * 4;
      ctx.fillRect(over + rng() * (width - over * 2), y, 1 + rng() * 3, 1 + rng() * 2);
    }
    drawRailing(ctx, over - 2, width - over + 2, 0, rng);
    drawRailing(ctx, over - 2, width - over + 2, height - 5, rng);
  });
}

/** Collapsed bridge: broken stubs on both abutments and splintered piles standing in the river. */
export function ensureBridgeRuinTexture(textures: Phaser.Textures.TextureManager, key: string,
  spanCells: number, deckWidthCells: number, seedText: string): void {
  const { width, height } = bridgeTextureSize(spanCells, deckWidthCells);
  ensureCanvasTexture(textures, key, width, height, (ctx) => {
    const rng = seededRandom(`${seedText}:ruin`);
    const over = BRIDGE_ABUTMENT_OVERHANG_PX, rail = BRIDGE_RAIL_OVERHANG_PX;
    drawAbutment(ctx, 0, over + 4, height, rng);
    drawAbutment(ctx, width - over - 4, over + 4, height, rng);
    // Splintered plank stubs reaching out over the water from each bank.
    for (const side of [0, 1] as const) {
      for (let y = rail + 1; y < height - rail - 1;) {
        const plankHeight = 5 + Math.floor(rng() * 3);
        const reach = 3 + Math.floor(rng() * 11);
        const x = side === 0 ? over : width - over - reach;
        const base = shade(WOOD[Math.floor(rng() * WOOD.length)]!, 0.62 + rng() * 0.18);
        ctx.fillStyle = base;
        ctx.beginPath();
        if (side === 0) {
          ctx.moveTo(x, y); ctx.lineTo(x + reach, y + rng() * 2);
          ctx.lineTo(x + reach - 2 - rng() * 3, y + plankHeight / 2); ctx.lineTo(x + reach * (0.5 + rng() * 0.5), y + plankHeight - 1);
          ctx.lineTo(x, y + plankHeight - 1);
        } else {
          ctx.moveTo(x + reach, y); ctx.lineTo(x, y + rng() * 2);
          ctx.lineTo(x + 2 + rng() * 3, y + plankHeight / 2); ctx.lineTo(x + reach * (0.5 - rng() * 0.5), y + plankHeight - 1);
          ctx.lineTo(x + reach, y + plankHeight - 1);
        }
        ctx.closePath();
        ctx.fill();
        // Charred tips from the blast.
        ctx.fillStyle = 'rgba(22,16,12,0.55)';
        ctx.fillRect(side === 0 ? x + reach - 3 : x, y, 3, plankHeight - 1);
        y += plankHeight;
      }
    }
    // Broken piles in the riverbed, wet and dark.
    const piles = Math.max(2, spanCells - 1);
    for (let i = 1; i <= piles; i++) {
      const px = over + ((width - over * 2) * i) / (piles + 1) + (rng() - 0.5) * 6;
      for (const py of [rail + 6 + rng() * 3, height - rail - 9 - rng() * 3]) {
        ctx.fillStyle = '#2b231b';
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(176,150,112,0.38)';
        ctx.fillRect(px - 2, py - 1, 3, 1);
        ctx.fillStyle = 'rgba(210,230,236,0.18)';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(210,230,236,0.18)';
        ctx.stroke();
      }
    }
    // A few drifting planks caught on the piles.
    for (let i = 0; i < spanCells; i++) {
      ctx.save();
      ctx.translate(over + rng() * (width - over * 2), rail + 6 + rng() * (height - rail * 2 - 12));
      ctx.rotate((rng() - 0.5) * 1.4);
      ctx.fillStyle = shade(WOOD[Math.floor(rng() * WOOD.length)]!, 0.58);
      ctx.fillRect(-9, -2, 18, 4);
      ctx.fillStyle = 'rgba(210,230,236,0.14)';
      ctx.fillRect(-9, 2, 18, 1);
      ctx.restore();
    }
  });
}
