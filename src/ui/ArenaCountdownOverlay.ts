import {
  ensureLoadingBarTextures,
  ensureLoadingPanel,
  LOADING_BAR_HEIGHT,
  LOADING_BAR_WIDTH,
  type LoadingBarTextureKeys,
} from './loadingScreenTextures';
import { LOADING_FOREST } from './LoadingScreenAssets';
import { FONT_DISPLAY } from './uiTheme';
import * as Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_VIEWPORT_WIDTH,
  DEPTH,
  COLORS,
  toCssColor,
} from '../config';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import type { CameraPostFxController } from '../effects/postfx/CameraPostFxController';
import { t } from '../i18n';
import type { ArenaLoadStage } from '../types';
import { LOBBY_CARD_MOTION } from './LobbyLayout';
import { RoundStartCountdownView } from './RoundStartCountdownView';
import {
  RADIAL_FOCUS_SOFTNESS_PX,
  resolveRadialFocusFrame,
  type RadialFocusFrame,
} from '../effects/postfx/radialFocusState';

const VEIL_RADIUS_PX = 176;
const CLOSED_VEIL_RADIUS_PX = -(RADIAL_FOCUS_SOFTNESS_PX + 8);
const VEIL_ALPHA = 1.00;
const REVEAL_DURATION_MS = 1800;
const DEATH_VEIL_HOLD_MS = 500;
const DEATH_VEIL_CLOSE_DURATION_MS = 180;
const FOCUS_FALLBACK_TEXTURE_KEY = '__arena_countdown_radial_focus';
const FOCUS_FALLBACK_SCALE = 0.25;
const FOCUS_FALLBACK_WIDTH = Math.ceil(GAME_WIDTH * FOCUS_FALLBACK_SCALE);
const FOCUS_FALLBACK_HEIGHT = Math.ceil(GAME_HEIGHT * FOCUS_FALLBACK_SCALE);
const FOCUS_FALLBACK_TINT = '54,54,54';
const FOCUS_FALLBACK_MID_ALPHA = 0.14;
const FOCUS_FALLBACK_OUTER_ALPHA = 0.30;
const LOADING_BAR_X = 510;
const LOADING_ROW_Y = 200;
const LOADING_ROW_PITCH = 54;
const LOADING_BAR_OFFSET_Y = 22;
/** Zeitkonstanten der angezeigten Prozentzahl: folgt dem Ziel weich, nie rueckwaerts. */
const SHOWN_FOLLOW_MS = 240;
const SHOWN_READY_FOLLOW_MS = 110;
/** Haelt die Anzeige bei kurzem Stillstand lebendig, eilt dem Messwert aber kaum voraus. */
const SHOWN_CREEP_PER_MS = 0.0011;
const SHOWN_MAX_LEAD = 2.5;
const SHEEN_PERIOD_MS = 1900;
const READY_FLASH_MS = 650;

interface LoadingRow {
  readonly name: Phaser.GameObjects.Text;
  readonly status: Phaser.GameObjects.Text;
  readonly percent: Phaser.GameObjects.Text;
  readonly unit: Phaser.GameObjects.Text;
  readonly track: Phaser.GameObjects.Image;
  readonly fill: Phaser.GameObjects.Image;
  readonly sheen: Phaser.GameObjects.Image;
  readonly glow: Phaser.GameObjects.Image;
  player: ArenaLoadingPlayerView | null;
  shownText: string;
}

type OverlayMode = 'hidden' | 'loading' | 'countdown' | 'death' | 'respawn-reveal';

export interface ArenaLoadingPlayerView {
  id: string;
  name: string;
  colorHex: number;
  progress: number;
  stage: ArenaLoadStage;
  ready: boolean;
}

export interface ArenaLoadingScreenState {
  mapLabel: string;
  modeLabel: string;
  players: readonly ArenaLoadingPlayerView[];
}

export class ArenaCountdownOverlay {
  private readonly focusFallbackTexture: Phaser.Textures.CanvasTexture;
  private readonly focusFallback: Phaser.GameObjects.Image;
  private readonly countdownView: RoundStartCountdownView;
  private readonly loadingBackdrop: Phaser.GameObjects.Container;
  private readonly loadingForest: Phaser.GameObjects.Image;
  private readonly loadingRoot: Phaser.GameObjects.Container;
  private readonly loadingPanel: Phaser.GameObjects.Image;
  private readonly loadingTitle: Phaser.GameObjects.Text;
  private readonly loadingSubtitle: Phaser.GameObjects.Text;
  private readonly loadingBarTextures: LoadingBarTextureKeys;
  private readonly loadingRows: LoadingRow[] = [];
  /** Angezeigter Fortschritt je Spieler fuer die laufende Ladeanzeige. */
  private readonly shownProgress = new Map<string, number>();
  private readonly readyFlashAt = new Map<string, number>();
  private readonly getFocusSprite: () => Phaser.GameObjects.Image | undefined;
  private readonly postFx: CameraPostFxController | null;
  private mode: OverlayMode = 'hidden';
  private unlockAtMs = 0;
  private lastShownNumber = 0;
  private lastFocusWorldX = GAME_WIDTH / 2;
  private lastFocusWorldY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;
  private revealRadius = VEIL_RADIUS_PX;
  private veilAlpha = VEIL_ALPHA;
  private goTriggeredForUnlock = false;
  private deathVeilHoldUntilMs = 0;
  private deathVeilClosing = false;
  private audioSystem: GameAudioSystem | null = null;
  private readonly baseX = GAME_WIDTH / 2;
  private readonly baseY = GAME_HEIGHT / 2;
  private lastFallbackFrameKey: string | null = null;
  private destroyed = false;
  private loadingCoveredCallbacks: Array<() => void> = [];

  constructor(
    private scene: Phaser.Scene,
    getFocusSprite: () => Phaser.GameObjects.Image | undefined,
    postFx: CameraPostFxController | null = null,
  ) {
    this.getFocusSprite = getFocusSprite;
    this.postFx = postFx;

    if (scene.textures.exists(FOCUS_FALLBACK_TEXTURE_KEY)) {
      scene.textures.remove(FOCUS_FALLBACK_TEXTURE_KEY);
    }
    this.focusFallbackTexture = scene.textures.createCanvas(
      FOCUS_FALLBACK_TEXTURE_KEY,
      FOCUS_FALLBACK_WIDTH,
      FOCUS_FALLBACK_HEIGHT,
    ) as Phaser.Textures.CanvasTexture;
    this.focusFallbackTexture.setSmoothPixelArt(false);
    this.focusFallbackTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.focusFallback = scene.add.image(this.baseX, this.baseY, FOCUS_FALLBACK_TEXTURE_KEY)
      .setDepth(DEPTH.OVERLAY - 2)
      .setScrollFactor(0)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setVisible(false);

    this.countdownView = new RoundStartCountdownView(scene);

    this.loadingForest = scene.add.image(0, 0, '__WHITE').setVisible(false);
    this.refreshLoadingForest();
    scene.load.on(`filecomplete-image-${LOADING_FOREST.key}`, this.refreshLoadingForest);
    this.loadingBackdrop = scene.add.container(this.baseX, this.baseY, [
      scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x101a14, 1), this.loadingForest,
    ])
      .setDepth(DEPTH.OVERLAY - 4)
      .setScrollFactor(0)
      .setVisible(false);

    this.loadingRoot = scene.add.container(0, 0)
      .setDepth(DEPTH.OVERLAY - 3)
      .setScrollFactor(0)
      .setVisible(false)
      .setAlpha(0);
    this.loadingPanel = scene.add.image(this.baseX, 132, ensureLoadingPanel(scene, 1080, 264)).setDisplaySize(1080, 264);
    this.loadingRoot.add(this.loadingPanel);
    this.loadingTitle = scene.add.text(this.baseX, 60, t('ui.arena.loading.title'), {
      fontFamily: FONT_DISPLAY, fontSize: '36px', fontStyle: 'bold',
      color: '#ded5ad',
    }).setOrigin(0.5);
    this.loadingSubtitle = scene.add.text(this.baseX, 108, '', {
      fontFamily: FONT_DISPLAY, fontSize: '21px', color: '#a5af91',
    }).setOrigin(0.5);
    const loadingStatus = scene.add.text(510, 154, t('ui.arena.loading.status'), {
      fontFamily: FONT_DISPLAY, fontSize: '17px', color: '#8e9a7e',
    }).setOrigin(0, 0.5);
    this.loadingRoot.add([this.loadingTitle, this.loadingSubtitle, loadingStatus]);
    this.loadingBarTextures = ensureLoadingBarTextures(scene);
    const barRight = LOADING_BAR_X + LOADING_BAR_WIDTH;
    for (let index = 0; index < 12; index += 1) {
      const y = LOADING_ROW_Y + index * LOADING_ROW_PITCH;
      const barY = y + LOADING_BAR_OFFSET_Y;
      const row: LoadingRow = {
        name: scene.add.text(LOADING_BAR_X, y, '', {
          fontFamily: FONT_DISPLAY, fontSize: '21px', color: toCssColor(COLORS.GREY_1),
        }).setOrigin(0, 0.5),
        status: scene.add.text(940, y, '', {
          fontFamily: FONT_DISPLAY, fontSize: '17px', color: toCssColor(COLORS.GREY_4),
        }).setOrigin(0, 0.5),
        percent: scene.add.text(barRight - 22, y - 1, '', {
          fontFamily: FONT_DISPLAY, fontSize: '25px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
        }).setOrigin(1, 0.5),
        unit: scene.add.text(barRight - 19, y + 2, '%', {
          fontFamily: FONT_DISPLAY, fontSize: '15px', fontStyle: 'bold', color: '#8e9a7e',
        }).setOrigin(0, 0.5),
        track: scene.add.image(LOADING_BAR_X, barY, this.loadingBarTextures.track)
          .setOrigin(0, 0.5).setDisplaySize(LOADING_BAR_WIDTH, LOADING_BAR_HEIGHT),
        fill: scene.add.image(LOADING_BAR_X, barY, this.loadingBarTextures.fill)
          .setOrigin(0, 0.5).setDisplaySize(LOADING_BAR_WIDTH, LOADING_BAR_HEIGHT),
        sheen: scene.add.image(LOADING_BAR_X, barY, this.loadingBarTextures.sheen)
          .setOrigin(0, 0.5).setScale(0.5).setBlendMode(Phaser.BlendModes.ADD),
        glow: scene.add.image(LOADING_BAR_X, barY, this.loadingBarTextures.glow)
          .setScale(0.5).setBlendMode(Phaser.BlendModes.ADD),
        player: null,
        shownText: '',
      };
      this.loadingRows.push(row);
      this.loadingRoot.add([row.track, row.fill, row.sheen, row.glow, row.name, row.status, row.percent, row.unit]);
    }

    promoteToClarityCamera(scene, this.loadingBackdrop);
    promoteToClarityCamera(scene, this.loadingRoot);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.animateLoadingRows);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  private readonly refreshLoadingForest = (): void => {
    if (this.scene.textures.exists(LOADING_FOREST.key)) {
      this.loadingForest.setTexture(LOADING_FOREST.key).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setVisible(true);
    }
  };

  setAudioSystem(system: GameAudioSystem | null): void {
    this.audioSystem = system;
  }

  syncTo(unlockAtMs: number): void {
    if (unlockAtMs <= 0) {
      if (this.mode === 'countdown') this.clear();
      this.unlockAtMs = 0;
      return;
    }

    if (
      unlockAtMs !== this.unlockAtMs
      || this.mode !== 'countdown'
    ) {
      this.fadeLoadingScreenOut();
      this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
      this.mode = 'countdown';
    }
    this.unlockAtMs = unlockAtMs;
  }

  /** Full-screen loading veil used while local chunks and round systems are being prepared. */
  showLoading(transition?: { fadeBackdrop: boolean; onCovered: () => void }): void {
    if (transition) this.loadingCoveredCallbacks.push(transition.onCovered);
    if (this.mode === 'loading') {
      if (this.isLoadingBackdropCovered()) this.notifyLoadingCovered();
      return;
    }
    this.resetOverlayState(CLOSED_VEIL_RADIUS_PX, VEIL_ALPHA);
    this.mode = 'loading';
    this.shownProgress.clear();
    this.readyFlashAt.clear();
    this.unlockAtMs = 0;
    this.postFx?.setRadialFocus(null);
    this.focusFallback.setVisible(false);
    this.scene.tweens.killTweensOf(this.loadingBackdrop);
    this.scene.tweens.killTweensOf(this.loadingRoot);
    this.loadingBackdrop.setVisible(true).setAlpha(transition?.fadeBackdrop ? 0 : 1);
    if (transition?.fadeBackdrop) {
      this.scene.tweens.add({
        targets: this.loadingBackdrop,
        alpha: 1,
        duration: LOBBY_CARD_MOTION.exitDuration,
        ease: 'Sine.easeInOut',
        onComplete: () => this.notifyLoadingCovered(),
      });
    } else this.notifyLoadingCovered();
    this.loadingRoot.setVisible(true).setAlpha(0);
    this.scene.tweens.add({
      targets: this.loadingRoot,
      alpha: 1,
      duration: 180,
      ease: 'Sine.easeOut',
    });
  }

  /** Read at POST_RENDER: alpha alone is not proof that a loading frame was drawn. */
  isLoadingBackdropCovered(): boolean {
    return !this.destroyed && this.mode === 'loading'
      && this.loadingBackdrop.visible && this.loadingBackdrop.alpha === 1;
  }

  private notifyLoadingCovered(): void {
    const callbacks = this.loadingCoveredCallbacks.splice(0);
    for (const callback of callbacks) callback();
  }

  updateLoadingScreen(state: ArenaLoadingScreenState): void {
    if (this.mode !== 'loading') return;
    this.loadingTitle.setText(t('ui.arena.loading.title'));
    this.loadingSubtitle.setText(state.modeLabel === state.mapLabel ? state.modeLabel : `${state.modeLabel}  ·  ${state.mapLabel}`);
    const height = 210 + Math.max(1, Math.min(state.players.length, this.loadingRows.length)) * 54;
    this.loadingPanel.setTexture(ensureLoadingPanel(this.scene, 1080, height)).setDisplaySize(1080, height).setY(height / 2);
    this.loadingRoot.setY((GAME_HEIGHT - height) / 2);
    for (let index = 0; index < this.loadingRows.length; index += 1) {
      const row = this.loadingRows[index];
      const player = state.players[index] ?? null;
      row.player = player;
      for (const part of [row.name, row.status, row.percent, row.unit, row.track, row.fill, row.sheen, row.glow]) {
        part.setVisible(player !== null);
      }
      if (!player) continue;
      row.name.setText(player.name).setColor(toCssColor(player.colorHex)).setScale(1);
      if (row.name.width > 390) row.name.setScale(390 / row.name.width);
      row.status.setText(t(`ui.arena.loading.${player.stage}`))
        .setColor(toCssColor(player.ready ? COLORS.GREEN_1 : COLORS.GREY_4));
      row.percent.setColor(toCssColor(player.ready ? COLORS.GREEN_1 : COLORS.GREY_1));
      row.fill.setTexture(player.ready ? this.loadingBarTextures.fillReady : this.loadingBarTextures.fill);
    }
    this.animateLoadingRows(this.scene.time.now, 0);
  }

  /**
   * Fuehrt die angezeigten Werte jedes Frames weich an den replizierten Fortschritt heran.
   * Replizierte Werte kommen in ganzen Prozent und unregelmaessig; die Anzeige bleibt monoton.
   */
  private readonly animateLoadingRows = (now: number, deltaMs: number): void => {
    if (this.mode !== 'loading' || this.destroyed) return;
    const dt = Math.max(0, Math.min(100, deltaMs));
    const fillFrameWidth = this.scene.textures.getFrame(this.loadingBarTextures.fill).width;
    const sheenFrame = this.scene.textures.getFrame(this.loadingBarTextures.sheen);
    const sheenWidth = sheenFrame.width * 0.5;
    for (let index = 0; index < this.loadingRows.length; index += 1) {
      const row = this.loadingRows[index];
      const player = row.player;
      if (!player) continue;
      const target = player.ready ? 100 : Math.max(0, Math.min(99, player.progress));
      let shown = this.shownProgress.get(player.id) ?? 0;
      if (player.ready) {
        shown += (100 - shown) * (1 - Math.exp(-dt / SHOWN_READY_FOLLOW_MS));
        if (shown > 99.6) shown = 100;
        if (!this.readyFlashAt.has(player.id)) this.readyFlashAt.set(player.id, now);
      } else if (target > shown) {
        this.readyFlashAt.delete(player.id);
        shown += (target - shown) * (1 - Math.exp(-dt / SHOWN_FOLLOW_MS));
      } else {
        this.readyFlashAt.delete(player.id);
        const lead = shown - target;
        shown = Math.min(99, shown + dt * SHOWN_CREEP_PER_MS * Math.max(0, 1 - lead / SHOWN_MAX_LEAD));
      }
      this.shownProgress.set(player.id, shown);

      const text = String(shown >= 100 ? 100 : Math.min(99, Math.floor(shown)));
      if (text !== row.shownText) {
        row.shownText = text;
        row.percent.setText(text);
      }
      const fillWidth = LOADING_BAR_WIDTH * shown / 100;
      row.fill.setCrop(0, 0, fillFrameWidth * shown / 100, row.fill.frame.height);
      const tipX = LOADING_BAR_X + fillWidth;

      const flashAt = this.readyFlashAt.get(player.id);
      if (flashAt !== undefined) {
        const flash = Math.min(1, (now - flashAt) / READY_FLASH_MS);
        row.glow.setPosition(tipX - 6, row.track.y).setAlpha((1 - flash) * 0.95)
          .setScale(0.5 + flash * 1.4, 0.5 + flash * 0.5);
        row.sheen.setAlpha(0);
        continue;
      }
      const pulse = 0.5 + 0.5 * Math.sin(now / 280 + index * 0.9);
      row.glow.setPosition(tipX - 2, row.track.y).setScale(0.5)
        .setAlpha(shown <= 0.5 ? 0 : 0.4 + pulse * 0.3);
      // Ein Lichtband laeuft durch den gefuellten Teil und endet sauber an dessen Spitze.
      const phase = ((now / SHEEN_PERIOD_MS) + index * 0.17) % 1;
      const sheenX = LOADING_BAR_X - sheenWidth + phase * (fillWidth + sheenWidth);
      const left = Math.max(0, Math.min(sheenWidth, LOADING_BAR_X - sheenX));
      const right = Math.max(left, Math.min(sheenWidth, tipX - sheenX));
      const frameScale = sheenFrame.width / sheenWidth;
      row.sheen.setX(sheenX).setCrop(left * frameScale, 0, (right - left) * frameScale, sheenFrame.height)
        .setAlpha(fillWidth < 24 ? 0 : 0.85);
    }
  };

  isLoading(): boolean {
    return this.mode === 'loading';
  }

  showDeathVeil(): void {
    if (this.mode === 'death') return;

    this.captureFocusPoint();
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.mode = 'death';
    this.deathVeilHoldUntilMs = this.scene.time.now + DEATH_VEIL_HOLD_MS;
    this.deathVeilClosing = false;
  }

  playRespawnReveal(): void {
    this.captureFocusPoint();
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.mode = 'respawn-reveal';
    this.playReveal(false);
  }

  update(now = Date.now()): void {
    if (this.mode === 'hidden') {
      this.clear();
      return;
    }

    if (this.mode === 'loading') {
      this.captureFocusPoint();
      return;
    }

    if (this.mode === 'death') {
      if (!this.deathVeilClosing && this.scene.time.now >= this.deathVeilHoldUntilMs) {
        this.deathVeilClosing = true;
        this.scene.tweens.add({
          targets: this,
          revealRadius: CLOSED_VEIL_RADIUS_PX,
          duration: DEATH_VEIL_CLOSE_DURATION_MS,
          ease: 'Quad.easeIn',
        });
      }
      return;
    }

    this.captureFocusPoint();

    if (this.mode === 'respawn-reveal') {
      if (this.veilAlpha > 0.01) {
        return;
      }

      this.mode = 'hidden';
      return;
    }

    if (this.unlockAtMs <= 0) {
      this.clear();
      return;
    }

    const msLeft = this.unlockAtMs - now;
    if (msLeft > 0) {
      const secondsLeft = Math.ceil(msLeft / 1000);
      if (secondsLeft !== this.lastShownNumber) {
        this.lastShownNumber = secondsLeft;
        if (secondsLeft <= 3) this.audioSystem?.playLocalSound(`sfx_countdown_${secondsLeft}`);
      }
      this.countdownView.showCount(msLeft);
      return;
    }

    if (!this.goTriggeredForUnlock) {
      this.goTriggeredForUnlock = true;
      this.lastShownNumber = 0;
      this.audioSystem?.playLocalSound('sfx_countdown_go');
      this.playReveal(true);
    }

    if (this.veilAlpha > 0.01) {
      return;
    }
  }

  /**
   * Applies the current logical focus after the Scene has written the final camera feedback.
   * The overlay stores a world point so both dynamic camera scroll and screen shake remain in
   * the same coordinate space as the rendered world.
   */
  syncAfterCameraFeedback(): void {
    if (this.mode === 'loading') {
      this.postFx?.setRadialFocus(null);
      this.focusFallback.setVisible(false);
      return;
    }
    if (this.mode === 'hidden' || this.veilAlpha <= 0.01) {
      this.postFx?.setRadialFocus(null);
      this.focusFallback.setVisible(false);
      return;
    }

    const camera = this.scene.cameras.main;
    const frame: RadialFocusFrame = resolveRadialFocusFrame(
      this.lastFocusWorldX,
      this.lastFocusWorldY,
      camera.scrollX,
      camera.scrollY,
      this.revealRadius,
      this.veilAlpha,
      // Countdown und Respawn-Reveal laufen in der Spawn-Nahaufnahme: deren Zoom liegt ueber dem Designzoom.
      camera.zoomX * GAME_WIDTH / Math.max(1, this.scene.scale.width),
    );

    this.postFx?.setRadialFocus(frame);
    const filterActive = this.postFx?.isRadialFocusFilterActive() ?? false;
    this.focusFallback.setVisible(!filterActive);
    if (!filterActive) this.updateFallbackTexture(frame);
  }

  clear(): void {
    this.loadingCoveredCallbacks.length = 0;
    this.mode = 'hidden';
    this.unlockAtMs = 0;
    this.scene.tweens.killTweensOf(this.loadingBackdrop);
    this.scene.tweens.killTweensOf(this.loadingRoot);
    this.loadingRoot.setVisible(false).setAlpha(0);
    this.loadingBackdrop.setVisible(false).setAlpha(1);
    this.resetOverlayState(VEIL_RADIUS_PX, VEIL_ALPHA);
    this.lastFallbackFrameKey = null;
    this.postFx?.setRadialFocus(null);
    this.focusFallback.setVisible(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadingCoveredCallbacks.length = 0;
    this.stopRevealTweens();
    this.scene.tweens.killTweensOf(this.loadingBackdrop);
    this.scene.tweens.killTweensOf(this.loadingRoot);
    this.postFx?.setRadialFocus(null);
    this.focusFallback.destroy();
    this.countdownView.destroy();
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.animateLoadingRows);
    this.scene.load.off(`filecomplete-image-${LOADING_FOREST.key}`, this.refreshLoadingForest);
    this.loadingBackdrop.destroy(true);
    this.loadingRoot.destroy(true);
    if (this.scene.textures.exists(FOCUS_FALLBACK_TEXTURE_KEY)) {
      this.scene.textures.remove(FOCUS_FALLBACK_TEXTURE_KEY);
    }
  }

  private captureFocusPoint(): void {
    const sprite = this.getFocusSprite();
    if (sprite?.active) {
      this.lastFocusWorldX = sprite.x;
      this.lastFocusWorldY = sprite.y;
    }
  }

  private playReveal(showGoText: boolean): void {
    this.stopRevealTweens();
    if (showGoText) this.countdownView.playGo();
    else this.countdownView.hide();

    this.scene.tweens.add({
      targets: this,
      revealRadius: Math.max(ARENA_VIEWPORT_WIDTH, ARENA_HEIGHT) * 1.2,
      veilAlpha: 0,
      duration: REVEAL_DURATION_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.lastFallbackFrameKey = null;
        if (this.mode === 'respawn-reveal' || this.goTriggeredForUnlock) {
          this.mode = 'hidden';
        }
      },
    });
  }

  private resetOverlayState(radius: number, alpha: number): void {
    this.stopRevealTweens();
    this.countdownView.hide();
    this.lastShownNumber = 0;
    this.goTriggeredForUnlock = false;
    this.deathVeilHoldUntilMs = 0;
    this.deathVeilClosing = false;
    this.revealRadius = radius;
    this.veilAlpha = alpha;
    this.lastFallbackFrameKey = null;
  }

  private updateFallbackTexture(frame: RadialFocusFrame): void {
    const key = [
      frame.focusX,
      frame.focusY,
      frame.radiusPx,
      frame.alpha,
    ].map((value) => Math.round(value * 100) / 100).join('|');
    if (key === this.lastFallbackFrameKey) return;
    this.lastFallbackFrameKey = key;

    const texture = this.focusFallbackTexture;
    const context = texture.context;
    const scaleX = texture.width / GAME_WIDTH;
    const scaleY = texture.height / GAME_HEIGHT;
    const veilWidth = texture.width;
    const veilHeight = texture.height;
    const focusX = frame.focusX * scaleX;
    const focusY = frame.focusY * scaleY;
    const radius = frame.radiusPx * scaleX;
    const softness = RADIAL_FOCUS_SOFTNESS_PX * scaleX;
    const alpha = Phaser.Math.Clamp(frame.alpha, 0, 1);

    // Das Bild deckt den gesamten Designraum ab (`setDisplaySize(GAME_WIDTH, GAME_HEIGHT)`),
    // deshalb füllt der Schleier die Textur vollständig. Sonst bliebe der Rand außerhalb der
    // Arena als heller Streifen ohne Schleier stehen.
    context.clearRect(0, 0, veilWidth, veilHeight);

    if (frame.radiusPx <= 0) {
      const loadingAlpha = this.mode === 'loading' ? alpha : alpha * FOCUS_FALLBACK_OUTER_ALPHA;
      context.fillStyle = `rgba(${FOCUS_FALLBACK_TINT},${loadingAlpha})`;
      context.fillRect(0, 0, veilWidth, veilHeight);
    } else {
      const outerRadius = Math.max(1, radius + softness);
      const gradient = context.createRadialGradient(
        focusX,
        focusY,
        Math.max(0, radius),
        focusX,
        focusY,
        outerRadius,
      );
      gradient.addColorStop(0, `rgba(${FOCUS_FALLBACK_TINT},0)`);
      gradient.addColorStop(0.55, `rgba(${FOCUS_FALLBACK_TINT},${alpha * FOCUS_FALLBACK_MID_ALPHA})`);
      gradient.addColorStop(1, `rgba(${FOCUS_FALLBACK_TINT},${alpha * FOCUS_FALLBACK_OUTER_ALPHA})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, veilWidth, veilHeight);
    }

    texture.refresh();
  }

  private stopRevealTweens(): void {
    this.scene.tweens.killTweensOf(this);
  }

  private fadeLoadingScreenOut(): void {
    if (!this.loadingRoot.visible && !this.loadingBackdrop.visible) return;
    this.scene.tweens.killTweensOf(this.loadingBackdrop);
    this.scene.tweens.killTweensOf(this.loadingRoot);
    this.scene.tweens.add({
      targets: [this.loadingRoot, this.loadingBackdrop],
      alpha: 0,
      duration: 220,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (this.mode !== 'loading') {
          this.loadingRoot.setVisible(false).setAlpha(0);
          this.loadingBackdrop.setVisible(false).setAlpha(1);
        }
      },
    });
  }
}
