import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { SyncedTurretWeb, SyncedTurretWebSnapshot, SyncedWebShot } from '../types';
import { ensureCanvasTexture, registerGraphicsObject } from './EffectUtils';

/** Authored cobweb (Gemini via argon) when it is loaded; the procedural web stands in until then. */
export const TURRET_COBWEB_TEXTURE = 'fx_turret_cobweb';
const PROCEDURAL_COBWEB_TEXTURE = '_fx_turret_cobweb_procedural';
const WEB_GLOB_TEXTURE = '_fx_web_glob';
const COBWEB_TEXTURE_SIZE = 128;
/** Net diameter over a turret in world px. */
const WEB_SIZE_PX = 54;
const WEB_IN_MS = 140;
const WEB_OUT_MS = 400;
/** Height of the glob's arc over its flight, in px at the apex. */
const GLOB_ARC_PX = 18;
/** Void-violet family: pale lilac silk over a dark violet shadow; never red or yellow. */
const SILK_COLOR = 0xeadcff;
const SHADOW_COLOR = 0x1c0b2e;
const STRAND_COLOR = 0xd9c4ff;

interface WebView { readonly shadow: Phaser.GameObjects.Image; readonly silk: Phaser.GameObjects.Image; readonly spin: number }
interface ShotView { readonly glob: Phaser.GameObjects.Image }

/**
 * Presentation of Kabummtula webs: a sticky glob flies in an arc on a silk strand to the turret,
 * then a net covers the turret until the web expires. Two layers keep it readable in daylight.
 * Pure projection of the replicated `tw` slice on the synchronised clock.
 */
export class TurretWebRenderer {
  private readonly webs = new Map<number | string, WebView>();
  private readonly shots = new Map<number, ShotView>();
  private strands: Phaser.GameObjects.Graphics | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  sync(snapshot: SyncedTurretWebSnapshot | null | undefined, now: number): void {
    const shots = snapshot?.shots ?? [], webs = snapshot?.webs ?? [];
    if (!shots.length && !webs.length && !this.shots.size && !this.webs.size) return;
    this.ensureTextures();
    this.syncShots(shots, now);
    this.syncWebs(webs, now);
  }

  clear(): void {
    for (const view of this.webs.values()) { view.shadow.destroy(); view.silk.destroy(); }
    for (const view of this.shots.values()) view.glob.destroy();
    this.webs.clear();
    this.shots.clear();
    this.strands?.clear();
  }

  destroy(): void {
    this.clear();
    this.strands?.destroy();
    this.strands = null;
  }

  private syncShots(shots: readonly SyncedWebShot[], now: number): void {
    const live = new Set<number>();
    if (!this.strands) {
      this.strands = this.scene.add.graphics().setDepth(DEPTH.PROJECTILES - 0.65);
      registerGraphicsObject(this.scene, 'turretWebs', this.strands);
    }
    this.strands.clear();
    for (const shot of shots) {
      if (now >= shot.impactAt) continue;
      live.add(shot.id);
      let view = this.shots.get(shot.id);
      if (!view) {
        view = { glob: this.scene.add.image(shot.sourceX, shot.sourceY, WEB_GLOB_TEXTURE).setDepth(DEPTH.PROJECTILES - 0.6) };
        this.shots.set(shot.id, view);
      }
      const t = Math.max(0, Math.min(1, (now - shot.launchAt) / Math.max(1, shot.impactAt - shot.launchAt)));
      const x = Phaser.Math.Linear(shot.sourceX, shot.targetX, t);
      const y = Phaser.Math.Linear(shot.sourceY, shot.targetY, t) - Math.sin(Math.PI * t) * GLOB_ARC_PX;
      view.glob.setPosition(x, y).setScale(0.55 + 0.25 * t).setRotation(t * 5);
      // The silk strand trails from the fangs to the glob, sagging slightly.
      this.strands.lineStyle(2.4, SHADOW_COLOR, 0.55);
      this.drawStrand(shot.sourceX, shot.sourceY, x, y);
      this.strands.lineStyle(1.1, STRAND_COLOR, 0.9);
      this.drawStrand(shot.sourceX, shot.sourceY, x, y);
    }
    for (const [id, view] of this.shots) if (!live.has(id)) { view.glob.destroy(); this.shots.delete(id); }
  }

  private drawStrand(ax: number, ay: number, bx: number, by: number): void {
    const mx = (ax + bx) / 2, my = (ay + by) / 2 + Math.min(10, Math.hypot(bx - ax, by - ay) * 0.06);
    const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(ax, ay), new Phaser.Math.Vector2(mx, my),
      new Phaser.Math.Vector2(bx, by));
    curve.draw(this.strands!, 12);
  }

  private syncWebs(webs: readonly SyncedTurretWeb[], now: number): void {
    const live = new Set<number | string>();
    const texture = this.scene.textures.exists(TURRET_COBWEB_TEXTURE) ? TURRET_COBWEB_TEXTURE : PROCEDURAL_COBWEB_TEXTURE;
    for (const web of webs) {
      if (now < web.appliedAt || now >= web.expiresAt) continue;
      live.add(web.turretId);
      let view = this.webs.get(web.turretId);
      if (!view) {
        const spin = spinOf(web.turretId);
        view = {
          spin,
          shadow: this.scene.add.image(web.x, web.y, texture).setDepth(DEPTH.PLAYERS - 0.31).setTint(SHADOW_COLOR),
          silk: this.scene.add.image(web.x, web.y, texture).setDepth(DEPTH.PLAYERS - 0.3).setTint(SILK_COLOR),
        };
        this.webs.set(web.turretId, view);
      }
      const fadeIn = Math.min(1, (now - web.appliedAt) / WEB_IN_MS);
      const fadeOut = Math.min(1, (web.expiresAt - now) / WEB_OUT_MS);
      // The net lands with a short overshoot (the splat), then shivers faintly while it holds.
      const scale = WEB_SIZE_PX / COBWEB_TEXTURE_SIZE * (fadeIn < 1 ? 1.25 - 0.25 * Phaser.Math.Easing.Back.Out(fadeIn) : 1);
      const shiver = Math.sin(now * 0.004 + view.spin * 7) * 0.02;
      const alpha = Math.min(fadeIn, fadeOut);
      view.shadow.setPosition(web.x + 1.5, web.y + 2).setScale(scale * 1.04).setRotation(view.spin + shiver).setAlpha(alpha * 0.6);
      view.silk.setPosition(web.x, web.y).setScale(scale).setRotation(view.spin + shiver).setAlpha(alpha * 0.92);
      if (view.silk.texture.key !== texture) { view.silk.setTexture(texture); view.shadow.setTexture(texture); }
    }
    for (const [id, view] of this.webs) if (!live.has(id)) { view.shadow.destroy(); view.silk.destroy(); this.webs.delete(id); }
  }

  private ensureTextures(): void {
    const textures = this.scene.textures;
    ensureCanvasTexture(textures, WEB_GLOB_TEXTURE, 24, 24, ctx => {
      const gradient = ctx.createRadialGradient(12, 11, 1, 12, 12, 11);
      gradient.addColorStop(0, 'rgba(250,244,255,1)');
      gradient.addColorStop(0.45, 'rgba(214,190,255,0.95)');
      gradient.addColorStop(0.8, 'rgba(96,52,150,0.75)');
      gradient.addColorStop(1, 'rgba(40,16,70,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(12, 12, 11, 0, Math.PI * 2); ctx.fill();
    });
    ensureCanvasTexture(textures, PROCEDURAL_COBWEB_TEXTURE, COBWEB_TEXTURE_SIZE, COBWEB_TEXTURE_SIZE, ctx => drawCobweb(ctx));
  }
}

/** Deterministic net rotation per turret so neighbouring webs do not look stamped. */
function spinOf(id: number | string): number {
  let hash = 2166136261;
  for (const character of String(id)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 628) / 100;
}

/** White radial threads and a sagging spiral on transparency; tinted per layer at runtime. */
function drawCobweb(ctx: CanvasRenderingContext2D): void {
  const size = COBWEB_TEXTURE_SIZE, c = size / 2, r = size / 2 - 3, spokes = 11;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineCap = 'round';
  const angles = Array.from({ length: spokes }, (_, i) => i / spokes * Math.PI * 2 + Math.sin(i * 2.3) * 0.12);
  ctx.lineWidth = 1.6;
  for (const angle of angles) {
    ctx.beginPath(); ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(angle) * r * (0.86 + 0.14 * Math.abs(Math.sin(angle * 3))), c + Math.sin(angle) * r);
    ctx.stroke();
  }
  ctx.lineWidth = 1.1;
  for (let ring = 1; ring <= 7; ring++) {
    const radius = r * ring / 7.6;
    ctx.beginPath();
    angles.forEach((angle, i) => {
      const next = angles[(i + 1) % spokes] + (i + 1 === spokes ? Math.PI * 2 : 0);
      const ax = c + Math.cos(angle) * radius, ay = c + Math.sin(angle) * radius;
      const mid = (angle + next) / 2, sag = radius * 0.86;
      if (i === 0) ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(c + Math.cos(mid) * sag, c + Math.sin(mid) * sag,
        c + Math.cos(next) * radius, c + Math.sin(next) * radius);
    });
    ctx.globalAlpha = 0.9 - ring * 0.06;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
