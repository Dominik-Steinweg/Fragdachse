import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import { ensureExplosionSmokeTexture, TEX_EXPLOSION_SMOKE } from '../gpu/GpuVfxSourceTextures';

/** The skeleton frame breaks into GRID x GRID pieces that fly apart; smaller splinters and dust follow. */
const GRID = 5;
const SPLINTERS = 22;
const DUST = 12;
const VOID_PUFFS = 3;
const MAX_BURSTS = 3;
const DUST_TINT = 0x5c5248;

type PieceKind = 'slab' | 'splinter' | 'dust' | 'void';

export interface BoneBurstPiece {
  readonly kind: PieceKind;
  /** Frame cell (slabs and splinters) of the skeleton frame. */
  readonly cellX: number;
  readonly cellY: number;
  readonly x: number;
  readonly y: number;
  /** Total travel over the life, px; eased out like a thrown piece losing speed. */
  readonly dx: number;
  readonly dy: number;
  readonly spin: number;
  readonly size: number;
  /** Peak extra scale of the arc: the piece rises toward the camera and falls back. */
  readonly lift: number;
  readonly delayMs: number;
  readonly lifeMs: number;
}

function hash(seed: string): number {
  let h = 2166136261;
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

function random(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822519) ^ Math.imul(state ^ (state >>> 13), 3266489917);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Plan of one bone burst around the nest centre (x, y): the skeleton frame (`frameSize` px) splits
 * into slabs that are thrown outward from the nest, splinters fly farther and faster, bone dust
 * rises and settles, and the void escapes the nest in a dark violet puff. Deterministic per seed.
 */
export function buildBoneBurstPlan(x: number, y: number, frameSize: number, seed: string): readonly BoneBurstPiece[] {
  const rnd = random(hash(seed));
  const cell = frameSize / GRID;
  const pieces: BoneBurstPiece[] = [];
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      const ox = (cx - (GRID - 1) / 2) * cell, oy = (cy - (GRID - 1) / 2) * cell;
      const dist = Math.hypot(ox, oy) || 1;
      const reach = cell * (0.9 + 1.4 * rnd()) * (0.6 + dist / frameSize);
      const angle = Math.atan2(oy, ox) + (rnd() - 0.5) * 0.7;
      pieces.push({ kind: 'slab', cellX: cx, cellY: cy, x: x + ox, y: y + oy,
        dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach, spin: (rnd() - 0.5) * 5, size: cell,
        lift: 0.25 + 0.3 * rnd(), delayMs: dist / frameSize * 120, lifeMs: 1150 + 450 * rnd() });
    }
  }
  for (let i = 0; i < SPLINTERS; i++) {
    const angle = rnd() * Math.PI * 2, from = cell * 1.6 * rnd();
    const reach = frameSize * (0.45 + 0.5 * rnd());
    pieces.push({ kind: 'splinter', cellX: Math.floor(rnd() * GRID), cellY: Math.floor(rnd() * GRID),
      x: x + Math.cos(angle) * from, y: y + Math.sin(angle) * from, dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach,
      spin: (rnd() - 0.5) * 14, size: cell * (0.28 + 0.22 * rnd()), lift: 0.5 + 0.5 * rnd(), delayMs: 30 * rnd(), lifeMs: 800 + 500 * rnd() });
  }
  for (let i = 0; i < DUST; i++) {
    const angle = rnd() * Math.PI * 2, from = frameSize * 0.32 * Math.sqrt(rnd());
    pieces.push({ kind: 'dust', cellX: 0, cellY: 0, x: x + Math.cos(angle) * from, y: y + Math.sin(angle) * from,
      dx: Math.cos(angle) * cell * 0.8, dy: Math.sin(angle) * cell * 0.8, spin: (rnd() - 0.5) * 0.6,
      size: cell * (1.4 + 1.2 * rnd()), lift: 1.4, delayMs: 60 + 260 * rnd(), lifeMs: 1600 + 900 * rnd() });
  }
  for (let i = 0; i < VOID_PUFFS; i++) {
    pieces.push({ kind: 'void', cellX: 0, cellY: 0, x: x + (rnd() - 0.5) * cell, y: y + (rnd() - 0.5) * cell,
      dx: 0, dy: 0, spin: (rnd() - 0.5) * 0.8, size: cell * (1.8 + 0.8 * i), lift: 1.6, delayMs: i * 90, lifeMs: 700 + 250 * i });
  }
  return pieces;
}

interface PieceSlot { readonly image: Phaser.GameObjects.Image; plan: BoneBurstPiece | null }
interface BurstSlot { ageMs: number; active: boolean; readonly pieces: PieceSlot[] }

/**
 * The spawn structure's destruction (GDD Spawnbauwerk V1): the carcass bursts into flying bone
 * slabs and splinters, bone dust and a dark violet void puff. Owned by SpawnStructureRenderer;
 * drives itself from postupdate with a fixed image pool, no timers or tweens. Every piece ends
 * transparent, so nothing pops.
 */
export class SpawnStructureBoneBurst {
  private readonly slots: BurstSlot[] = [];
  private readonly pieceCount: number;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    ensureExplosionSmokeTexture(scene);
    this.pieceCount = buildBoneBurstPlan(0, 0, 1, 'size').length;
    for (let i = 0; i < MAX_BURSTS; i++) {
      const pieces: PieceSlot[] = [];
      for (let j = 0; j < this.pieceCount; j++) {
        pieces.push({ image: scene.add.image(0, 0, TEX_EXPLOSION_SMOKE).setVisible(false).setActive(false)
          .setDepth(DEPTH.BASES + 0.05), plan: null });
      }
      this.slots.push({ ageMs: 0, active: false, pieces });
    }
    scene.events.on('postupdate', this.update, this);
  }

  /** Burst the skeleton frame `frame` of the sheet `textureKey`, drawn `displaySize` px wide at (x, y). */
  play(x: number, y: number, textureKey: string, frame: number, displaySize: number, seed: string): boolean {
    if (this.destroyed || !this.scene.textures.exists(textureKey)) return false;
    const slot = this.slots.find((candidate) => !candidate.active);
    if (!slot) return false;
    const plan = buildBoneBurstPlan(x, y, displaySize, seed);
    this.ensureCells(textureKey, frame);
    slot.ageMs = 0;
    slot.active = true;
    plan.forEach((p, i) => {
      const piece = slot.pieces[i];
      piece.plan = p;
      const image = piece.image.setVisible(false).setAlpha(0).setRotation(0).clearTint();
      if (p.kind === 'slab' || p.kind === 'splinter') {
        image.setTexture(textureKey, `${frame}:${p.cellX}:${p.cellY}`).setBlendMode(Phaser.BlendModes.NORMAL).setDepth(DEPTH.BASES + 0.05);
      } else if (p.kind === 'dust') {
        image.setTexture(TEX_EXPLOSION_SMOKE).setTint(DUST_TINT).setBlendMode(Phaser.BlendModes.NORMAL).setDepth(DEPTH.BASES + 0.12);
      } else {
        image.setTexture(TEX_EXPLOSION_SMOKE).setTint(VOID_PALETTE.deep).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_LIGHTING + 0.08);
      }
      image.setDisplaySize(p.size, p.size).setPosition(p.x, p.y);
    });
    return true;
  }

  /** Frame cells of one skeleton frame as sub-frames of its sheet, created once. */
  private ensureCells(textureKey: string, frame: number): void {
    const texture = this.scene.textures.get(textureKey);
    if (texture.has(`${frame}:0:0`)) return;
    const base = texture.get(frame);
    const w = base.cutWidth / GRID, h = base.cutHeight / GRID;
    for (let cy = 0; cy < GRID; cy++) {
      for (let cx = 0; cx < GRID; cx++) {
        texture.add(`${frame}:${cx}:${cy}`, base.sourceIndex, base.cutX + cx * w, base.cutY + cy * h, w, h);
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      for (const piece of slot.pieces) { piece.plan = null; piece.image.setVisible(false); }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('postupdate', this.update, this);
    for (const slot of this.slots) for (const piece of slot.pieces) piece.image.destroy();
    this.slots.length = 0;
  }

  private update(_time: number, delta: number): void {
    if (this.destroyed || !Number.isFinite(delta)) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.ageMs += Math.max(0, delta);
      let alive = false;
      for (const piece of slot.pieces) {
        const p = piece.plan;
        if (!p) continue;
        const age = slot.ageMs - p.delayMs;
        if (age >= p.lifeMs) { piece.image.setVisible(false); piece.plan = null; continue; }
        alive = true;
        if (age < 0) continue;
        const t = age / p.lifeMs;
        const travel = 1 - (1 - t) * (1 - t);
        const arc = Math.sin(Math.PI * Math.min(1, t * 1.15));
        let scale = 1, alpha = 1;
        if (p.kind === 'slab' || p.kind === 'splinter') {
          scale = 1 + p.lift * arc;
          alpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        } else if (p.kind === 'dust') {
          scale = 0.6 + p.lift * travel;
          alpha = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t);
        } else {
          scale = 0.7 + p.lift * travel;
          alpha = 0.85 * (1 - t) * (1 - t);
        }
        piece.image.setVisible(true).setAlpha(Math.max(0, alpha))
          .setPosition(p.x + p.dx * travel, p.y + p.dy * travel).setRotation(p.spin * travel)
          .setDisplaySize(p.size * scale, p.size * scale);
      }
      if (!alive) slot.active = false;
    }
  }
}
