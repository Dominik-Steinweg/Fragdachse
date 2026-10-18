import type * as Phaser from 'phaser';
import { DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import { configureGpuLayerCameraTransform } from '../../graphics/GpuLayerCameraTransform';
import { registerGraphicsObject } from '../EffectUtils';
import type { EcologyPlacement } from '../../arena/WoodlandEcologyField';
import { floatingMotion } from '../../arena/FloatingBob';
import type { EcologyColony } from '../../arena/rocks/RockEcologyField';
import { ensureVoidEmissiveDraftTexture, ensureVoidSporeTexture } from '../../arena/VoidFloraDraftTextures';
import { VOID_LILY_EMISSIVE_ATLAS, VOID_ROCK_EMISSIVE_ATLAS } from '../../arena/VoidFloraAssets';

/** Self-lit veins and spores sit just above the light map and below canopies (band E). */
const EMISSION_DEPTH = DEPTH_LIGHTING + .06;
const VEIN_TINT = VOID_PALETTE.bright;
const SPORE_TINTS = [VOID_PALETTE.bright, VOID_PALETTE.bright, VOID_PALETTE.primary] as const;
const TIME_WRAP_MS = 3_600_000;
/** Spores per colony: lily colonies drift over open water, moss sheds fewer, closer motes. */
const POND_SPORES = 3;
const ROCK_SPORES = 1;
const MAX_SPORES = 1400;

type Member = Phaser.Types.GameObjects.SpriteGPULayer.Member;
const hash = (x: number, y: number, salt: number): number => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
};
const smoothAmount = (amount: number | undefined): number => {
  const t = Math.max(0, Math.min(1, ((amount ?? 1) - .4) / .5));
  return t * t * (3 - 2 * t);
};
const pulse = (base: number, amplitude: number, periodMs: number, phase: number): Member['alpha'] =>
  ({ base, amplitude, ease: 'Sine.easeInOut', duration: periodMs / 2, delay: phase * periodMs, yoyo: true, loop: true });

/**
 * The night signature of void-taken flora (GDD Nachtsicht N-6, user 2026-10-18: "Adern und
 * Partikel"): fine self-lit veins on the plant and a few spores hovering over it. Both are static
 * GPU members animated by looping yoyo eases only, so a frame costs no per-member CPU work.
 * The light map already lights the surroundings (VoidFloraGlow); this layer is the plant itself.
 * Visible from dusk, fully at night; owned by the World's sunlight presentation.
 */
export class VoidFloraEmission {
  private readonly layers: Phaser.GameObjects.SpriteGPULayer[] = [];
  private pondLayer: Phaser.GameObjects.SpriteGPULayer | null = null;
  private rockLayers = new Map<string, Phaser.GameObjects.SpriteGPULayer>();
  private sporeLayer: Phaser.GameObjects.SpriteGPULayer | null = null;
  private pondPlacements: readonly EcologyPlacement[] = [];
  /** Plants showing void art: only they carry real veins. */
  private pondArt: readonly EcologyPlacement[] = [];
  private rockSignature = '';
  private rockColonies: readonly EcologyColony[] = [];
  /** Spore points over the World's land creep (x, y, creep triples). */
  private groundSpores: readonly number[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** Lily placements of the current woodland layout; only void colonies are kept. */
  setPondPlacements(placements: readonly EcologyPlacement[]): void {
    this.pondPlacements = placements.filter(p => p.kind === 'pond' && p.void);
    this.pondArt = this.pondPlacements.filter(p => p.voidFrame);
    this.rebuildPond();
    this.rebuildSpores();
  }

  /** Land spores over the World's void creep; set once per World with the creep field. */
  setGroundSpores(points: readonly number[]): void {
    this.groundSpores = points.slice();
    this.rebuildSpores();
  }

  /** Standing void rock colonies; rebuilt only when the set changes (takeover, destruction). */
  setRockColonies(colonies: readonly EcologyColony[]): void {
    let signature = `${colonies.length}`;
    for (const c of colonies) signature += `|${c.anchorKey}`;
    if (signature === this.rockSignature) return;
    this.rockSignature = signature;
    this.rockColonies = colonies.slice();
    this.rebuildRocks();
    this.rebuildSpores();
  }

  /** `night` 0..1 from dusk to night; `waterTimeSec` keeps veins on their bobbing lilies. */
  update(night: number, waterTimeSec: number): void {
    const alpha = Math.max(0, Math.min(1, night));
    const timeMs = ((waterTimeSec * 1000) % TIME_WRAP_MS + TIME_WRAP_MS) % TIME_WRAP_MS;
    for (const layer of this.layers) {
      // All members animate on the pausable presentation clock, like the floating lilies below them.
      layer.setVisible(alpha > .01 && layer.memberCount > 0).setAlpha(alpha);
      if (layer.visible) layer.resetTimer(timeMs);
    }
  }

  private createLayer(texture: string, size: number, name: string): Phaser.GameObjects.SpriteGPULayer {
    const layer = this.scene.add.spriteGPULayer(this.scene.textures.get(texture), Math.max(1, size))
      .setDepth(EMISSION_DEPTH).setBlendMode(1 /* Phaser.BlendModes.ADD */).setVisible(false).setName(name);
    configureGpuLayerCameraTransform(layer);
    layer.setTimerPaused(true);
    registerGraphicsObject(this.scene, 'woodlandEcology', layer);
    this.layers.push(layer);
    return layer;
  }

  private dropLayer(layer: Phaser.GameObjects.SpriteGPULayer | null): void {
    if (!layer) return;
    const index = this.layers.indexOf(layer);
    if (index >= 0) this.layers.splice(index, 1);
    layer.destroy();
  }

  private rebuildPond(): void {
    this.dropLayer(this.pondLayer); this.pondLayer = null;
    if (!this.pondArt.length || !this.scene.textures.exists(VOID_LILY_EMISSIVE_ATLAS.key)) return;
    const layer = this.pondLayer = this.createLayer(VOID_LILY_EMISSIVE_ATLAS.key, this.pondArt.length, 'void-flora-veins-pond');
    const frames = layer.texture;
    for (const p of this.pondArt) {
      const frame = frames.get(p.voidFrame!);
      const breath = 4200 + hash(p.x, p.y, 3) * 2600;
      layer.addMember({ ...floatingMotion(p), frame: p.voidFrame!, scaleX: p.size / frame.realWidth, scaleY: p.size / frame.realHeight,
        tintBlend: 1, tintTopLeft: VEIN_TINT, tintTopRight: VEIN_TINT, tintBottomLeft: VEIN_TINT, tintBottomRight: VEIN_TINT,
        alpha: pulse(.28 * (p.voidAmount ?? 1), .22 * (p.voidAmount ?? 1), breath, hash(p.x, p.y, 5)), creationTime: 0 });
    }
  }

  private rebuildRocks(): void {
    for (const layer of this.rockLayers.values()) this.dropLayer(layer);
    this.rockLayers.clear();
    // Approved art carries its own congruent mask; recoloured copies derive draft veins.
    const groups = new Map<string, EcologyColony[]>();
    for (const colony of this.rockColonies) {
      const key = colony.voidArt ? VOID_ROCK_EMISSIVE_ATLAS.key
        : ensureVoidEmissiveDraftTexture(this.scene.textures, colony.naturalTextureKey ?? colony.textureKey);
      if (!key || !this.scene.textures.exists(key)) continue;
      let group = groups.get(key); if (!group) groups.set(key, group = []);
      group.push(colony);
    }
    for (const [key, colonies] of groups) {
      const layer = this.createLayer(key, colonies.length, 'void-flora-veins-rock');
      this.rockLayers.set(key, layer);
      for (const c of colonies) {
        const frame = layer.texture.get(c.frame!);
        const scaleX = c.lengthPx / frame.realWidth, breath = 5200 + hash(c.worldX, c.worldY, 7) * 3400;
        layer.addMember({ frame: c.frame, x: c.worldX, y: c.worldY, rotation: c.rotation,
          scaleX: c.mirrorX ? -scaleX : scaleX, scaleY: c.bandPx / frame.realHeight,
          tintBlend: 1, tintTopLeft: VEIN_TINT, tintTopRight: VEIN_TINT, tintBottomLeft: VEIN_TINT, tintBottomRight: VEIN_TINT,
          alpha: pulse(.24 * (c.voidAmount ?? 1), .2 * (c.voidAmount ?? 1), breath, hash(c.worldX, c.worldY, 9)), creationTime: 0 });
      }
    }
  }

  private rebuildSpores(): void {
    this.dropLayer(this.sporeLayer); this.sporeLayer = null;
    const anchors: { x: number; y: number; spread: number; count: number }[] = [];
    // Spores only where the takeover is established; partly infested rims stay quiet.
    const colonies = new Map<number, EcologyPlacement>();
    for (const p of this.pondPlacements) if (p.colony !== undefined && !colonies.has(p.colony)) colonies.set(p.colony, p);
    for (const p of colonies.values()) {
      const count = Math.round(POND_SPORES * smoothAmount(p.voidAmount));
      if (count > 0) anchors.push({ x: p.x, y: p.y, spread: 46, count });
    }
    const rockAnchors = new Map<number, EcologyColony>();
    for (const c of this.rockColonies) if (!rockAnchors.has(c.anchorKey)) rockAnchors.set(c.anchorKey, c);
    for (const c of rockAnchors.values()) {
      const count = Math.round(ROCK_SPORES * smoothAmount(c.voidAmount));
      if (count > 0) anchors.push({ x: c.worldX, y: c.worldY, spread: 22, count });
    }
    // Over the land creep fine motes hang low in small loose swarms.
    for (let i = 0; i + 2 < this.groundSpores.length; i += 3) {
      if (smoothAmount(this.groundSpores[i + 2]) > 0) anchors.push({ x: this.groundSpores[i], y: this.groundSpores[i + 1], spread: 26, count: 3 });
    }
    if (!anchors.length) return;
    const key = ensureVoidSporeTexture(this.scene.textures);
    if (!key) return;
    const total = Math.min(MAX_SPORES, anchors.reduce((sum, a) => sum + a.count, 0));
    const layer = this.sporeLayer = this.createLayer(key, total, 'void-flora-spores');
    let written = 0;
    for (const a of anchors) for (let i = 0; i < a.count && written < MAX_SPORES; i++, written++) {
      const h = (salt: number): number => hash(a.x, a.y, i * 13 + salt);
      const angle = h(1) * Math.PI * 2, radius = a.spread * Math.sqrt(h(2));
      const x = a.x + Math.cos(angle) * radius, y = a.y + Math.sin(angle) * radius;
      // Slow hovering drift: each axis is its own looping sine, never a straight path.
      const driftX = 5 + h(3) * 10, driftY = 8 + h(4) * 14, periodX = 5200 + h(5) * 5200, periodY = 4300 + h(6) * 4700;
      const tint = SPORE_TINTS[Math.floor(h(7) * SPORE_TINTS.length)];
      // Fine motes, a few pixels across: dust in the air, not bubbles.
      const size = (3 + h(8) * 3) / 32;
      layer.addMember({ frame: '__BASE',
        x: { base: x - driftX, amplitude: driftX * 2, ease: 'Sine.easeInOut', duration: periodX / 2, delay: h(9) * periodX, yoyo: true, loop: true },
        y: { base: y - driftY, amplitude: driftY * 2, ease: 'Sine.easeInOut', duration: periodY / 2, delay: h(10) * periodY, yoyo: true, loop: true },
        scaleX: size, scaleY: size,
        tintBlend: 1, tintTopLeft: tint, tintTopRight: tint, tintBottomLeft: tint, tintBottomRight: tint,
        // Slow, gentle breathing; a mote never blinks out.
        alpha: pulse(.12, .26, 7000 + h(11) * 6000, h(12)), creationTime: 0 });
    }
  }

  destroy(): void {
    for (const layer of this.layers) layer.destroy();
    this.layers.length = 0;
    this.pondLayer = null; this.sporeLayer = null; this.rockLayers.clear();
  }
}
