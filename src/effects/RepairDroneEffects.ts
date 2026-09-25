import * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { registerGraphicsObject } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';
import { REPAIR_DRONE_DEPTH } from './repairDroneVisuals';

interface Point { readonly x: number; readonly y: number }
export interface RepairDroneContact extends Point { readonly id: string }
type DronePose = Pick<Phaser.GameObjects.Image, 'x' | 'y' | 'rotation'>;

const COLOR = {
  backing: 0x123e36,
  mint: 0x66edb0,
  core: 0xe3fff0,
  weld: 0xffe6af,
};
// The Blender gripper tips are at (+/-0.25, +1.16) in a 3.2-unit, 32-px canvas.
const TOOL_FORWARD = 11.6;
const TOOL_SPACING = 2.5;

/** Probe ahead of the claws, including when the drone hovers above a large base. */
export function getRepairDroneWorkProbe(body: DronePose): Point {
  return { x: body.x + Math.sin(body.rotation) * 28, y: body.y - Math.cos(body.rotation) * 28 };
}

/** Shared, bounded work effect. Its caller owns the drone and authoritative repair phase. */
export class RepairDroneEffects {
  private readonly surface: Phaser.GameObjects.Graphics;
  private readonly light: Phaser.GameObjects.Graphics;
  private lighting: LightingSystem | null = null;
  private targetId: string | null = null;
  private startedAt = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly lightKey: string) {
    // The opaque mint backing retains contrast at noon and on low graphics quality;
    // additive light is separately balanced by the arena's day/night factor.
    this.surface = scene.add.graphics().setDepth(REPAIR_DRONE_DEPTH - 0.012).setVisible(false);
    this.light = scene.add.graphics().setDepth(REPAIR_DRONE_DEPTH + 0.012)
      .setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    registerGraphicsObject(scene, 'objectiveMarkers', this.surface);
    registerGraphicsObject(scene, 'objectiveMarkers', this.light);
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    if (this.lighting === lighting) return;
    this.lighting?.releaseLight(this.lightKey, { immediate: true });
    this.lighting = lighting;
  }

  update(body: DronePose, contact: RepairDroneContact | null, now: number, alpha = 1, ownerColor?: number): void {
    const base = this.surface, glow = this.light;
    base.clear().setVisible(false).setAlpha(alpha);
    glow.clear().setVisible(false).setAlpha(emissiveAlpha(alpha));
    if (alpha <= 0) { this.stopWork(); return; }
    if (ownerColor !== undefined) {
      base.setVisible(true);
      this.drawOwnerMarks(body, ownerColor);
    }
    if (!contact) { this.stopWork(); return; }
    if (contact.id !== this.targetId) {
      this.targetId = contact.id;
      this.startedAt = now;
    }
    const age = Math.max(0, now - this.startedAt);
    const envelope = 0.35 + 0.65 * Math.min(1, age / 120);
    const level = getGraphicsQualityProfile(this.scene).level;
    const detailed = level !== 'low';
    const time = age * 0.001;
    const pulse = 0.9 + 0.1 * Math.sin(time * 23);
    const dx = contact.x - body.x, dy = contact.y - body.y;
    const distance = Math.hypot(dx, dy);
    // Avoid a reversed ribbon if a drone briefly overlaps the repaired structure.
    const forward = Math.min(TOOL_FORWARD, distance * 0.55);
    const rightX = Math.cos(body.rotation), rightY = Math.sin(body.rotation);
    const toolX = body.x + Math.sin(body.rotation) * forward;
    const toolY = body.y - Math.cos(body.rotation) * forward;
    const tangentX = distance > 0.01 ? -dy / distance : rightX;
    const tangentY = distance > 0.01 ? dx / distance : rightY;
    const sweep = Math.sin(time * 5.2) * 3.5;
    const work = { x: contact.x + tangentX * sweep, y: contact.y + tangentY * sweep };
    base.setVisible(true);
    glow.setVisible(true);

    for (const side of [-1, 1]) {
      const source = { x: toolX + rightX * TOOL_SPACING * side, y: toolY + rightY * TOOL_SPACING * side };
      const bend = Math.min(5, distance * 0.09) * side;
      const control = { x: (source.x + work.x) / 2 + tangentX * bend,
        y: (source.y + work.y) / 2 + tangentY * bend };
      this.drawRibbon(source, control, work, time + side * 0.17, envelope, detailed);
      glow.fillStyle(COLOR.mint, 0.1 * envelope).fillCircle(source.x, source.y, 3.7);
      glow.fillStyle(COLOR.core, 0.8 * envelope).fillCircle(source.x, source.y, 1.25);
    }

    // A short stitched seam is gradually illuminated under the moving welding tip.
    // It reads as material being joined, rather than an impact decal or target reticle.
    for (let i = -2; i <= 2; i++) {
      const offset = i * 3;
      const x = contact.x + tangentX * offset, y = contact.y + tangentY * offset;
      const brightness = (0.25 + 0.6 * Math.max(0, 1 - Math.abs(offset - sweep) / 7)) * envelope;
      base.lineStyle(3, COLOR.backing, brightness).lineBetween(x - tangentY * 2, y + tangentX * 2,
        x + tangentY * 2, y - tangentX * 2);
      base.lineStyle(1.25, COLOR.mint, brightness).lineBetween(x - tangentY * 1.8, y + tangentX * 1.8,
        x + tangentY * 1.8, y - tangentX * 1.8);
    }
    for (let band = detailed ? 4 : 2; band >= 1; band--) {
      glow.fillStyle(COLOR.mint, envelope * pulse * 0.2 / (band * band))
        .fillCircle(work.x, work.y, band * 3.6);
    }
    base.fillStyle(COLOR.core, envelope).fillCircle(work.x, work.y, 1.7);
    glow.lineStyle(1, COLOR.weld, 0.8 * envelope)
      .lineBetween(work.x - 3, work.y, work.x + 3, work.y)
      .lineBetween(work.x, work.y - 3, work.x, work.y + 3);

    // Deterministic, short trajectories are sampled directly: no emitter, timer,
    // tween or growing particle list survives a target change or pooled hide.
    const sparks = level === 'high' ? 7 : level === 'medium' ? 3 : 0;
    for (let i = 0; i < sparks; i++) {
      const t = (time * 2.4 + i * 0.618) % 1;
      const angle = i * 2.399 + Math.sin(i * 7.1) * 0.5;
      const travel = (5 + (i % 3) * 5) * t;
      const x = work.x + Math.cos(angle) * travel, y = work.y + Math.sin(angle) * travel;
      const tail = 1 + 3 * (1 - t);
      glow.lineStyle(0.9, i % 3 === 0 ? COLOR.mint : COLOR.weld, (1 - t) ** 2 * envelope)
        .lineBetween(x - Math.cos(angle) * tail, y - Math.sin(angle) * tail, x, y);
    }

    // Small rising repair crosses are a state cue, never an invented HP amount.
    const rise = (time * 1.25) % 1;
    const healX = contact.x + 9, healY = contact.y - 7 - rise * 13;
    const healAlpha = Math.sin(rise * Math.PI) * envelope;
    base.lineStyle(3.5, COLOR.backing, healAlpha)
      .lineBetween(healX - 2.5, healY, healX + 2.5, healY)
      .lineBetween(healX, healY - 2.5, healX, healY + 2.5);
    base.lineStyle(1.7, COLOR.mint, healAlpha)
      .lineBetween(healX - 2.5, healY, healX + 2.5, healY)
      .lineBetween(healX, healY - 2.5, healX, healY + 2.5);

    this.lighting?.setLight(this.lightKey, 'electricField', work.x, work.y, {
      radiusPx: 48, color: 0xb4ffd7, intensity: 0.5 * pulse * envelope * alpha,
    });
  }

  hide(): void {
    this.surface.clear().setVisible(false);
    this.light.clear().setVisible(false);
    this.stopWork();
  }

  destroy(): void {
    this.hide();
    this.surface.destroy();
    this.light.destroy();
    this.lighting = null;
  }

  private stopWork(): void {
    this.targetId = null;
    this.lighting?.releaseLight(this.lightKey, { immediate: true });
  }

  private drawOwnerMarks(body: DronePose, color: number): void {
    // Small chassis-aligned brackets keep owner identity without a filled halo.
    const cos = Math.cos(body.rotation), sin = Math.sin(body.rotation);
    for (const side of [-1, 1]) {
      const points = [[side * 15, -3.5], [side * 17, -1.5], [side * 17, 1.5], [side * 15, 3.5]];
      const trace = () => {
        this.surface.beginPath();
        for (let i = 0; i < points.length; i++) {
          const [x, y] = points[i];
          const px = body.x + x * cos - y * sin, py = body.y + x * sin + y * cos;
          if (i === 0) this.surface.moveTo(px, py);
          else this.surface.lineTo(px, py);
        }
        this.surface.strokePath();
      };
      this.surface.lineStyle(2.8, COLOR.backing, 0.65); trace();
      this.surface.lineStyle(1.2, color, 0.9); trace();
    }
  }

  private drawRibbon(from: Point, control: Point, to: Point, time: number, alpha: number, detailed: boolean): void {
    const base = this.surface, glow = this.light;
    const segments = detailed ? 10 : 6;
    const trace = (g: Phaser.GameObjects.Graphics) => {
      g.beginPath().moveTo(from.x, from.y);
      for (let i = 1; i <= segments; i++) {
        const p = curvePoint(from, control, to, i / segments);
        g.lineTo(p.x, p.y);
      }
      g.strokePath();
    };
    base.lineStyle(2.8, COLOR.backing, 0.65 * alpha); trace(base);
    base.lineStyle(1.35, COLOR.mint, 0.85 * alpha); trace(base);
    glow.lineStyle(detailed ? 5 : 3, COLOR.mint, 0.13 * alpha); trace(glow);
    const packets = detailed ? 3 : 1;
    const speed = 95 / Math.max(24, Math.hypot(to.x - from.x, to.y - from.y));
    for (let i = 0; i < packets; i++) {
      const t = ((time * speed + i / packets) % 1 + 1) % 1;
      const head = curvePoint(from, control, to, t);
      const tail = curvePoint(from, control, to, Math.max(0, t - 0.1));
      const fade = Math.sin(t * Math.PI) * alpha;
      base.lineStyle(1.6, COLOR.core, 0.9 * fade).lineBetween(tail.x, tail.y, head.x, head.y);
      glow.lineStyle(3.8, COLOR.mint, 0.35 * fade).lineBetween(tail.x, tail.y, head.x, head.y);
    }
  }
}

function curvePoint(from: Point, control: Point, to: Point, t: number): Point {
  const s = 1 - t;
  return { x: s * s * from.x + 2 * s * t * control.x + t * t * to.x,
    y: s * s * from.y + 2 * s * t * control.y + t * t * to.y };
}
