import * as Phaser from 'phaser';
import { CombatGoreGpuRenderer } from '../../effects/CombatGoreGpuRenderer';
import { GpuVfxSystem } from '../../effects/gpu/GpuVfxSystem';
import { GpuVfxEffectId } from '../../effects/gpu/GpuVfxEffects';
import { buildGpuVfxAtlas } from '../../effects/gpu/GpuVfxAtlas';
import { CameraPostFxController } from '../../effects/postfx/CameraPostFxController';
import { GraphicsQualityController } from '../../graphics/GraphicsQuality';
import { DEATH_TUNING_DEFAULTS, type DeathTuning } from '../../effects/gpu/DeathTuning';
import { FIXTURES, INITIAL_SETTINGS, fixtureAssets, fixtureSnapshot, type LabSettings } from './State';
import { DeathPlayback } from './Playback';
import { DeathLabApi } from './api';
import { attachControls } from './Controls';
import { sha256 } from './Export';
import { deathFollowCenter, type DeathFollowSample } from './Follow';

// Raw inputs identify the dirty worktree as well as HEAD; this import exists only in the lab bundle.
const codeSources = import.meta.glob([
  '../../effects/gpu/*.ts', '../../effects/CombatGoreGpuRenderer.ts', './*.ts', '../deathLab.ts',
  '../../config.ts', '../../graphics/GraphicsQuality.ts', '../../effects/postfx/*.ts',
  '../../graphics/PhaserAlphaZero.ts', '../../utils/webglContext.ts',
  '../../config/pipelineAssets.ts', '../../config/coopDefenseEnemies.ts', '../../animations/BadgerAnimations.ts',
  '../../config/pipelineAssets.json', '../../config/coopDefenseEnemies.json',
], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const LAB_WIDTH = 800, LAB_HEIGHT = 600;
export class DeathLabScene extends Phaser.Scene {
  settings: LabSettings = structuredClone(INITIAL_SETTINGS);
  tuning: DeathTuning = DEATH_TUNING_DEFAULTS;
  playback!: DeathPlayback;
  api!: DeathLabApi;
  private gpu!: GpuVfxSystem;
  private gore!: CombatGoreGpuRenderer;
  private quality!: GraphicsQualityController;
  private postfx!: CameraPostFxController;
  private ghost!: Phaser.GameObjects.Image;
  private forest!: Phaser.GameObjects.TileSprite;
  private cleanupControls: (() => void) | null = null;
  private readonly assetUrls = new Set<string>();
  private readonly followSamples: DeathFollowSample[] = [];

  preload(): void {
    this.load.setBaseURL('/');
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      document.getElementById('status')!.textContent = `Asset konnte nicht geladen werden: ${file.key}`;
    });
    for (const { asset, sheet } of fixtureAssets()) {
      this.load.image(asset.textureKey, asset.idlePath); this.assetUrls.add(asset.idlePath);
      if (sheet) {
        this.load.spritesheet(sheet.textureKey, sheet.assetPath, { frameWidth: sheet.frameWidth,
          frameHeight: sheet.frameHeight, margin: sheet.margin, spacing: sheet.spacing, endFrame: sheet.frameCount - 1 });
        this.assetUrls.add(sheet.assetPath);
      }
    }
    const ghostRoot = './assets/player/death-a01-r03/';
    this.load.atlas('dachs_death', `${ghostRoot}death-sheet.png`, `${ghostRoot}death-atlas.json`);
    this.assetUrls.add(`${ghostRoot}death-sheet.png`); this.assetUrls.add(`${ghostRoot}death-atlas.json`);
    this.load.image('death-lab-forest', './assets/sprites/gras_bg_tile.png');
    this.assetUrls.add('./assets/sprites/gras_bg_tile.png');
  }

  create(): void {
    this.quality = new GraphicsQualityController('high'); this.quality.attach(this);
    this.gpu = new GpuVfxSystem(this); this.gpu.setManualPresentationTime(true);
    this.gpu.setPreviewSpawnObserver(spec => {
      if (spec.effect === GpuVfxEffectId.DeathFragment) this.followSamples.push({ ...spec });
    });
    this.gore = new CombatGoreGpuRenderer(this); this.gore.registerGpuVfx(this.gpu);
    this.forest = this.add.tileSprite(0, 0, 2000, 1600, 'death-lab-forest').setDepth(1).setVisible(false);
    this.ghost = this.add.image(0, 0, 'dachs_death', 'badger-death-000')
      .setOrigin(0.5, 0.75).setDisplaySize(48, 96).setDepth(25.1);
    this.postfx = new CameraPostFxController(this, this.cameras.main);
    this.playback = new DeathPlayback({
      reset: () => { this.gpu.resetPresentationTime(); this.followSamples.length = 0; this.time.now = 0; this.postfx.reset(); },
      spawn: () => {
        const effect = fixtureSnapshot(this.settings);
        if (this.settings.layers.gore) this.gore.playHit({ type: 'hit', x: 0, y: 0,
          targetId: effect.targetId, targetColor: effect.targetColor, totalDamage: 40, hpLost: 40,
          armorLost: 0, isKill: true, dirX: effect.dirX!, dirY: effect.dirY!, seed: effect.seed }, () => {});
        this.gore.playDeath(effect, this.settings.fixture === 'player');
        if (this.settings.fixture === 'player' && this.settings.layers.postfx) this.postfx.pulseEvent('localDeath');
      },
      advance: dt => this.gpu.update(dt),
      sample: time => {
        this.time.now = time;
        this.ghost.setVisible(this.settings.fixture === 'player' && this.settings.layers.ghost && time < 1200);
        this.ghost.setFrame(`badger-death-${String(Math.min(71, Math.floor(time * 60 / 1000))).padStart(3, '0')}`);
        this.postfx.update(0);
        const center = this.settings.follow ? deathFollowCenter(this.followSamples, time) : { x: 0, y: 0 };
        this.cameras.main.centerOn(center.x, center.y);
      },
    });
    this.applySettings(this.settings);
    this.playback.seek(0);
    this.api = new DeathLabApi(this, this.identity());
    window.deathLab = this.api;
    this.cleanupControls = attachControls(this.api);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanupControls?.(); this.api.dispose();
      this.gpu.setPreviewSpawnObserver(null); this.followSamples.length = 0;
      this.gore.destroy(); this.gpu.destroy(); this.postfx.destroy(); this.quality.destroy();
      if (window.deathLab === this.api) delete window.deathLab;
    });
  }

  applySettings(settings: LabSettings): void {
    this.settings = settings;
    this.quality.setLevel(settings.quality);
    this.cameras.main.setZoom(settings.zoom).centerOn(0, 0)
      .setBackgroundColor(settings.background === 'light' ? '#d6d4c7' : '#202830');
    this.forest.setVisible(settings.background === 'forest');
    const effects = new Set<GpuVfxEffectId>();
    if (settings.layers.main) effects.add(GpuVfxEffectId.DeathFragment);
    if (settings.layers.micro) effects.add(GpuVfxEffectId.DeathMicroFragment);
    if (settings.layers.glows) { effects.add(GpuVfxEffectId.DeathGlow); effects.add(GpuVfxEffectId.DeathFragmentGlow); }
    if (settings.layers.gore) for (const id of [GpuVfxEffectId.BloodCore, GpuVfxEffectId.BloodStreak,
      GpuVfxEffectId.BloodDroplet, GpuVfxEffectId.BloodMicroDroplet]) effects.add(id);
    this.gpu.setPreviewEffects(effects);
  }

  applyTuning(tuning: DeathTuning): void {
    this.gpu.releaseAll();
    this.gore.setDeathTuning(tuning);
    buildGpuVfxAtlas(this, tuning);
    this.tuning = tuning;
  }

  update(_time: number, delta: number): void { this.api?.tick(delta); }

  capture(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Kein Renderframe innerhalb 10 s. Browser-Pane sichtbar halten.')), 10000);
      (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).snapshot(image => {
        window.clearTimeout(timeout);
        if (image instanceof HTMLImageElement) resolve(image.src);
        else reject(new Error('PNG-Snapshot fehlgeschlagen.'));
      });
    });
  }

  private async identity(): Promise<Record<string, unknown>> {
    const source = Object.entries(codeSources).sort(([a], [b]) => a.localeCompare(b));
    const assets = await Promise.all([...this.assetUrls].sort().map(async url => {
      const response = await fetch(new URL(url, `${location.origin}/`));
      if (!response.ok) throw new Error(`Asset-Identität: ${url} (${response.status})`);
      return { url, sha256: await sha256(await response.arrayBuffer()) };
    }));
    const gl = (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
    return { codeSha256: await sha256(new TextEncoder().encode(JSON.stringify(source))),
      build: __BUILD_TIMESTAMP__, version: __GAME_VERSION__, assets,
      renderer: gl.getParameter(gl.VERSION), phaser: Phaser.VERSION,
      renderSize: { width: LAB_WIDTH, height: LAB_HEIGHT }, devicePixelRatio: window.devicePixelRatio,
      context: 'neutral-or-forest-texture; no arena sunlight/lightmap/fog/shadows',
      gore: 'transient hit spray; no persistent blood stains', fixtures: FIXTURES };
  }
}
