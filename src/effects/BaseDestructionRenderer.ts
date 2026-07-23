import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { BaseSpec } from '../arena/BaseRegistry';
import type { FireChunkTarget } from '../types';
import { buildBaseDestructionPlan } from './BaseDestructionPlan';

// HE-Granate: 120 px. Pro Rasterfeld bleibt die Basisexplosion mit 88 px kleiner,
// ist aber deutlich kräftiger als die bisherige 42-px-Fassung.
const CELL_EXPLOSION_RADIUS = CELL_SIZE * 2.75;
const CELL_EXPLOSION_COLOR = 0xff641f;
const CELL_EXPLOSION_SOUND_VOLUME_SCALE = 0.72;
const CHUNK_FLIGHT_MS = 360;

export interface BaseDestructionHooks {
  readonly playExplosion?: (x: number, y: number, radius: number, color: number) => void;
  readonly playExplosionSound?: (x: number, y: number, volumeScale: number) => void;
  readonly playFireChunks?: (
    x: number,
    y: number,
    targets: readonly FireChunkTarget[],
    landsAt: number,
    now: number,
  ) => void;
  readonly onFireChunksLanded?: (
    baseId: string,
    cellIndex: number,
    targets: readonly FireChunkTarget[],
    landedAt: number,
  ) => void;
}

/**
 * Round-scoped Komposition aus vorhandener Explosion und vorhandenen Feuerbrocken.
 * Die Basis-Entity behält ihre Zellbilder bis zum jeweiligen Schritt und gibt sie
 * über `destroyCellVisual` passend zur Explosion frei.
 */
export class BaseDestructionRenderer {
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hooks: BaseDestructionHooks = {},
  ) {}

  play(spec: BaseSpec, destroyCellVisual: (cellIndex: number) => void): void {
    if (this.destroyed) return;

    for (const step of buildBaseDestructionPlan(spec)) {
      let timer: Phaser.Time.TimerEvent;
      timer = this.scene.time.delayedCall(step.delayMs, () => {
        this.timers.delete(timer);
        if (this.destroyed) return;

        destroyCellVisual(step.cellIndex);
        this.hooks.playExplosion?.(step.x, step.y, CELL_EXPLOSION_RADIUS, CELL_EXPLOSION_COLOR);
        this.hooks.playExplosionSound?.(
          step.x,
          step.y,
          CELL_EXPLOSION_SOUND_VOLUME_SCALE,
        );

        const now = Date.now();
        const landsAt = now + CHUNK_FLIGHT_MS;
        this.hooks.playFireChunks?.(
          step.x,
          step.y,
          step.chunkTargets,
          landsAt,
          now,
        );
        if (this.hooks.onFireChunksLanded) {
          let landingTimer: Phaser.Time.TimerEvent;
          landingTimer = this.scene.time.delayedCall(CHUNK_FLIGHT_MS, () => {
            this.timers.delete(landingTimer);
            if (this.destroyed) return;
            this.hooks.onFireChunksLanded?.(
              spec.id,
              step.cellIndex,
              step.chunkTargets,
              Date.now(),
            );
          });
          this.timers.add(landingTimer);
        }
      });
      this.timers.add(timer);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const timer of this.timers) timer.remove(false);
    this.timers.clear();
  }
}
