import * as Phaser from 'phaser';
import type { GameAudioSystem } from '../../audio/GameAudioSystem';
import type { GamePhase } from '../../types';
import type {
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from '../../loadout/LoadoutConfig';
import type { InputSystem } from '../../systems/InputSystem';

export type ArenaInputDebugHotkey = 'flowfield_bases' | 'flowfield_players';

/** Kleine UI-/Lifecycle-Ports fuer die lokalen Hotkeys; die Scene bleibt deren Composition-Owner. */
export interface ArenaInputHotkeyPorts {
  getGamePhase(): GamePhase;
  isMatchTerminated(): boolean;
  isCoopDefenseMode(): boolean;
  canLeaveLocalLobbyWorld(): boolean;
  requestLocalLobbyWorldLeave(): void;

  isHotkeyInputBlocked(): boolean;
  isHelpOverlayOpen(): boolean;
  hideHelpOverlay(): void;
  isOptionsOverlayOpen(): boolean;
  hideOptionsOverlay(): void;
  toggleOptionsOverlay(): void;
  isCoopDefenseUpgradesOpen(): boolean;
  hideCoopDefenseUpgrades(): void;
  isCoopDefenseDebugOpen(): boolean;
  hideCoopDefenseDebug(): void;
  toggleCoopDefenseDebug(): void;
  isItemsOpen(): boolean;
  hideItems(): void;
  isItemRewardVisible(): boolean;
  hideItemReward(): void;
  isMatchResultsVisible(): boolean;
  hideMatchResults(): void;
  isRoomStatisticsVisible(): boolean;
  hideRoomStatistics(): void;
  isWeaponBalanceLabOpen(): boolean;
  hideWeaponBalanceLab(): void;
  toggleWeaponBalanceLab(): void;
  isNetDebugOpen(): boolean;
  hideNetDebug(): void;
  toggleNetDebug(): void;
  isPerformanceOverlayOpen(): boolean;
  hidePerformanceOverlay(): void;
  togglePerformanceOverlay(): void;
  isTimeOfDayDebugOpen(): boolean;
  hideTimeOfDayDebug(): void;
  toggleTimeOfDayDebug(): void;
}

export interface ArenaInputBindingsInput {
  readonly scene: Phaser.Scene;
  readonly inputSystem: InputSystem;
  readonly audioSystem: GameAudioSystem;
  readonly getLocalUtilityConfig: () => UtilityConfig | undefined;
  readonly getLocalUtilityCooldownUntil: () => number;
  readonly getLocalUltimateConfig: () => UltimateConfig | undefined;
  readonly getLocalRage: () => number;
  readonly getLocalWeapon2Config: () => WeaponConfig | undefined;
  readonly onFlowFieldDebugHotkey: (type: ArenaInputDebugHotkey) => void;
  readonly hotkeys: ArenaInputHotkeyPorts;
}

/**
 * Scene-langlebiger Owner fuer Keyboard-Setup, lokale Hotkeys und statische Input-Provider.
 *
 * Action-/Placement-Callbacks bleiben bewusst bei der Scene, bis Phase 3B ihre Ports definiert.
 * Dieser Owner entscheidet keine hostautoritativen Regeln; er liest nur lokale Eingabe und ruft
 * kleine UI-/Debug-Ports auf.
 */
export class ArenaInputBindings {
  private spectatorCameraLeftKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraRightKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraUpKey: Phaser.Input.Keyboard.Key | null = null;
  private spectatorCameraDownKey: Phaser.Input.Keyboard.Key | null = null;
  private arenaPanelTabKey: Phaser.Input.Keyboard.Key | null = null;
  private coopDefenseDebugDamageKey: Phaser.Input.Keyboard.Key | null = null;

  private escapeHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private optionsHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private coopDefenseXpDebugHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private weaponBalanceLabHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private netDebugHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private performanceHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private timeOfDayHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;

  private setupComplete = false;
  private destroyed = false;

  constructor(private readonly input: ArenaInputBindingsInput) {}

  setup(): void {
    if (this.setupComplete || this.destroyed) return;
    const keyboard = this.input.scene.input.keyboard;
    if (!keyboard) return;

    this.setupComplete = true;
    this.spectatorCameraLeftKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A, false);
    this.spectatorCameraRightKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D, false);
    this.spectatorCameraUpKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W, false);
    this.spectatorCameraDownKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S, false);
    this.input.inputSystem.setup();
    this.input.inputSystem.setAudioSystem(this.input.audioSystem);
    this.input.inputSystem.setupUtilityConfigProvider(this.input.getLocalUtilityConfig);
    this.input.inputSystem.setupUtilityCooldownProvider(this.input.getLocalUtilityCooldownUntil);
    this.input.inputSystem.setupUltimateConfigProvider(this.input.getLocalUltimateConfig);
    this.input.inputSystem.setupLocalRageProvider(this.input.getLocalRage);
    this.input.inputSystem.setupDebugHotkeys((type) => {
      if (!this.destroyed) this.input.onFlowFieldDebugHotkey(type);
    });
    this.input.inputSystem.setupWeapon2ConfigProvider(this.input.getLocalWeapon2Config);

    this.arenaPanelTabKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB, true);
    // K bleibt fuer den optionalen Debug-Schaden abfragbar, darf aber kein DOM-Textfeld
    // blockieren, weil der Buchstabe auch in Spielernamen verwendet wird.
    this.coopDefenseDebugDamageKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K, false);

    this.escapeHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const ports = this.input.hotkeys;
      if (!ports.canLeaveLocalLobbyWorld()) return;

      // ESC schliesst immer zuerst die oberste UI-Schicht. Erst wenn keine modale oder
      // eingabeblockierende Oberflaeche offen ist, darf es die World-Teilnahme verlassen.
      if (ports.isHelpOverlayOpen()) {
        ports.hideHelpOverlay();
        event.preventDefault();
        return;
      }
      if (ports.isOptionsOverlayOpen()) {
        ports.hideOptionsOverlay();
        event.preventDefault();
        return;
      }
      if (ports.isCoopDefenseUpgradesOpen()) {
        ports.hideCoopDefenseUpgrades();
        event.preventDefault();
        return;
      }
      if (ports.isCoopDefenseDebugOpen()) {
        ports.hideCoopDefenseDebug();
        event.preventDefault();
        return;
      }
      if (ports.isItemsOpen()) {
        ports.hideItems();
        event.preventDefault();
        return;
      }
      if (ports.isItemRewardVisible()) {
        ports.hideItemReward();
        event.preventDefault();
        return;
      }
      if (ports.isMatchResultsVisible()) {
        ports.hideMatchResults();
        event.preventDefault();
        return;
      }
      if (ports.isRoomStatisticsVisible()) {
        ports.hideRoomStatistics();
        event.preventDefault();
        return;
      }
      if (ports.isWeaponBalanceLabOpen()) {
        ports.hideWeaponBalanceLab();
        event.preventDefault();
        return;
      }
      if (ports.isNetDebugOpen()) {
        ports.hideNetDebug();
        event.preventDefault();
        return;
      }
      if (ports.isPerformanceOverlayOpen()) {
        ports.hidePerformanceOverlay();
        event.preventDefault();
        return;
      }
      if (ports.isTimeOfDayDebugOpen()) {
        ports.hideTimeOfDayDebug();
        event.preventDefault();
        return;
      }
      if (ports.isHotkeyInputBlocked()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      ports.requestLocalLobbyWorldLeave();
    };
    keyboard.on('keydown-ESC', this.escapeHotkeyHandler);

    this.optionsHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const ports = this.input.hotkeys;
      const phase = ports.getGamePhase();
      if ((phase !== 'LOBBY' && phase !== 'ARENA') || ports.isMatchTerminated()) return;
      if (ports.isHotkeyInputBlocked()) return;
      if (ports.isHelpOverlayOpen()) return;
      if (ports.isCoopDefenseUpgradesOpen()) return;
      if (ports.isCoopDefenseDebugOpen()) return;
      if (ports.isWeaponBalanceLabOpen()) return;

      ports.toggleOptionsOverlay();
    };
    keyboard.on('keydown-O', this.optionsHotkeyHandler);

    this.coopDefenseXpDebugHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const ports = this.input.hotkeys;
      if (ports.getGamePhase() !== 'LOBBY' || ports.isMatchTerminated()) return;
      if (!ports.isCoopDefenseMode()) return;
      if (ports.isHotkeyInputBlocked()) return;
      if (ports.isHelpOverlayOpen()) return;
      if (ports.isOptionsOverlayOpen()) return;
      if (ports.isCoopDefenseUpgradesOpen()) return;
      if (ports.isWeaponBalanceLabOpen()) return;

      ports.toggleCoopDefenseDebug();
    };
    keyboard.on('keydown-L', this.coopDefenseXpDebugHotkeyHandler);

    this.weaponBalanceLabHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;

      const ports = this.input.hotkeys;
      if (ports.getGamePhase() !== 'LOBBY' || ports.isMatchTerminated()) return;
      if (!ports.isCoopDefenseMode()) return;
      if (ports.isHotkeyInputBlocked()) return;
      if (ports.isHelpOverlayOpen() || ports.isOptionsOverlayOpen()) return;
      if (ports.isCoopDefenseUpgradesOpen() || ports.isCoopDefenseDebugOpen()) return;
      event.preventDefault();
      ports.toggleWeaponBalanceLab();
    };
    keyboard.on('keydown-F8', this.weaponBalanceLabHotkeyHandler);

    // Transportdiagnose ist in jeder Phase erreichbar – gerade wenn etwas klemmt.
    this.netDebugHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const ports = this.input.hotkeys;
      if (ports.isHotkeyInputBlocked()) return;
      ports.toggleNetDebug();
    };
    keyboard.on('keydown-P', this.netDebugHotkeyHandler);

    this.performanceHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // T ist ein Schreibzeichen: nicht auslösen, während ein Textfeld den Fokus hat.
      if (this.input.hotkeys.isHotkeyInputBlocked()) return;
      this.input.hotkeys.togglePerformanceOverlay();
    };
    keyboard.on('keydown-T', this.performanceHotkeyHandler);

    this.timeOfDayHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // M ist ein Schreibzeichen: nicht auslösen, während ein Textfeld den Fokus hat.
      if (this.input.hotkeys.isHotkeyInputBlocked()) return;
      this.input.hotkeys.toggleTimeOfDayDebug();
    };
    keyboard.on('keydown-M', this.timeOfDayHotkeyHandler);
  }

  isSpectatorCameraLeftDown(): boolean {
    return !this.destroyed && this.spectatorCameraLeftKey?.isDown === true;
  }

  isSpectatorCameraRightDown(): boolean {
    return !this.destroyed && this.spectatorCameraRightKey?.isDown === true;
  }

  isSpectatorCameraUpDown(): boolean {
    return !this.destroyed && this.spectatorCameraUpKey?.isDown === true;
  }

  isSpectatorCameraDownDown(): boolean {
    return !this.destroyed && this.spectatorCameraDownKey?.isDown === true;
  }

  isArenaPanelHeld(): boolean {
    return !this.destroyed && this.arenaPanelTabKey?.isDown === true;
  }

  isCoopDefenseDebugDamageJustDown(): boolean {
    return !this.destroyed
      && this.coopDefenseDebugDamageKey !== null
      && Phaser.Input.Keyboard.JustDown(this.coopDefenseDebugDamageKey);
  }

  /** Idempotenter Owner-Teardown fuer eigene Keyboard-Keys und DOM-nahe Keyboard-Listener. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const keyboard = this.input.scene.input.keyboard;
    if (keyboard) {
      if (this.escapeHotkeyHandler) keyboard.off('keydown-ESC', this.escapeHotkeyHandler);
      if (this.optionsHotkeyHandler) keyboard.off('keydown-O', this.optionsHotkeyHandler);
      if (this.coopDefenseXpDebugHotkeyHandler) keyboard.off('keydown-L', this.coopDefenseXpDebugHotkeyHandler);
      if (this.weaponBalanceLabHotkeyHandler) keyboard.off('keydown-F8', this.weaponBalanceLabHotkeyHandler);
      if (this.netDebugHotkeyHandler) keyboard.off('keydown-P', this.netDebugHotkeyHandler);
      if (this.performanceHotkeyHandler) keyboard.off('keydown-T', this.performanceHotkeyHandler);
      if (this.timeOfDayHotkeyHandler) keyboard.off('keydown-M', this.timeOfDayHotkeyHandler);

      for (const key of [
        this.spectatorCameraLeftKey,
        this.spectatorCameraRightKey,
        this.spectatorCameraUpKey,
        this.spectatorCameraDownKey,
        this.arenaPanelTabKey,
        this.coopDefenseDebugDamageKey,
      ]) {
        if (key) keyboard.removeKey(key, true, true);
      }
    }

    this.escapeHotkeyHandler = null;
    this.optionsHotkeyHandler = null;
    this.coopDefenseXpDebugHotkeyHandler = null;
    this.weaponBalanceLabHotkeyHandler = null;
    this.netDebugHotkeyHandler = null;
    this.performanceHotkeyHandler = null;
    this.timeOfDayHotkeyHandler = null;
    this.spectatorCameraLeftKey = null;
    this.spectatorCameraRightKey = null;
    this.spectatorCameraUpKey = null;
    this.spectatorCameraDownKey = null;
    this.arenaPanelTabKey = null;
    this.coopDefenseDebugDamageKey = null;
  }
}
