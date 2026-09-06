import * as Phaser from 'phaser';
import { COLORS, DEPTH_TRACE } from '../config';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import type { RockDestructionVisualSnapshot } from '../arena/rocks/RockVisualSystem';
import {
  createEmitter,
  destroyEmitter,
  killAllAndResetParticlePositions,
  setEmitterTintArray,
} from './EffectUtils';

import {
  ensureExplosionChunkTexture, ensureExplosionSmokeTexture,
  TEX_EXPLOSION_CHUNK, TEX_EXPLOSION_SMOKE,
} from './gpu/GpuVfxSourceTextures';

const TEX_ROCK_DUST = TEX_EXPLOSION_SMOKE;
const ROCK_TEXTURE_KEY = 'rocks';

/**
 * Wie weit ein Truemmerstueck oder eine Staubwolke ueber den Fels hinausreicht.
 *
 * Der Flug betraegt hoechstens 1,4 Zellbreiten, dazu kommt der Radius der Staubwolke. Ein Fels
 * weiter draussen kann nichts Sichtbares mehr beitragen.
 */
const DESTRUCTION_VISIBILITY_MARGIN_PX = 80;

/** Harte Obergrenze fuer gleichzeitig bewegte Fragment-Images. */
const MAX_FRAGMENT_SLOTS = 144;
/** Bei einer Massenwelle bleiben nur wenige Orte in der hochwertigen Fragmentspur. */
const MAX_FULL_DESTRUCTIONS_IN_MASS = 4;
const SMALL_DESTRUCTION_BATCH_LIMIT = MAX_FULL_DESTRUCTIONS_IN_MASS;
/** Gemeinsames Budget fuer die billige Repraesentation des Restes. */
const MAX_CHEAP_DUST_BURSTS = 32;
const CHEAP_DUST_PARTICLES = 4;
const CHEAP_DEBRIS_PARTICLES = 2;
const FULL_DUST_PARTICLES = 16;

interface RockDestructionRequest {
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  displayWidth: number;
  displayHeight: number;
  textureKey: string;
  frameName: string | number;
  tint: number;
  angle: number;
  columns: number;
  rows: number;
}

interface FragmentSlot {
  readonly image: Phaser.GameObjects.Image;
  active: boolean;
  ageMs: number;
  durationMs: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startAngle: number;
  endAngle: number;
  startScaleX: number;
  startScaleY: number;
  endScaleX: number;
  endScaleY: number;
}

interface FragmentSpawnConfig {
  readonly x: number;
  readonly y: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly tint: number;
  readonly angle: number;
  readonly endX: number;
  readonly endY: number;
  readonly endAngle: number;
  readonly durationMs: number;
  readonly endScaleX: number;
  readonly endScaleY: number;
  readonly textureKey: string;
  readonly frameName: string | number;
}

interface WorldPoint {
  x: number;
  y: number;
}

export class RockDestructionRenderer {
  /** Sichtbarer Weltausschnitt, einmal je Frame bestimmt. */
  private cachedView: { x: number; y: number; width: number; height: number } | null = null;
  private cachedViewFrame = -1;

  /** Sammelt synchrone Teile einer Explosion, bevor ein gemeinsames Budget vergeben wird. */
  private pendingRequests: RockDestructionRequest[] = [];

  /** Bereits angelegte Bilder werden nur sichtbar/unsichtbar geschaltet, nie pro Effekt zerstoert. */
  private readonly freeFragments: FragmentSlot[] = [];
  private readonly activeFragments: FragmentSlot[] = [];

  /** Die beiden Emitter leben so lange wie die Scene und werden fuer jede Welle wiederverwendet. */
  private sharedDustEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private sharedDebrisEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    // postupdate liegt nach Host-/Client-Updates, aber noch vor dem Rendern. Dadurch sieht eine
    // Einzelzerstoerung keinen zusaetzlichen Frame Delay, waehrend eine NUKE-Welle als Batch
    // budgetiert werden kann.
    this.scene.events.on('postupdate', this.handlePostUpdate, this);
    this.scene.events.once('shutdown', this.destroy, this);
  }

  /**
   * Ob eine Zerstoerung an dieser Stelle ueberhaupt zu sehen waere.
   *
   * Eine Flaechenzerstoerung raeumt auf einer grossen Karte tausende Felsen gleichzeitig ab. Der
   * Sichtbarkeitstest steht deshalb ganz vorne und verhindert bereits das Anlegen eines Requests
   * fuer Felsen ausserhalb des Bildes.
   */
  private isWorthShowing(x: number, y: number, size: number): boolean {
    const camera = this.scene.cameras?.main;
    if (!camera) return true;
    // Der Ausschnitt gilt fuer den ganzen Frame; bei tausenden Aufrufen zaehlt jede Division.
    const frame = this.scene.game?.loop?.frame ?? -1;
    if (this.cachedViewFrame !== frame || !this.cachedView) {
      this.cachedView = getVisibleWorldView(camera);
      this.cachedViewFrame = frame;
    }
    const view = this.cachedView;
    const margin = Math.max(DESTRUCTION_VISIBILITY_MARGIN_PX, size * (1.4 + Math.SQRT2));
    return x >= view.x - margin
      && x <= view.x + view.width + margin
      && y >= view.y - margin
      && y <= view.y + view.height + margin;
  }

  generateTextures(): void {
    if (this.destroyed) return;
    ensureExplosionChunkTexture(this.scene);
    ensureExplosionSmokeTexture(this.scene);

    this.ensureSharedEmitters();
    this.prewarmFragmentPool();
  }

  /** Nimmt ausschliesslich den rendererunabhaengigen Zustandssnapshot entgegen. */
  playDestruction(snapshot: RockDestructionVisualSnapshot): void {
    if (this.destroyed || !this.isWorthShowing(snapshot.x, snapshot.y,
      snapshot.size * Math.max(Math.abs(snapshot.scaleX), Math.abs(snapshot.scaleY)))) return;

    const frame = this.scene.textures.getFrame(ROCK_TEXTURE_KEY, snapshot.frame);
    const frameWidth = frame.realWidth;
    const frameHeight = frame.realHeight;
    this.pendingRequests.push({
      x: snapshot.x,
      y: snapshot.y,
      frameWidth,
      frameHeight,
      displayWidth: snapshot.size * snapshot.scaleX,
      displayHeight: snapshot.size * snapshot.scaleY,
      textureKey: ROCK_TEXTURE_KEY,
      frameName: snapshot.frame,
      tint: snapshot.tint,
      angle: snapshot.angle,
      columns: Phaser.Math.Clamp(Math.round(frameWidth / 12), 2, Math.min(4, frameWidth)),
      rows: Phaser.Math.Clamp(Math.round(frameHeight / 12), 2, Math.min(4, frameHeight)),
    });
  }

  /**
   * Round-lifecycle hook. Verwirft Effekte, die noch nicht gerendert wurden, und setzt die Pools
   * zurueck, ohne die persistenten Phaser-Objekte aus der Scene-Liste zu entfernen.
   */
  clear(): void {
    this.pendingRequests.length = 0;
    this.cachedView = null;
    this.cachedViewFrame = -1;
    while (this.activeFragments.length > 0) {
      this.releaseFragment(this.activeFragments[this.activeFragments.length - 1]);
    }
    if (this.sharedDustEmitter) killAllAndResetParticlePositions(this.sharedDustEmitter);
    if (this.sharedDebrisEmitter) killAllAndResetParticlePositions(this.sharedDebrisEmitter);
  }

  private handlePostUpdate(_time: number, delta: number): void {
    if (this.destroyed) return;
    this.updateFragments(delta);
    this.flushPendingRequests();
  }

  private flushPendingRequests(): void {
    if (this.pendingRequests.length === 0) return;

    const requests = this.pendingRequests.splice(0, this.pendingRequests.length);
    const fullLimit = requests.length <= SMALL_DESTRUCTION_BATCH_LIMIT
      ? requests.length
      : MAX_FULL_DESTRUCTIONS_IN_MASS;
    const preferredFullIndices = this.selectSpatiallyDistributed(requests, fullLimit);
    const fullIndices = new Set<number>();

    for (const index of preferredFullIndices) {
      if (this.spawnFullFragments(requests[index])) {
        fullIndices.add(index);
        this.emitDust(requests[index], FULL_DUST_PARTICLES, CHEAP_DEBRIS_PARTICLES);
      }
    }

    // Ohne Fragmentbudget bleibt ein kompakter Staubstoss. Massenwellen werden raeumlich verteilt.
    const cheapCandidates = requests
      .map((_request, index) => index)
      .filter((index) => !fullIndices.has(index));
    const cheapIndices = this.selectSpatiallyDistributed(
      cheapCandidates.map((index) => requests[index]),
      requests.length <= SMALL_DESTRUCTION_BATCH_LIMIT ? cheapCandidates.length : MAX_CHEAP_DUST_BURSTS,
    );

    for (const localIndex of cheapIndices) {
      const requestIndex = cheapCandidates[localIndex];
      this.emitDust(requests[requestIndex], CHEAP_DUST_PARTICLES, CHEAP_DEBRIS_PARTICLES);
    }
  }

  /**
   * Farthest-point-Auswahl: Start nahe der Sichtmitte, danach jeweils der am weitesten von den
   * bereits gewaehlten Orten entfernte Fels. Das bleibt ohne Sortierung des gesamten Bestands
   * linear und verhindert, dass Layout-Reihenfolge die hochwertigen Fragmente clustert.
   */
  private selectSpatiallyDistributed<T extends WorldPoint>(items: readonly T[], limit: number): number[] {
    if (limit <= 0 || items.length === 0) return [];
    if (limit >= items.length) return items.map((_item, index) => index);

    const center = this.getViewCenter(items);
    let firstIndex = 0;
    let firstDistance = Infinity;
    for (let index = 0; index < items.length; index += 1) {
      const distance = distanceSquared(items[index], center);
      if (distance < firstDistance) {
        firstDistance = distance;
        firstIndex = index;
      }
    }

    const selected = [firstIndex];
    const selectedSet = new Set(selected);
    while (selected.length < limit) {
      let bestIndex = -1;
      let bestDistance = -1;
      for (let index = 0; index < items.length; index += 1) {
        if (selectedSet.has(index)) continue;
        let nearestDistance = Infinity;
        for (const selectedIndex of selected) {
          nearestDistance = Math.min(nearestDistance, distanceSquared(items[index], items[selectedIndex]));
        }
        if (nearestDistance > bestDistance) {
          bestDistance = nearestDistance;
          bestIndex = index;
        }
      }
      if (bestIndex < 0) break;
      selected.push(bestIndex);
      selectedSet.add(bestIndex);
    }
    return selected;
  }

  private getViewCenter(items: readonly WorldPoint[]): WorldPoint {
    if (this.cachedView) {
      return {
        x: this.cachedView.x + this.cachedView.width * 0.5,
        y: this.cachedView.y + this.cachedView.height * 0.5,
      };
    }

    let x = 0;
    let y = 0;
    for (const item of items) {
      x += item.x;
      y += item.y;
    }
    return { x: x / items.length, y: y / items.length };
  }

  private spawnFullFragments(request: RockDestructionRequest): boolean {
    if (request.columns * request.rows > this.freeFragments.length) return false;
    const fragmentConfigs: FragmentSpawnConfig[] = [];
    const count = request.columns * request.rows;
    const size = Math.max(Math.abs(request.displayWidth), Math.abs(request.displayHeight));
    // Stratifizierte Winkel statt sichtbarem Schnittgitter: jeder Brocken hat eine eigene Masse.
    const phase = Phaser.Math.FloatBetween(0, Math.PI * 2);
    for (let index = 0; index < count; index += 1) {
      const direction = phase + (index + Phaser.Math.FloatBetween(-0.35, 0.35)) * Math.PI * 2 / count;
      const radius = Phaser.Math.FloatBetween(0.08, 0.32);
      const x = request.x + Math.cos(direction) * request.displayWidth * radius;
      const y = request.y + Math.sin(direction) * request.displayHeight * radius;
      const distance = size * Phaser.Math.FloatBetween(0.35, 1.05);
      const mass = Phaser.Math.FloatBetween(0.12, 0.26);
      const angle = Phaser.Math.FloatBetween(-180, 180);
      fragmentConfigs.push({
        x, y,
        worldWidth: Math.abs(request.displayWidth) * mass,
        worldHeight: Math.abs(request.displayHeight) * mass * Phaser.Math.FloatBetween(0.65, 1.15),
        tint: request.tint,
        angle,
        endX: x + Math.cos(direction) * distance,
        endY: y + Math.sin(direction) * distance,
        endAngle: angle + Phaser.Math.FloatBetween(-55, 55),
        durationMs: Phaser.Math.Between(520, 820),
        endScaleX: 0.72,
        endScaleY: 0.72,
        textureKey: TEX_EXPLOSION_CHUNK,
        frameName: '__BASE',
      });
    }

    // Der Check vor der Erzeugung ist wichtig: eine angefangene Teilwolke waere lesbar falsch und
    // wuerde das Fragmentbudget ausserdem schwer vorhersehbar machen.
    if (fragmentConfigs.length > this.freeFragments.length) return false;
    for (const config of fragmentConfigs) this.activateFragment(config);
    return true;
  }

  private activateFragment(config: FragmentSpawnConfig): void {
    const slot = this.freeFragments.pop();
    if (!slot) return;

    const image = slot.image
      .setActive(true)
      .setVisible(true)
      .setTexture(config.textureKey, config.frameName)
      .setDisplaySize(config.worldWidth, config.worldHeight)
      .setOrigin(0.5, 0.5)
      .setPosition(config.x, config.y)
      .setTint(config.tint)
      .setDepth(DEPTH_TRACE - 0.15)
      .setAngle(config.angle)
      .setAlpha(0.82);

    slot.active = true;
    slot.ageMs = 0;
    slot.durationMs = config.durationMs;
    slot.startX = config.x;
    slot.startY = config.y;
    slot.endX = config.endX;
    slot.endY = config.endY;
    slot.startAngle = config.angle;
    slot.endAngle = config.endAngle;
    slot.startScaleX = image.scaleX;
    slot.startScaleY = image.scaleY;
    slot.endScaleX = image.scaleX * config.endScaleX;
    slot.endScaleY = image.scaleY * config.endScaleY;
    this.activeFragments.push(slot);
  }

  private updateFragments(delta: number): void {
    if (this.activeFragments.length === 0) return;
    const safeDelta = Math.max(0, delta);
    for (let index = this.activeFragments.length - 1; index >= 0; index -= 1) {
      const slot = this.activeFragments[index];
      slot.ageMs += safeDelta;
      const progress = Phaser.Math.Clamp(slot.ageMs / slot.durationMs, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      const image = slot.image;
      image.setPosition(
        Phaser.Math.Linear(slot.startX, slot.endX, eased),
        Phaser.Math.Linear(slot.startY, slot.endY, eased),
      );
      image.setAngle(Phaser.Math.Linear(slot.startAngle, slot.endAngle, eased));
      const fade = Phaser.Math.Clamp((progress - 0.18) / 0.82, 0, 1);
      image.setAlpha(0.82 * (1 - fade * fade * (3 - 2 * fade)));
      image.setScale(
        Phaser.Math.Linear(slot.startScaleX, slot.endScaleX, eased),
        Phaser.Math.Linear(slot.startScaleY, slot.endScaleY, eased),
      );
      if (progress >= 1) this.releaseFragment(slot, index);
    }
  }

  private releaseFragment(slot: FragmentSlot, activeIndex = this.activeFragments.indexOf(slot)): void {
    if (!slot.active) return;
    slot.active = false;
    slot.image.setActive(false).setVisible(false).setAlpha(0);
    if (activeIndex >= 0 && activeIndex < this.activeFragments.length) {
      const last = this.activeFragments.pop()!;
      if (last !== slot) this.activeFragments[activeIndex] = last;
    }
    this.freeFragments.push(slot);
  }

  private emitDust(
    request: RockDestructionRequest,
    dustCount: number,
    debrisCount = 0,
  ): void {
    const tint = [request.tint, COLORS.BROWN_2, COLORS.BROWN_5];
    if (this.sharedDustEmitter) {
      setEmitterTintArray(this.sharedDustEmitter, tint);
      this.sharedDustEmitter.explode(dustCount, request.x, request.y);
    }
    if (debrisCount > 0 && this.sharedDebrisEmitter) {
      setEmitterTintArray(this.sharedDebrisEmitter, tint);
      this.sharedDebrisEmitter.explode(debrisCount, request.x, request.y);
    }
  }

  private ensureSharedEmitters(): void {
    if (this.sharedDustEmitter || this.destroyed) return;

    this.sharedDustEmitter = createEmitter(this.scene, 0, 0, TEX_ROCK_DUST, {
      frequency: -1,
      maxParticles: 192,
      maxAliveParticles: 192,
      reserve: 192,
      lifespan: { min: 480, max: 720 },
      speed: { min: 22, max: 66 },
      angle: { min: 0, max: 360 },
      quantity: 1,
      scale: { start: 0.18, end: 0.85, ease: 'Cubic.Out' },
      rotate: { min: -180, max: 180 },
      alpha: { start: 0.46, end: 0, ease: 'Sine.InOut' },
      tint: [0xffffff, COLORS.BROWN_2, COLORS.BROWN_5],
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: false,
    }, DEPTH_TRACE - 0.3, undefined, 'rockDestruction');

    this.sharedDebrisEmitter = createEmitter(this.scene, 0, 0, TEX_ROCK_DUST, {
      frequency: -1,
      maxParticles: 96,
      maxAliveParticles: 96,
      reserve: 96,
      lifespan: { min: 240, max: 460 },
      speed: { min: 60, max: 120 },
      angle: { min: 0, max: 360 },
      quantity: 1,
      scale: { start: 0.08, end: 0.24 },
      rotate: { min: -180, max: 180 },
      alpha: { start: 0.3, end: 0 },
      tint: [0xffffff, COLORS.BROWN_2, COLORS.BROWN_5],
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: false,
    }, DEPTH_TRACE - 0.25, undefined, 'rockDestruction');
  }

  private prewarmFragmentPool(): void {
    while (this.freeFragments.length + this.activeFragments.length < MAX_FRAGMENT_SLOTS) {
      const image = this.scene.add.image(0, 0, TEX_EXPLOSION_CHUNK)
        .setActive(false)
        .setVisible(false)
        .setAlpha(0)
        .setDepth(DEPTH_TRACE - 0.15);
      this.freeFragments.push({
        image,
        active: false,
        ageMs: 0,
        durationMs: 0,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        startAngle: 0,
        endAngle: 0,
        startScaleX: 1,
        startScaleY: 1,
        endScaleX: 1,
        endScaleY: 1,
      });
    }
  }

  private destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('postupdate', this.handlePostUpdate, this);
    this.scene.events.off('shutdown', this.destroy, this);
    this.clear();

    if (this.sharedDustEmitter) destroyEmitter(this.sharedDustEmitter);
    if (this.sharedDebrisEmitter) destroyEmitter(this.sharedDebrisEmitter);
    this.sharedDustEmitter = null;
    this.sharedDebrisEmitter = null;
    for (const slot of this.freeFragments) slot.image.destroy();
    for (const slot of this.activeFragments) slot.image.destroy();
    this.freeFragments.length = 0;
    this.activeFragments.length = 0;
  }
}

function distanceSquared(a: WorldPoint, b: WorldPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
