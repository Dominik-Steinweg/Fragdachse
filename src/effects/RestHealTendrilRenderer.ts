import * as Phaser from 'phaser';
import { ALLIED_PALETTE, DEPTH, DEPTH_LIGHTING } from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { emissiveAlpha } from './EmissiveScale';
import { registerGraphicsObject } from './EffectUtils';
import type { LightingSystem } from './LightingSystem';

interface Point { readonly x: number; readonly y: number }

/** One resting healer this frame: where its tendrils leave, whom they reach and when it ticks. */
export interface RestHealChannel {
  readonly id: string;
  readonly allied: boolean;
  /** Back-cross point the tendrils leave from. */
  readonly cross: Point;
  /** Body facing (world radians), used to orient the cross glyph. */
  readonly facing: number;
  readonly targets: readonly (Point & { readonly id: string })[];
  /** Eyes of the healer for the hypnotic rings; empty without eye anchors. */
  readonly eyes: readonly Point[];
  /** Hostile rings take the eye glow colour; allied healers use the allied palette. */
  readonly eyeColor: number;
  /** Host-synchronised rest start and heal tick interval; the cross pulses on the ticks. */
  readonly restAt: number;
  readonly tickMs: number;
}

interface TendrilTrack {
  readonly key: string;
  readonly seed: number;
  /** Local presentation clock. */
  readonly bornAt: number;
  retractAt: number | null;
  from: Point;
  to: Point;
  allied: boolean;
}

/** Sickly jade-mint of the plague heal: reads as healing next to red telegraphs and violet danger. */
const HEAL = { glow: 0x3dff8f, core: 0xc8ffd6, backing: 0x0f3a24 } as const;
const ALLIED = { glow: ALLIED_PALETTE.primary, core: ALLIED_PALETTE.core, backing: ALLIED_PALETTE.shadow } as const;
const GROW_MS = 220;
const RETRACT_MS = 150;
/** One droplet travels a tendril in this long. */
const DROPLET_CYCLE_MS = 760;
const RING_CYCLE_MS = 900;
const LIGHT_RADIUS_PX = 120;
const LIGHT_COLOR = 0xc8ffd6;

/**
 * Presentation of rest heal links (Quacksalber toad): organic, wavering tendrils from the back cross
 * to each linked ally, growing when a link appears and withdrawing when it ends, with droplets
 * flowing to the target, a pulse of the cross on every heal tick and hypnotic rings in the eyes
 * while the toad channels. Observes replicated links only; the host decides who is healed.
 */
export class RestHealTendrilRenderer {
  /** Day readability: a dark, lit backing just above the bodies. */
  private readonly surface: Phaser.GameObjects.Graphics;
  /** Self-lit core above the night lightmap, below the canopy. */
  private readonly light: Phaser.GameObjects.Graphics;
  private readonly tracks = new Map<string, TendrilTrack>();
  private readonly litChannels = new Set<string>();
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.surface = scene.add.graphics().setDepth(DEPTH.PLAYERS + 0.04);
    this.light = scene.add.graphics().setDepth(DEPTH_LIGHTING + 0.07).setBlendMode(Phaser.BlendModes.ADD);
    registerGraphicsObject(scene, 'restHealTendrils', this.surface);
    registerGraphicsObject(scene, 'restHealTendrils', this.light);
  }

  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; }

  /** `now` is the synchronized host clock of the channels' timestamps. */
  draw(channels: readonly RestHealChannel[], now: number): void {
    const local = this.scene.time.now;
    const quality = getGraphicsQualityProfile(this.scene).level;
    const strands = quality === 'high' ? 2 : 1;
    const droplets = quality === 'low' ? 0 : quality === 'medium' ? 2 : 4;
    const lightLimit = quality === 'low' ? 2 : 6;
    const surface = this.surface, light = this.light;
    surface.clear(); light.clear();
    const glowAlpha = emissiveAlpha(1);

    const seen = new Set<string>();
    for (const channel of channels) {
      for (const target of channel.targets) {
        const key = `${channel.id}>${target.id}`;
        seen.add(key);
        let track = this.tracks.get(key);
        if (!track || track.retractAt !== null) {
          track = { key, seed: hashSeed(key), bornAt: local, retractAt: null, from: channel.cross, to: target, allied: channel.allied };
          this.tracks.set(key, track);
        }
        track.from = channel.cross; track.to = target; track.allied = channel.allied;
      }
    }
    for (const track of this.tracks.values()) if (!seen.has(track.key) && track.retractAt === null) track.retractAt = local;

    for (const [key, track] of this.tracks) {
      const reach = track.retractAt === null
        ? Math.min(1, (local - track.bornAt) / GROW_MS)
        : 1 - (local - track.retractAt) / RETRACT_MS;
      if (reach <= 0) { this.tracks.delete(key); continue; }
      this.drawTendril(surface, light, track, easeOut(Math.min(1, reach)), local, strands, droplets, glowAlpha);
    }

    let lights = 0;
    const lit = new Set<string>();
    for (const channel of channels) {
      const palette = channel.allied ? ALLIED : HEAL;
      const sincePulse = ((now - channel.restAt) % channel.tickMs + channel.tickMs) % channel.tickMs;
      const pulse = Math.exp(-sincePulse / 120);
      this.drawCross(surface, light, channel, palette, pulse, glowAlpha);
      const ringColor = channel.allied ? ALLIED.core : channel.eyeColor;
      for (const eye of channel.eyes) this.drawHypnoRings(light, eye, ringColor, now - channel.restAt, glowAlpha);
      if (this.lighting && lights < lightLimit && channel.targets.length) {
        lights++;
        lit.add(channel.id);
        this.lighting.setLight(lightKey(channel.id), 'arcaneField', channel.cross.x, channel.cross.y,
          { radiusPx: LIGHT_RADIUS_PX, color: channel.allied ? palette.core : LIGHT_COLOR });
      }
    }
    for (const id of this.litChannels) if (!lit.has(id)) this.lighting?.releaseLight(lightKey(id));
    this.litChannels.clear();
    for (const id of lit) this.litChannels.add(id);
  }

  clear(): void {
    this.tracks.clear();
    for (const id of this.litChannels) this.lighting?.releaseLight(lightKey(id), { immediate: true });
    this.litChannels.clear();
    this.surface.clear(); this.light.clear();
  }

  destroy(): void {
    this.clear();
    this.surface.destroy(); this.light.destroy();
  }

  private drawTendril(surface: Phaser.GameObjects.Graphics, light: Phaser.GameObjects.Graphics, track: TendrilTrack,
    reach: number, local: number, strands: number, droplets: number, glowAlpha: number): void {
    const palette = track.allied ? ALLIED : HEAL;
    const { from, to } = track;
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (length < 4) return;
    const nx = -dy / length, ny = dx / length;
    const side = track.seed & 1 ? 1 : -1;
    const segments = Math.max(6, Math.min(16, Math.round(length / 12)));
    for (let strand = 0; strand < strands; strand++) {
      const twist = strand === 0 ? 1 : -0.7;
      const phase = track.seed * 0.37 + strand * 2.1;
      const point = (t: number) => {
        // A slack arc to one side plus a slow organic wave; both pinned at the ends.
        const sag = Math.sin(Math.PI * t) * (length * 0.16 * side + Math.sin(local * 0.004 + phase + t * 5) * 5 * twist);
        return { x: from.x + dx * t + nx * sag, y: from.y + dy * t + ny * sag };
      };
      let previous = point(0);
      const last = Math.max(1, Math.round(segments * reach));
      for (let i = 1; i <= last; i++) {
        const t = Math.min(reach, i / segments), next = point(t);
        const width = (strand === 0 ? 4.2 : 2.6) * (1 - 0.45 * t);
        surface.lineStyle(width + 1.6, palette.backing, 0.45).lineBetween(previous.x, previous.y, next.x, next.y);
        light.lineStyle(width * 2.4, palette.glow, 0.16 * glowAlpha).lineBetween(previous.x, previous.y, next.x, next.y);
        light.lineStyle(Math.max(1, width * 0.55), palette.core, 0.8 * glowAlpha).lineBetween(previous.x, previous.y, next.x, next.y);
        previous = next;
      }
      if (strand === 0 && reach >= 1) {
        for (let d = 0; d < droplets; d++) {
          const t = ((local / DROPLET_CYCLE_MS) + d / droplets + (track.seed % 97) / 97) % 1;
          const p = point(t);
          light.fillStyle(palette.core, 0.85 * glowAlpha).fillCircle(p.x, p.y, 2.2 + Math.sin(Math.PI * t) * 1.2);
        }
        light.fillStyle(palette.glow, 0.22 * glowAlpha).fillCircle(to.x, to.y, 9);
        light.fillStyle(palette.core, 0.35 * glowAlpha).fillCircle(to.x, to.y, 4);
      }
    }
  }

  /** A soft plus over the back cross that swells on every heal tick. */
  private drawCross(surface: Phaser.GameObjects.Graphics, light: Phaser.GameObjects.Graphics, channel: RestHealChannel,
    palette: typeof HEAL | typeof ALLIED, pulse: number, glowAlpha: number): void {
    if (!channel.targets.length) return;
    const { x, y } = channel.cross;
    const arm = 5 + 2.5 * pulse, cos = Math.cos(channel.facing), sin = Math.sin(channel.facing);
    const stroke = (g: Phaser.GameObjects.Graphics, width: number, color: number, alpha: number) => {
      g.lineStyle(width, color, alpha);
      g.lineBetween(x - cos * arm, y - sin * arm, x + cos * arm, y + sin * arm);
      g.lineBetween(x + sin * arm, y - cos * arm, x - sin * arm, y + cos * arm);
    };
    stroke(surface, 3.4, palette.backing, 0.25 + 0.2 * pulse);
    stroke(light, 5 + 3 * pulse, palette.glow, (0.12 + 0.3 * pulse) * glowAlpha);
    stroke(light, 1.6, palette.core, (0.45 + 0.5 * pulse) * glowAlpha);
  }

  /** Concentric rings breathing out of each eye while the toad channels (a nod, not a copy). */
  private drawHypnoRings(light: Phaser.GameObjects.Graphics, eye: Point, color: number, elapsed: number, glowAlpha: number): void {
    for (let ring = 0; ring < 3; ring++) {
      const t = ((Math.max(0, elapsed) / RING_CYCLE_MS) + ring / 3) % 1;
      light.lineStyle(1.1, color, (1 - t) * 0.6 * glowAlpha).strokeCircle(eye.x, eye.y, 1.5 + t * 6.5);
    }
  }
}

function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }

function hashSeed(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function lightKey(id: string): string { return `rest-heal:${id}`; }
