import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getPipelineAsset } from '../../config/pipelineAssets';
import { getBridgeChargePoint, getBridgeDeckWorldRect, type BridgeWorldOrigin } from '../../arena/BridgeGeometry';
import { BRIDGE_DEMOLITION_RULES } from '../../config/bridges';
import type { ArenaBridge } from '../../types';
import type { BridgeRuntimeState } from '../../world/WorldBridgeRuntime';
import { ensureCanvasTexture, registerGraphicsObject } from '../EffectUtils';
import { BridgeDestructionFx } from './BridgeDestructionFx';
import { BRIDGE_PIPELINE_ASSET_IDS, bridgeTextureSize, ensureBridgeDeckTexture, ensureBridgeRuinTexture, ensureBridgeShadowTexture,
  resolveBridgeKitMasters } from './BridgeTextures';

interface BridgeView {
  readonly bridge: ArenaBridge;
  readonly shadow: Phaser.GameObjects.Image;
  readonly deck: Phaser.GameObjects.Image;
  readonly ruin: Phaser.GameObjects.Image;
  readonly charge: Phaser.GameObjects.Image;
  readonly spark: Phaser.GameObjects.Image;
  readonly telegraph: Phaser.GameObjects.Graphics;
  phase: BridgeRuntimeState['phase'] | null;
  warned: boolean;
}

/** Presentation callbacks; the renderer itself never decides gameplay. */
export interface BridgeRendererCues {
  /** One-shot cue at the charge point: the fuse is lit, or its last seconds began. */
  readonly onFuseCue?: (x: number, y: number, cue: 'lit' | 'final') => void;
}

/** The charge's fuse ends where the spark burns, +12/-10 px from its centre. */
const CHARGE_DISPLAY_SIZE = 32;
const SPARK_KEY = 'bridge-fuse-spark';
/** Above the light map like other danger telegraphs, below the canopy. */
const TELEGRAPH_DEPTH = 19.7;
const FINAL_WARNING_MS = 1600;
let nextTextureOwner = 0;

function ensureSparkTexture(textures: Phaser.Textures.TextureManager): void {
  ensureCanvasTexture(textures, SPARK_KEY, 32, 32, ctx => {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(255,250,220,1)');
    gradient.addColorStop(0.25, 'rgba(255,196,96,0.9)');
    gradient.addColorStop(0.6, 'rgba(255,110,40,0.35)');
    gradient.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
  });
}

/**
 * World presentation of authored bridges: the standing deck over the river, the charge with its
 * burning fuse and danger telegraph, the ruin after a collapse and the collapse burst itself. It
 * reads the bridge owner's state every frame and plays the burst on the transition to
 * `collapsed`; a late joiner's first frame shows the ruin silently.
 */
export class BridgeRenderer {
  private readonly views: BridgeView[] = [];
  private readonly textureKeys: string[] = [];
  private readonly fx: BridgeDestructionFx;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, bridges: readonly ArenaBridge[], private readonly origin: BridgeWorldOrigin,
    private readonly cues: BridgeRendererCues = {}) {
    this.fx = new BridgeDestructionFx(scene);
    ensureSparkTexture(scene.textures);
    const chargeKey = getPipelineAsset(BRIDGE_PIPELINE_ASSET_IDS.charge).textureKey;
    const masters = resolveBridgeKitMasters(scene.textures);
    const owner = nextTextureOwner++;
    for (const bridge of bridges) {
      const deckKey = `bridge-deck-${owner}-${bridge.id}`;
      const ruinKey = `bridge-ruin-${owner}-${bridge.id}`;
      const shadowKey = `bridge-shadow-${owner}-${bridge.id}`;
      ensureBridgeDeckTexture(scene.textures, deckKey, bridge.spanCells, bridge.deckWidthCells, bridge.id, masters);
      ensureBridgeRuinTexture(scene.textures, ruinKey, bridge.spanCells, bridge.deckWidthCells, bridge.id, masters);
      ensureBridgeShadowTexture(scene.textures, shadowKey, bridge.spanCells, bridge.deckWidthCells);
      this.textureKeys.push(deckKey, ruinKey, shadowKey);
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
      const spark = scene.add.image(point.x + 12, point.y - 10, SPARK_KEY).setDepth(TELEGRAPH_DEPTH)
        .setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      const telegraph = scene.add.graphics().setDepth(TELEGRAPH_DEPTH).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      registerGraphicsObject(scene, 'objectiveMarkers', telegraph);
      this.views.push({ bridge, shadow, deck, ruin, charge, spark, telegraph, phase: null, warned: false });
    }
  }

  /** Returns true when a bridge changed between standing and collapsed in this frame. */
  sync(readState: (id: string) => BridgeRuntimeState | null, now: number): boolean {
    if (this.destroyed) return false;
    let collapseChanged = false;
    for (const view of this.views) {
      const state = readState(view.bridge.id);
      const phase = state?.phase ?? 'standing';
      if (phase === 'charged') this.drawFuse(view, state?.detonatesAt ?? now, now);
      if (phase === view.phase) continue;
      const collapsed = phase === 'collapsed';
      const point = getBridgeChargePoint(view.bridge, this.origin);
      if (collapsed && view.phase !== null) {
        this.fx.play(getBridgeDeckWorldRect(view.bridge, this.origin), view.bridge.axis === 'horizontal');
      }
      if (phase === 'charged' && view.phase !== null) this.cues.onFuseCue?.(point.x, point.y, 'lit');
      if (collapsed !== (view.phase === 'collapsed')) collapseChanged = true;
      view.deck.setVisible(!collapsed);
      view.shadow.setVisible(!collapsed);
      view.ruin.setVisible(collapsed);
      view.charge.setVisible(phase === 'charged');
      view.spark.setVisible(phase === 'charged');
      view.telegraph.setVisible(phase === 'charged');
      if (phase !== 'charged') view.telegraph.clear();
      view.warned = phase === 'charged' ? view.warned : false;
      view.phase = phase;
    }
    return collapseChanged;
  }

  private drawFuse(view: BridgeView, detonatesAt: number, now: number): void {
    const remaining = Math.max(0, detonatesAt - now);
    const progress = 1 - Math.min(1, remaining / BRIDGE_DEMOLITION_RULES.fuseMs);
    if (!view.warned && remaining <= FINAL_WARNING_MS && remaining > 0) {
      view.warned = true;
      const point = getBridgeChargePoint(view.bridge, this.origin);
      this.cues.onFuseCue?.(point.x, point.y, 'final');
    }
    // The spark flickers and the deck pulses faster as the fuse burns down.
    const flicker = 0.75 + Math.random() * 0.5;
    view.spark.setScale(0.55 * flicker + progress * 0.25).setAlpha(0.8 + Math.random() * 0.2);
    const pulseHz = 1.4 + progress * 5.6;
    const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2 * pulseHz);
    const rect = getBridgeDeckWorldRect(view.bridge, this.origin);
    const g = view.telegraph.clear();
    g.fillStyle(0xff3b1f, 0.05 + 0.1 * pulse * (0.5 + progress));
    g.fillRect(rect.x, rect.y, rect.width, rect.height);
    g.lineStyle(2, 0xff5a2a, 0.35 + 0.45 * pulse);
    g.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
    // Hazard ticks along the deck edges grow inward as the remaining time shrinks.
    const tick = 6 + progress * 10;
    g.lineStyle(2, 0xffa040, 0.25 + 0.5 * pulse);
    if (view.bridge.axis === 'horizontal') {
      for (let x = rect.x + 8; x < rect.x + rect.width - 4; x += 14) {
        g.lineBetween(x, rect.y + 1, x + tick * 0.5, rect.y + 1 + tick * 0.5);
        g.lineBetween(x, rect.y + rect.height - 1, x + tick * 0.5, rect.y + rect.height - 1 - tick * 0.5);
      }
    } else {
      for (let y = rect.y + 8; y < rect.y + rect.height - 4; y += 14) {
        g.lineBetween(rect.x + 1, y, rect.x + 1 + tick * 0.5, y + tick * 0.5);
        g.lineBetween(rect.x + rect.width - 1, y, rect.x + rect.width - 1 - tick * 0.5, y + tick * 0.5);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fx.destroy();
    for (const view of this.views) {
      view.shadow.destroy(); view.deck.destroy(); view.ruin.destroy(); view.charge.destroy(); view.spark.destroy(); view.telegraph.destroy();
    }
    this.views.length = 0;
    for (const key of this.textureKeys) this.scene.textures.remove(key);
  }
}
