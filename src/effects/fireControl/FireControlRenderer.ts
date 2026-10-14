import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getTurretVisualSpec, TURRET_VISUALS } from '../../config/turretVisuals';
import type { TurretWeaponId } from '../../types';
import { getPausedOriginalIds, type FireControlSnapshot, type FireControlEntrySnapshot,
  type FireControlPortalDeploymentSnapshot, type FireControlCopiesDeploymentSnapshot,
  type FireControlCopySnapshot, type FireControlHoloDeploymentSnapshot } from '../../systems/fireControl/FireControlSnapshot';
import { TurretAnimationController } from '../TurretAnimationController';
import type { LightingSystem } from '../LightingSystem';
import { FireControlHologramFilter, type HologramPreset } from './FireControlHologramFilter';
import { createFireControlPortalGpuLayer } from './FireControlPortalGpuLayer';
import { FireControlGpuKind as Kind, FireControlPortalGpuStore } from './FireControlPortalGpuStore';
import { FIRE_CONTROL_RELAY, FIRE_CONTROL_RELAY_SIZE, ensureFireControlRelayAssets, fireControlRelayFrame } from './FireControlRelayAssets';

/** Optional presentation extension; never changes the replicated/domain contract. */
export interface FireControlEntryView extends FireControlEntrySnapshot { readonly lastTransportAt?: number }
export interface FireControlPortalView extends Omit<FireControlPortalDeploymentSnapshot, 'entries'> {
  readonly entries: readonly FireControlEntryView[];
}
export interface FireControlView extends FireControlSnapshot {
  readonly deployments: readonly (FireControlCopiesDeploymentSnapshot | FireControlPortalView | FireControlHoloDeploymentSnapshot)[];
}
export interface FireControlOriginalVisual { sprite: Phaser.GameObjects.Sprite; x: number; y: number }
interface CopyVisual {
  sprite: Phaser.GameObjects.Sprite; filter: FireControlHologramFilter;
  copy: FireControlCopySnapshot; expiresAt: number; removedAt?: number; removedMaterialize?: number;
  /** Projector lens of the owning deployment; the projection beam starts here. */
  projector: { x: number; y: number; startedAt: number };
}
interface PortalVisual { snapshot: FireControlPortalView; removedAt?: number; removedOpen?: number }
interface RelayVisual { sprite: Phaser.GameObjects.Sprite; removedAt?: number }
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const EXIT_RADIUS = 23;
/** Muzzle portal half-height across the firing line; large enough to read next to a 40 px turret. */
const ENTRY_RADIUS = 13;
const FLASH_MS = 220;
/** The projection beam is brighter while it carries a copy in, then settles to a steady glow. */
const BEAM_SETTLE_MS = 700;
/** Beam flare after the copy fires. */
const BEAM_SHOT_MS = 180;
/** Projection beams are local by construction; anything longer is not drawn. */
const BEAM_MAX_LENGTH = 90;

/** Presentation owner only: update receives synchronized host time, never calls gameplay. */
export class FireControlRenderer {
  readonly store = new FireControlPortalGpuStore();
  private readonly layer;
  private readonly copies = new Map<string, CopyVisual>();
  private readonly portals = new Map<number, PortalVisual>();
  private readonly relays = new Map<number, RelayVisual>();
  private readonly paused = new Map<number, { sprite: Phaser.GameObjects.Sprite; filter: Phaser.Filters.ColorMatrix }>();
  private readonly animations = new TurretAnimationController();
  private readonly shotAt = new Map<string, number>();
  private previousNow: number | null = null;
  private destroyed = false;
  private readonly lightKeys = new Set<string>();
  private readonly touchedLights = new Set<string>();
  constructor(private readonly scene: Phaser.Scene,
    private readonly original: (id: number) => FireControlOriginalVisual | undefined,
    public preset: HologramPreset = 'A',
    private readonly lighting?: Pick<LightingSystem, 'setLight' | 'releaseLight'>) {
    this.layer = createFireControlPortalGpuLayer(scene, this.store);
    ensureFireControlRelayAssets(scene);
  }
  /** Confirmed shot events can be forwarded independently of snapshot refreshes. */
  onShot(sourceId: string): void {
    this.animations.onShot(sourceId);
    if (this.copies.has(sourceId) && this.previousNow !== null) this.shotAt.set(sourceId, this.previousNow);
  }
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean { return this.layer?.prepare(context) ?? true; }
  update(snapshot: FireControlView, now: number): void {
    if (this.destroyed) return;
    const delta = this.previousNow === null ? 0 : Math.max(0, now - this.previousNow);
    this.previousNow = now;
    this.animations.update(delta);
    this.store.begin(now);
    this.touchedLights.clear();
    const liveCopies = new Set<string>(), livePortals = new Set<number>(), liveRelays = new Set<number>();
    for (const deployment of snapshot.deployments) {
      // Holo-Offensive: eigener Darstellungszweig ohne Projektor und Strahl folgt mit E1.
      if (deployment.kind === 'holo') continue;
      if (deployment.kind === 'portal') {
        livePortals.add(deployment.id);
        this.portals.set(deployment.id, { snapshot: deployment });
        continue;
      }
      liveRelays.add(deployment.id);
      this.updateRelay(deployment, now);
      this.store.add({ x: deployment.x, y: deployment.y, radius: 12, angle: 0, kind: Kind.Projector,
        open: clamp((now-deployment.startedAt)/400), remaining: 1, flash: 0 });
      for (const copy of deployment.copies) {
        liveCopies.add(copy.sourceId);
        let visual = this.copies.get(copy.sourceId);
        if (!visual && copy.weaponId in TURRET_VISUALS && this.copies.size < 64) {
          const weapon = copy.weaponId as TurretWeaponId, spec = getTurretVisualSpec(weapon);
          const sprite = this.scene.add.sprite(copy.x, copy.y, spec.asset.sheetTextureKey, spec.asset.idleFrame)
            .setDisplaySize(spec.displaySize, spec.displaySize).setDepth(DEPTH.ROCKS + 0.2);
          sprite.name = copy.sourceId;
          this.animations.bind(copy.sourceId, sprite, weapon);
          visual = { sprite, filter: new FireControlHologramFilter(sprite, this.preset), copy,
            expiresAt: deployment.expiresAt, projector: { x: deployment.x, y: deployment.y, startedAt: deployment.startedAt } };
          this.copies.set(copy.sourceId, visual);
        }
        if (!visual) continue;
        visual.copy = copy; visual.expiresAt = deployment.expiresAt;
        visual.projector = { x: deployment.x, y: deployment.y, startedAt: deployment.startedAt };
        visual.removedAt = undefined; visual.removedMaterialize = undefined;
        this.animations.syncPose(copy.sourceId, copy.x, copy.y, copy.angle, false);
      }
    }
    for (const [id, relay] of this.relays) {
      if (!liveRelays.has(id)) relay.removedAt ??= now;
      const alpha = relay.removedAt === undefined ? 1 : 1 - clamp((now - relay.removedAt) / 300);
      if (alpha <= 0) { relay.sprite.destroy(); this.relays.delete(id); }
      else {
        relay.sprite.setAlpha(alpha);
        this.light(`relay:${id}`, relay.sprite.x, relay.sprite.y, 28, 3.8 * alpha);
      }
    }
    for (const [id, v] of this.copies) {
      if (!liveCopies.has(id) && v.removedAt === undefined) {
        v.removedAt = now;
        v.removedMaterialize = clamp(1-(v.copy.materializedAt-now)/400);
      }
      const vanish = v.removedAt === undefined ? 0 : clamp((now-v.removedAt)/300);
      if (vanish >= 1) {
        v.filter.destroy(); v.sprite.destroy(); this.copies.delete(id); this.shotAt.delete(id); continue;
      }
      Object.assign(v.filter.uniforms, { time: this.store.time, preset: this.preset,
        materialize: v.removedMaterialize ?? clamp(1-(v.copy.materializedAt-now)/400), vanish,
        warning: clamp(1-(v.expiresAt-now)/2000) });
      this.beam(id, v, now, vanish);
      this.light(`copy:${id}`, v.copy.x, v.copy.y, 40, 2.4 * v.filter.uniforms.materialize * (1-vanish));
    }
    for (const [id, v] of this.portals) {
      if (!livePortals.has(id) && v.removedAt === undefined) {
        v.removedAt = now; v.removedOpen = clamp((now-v.snapshot.startedAt)/400);
      }
      const d = v.snapshot;
      const close = v.removedAt === undefined ? 1 : 1-clamp((now-v.removedAt)/300);
      if (close <= 0) { this.portals.delete(id); continue; }
      const open = (v.removedOpen ?? clamp((now-d.startedAt)/400)) * close;
      let flash = 0;
      for (const entry of d.entries) {
        const age = entry.lastTransportAt === undefined ? Infinity : now-entry.lastTransportAt;
        const f = age >= 0 && entry.mode === 'portal' ? 1-clamp(age/FLASH_MS) : 0;
        flash = Math.max(flash, f);
        // Mode look (dimmed waiting, contracted dark local) lives in the shader; size stays readable.
        this.store.add({ x: entry.x, y: entry.y, radius: ENTRY_RADIUS, angle: entry.angle, kind: Kind.Entry,
          open, remaining: 0, flash: f,
          mode: entry.mode === 'portal' ? 0 : entry.mode === 'waiting' ? 1 : 2 });
        // Every source gets its own directed exit burst, so simultaneous shots in different
        // directions all read at the shared exit.
        if (f > 0) this.store.add({ x: d.x, y: d.y, radius: EXIT_RADIUS, angle: entry.angle,
          kind: Kind.ExitFlash, open, remaining: 0, flash: f });
        this.light(`entry:${id}:${entry.sourceId}`, entry.x, entry.y, 40,
          open * (entry.mode === 'portal' ? 4.2 + f : entry.mode === 'waiting' ? 1.8 : .4));
      }
      this.store.add({ x: d.x, y: d.y, radius: EXIT_RADIUS, angle: 0, kind: Kind.Exit, open,
        remaining: clamp((d.expiresAt-now)/Math.max(1,d.expiresAt-d.startedAt)), flash });
      this.light(`exit:${id}`, d.x, d.y, 62, open * (3.2 + flash * 1.5));
    }
    const pausedIds = getPausedOriginalIds(snapshot);
    for (const [id, value] of this.paused) {
      if (!pausedIds.has(id) || this.original(id)?.sprite !== value.sprite || value.sprite.isDestroyed) {
        if (!value.sprite.isDestroyed) value.sprite.filters?.internal.remove(value.filter);
        this.paused.delete(id);
      }
    }
    for (const id of pausedIds) {
      const target = this.original(id);
      if (!target || target.sprite.isDestroyed) continue;
      if (!this.paused.has(id) && this.layer) {
        target.sprite.enableFilters();
        const filter = target.sprite.filters!.internal.addColorMatrix();
        filter.colorMatrix.grayscale(1); filter.colorMatrix.brightness(.42, true);
        this.paused.set(id, { sprite: target.sprite, filter });
      }
      this.store.add({ x: target.x, y: target.y, radius: 20, angle: 0, kind: Kind.TransferRing,
        open: 1, remaining: 1, flash: 0 });
      this.light(`paused:${id}`, target.x, target.y, 64, 1.4);
    }
    for (const key of this.lightKeys) if (!this.touchedLights.has(key)) {
      this.lighting?.releaseLight(key, { immediate: true }); this.lightKeys.delete(key);
    }
  }
  /**
   * Persistent projection beam from the projector lens to one copy. It is brighter while the
   * copy materializes, settles to a steady glow, flares when the copy fires and follows the
   * copy's vanish. Never drawn across map distances.
   */
  private beam(id: string, v: CopyVisual, now: number, vanish: number): void {
    const { x, y, startedAt } = v.projector;
    const length = Math.hypot(v.copy.x - x, v.copy.y - y);
    if (length < 4 || length > BEAM_MAX_LENGTH) return;
    const settle = clamp((now - startedAt) / BEAM_SETTLE_MS);
    const presence = Math.max(.35, v.filter.uniforms.materialize) * (1 - vanish);
    const shot = this.shotAt.get(id);
    const flash = shot === undefined ? 0 : 1 - clamp((now - shot) / BEAM_SHOT_MS);
    this.store.add({ x, y, radius: length, length, angle: Math.atan2(v.copy.y - y, v.copy.x - x),
      kind: Kind.Filament, open: presence * (.72 + .28 * (1 - settle)), remaining: 1, flash,
      seed: v.copy.originalId });
  }
  private updateRelay(deployment: FireControlCopiesDeploymentSnapshot, now: number): void {
    let relay = this.relays.get(deployment.id);
    if (!relay && this.scene.textures.exists(FIRE_CONTROL_RELAY.sheetTextureKey)) {
      const sprite = this.scene.add.sprite(deployment.x, deployment.y, FIRE_CONTROL_RELAY.sheetTextureKey)
        .setOrigin(...FIRE_CONTROL_RELAY.pivot).setDisplaySize(FIRE_CONTROL_RELAY_SIZE, FIRE_CONTROL_RELAY_SIZE)
        .setDepth(DEPTH.ROCKS + 0.1);
      sprite.name = `fire-control-relay:${deployment.id}`;
      relay = { sprite }; this.relays.set(deployment.id, relay);
    }
    if (!relay) return;
    relay.removedAt = undefined;
    relay.sprite.setPosition(deployment.x, deployment.y).setAlpha(1)
      .setFrame(fireControlRelayFrame(now - deployment.startedAt));
  }
  private light(id: string, x: number, y: number, radiusPx: number, intensity: number): void {
    if (!this.lighting) return;
    const key = `fc-visual:${id}`;
    this.lightKeys.add(key); this.touchedLights.add(key);
    // Small neutral mint sources protect the hue in the under-player lightmap receiver band.
    this.lighting.setLight(key, 'electricField', x, y, { color: 0x7dffd2, radiusPx, intensity, occludes: false });
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const v of this.copies.values()) { v.filter.destroy(); v.sprite.destroy(); }
    for (const relay of this.relays.values()) relay.sprite.destroy();
    this.relays.clear();
    this.copies.clear(); this.portals.clear(); this.animations.clear(); this.shotAt.clear();
    for (const { sprite, filter } of this.paused.values()) if (!sprite.isDestroyed) sprite.filters?.internal.remove(filter);
    this.paused.clear(); this.store.clear(); this.layer?.destroy();
    for (const key of this.lightKeys) this.lighting?.releaseLight(key, { immediate: true });
    this.lightKeys.clear(); this.touchedLights.clear();
  }
}
