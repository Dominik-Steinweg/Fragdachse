import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import { ensureCanvasTexture } from '../EffectUtils';

/** Stone abutment band drawn onto the bank at both deck ends, in px. */
export const BRIDGE_ABUTMENT_OVERHANG_PX = 10;
/** Railing beams overhang the deck edges slightly, in px. */
export const BRIDGE_RAIL_OVERHANG_PX = 3;
/** Soft contact shadow margin around the deck, in px. */
export const BRIDGE_SHADOW_MARGIN_PX = 10;

/** Weathered board and masonry albedo at game scale (see tools/source-art/bridge-*). */
export const BRIDGE_WOOD_TEXTURE_KEY = 'bridge-wood';
export const BRIDGE_STONE_TEXTURE_KEY = 'bridge-stone';

export function preloadBridgeAssets(loader: Phaser.Loader.LoaderPlugin): void {
  loader.image(BRIDGE_WOOD_TEXTURE_KEY, './assets/sprites/bridge_wood.png');
  loader.image(BRIDGE_STONE_TEXTURE_KEY, './assets/sprites/bridge_stone.png');
}

/** Material sources sampled into bridge canvases; absent sources fall back to flat drawing. */
export interface BridgeMaterials {
  readonly wood: CanvasImageSource | null;
  readonly stone: CanvasImageSource | null;
}

export function resolveBridgeMaterials(textures: Phaser.Textures.TextureManager): BridgeMaterials {
  const source = (key: string) => (textures.exists(key) ? textures.get(key).getSourceImage() as CanvasImageSource : null);
  return { wood: source(BRIDGE_WOOD_TEXTURE_KEY), stone: source(BRIDGE_STONE_TEXTURE_KEY) };
}

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

const MATERIAL_SIZE = 256;
const WOOD_FALLBACK = ['#6e5a45', '#75604a', '#665341', '#7c674f', '#6a5846', '#5f4e3d'];

/** Board strip with the grain running along `h` (planks lie across the travel direction). */
function woodStrip(ctx: CanvasRenderingContext2D, m: BridgeMaterials, rng: () => number,
  x: number, y: number, w: number, h: number, shade: number): void {
  if (m.wood) {
    const sx = Math.floor(rng() * (MATERIAL_SIZE - w)), sy = Math.floor(rng() * Math.max(1, MATERIAL_SIZE - h));
    ctx.drawImage(m.wood, sx, sy, w, Math.min(h, MATERIAL_SIZE), x, y, w, h);
  } else {
    ctx.fillStyle = WOOD_FALLBACK[Math.floor(rng() * WOOD_FALLBACK.length)]!;
    ctx.fillRect(x, y, w, h);
  }
  // Per-board value variation: darker and lighter boards, never a flat repeat.
  ctx.fillStyle = shade < 0 ? `rgba(20,14,8,${-shade})` : `rgba(255,240,215,${shade})`;
  ctx.fillRect(x, y, w, h);
}

/** Beam lying along the travel direction (railings): the grain turns with it. */
function woodBeam(ctx: CanvasRenderingContext2D, m: BridgeMaterials, rng: () => number,
  x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(x, y + h);
  ctx.rotate(-Math.PI / 2);
  woodStrip(ctx, m, rng, 0, 0, h, w, -0.28);
  ctx.restore();
}

function drawAbutment(ctx: CanvasRenderingContext2D, m: BridgeMaterials, rng: () => number,
  x0: number, width: number, height: number): void {
  if (m.stone) {
    ctx.drawImage(m.stone, Math.floor(rng() * (MATERIAL_SIZE - width)), Math.floor(rng() * (MATERIAL_SIZE - height)),
      width, height, x0, 0, width, height);
    ctx.fillStyle = 'rgba(70,58,40,0.18)';
    ctx.fillRect(x0, 0, width, height);
  } else {
    ctx.fillStyle = '#6c6860';
    ctx.fillRect(x0, 0, width, height);
  }
  // Moss creeps up from the waterline into the joints.
  for (let i = 0; i < height / 2.5; i++) {
    ctx.fillStyle = `rgba(74,90,50,${0.2 + rng() * 0.25})`;
    ctx.fillRect(x0 + rng() * width, rng() * height, 1 + rng() * 2, 1 + rng() * 2);
  }
}

function drawRailing(ctx: CanvasRenderingContext2D, m: BridgeMaterials, rng: () => number, x0: number, x1: number, y: number): void {
  woodBeam(ctx, m, rng, x0, y, x1 - x0, 5);
  ctx.fillStyle = 'rgba(255,236,200,0.16)';
  ctx.fillRect(x0, y, x1 - x0, 1);
  ctx.fillStyle = 'rgba(20,14,8,0.45)';
  ctx.fillRect(x0, y + 4, x1 - x0, 1);
  for (let x = x0 + 2; x < x1 - 4; x += 26 + Math.floor(rng() * 6)) {
    ctx.fillStyle = '#3a2d21';
    ctx.fillRect(x, y - 1, 7, 7);
    ctx.fillStyle = 'rgba(255,230,190,0.12)';
    ctx.fillRect(x, y - 1, 7, 1);
    // Rusted iron angle bracket on each post.
    ctx.fillStyle = '#5d5f5c';
    ctx.fillRect(x, y - 1, 7, 2);
    ctx.fillRect(x, y - 1, 2, 7);
    ctx.fillStyle = 'rgba(122,74,40,0.45)';
    ctx.fillRect(x + 1, y + 1, 1, 3);
    ctx.fillStyle = '#2b2d2e';
    ctx.fillRect(x + 4, y + 2, 1, 1);
  }
}

/** Standing deck: weathered boards between masonry abutments, railings along both edges. */
export function ensureBridgeDeckTexture(textures: Phaser.Textures.TextureManager, key: string,
  spanCells: number, deckWidthCells: number, seedText: string, materials: BridgeMaterials): void {
  const { width, height } = bridgeTextureSize(spanCells, deckWidthCells);
  ensureCanvasTexture(textures, key, width, height, (ctx) => {
    const rng = seededRandom(seedText);
    const over = BRIDGE_ABUTMENT_OVERHANG_PX, rail = BRIDGE_RAIL_OVERHANG_PX;
    drawAbutment(ctx, materials, rng, 0, over + 4, height);
    drawAbutment(ctx, materials, rng, width - over - 4, over + 4, height);
    ctx.fillStyle = '#1d1711';
    ctx.fillRect(over, rail, width - over * 2, height - rail * 2);
    const boardTop = rail + 1, boardHeight = height - rail * 2 - 2;
    for (let x = over; x < width - over;) {
      const board = Math.min(width - over - x, 5 + Math.floor(rng() * 3));
      // Occasional repaired board: a slightly offset, fresher plank.
      const repaired = rng() < 0.06;
      woodStrip(ctx, materials, rng, x, boardTop + (repaired ? 1 : 0), board - 1, boardHeight - (repaired ? 2 : 0),
        repaired ? 0.08 : (rng() - 0.55) * 0.34);
      ctx.fillStyle = 'rgba(255,240,210,0.10)';
      ctx.fillRect(x, boardTop, 1, boardHeight);
      // Iron nails where the board rests on the outer stringers.
      ctx.fillStyle = '#2f3133';
      for (const fy of [0.15, 0.85]) ctx.fillRect(x + Math.floor(board / 2) - 1, boardTop + Math.floor(boardHeight * fy), 2, 2);
      x += board;
    }
    // Worn walking track down the middle, damp boards along the railings.
    const track = ctx.createLinearGradient(0, rail, 0, height - rail);
    track.addColorStop(0, 'rgba(18,14,8,0.38)');
    track.addColorStop(0.2, 'rgba(18,14,8,0)');
    track.addColorStop(0.42, 'rgba(230,214,180,0.07)');
    track.addColorStop(0.58, 'rgba(230,214,180,0.07)');
    track.addColorStop(0.8, 'rgba(18,14,8,0)');
    track.addColorStop(1, 'rgba(18,14,8,0.38)');
    ctx.fillStyle = track;
    ctx.fillRect(over, rail, width - over * 2, height - rail * 2);
    // Iron straps tie the deck to both abutments.
    ctx.fillStyle = '#4c4f50';
    ctx.fillRect(over, rail, 2, height - rail * 2);
    ctx.fillRect(width - over - 2, rail, 2, height - rail * 2);
    ctx.fillStyle = 'rgba(122,74,40,0.35)';
    ctx.fillRect(over, rail + 4, 1, height - rail * 2 - 8);
    for (let i = 0; i < spanCells * 4; i++) {
      ctx.fillStyle = `rgba(78,94,54,${0.18 + rng() * 0.22})`;
      const y = rng() < 0.5 ? rail + 4 + rng() * 5 : height - rail - 9 + rng() * 5;
      ctx.fillRect(over + rng() * (width - over * 2), y, 1 + rng() * 3, 1 + rng() * 2);
    }
    drawRailing(ctx, materials, rng, over - 2, width - over + 2, 0);
    drawRailing(ctx, materials, rng, over - 2, width - over + 2, height - 5);
  });
}

/** Soft contact shadow the deck throws onto the water around it. */
export function ensureBridgeShadowTexture(textures: Phaser.Textures.TextureManager, key: string,
  spanCells: number, deckWidthCells: number): void {
  const { width, height } = bridgeTextureSize(spanCells, deckWidthCells);
  const margin = BRIDGE_SHADOW_MARGIN_PX;
  ensureCanvasTexture(textures, key, width + margin * 2, height + margin * 2, (ctx) => {
    ctx.filter = 'blur(5px)';
    ctx.fillStyle = 'rgba(6,10,12,0.85)';
    ctx.fillRect(margin + BRIDGE_ABUTMENT_OVERHANG_PX, margin - 1, width - BRIDGE_ABUTMENT_OVERHANG_PX * 2, height + 2);
    ctx.filter = 'none';
  });
}

/** Collapsed bridge: charred stubs on both abutments, boards hanging into the river, wrecked piles. */
export function ensureBridgeRuinTexture(textures: Phaser.Textures.TextureManager, key: string,
  spanCells: number, deckWidthCells: number, seedText: string, materials: BridgeMaterials): void {
  const { width, height } = bridgeTextureSize(spanCells, deckWidthCells);
  ensureCanvasTexture(textures, key, width, height, (ctx) => {
    const rng = seededRandom(`${seedText}:ruin`);
    const over = BRIDGE_ABUTMENT_OVERHANG_PX, rail = BRIDGE_RAIL_OVERHANG_PX;
    // Broken piles first, so stubs and hanging boards lie over them.
    const piles = Math.max(2, spanCells - 1);
    for (let i = 1; i <= piles; i++) {
      const px = over + ((width - over * 2) * i) / (piles + 1) + (rng() - 0.5) * 6;
      for (const py of [rail + 6 + rng() * 3, height - rail - 9 - rng() * 3]) {
        ctx.strokeStyle = 'rgba(214,232,236,0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#231b14';
        ctx.beginPath(); ctx.arc(px, py, 3.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(176,150,112,0.45)';
        ctx.fillRect(px - 2, py - 1.5, 3, 1);
      }
    }
    drawAbutment(ctx, materials, rng, 0, over + 4, height);
    drawAbutment(ctx, materials, rng, width - over - 4, over + 4, height);
    // Splintered, charred board stubs reaching out over the water from each bank.
    for (const side of [0, 1] as const) {
      for (let y = rail; y < height - rail;) {
        const board = 5 + Math.floor(rng() * 3);
        const reach = 6 + Math.floor(rng() * 16);
        const x = side === 0 ? over : width - over - reach;
        ctx.save();
        ctx.beginPath();
        if (side === 0) {
          ctx.moveTo(x, y); ctx.lineTo(x + reach, y + rng() * 2); ctx.lineTo(x + reach - 2 - rng() * 4, y + board / 2);
          ctx.lineTo(x + reach * (0.45 + rng() * 0.5), y + board - 1); ctx.lineTo(x, y + board - 1);
        } else {
          ctx.moveTo(x + reach, y); ctx.lineTo(x, y + rng() * 2); ctx.lineTo(x + 2 + rng() * 4, y + board / 2);
          ctx.lineTo(x + reach * (0.55 - rng() * 0.5), y + board - 1); ctx.lineTo(x + reach, y + board - 1);
        }
        ctx.closePath();
        ctx.clip();
        ctx.save();
        ctx.translate(x, y + board);
        ctx.rotate(-Math.PI / 2);
        woodStrip(ctx, materials, rng, 0, 0, board, reach, -0.3);
        ctx.restore();
        // Soot towards the broken tips.
        const soot = ctx.createLinearGradient(side === 0 ? x : x + reach, 0, side === 0 ? x + reach : x, 0);
        soot.addColorStop(0, 'rgba(14,10,8,0)');
        soot.addColorStop(1, 'rgba(14,10,8,0.75)');
        ctx.fillStyle = soot;
        ctx.fillRect(x, y, reach, board);
        ctx.restore();
        y += board;
      }
      // Torn railing stubs on both corners of each bank.
      for (const ry of [0, height - 5]) {
        const length = 6 + rng() * 10;
        woodBeam(ctx, materials, rng, side === 0 ? over - 2 : width - over + 2 - length, ry, length, 5);
      }
    }
    // Boards hanging into the river, half submerged, and drifting debris.
    for (let i = 0; i < spanCells + 2; i++) {
      ctx.save();
      ctx.translate(over + 4 + rng() * (width - over * 2 - 8), rail + 6 + rng() * (height - rail * 2 - 12));
      ctx.rotate((rng() - 0.5) * 1.8);
      ctx.globalAlpha = 0.55 + rng() * 0.35;
      const length = 12 + rng() * 14;
      woodStrip(ctx, materials, rng, -length / 2, -2.5, length, 5, -0.35);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(214,232,236,0.20)';
      ctx.fillRect(-length / 2, 2.5, length, 1);
      ctx.restore();
    }
  });
}
