import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { CHARACTER_SHADOW_CONFIG } from '../ShadowConfig';
import { getPipelineAsset } from '../../config/pipelineAssets';
import { resolveExplosionAudio } from '../../audio/ExplosionAudio';
import type { AudioAssetKey } from '../../audio/AudioCatalog';
import {
  bomberDronePose, bomberDrops, bomberLaunchAt, isBomberImpactInWorld,
  type BomberDronePose, type BomberSquadronWorldBounds,
} from '../../systems/bomberSquadron/BomberSquadronPlan';
import type {
  BomberSquadronDeploymentSnapshot, BomberSquadronSnapshot,
} from '../../systems/bomberSquadron/BomberSquadronSnapshot';
import { createVisibleWorldView, getVisibleWorldView, type VisibleWorldView } from '../../graphics/CameraWorldView';
import {
  applyAttackDroneBodyFrame, ATTACK_DRONE_BOMB_TEXTURE, ensureAttackDroneEffectTextures,
} from '../AttackDroneRenderer';
import type { CameraFeedbackController } from '../camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx, sustainedRumble } from '../camera/cameraFeedbackPresets';
import { registerGraphicsObject } from '../EffectUtils';

/** Presentation side effects the squadron borrows from the World presentation. */
export interface BomberSquadronPresentationPorts {
  /** Shared combat explosion (fireball, flash, light); purely cosmetic here. */
  explode(x: number, y: number, radius: number): void;
  playSound(key: AudioAssetKey, x: number, y: number, volumeScale: number): void;
  cameraFeedback(): CameraFeedbackController | null;
  /** Same bounds as the host's impact filter; null while the World has no metrics. */
  worldBounds(): BomberSquadronWorldBounds | null;
  /** Night tint for objects drawn above the lightmap (same rule as tree canopies). */
  tintAt(x: number, y: number): number;
}

// Bombers fly high: body above canopies and ground effects but below local UI (DEPTH.CANOPY + 0.6),
// falling bombs just below it, silhouette shadows in the character shadow receiver band.
/** Slightly larger than the attack drone: closer to the camera. */
const BODY_SIZE = 44;
/** Altitude read: the silhouette shadow sits clearly offset on the ground. */
const SHADOW_OFFSET_X = 9, SHADOW_OFFSET_Y = 17, SHADOW_ALPHA = 0.55;
/** Wingtip position lights: lateral offset from the body centre, small and damped (no glow). */
const WINGTIP_OFFSET = 18, POSITION_LIGHT_RADIUS = 1.3;
const PORT_LIGHT_COLOR = 0xc0503f, STARBOARD_LIGHT_COLOR = 0x5aa86a;
const tintLuminance = (tint: number) => ((tint >> 16 & 255) * .2126 + (tint >> 8 & 255) * .7152 + (tint & 255) * .0722) / 255;
/** A bomb leaves the bay this far above its impact point and shrinks while it falls. */
const BOMB_DROP_HEIGHT = 16;
/** Cosmetics are thinned, hits never: at most this many full explosions start per frame. */
const MAX_EXPLOSIONS_PER_FRAME = 4;
const SOUND_INTERVAL_MS = 110;
const RUMBLE_HOLD_MS = 260;
const CULL_MARGIN = 96;
const BOMB_AUDIO = resolveExplosionAudio('ATTACK_DRONE_BOMB');

interface PlannedDrop { readonly x: number; readonly y: number; readonly dropAt: number; readonly impactAt: number; done: boolean }
interface DroneVisual {
  body: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; marker: Phaser.GameObjects.Arc;
  portLight: Phaser.GameObjects.Arc; starboardLight: Phaser.GameObjects.Arc;
}
interface SquadronVisual {
  snapshot: BomberSquadronDeploymentSnapshot;
  /** Impacts before this host time happened before this peer saw the squadron (late join). */
  readonly firstSeenAt: number;
  readonly planned: boolean[];
  readonly drones: (DroneVisual | null)[];
  drops: PlannedDrop[];
  /** Set when the snapshot ended naturally; drones keep flying out until this time. */
  lingerUntil: number | null;
  nextSoundAt: number;
  lastImpactAt: number;
  lastImpactX: number;
  lastImpactY: number;
}

/**
 * Presentation of the Bomber squadron (assets step 1: attack-drone body). Everything is derived
 * from the replicated `bq` facts through `BomberSquadronPlan`: flight, bomb fall, shadows and
 * explosions. There is no message per bomb, and late joiners never replay past impacts.
 */
export class BomberSquadronRenderer {
  private readonly squadrons = new Map<number, SquadronVisual>();
  private readonly bombPool: Phaser.GameObjects.Image[] = [];
  private readonly bombs: Phaser.GameObjects.Image[] = [];
  private readonly pose: BomberDronePose = { x: 0, y: 0, heading: 0, alpha: 0, phase: 'approach' };
  private readonly view = createVisibleWorldView();
  private previousNow: number | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly ports: BomberSquadronPresentationPorts) {
    ensureAttackDroneEffectTextures(scene);
  }

  update(snapshot: BomberSquadronSnapshot, now: number): void {
    if (this.destroyed) return;
    const previous = this.previousNow ?? now;
    this.previousNow = now;
    const live = new Set<number>();
    for (const squadron of snapshot.squadrons) {
      live.add(squadron.id);
      let visual = this.squadrons.get(squadron.id);
      if (!visual) {
        visual = { snapshot: squadron, firstSeenAt: now, planned: [], drones: [], drops: [], lingerUntil: null,
          nextSoundAt: 0, lastImpactAt: -Infinity, lastImpactX: 0, lastImpactY: 0 };
        this.squadrons.set(squadron.id, visual);
      }
      visual.snapshot = squadron;
      visual.lingerUntil = null;
      this.plan(visual);
    }
    for (const [id, visual] of this.squadrons) {
      if (live.has(id)) continue;
      // A natural end keeps departing drones visible; removal before the end (leave, teardown) is final.
      if (visual.lingerUntil === null) {
        visual.lingerUntil = now >= visual.snapshot.endsAt - 100 ? this.flightEnd(visual.snapshot) : now;
      }
      if (now >= visual.lingerUntil) { this.release(visual); this.squadrons.delete(id); }
    }
    this.releaseBombs();
    const view = getVisibleWorldView(this.scene.cameras.main, this.view);
    let explosions = 0;
    for (const visual of this.squadrons.values()) {
      this.drawDrones(visual, now, view);
      explosions = this.drawDrops(visual, previous, now, view, explosions);
      if (now - visual.lastImpactAt < RUMBLE_HOLD_MS) {
        this.ports.cameraFeedback()?.request(sustainedRumble(`bomber-squadron:${visual.snapshot.id}`,
          legacyShakeAmplitudePx(0.0016), CAMERA_FEEDBACK_PRIORITY.mediumImpact,
          { sourceX: visual.lastImpactX, sourceY: visual.lastImpactY, durationMs: RUMBLE_HOLD_MS }));
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const visual of this.squadrons.values()) this.release(visual);
    this.squadrons.clear();
    this.releaseBombs();
    for (const image of this.bombPool) image.destroy();
    this.bombPool.length = 0;
  }

  /** Expands each newly anchored drone into its drops once; out-of-world impacts never exist. */
  private plan(visual: SquadronVisual): void {
    const snapshot = visual.snapshot, bounds = this.ports.worldBounds();
    let added = false;
    snapshot.anchors.forEach((anchor, drone) => {
      if (!anchor || visual.planned[drone]) return;
      visual.planned[drone] = true;
      for (const drop of bomberDrops(snapshot, drone, anchor)) {
        if (bounds && !isBomberImpactInWorld(drop.x, drop.y, bounds)) continue;
        visual.drops.push({ x: drop.x, y: drop.y, dropAt: drop.dropAt, impactAt: drop.impactAt,
          done: drop.impactAt <= visual.firstSeenAt });
        added = true;
      }
    });
    if (added) visual.drops.sort((a, b) => a.impactAt - b.impactAt);
  }

  private drawDrones(visual: SquadronVisual, now: number, view: VisibleWorldView): void {
    const snapshot = visual.snapshot, body = getPipelineAsset('attack-drone-body');
    snapshot.anchors.forEach((anchor, drone) => {
      const pose = anchor ? bomberDronePose(snapshot, drone, anchor, now, this.pose) : null;
      const visible = !!pose && pose.alpha > 0.01 && pose.x >= view.x - CULL_MARGIN
        && pose.x <= view.right + CULL_MARGIN && pose.y >= view.y - CULL_MARGIN && pose.y <= view.bottom + CULL_MARGIN;
      let v = visual.drones[drone] ?? null;
      if (!visible || !pose) { if (v) this.setDroneVisible(v, false); return; }
      if (!v) {
        const marker = this.scene.add.circle(pose.x, pose.y, 1.8, snapshot.ownerColor).setDepth(DEPTH.CANOPY + 0.61);
        registerGraphicsObject(this.scene, 'objectiveMarkers', marker);
        const portLight = this.scene.add.circle(pose.x, pose.y, POSITION_LIGHT_RADIUS, PORT_LIGHT_COLOR).setDepth(DEPTH.CANOPY + 0.62);
        registerGraphicsObject(this.scene, 'objectiveMarkers', portLight);
        const starboardLight = this.scene.add.circle(pose.x, pose.y, POSITION_LIGHT_RADIUS, STARBOARD_LIGHT_COLOR).setDepth(DEPTH.CANOPY + 0.62);
        registerGraphicsObject(this.scene, 'objectiveMarkers', starboardLight);
        v = {
          body: this.scene.add.image(pose.x, pose.y, body.textureKey).setDisplaySize(BODY_SIZE, BODY_SIZE).setDepth(DEPTH.CANOPY + 0.6),
          // Silhouette shadow: the body's own shape, darkened and offset, reads the altitude clearly.
          shadow: this.scene.add.image(pose.x, pose.y, body.textureKey).setDisplaySize(BODY_SIZE, BODY_SIZE).setDepth(CHARACTER_SHADOW_CONFIG.depth),
          marker, portLight, starboardLight,
        };
        v.shadow.setTint(0x05090c);
        v.body.name = `bomber-squadron:${snapshot.id}:${drone}`;
        visual.drones[drone] = v;
      }
      this.setDroneVisible(v, true);
      const tint = this.ports.tintAt(pose.x, pose.y);
      const rotation = pose.heading + Math.PI / 2;
      v.body.setPosition(pose.x, pose.y).setRotation(rotation).setAlpha(pose.alpha).setTint(tint);
      applyAttackDroneBodyFrame(v.body, now, true);
      applyAttackDroneBodyFrame(v.shadow, now, true);
      v.shadow.setPosition(pose.x + SHADOW_OFFSET_X, pose.y + SHADOW_OFFSET_Y).setRotation(rotation)
        .setAlpha(SHADOW_ALPHA * pose.alpha);
      v.marker.setPosition(pose.x, pose.y).setFillStyle(snapshot.ownerColor, 0.75 * pose.alpha);
      // Damped wingtip lights (no glow): barely there by day, they carry the silhouette at night.
      const darkness = 1 - tintLuminance(tint);
      const lightAlpha = (0.25 + 0.6 * darkness) * pose.alpha;
      const sideX = Math.cos(pose.heading + Math.PI / 2) * WINGTIP_OFFSET, sideY = Math.sin(pose.heading + Math.PI / 2) * WINGTIP_OFFSET;
      v.portLight.setPosition(pose.x - sideX, pose.y - sideY).setFillStyle(PORT_LIGHT_COLOR, lightAlpha);
      v.starboardLight.setPosition(pose.x + sideX, pose.y + sideY).setFillStyle(STARBOARD_LIGHT_COLOR, lightAlpha);
    });
  }

  /** Falling bombs and their impacts; returns the explosions started this frame. */
  private drawDrops(visual: SquadronVisual, previous: number, now: number, view: VisibleWorldView,
    explosions: number): number {
    const radius = visual.snapshot.params.explosionRadius;
    for (const drop of visual.drops) {
      if (drop.dropAt > now) break;
      const onScreen = drop.x >= view.x - CULL_MARGIN && drop.x <= view.right + CULL_MARGIN
        && drop.y >= view.y - CULL_MARGIN && drop.y <= view.bottom + CULL_MARGIN;
      if (drop.done) continue;
      if (drop.impactAt > now) {
        if (!onScreen) continue;
        const progress = Math.max(0, Math.min(1, (now - drop.dropAt) / Math.max(1, drop.impactAt - drop.dropAt)));
        const bomb = this.acquireBomb();
        bomb.setPosition(drop.x, drop.y - BOMB_DROP_HEIGHT * (1 - progress))
          .setDisplaySize(8 - progress * 3, 10 - progress * 3).setTint(this.ports.tintAt(drop.x, drop.y));
        continue;
      }
      drop.done = true;
      if (drop.impactAt <= previous - 1000) continue;
      visual.lastImpactAt = now; visual.lastImpactX = drop.x; visual.lastImpactY = drop.y;
      if (!onScreen || explosions >= MAX_EXPLOSIONS_PER_FRAME) continue;
      explosions++;
      this.ports.explode(drop.x, drop.y, radius);
      if (BOMB_AUDIO && now >= visual.nextSoundAt) {
        this.ports.playSound(BOMB_AUDIO.key, drop.x, drop.y, BOMB_AUDIO.scale);
        visual.nextSoundAt = now + SOUND_INTERVAL_MS;
      }
    }
    return explosions;
  }

  private flightEnd(snapshot: BomberSquadronDeploymentSnapshot): number {
    const p = snapshot.params, runMs = p.corridorLengthPx / p.runSpeedPxPerSec * 1000;
    let end = snapshot.endsAt;
    snapshot.anchors.forEach((anchor, drone) => {
      if (anchor) end = Math.max(end, bomberLaunchAt(snapshot, drone) + p.approachMs
        + p.passCount * runMs + (p.passCount - 1) * p.turnMs + p.departureMs);
    });
    return end;
  }

  private setDroneVisible(v: DroneVisual, visible: boolean): void {
    for (const object of [v.body, v.shadow, v.marker, v.portLight, v.starboardLight]) object.setVisible(visible);
  }

  private release(visual: SquadronVisual): void {
    for (const v of visual.drones) if (v) for (const object of [v.body, v.shadow, v.marker, v.portLight, v.starboardLight]) object.destroy();
    visual.drones.length = 0;
  }

  private acquireBomb(): Phaser.GameObjects.Image {
    const image = (this.bombPool.pop() ?? this.scene.add.image(0, 0, ATTACK_DRONE_BOMB_TEXTURE).setDepth(DEPTH.CANOPY + 0.5))
      .setActive(true).setVisible(true);
    this.bombs.push(image);
    return image;
  }

  /** Falling bombs are redrawn every frame from the plan. */
  private releaseBombs(): void {
    for (const image of this.bombs) {
      if (this.bombPool.length < 160) { image.setActive(false).setVisible(false); this.bombPool.push(image); }
      else image.destroy();
    }
    this.bombs.length = 0;
  }
}
