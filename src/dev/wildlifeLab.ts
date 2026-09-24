import { preloadGroundMaterials } from '../arena/GroundMaterialConfig';
import { createArenaBackground } from '../arena/ArenaBackgroundRenderer';
import * as Phaser from 'phaser';
import { CANOPY_RADIUS, CELL_SIZE, DEPTH, TRUNK_RADIUS } from '../config';
import { buildLobbyWorldLayout, LOBBY_WORLD_HEIGHT_CELLS, LOBBY_WORLD_WIDTH_CELLS } from '../arena/LobbyWorldLayout';
import { AmbientWildlifeRenderer } from '../arena/AmbientWildlifeRenderer';
import type { WildlifeAnimal, WildlifeKind } from '../arena/AmbientWildlifeModel';
import { WaterSurfaceRenderer } from '../arena/WaterSurfaceRenderer';
import { AMBIENT_WILDLIFE } from '../arena/AmbientWildlifeConfig';
import type { ArenaLayout } from '../types';
import map00 from '../config/coopDefenseMaps/00-test.json';

/** Standalone manual fixture using production models/renderers, without game debug hooks. */
class WildlifeLab extends Phaser.Scene {
  private wildlife!: AmbientWildlifeRenderer;
  private water!: WaterSurfaceRenderer;
  private actor!: Phaser.GameObjects.Image;
  private shotMarker!: Phaser.GameObjects.Arc;
  private shotTime = 0;
  private target: WildlifeAnimal | undefined;
  private fixture = 0;
  private kind: WildlifeKind = 'butterfly';
  private approachTime = -1;
  private approachX = 0;
  private approachY = 0;
  private disposers: (() => void)[] = [];

  preload(): void {
    preloadGroundMaterials(this.load);
    this.load.image('wildlife-canopy', '/assets/sprites/canopies/canopy01.png');
    this.load.image('wildlife-badger', '/assets/sprites/pipeline-v2/badger/idle.png');
  }

  create(): void {
    const layout: ArenaLayout = this.fixture === 0 ? buildLobbyWorldLayout() : {
      seed: 183, rocks: [], dirt: [], tracks: [], powerUpPedestals: [],
      trees: [{ gridX: 51, gridY: 10 }, { gridX: 54, gridY: 24 }], water: map00.water,
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
    for (const kind of ['butterfly', 'snake', 'fish'] as const) bind(kind, () => this.focus(kind));
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
    bind('shot', () => {
      if (!this.target) return;
      const x = this.target.x - AMBIENT_WILDLIFE[this.kind].alertRadius * .7, y = this.target.y + 10;
      this.wildlife.notifyShot(x, y);
      this.shotMarker.setPosition(x, y).setVisible(true).setAlpha(1);
      this.shotTime = 1;
    });
    bind('zoom', () => {
      const zoom = this.cameras.main.zoom === 1 ? 3 : 1;
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

  private focus(kind: WildlifeKind): void {
    this.kind = kind;
    this.target = this.wildlife.model.animals.find(a => a.kind === kind);
    this.actor.setVisible(false); this.approachTime = -1;
    if (this.target) this.cameras.main.centerOn(this.target.x, this.target.y);
  }

  update(_time: number, delta: number): void {
    this.shotTime = Math.max(0, this.shotTime - Math.min(delta / 1000, .05));
    this.shotMarker.setVisible(this.shotTime > 0).setAlpha(this.shotTime);
    if (this.approachTime >= 0) {
      this.approachTime += Math.min(delta / 1000, .05);
      this.actor.setPosition(this.approachX + Math.min(this.approachTime, 1.2) * 45, this.approachY);
    }
    const players = this.actor.visible ? [{ id: 'probe', x: this.actor.x, y: this.actor.y }] : [];
    const view = this.cameras.main.worldView;
    this.water.prepareMasks();
    this.water.updateResidency(view);
    this.wildlife.update(delta, players, view);
    const animals = this.wildlife.model.animals;
    const counts = (['butterfly', 'snake', 'fish'] as const).map(kind => animals.filter(a => a.kind === kind).length);
    const solitary = animals.filter(a => a.kind === 'fish' && a.appearance.count === 1).length;
    const fishTotal = animals.reduce((sum, a) => sum + (a.kind === 'fish' ? a.appearance.count : 0), 0);
    let variant = '';
    if (this.target?.kind === 'snake') {
      const style = this.target.appearance;
      variant = ` · ${AMBIENT_WILDLIFE.snakeColors[style.colorIndex].name} · Länge ${(style.length * AMBIENT_WILDLIFE.visualScale).toFixed(0)} px`;
    } else if (this.target?.kind === 'fish') {
      const style = this.target.appearance;
      variant = ` · ${AMBIENT_WILDLIFE.fishGroups[style.groupIndex].name}: ${style.count} ${style.count === 1 ? 'Fisch' : 'Fische'} · ${AMBIENT_WILDLIFE.fishColors[style.colorIndex].name}`;
    }
    const phases = { swimming: 'Schwimmen', fleeing: 'Flucht', diving: 'Abtauchen', hidden: 'Untergetaucht', emerging: 'Auftauchen' };
    const phase = this.target?.kind === 'fish' ? ` · ${phases[this.target.fishPhase]} · Sichtbarkeit ${Math.round(this.target.opacity * 100)} %`
      : this.target ? ` · ${this.target.resting ? 'Ruhe · Flügel still' : this.target.fleeing ? 'Flucht' : 'Unterwegs'}` : '';
    const position = this.target ? ` · Tierposition ${this.target.x.toFixed(1)}, ${this.target.y.toFixed(1)}` : ' · Kein passender Lebensraum';
    document.getElementById('status')!.textContent = `${counts[0]} Schmetterlinge · ${counts[1]} Schlangen · ${counts[2] - solitary} Fischschwärme · ${solitary} ${solitary === 1 ? 'Einzelfisch' : 'Einzelfische'} (${fishTotal} Fische gesamt)${variant}${phase}${position}`;
  }
}

new Phaser.Game({ type: Phaser.WEBGL, parent: 'stage', backgroundColor: '#354e36',
  scale: { mode: Phaser.Scale.RESIZE }, render: { antialias: true }, scene: WildlifeLab });
