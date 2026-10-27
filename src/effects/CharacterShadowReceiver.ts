import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { ArenaLayout, SyncedPlaceableRock } from '../types';
import { CHARACTER_SHADOW_CONFIG } from './ShadowConfig';
import { sunShaderName } from './sunlight/SunRenderTarget';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../config/coopDefenseConstructions';
import { getBridgeDeckCells } from '../arena/BridgeGeometry';

/** World-pixel rect excluded from receiving figure shadows, e.g. a structure roof. */
export interface CharacterShadowReceiverRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Receiver texel size when structure outlines (8-px grid) must be excluded. */
export const STRUCTURE_RECEIVER_TEXEL_PX = 8;

/** One cell-sized receiver texel, or finer when structures need it. Obstacles/bases are exclusions,
 * never casters. Updated on the existing shadow invalidation path, not by scanning per player. */
export class CharacterShadowReceiver {
  /** Casters that clip submerged geometry invalidate their projected mask with the receiver. */
  revision = 0;
  readonly world: number[];
  readonly texture: Phaser.Textures.Texture;
  private readonly data: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  constructor(private readonly scene: Phaser.Scene,
    bounds: { minX: number; minY: number; maxX: number; maxY: number }, readonly texelPx: number = CELL_SIZE) {
    this.width = Math.ceil((bounds.maxX - bounds.minX) / texelPx);
    this.height = Math.ceil((bounds.maxY - bounds.minY) / texelPx);
    // The shaders map world to receiver UV through `world`; the texel size never enters them.
    this.world = [bounds.minX, bounds.minY, this.width * texelPx, this.height * texelPx];
    this.data = new Uint8Array(this.width * this.height * 4);
    const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl = renderer.gl;
    const wrapper = renderer.createTexture2D(0, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE,
      gl.RGBA, this.data, this.width, this.height, false, false, false);
    this.texture = scene.textures.addGLTexture(sunShaderName('CharacterReceiver'), wrapper)!;
  }
  update(layout: ArenaLayout, offsetX: number, offsetY: number,
    rockVisible: ((index: number) => boolean) | undefined, runtime: readonly SyncedPlaceableRock[],
    bases: Iterable<{ x: number; y: number }>, collapsedBridges: ReadonlySet<string> = new Set(),
    structures: readonly CharacterShadowReceiverRect[] = []): void {
    this.data.fill(255);
    for (const cell of layout.water ?? []) this.set(offsetX + (cell.gridX + .5) * CELL_SIZE,
      offsetY + (cell.gridY + .5) * CELL_SIZE, Math.round(255 * CHARACTER_SHADOW_CONFIG.waterResponse));
    // A standing deck is solid ground for figure shadows; its river shows again once it fell.
    for (const bridge of layout.bridges ?? []) if (!collapsedBridges.has(bridge.id)) {
      for (const cell of getBridgeDeckCells(bridge)) {
        this.set(offsetX + (cell.gridX + .5) * CELL_SIZE, offsetY + (cell.gridY + .5) * CELL_SIZE, 255);
      }
    }
    for (let i = 0; i < layout.rocks.length; i++) {
      if (rockVisible && !rockVisible(i)) continue;
      const cell = layout.rocks[i];
      this.set(offsetX + (cell.gridX + .5) * CELL_SIZE, offsetY + (cell.gridY + .5) * CELL_SIZE, 0);
    }
    for (const cell of runtime) if (cell.kind !== 'watchtower' && cell.hp > 0 && cell.collisionMode !== 'none') {
      this.set(offsetX + (cell.gridX + .5) * CELL_SIZE, offsetY + (cell.gridY + .5) * CELL_SIZE, 0);
    }
    // Restore the raised walkable deck after both obstacle passes (including its anchor).
    // Bases still win below; water outside the actual platform remains attenuated.
    for (const tower of runtime) if (tower.kind === 'watchtower' && tower.hp > 0
      && (!rockVisible || rockVisible(tower.id))) {
      for (const cell of COOP_DEFENSE_CONSTRUCTIONS.watchtower.footprint) {
        this.set(offsetX + (tower.gridX + cell.dx + .5) * CELL_SIZE,
          offsetY + (tower.gridY + cell.dy + .5) * CELL_SIZE, 255);
      }
    }
    for (const rect of structures) this.setRect(rect, 0);
    // G is the raised plane: only base tops, for casters standing on them (turrets). Their shadow beyond
    // the top belongs to the structure's own height-field shadow, which carries the deck height.
    for (let i = 0; i < this.data.length; i += 4) this.data[i + 1] = 0;
    for (const cell of bases) { this.set(cell.x, cell.y, 0); this.set(cell.x, cell.y, 255, 1); }
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl = renderer.gl;
    renderer.glTextureUnits.bind(this.texture.source[0].glTexture!, 0);
    // Image uploads can leave flipY enabled. Receiver rows are world north-to-south;
    // inherit neither their orientation nor colour conversion from the previous upload.
    renderer.glWrapper.updateTexturing({ texturing: { flipY: false, premultiplyAlpha: false } });
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    this.revision++;
  }
  /** Writes the whole world cell containing the point; channel 0 is the ground plane, 1 the raised base plane. */
  private set(x: number, y: number, value: number, channel = 0): void {
    const left = Math.floor((x - this.world[0]) / CELL_SIZE) * CELL_SIZE + this.world[0];
    const top = Math.floor((y - this.world[1]) / CELL_SIZE) * CELL_SIZE + this.world[1];
    this.setRect({ x: left, y: top, width: CELL_SIZE, height: CELL_SIZE }, value, channel);
  }
  /** Writes every texel whose centre lies inside the world-pixel rect; uploaded with the next update. */
  setRect(rect: CharacterShadowReceiverRect, value: number, channel = 0): void {
    const step = this.texelPx;
    const minCol = Math.max(0, Math.ceil((rect.x - this.world[0]) / step - .5));
    const maxCol = Math.min(this.width, Math.ceil((rect.x + rect.width - this.world[0]) / step - .5));
    const minRow = Math.max(0, Math.ceil((rect.y - this.world[1]) / step - .5));
    const maxRow = Math.min(this.height, Math.ceil((rect.y + rect.height - this.world[1]) / step - .5));
    for (let row = minRow; row < maxRow; row++) for (let col = minCol; col < maxCol; col++) {
      this.data[(row * this.width + col) * 4 + channel] = value;
    }
  }
  sample(x: number, y: number, channel = 0): number {
    const col = Math.floor((x - this.world[0]) / this.texelPx), row = Math.floor((y - this.world[1]) / this.texelPx);
    return col >= 0 && col < this.width && row >= 0 && row < this.height
      ? this.data[(row * this.width + col) * 4 + channel] / 255 : 0;
  }
  destroy(): void { this.scene.textures.remove(this.texture.key); }
}
