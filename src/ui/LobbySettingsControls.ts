import * as Phaser from 'phaser';
import { FOREST } from './UiSkin';
import { COLORS, DEPTH } from '../config';
import type { GameMode } from '../types';
import type { NetworkBridge } from '../network/NetworkBridge';
import { isCoopDefenseMode } from '../gameModes';
import { getLocale, t } from '../i18n';
import { getLocalizedGameModeLabel } from '../i18n/gameModePresentation';
import { getMapName } from '../i18n/contentPresentation';
import { getUnlockedCoopDefenseMapConfigs } from '../config/coopDefenseMapUnlocks';
import { getStoredHighestUnlockedCoopDefenseMapId } from '../utils/localPreferences';
import { formatTimeOfDay, MINUTES_PER_DAY } from '../effects/TimeOfDay';
import { toDesignSpace } from '../graphics/RenderResolution';
import { LoadoutSlotPicker } from './LoadoutSlotPicker';
import { LOBBY_CARD, LOBBY_POPUP_SAFE_AREA } from './LobbyLayout';
import { UiButton } from './UiButton';
import { textStyle } from './uiTheme';

const MODES: readonly GameMode[] = ['deathmatch', 'team_deathmatch', 'capture_the_beer', 'coop_defense'];
const LEFT = LOBBY_CARD.left + LOBBY_CARD.padding;
const VALUE_LEFT = LEFT + 128;
const VALUE_W = LOBBY_CARD.contentWidth - 128;
const VALUE_X = VALUE_LEFT + VALUE_W / 2;
const MODE_Y = 388;
const MAP_Y = 450;
const TIME_STEP = 15;

/** Host settings presentation; all writes retain the NetworkBridge authority boundary. */
export class LobbySettingsControls {
  private readonly mode: UiButton;
  private readonly map: UiButton;
  private readonly modeLabel: Phaser.GameObjects.Text;
  private readonly mapLabel: Phaser.GameObjects.Text;
  private readonly timeLabel: Phaser.GameObjects.Text;
  private readonly track: Phaser.GameObjects.Rectangle;
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly thumb: Phaser.GameObjects.Arc;
  private readonly hit: Phaser.GameObjects.Rectangle;
  private readonly picker: LoadoutSlotPicker;
  private locked = false;
  private dragging = false;
  private signature = '';

  constructor(private readonly scene: Phaser.Scene, private readonly bridge: NetworkBridge,
    parent: Phaser.GameObjects.Container) {
    this.modeLabel = scene.add.text(LEFT, MODE_Y, '', textStyle('section', { color: FOREST.muted })).setOrigin(0, 0.5);
    this.mapLabel = scene.add.text(LEFT, MAP_Y, '', textStyle('section', { color: FOREST.muted })).setOrigin(0, 0.5);
    this.mode = new UiButton(scene, { skin: 'forest', x: VALUE_X, y: MODE_Y, w: VALUE_W, h: 44,
      label: ' ', icon: 'chevron-right', trailingIcon: true, intent: 'neutral', onClick: () => this.open(false) });
    this.map = new UiButton(scene, { skin: 'forest', x: VALUE_X, y: MAP_Y, w: VALUE_W, h: 44,
      label: ' ', icon: 'chevron-right', trailingIcon: true, intent: 'neutral', onClick: () => this.open(true) });
    this.timeLabel = scene.add.text(VALUE_LEFT, MAP_Y - 14, '', textStyle('caption', { color: FOREST.text })).setOrigin(0, 0.5);
    this.track = scene.add.rectangle(VALUE_LEFT, MAP_Y + 12, VALUE_W, 7, FOREST.sunken)
      .setOrigin(0, 0.5).setStrokeStyle(1, COLORS.GREY_6);
    this.fill = scene.add.rectangle(VALUE_LEFT, MAP_Y + 12, 1, 5, COLORS.GREEN_3).setOrigin(0, 0.5);
    this.thumb = scene.add.circle(VALUE_LEFT, MAP_Y + 12, 7, COLORS.GREY_3);
    this.hit = scene.add.rectangle(VALUE_LEFT, MAP_Y + 12, VALUE_W, 28, 0, 0)
      .setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    this.hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.canEdit() || isCoopDefenseMode(this.bridge.getGameMode())) return;
      this.dragging = true;
      this.move(pointer);
    });
    const objects = [this.modeLabel, this.mapLabel, this.mode.getRoot(), this.map.getRoot(),
      this.timeLabel, this.track, this.fill, this.thumb, this.hit];
    objects.forEach(object => object.setScrollFactor(0));
    parent.add(objects);
    this.picker = new LoadoutSlotPicker(scene, parent, DEPTH.OVERLAY + 3, true, 'forest');
    scene.input.on('pointermove', this.move);
    scene.input.on('pointerup', this.release);
    this.refresh();
  }

  private canEdit(): boolean { return this.bridge.isHost() && !this.locked; }
  private readonly release = (): void => { this.dragging = false; };
  private readonly move = (pointer: Phaser.Input.Pointer): void => {
    if (!this.dragging || !this.canEdit()) return;
    const fraction = Phaser.Math.Clamp((toDesignSpace(this.scene.scale, pointer.x) - VALUE_LEFT) / VALUE_W, 0, 1);
    const lastStep = MINUTES_PER_DAY / TIME_STEP - 1;
    this.bridge.setLobbyTimeOfDayMinutes(Math.round(fraction * lastStep) * TIME_STEP);
    this.refresh();
  };

  setLocked(locked: boolean): void {
    if (this.locked !== locked) this.close();
    this.locked = locked;
    this.refresh();
  }

  refresh(): void {
    const mode = this.bridge.getGameMode();
    const mapId = this.bridge.getCoopDefenseMapId();
    const minutes = this.bridge.getLobbyTimeOfDayMinutes();
    const signature = `${mode}|${mapId}|${getLocale()}|${this.canEdit()}|${minutes}`;
    if (signature === this.signature) return;
    if (signature !== this.signature) this.close();
    this.signature = signature;
    const coop = isCoopDefenseMode(mode);
    const enabled = this.canEdit();
    this.modeLabel.setText(t('ui.lobby.gameMode'));
    this.mapLabel.setText(coop ? t('ui.lobby.map') : '');
    this.mode.setLabel(getLocalizedGameModeLabel(mode)).setEnabled(true).setIcon(enabled ? 'chevron-right' : null);
    this.map.setLabel(getMapName(mapId, getLocale())).setVisible(coop).setEnabled(true)
      .setIcon(enabled ? 'chevron-right' : null);
    // Values remain legible for guests even though they cannot change the room settings.
    if (!enabled) {
      this.mode.getBackground().disableInteractive();
      this.map.getBackground().disableInteractive();
    }
    this.timeLabel.setText(t('ui.lobby.time', { time: formatTimeOfDay(minutes) })).setVisible(!coop);
    for (const object of [this.track, this.fill, this.thumb, this.hit]) object.setVisible(!coop && this.bridge.isHost());
    this.hit.input!.enabled = !coop && enabled;
    this.fill.setDisplaySize(Math.max(1, VALUE_W * minutes / MINUTES_PER_DAY), 5);
    this.thumb.setX(VALUE_LEFT + VALUE_W * minutes / MINUTES_PER_DAY);
  }

  private open(maps: boolean): void {
    if (!this.canEdit()) return;
    const entries = maps
      ? getUnlockedCoopDefenseMapConfigs(getStoredHighestUnlockedCoopDefenseMapId()).map(map => ({
        key: map.mapId, displayName: map.mapId, textureKey: null, accentColor: FOREST.border,
        selected: map.mapId === this.bridge.getCoopDefenseMapId(), disabled: false,
        onPick: () => {
          if (this.canEdit() && isCoopDefenseMode(this.bridge.getGameMode())) this.bridge.setCoopDefenseMapId(map.mapId);
          this.refresh();
        },
      }))
      : MODES.map(mode => ({
        key: mode, displayName: getLocalizedGameModeLabel(mode), textureKey: null, accentColor: FOREST.border,
        selected: mode === this.bridge.getGameMode(), disabled: false,
        onPick: () => { if (this.canEdit()) this.bridge.setGameMode(mode); this.refresh(); },
      }));
    this.picker.open({ anchorX: VALUE_X, anchorY: (maps ? MAP_Y : MODE_Y) + 28,
      title: t(maps ? 'ui.lobby.map' : 'ui.lobby.gameMode'), groups: [{ label: null, entries }],
      columns: maps ? 5 : 1, entryWidth: maps ? 52 : 300, entryHeight: 40,
      centeredLabels: maps, safeArea: LOBBY_POPUP_SAFE_AREA });
  }

  isOpen(): boolean { return this.picker.isOpen(); }
  close(): void { this.dragging = false; this.picker.close(); }
  destroy(): void {
    this.close();
    this.scene.input.off('pointermove', this.move);
    this.scene.input.off('pointerup', this.release);
    this.mode.destroy();
    this.map.destroy();
  }
}
