import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import type { RockWorldFrame } from '../ArenaBuilder';
import {
  ARENA_RENDER_CHUNK_PREFETCH_MARGIN_PX,
  ArenaChunkGrid,
  worldRectToLocalRect,
} from '../chunks/ArenaChunkGrid';
import type { ChunkWorldRect } from '../chunks/ArenaChunkGrid';
import type { RockGpuPageSize } from './RockRendererSettings';
import type { RockVisualState } from './RockVisualState';
import { resolveRockCornerTints } from './RockVisualState';

const BUFFER_SEGMENTS = 24;
const FULL_UPLOAD_SEGMENT_THRESHOLD = 12;

export interface PersistentGpuWorldDiagnostics {
  readonly pageSize: RockGpuPageSize;
  readonly pageCount: number;
  readonly visiblePages: number;
  readonly capacity: number;
  readonly bufferBytes: number;
  readonly dirtyRocks: number;
  readonly affectedPages: number;
  readonly dirtyBufferSegments: number;
  readonly sparseUploads: number;
  readonly fullUploads: number;
  readonly estimatedUploadBytes: number;
}

interface RockGpuVisualHandle {
  readonly pageKey: number;
  readonly slot: number;
}

interface RockGpuPage {
  wallLayer?: Phaser.GameObjects.SpriteGPULayer;
  readonly key: number;
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  readonly slotOwners: Int32Array;
}

/**
 * Persistenter, eventgetriebener GPU-Renderer fuer Rock-Grundquads. Jede Rasterzelle besitzt
 * deterministisch genau einen Page-Slot; Slots werden nie verschoben oder freigegeben.
 */
export class PersistentGpuWorldSystem {
  readonly grid: ArenaChunkGrid;
  private readonly pagePixels: number;
  private readonly cellsPerPage: number;
  private readonly slotsPerPage: number;
  private readonly texture: Phaser.Textures.Texture;
  private readonly pages = new Map<number, RockGpuPage>();
  private readonly handles: Array<RockGpuVisualHandle | undefined> = [];
  private visiblePageKeys = new Set<number>();
  private diagnostics: PersistentGpuWorldDiagnostics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly frame: RockWorldFrame,
    private readonly states: readonly (RockVisualState | undefined)[],
    private readonly configuredPageSize: RockGpuPageSize,
  ) {
    this.pagePixels = configuredPageSize === 'global'
      ? Math.ceil(Math.max(frame.width, frame.height) / 128) * 128
      : configuredPageSize;
    this.cellsPerPage = this.pagePixels / CELL_SIZE;
    this.slotsPerPage = this.cellsPerPage * this.cellsPerPage;
    this.grid = new ArenaChunkGrid(frame.width, frame.height, this.pagePixels);
    this.texture = this.scene.textures.get('rocks');
    this.buildPages();
    this.diagnostics = this.emptyDiagnostics();
    this.applyDirty(states.filter(state => state?.material === 'walls').map(state => state!.id));
  }

  applyDirty(ids: readonly number[]): void {
    const dirtySegments = new Map<number, Set<number>>();
    let dirtyRocks = 0;

    for (const id of ids) {
      const state = this.states[id];
      if (!state) continue;
      const handle = this.handles[id] ?? this.resolveHandle(state);
      const page = this.pages.get(handle.pageKey);
      if (!page) continue;
      page.slotOwners[handle.slot] = state.active ? id : -1;
      const wall = state.material === 'walls';
      page.layer.editMember(handle.slot, wall ? this.deadMember(state.gridX, state.gridY) : this.memberFor(state));
      const wallLayer = wall ? this.ensureWallLayer(page) : page.wallLayer;
      wallLayer?.editMember(handle.slot, wall ? this.memberFor(state)
        : this.deadMember(state.gridX, state.gridY, this.scene.textures.get('walls')));
      this.handles[id] = handle;
      const segment = Math.min(
        BUFFER_SEGMENTS - 1,
        Math.floor(handle.slot / Math.max(1, page.layer.bufferUpdateSegmentSize)),
      );
      let segments = dirtySegments.get(handle.pageKey);
      if (!segments) dirtySegments.set(handle.pageKey, segments = new Set<number>());
      segments.add(segment);
      dirtyRocks += 1;
    }

    let segmentCount = 0;
    let sparseUploads = 0;
    let fullUploads = 0;
    let estimatedUploadBytes = 0;
    for (const [pageKey, segments] of dirtySegments) {
      const page = this.pages.get(pageKey)!;
      const stride = page.layer.getDataByteSize();
      const materials = page.wallLayer ? 2 : 1;
      segmentCount += segments.size * materials;
      if (segments.size >= FULL_UPLOAD_SEGMENT_THRESHOLD) {
        page.layer.setAllSegmentsNeedUpdate();
        page.wallLayer?.setAllSegmentsNeedUpdate();
        fullUploads += materials;
        estimatedUploadBytes += this.slotsPerPage * stride * materials;
      } else {
        sparseUploads += segments.size * materials;
        estimatedUploadBytes += segments.size * page.layer.bufferUpdateSegmentSize * stride * materials;
      }
    }

    const previous = this.diagnostics;
    this.diagnostics = {
      ...this.emptyDiagnostics(),
      dirtyRocks: previous.dirtyRocks + dirtyRocks,
      affectedPages: previous.affectedPages + dirtySegments.size,
      dirtyBufferSegments: previous.dirtyBufferSegments + segmentCount,
      sparseUploads: previous.sparseUploads + sparseUploads,
      fullUploads: previous.fullUploads + fullUploads,
      estimatedUploadBytes: previous.estimatedUploadBytes + estimatedUploadBytes,
    };
  }

  updateVisibility(view: ChunkWorldRect): void {
    const wanted = new Set(this.grid.chunksInLocalRect(
      worldRectToLocalRect(view, this.frame),
      ARENA_RENDER_CHUNK_PREFETCH_MARGIN_PX,
    ).map((chunk) => this.grid.key(chunk.cx, chunk.cy)));
    for (const key of this.visiblePageKeys) {
      if (!wanted.has(key)) this.pages.get(key)?.layer.setVisible(false);
    }
    for (const key of wanted) {
      if (!this.visiblePageKeys.has(key)) this.pages.get(key)?.layer.setVisible(true);
    }
    this.visiblePageKeys = wanted;
    for (const page of this.pages.values()) page.wallLayer?.setVisible(wanted.has(page.key));
    this.diagnostics = { ...this.diagnostics, visiblePages: wanted.size };
  }

  getDiagnostics(): PersistentGpuWorldDiagnostics {
    return this.diagnostics;
  }

  destroy(): void {
    for (const page of this.pages.values()) { page.layer.destroy(); page.wallLayer?.destroy(); }
    this.pages.clear();
    this.handles.length = 0;
    this.visiblePageKeys.clear();
  }

  private buildPages(): void {
    const stateByCell = new Map<string, RockVisualState>();
    for (const state of this.states) {
      if (state?.active) stateByCell.set(`${state.gridX}:${state.gridY}`, state);
    }

    for (let cy = 0; cy < this.grid.rows; cy += 1) {
      for (let cx = 0; cx < this.grid.cols; cx += 1) {
        const key = this.grid.key(cx, cy);
        const layer = this.scene.add.spriteGPULayer(this.texture, this.slotsPerPage)
          .setDepth(DEPTH.ROCKS)
          .setBlendMode(Phaser.BlendModes.NORMAL)
          .setVisible(false);
        const slotOwners = new Int32Array(this.slotsPerPage).fill(-1);
        for (let localY = 0; localY < this.cellsPerPage; localY += 1) {
          for (let localX = 0; localX < this.cellsPerPage; localX += 1) {
            const gridX = cx * this.cellsPerPage + localX;
            const gridY = cy * this.cellsPerPage + localY;
            const state = stateByCell.get(`${gridX}:${gridY}`);
            const slot = localY * this.cellsPerPage + localX;
            layer.addMember(state && state.material !== 'walls' ? this.memberFor(state) : this.deadMember(gridX, gridY));
            if (state) {
              slotOwners[slot] = state.id;
              this.handles[state.id] = { pageKey: key, slot };
            }
          }
        }
        this.pages.set(key, { key, layer, slotOwners });
      }
    }
  }

  private resolveHandle(state: RockVisualState): RockGpuVisualHandle {
    const cx = Math.max(0, Math.min(this.grid.cols - 1, Math.floor(state.gridX / this.cellsPerPage)));
    const cy = Math.max(0, Math.min(this.grid.rows - 1, Math.floor(state.gridY / this.cellsPerPage)));
    const localX = ((state.gridX % this.cellsPerPage) + this.cellsPerPage) % this.cellsPerPage;
    const localY = ((state.gridY % this.cellsPerPage) + this.cellsPerPage) % this.cellsPerPage;
    return { pageKey: this.grid.key(cx, cy), slot: localY * this.cellsPerPage + localX };
  }

  /** Allocate a second material only in chunks which actually contain constructed walls. */
  private ensureWallLayer(page: RockGpuPage): Phaser.GameObjects.SpriteGPULayer {
    if (page.wallLayer) return page.wallLayer;
    const texture = this.scene.textures.get('walls');
    const layer = this.scene.add.spriteGPULayer(texture, this.slotsPerPage)
      .setDepth(DEPTH.ROCKS).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(this.visiblePageKeys.has(page.key));
    for (let slot = 0; slot < this.slotsPerPage; slot++) layer.addMember(this.deadMember(0, 0, texture));
    page.wallLayer = layer;
    return layer;
  }

  private memberFor(state: RockVisualState): Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member> {
    const texture = state.material === 'walls' ? this.scene.textures.get('walls') : this.texture;
    if (!state.active) return this.deadMember(state.gridX, state.gridY, texture);
    const [topLeft, topRight, bottomLeft, bottomRight] = resolveRockCornerTints(state);
    return {
      x: state.x,
      y: state.y,
      frame: texture.get(state.frame),
      scaleX: state.scaleX,
      scaleY: state.scaleY,
      alpha: state.alpha,
      tintBlend: 1,
      tintTopLeft: topLeft,
      tintTopRight: topRight,
      tintBottomLeft: bottomLeft,
      tintBottomRight: bottomRight,
    };
  }

  private deadMember(gridX: number, gridY: number, texture = this.texture): Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member> {
    return {
      x: this.frame.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2,
      y: this.frame.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2,
      frame: texture.get(0),
      scaleX: 0,
      scaleY: 0,
      alpha: 0,
    };
  }

  private emptyDiagnostics(): PersistentGpuWorldDiagnostics {
    const first = this.pages.values().next().value as RockGpuPage | undefined;
    const stride = first?.layer.getDataByteSize() ?? 0;
    const layers = this.pages.size + [...this.pages.values()].filter(page => page.wallLayer).length;
    return {
      pageSize: this.configuredPageSize,
      pageCount: this.pages.size,
      visiblePages: this.visiblePageKeys.size,
      capacity: layers * this.slotsPerPage,
      bufferBytes: layers * this.slotsPerPage * stride,
      dirtyRocks: 0,
      affectedPages: 0,
      dirtyBufferSegments: 0,
      sparseUploads: 0,
      fullUploads: 0,
      estimatedUploadBytes: 0,
    };
  }
}
