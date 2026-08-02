import * as Phaser from 'phaser';
// Canonical implementation filename: ReinforcementMatrixRenderer.
import { DEPTH } from '../config';
import type { SyncedReinforcementMatrix } from '../types';
import { circleZone, ensureCanvasTexture, mixColors } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';

const TEX_REINFORCEMENT_MATRIX_CARPET = '__reinforcement_matrix_carpet';
const TEX_REINFORCEMENT_MATRIX_RING = '__reinforcement_matrix_ring';
const TEX_REINFORCEMENT_MATRIX_SPARK = '__reinforcement_matrix_spark';

/** Quellgroesse der prozeduralen Texturen; die Skalierung leitet sich aus dem Feldradius ab. */
const TEXTURE_SIZE = 320;
const TEXTURE_RADIUS = TEXTURE_SIZE / 2;

/** Ein- und Ausblendzeit, damit das Feld nicht hart erscheint und verschwindet. */
const FADE_IN_MS = 220;
const FADE_OUT_MS = 420;

interface ReinforcementMatrixVisual {
  carpet: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  snapshot: SyncedReinforcementMatrix;
  seed: number;
}

/**
 * ReinforcementMatrixRenderer – Bodenteppich und Randring der Verstärkungsmatrix.
 *
 * Round-Lifetime-Renderer nach dem Muster von `TimeBubbleRenderer`: `syncVisuals()`
 * bekommt den replizierten Bestand, erzeugt und verwirft die Visuals daraus und
 * `destroyAll()` raeumt beim Rundenende auf.
 *
 * Die Darstellung ist bewusst bodennah (unter `DEPTH.PLAYERS`): Das Feld ist ein
 * Telegraph fuer den verstaerkten Bereich und darf Gegner und Tuerme nicht verdecken.
 * Alle Layer sind additiv ueber `emissiveAlpha`, damit sie ueber hellem Mittagsboden
 * nicht zu einer weissen Flaeche klippen.
 */
export class ReinforcementMatrixRenderer {
  private readonly visuals = new Map<number, ReinforcementMatrixVisual>();
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  generateTextures(): void {
    // Energieteppich: dichter Kern, weicher Rand, dazu ein feines Hexraster als
    // technische Signatur. Rein weiss gezeichnet, die Feldfarbe kommt per Tint.
    ensureCanvasTexture(this.scene.textures, TEX_REINFORCEMENT_MATRIX_CARPET, TEXTURE_SIZE, TEXTURE_SIZE, (ctx) => {
      ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      const center = TEXTURE_RADIUS;

      const base = ctx.createRadialGradient(center, center, 0, center, center, TEXTURE_RADIUS);
      base.addColorStop(0, 'rgba(255,255,255,0.34)');
      base.addColorStop(0.42, 'rgba(255,255,255,0.20)');
      base.addColorStop(0.78, 'rgba(255,255,255,0.09)');
      base.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(center, center, TEXTURE_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Hexraster nur innerhalb des Kreises, mit radialem Ausblenden zum Rand.
      ctx.save();
      ctx.beginPath();
      ctx.arc(center, center, TEXTURE_RADIUS - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.lineWidth = 1.4;
      const cell = 26;
      const rowHeight = cell * 0.866;
      for (let row = -1; row * rowHeight < TEXTURE_SIZE + rowHeight; row += 1) {
        const y = row * rowHeight;
        const offsetX = row % 2 === 0 ? 0 : cell * 0.5;
        for (let column = -1; column * cell < TEXTURE_SIZE + cell; column += 1) {
          const x = column * cell + offsetX;
          const distance = Math.hypot(x - center, y - center) / TEXTURE_RADIUS;
          if (distance > 1) continue;
          const fade = Math.max(0, 1 - distance) ** 1.6;
          ctx.strokeStyle = `rgba(255,255,255,${(0.22 * fade).toFixed(3)})`;
          ctx.beginPath();
          for (let corner = 0; corner < 6; corner += 1) {
            const angle = (Math.PI / 3) * corner + Math.PI / 6;
            const cornerX = x + Math.cos(angle) * cell * 0.5;
            const cornerY = y + Math.sin(angle) * cell * 0.5;
            if (corner === 0) ctx.moveTo(cornerX, cornerY);
            else ctx.lineTo(cornerX, cornerY);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.restore();
    });

    // Randring: markiert die Wirkungsgrenze scharf genug, um sie im Gefecht zu lesen.
    ensureCanvasTexture(this.scene.textures, TEX_REINFORCEMENT_MATRIX_RING, TEXTURE_SIZE, TEXTURE_SIZE, (ctx) => {
      ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      const center = TEXTURE_RADIUS;
      const edge = TEXTURE_RADIUS - 6;

      const halo = ctx.createRadialGradient(center, center, edge - 18, center, center, TEXTURE_RADIUS);
      halo.addColorStop(0, 'rgba(255,255,255,0)');
      halo.addColorStop(0.55, 'rgba(255,255,255,0.30)');
      halo.addColorStop(0.82, 'rgba(255,255,255,0.85)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(center, center, TEXTURE_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Unterbrochene Aussenmarken geben dem Ring eine technische Lesart.
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      const tickCount = 24;
      for (let index = 0; index < tickCount; index += 1) {
        const from = (Math.PI * 2 * index) / tickCount;
        ctx.beginPath();
        ctx.arc(center, center, edge, from, from + (Math.PI * 2) / tickCount * 0.42);
        ctx.stroke();
      }
    });

    // Matrix-Glow: weicher Punkt, der ein markiertes Ziel hervorhebt.
    ensureCanvasTexture(this.scene.textures, TEX_REINFORCEMENT_MATRIX_SPARK, 96, 96, (ctx) => {
      ctx.clearRect(0, 0, 96, 96);
      const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
      gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(0.35, 'rgba(255,255,255,0.34)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 96, 96);
    });
  }

  syncVisuals(fields: readonly SyncedReinforcementMatrix[], now: number): void {
    const activeIds = new Set(fields.map((field) => field.id));
    for (const [id] of this.visuals) {
      if (!activeIds.has(id)) this.destroyVisual(id);
    }

    for (const field of fields) {
      let visual = this.visuals.get(field.id);
      if (!visual) {
        visual = this.createVisual(field);
        this.visuals.set(field.id, visual);
      }
      visual.snapshot = field;
      this.updateVisual(visual, now);
    }
  }

  destroyAll(): void {
    for (const [id] of this.visuals) {
      this.destroyVisual(id);
    }
  }

  private createVisual(field: SyncedReinforcementMatrix): ReinforcementMatrixVisual {
    const scale = field.radius / TEXTURE_RADIUS;
    // Unter den Spielern: das Feld ist ein Telegraph, kein Vordergrundeffekt.
    const carpet = this.scene.add.image(field.x, field.y, TEX_REINFORCEMENT_MATRIX_CARPET)
      .setDepth(DEPTH.DECALS + 0.4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(scale)
      .setAlpha(0)
      .setTint(field.color);
    const ring = this.scene.add.image(field.x, field.y, TEX_REINFORCEMENT_MATRIX_RING)
      .setDepth(DEPTH.DECALS + 0.45)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(scale)
      .setAlpha(0)
      .setTint(mixColors(field.color, 0xffffff, 0.45));

    // Aufsteigende Funken geben dem Feld Bewegung, ohne die Flaeche zuzudecken.
    const sparks = this.scene.add.particles(field.x, field.y, TEX_REINFORCEMENT_MATRIX_SPARK, {
      lifespan: { min: 420, max: 820 },
      speed: { min: 6, max: 26 },
      scale: { start: 0.14, end: 0 },
      alpha: { start: emissiveAlpha(0.5), end: 0 },
      quantity: 1,
      frequency: 90,
      blendMode: Phaser.BlendModes.ADD,
      tint: mixColors(field.color, 0xffffff, 0.3),
      emitZone: circleZone(field.radius * 0.92),
    }).setDepth(DEPTH.DECALS + 0.5);

    return { carpet, ring, sparks, snapshot: field, seed: field.id * 1.317 };
  }

  private updateVisual(visual: ReinforcementMatrixVisual, now: number): void {
    const field = visual.snapshot;
    const scale = field.radius / TEXTURE_RADIUS;
    const elapsed = now - field.startedAt;
    const remaining = field.expiresAt - now;
    // Ein- und Ausblenden getrennt: das Ende ist laenger, damit das Auslaufen der
    // Verstaerkung nicht als abrupter Abriss gelesen wird.
    const envelope = Phaser.Math.Clamp(elapsed / FADE_IN_MS, 0, 1)
      * Phaser.Math.Clamp(remaining / FADE_OUT_MS, 0, 1);
    const time = now * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.1 + visual.seed);
    const ringPulse = 0.5 + 0.5 * Math.sin(time * 2.2 + visual.seed * 1.7);

    visual.carpet
      .setPosition(field.x, field.y)
      .setScale(scale * (1 + (pulse - 0.5) * 0.02))
      .setAlpha(emissiveAlpha(envelope * (0.5 + pulse * 0.22)));
    visual.ring
      .setPosition(field.x, field.y)
      .setScale(scale * (1 + (ringPulse - 0.5) * 0.014))
      .setRotation(time * 0.22 + visual.seed)
      .setAlpha(emissiveAlpha(envelope * (0.62 + ringPulse * 0.24)));
    // Der Emitter ist selbst ein Game Object; sein Alpha skaliert die Partikel mit.
    visual.sparks.setPosition(field.x, field.y).setAlpha(envelope);

    this.lighting?.setLight(lightKey(field.id), 'electricField', field.x, field.y, {
      radiusPx: Math.max(field.radius * 1.2, 120),
      color: mixColors(field.color, 0xffffff, 0.5),
      intensity: 0.72 * envelope,
    });
  }

  private destroyVisual(id: number): void {
    this.lighting?.releaseLight(lightKey(id));
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.carpet.destroy();
    visual.ring.destroy();
    visual.sparks.stop();
    visual.sparks.destroy();
    this.visuals.delete(id);
  }
}

function lightKey(id: number): string {
    return `reinforcement-matrix:${id}`;
}
