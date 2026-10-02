import * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import type { RockWorldFrame } from '../ArenaBuilder';
import type { ChunkWorldRect } from '../chunks/ArenaChunkGrid';
import { ClassicRockRenderer } from './ClassicRockRenderer';
import { PersistentGpuWorldSystem } from './PersistentGpuWorldSystem';
import type { PersistentGpuWorldDiagnostics } from './PersistentGpuWorldSystem';
import type { RockGpuPageSize, RockRendererMode } from './RockRendererSettings';
import { RockVisualStateStore, resolveRockCornerTints, resolveRockTexture } from './RockVisualState';
import { updateRockLightingSun, type RockLightingState } from './RockLightingState';
import { WOODLAND_ROCK_HEIGHT_KEY, WOODLAND_ROCK_COLOUR_KEY } from '../../assets/WoodlandAssetManifest';
import { RockFormationLighting } from './RockFormationLighting';

export interface RockDestructionVisualSnapshot {
  readonly material?: 'rocks' | 'walls';
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
  private formation: RockFormationLighting | null = null;
  private view: ChunkWorldRect | null = null;
  private readonly relief: RockLightingState = { enabled: false, normals: false, strength: 0, sun: [0, 0, 1] };
  private readonly flushBeforeRender = (): void => this.flush();
  private presentationCpuMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly frame: RockWorldFrame,
    readonly store: RockVisualStateStore,
    private mode: RockRendererMode,
    private pageSize: RockGpuPageSize,
    woodland = false,
  ) {
    if(woodland) {
      Object.assign(this.relief,{enabled:true,material:'mineral',selfShadow:true,colourTextureKey:WOODLAND_ROCK_COLOUR_KEY});
      this.formation=new RockFormationLighting(scene,frame,store.states,this.relief,WOODLAND_ROCK_HEIGHT_KEY);
    }
    this.renderer = this.createRenderer();
    this.store.clearDirty();
    this.scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.flushBeforeRender);
  }

  flush(): void {
    const started = performance.now();
    const ids = this.store.consumeDirtyIds();
    this.renderer.applyDirty(ids);
    this.formation?.invalidate(ids);
    this.formation?.tick();
    this.presentationCpuMs += performance.now()-started;
  }

  updateVisibility(view: ChunkWorldRect): void {
    this.view = view;
    this.renderer.updateVisibility(view);
    this.formation?.updateView(view);
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

  setSunTime(minutes: number): void { updateRockLightingSun(this.relief, minutes); }
  setFormationOptions(softShadow: boolean, castShadow: boolean, clouds?: RockLightingState['clouds']): void {
    this.relief.softShadow=softShadow;this.relief.castShadow=castShadow;
    this.relief.mineralResponse=true;this.relief.clouds=clouds;
  }
  getFormationDiagnostics() { return this.formation ? {...this.formation.getDiagnostics(), presentationCpuMs:this.presentationCpuMs} : null; }
  getPreparationState(): { ready: boolean; pending: number; resident: number } {
    const formation = this.formation?.getPreparationState();
    return {
      ready: this.view !== null && this.store.pendingChanges === 0 && (formation?.ready ?? true),
      pending: this.store.pendingChanges + (formation?.pending ?? 0),
      resident: formation?.resident ?? 0,
    };
  }
  setDebugFormationSuppressed(surface: boolean, ground: boolean, foliage: boolean): void {
    this.formation?.setDebugSuppressed(surface,ground,foliage);
  }
  readonly getFormationReceiver = () => this.formation?.getReceiverBinding() ?? null;
  readonly getFormationCoverage = () => this.formation?.getCoverageBinding() ?? null;

  getGpuDiagnostics(): PersistentGpuWorldDiagnostics | null {
    return this.renderer instanceof PersistentGpuWorldSystem
      ? this.renderer.getDiagnostics()
      : null;
  }

  getDestructionSnapshot(id: number): RockDestructionVisualSnapshot | null {
    const state = this.store.get(id);
    if (!state?.active) return null;
    const formation = this.formation && state.material !== 'walls';
    const baseTint = resolveRockCornerTints(state, !!formation)[0];
    const light = formation ? this.formation!.destructionLight(state.x, state.y) : 1;
    const channel = (shift: number): number => Math.min(255, Math.round(((baseTint >>> shift) & 255) * light));
    return {
      // Landschaftsfels nutzt die Standardtextur des Trümmer-Renderers, die Felsbasis.
      material: state.material === 'walls' ? 'walls' : undefined,
      x: state.x,
      y: state.y,
      frame: resolveRockTexture(state).frame,
      size: CELL_SIZE,
      tint: (channel(16) << 16) | (channel(8) << 8) | channel(0),
      angle: 0,
      alpha: state.alpha,
      scaleX: state.scaleX,
      scaleY: state.scaleY,
    };
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.flushBeforeRender);
    this.renderer.destroy();
    this.formation?.destroy(); this.formation = null;
    this.store.clear();
  }

  private createRenderer(): ActiveRenderer {
    const renderer = this.mode === 'spriteGpu'
      ? new PersistentGpuWorldSystem(this.scene, this.frame, this.store.states, this.pageSize, this.relief)
      : new ClassicRockRenderer(this.scene, this.frame, this.store.states, this.relief);
    return renderer;
  }
}
