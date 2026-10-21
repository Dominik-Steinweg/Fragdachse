import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getBridgeDeckWorldRect, type BridgeWorldOrigin } from '../../arena/BridgeGeometry';
import type { ArenaBridge } from '../../types';
import type { BridgeRuntimeState } from '../../world/WorldBridgeRuntime';
import { BridgeDestructionFx } from './BridgeDestructionFx';
import { ensureBridgeDeckTexture, ensureBridgeRuinTexture } from './BridgeTextures';

interface BridgeView {
  readonly bridge: ArenaBridge;
  readonly deck: Phaser.GameObjects.Image;
  readonly ruin: Phaser.GameObjects.Image;
  phase: BridgeRuntimeState['phase'] | null;
}

let nextTextureOwner = 0;

/**
 * World presentation of authored bridges: the standing deck over the river, the ruin after a
 * collapse and the collapse burst itself. It reads the bridge owner's state every frame and plays
 * the burst on the transition to `collapsed`; a late joiner's first frame shows the ruin silently.
 */
export class BridgeRenderer {
  private readonly views: BridgeView[] = [];
  private readonly textureKeys: string[] = [];
  private readonly fx: BridgeDestructionFx;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, bridges: readonly ArenaBridge[], private readonly origin: BridgeWorldOrigin) {
    this.fx = new BridgeDestructionFx(scene);
    const owner = nextTextureOwner++;
    for (const bridge of bridges) {
      const deckKey = `bridge-deck-${owner}-${bridge.id}`;
      const ruinKey = `bridge-ruin-${owner}-${bridge.id}`;
      ensureBridgeDeckTexture(scene.textures, deckKey, bridge.spanCells, bridge.deckWidthCells, bridge.id);
      ensureBridgeRuinTexture(scene.textures, ruinKey, bridge.spanCells, bridge.deckWidthCells, bridge.id);
      this.textureKeys.push(deckKey, ruinKey);
      const rect = getBridgeDeckWorldRect(bridge, origin);
      const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
      const rotation = bridge.axis === 'horizontal' ? 0 : Math.PI / 2;
      const deck = scene.add.image(cx, cy, deckKey).setRotation(rotation).setDepth(DEPTH.WATER + .4);
      const ruin = scene.add.image(cx, cy, ruinKey).setRotation(rotation).setDepth(DEPTH.WATER + .4).setVisible(false);
      this.views.push({ bridge, deck, ruin, phase: null });
    }
  }

  /** Returns true when a bridge changed between standing and collapsed in this frame. */
  sync(readState: (id: string) => BridgeRuntimeState | null): boolean {
    if (this.destroyed) return false;
    let collapseChanged = false;
    for (const view of this.views) {
      const phase = readState(view.bridge.id)?.phase ?? 'standing';
      if (phase === view.phase) continue;
      const collapsed = phase === 'collapsed';
      if (collapsed && view.phase !== null) {
        this.fx.play(getBridgeDeckWorldRect(view.bridge, this.origin), view.bridge.axis === 'horizontal');
      }
      if (collapsed !== (view.phase === 'collapsed')) collapseChanged = true;
      view.deck.setVisible(!collapsed);
      view.ruin.setVisible(collapsed);
      view.phase = phase;
    }
    return collapseChanged;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fx.destroy();
    for (const view of this.views) { view.deck.destroy(); view.ruin.destroy(); }
    this.views.length = 0;
    for (const key of this.textureKeys) this.scene.textures.remove(key);
  }
}
