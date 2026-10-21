import * as Phaser from 'phaser';
import { configureGpuLayerCameraTransform } from '../graphics/GpuLayerCameraTransform';
import { disposeShaderWarmupNode } from '../graphics/disposeShaderWarmupNode';
import { DEPTH } from '../config';
import type { SyncedPowerUpPedestal } from '../types';
import { POWERUP_ITEM_ART, POWERUP_PEDESTAL_CONFIG, TIMED_POWERUP_PEDESTAL_CONFIGS, powerUpWorldColor } from './PowerUpConfig';
import { POWERUP_TOKEN_KEY } from '../assets/PowerUpAssets';

const TEX_POWERUP_PEDESTAL_GPU = '__powerup_pedestal_gpu';
const FRAME_OUTER_GLOW = 'outer-glow';
const FRAME_GLOW = 'glow';
const FRAME_AURA = 'aura';
const FRAME_OWNER_RING = 'owner-ring';
const FRAME_FALLBACK_BASE = 'base:fallback';

/** Plinth and owner ring are drawn at this many texels per world unit; glows stay soft at 1:1. */
const PLINTH_TEXELS = 3;
const PLINTH_FRAME = 36 * PLINTH_TEXELS;
const MAX_PEDESTALS = 256;
const ADDITIVE_MEMBERS_PER_PEDESTAL = 3;
const PULSE_HALF_PERIOD_MS = 1_428;
const ANNOUNCE_HALF_PERIOD_MS = 280;
const GPU_EASE = 'Sine.easeInOut';

export type PowerUpPedestalGpuMode = 'idle' | 'ready' | 'announcing';

interface PedestalGpuHandle {
  readonly slot: number;
  x: number;
  y: number;
  defId: string;
  ownerColor: number | undefined;
  mode: PowerUpPedestalGpuMode;
}

interface PulseRange {
  readonly alphaMin: number;
  readonly alphaMax: number;
  readonly scaleMin: number;
  readonly scaleMax: number;
}

interface PedestalModeStyle {
  readonly halfPeriodMs: number;
  readonly baseScaleMax: number;
  readonly outer: PulseRange;
  readonly glow: PulseRange;
  readonly aura: PulseRange;
}

const MODE_STYLES: Readonly<Record<PowerUpPedestalGpuMode, PedestalModeStyle>> = {
  idle: {
    halfPeriodMs: PULSE_HALF_PERIOD_MS,
    baseScaleMax: 1,
    outer: { alphaMin: 0.26, alphaMax: 0.4, scaleMin: 0.86, scaleMax: 1.03 },
    glow: { alphaMin: 0.18, alphaMax: 0.26, scaleMin: 0.82, scaleMax: 0.88 },
    aura: { alphaMin: 0.14, alphaMax: 0.2, scaleMin: 0.56, scaleMax: 0.6 },
  },
  ready: {
    halfPeriodMs: PULSE_HALF_PERIOD_MS,
    baseScaleMax: 1,
    outer: { alphaMin: 0.28, alphaMax: 0.6, scaleMin: 0.9, scaleMax: 1.16 },
    glow: { alphaMin: 0.34, alphaMax: 0.48, scaleMin: 0.92, scaleMax: 1.03 },
    aura: { alphaMin: 0.22, alphaMax: 0.32, scaleMin: 0.64, scaleMax: 0.72 },
  },
  announcing: {
    halfPeriodMs: ANNOUNCE_HALF_PERIOD_MS,
    baseScaleMax: 1.025,
    outer: { alphaMin: 0.12, alphaMax: 0.54, scaleMin: 0.88, scaleMax: 1.18 },
    glow: { alphaMin: 0.24, alphaMax: 0.66, scaleMin: 0.88, scaleMax: 1.16 },
    aura: { alphaMin: 0.18, alphaMax: 0.38, scaleMin: 0.58, scaleMax: 0.75 },
  },
};

type GpuMember = Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member>;

/**
 * Persistente GPU-Darstellung der Pedestal-Koerper. Anders als das emissionsgetriebene
 * GpuVfxSystem besitzt sie langlebige Slots, die nur bei Snapshot-Aenderungen editiert werden.
 */
export class PowerUpPedestalGpuSystem {
  private destroyed = false;
  private readonly texture: Phaser.Textures.Texture;
  private readonly baseLayer: Phaser.GameObjects.SpriteGPULayer;
  private readonly ownerLayer: Phaser.GameObjects.SpriteGPULayer;
  private readonly additiveLayer: Phaser.GameObjects.SpriteGPULayer;
  private readonly handles = new Map<number, PedestalGpuHandle>();
  private readonly freeSlots: number[] = [];
  private nextSlot = 0;

  constructor(private readonly scene: Phaser.Scene) {
    ensurePedestalTexture(scene);
    this.texture = scene.textures.get(TEX_POWERUP_PEDESTAL_GPU);

    this.additiveLayer = scene.add.spriteGPULayer(
      this.texture,
      MAX_PEDESTALS * ADDITIVE_MEMBERS_PER_PEDESTAL,
    );
    this.additiveLayer.name = 'powerup-pedestal-glow';
    this.configureLayer(this.additiveLayer, DEPTH.PLAYERS - 2.1, Phaser.BlendModes.ADD);

    this.baseLayer = scene.add.spriteGPULayer(this.texture, MAX_PEDESTALS);
    this.baseLayer.name = 'powerup-pedestal-base';
    this.configureLayer(this.baseLayer, DEPTH.PLAYERS - 2, Phaser.BlendModes.NORMAL);

    this.ownerLayer = scene.add.spriteGPULayer(this.texture, MAX_PEDESTALS);
    this.ownerLayer.name = 'powerup-pedestal-owner';
    this.configureLayer(this.ownerLayer, DEPTH.PLAYERS - 1.999, Phaser.BlendModes.NORMAL);
    for (const layer of [this.baseLayer, this.ownerLayer, this.additiveLayer]) configureGpuLayerCameraTransform(layer);
  }

  upsert(pedestal: SyncedPowerUpPedestal, mode: PowerUpPedestalGpuMode): boolean {
    const existing = this.handles.get(pedestal.id);
    if (existing
      && existing.x === pedestal.x
      && existing.y === pedestal.y
      && existing.defId === pedestal.defId
      && existing.ownerColor === pedestal.ownerColor
      && existing.mode === mode) {
      return true;
    }

    const append = !existing && this.freeSlots.length === 0;
    const slot = existing?.slot ?? this.allocateSlot();
    if (slot < 0) return false;

    const handle: PedestalGpuHandle = existing ?? {
      slot,
      x: pedestal.x,
      y: pedestal.y,
      defId: pedestal.defId,
      ownerColor: pedestal.ownerColor,
      mode,
    };
    handle.x = pedestal.x;
    handle.y = pedestal.y;
    handle.defId = pedestal.defId;
    handle.ownerColor = pedestal.ownerColor;
    handle.mode = mode;
    this.handles.set(pedestal.id, handle);
    this.writeSlot(handle, append);
    this.syncVisibility();
    return true;
  }

  remove(id: number): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    this.baseLayer.editMember(handle.slot, deadMember());
    this.ownerLayer.editMember(handle.slot, deadMember());
    const additiveSlot = handle.slot * ADDITIVE_MEMBERS_PER_PEDESTAL;
    for (let index = 0; index < ADDITIVE_MEMBERS_PER_PEDESTAL; index += 1) {
      this.additiveLayer.editMember(additiveSlot + index, deadMember());
    }
    this.handles.delete(id);
    this.freeSlots.push(handle.slot);
    this.syncVisibility();
  }

  clear(): void {
    for (const id of [...this.handles.keys()]) this.remove(id);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    for (const layer of [this.baseLayer, this.ownerLayer, this.additiveLayer]) {
      if (layer.submitterNode?.programManager) disposeShaderWarmupNode(layer.submitterNode);
      layer.destroy();
    }
    this.destroyed = true;
  }

  getActiveCount(): number {
    return this.handles.size;
  }

  private configureLayer(
    layer: Phaser.GameObjects.SpriteGPULayer,
    depth: number,
    blendMode: number,
  ): void {
    layer.setDepth(depth).setBlendMode(blendMode).setVisible(false);
    layer.setAnimationEnabled(GPU_EASE, true);
  }

  private allocateSlot(): number {
    const recycled = this.freeSlots.pop();
    if (recycled !== undefined) return recycled;
    if (this.nextSlot >= MAX_PEDESTALS) return -1;
    const slot = this.nextSlot;
    this.nextSlot += 1;
    return slot;
  }

  private writeSlot(handle: PedestalGpuHandle, append: boolean): void {
    const color = powerUpWorldColor(handle.defId);
    const style = MODE_STYLES[handle.mode];
    const phaseMs = (handle.slot * 389) % (style.halfPeriodMs * 2);

    const base = this.baseMember(handle, style, phaseMs);
    const owner = this.ownerMember(handle, style, phaseMs);
    const additive = [
      this.glowMember(handle, FRAME_OUTER_GLOW, color, style.outer, style.halfPeriodMs, phaseMs),
      this.glowMember(handle, FRAME_GLOW, color, style.glow, style.halfPeriodMs, phaseMs),
      this.glowMember(handle, FRAME_AURA, color, style.aura, style.halfPeriodMs, phaseMs),
    ];

    if (append) {
      this.baseLayer.addMember(base);
      this.ownerLayer.addMember(owner);
      for (const member of additive) this.additiveLayer.addMember(member);
      return;
    }

    this.baseLayer.editMember(handle.slot, base);
    this.ownerLayer.editMember(handle.slot, owner);
    const additiveSlot = handle.slot * ADDITIVE_MEMBERS_PER_PEDESTAL;
    for (let index = 0; index < additive.length; index += 1) {
      this.additiveLayer.editMember(additiveSlot + index, additive[index]);
    }
  }

  private baseMember(
    handle: PedestalGpuHandle,
    style: PedestalModeStyle,
    phaseMs: number,
  ): GpuMember {
    const scale = pulse(1 / PLINTH_TEXELS, style.baseScaleMax / PLINTH_TEXELS, style.halfPeriodMs);
    return {
      x: handle.x,
      y: handle.y,
      frame: this.texture.get(baseFrameName(handle.defId)),
      scaleX: scale,
      scaleY: scale,
      alpha: 1,
      // An die Layer-Uhr statt an den Edit-Zeitpunkt binden: deren stuendlicher Reset startet
      // den harmlosen Loop neu, statt mit einer creationTime aus der vorigen Epoche zu rechnen.
      creationTime: -phaseMs,
    };
  }

  private ownerMember(
    handle: PedestalGpuHandle,
    style: PedestalModeStyle,
    phaseMs: number,
  ): GpuMember {
    const color = handle.ownerColor ?? 0xffffff;
    const scale = pulse(1 / PLINTH_TEXELS, 1.025 / PLINTH_TEXELS, style.halfPeriodMs);
    const alpha = handle.ownerColor === undefined
      ? 0
      : pulse(0.72, 0.84, style.halfPeriodMs);
    return tintMember({
      x: handle.x,
      y: handle.y,
      frame: this.texture.get(FRAME_OWNER_RING),
      scaleX: scale,
      scaleY: scale,
      alpha,
      creationTime: -phaseMs,
    }, color);
  }

  private glowMember(
    handle: PedestalGpuHandle,
    frame: string,
    color: number,
    range: PulseRange,
    halfPeriodMs: number,
    phaseMs: number,
  ): GpuMember {
    const scale = pulse(range.scaleMin, range.scaleMax, halfPeriodMs);
    return tintMember({
      x: handle.x,
      y: handle.y,
      frame: this.texture.get(frame),
      scaleX: scale,
      scaleY: scale,
      alpha: pulse(range.alphaMin, range.alphaMax, halfPeriodMs),
      creationTime: -phaseMs,
    }, color);
  }

  private syncVisibility(): void {
    const visible = this.handles.size > 0;
    this.additiveLayer.setVisible(visible);
    this.baseLayer.setVisible(visible);
    this.ownerLayer.setVisible(visible);
  }
}

export function resolvePowerUpPedestalGpuMode(
  pedestal: SyncedPowerUpPedestal,
  now: number,
): PowerUpPedestalGpuMode {
  if (pedestal.hasPowerUp) return 'ready';
  const untilRespawn = pedestal.nextRespawnAt > 0
    ? pedestal.nextRespawnAt - now
    : Number.POSITIVE_INFINITY;
  return Number.isFinite(untilRespawn)
    && untilRespawn > 0
    && untilRespawn <= POWERUP_PEDESTAL_CONFIG.announceLeadMs
    ? 'announcing'
    : 'idle';
}

function pulse(min: number, max: number, duration: number): Phaser.Types.GameObjects.SpriteGPULayer.MemberAnimation {
  return {
    base: min,
    amplitude: max - min,
    duration,
    ease: GPU_EASE,
    loop: true,
    yoyo: true,
  };
}

function tintMember(member: GpuMember, tint: number): GpuMember {
  member.tintBlend = 1;
  member.tintTopLeft = tint;
  member.tintTopRight = tint;
  member.tintBottomLeft = tint;
  member.tintBottomRight = tint;
  return member;
}

function deadMember(): GpuMember {
  return { x: 0, y: 0, scaleX: 0, scaleY: 0, alpha: 0 };
}

function baseFrameName(defId: string): string {
  return TIMED_POWERUP_PEDESTAL_CONFIGS[defId] ? `base:${defId}` : FRAME_FALLBACK_BASE;
}

/** Static menu previews sample the same pedestal artwork as the World GPU layer. */
export function getPowerUpPedestalPreviewFrame(scene: Phaser.Scene, defId: string): { key: string; frame: string } {
  ensurePedestalTexture(scene);
  return { key: TEX_POWERUP_PEDESTAL_GPU, frame: baseFrameName(defId) };
}

function ensurePedestalTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_POWERUP_PEDESTAL_GPU)) return;
  const texture = scene.textures.createCanvas(TEX_POWERUP_PEDESTAL_GPU, 512, 512);
  if (!texture) return;
  const ctx = texture.context;
  ctx.clearRect(0, 0, 512, 512);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  drawRadial(ctx, 2, 2, 160, [
    [0, 0.92], [0.14, 0.6], [0.35, 0.22], [0.62, 0.06], [0.85, 0.01], [1, 0],
  ]);
  texture.add(FRAME_OUTER_GLOW, 0, 2, 2, 160, 160);

  drawRadial(ctx, 166, 2, 72, [[0, 0.92], [0.22, 0.34], [0.55, 0.12], [1, 0]]);
  texture.add(FRAME_GLOW, 0, 166, 2, 72, 72);

  drawRadial(ctx, 242, 2, 40, [[0, 0.9], [0.32, 0.35], [0.7, 0.08], [1, 0]]);
  texture.add(FRAME_AURA, 0, 242, 2, 40, 40);

  drawOwnerRing(ctx, 290, 2, PLINTH_FRAME);
  texture.add(FRAME_OWNER_RING, 0, 290, 2, PLINTH_FRAME, PLINTH_FRAME);

  const token = scene.textures.exists(POWERUP_TOKEN_KEY)
    ? scene.textures.get(POWERUP_TOKEN_KEY).getSourceImage() as CanvasImageSource
    : null;
  const baseDefs = [
    ...Object.keys(TIMED_POWERUP_PEDESTAL_CONFIGS),
    'fallback',
  ];
  for (let index = 0; index < baseDefs.length; index += 1) {
    const x = 2 + (index % 4) * (PLINTH_FRAME + 2);
    const y = 168 + Math.floor(index / 4) * (PLINTH_FRAME + 2);
    const defId = baseDefs[index];
    drawPlinth(ctx, x, y, powerUpWorldColor(defId), token);
    texture.add(defId === 'fallback' ? FRAME_FALLBACK_BASE : `base:${defId}`, 0, x, y, PLINTH_FRAME, PLINTH_FRAME);
  }

  texture.refresh();
}

function drawRadial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  stops: readonly (readonly [number, number])[],
): void {
  const half = size / 2;
  const gradient = ctx.createRadialGradient(x + half, y + half, 0, x + half, y + half, half);
  for (const [offset, alpha] of stops) gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
}

/**
 * The pedestal is a larger copy of the shared pickup token: same bronze lip and glass channel,
 * so a lying item visibly sits in the plinth's channel. The channel carries the pickup colour
 * even while the pedestal is empty.
 */
function drawPlinth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: number,
  token: CanvasImageSource | null,
): void {
  const k = PLINTH_TEXELS;
  const centerX = x + PLINTH_FRAME / 2;
  const centerY = y + PLINTH_FRAME / 2;
  const radius = POWERUP_PEDESTAL_CONFIG.renderBaseRadius;
  const shadow = ctx.createRadialGradient(centerX + 1.2 * k, centerY + 1.8 * k, 0, centerX + 1.2 * k, centerY + 1.8 * k, (radius + 3.5) * k);
  shadow.addColorStop(0, 'rgba(0,0,0,0.55)');
  shadow.addColorStop(0.72, 'rgba(0,0,0,0.42)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(x, y, PLINTH_FRAME, PLINTH_FRAME);
  if (!token) {
    circle(ctx, centerX, centerY, radius * k, 0x2f251d, 1, 0x7a5a39, 1, 2 * k);
    circle(ctx, centerX, centerY, POWERUP_PEDESTAL_CONFIG.renderInnerRadius * k, 0x262b2f, 1);
  } else {
    const size = radius / POWERUP_ITEM_ART.tokenRadiusRatio * 2 * k;
    ctx.drawImage(token, centerX - size / 2, centerY - size / 2, size, size);
  }
  circle(ctx, centerX, centerY, POWERUP_PEDESTAL_CONFIG.renderInnerRadius * k, null, 0, color, 0.62, 1.1 * k);
}

function drawOwnerRing(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  circle(
    ctx,
    x + size / 2,
    y + size / 2,
    (POWERUP_PEDESTAL_CONFIG.renderBaseRadius + 1.6) * PLINTH_TEXELS,
    null,
    0,
    0xffffff,
    0.78,
    1.5 * PLINTH_TEXELS,
  );
}

function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: number | null,
  fillAlpha: number,
  stroke?: number,
  strokeAlpha = 1,
  lineWidth = 1,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (fill !== null) {
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = cssColor(fill);
    ctx.fill();
  }
  if (stroke !== undefined) {
    ctx.globalAlpha = strokeAlpha;
    ctx.strokeStyle = cssColor(stroke);
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
