import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import { getTurretVisualSpec } from '../../config/turretVisuals';
import { FireControlRenderer, type FireControlEntryView, type FireControlView } from '../../effects/fireControl/FireControlRenderer';
import type { HologramPreset } from '../../effects/fireControl/FireControlHologramFilter';
import { fireControlCopySourceId, type FireControlCopySnapshot } from '../../systems/fireControl/FireControlSnapshot';
import type { TurretWeaponId } from '../../types';

export interface FireControlReviewOptions {
  hologramPreset?: HologramPreset;
  timeOfDay?: number;
  step?: 'start' | 'deploy' | 'vanish' | 'expireWarning' | 'portalOpen' | 'portalClose' | 'transport';
}
export const FIRE_CONTROL_REVIEW_SCENARIO = {
  version: 1, mapId: '4', seed: 12345, classId: 'inspector_gadachs',
  player: { gridX: 46, gridY: 30 }, hideAim: true, hideTutorial: true, suppressWaves: true, freezeMission: true,
  tools: [{ kind: 'construction', id: 'rocket_turret' }, { kind: 'construction', id: 'machine_gun_turret' }],
  upgrades: { unlock_rocket_turret: 1, unlock_machine_gun_turret: 1 },
  constructions: [
    { id: 'rocket_turret', gridX: 40, gridY: 25 }, { id: 'machine_gun_turret', gridX: 44, gridY: 25 },
    { id: 'rocket_turret', gridX: 48, gridY: 29 }, { id: 'machine_gun_turret', gridX: 52, gridY: 29 },
  ],
};

/** Synthetic read model only. Original constructions are created by the normal scenario recipe. */
export class FireControlVisualReview {
  private readonly renderer: FireControlRenderer;
  private readonly originals;
  private readonly sprites = new Map<number, { sprite: Phaser.GameObjects.Sprite; rotation: number }>();
  private startedAt: number;
  private portalStartedAt: number;
  private expiresAt: number;
  private copiesVisible = true;
  private portalVisible = true;
  private lastTick = -1;
  private lastTransportAt: number | undefined;
  private transportIndex = 0;
  private lastNow: number;
  snapshot: FireControlView = { deployments: [] };

  constructor(scene: Phaser.Scene, runtime: ArenaRuntime, options: FireControlReviewOptions, now: number) {
    this.startedAt = this.portalStartedAt = this.lastNow = now;
    this.expiresAt = now + 15000;
    this.originals = runtime.getTurretDefinitions().filter(t => typeof t.id === 'number' &&
      (t.weaponId === 'TURRET_ROCKET_BURST' || t.weaponId === 'TURRET_MG')).sort((a,b) => a.y-b.y || a.x-b.x).slice(0,4);
    if (this.originals.length !== 4) throw Error('fireControlVisualReview requires the four recipe constructions.');
    // Dev-only adapter: production renderer receives a typed lookup from its future composition owner.
    for (const t of this.originals) {
      const spec = getTurretVisualSpec(t.weaponId as TurretWeaponId);
      const sprite = scene.children.list.find(o => {
        const s = o as Phaser.GameObjects.Sprite;
        return s.type === 'Sprite' && s.texture?.key === spec.asset.sheetTextureKey && Math.hypot(s.x-t.x,s.y-t.y)<1;
      }) as Phaser.GameObjects.Sprite | undefined;
      if (!sprite) throw Error(`Original visual missing: ${t.id}`);
      this.sprites.set(t.id as number, { sprite, rotation: sprite.rotation });
    }
    this.renderer = new FireControlRenderer(scene, id => {
      const s = this.sprites.get(id), t = this.originals.find(o => o.id === id);
      return s && t ? { sprite: s.sprite, x: t.x, y: t.y } : undefined;
    }, options.hologramPreset ?? 'A', runtime.getScenarioLightingTargets().lighting);
    this.update(now);
  }
  configure(options: FireControlReviewOptions, now: number): void {
    if (options.hologramPreset) this.renderer.preset = options.hologramPreset;
    switch (options.step) {
      case 'deploy':
        this.startedAt = now; this.expiresAt = now+15000;
        this.copiesVisible = true; this.lastTick = -1; break;
      case 'start':
        this.startedAt = this.portalStartedAt = now; this.expiresAt = now+15000;
        this.copiesVisible = this.portalVisible = true; this.lastTick = -1; this.lastTransportAt = undefined; break;
      case 'vanish': this.copiesVisible = false; break;
      case 'expireWarning': this.expiresAt = now+1500; break;
      case 'portalOpen': this.portalStartedAt = now; this.portalVisible = true; break;
      case 'portalClose': this.portalVisible = false; break;
      case 'transport': this.lastTransportAt = now; this.transportIndex++; break;
    }
    this.update(now);
  }
  update(now: number): void {
    this.lastNow = now;
    const age = now-this.startedAt, tick = Math.floor((age-600)/300);
    let shot = false;
    if (tick >= 0 && tick > this.lastTick) {
      this.lastTick = tick; this.transportIndex++; this.lastTransportAt = now; shot = true;
    }
    const [rocket, mg] = this.originals;
    const copies: FireControlCopySnapshot[] = [rocket, mg].map((t,i) => ({
      sourceId: fireControlCopySourceId(1,i), originalId: t.id as number,
      constructionId: i === 0 ? 'rocket_turret' : 'machine_gun_turret', weaponId: t.weaponId!,
      x: t.x + (i === 0 ? 32 : 0), y: t.y+96, angle: 0,
      materializedAt: this.startedAt+400, status: age < 400 ? 'materializing' : 'active', originalPaused: i === 0,
    }));
    const entries: FireControlEntryView[] = this.originals.map((t,i) => {
      const angle = i < 2 ? 0 : this.transportIndex % 8 * Math.PI/4;
      this.sprites.get(t.id as number)!.sprite.setRotation(angle);
      return { sourceId: t.id, identityId: t.id as number,
        x: t.x+Math.cos(angle)*((t.muzzleOffset??18)+4), y: t.y+Math.sin(angle)*((t.muzzleOffset??18)+4), angle,
        mode: i === 0 ? 'waiting' : i === 1 ? 'local' : 'portal',
        lastTransportAt: i === 2+this.transportIndex%2 ? this.lastTransportAt : undefined };
    });
    this.snapshot = { deployments: [
      ...(this.copiesVisible ? [{ id: 1, ownerId: rocket.ownerId, ownerColor: 0x3dffd0, kind: 'copies' as const,
        x: rocket.x+64, y: rocket.y+96, startedAt: this.startedAt, expiresAt: this.expiresAt, parallel: false, copies }] : []),
      ...(this.portalVisible ? [{ id: 2, ownerId: rocket.ownerId, ownerColor: 0x3dffd0, kind: 'portal' as const,
        x: rocket.x+320, y: rocket.y+32, startedAt: this.portalStartedAt,
        expiresAt: this.expiresAt, localFireRelease: true, entries }] : []),
    ] };
    this.renderer.update(this.snapshot,now);
    if (shot && this.copiesVisible) for (const copy of copies) this.renderer.onShot(copy.sourceId);
  }
  status() {
    return { preset: this.renderer.preset, now: this.lastNow, ageMs: this.lastNow-this.startedAt,
      lastTransportAt: this.lastTransportAt, snapshot: this.snapshot, gpuInstances: this.renderer.store.count };
  }
  destroy(): void {
    this.renderer.destroy();
    for (const { sprite, rotation } of this.sprites.values()) if (!sprite.isDestroyed) sprite.setRotation(rotation);
    this.sprites.clear();
  }
}
