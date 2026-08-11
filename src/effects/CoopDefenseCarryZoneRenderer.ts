import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import {
  getCoopDefenseMapObjectiveZoneWorldRect,
  type ResolvedCoopDefenseMapSecondaryObjectiveConfig,
} from '../config/coopDefenseMaps';
import type {
  CoopDefenseSecondaryObjectivePresentationState,
} from '../types';

interface CarryZoneVisual {
  readonly spawn: Phaser.GameObjects.Image;
  readonly delivery: Phaser.GameObjects.Image;
}

/** World-space presentation for the two authored zones of an active Carry objective. */
export class CoopDefenseCarryZoneRenderer {
  private readonly visuals = new Map<string, CarryZoneVisual>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly arenaMask: Phaser.Display.Masks.GeometryMask | null = null,
  ) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.clear());
  }

  sync(
    snapshot: CoopDefenseSecondaryObjectivePresentationState | null,
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    active: boolean,
  ): void {
    const visible = new Map<string, boolean>();
    if (active && snapshot) {
      for (const entry of snapshot) {
        if (entry.state !== 'active') continue;
        const config = configs.find((candidate) => candidate.id === entry.objectiveId);
        if (config?.type !== 'carry' || !config.carry) continue;
        visible.set(entry.objectiveId, entry.focused);
      }
    }

    for (const [objectiveId, focused] of visible) {
      const config = configs.find((candidate) => candidate.id === objectiveId);
      if (!config?.carry) continue;
      const spawnRect = getCoopDefenseMapObjectiveZoneWorldRect(config.carry.spawnZone);
      const deliveryRect = getCoopDefenseMapObjectiveZoneWorldRect(config.carry.deliveryZone);
      const visual = this.visuals.get(objectiveId) ?? this.createVisual(objectiveId);
      visual.spawn
        .setPosition(spawnRect.x + spawnRect.width * 0.5, spawnRect.y + spawnRect.height * 0.5)
        .setDisplaySize(spawnRect.width, spawnRect.height)
        .setAlpha(focused ? 0.92 : 0.58)
        .setVisible(true);
      visual.delivery
        .setPosition(deliveryRect.x + deliveryRect.width * 0.5, deliveryRect.y + deliveryRect.height * 0.5)
        .setDisplaySize(deliveryRect.width, deliveryRect.height)
        .setAlpha(focused ? 0.96 : 0.62)
        .setVisible(true);
    }

    for (const [objectiveId, visual] of this.visuals) {
      if (visible.has(objectiveId)) continue;
      visual.spawn.setVisible(false);
      visual.delivery.setVisible(false);
    }
  }

  clear(): void {
    for (const visual of this.visuals.values()) {
      visual.spawn.destroy();
      visual.delivery.destroy();
    }
    this.visuals.clear();
  }

  private createVisual(objectiveId: string): CarryZoneVisual {
    const spawn = this.scene.add.image(0, 0, 'mission_carry_spawn_zone')
      .setOrigin(0.5)
      .setDepth(DEPTH.BASES - 0.15)
      .setVisible(false);
    const delivery = this.scene.add.image(0, 0, 'mission_carry_delivery_zone')
      .setOrigin(0.5)
      .setDepth(DEPTH.BASES - 0.1)
      .setVisible(false);
    if (this.arenaMask) {
      spawn.setMask(this.arenaMask);
      delivery.setMask(this.arenaMask);
    }
    const visual = { spawn, delivery };
    this.visuals.set(objectiveId, visual);
    return visual;
  }
}
