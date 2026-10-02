import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { ArenaLayout, SyncedPlaceableRock } from '../types';
import { CHARACTER_SHADOW_CONFIG } from './ShadowConfig';
import { sunShaderName } from './sunlight/SunRenderTarget';

/** One cell-sized receiver texel. Obstacles/bases are exclusions, never casters.
 * Updated on the existing shadow invalidation path, not by scanning per player. */
export class CharacterShadowReceiver {
  readonly world: number[];
  readonly texture: Phaser.Textures.Texture;
  private readonly data: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  constructor(private readonly scene: Phaser.Scene,
    bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    this.width = Math.ceil((bounds.maxX - bounds.minX) / CELL_SIZE);
    this.height = Math.ceil((bounds.maxY - bounds.minY) / CELL_SIZE);
    this.world = [bounds.minX, bounds.minY, this.width * CELL_SIZE, this.height * CELL_SIZE];
    this.data = new Uint8Array(this.width * this.height * 4);
    const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl = renderer.gl;
    const wrapper = renderer.createTexture2D(0, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE,
      gl.RGBA, this.data, this.width, this.height, false, false, false);
    this.texture = scene.textures.addGLTexture(sunShaderName('CharacterReceiver'), wrapper)!;
  }
  update(layout: ArenaLayout, offsetX: number, offsetY: number,
    rockVisible: ((index: number) => boolean) | undefined, runtime: readonly SyncedPlaceableRock[],
    bases: Iterable<{ x: number; y: number }>): void {
    this.data.fill(255);
    for (const cell of layout.water ?? []) this.set(offsetX + (cell.gridX + .5) * CELL_SIZE,
      offsetY + (cell.gridY + .5) * CELL_SIZE, Math.round(255 * CHARACTER_SHADOW_CONFIG.waterResponse));
    for (let i = 0; i < layout.rocks.length; i++) {
      if (rockVisible && !rockVisible(i)) continue;
      const cell = layout.rocks[i];
      this.set(offsetX + (cell.gridX + .5) * CELL_SIZE, offsetY + (cell.gridY + .5) * CELL_SIZE, 0);
    }
    for (const cell of runtime) if (cell.hp > 0 && cell.collisionMode !== 'none') {
      this.set(offsetX + (cell.gridX + .5) * CELL_SIZE, offsetY + (cell.gridY + .5) * CELL_SIZE, 0);
    }
    for (const cell of bases) this.set(cell.x, cell.y, 0);
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl = renderer.gl;
    renderer.glTextureUnits.bind(this.texture.source[0].glTexture!, 0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
  }
  private set(x: number, y: number, value: number): void {
    const col = Math.floor((x - this.world[0]) / CELL_SIZE), row = Math.floor((y - this.world[1]) / CELL_SIZE);
    if (col >= 0 && col < this.width && row >= 0 && row < this.height) this.data[(row * this.width + col) * 4] = value;
  }
  sample(x: number, y: number): number {
    const col = Math.floor((x - this.world[0]) / CELL_SIZE), row = Math.floor((y - this.world[1]) / CELL_SIZE);
    return col >= 0 && col < this.width && row >= 0 && row < this.height
      ? this.data[(row * this.width + col) * 4] / 255 : 0;
  }
  destroy(): void { this.scene.textures.remove(this.texture.key); }
}
