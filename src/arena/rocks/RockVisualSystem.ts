import * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import type { RockWorldFrame } from '../ArenaBuilder';
import type { ChunkWorldRect } from '../chunks/ArenaChunkGrid';
import { ClassicRockRenderer } from './ClassicRockRenderer';
import { PersistentGpuWorldSystem } from './PersistentGpuWorldSystem';
import type { PersistentGpuWorldDiagnostics } from './PersistentGpuWorldSystem';
import type { RockGpuPageSize, RockRendererMode } from './RockRendererSettings';
import { RockVisualStateStore, resolveRockCornerTints } from './RockVisualState';

export interface RockDestructionVisualSnapshot {
  readonly x: number;
  readonly y: number;
  readonly frame: number;
  readonly size: number;
  readonly tint: number;
  readonly angle: number;
  readonly alpha: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

type ActiveRenderer = ClassicRockRenderer | PersistentGpuWorldSystem;

/** Umschaltbare Render-Fassade; Gameplay sieht weder Images noch GPU-Handles. */
export class RockVisualSystem {
  private renderer: ActiveRenderer;
  private readonly flushBeforeRender = (): void => this.flush();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly frame: RockWorldFrame,
    readonly store: RockVisualStateStore,
    private mode: RockRendererMode,
    private pageSize: RockGpuPageSize,
  ) {
    this.renderer = this.createRenderer();
    this.store.clearDirty();
    this.scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.flushBeforeRender);
  }

  flush(): void {
    this.renderer.applyDirty(this.store.consumeDirtyIds());
  }

  updateVisibility(view: ChunkWorldRect): void {
    this.renderer.updateVisibility(view);
  }

  setMode(mode: RockRendererMode): void {
    if (mode === this.mode) return;
    this.renderer.destroy();
    this.mode = mode;
    this.renderer = this.createRenderer();
    this.store.clearDirty();
  }

  setPageSize(pageSize: RockGpuPageSize): void {
    if (pageSize === this.pageSize) return;
    this.pageSize = pageSize;
    if (this.mode !== 'spriteGpu') return;
    this.renderer.destroy();
    this.renderer = this.createRenderer();
    this.store.clearDirty();
  }

  getMode(): RockRendererMode {
    return this.mode;
  }

  getPageSize(): RockGpuPageSize {
    return this.pageSize;
  }

  getGpuDiagnostics(): PersistentGpuWorldDiagnostics | null {
    return this.renderer instanceof PersistentGpuWorldSystem
      ? this.renderer.getDiagnostics()
      : null;
  }

  getDestructionSnapshot(id: number): RockDestructionVisualSnapshot | null {
    const state = this.store.get(id);
    if (!state?.active) return null;
    return {
      x: state.x,
      y: state.y,
      frame: state.frame,
      size: CELL_SIZE,
      tint: resolveRockCornerTints(state)[0],
      angle: 0,
      alpha: state.alpha,
      scaleX: state.scaleX,
      scaleY: state.scaleY,
    };
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.flushBeforeRender);
    this.renderer.destroy();
    this.store.clear();
  }

  private createRenderer(): ActiveRenderer {
    return this.mode === 'spriteGpu'
      ? new PersistentGpuWorldSystem(this.scene, this.frame, this.store.states, this.pageSize)
      : new ClassicRockRenderer(this.scene, this.frame, this.store.states);
  }
}
