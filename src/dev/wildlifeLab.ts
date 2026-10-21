import {createVisibleWorldView,getVisibleWorldView} from '../graphics/CameraWorldView';
const cameraView=createVisibleWorldView();
import { preloadGroundMaterials } from '../arena/GroundMaterialConfig';
import { createArenaBackground } from '../arena/ArenaBackgroundRenderer';
import * as Phaser from 'phaser';
import { CANOPY_RADIUS, CELL_SIZE, DEPTH, DEPTH_LIGHTING, TRUNK_RADIUS } from '../config';
import { buildLobbyWorldLayout, LOBBY_WORLD_HEIGHT_CELLS, LOBBY_WORLD_WIDTH_CELLS } from '../arena/LobbyWorldLayout';
import { AmbientWildlifeRenderer } from '../arena/AmbientWildlifeRenderer';
import type { WildlifeAnimal, WildlifeKind } from '../arena/AmbientWildlifeModel';
import { WaterSurfaceRenderer } from '../arena/WaterSurfaceRenderer';
import { AMBIENT_WILDLIFE } from '../arena/AmbientWildlifeConfig';
import { isBird } from '../arena/AmbientWildlifeAppearance';
import type { BirdPhase } from '../arena/AmbientWildlifeBirds';
import { createSunPath, resolveSunPath } from '../effects/sunlight/SunPath';
import type { SunTuning } from '../effects/sunlight/SunTuning';
import type { ArenaLayout } from '../types';
import map00 from '../config/coopDefenseMaps/00-test.json';

/** Lab times of day; the night tint approximates the lightmap's ambient, not the production lighting. */
const TIMES = [
  { label: '12:00', minutes: 12 * 60, ambient: 0xffffff },
  { label: '19:40', minutes: 19 * 60 + 40, ambient: 0xb8a690 },
  { label: '00:00', minutes: 0, ambient: 0x4a5670 },
] as const;
const KINDS = ['butterfly', 'snake', 'fish', 'sparrow', 'magpie', 'raven', 'owl'] as const;
const BIRD_PHASES: Record<BirdPhase, string> = { hidden: 'Schlafplatz', emerge: 'Ausflug', forage: 'Futtersuche',
  drink: 'Trinken', flight: 'Flug', landing: 'Landung', roost: 'Heimkehr', patrol: 'Patrouille', circle: 'Kreisen',
  dive: 'Sturzflug', mantle: 'Beute', climb: 'Steigflug' };

/** Standalone manual fixture using production models/renderers, without game debug hooks. */
class WildlifeLab extends Phaser.Scene {
  private wildlife!: AmbientWildlifeRenderer;
  private water!: WaterSurfaceRenderer;
  private actor!: Phaser.GameObjects.Image;
  private shotMarker!: Phaser.GameObjects.Arc;
  private darkness!: Phaser.GameObjects.Rectangle;
  private shotTime = 0;
  private target: WildlifeAnimal | undefined;
  private fixture = 0;
  private timeIndex = 0;
  private enemy = false;
  private kind: WildlifeKind = 'butterfly';
  private approachTime = -1;
  private approachX = 0;
  private approachY = 0;
  private disposers: (() => void)[] = [];
  private readonly sunPath = createSunPath();

  preload(): void {
    preloadGroundMaterials(this.load);
    this.load.image('wildlife-canopy', '/assets/sprites/canopies/canopy01.png');
    this.load.image('wildlife-badger', '/assets/sprites/pipeline-v2/badger/idle.png');
  }

  create(): void {
    const layout: ArenaLayout = this.fixture === 0 ? buildLobbyWorldLayout() : {
      seed: 183, rocks: [], dirt: [], tracks: [], powerUpPedestals: [],
      trees: [{ gridX: 51, gridY: 10 }, { gridX: 54, gridY: 24 }, { gridX: 20, gridY: 40 }, { gridX: 90, gridY: 30 }],
      water: map00.water,
    };
    const width = this.fixture === 0 ? LOBBY_WORLD_WIDTH_CELLS * CELL_SIZE : 4096;
    const height = this.fixture === 0 ? LOBBY_WORLD_HEIGHT_CELLS * CELL_SIZE : 2048;
    const frame = { offsetX: 0, offsetY: 0, width, height };
    createArenaBackground(this, width / 2, height / 2, width, height);
    const canopies: Phaser.GameObjects.Image[] = [];
    for (const tree of layout.trees) {
      const x = (tree.gridX + .5) * CELL_SIZE, y = (tree.gridY + .5) * CELL_SIZE;
      this.add.circle(x, y, TRUNK_RADIUS, 0x67503c).setDepth(DEPTH.ROCKS);
      canopies.push(this.add.image(x, y, 'wildlife-canopy').setDisplaySize(CANOPY_RADIUS * 2, CANOPY_RADIUS * 2).setDepth(DEPTH.CANOPY));
    }
    this.water = new WaterSurfaceRenderer(this, frame, layout.water ?? [], layout.seed);
    this.wildlife = new AmbientWildlifeRenderer(this, frame, layout);
    this.actor = this.add.image(0, 0, 'wildlife-badger').setDisplaySize(48, 48).setDepth(DEPTH.PLAYERS).setVisible(false);
    this.shotMarker = this.add.circle(0, 0, 4, 0xffdb85).setDepth(DEPTH.PLAYERS).setVisible(false);
    // Lab stand-in for the lightmap: everything below it darkens, flying birds above it carry their tint.
    this.darkness = this.add.rectangle(0, 0, 8, 8, 0xffffff).setOrigin(0).setScrollFactor(0)
      .setDepth(DEPTH_LIGHTING).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.shotTime = 0;
    this.approachTime = -1;
    this.cameras.main.setBounds(0, 0, width, height).setZoom(1);
    document.getElementById('zoom')!.textContent = 'Zoom 100 %';
    document.getElementById('fixture')!.textContent = `Karte: ${this.fixture === 0 ? 'Lobby' : 'Testkarte 00 – See'}`;
    const bind = (id: string, action: () => void): void => {
      const button = document.getElementById(id)!;
      button.addEventListener('click', action);
      this.disposers.push(() => button.removeEventListener('click', action));
    };
    for (const kind of KINDS) bind(kind, () => this.focus(kind));
    let transparentCanopies = false;
    document.getElementById('canopies')!.textContent = 'Baumkronen: normal';
    bind('canopies', () => {
      transparentCanopies = !transparentCanopies;
      canopies.forEach(canopy => canopy.setAlpha(transparentCanopies ? .18 : 1));
      document.getElementById('canopies')!.textContent = `Baumkronen: ${transparentCanopies ? 'transparent' : 'normal'}`;
    });
    bind('next', () => {
      const candidates = this.wildlife.model.animals.filter(a => a.kind === this.kind);
      const index = this.target ? candidates.indexOf(this.target) : -1;
      this.target = candidates[(index + 1) % candidates.length];
      this.actor.setVisible(false); this.approachTime = -1;
      if (this.target) this.cameras.main.centerOn(this.target.x, this.target.y);
    });
    bind('approach', () => {
      if (!this.target) return;
      this.approachX = this.target.x - AMBIENT_WILDLIFE[this.kind].alertRadius * .7;
      this.approachY = this.target.y + 10;
      this.approachTime = 0;
      this.actor.setPosition(this.approachX, this.approachY).setVisible(true).setAngle(90);
    });
    bind('clear', () => { this.actor.setVisible(false); this.approachTime = -1; });
    bind('shot', () => this.impulse('shot'));
    bind('explosion', () => this.impulse('explosion'));
    bind('enemy', () => {
      this.enemy = !this.enemy;
      document.getElementById('enemy')!.textContent = `Störer: ${this.enemy ? 'großer Gegner' : 'Spieler'}`;
      this.actor.setTint(this.enemy ? 0xc06060 : 0xffffff).setDisplaySize(this.enemy ? 96 : 48, this.enemy ? 96 : 48);
    });
    document.getElementById('time')!.textContent = `Tageszeit: ${TIMES[this.timeIndex].label}`;
    bind('time', () => {
      this.timeIndex = (this.timeIndex + 1) % TIMES.length;
      document.getElementById('time')!.textContent = `Tageszeit: ${TIMES[this.timeIndex].label}`;
    });
    bind('zoom', () => {
      const steps = [1, 3, 6, 12], current = steps.indexOf(this.cameras.main.zoom);
      const zoom = steps[(current + 1) % steps.length];
      this.cameras.main.setZoom(zoom);
      if (this.target) this.cameras.main.centerOn(this.target.x, this.target.y);
      document.getElementById('zoom')!.textContent = `Zoom ${zoom * 100} %`;
    });
    bind('fixture', () => { this.fixture = 1 - this.fixture; this.scene.restart(); });
    bind('rebuild', () => this.scene.restart());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.wildlife.destroy(); this.water.destroy();
      this.disposers.forEach(dispose => dispose()); this.disposers = [];
    });
    this.focus(this.kind);
  }

  private impulse(kind: 'shot' | 'explosion'): void {
    if (!this.target) return;
    const x = this.target.x - AMBIENT_WILDLIFE[this.kind].alertRadius * (kind === 'shot' ? .7 : 1.6), y = this.target.y + 10;
    this.wildlife.notifyImpulse(kind, x, y, kind === 'explosion' ? 64 : 0);
    this.shotMarker.setPosition(x, y).setVisible(true).setAlpha(1).setRadius(kind === 'shot' ? 4 : 18)
      .setFillStyle(kind === 'shot' ? 0xffdb85 : 0xff8a4a);
    this.shotTime = 1;
  }

  private focus(kind: WildlifeKind): void {
    this.kind = kind;
    const animals = this.wildlife.model.animals.filter(a => a.kind === kind);
    this.target = animals.find(a => a.opacity > 0) ?? animals[0];
    this.actor.setVisible(false); this.approachTime = -1;
    if (this.target) this.cameras.main.centerOn(this.target.x, this.target.y);
  }

  update(_time: number, delta: number): void {
    const time = TIMES[this.timeIndex];
    this.shotTime = Math.max(0, this.shotTime - Math.min(delta / 1000, .05));
    this.shotMarker.setVisible(this.shotTime > 0).setAlpha(this.shotTime);
    if (this.approachTime >= 0) {
      this.approachTime += Math.min(delta / 1000, .05);
      this.actor.setPosition(this.approachX + Math.min(this.approachTime, 1.2) * 45, this.approachY);
    }
    const movers = this.actor.visible
      ? [{ id: this.enemy ? 'enemy' : 'probe', x: this.actor.x, y: this.actor.y, radius: this.enemy ? 24 : 0 }] : [];
    const view = getVisibleWorldView(this.cameras.main,cameraView);
    this.darkness.setSize(this.scale.width, this.scale.height).setFillStyle(time.ambient);
    this.wildlife.setSunlight({ tuning: {} as SunTuning, timeSec: 0, strength: 0,
      sunPath: resolveSunPath(time.minutes, null, this.sunPath) });
    this.water.prepareMasks();
    this.water.updateResidency(view);
    this.wildlife.update(delta, movers, view, time.minutes,
      { setLight: () => {}, releaseLight: () => {}, resolveCanopyTint: () => time.ambient });
    // Birds leave the frame quickly; keep the selected one in view.
    if (this.target && isBird(this.target.kind) && this.target.opacity > 0) this.cameras.main.centerOn(this.target.x, this.target.y);
    const animals = this.wildlife.model.animals;
    const count = (kind: WildlifeKind) => animals.filter(a => a.kind === kind).length;
    const solitary = animals.filter(a => a.kind === 'fish' && a.appearance.count === 1).length;
    const fishTotal = animals.reduce((sum, a) => sum + (a.kind === 'fish' ? a.appearance.count : 0), 0);
    const sparrows = animals.reduce((sum, a) => sum + (a.kind === 'sparrow' ? a.appearance.count : 0), 0);
    let variant = '';
    if (this.target?.kind === 'snake') {
      const style = this.target.appearance;
      variant = ` · ${AMBIENT_WILDLIFE.snakeColors[style.colorIndex].name} · Länge ${(style.length * AMBIENT_WILDLIFE.visualScale).toFixed(0)} px`;
    } else if (this.target?.kind === 'fish') {
      const style = this.target.appearance;
      variant = ` · ${AMBIENT_WILDLIFE.fishGroups[style.groupIndex].name}: ${style.count} ${style.count === 1 ? 'Fisch' : 'Fische'} · ${AMBIENT_WILDLIFE.fishColors[style.colorIndex].name}`;
    } else if (this.target?.bird) {
      const bird = this.target.bird;
      variant = ` · ${BIRD_PHASES[bird.phase]} · Höhe ${bird.altitude.toFixed(0)} px${this.target.kind === 'sparrow' ? ` · ${this.target.appearance.count} Spatzen` : ''}`;
    }
    const phases = { swimming: 'Schwimmen', fleeing: 'Flucht', diving: 'Abtauchen', hidden: 'Untergetaucht', emerging: 'Auftauchen' };
    const phase = this.target?.kind === 'fish' ? ` · ${phases[this.target.fishPhase]} · Sichtbarkeit ${Math.round(this.target.opacity * 100)} %`
      : this.target && !this.target.bird ? ` · ${this.target.resting ? 'Ruhe · Flügel still' : this.target.fleeing ? 'Flucht' : 'Unterwegs'}`
        : this.target?.fleeing ? ' · Flucht' : '';
    const position = this.target ? ` · Tierposition ${this.target.x.toFixed(1)}, ${this.target.y.toFixed(1)}` : ' · Kein passender Lebensraum';
    document.getElementById('status')!.textContent = `${count('butterfly')} Schmetterlinge · ${count('snake')} Schlangen · ${count('fish') - solitary} Fischschwärme · ${solitary} ${solitary === 1 ? 'Einzelfisch' : 'Einzelfische'} (${fishTotal} Fische) · ${count('sparrow')} Spatzenschwärme (${sparrows}) · ${count('magpie')} Elstern · ${count('raven')} Raben · ${count('owl')} Eulen${variant}${phase}${position}`;
  }
}

new Phaser.Game({ type: Phaser.WEBGL, parent: 'stage', backgroundColor: '#354e36',
  scale: { mode: Phaser.Scale.RESIZE }, render: { antialias: true }, scene: WildlifeLab });
