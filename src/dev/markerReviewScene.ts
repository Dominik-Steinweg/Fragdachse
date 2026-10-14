import * as Phaser from 'phaser';
import { MarkerGpuRenderer } from '../effects/markers/MarkerGpuRenderer';
import { MARKER_GLYPH_IDS, MARKER_STYLES, type MarkerBadgeInstance, type MarkerFrame, type MarkerKind } from '../effects/markers/MarkerTypes';
import { MARKER_GLYPH_ATLAS_KEY, MARKER_GLYPH_FALLBACK_KEY } from '../effects/markers/MarkerGlyphAtlas';
import { ClarityCameraRegistry, promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { LightingSystem } from '../effects/LightingSystem';
import { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { createWebGLStartupContext } from '../utils/webglContext';

const WIDTH = 1440, HEIGHT = 860;
const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
const checked = (id: string) => (document.getElementById(id) as HTMLInputElement).checked;
const makeBadge = (key: string, kind: MarkerKind, glyph: MarkerBadgeInstance['glyph'], x: number, y: number,
  extra: Partial<MarkerBadgeInstance> = {}): MarkerBadgeInstance => ({
    key, ...MARKER_STYLES[kind], space: 'world', x, y, glyph, state: 'active', alpha: 1, scale: 1,
    vulnerable: false, pulse: 'calm', pointerAngle: Math.PI / 2, ...extra,
  });

class MarkerReviewScene extends Phaser.Scene {
  private readonly renderers: MarkerGpuRenderer[] = [];
  private frames: MarkerFrame[] = [];
  private terrain: Phaser.GameObjects.TileSprite[] = [];
  private light: LightingSystem | null = null;
  private readonly quality = new GraphicsQualityController('high');
  private icons: Phaser.GameObjects.Image[] = [];
  private clarityRegistry!: ClarityCameraRegistry;
  private frameLabels: Phaser.GameObjects.Text[] = [];
  preload(): void {
    for (const [key, file] of [['grass', 'gras_bg_tile'], ['dirt', 'dirt_material'], ['gravel', 'gravel_material']]) {
      this.load.image(`review-${key}`, `/assets/sprites/${file}.png`);
    }
  }
  create(): void {
    this.quality.attach(this);
    this.cameras.main.setOrigin(0, 0);
    const clarity = this.cameras.add(0, 0, WIDTH, HEIGHT).setOrigin(0, 0).setName('clarity');
    this.clarityRegistry = new ClarityCameraRegistry(this, this.cameras.main, clarity); this.clarityRegistry.install();
    for (let panel = 0; panel < 3; panel++) {
      const x = 18 + panel * 474;
      this.terrain.push(this.add.tileSprite(x, 74, 456, 664, `review-${['grass', 'dirt', 'gravel'][panel]}`).setOrigin(0).setDepth(0));
      const title = this.add.text(x + 16, 89, ['GRAS', 'ERDE', 'KIES'][panel], { fontFamily: 'Chakra Petch', fontSize: '18px', fontStyle: 'bold', color: '#f2dfb6' }).setDepth(100);
      promoteToClarityCamera(this, title);
      this.renderers.push(new MarkerGpuRenderer(this));
    }
    const heading = this.add.text(26, 22, 'MESSING / WALNUSS   ·   1:1 DESIGNPIXEL', { fontFamily: 'Chakra Petch', fontSize: '22px', fontStyle: 'bold', color: '#eed8aa' }).setDepth(100);
    promoteToClarityCamera(this, heading);
    const info = this.add.text(1414, 27, '8 Weltbadges + 6 Randmarker je Materialprobe', { fontFamily: 'Chakra Petch', fontSize: '13px', color: '#bcae90' }).setOrigin(1, 0).setDepth(100);
    promoteToClarityCamera(this, info);
    // All authored glyphs at their actual 16 px display size (fallback while loading).
    MARKER_GLYPH_IDS.forEach((id, i) => {
      const x = 38 + i * 77;
      const icon = this.add.image(x, 784, MARKER_GLYPH_FALLBACK_KEY, id).setDisplaySize(16, 16).setTint(0xf5ebcc).setDepth(100);
      this.icons.push(icon);
      promoteToClarityCamera(this, icon);
      const name = this.add.text(x, 803, id.replace('site-', '').replace('mission-', 'm-'), { fontFamily: 'Chakra Petch', fontSize: '10px', color: '#bcae90' }).setOrigin(.5, 0).setDepth(100);
      promoteToClarityCamera(this, name);
    });
    const change = () => this.refresh();
    for (const id of ['light', 'zoom', 'low', 'animate']) document.getElementById(id)!.addEventListener('change', change);
    this.events.once('shutdown', () => {
      for (const id of ['light', 'zoom', 'low', 'animate']) document.getElementById(id)!.removeEventListener('change', change);
      for (const renderer of this.renderers) renderer.destroy();
      this.light?.destroy(); this.quality.destroy(); this.clarityRegistry.destroy();
      delete (window as MarkerWindow).markerReview;
    });
    (window as MarkerWindow).markerReview = {
      set: (night, zoom = 1, low = false) => {
        select('light').value = night ? 'night' : 'day'; select('zoom').value = String(zoom);
        (document.getElementById('low') as HTMLInputElement).checked = low; this.refresh();
      },
      diagnostics: () => this.renderers.map(renderer => renderer.getDiagnostics()),
    };
    this.refresh();
  }
  private refresh(): void {
    const zoom = Number(select('zoom').value), night = select('light').value === 'night';
    this.cameras.main.setZoom(zoom);
    this.quality.setLevel(checked('low') ? 'low' : 'high');
    this.light?.destroy();
    this.light = new LightingSystem(this, { width: WIDTH / zoom, height: HEIGHT / zoom });
    this.light.setTimeOfDay(night ? 0 : 720); this.light.setActive(true);
    for (const tile of this.terrain) {
      const panel = this.terrain.indexOf(tile);
      tile.setPosition((18 + panel * 474) / zoom, 74 / zoom).setScale(1 / zoom);
    }
    for (const label of this.frameLabels) label.destroy(); this.frameLabels.length = 0;
    this.frames = this.renderers.map((_, panel) => {
      const left = 18 + panel * 474;
      const world = (key: string, kind: MarkerKind, glyph: MarkerBadgeInstance['glyph'], x: number, y: number, text: string, extra: Partial<MarkerBadgeInstance> = {}) => {
        const size = Math.max(22, Math.min(40, MARKER_STYLES[kind].diameter * zoom));
        const label = this.add.text(left + x, y + 49, text, { fontFamily: 'Chakra Petch', fontSize: '12px', color: '#ebdfc7', stroke: '#1e190f', strokeThickness: 3 }).setOrigin(.5, 0).setDepth(100);
        promoteToClarityCamera(this, label); this.frameLabels.push(label);
        return makeBadge(key, kind, glyph, (left + x) / zoom, y / zoom, { ...extra, diameter: size / zoom });
      };
      const worldBadges = [
        world('base', 'main-objective', 'base', 100, 174, 'Hauptziel'),
        world('boss', 'boss', 'boss', 232, 174, 'Boss · verwundbar', { vulnerable: true }),
        world('hazard', 'hazard', 'hazard', 364, 174, 'Gefahr', { pulse: 'urgent' }),
        world('dormant', 'site', 'site-wreck', 100, 299, 'Ruhend · Tier 1', { state: 'dormant', alpha: .7, pulse: 'none', tier: 1 }),
        world('active', 'site', 'site-extractor', 232, 299, 'Aktiv · Tier 2', { progress: .68, tier: 2 }),
        world('tier3', 'site', 'site-brood-nest', 364, 299, 'Aktiv · Tier 3', { progress: .24, tier: 3 }),
        world('completed', 'site', 'site-supply', 142, 428, 'Abgeschlossen', { state: 'completed', pulse: 'none' }),
        world('failed', 'site', 'site-scrap-heaps', 314, 428, 'Fehlgeschlagen', { state: 'failed', pulse: 'none' }),
      ];
      const edgeBadges = ([['return', 'base'], ['mission', 'mission-hold'], ['carry', 'crate'], ['delivery', 'flag'], ['checkpoint', 'flag'], ['utility', 'tool']] as const)
        .map(([kind, glyph], i) => makeBadge(`edge-${kind}`, kind, glyph, left + 66 + (i % 3) * 162, 573 + Math.floor(i / 3) * 103,
          { space: 'screen', diameter: 28, pointerAngle: [-Math.PI / 2, .4, Math.PI, 1.5, -2.4, 0][i],
            distanceLabel: `${[85, 42, 12, 24, 105, 18][i]} m`, count: i === 1 ? 3 : undefined, pulse: i === 0 ? 'urgent' : 'none' }));
      const groundRings = [0, 1, 2].map(i => ({ key: `ground-${i}`, x: (left + 100 + i * 132) / zoom,
        y: 184 / zoom, radiusPx: 43 / zoom, tone: (['gold', 'purple', 'red'] as const)[i], alpha: .8 }));
      return { worldBadges, edgeBadges, groundRings };
    });
    this.update();
    document.getElementById('status')!.textContent = `${night ? 'Nacht' : 'Tag'} · ${zoom}× · ${checked('low') ? 'Low' : 'High'}`;
  }
  update(): void {
    const now = checked('animate') ? this.time.now : 520;
    this.renderers.forEach((renderer, i) => renderer.sync(this.frames[i] ?? { worldBadges: [], edgeBadges: [], groundRings: [] }, now, checked('low')));
    this.light?.update();
    if (this.textures.exists(MARKER_GLYPH_ATLAS_KEY)) this.icons.forEach((icon, i) => {
      if (icon.texture.key !== MARKER_GLYPH_ATLAS_KEY) icon.setTexture(MARKER_GLYPH_ATLAS_KEY, `${MARKER_GLYPH_IDS[i]}@16`).setDisplaySize(16, 16);
    });
  }
}
interface MarkerWindow extends Window { markerReview?: { set(night: boolean, zoom?: number, low?: boolean): void; diagnostics(): unknown } }
void Promise.all([document.fonts.load('700 16px "Chakra Petch"'), document.fonts.load('500 16px "Chakra Petch"')]).then(() => {
  // Same context as the game (WebGL2 first), so shader compatibility is reviewed for real.
  const startup = createWebGLStartupContext();
  new Phaser.Game({ type: Phaser.WEBGL, parent: 'preview', width: WIDTH, height: HEIGHT, backgroundColor: '#141710',
    ...(startup ? { canvas: startup.canvas, context: startup.context as unknown as CanvasRenderingContext2D } : {}),
    audio: { noAudio: true }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, roundPixels: false }, scene: MarkerReviewScene });
});
