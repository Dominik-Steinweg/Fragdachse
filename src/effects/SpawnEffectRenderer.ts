import * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { mixColors } from './EffectUtils';
import { getEmissiveScale } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';
import { SpawnGpuLayer, type SpawnGpuInstance } from './gpu/SpawnGpuLayer';
import { SPAWN_FIELD_LIFE_S, SPAWN_FLASH_S, SPAWN_KIND, SPAWN_VARIANT } from './gpu/SpawnShader';

/**
 * Dauer des Nachleuchtens am Spawnpunkt. Deutlich länger als der Blitz selbst: der Blitz sagt
 * "hier ist gerade etwas passiert", das Nachleuchten "hier steht jetzt jemand" – und gibt einem
 * hinsehenden Spieler die Zeit, die Stelle überhaupt zu finden.
 */
const AFTERGLOW_DURATION_MS = 1800;

/** Particle counts per spawn; the low quality profile halves them. */
const PARTICLES = {
  player: { gather: 14, sparks: 26, embers: 10 },
  enemy: { gather: 7, sparks: 12, embers: 4 },
} as const;
/** Size of the enemy family relative to the player's. */
const ENEMY_SCALE = 0.66;

interface SpawnEvent {
  readonly owner: SpawnEffectRenderer;
  readonly endMs: number;
  /** Built once at the spawn, t0 on the stage clock; the GPU animates them from there. */
  readonly instances: SpawnGpuInstance[];
}

const stages = new WeakMap<Phaser.Scene, SpawnEffectStage>();

/**
 * Szenenweite Bühne aller Spawn-Effekte: Spieler und Gegner teilen einen begrenzten GPU-Batch.
 * Jedes Ereignis gehört genau einem {@link SpawnEffectRenderer}; dessen `clear()` löst nur die
 * eigenen. Der Instanzpuffer wird nur bei neuen oder abgelaufenen Ereignissen neu geschrieben,
 * pro Frame bewegt sich allein die Uhr.
 */
class SpawnEffectStage {
  static for(scene: Phaser.Scene): SpawnEffectStage {
    let stage = stages.get(scene);
    if (!stage) { stage = new SpawnEffectStage(scene); stages.set(scene, stage); }
    return stage;
  }

  static peek(scene: Phaser.Scene): SpawnEffectStage | null { return stages.get(scene) ?? null; }

  private readonly events: SpawnEvent[] = [];
  private layer: SpawnGpuLayer | null = null;
  /** Scene time of the layer clock's zero; restarts whenever the stage runs empty. */
  private epochMs = 0;
  private dirty = false;

  private constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.sync);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy);
  }

  get size(): number { return this.events.length; }

  add(owner: SpawnEffectRenderer, startMs: number, durationMs: number, instances: SpawnGpuInstance[]): void {
    // Created here, in the update phase: objects added during PRE_RENDER would miss this
    // frame's depth sort and draw once on top of everything.
    this.layer ??= new SpawnGpuLayer(this.scene);
    if (this.events.length === 0) this.epochMs = startMs;
    for (const instance of instances) instance.t0 = (startMs - this.epochMs) / 1000;
    this.events.push({ owner, endMs: startMs + durationMs, instances });
    this.dirty = true;
  }

  release(owner: SpawnEffectRenderer): void {
    const before = this.events.length;
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].owner === owner) this.events.splice(i, 1);
    if (this.events.length !== before) this.publish();
  }

  /** Läuft vor jedem Render: abgelaufene Ereignisse fallen weg, die Uhr rückt vor. */
  readonly sync = (): void => {
    if (this.events.length === 0 && !this.dirty) return;
    const now = this.scene.time.now;
    const before = this.events.length;
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].endMs <= now) this.events.splice(i, 1);
    if (this.dirty || this.events.length !== before) this.publish();
    this.layer?.setFrame((now - this.epochMs) / 1000,
      getGraphicsQualityProfile(this.scene).level === 'low' ? 0 : 1, getEmissiveScale());
  };

  private publish(): void {
    this.dirty = false;
    const layer = this.layer;
    if (!layer) return;
    layer.begin();
    // Newest first: if a burst ever exceeds the batch, the oldest (fading) spawns give way.
    fill: for (let e = this.events.length - 1; e >= 0; e--) {
      for (const instance of this.events[e].instances) if (!layer.add(instance)) break fill;
    }
    layer.end();
  }

  private readonly destroy = (): void => {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.sync);
    this.events.length = 0;
    this.layer?.destroy();
    this.layer = null;
    stages.delete(this.scene);
  };
}

/** Anzahl laufender Spawn-Effekte einer Scene (Diagnose und Lifecycle-Tests). */
export function countActiveSpawnEffects(scene: Phaser.Scene): number {
  return SpawnEffectStage.peek(scene)?.size ?? 0;
}

/**
 * Spawn- und Respawn-Materialisierung als GPU-Effekt (siehe `gpu/SpawnShader.ts`): Licht sammelt
 * sich, ein Sigil zeichnet sich auf den Boden, eine Lichtsäule fokussiert auf den Punkt, der Blitz
 * materialisiert die Figur, Schockringe und Funken tragen ihn nach außen, das Nachleuchten bleibt.
 * Diese Klasse ist der Besitzer-Handle: Jeder Besitzer (Spielerfigur, Effektsystem) löst mit
 * `clear()` genau seine eigenen laufenden Effekte.
 */
export class SpawnEffectRenderer {
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  clear(): void {
    SpawnEffectStage.peek(this.scene)?.release(this);
  }

  /**
   * Spielt den vollständigen Spawn-Effekt an Position (x, y) ab.
   * colorHex bestimmt die Farbe aller Elemente (Spielerfarbe).
   */
  play(x: number, y: number, colorHex: number): void {
    this.lighting?.pulse('teleportFlash', x, y, {
      color: mixColors(colorHex, 0xffffff, 0.6),
    });
    this.submit(x, y, colorHex, SPAWN_VARIANT.player);
    this.pulseAfterglow(x, y, colorHex, 1);
  }

  /**
   * Gegner-Variante des Spawns. Bewusst zurückhaltender als der Spielerspawn: kein Sigil, keine
   * Lichtsäule, kleinere Ringe, weniger Funken. Bei bis zu einem Gegner pro Sekunde muss der Effekt
   * die Stelle markieren, ohne das Gefecht zu überstrahlen – der Spielerspawn bleibt das lautere
   * Ereignis, weil er selten ist und die eigene Aufmerksamkeit verdient.
   */
  playEnemy(x: number, y: number, colorHex: number): void {
    this.lighting?.pulse('teleportFlash', x, y, {
      color: mixColors(colorHex, 0xffffff, 0.35),
      radiusPx: 105,
      intensity: 0.5,
    });
    this.submit(x, y, colorHex, SPAWN_VARIANT.enemy);
    this.pulseAfterglow(x, y, colorHex, 0.62);
  }

  /** Das Nachleuchten als Licht: bei Nacht hellt es die Umgebung des Spawnpunkts mit auf. */
  private pulseAfterglow(x: number, y: number, colorHex: number, scale: number): void {
    this.lighting?.pulse('spawnAfterglow', x, y, {
      color:      mixColors(colorHex, 0xffffff, 0.45),
      radiusPx:   250 * scale,
      intensity:  0.6 * scale,
      durationMs: AFTERGLOW_DURATION_MS,
    });
  }

  private submit(x: number, y: number, colorHex: number, variant: number): void {
    const enemy = variant === SPAWN_VARIANT.enemy;
    const scale = enemy ? ENEMY_SCALE : 1;
    const counts = enemy ? PARTICLES.enemy : PARTICLES.player;
    const share = getGraphicsQualityProfile(this.scene).level === 'low' ? 0.5 : 1;
    const r = ((colorHex >> 16) & 0xff) / 255, g = ((colorHex >> 8) & 0xff) / 255, b = (colorHex & 0xff) / 255;
    const flash = SPAWN_FLASH_S[variant];
    const base = (kind: number, p1: number, p2: number, p3: number, p4: number): SpawnGpuInstance => ({
      x, y, kind, t0: 0, seed: Math.random(), variant, r, g, b, scale, p1, p2, p3, p4,
    });
    const instances: SpawnGpuInstance[] = [base(SPAWN_KIND.field, 0, 0, 0, 0)];
    let lifeS: number = SPAWN_FIELD_LIFE_S[variant];
    const angleOffset = Math.random() * Math.PI * 2;

    const gather = Math.round(counts.gather * share);
    for (let i = 0; i < gather; i++) {
      instances.push(base(SPAWN_KIND.gather,
        angleOffset + (i / gather) * Math.PI * 2 + (Math.random() - 0.5) * 0.4,
        (enemy ? 34 : 66) + Math.random() * (enemy ? 14 : 28),
        0.78 + Math.random() * 0.22,
        1.3 + Math.random() * 0.7));
    }
    const sparks = Math.round(counts.sparks * share);
    for (let i = 0; i < sparks; i++) {
      const life = (enemy ? 0.26 : 0.32) + Math.random() * (enemy ? 0.2 : 0.3);
      instances.push(base(SPAWN_KIND.spark,
        (i / sparks) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
        (enemy ? 120 : 190) + Math.random() * (enemy ? 120 : 230),
        life,
        1.0 + Math.random() * 0.6));
      lifeS = Math.max(lifeS, flash + life);
    }
    const embers = Math.round(counts.embers * share);
    for (let i = 0; i < embers; i++) {
      const delay = Math.random() * 0.45, life = 0.7 + Math.random() * 0.5;
      instances.push(base(SPAWN_KIND.ember, Math.random() * Math.PI * 2, delay, life, 1.1 + Math.random() * 0.7));
      lifeS = Math.max(lifeS, flash + delay + life);
    }
    SpawnEffectStage.for(this.scene).add(this, this.scene.time.now, lifeS * 1000, instances);
  }
}
