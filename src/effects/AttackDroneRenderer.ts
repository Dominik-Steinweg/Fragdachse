import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, DEPTH } from '../config';
import { getPipelineAsset } from '../config/pipelineAssets';
import { ATTACK_DRONE_RULES as R } from '../config/attackDrone';
import type { SyncedAttackDrone, SyncedAttackDroneBomb, SyncedPlaceableRock } from '../types';
import { ensureCanvasTexture, registerGraphicsObject } from './EffectUtils';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';

const ASSETS = ['attack-drone-station', 'attack-drone-body', 'attack-drone-gun'] as const;
const SHADOW = '__attack_drone_shadow', FLASH = '__attack_drone_flash', BOMB = '__attack_drone_bomb';
interface DroneVisual {
  body: Phaser.GameObjects.Image; gun: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image;
  marker: Phaser.GameObjects.Arc; flash: Phaser.GameObjects.Image;
  state: SyncedAttackDrone; x: number; y: number; flightAngle: number; gunAngle: number; flashUntil: number;
}
export function preloadAttackDroneAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const id of ASSETS) {
    const asset = getPipelineAsset(id);
    loader.image(asset.textureKey, asset.idlePath);
    if (asset.clips.length) loader.spritesheet(asset.sheetTextureKey, asset.sheetPath, asset.layout);
  }
}
/** Snapshot projection only. Sequence numbers never replay old muzzle flashes after loss or late join. */
export class AttackDroneRenderer {
  private readonly drones = new Map<string, DroneVisual>();
  private readonly stations = new Map<number, Phaser.GameObjects.Image>();
  private readonly bombs = new Map<string, { image: Phaser.GameObjects.Image; state: SyncedAttackDroneBomb }>();
  private readonly bombPool: Phaser.GameObjects.Image[] = [];
  private audio: Pick<GameAudioSystem, 'playSound'> | null = null;
  private nextShotSoundAt = 0;
  setAudio(audio: Pick<GameAudioSystem, 'playSound'>): void { this.audio = audio; }
  constructor(private readonly scene: Phaser.Scene) {
    ensureCanvasTexture(scene.textures, SHADOW, 64, 64, ctx => {
      const gradient = ctx.createRadialGradient(32, 32, 6, 32, 32, 31);
      gradient.addColorStop(0, 'rgba(5,12,18,.34)'); gradient.addColorStop(1, 'rgba(5,12,18,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
    });
    ensureCanvasTexture(scene.textures, FLASH, 32, 16, ctx => {
      const gradient = ctx.createRadialGradient(5, 8, 1, 5, 8, 23);
      gradient.addColorStop(0, '#fffce0'); gradient.addColorStop(.25, '#ffd390'); gradient.addColorStop(1, 'rgba(255,147,50,0)');
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(28, 2); ctx.lineTo(20, 8); ctx.lineTo(28, 14); ctx.closePath(); ctx.fill();
    });
    ensureCanvasTexture(scene.textures, BOMB, 16, 16, ctx => {
      ctx.fillStyle = '#bb783d'; ctx.fillRect(4, 2, 8, 4);
      ctx.fillStyle = '#253e46'; ctx.beginPath(); ctx.ellipse(8, 9, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c1d0ce'; ctx.fillRect(6, 6, 2, 6);
    });
  }
  syncVisuals(states: readonly SyncedAttackDrone[], bombs: readonly SyncedAttackDroneBomb[], constructions: readonly SyncedPlaceableRock[], now: number): void {
    const present = new Set(states.map(s => s.id));
    for (const [id, visual] of this.drones) if (!present.has(id)) { this.destroyDrone(visual); this.drones.delete(id); }
    for (const state of states) {
      let visual = this.drones.get(state.id);
      if (!visual) { visual = this.createDrone(state); this.drones.set(state.id, visual); }
      else if (state.shotSequence > visual.state.shotSequence && now - state.lastShotAt < 90) {
        visual.flashUntil = now + 35;
        if (now >= this.nextShotSoundAt) {
          this.audio?.playSound('shot_p90', state.x, state.y, undefined, .22);
          this.nextShotSoundAt = now + 70;
        }
      }
      visual.state = state;
    }
    const pads = constructions.filter(c => c.constructionId === 'attack_drone_station');
    const padIds = new Set(pads.map(c => c.id));
    for (const [id, image] of this.stations) if (!padIds.has(id)) { image.destroy(); this.stations.delete(id); }
    for (const pad of pads) {
      let image = this.stations.get(pad.id);
      if (!image) {
        image = this.scene.add.image(0, 0, 'construction_attack_drone_station').setDisplaySize(CELL_SIZE, CELL_SIZE).setDepth(DEPTH.ROCKS + .1);
        this.stations.set(pad.id, image);
      }
      image.setPosition(ARENA_OFFSET_X + (pad.gridX + .5) * CELL_SIZE, ARENA_OFFSET_Y + (pad.gridY + .5) * CELL_SIZE);
    }
    const bombIds = new Set(bombs.map(b => b.id));
    for (const [id, bomb] of this.bombs) if (!bombIds.has(id)) { this.releaseBomb(bomb.image); this.bombs.delete(id); }
    for (const state of bombs) {
      if (state.landsAt <= now) continue;
      const existing = this.bombs.get(state.id);
      if (existing) existing.state = state;
      else this.bombs.set(state.id, { state, image: (this.bombPool.pop() ?? this.scene.add.image(0, 0, BOMB))
        .setActive(true).setVisible(true).setDepth(DEPTH.PROJECTILES + .5) });
    }
  }
  update(delta: number, now: number): void {
    const lerp = 1 - Math.exp(-Math.max(0, delta) / 48), view = getVisibleWorldView(this.scene.cameras.main);
    const bodyAsset = getPipelineAsset('attack-drone-body'), clip = bodyAsset.clips[0];
    for (const v of this.drones.values()) {
      const s = v.state;
      v.x += (s.x - v.x) * lerp; v.y += (s.y - v.y) * lerp;
      v.flightAngle = this.angle(v.flightAngle, s.flightAngle, lerp); v.gunAngle = this.angle(v.gunAngle, s.gunAngle, lerp);
      const visible = v.x >= view.x - 64 && v.x <= view.x + view.width + 64
        && v.y >= view.y - 64 && v.y <= view.y + view.height + 64;
      const docked = s.phase === 'servicing' || s.phase === 'docked';
      for (const object of [v.body, v.gun, v.shadow, v.marker]) object.setVisible(visible);
      v.flash.setVisible(visible && now < v.flashUntil);
      if (!visible) continue;
      v.body.setPosition(v.x, v.y).setRotation(v.flightAngle + Math.PI / 2);
      if (clip && !docked) v.body.setTexture(bodyAsset.sheetTextureKey, clip.frames[Math.floor(now * clip.frameRate / 1000) % clip.frames.length]);
      else v.body.setTexture(bodyAsset.textureKey);
      v.gun.setPosition(v.x, v.y).setRotation(v.gunAngle + Math.PI / 2);
      v.shadow.setPosition(v.x + 2, v.y + (docked ? 1 : 7)).setAlpha(docked ? .55 : 1);
      v.marker.setPosition(v.x, v.y).setFillStyle(s.ownerColor, .75)
        .setRadius(s.phase === 'servicing' ? 3 + Math.sin((now - s.phaseStartedAt) / 100) * .7 : 1.8);
      v.flash.setPosition(v.x + Math.cos(v.gunAngle) * R.muzzleOffset, v.y + Math.sin(v.gunAngle) * R.muzzleOffset).setRotation(v.gunAngle);
    }
    for (const [id, bomb] of this.bombs) {
      if (now >= bomb.state.landsAt) { this.releaseBomb(bomb.image); this.bombs.delete(id); continue; }
      const progress = Phaser.Math.Clamp((now - bomb.state.droppedAt) / (bomb.state.landsAt - bomb.state.droppedAt), 0, 1);
      bomb.image.setPosition(bomb.state.x, bomb.state.y - 9 * (1 - progress)).setDisplaySize(7 - progress * 2, 9 - progress * 2);
    }
  }
  destroyAll(): void {
    for (const visual of this.drones.values()) this.destroyDrone(visual);
    for (const image of this.stations.values()) image.destroy();
    for (const bomb of this.bombs.values()) bomb.image.destroy();
    for (const image of this.bombPool) image.destroy();
    this.drones.clear(); this.stations.clear(); this.bombs.clear(); this.bombPool.length = 0;
  }
  private createDrone(state: SyncedAttackDrone): DroneVisual {
    const depth = DEPTH.PROJECTILES + .4;
    const marker = this.scene.add.circle(state.x, state.y, 1.8, state.ownerColor).setDepth(depth + .02);
    registerGraphicsObject(this.scene, 'objectiveMarkers', marker);
    return { state, x: state.x, y: state.y, flightAngle: state.flightAngle, gunAngle: state.gunAngle, flashUntil: -1,
      body: this.scene.add.image(state.x, state.y, 'attack_drone_body').setDisplaySize(40, 40).setDepth(depth),
      gun: this.scene.add.image(state.x, state.y, 'attack_drone_gun').setDisplaySize(40, 40).setDepth(depth + .01),
      shadow: this.scene.add.image(state.x, state.y, SHADOW).setDisplaySize(45, 37).setDepth(DEPTH.ROCKS - .01),
      marker,
      flash: this.scene.add.image(state.x, state.y, FLASH).setDisplaySize(15, 8).setOrigin(0, .5).setDepth(depth + .03).setVisible(false),
    };
  }
  private destroyDrone(v: DroneVisual): void { for (const object of [v.body, v.gun, v.shadow, v.marker, v.flash]) object.destroy(); }
  private releaseBomb(image: Phaser.GameObjects.Image): void {
    if (this.bombPool.length < 128) { image.setActive(false).setVisible(false); this.bombPool.push(image); } else image.destroy();
  }
  private angle(from: number, to: number, lerp: number): number { return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * lerp; }
}
