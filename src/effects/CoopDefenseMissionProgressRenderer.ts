import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, COLORS, DEPTH } from '../config';
import type { ResolvedCoopDefenseMapMissionProgressConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseMissionProgressPresentationState } from '../types';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { registerGraphicsObject } from './EffectUtils';
import {
  CHECKPOINT_ACTIVATION_MS,
  CHECKPOINT_FRAGMENT_SOURCE,
  CHECKPOINT_PADDING,
  CHECKPOINT_SHADER_NAME,
} from './checkpointMarkerShader';

interface CheckpointVisual {
  readonly id: string;
  readonly quad: Phaser.GameObjects.Shader;
  readonly extraction: boolean;
  readonly color: Float32Array;
  next: boolean;
  opacity: number;
  activatedAtMs: number | null;
}

function writeColor(target: Float32Array, color: number): void {
  target[0] = ((color >>> 16) & 255) / 255;
  target[1] = ((color >>> 8) & 255) / 255;
  target[2] = (color & 255) / 255;
}

function checkpointSeed(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return (hash >>> 0) % 1024;
}

/** Rein prozedurale Weltpresentation fuer Checkpoints, Extraktion und Missionstore. */
export class CoopDefenseMissionProgressRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly checkpoints: CheckpointVisual[] = [];
  private config: ResolvedCoopDefenseMapMissionProgressConfig | undefined;
  private roundRevision = -1;
  private missionRevision = -1;
  private elapsedMs = 0;
  private ambientCount = 12;
  private burstCount = 24;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(DEPTH.BASES + 7).setVisible(false);
    registerGraphicsObject(scene, 'objectiveMarkers', this.graphics);
  }

  sync(
    config: ResolvedCoopDefenseMapMissionProgressConfig | undefined,
    state: CoopDefenseMissionProgressPresentationState | null,
    elapsedMs: number,
    active: boolean,
  ): void {
    if (this.destroyed) return;
    if (!active || !config || !state) {
      this.clear();
      return;
    }
    if (this.config !== config || this.roundRevision !== state.roundRevision) {
      this.clear();
      this.config = config;
      this.roundRevision = state.roundRevision;
      this.createCheckpoints(config);
    }
    // Animation and live quality changes are independent of reliable snapshot revisions.
    this.elapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    const quality = getGraphicsQualityProfile(this.scene).level;
    this.ambientCount = quality === 'low' ? 0 : quality === 'medium' ? 6 : 12;
    this.burstCount = this.ambientCount * 2;
    if (this.missionRevision === state.missionRevision) return;
    this.missionRevision = state.missionRevision;

    const activated = new Map(state.activatedCheckpoints.map(({ checkpointId, activatedAtRoundMs }) => [
      checkpointId, activatedAtRoundMs,
    ]));
    for (const visual of this.checkpoints) {
      visual.activatedAtMs = activated.get(visual.id) ?? null;
      const reached = visual.activatedAtMs !== null;
      visual.next = !reached && state.nextCheckpointId === visual.id;
      writeColor(visual.color, visual.extraction
        ? (reached ? COLORS.GREEN_2 : COLORS.GREEN_3)
        : visual.next ? COLORS.GOLD_1 : reached ? COLORS.BLUE_3 : COLORS.BLUE_4);
      visual.opacity = visual.next ? 0.9 : reached ? 0.3 : visual.extraction ? 0.38 : 0.16;
    }

    this.graphics.clear().setVisible(true);
    const barrierOpen = new Map(state.barriers.map((barrier) => [barrier.barrierId, barrier.open]));
    for (const barrier of config.barriers) {
      const open = barrierOpen.get(barrier.id) === true;
      if (open) continue;
      for (const cell of barrier.cells) this.drawClosedGateCell(cell.gridX, cell.gridY);
    }
  }

  clear(): void {
    if (this.destroyed) return;
    for (const visual of this.checkpoints) visual.quad.destroy();
    this.checkpoints.length = 0;
    this.config = undefined;
    this.roundRevision = -1;
    this.missionRevision = -1;
    this.elapsedMs = 0;
    this.graphics.clear().setVisible(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.graphics.destroy();
    this.destroyed = true;
  }

  private createCheckpoints(config: ResolvedCoopDefenseMapMissionProgressConfig): void {
    // Production requires WebGL; headless presentation must not allocate GPU resources.
    if (!(this.scene.sys.renderer as { gl?: unknown } | undefined)?.gl) return;
    const extractionId = config.checkpoints[config.checkpoints.length - 1]?.id;
    for (const checkpoint of config.checkpoints) {
      const radius = checkpoint.radiusCells * CELL_SIZE;
      const size = (radius + CHECKPOINT_PADDING) * 2;
      const seed = checkpointSeed(checkpoint.id);
      const extraction = checkpoint.id === extractionId;
      const activationColor = new Float32Array(3);
      writeColor(activationColor, extraction ? COLORS.GREEN_2 : COLORS.GOLD_1);
      const quad = new Phaser.GameObjects.Shader(
        this.scene,
        {
          name: CHECKPOINT_SHADER_NAME,
          shaderName: CHECKPOINT_SHADER_NAME,
          fragmentSource: CHECKPOINT_FRAGMENT_SOURCE,
          setupUniforms: (
            setUniform: (name: string, value: unknown) => void,
            drawingContext: Phaser.Renderer.WebGL.DrawingContext,
          ) => {
            const ageMs = visual.activatedAtMs === null ? -1 : this.elapsedMs - visual.activatedAtMs;
            const camera = drawingContext.camera;
            setUniform('uSize', size);
            setUniform('uRadius', radius);
            setUniform('uTime', this.elapsedMs / 1000);
            setUniform('uSeed', seed);
            setUniform('uPixelSize', camera ? 1 / Math.max(0.001, Math.min(camera.zoomX, camera.zoomY)) : 1);
            setUniform('uNext', visual.next ? 1 : 0);
            setUniform('uExtraction', extraction ? 1 : 0);
            setUniform('uOpacity', visual.opacity);
            setUniform('uActivationAge', ageMs >= 0 && ageMs < CHECKPOINT_ACTIVATION_MS
              ? ageMs / CHECKPOINT_ACTIVATION_MS : -1);
            setUniform('uAmbientCount', this.ambientCount);
            setUniform('uBurstCount', this.burstCount);
            setUniform('uColor', visual.color);
            setUniform('uActivationColor', activationColor);
          },
        },
        ARENA_OFFSET_X + (checkpoint.gridX + 0.5) * CELL_SIZE,
        ARENA_OFFSET_Y + (checkpoint.gridY + 0.5) * CELL_SIZE,
        size,
        size,
      );
      const visual: CheckpointVisual = {
        id: checkpoint.id, quad, extraction, color: new Float32Array(3),
        next: false, opacity: 0, activatedAtMs: null,
      };
      quad.setOrigin(0.5).setDepth(DEPTH.ROCKS - 0.5).setBlendMode(Phaser.BlendModes.NORMAL);
      // Direct display-list children retain normal camera culling and world-camera assignment.
      this.scene.add.existing(quad);
      registerGraphicsObject(this.scene, 'objectiveMarkers', quad);
      this.checkpoints.push(visual);
    }
  }

  private drawClosedGateCell(gridX: number, gridY: number): void {
    const left = ARENA_OFFSET_X + gridX * CELL_SIZE;
    const top = ARENA_OFFSET_Y + gridY * CELL_SIZE;
    const inset = 2;
    this.graphics.fillStyle(COLORS.BLUE_5, 0.92)
      .fillRoundedRect(left + inset, top + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2, 4);
    this.graphics.lineStyle(2, COLORS.BLUE_2, 0.95)
      .strokeRoundedRect(left + inset, top + inset, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2, 4);
    this.graphics.lineStyle(3, COLORS.GOLD_1, 0.82);
    for (let offset = -CELL_SIZE; offset < CELL_SIZE * 2; offset += 12) {
      const x1 = Math.max(left + 4, left + offset);
      const y1 = top + 4 + Math.max(0, -offset);
      const x2 = Math.min(left + CELL_SIZE - 4, left + offset + CELL_SIZE);
      const y2 = top + 4 + Math.min(CELL_SIZE - 8, CELL_SIZE - offset);
      if (y1 <= top + CELL_SIZE - 4 && y2 >= top + 4) this.graphics.lineBetween(x1, y1, x2, y2);
    }
    this.graphics.fillStyle(COLORS.BLUE_1, 0.9).fillCircle(left + CELL_SIZE / 2, top + CELL_SIZE / 2, 4);
  }
}
