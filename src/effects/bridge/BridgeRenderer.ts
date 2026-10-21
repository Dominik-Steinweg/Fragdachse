import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getPipelineAsset } from '../../config/pipelineAssets';
import { getBridgeChargePoint, getBridgeDeckWorldRect, type BridgeWorldOrigin } from '../../arena/BridgeGeometry';
import { BRIDGE_DEMOLITION_RULES } from '../../config/bridges';
import type { ArenaBridge } from '../../types';
import type { BridgeRuntimeState } from '../../world/WorldBridgeRuntime';
import { ensureCanvasTexture, registerGraphicsObject } from '../EffectUtils';
import { MortarGpuLayer, STRIKE_PALETTE } from '../gpu/MortarGpuLayer';
import { BridgeDestructionFx } from './BridgeDestructionFx';
import { BRIDGE_PIPELINE_ASSET_IDS, bridgeTextureSize, ensureBridgeDeckTexture, ensureBridgeRuinTexture, ensureBridgeShadowTexture,
  resolveBridgeKitMasters } from './BridgeTextures';

/** The thrown charge in the air: ground track from the thrower to the charge point. */
interface ChargeFlight {
  readonly fromX: number;
  readonly fromY: number;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly heightPx: number;
}

interface BridgeView {
  readonly bridge: ArenaBridge;
  readonly seed: number;
  readonly shadow: Phaser.GameObjects.Image;
  readonly deck: Phaser.GameObjects.Image;
  readonly ruin: Phaser.GameObjects.Image;
  /** The charge lying on the deck. */
  readonly charge: Phaser.GameObjects.Image;
  /** The same charge while it flies, above the actors like a grenade. */
  readonly flier: Phaser.GameObjects.Image;
  readonly flierShadow: Phaser.GameObjects.Image;
  readonly spark: Phaser.GameObjects.Image;
  /** Glowing hazard frame with corner brackets around the deck. */
  readonly telegraph: Phaser.GameObjects.Image;
  /** Warning stripes crawling over the deck. */
  readonly stripes: Phaser.GameObjects.TileSprite;
  phase: BridgeRuntimeState['phase'] | null;
  flight: ChargeFlight | null;
  landedAt: number;
  warned: boolean;
}

/** Presentation callbacks; the renderer itself never decides gameplay. */
export interface BridgeRendererCues {
  /** One-shot cues: the charge leaves the thrower, lands with its fuse lit, or the fuse's last seconds began. */
  readonly onFuseCue?: (x: number, y: number, cue: 'thrown' | 'lit' | 'final') => void;
}

/** The charge's fuse ends where the spark burns, +12/-10 px from its centre. */
const CHARGE_DISPLAY_SIZE = 32;
const SPARK_OFFSET = { x: 12, y: -10 } as const;
const SPARK_KEY = 'bridge-fuse-spark';
const FLIGHT_SHADOW_KEY = 'bridge-charge-flight-shadow';
const STRIPES_KEY = 'bridge-hazard-stripes';
/** Above the light map like other danger telegraphs, below the canopy. */
const TELEGRAPH_DEPTH = 19.7;
const FINAL_WARNING_MS = 1600;
const HAZARD_MARGIN_PX = 6;
const LAND_BOUNCE_MS = 200;
let nextTextureOwner = 0;

function ensureSharedTextures(textures: Phaser.Textures.TextureManager): void {
  ensureCanvasTexture(textures, SPARK_KEY, 32, 32, ctx => {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(255,250,220,1)');
    gradient.addColorStop(0.25, 'rgba(255,196,96,0.9)');
    gradient.addColorStop(0.6, 'rgba(255,110,40,0.35)');
    gradient.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
  });
  ensureCanvasTexture(textures, FLIGHT_SHADOW_KEY, 40, 24, ctx => {
    const gradient = ctx.createRadialGradient(20, 12, 0, 20, 12, 18);
    gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.setTransform(1, 0, 0, 0.6, 0, 4.8);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 40, 40);
  });
  // Soft diagonal hazard bands, seamless in both directions (period 32 px along x + y).
  ensureCanvasTexture(textures, STRIPES_KEY, 32, 32, ctx => {
    const image = ctx.createImageData(32, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const phase = ((x + y) % 32) / 32;
        const band = Math.max(0, Math.min(1, (0.22 - Math.abs(phase - 0.25)) / 0.07));
        const i = (y * 32 + x) * 4;
        image.data[i] = 255; image.data[i + 1] = 138; image.data[i + 2] = 52;
        image.data[i + 3] = Math.round(band * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  });
}

/** Hazard frame for one deck (drawn for horizontal travel): a soft inner glow and bright corner brackets. */
function ensureHazardFrameTexture(textures: Phaser.Textures.TextureManager, key: string, width: number, height: number): void {
  const m = HAZARD_MARGIN_PX;
  ensureCanvasTexture(textures, key, width + m * 2, height + m * 2, ctx => {
    for (let i = 0; i < 14; i++) {
      const fade = 1 - i / 14;
      ctx.strokeStyle = `rgba(255,${Math.round(96 + 60 * fade)},48,${(0.5 * fade * fade).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(m + i + 0.5, m + i + 0.5, width - i * 2 - 1, height - i * 2 - 1);
    }
    // Outer halo spills a little over the railings and the water.
    for (let i = 1; i <= m; i++) {
      ctx.strokeStyle = `rgba(255,110,40,${(0.22 * (1 - i / (m + 1))).toFixed(3)})`;
      ctx.strokeRect(m - i + 0.5, m - i + 0.5, width + i * 2 - 1, height + i * 2 - 1);
    }
    const arm = Math.min(16, Math.min(width, height) / 4);
    ctx.fillStyle = 'rgba(255,214,150,0.95)';
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [m + width, m, -1, 1], [m, m + height, 1, -1], [m + width, m + height, -1, -1]] as const) {
      ctx.fillRect(sx > 0 ? x : x - arm, sy > 0 ? y : y - 3, arm, 3);
      ctx.fillRect(sx > 0 ? x : x - 3, sy > 0 ? y : y - arm, 3, arm);
    }
  });
}

function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 997) / 997;
}

/**
 * World presentation of authored bridges: the standing deck over the river, the charge thrown
 * onto it with its burning fuse and danger telegraph, the ruin after a collapse and the collapse
 * burst itself. It reads the bridge owner's state every frame: a charge that arrives with a throw
 * origin flies there in an arc first; a late joiner's first frame shows the state silently.
 */
export class BridgeRenderer {
  private readonly views: BridgeView[] = [];
  private readonly textureKeys: string[] = [];
  private readonly fx: BridgeDestructionFx;
  /** Shared strike telegraph (mortar/airstrike family): blast radius and countdown track. */
  private readonly strike: MortarGpuLayer;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, bridges: readonly ArenaBridge[], private readonly origin: BridgeWorldOrigin,
    private readonly cues: BridgeRendererCues = {}) {
    this.fx = new BridgeDestructionFx(scene);
    this.strike = new MortarGpuLayer(scene, image => registerGraphicsObject(scene, 'objectiveMarkers', image));
    ensureSharedTextures(scene.textures);
    const chargeKey = getPipelineAsset(BRIDGE_PIPELINE_ASSET_IDS.charge).textureKey;
    const masters = resolveBridgeKitMasters(scene.textures);
    const owner = nextTextureOwner++;
    for (const bridge of bridges) {
      const deckKey = `bridge-deck-${owner}-${bridge.id}`;
      const ruinKey = `bridge-ruin-${owner}-${bridge.id}`;
      const shadowKey = `bridge-shadow-${owner}-${bridge.id}`;
      const hazardKey = `bridge-hazard-${owner}-${bridge.id}`;
      ensureBridgeDeckTexture(scene.textures, deckKey, bridge.spanCells, bridge.deckWidthCells, bridge.id, masters);
      ensureBridgeRuinTexture(scene.textures, ruinKey, bridge.spanCells, bridge.deckWidthCells, bridge.id, masters);
      ensureBridgeShadowTexture(scene.textures, shadowKey, bridge.spanCells, bridge.deckWidthCells);
      const deckLength = bridge.spanCells * 32, deckWidth = bridge.deckWidthCells * 32;
      ensureHazardFrameTexture(scene.textures, hazardKey, deckLength, deckWidth);
      this.textureKeys.push(deckKey, ruinKey, shadowKey, hazardKey);
      const rect = getBridgeDeckWorldRect(bridge, origin);
      const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
      const rotation = bridge.axis === 'horizontal' ? 0 : Math.PI / 2;
      // The deck stands a little above the river; its contact shadow darkens the water around it.
      const shadow = scene.add.image(cx + 2, cy + 3, shadowKey).setRotation(rotation).setDepth(DEPTH.WATER + .38).setAlpha(.55);
      // Kit textures are assembled at the master's resolution and shown at display size.
      const size = bridgeTextureSize(bridge.spanCells, bridge.deckWidthCells);
      const deck = scene.add.image(cx, cy, deckKey).setDisplaySize(size.width, size.height).setRotation(rotation)
        .setDepth(DEPTH.WATER + .4);
      const ruin = scene.add.image(cx, cy, ruinKey).setDisplaySize(size.width, size.height).setRotation(rotation)
        .setDepth(DEPTH.WATER + .4).setVisible(false);
      const point = getBridgeChargePoint(bridge, origin);
      const charge = scene.add.image(point.x, point.y, chargeKey).setDisplaySize(CHARGE_DISPLAY_SIZE, CHARGE_DISPLAY_SIZE)
        .setDepth(DEPTH.WATER + .42).setVisible(false);
      const flierShadow = scene.add.image(point.x, point.y, FLIGHT_SHADOW_KEY).setDepth(DEPTH.WATER + .43).setVisible(false);
      const flier = scene.add.image(point.x, point.y, chargeKey).setDisplaySize(CHARGE_DISPLAY_SIZE, CHARGE_DISPLAY_SIZE)
        .setDepth(DEPTH.PROJECTILES).setVisible(false);
      const spark = scene.add.image(point.x + SPARK_OFFSET.x, point.y + SPARK_OFFSET.y, SPARK_KEY).setDepth(TELEGRAPH_DEPTH)
        .setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      const telegraph = scene.add.image(cx, cy, hazardKey).setRotation(rotation).setDepth(TELEGRAPH_DEPTH)
        .setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      const stripes = scene.add.tileSprite(cx, cy, deckLength - 4, deckWidth - 4, STRIPES_KEY).setRotation(rotation)
        .setDepth(TELEGRAPH_DEPTH).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      registerGraphicsObject(scene, 'objectiveMarkers', telegraph);
      registerGraphicsObject(scene, 'objectiveMarkers', stripes);
      this.views.push({ bridge, seed: hashSeed(bridge.id), shadow, deck, ruin, charge, flier, flierShadow, spark, telegraph, stripes,
        phase: null, flight: null, landedAt: Number.NEGATIVE_INFINITY, warned: false });
    }
  }

  /** Returns true when a bridge changed between standing and collapsed in this frame. */
  sync(readState: (id: string) => BridgeRuntimeState | null, now: number): boolean {
    if (this.destroyed) return false;
    let collapseChanged = false;
    this.strike.begin(this.scene.time?.now ?? 0);
    for (const view of this.views) {
      const state = readState(view.bridge.id);
      const phase = state?.phase ?? 'standing';
      if (phase !== view.phase) {
        const collapsed = phase === 'collapsed';
        if (collapsed && view.phase !== null) {
          this.fx.play(getBridgeDeckWorldRect(view.bridge, this.origin), view.bridge.axis === 'horizontal');
        }
        if (phase === 'charged') this.beginCharge(view, state, now);
        if (collapsed !== (view.phase === 'collapsed')) collapseChanged = true;
        view.deck.setVisible(!collapsed);
        view.shadow.setVisible(!collapsed);
        view.ruin.setVisible(collapsed);
        if (phase !== 'charged') this.hideCharge(view);
        view.phase = phase;
      }
      if (phase === 'charged') this.drawCharge(view, state?.detonatesAt ?? now, now);
    }
    this.strike.flush();
    return collapseChanged;
  }

  private beginCharge(view: BridgeView, state: BridgeRuntimeState | null, now: number): void {
    view.warned = false;
    const point = getBridgeChargePoint(view.bridge, this.origin);
    const from = state?.thrownFrom;
    // Only a charge seen leaving the thrower flies; a late joiner finds it already on the deck.
    if (view.phase !== null && from) {
      const distance = Math.hypot(point.x - from.x, point.y - from.y);
      view.flight = { fromX: from.x, fromY: from.y, startedAt: now,
        durationMs: Phaser.Math.Clamp(240 + distance * 1.8, 320, 640), heightPx: Phaser.Math.Clamp(16 + distance * 0.24, 18, 52) };
      view.landedAt = Number.POSITIVE_INFINITY;
      this.cues.onFuseCue?.(from.x, from.y, 'thrown');
    } else {
      view.flight = null;
      view.landedAt = view.phase !== null ? now : Number.NEGATIVE_INFINITY;
      if (view.phase !== null) this.cues.onFuseCue?.(point.x, point.y, 'lit');
    }
  }

  private hideCharge(view: BridgeView): void {
    view.flight = null;
    for (const object of [view.charge, view.flier, view.flierShadow, view.spark, view.telegraph, view.stripes]) object.setVisible(false);
  }

  private drawCharge(view: BridgeView, detonatesAt: number, now: number): void {
    const point = getBridgeChargePoint(view.bridge, this.origin);
    const flight = view.flight;
    if (flight) {
      const t = Math.min(1, (now - flight.startedAt) / flight.durationMs);
      if (t < 1) {
        this.drawFlight(view, flight, point, t);
        return;
      }
      view.flight = null;
      view.landedAt = now;
      view.flier.setVisible(false);
      view.flierShadow.setVisible(false);
      this.cues.onFuseCue?.(point.x, point.y, 'lit');
    }
    const remaining = Math.max(0, detonatesAt - now);
    const progress = 1 - Math.min(1, remaining / BRIDGE_DEMOLITION_RULES.fuseMs);
    if (!view.warned && remaining <= FINAL_WARNING_MS && remaining > 0) {
      view.warned = true;
      this.cues.onFuseCue?.(point.x, point.y, 'final');
    }
    // A short settle after the landing, then the bundle lies still while the fuse burns.
    const sinceLanding = now - view.landedAt;
    const bounce = sinceLanding >= 0 && sinceLanding < LAND_BOUNCE_MS
      ? Math.sin((sinceLanding / LAND_BOUNCE_MS) * Math.PI) * 4 * (1 - sinceLanding / LAND_BOUNCE_MS) : 0;
    view.charge.setVisible(true).setPosition(point.x, point.y - bounce);
    const flicker = 0.75 + Math.random() * 0.5;
    view.spark.setVisible(true).setPosition(point.x + SPARK_OFFSET.x, point.y + SPARK_OFFSET.y - bounce)
      .setScale(0.55 * flicker + progress * 0.25).setAlpha(0.8 + Math.random() * 0.2);
    // The warning swells in after the landing and beats faster as the fuse burns down.
    const swell = Math.min(1, Math.max(0, sinceLanding) / 260);
    const pulseHz = 1.2 + progress * progress * 6.5;
    const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2 * pulseHz + view.seed * 6);
    const urgency = 0.45 + 0.55 * progress;
    view.telegraph.setVisible(true).setAlpha(swell * (0.35 + 0.65 * urgency) * (0.55 + 0.45 * pulse));
    view.stripes.setVisible(true).setAlpha(swell * (0.07 + 0.16 * urgency) * (0.6 + 0.4 * pulse));
    view.stripes.tilePositionX = (now / 1000) * (14 + 40 * progress);
    this.strike.add({ x: point.x, y: point.y, radius: BRIDGE_DEMOLITION_RULES.blastRadiusPx, timeline: progress,
      seed: view.seed, palette: STRIKE_PALETTE.player, age: -1, dir: 0, showOrigin: false });
  }

  /** Grenade-like arc: straight ground track, parabolic height, spin, a shadow on the ground. */
  private drawFlight(view: BridgeView, flight: ChargeFlight, point: { x: number; y: number }, t: number): void {
    const x = flight.fromX + (point.x - flight.fromX) * t;
    const groundY = flight.fromY + (point.y - flight.fromY) * t;
    const lift = flight.heightPx * 4 * t * (1 - t);
    const spin = (t * 1.6 + view.seed) * Math.PI * 2 * (point.x >= flight.fromX ? 1 : -1);
    const size = CHARGE_DISPLAY_SIZE * (0.92 + 0.22 * Math.sin(Math.PI * t));
    view.flier.setVisible(true).setPosition(x, groundY - lift).setRotation(spin).setDisplaySize(size, size);
    view.flierShadow.setVisible(true).setPosition(x + lift * 0.18, groundY + 2)
      .setScale(1 - 0.35 * Math.sin(Math.PI * t)).setAlpha(0.5 - 0.2 * Math.sin(Math.PI * t));
    // The lit fuse travels with the bundle.
    const cos = Math.cos(spin), sin = Math.sin(spin), scale = size / CHARGE_DISPLAY_SIZE;
    view.spark.setVisible(true)
      .setPosition(x + (SPARK_OFFSET.x * cos - SPARK_OFFSET.y * sin) * scale, groundY - lift + (SPARK_OFFSET.x * sin + SPARK_OFFSET.y * cos) * scale)
      .setScale(0.5 + Math.random() * 0.2).setAlpha(0.9);
    view.charge.setVisible(false);
    view.telegraph.setVisible(false);
    view.stripes.setVisible(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fx.destroy();
    this.strike.destroy();
    for (const view of this.views) {
      for (const object of [view.shadow, view.deck, view.ruin, view.charge, view.flier, view.flierShadow, view.spark, view.telegraph, view.stripes]) {
        object.destroy();
      }
    }
    this.views.length = 0;
    for (const key of this.textureKeys) this.scene.textures.remove(key);
  }
}
