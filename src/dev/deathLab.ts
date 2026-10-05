import * as Phaser from 'phaser';
import { installPhaserAlphaZero } from '../graphics/PhaserAlphaZero';
import { installPhaserGpuLayerTextures } from '../graphics/PhaserGpuLayerTextures';
import { createWebGLStartupContext } from '../utils/webglContext';
import { DeathLabScene, LAB_WIDTH, LAB_HEIGHT } from './deathLab/Scene';

const startup = createWebGLStartupContext();
if (!startup) {
  document.getElementById('status')!.textContent = 'WebGL ist nicht verfügbar.';
} else {
  installPhaserAlphaZero(Phaser.Renderer.WebGL.ProgramManager.prototype);
  installPhaserGpuLayerTextures(Phaser.GameObjects.SpriteGPULayer.prototype);
  const game = new Phaser.Game({ type: Phaser.WEBGL, canvas: startup.canvas,
    context: startup.context as unknown as CanvasRenderingContext2D,
    parent: 'stage', width: LAB_WIDTH, height: LAB_HEIGHT,
    backgroundColor: '#202830', smoothPixelArt: startup.rendererType === 'webgl1',
    scene: DeathLabScene, fps: { target: 60, smoothStep: false },
    scale: { mode: Phaser.Scale.NONE }, render: { antialias: true },
  });
  import.meta.hot?.dispose(() => game.destroy(true));
}
