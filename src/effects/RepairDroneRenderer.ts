import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../config';
import type { SyncedPlaceableRock, SyncedRepairDrone } from '../types';
import {
  REPAIR_DRONE_SMOOTH_TIME_MS as SMOOTH_TIME_MS,
  createRepairDroneBody,
  createRepairDroneShadow,
  updateRepairDroneShadow,
  updateRepairDroneRotors,
} from './repairDroneVisuals';
import { getRepairDroneWorkProbe, RepairDroneEffects } from './RepairDroneEffects';
import type { LightingSystem } from './LightingSystem';
import { DRONE_NAV_LIGHT_PROFILES } from './droneNavLights/DroneNavLightModel';
import type { DroneNavLightRenderer } from './droneNavLights/DroneNavLightRenderer';

interface RepairDroneVisual {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  effects: RepairDroneEffects;
  ownerColor: number;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  repairTarget?: { id: string; x: number; y: number };
}

/** Top-down repair drone with a host-synchronized repair beam. */
export class RepairDroneRenderer {
  private readonly visuals = new Map<string, RepairDroneVisual>();
  private lighting: LightingSystem | null = null;
  private navLights: Pick<DroneNavLightRenderer, 'submit'> | null = null;

  setNavLights(lights: Pick<DroneNavLightRenderer, 'submit'> | null): void { this.navLights = lights; }

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
    for (const visual of this.visuals.values()) visual.effects.setLightingSystem(lighting);
  }

  syncVisuals(
    snapshots: readonly SyncedRepairDrone[],
    constructions: readonly SyncedPlaceableRock[],
  ): void {
    const activeOwners = new Set(snapshots.map(snapshot => snapshot.ownerId));
    for (const [ownerId, visual] of this.visuals) {
      if (activeOwners.has(ownerId)) continue;
      this.destroyVisual(visual);
      this.visuals.delete(ownerId);
    }

    const constructionPositions = new Map(
      constructions
        .filter(construction => construction.constructionId)
        .map(construction => [
          construction.id,
          {
            id: String(construction.id),
            x: ARENA_OFFSET_X + construction.gridX * CELL_SIZE + CELL_SIZE * 0.5,
            y: ARENA_OFFSET_Y + construction.gridY * CELL_SIZE + CELL_SIZE * 0.5,
          },
        ]),
    );
    for (const snapshot of snapshots) {
      let visual = this.visuals.get(snapshot.ownerId);
      if (!visual) {
        visual = this.createVisual(snapshot);
        this.visuals.set(snapshot.ownerId, visual);
      }
      visual.targetX = snapshot.x;
      visual.targetY = snapshot.y;
      visual.ownerColor = snapshot.ownerColor;
      visual.repairTarget = snapshot.phase === 'repairing' && snapshot.targetConstructionId !== undefined
        ? constructionPositions.get(snapshot.targetConstructionId)
        : undefined;
    }
  }

  update(delta: number): void {
    const lerp = 1 - Math.exp(-Math.max(0, delta) / SMOOTH_TIME_MS);
    const now = this.scene.time.now;
    for (const [ownerId, visual] of this.visuals) {
      visual.currentX = Phaser.Math.Linear(visual.currentX, visual.targetX, lerp);
      visual.currentY = Phaser.Math.Linear(visual.currentY, visual.targetY, lerp);
      const bob = Math.sin(now * 0.008 + ownerId.length) * 2;
      visual.body.setPosition(visual.currentX, visual.currentY + bob);
      const aim = visual.repairTarget ?? { x: visual.targetX, y: visual.targetY };
      const dx = aim.x - visual.currentX, dy = aim.y - visual.currentY;
      if (Math.hypot(dx, dy) > 0.5) visual.body.setRotation(Math.atan2(dy, dx) + Math.PI / 2);
      updateRepairDroneRotors(visual.body, now);
      updateRepairDroneShadow(visual.shadow, visual.body, visual.currentX, visual.currentY);
      if (visual.body.visible) this.navLights?.submit(visual.body.x, visual.body.y,
        visual.body.rotation - Math.PI / 2, visual.body.alpha, DRONE_NAV_LIGHT_PROFILES.repairDrone, visual.body);
      const target = visual.repairTarget;
      // Constructions occupy one grid cell. Land the work at its facing edge,
      // rather than drawing through the turret into the center of its tile.
      const halfCell = CELL_SIZE * 0.5;
      const probe = getRepairDroneWorkProbe(visual.body);
      const contact = target ? {
        id: target.id,
        x: Math.max(target.x - halfCell, Math.min(target.x + halfCell, probe.x)),
        y: Math.max(target.y - halfCell, Math.min(target.y + halfCell, probe.y)),
      } : null;
      visual.effects.update(visual.body, contact, now, 1, visual.ownerColor);
    }
  }

  destroyAll(): void {
    for (const visual of this.visuals.values()) this.destroyVisual(visual);
    this.visuals.clear();
  }

  private createVisual(snapshot: SyncedRepairDrone): RepairDroneVisual {
    const effects = new RepairDroneEffects(this.scene, `repair-drone:player:${snapshot.ownerId}`);
    effects.setLightingSystem(this.lighting);

    return {
      body: createRepairDroneBody(this.scene, snapshot.x, snapshot.y),
      shadow: createRepairDroneShadow(this.scene, snapshot.x, snapshot.y),
      effects,
      ownerColor: snapshot.ownerColor,
      currentX: snapshot.x,
      currentY: snapshot.y,
      targetX: snapshot.x,
      targetY: snapshot.y,
    };
  }

  private destroyVisual(visual: RepairDroneVisual): void {
    visual.body.destroy();
    visual.shadow.destroy();
    visual.effects.destroy();
  }
}
