import * as Phaser from 'phaser';
import { ArenaBuilder, type ArenaBuilderResult } from '../arena/ArenaBuilder';
import {
  ACTIVE_ARENA_METRICS_PROFILE,
  ARENA_MAX_X, ARENA_MAX_Y, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_VIEWPORT_HEIGHT, ARENA_VIEWPORT_WIDTH,
} from '../config';
import { setCameraBaseScroll } from '../graphics/cameraBaseScroll';
import type { ArenaSpectatorCameraInput } from '../scenes/arena/ArenaInputBindings';
import { advanceSpectatorCameraScroll } from '../scenes/arena/SpectatorCameraModel';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { allowsWorldPresentationSurface, type WorldPresentationRequirement } from './WorldPresentation';

/**
 * Der world-scoped Owner der aktiven World-Presentation-Verdrahtung.
 *
 * `WorldPresentationBinding` ist die handoffbare Darstellung selbst – Layout und gebauter Baum,
 * die einen World-Wechsel ueberleben koennen. Dieser Owner ist etwas anderes: die laufende
 * Verdrahtung, die diese Darstellung mit den scene-langlebigen Renderern und Consumern der
 * *aktuellen* World verbindet. Er gehoert genau einer `WorldRuntime` und faellt vor deren
 * handoffbarer Darstellung – sonst saehe ein bereits uebergebener oder gerade uebergehender
 * Handoff noch aktive world-scoped Verdrahtung.
 *
 * Deshalb landet er **nie** im `WorldPresentationHandoff`: Was dort liegt, steht nur noch da und
 * wird von niemandem mehr getaktet oder verdrahtet.
 *
 * Phase 6A.1 zieht den ersten echten Inhalt ein: die Kamera-Positionierung und die World-Surface-
 * Residency. Beides ist reine Presentation-Infrastruktur ohne Gameplay-Zustand, deshalb darf
 * dieser Owner Phaser-Objekte direkt halten – er ist ausdruecklich kein Service-Locator und kennt
 * die Scene nur ueber die schmalen, benannten Ports dieses Inputs. Schatten-, Licht- und
 * Snapshot-Sync sowie Canopy- und Persistent-Base-Residency folgen in spaeteren Phasen.
 */
export interface WorldPresentationFrameBindingInput {
  /** Die Scene, deren Hauptkamera diese World-Instanz waehrend ihrer Lebenszeit positioniert. */
  readonly scene: Phaser.Scene;
  /** Wie dieser Peer die World lokal darstellt; die Weltkamera ist eine ihrer Flaechen. */
  readonly getLocalWorldPresentation: () => WorldPresentationRequirement;
  /** A/D- bzw. Pfeiltasten-Eingabe der freien Zuschauerkamera. */
  readonly getSpectatorCameraInput: () => ArenaSpectatorCameraInput | undefined;
  /** Die Spielfigur, der die Kamera folgt; `null` ohne lokal sichtbare Figur. */
  readonly getLocalPlayerSprite: () => Phaser.GameObjects.Sprite | null;
  /** Zuschauerrolle dieser Runde; ein Spectator fuehrt die freie Kamera statt der Verfolgung. */
  readonly isLocalPlayerSpectator: () => boolean;
  /** Ob die lokale Spielfigur gerade lebt; tot ohne vorbereiteten Startfokus haelt die Kamera an. */
  readonly isLocalPlayerAlive: () => boolean;
  /** Die Arena laedt noch; der erste bekannte Spawn ist bereits ein gueltiger Kamerafokus. */
  readonly isArenaLoading: () => boolean;
  /** Der Countdown laeuft; wie beim Laden gilt der vorbereitete Startfokus bereits. */
  readonly isArenaCountdownActive: () => boolean;
  /** Der gebaute World-Zustand, dessen residente Render-Chunks der Residency-Sync angleicht. */
  readonly getArenaResult: () => ArenaBuilderResult | null;
}

/**
 * Der neutrale Kamerastand ohne aktive World-Presentation.
 *
 * Gilt fuer beide Faelle, die dasselbe bedeuten: Diese World stellt keine Weltkamera dar, oder es
 * gibt gerade ueberhaupt keine World-Runtime (zwischen zwei Instanzen, vor der ersten). Beide
 * Wege muessen denselben Stand hinterlassen, sonst rechnet das Kamera-Feedback am Frame-Ende auf
 * einer veralteten Basis der vorherigen World weiter.
 */
export function resetWorldCameraBase(scene: Phaser.Scene): void {
  const camera = scene.cameras.main;
  camera.scrollX = 0;
  camera.scrollY = 0;
  setCameraBaseScroll(scene, 0, 0);
}

export class WorldPresentationFrameBinding {
  private destroyed = false;
  private lastCameraScrollX = 0;
  private lastCameraScrollY = 0;
  private spectatorCameraScrollX = 0;
  private spectatorCameraScrollY = 0;

  constructor(private readonly input: WorldPresentationFrameBindingInput) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Setzt die Hauptkamera auf ihre **unversetzte** Basisposition. Der visuelle Versatz des
   * Kamera-Feedbacks kommt erst am Frame-Ende ueber `applyCameraFeedback()` in der Scene dazu.
   *
   * Laeuft pro Frame zweimal – einmal vor der Simulation, weil das Startbild das Working Set
   * definiert, auf das die Ladebarriere wartet, und einmal danach auf die finale Spielerposition.
   * Die Verfolgung lerpt bewusst aus `lastCameraScrollX/Y` und nicht aus `camera.scrollX/Y`: Zu
   * Beginn eines Frames traegt die Kamera noch den Versatz des Vorframes, und ein Ruecklesen
   * wuerde das Rumpeln in die Verfolgung zurueckkoppeln und die Kamera abdriften lassen.
   *
   * Nach `destroy()` wirkungslos: ein stale Aufruf darf die Kamera einer nachfolgenden World
   * nicht mehr bewegen.
   */
  syncCamera(deltaMs: number, showWorld: boolean): void {
    if (this.destroyed) return;
    const camera = this.input.scene.cameras.main;

    const spectator = showWorld && this.input.isLocalPlayerSpectator();
    const arenaWidth = Math.max(0, ARENA_MAX_X - ARENA_OFFSET_X);
    const arenaHeight = Math.max(0, ARENA_MAX_Y - ARENA_OFFSET_Y);
    const canSpectatorPanX = arenaWidth > ARENA_VIEWPORT_WIDTH;
    const canSpectatorPanY = arenaHeight > ARENA_VIEWPORT_HEIGHT;
    const canSpectatorPan = canSpectatorPanX || canSpectatorPanY;
    // Die Weltkamera ist World-Presentation: ohne lokale Darstellung dieser World gibt es sie
    // nicht, auch wenn die Simulation weiterlaeuft.
    const worldCamera = allowsWorldPresentationSurface(this.input.getLocalWorldPresentation(), 'worldCamera');
    if (!showWorld || !worldCamera
      || (!ACTIVE_ARENA_METRICS_PROFILE.usesDynamicCamera && !(spectator && canSpectatorPan))) {
      this.lastCameraScrollX = 0;
      this.lastCameraScrollY = 0;
      this.spectatorCameraScrollX = 0;
      this.spectatorCameraScrollY = 0;
      resetWorldCameraBase(this.input.scene);
      return;
    }

    if (spectator) {
      const spectatorInput = this.input.getSpectatorCameraInput();
      this.spectatorCameraScrollX = advanceSpectatorCameraScroll({
        currentScrollX: this.spectatorCameraScrollX,
        deltaMs,
        moveLeft: spectatorInput?.left === true,
        moveRight: spectatorInput?.right === true,
        arenaWidth,
        viewportWidth: ARENA_VIEWPORT_WIDTH,
      });
      this.spectatorCameraScrollY = advanceSpectatorCameraScroll({
        currentScrollX: this.spectatorCameraScrollY,
        deltaMs,
        moveLeft: spectatorInput?.up === true,
        moveRight: spectatorInput?.down === true,
        arenaWidth: arenaHeight,
        viewportWidth: ARENA_VIEWPORT_HEIGHT,
      });
      this.lastCameraScrollX = this.spectatorCameraScrollX;
      this.lastCameraScrollY = this.spectatorCameraScrollY;
      camera.scrollX = this.spectatorCameraScrollX;
      camera.scrollY = this.spectatorCameraScrollY;
      setCameraBaseScroll(this.input.scene, this.spectatorCameraScrollX, this.spectatorCameraScrollY);
      return;
    }

    const localSprite = this.input.getLocalPlayerSprite();
    const preparedStartFocus = this.input.isArenaLoading() || this.input.isArenaCountdownActive();
    if (!localSprite?.active || (!this.input.isLocalPlayerAlive() && !preparedStartFocus)) {
      camera.scrollX = this.lastCameraScrollX;
      camera.scrollY = this.lastCameraScrollY;
      setCameraBaseScroll(this.input.scene, this.lastCameraScrollX, this.lastCameraScrollY);
      return;
    }

    const maxScrollX = Math.max(0, ARENA_MAX_X - (ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH));
    const maxScrollY = Math.max(0, ARENA_MAX_Y - (ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT));
    const focusScreenX = ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH * 0.5;
    const focusScreenY = ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT * 0.5;
    const targetScrollX = Phaser.Math.Clamp(localSprite.x - focusScreenX, 0, maxScrollX);
    const targetScrollY = Phaser.Math.Clamp(localSprite.y - focusScreenY, 0, maxScrollY);
    // The first local spawn is already known during loading; snap once so the startup working
    // set is not invalidated by a camera glide while the barrier is being evaluated.
    const followLerp = this.input.isArenaLoading() ? 1 : 1 - Math.exp(-deltaMs / 120);
    this.lastCameraScrollX = Phaser.Math.Linear(this.lastCameraScrollX, targetScrollX, followLerp);
    this.lastCameraScrollY = Phaser.Math.Linear(this.lastCameraScrollY, targetScrollY, followLerp);
    camera.scrollX = this.lastCameraScrollX;
    camera.scrollY = this.lastCameraScrollY;
    setCameraBaseScroll(this.input.scene, this.lastCameraScrollX, this.lastCameraScrollY);
  }

  /**
   * Gleicht die residenten Render-Chunks dieser World an den sichtbaren Ausschnitt an. Gehoert
   * in den Arena-Update-Pfad, direkt nachdem die Kamera ihren finalen Scroll fuer diesen
   * Zeitpunkt hat (siehe `syncCamera`), mit Sicherheitsrand vor dem spaeteren Kamera-Feedback.
   *
   * Laeuft ausschliesslich, waehrend diese World dargestellt wird – ohne Darstellung bleibt der
   * zuletzt residente Stand unangetastet stehen, die Welt verschwindet also nicht, sie waechst
   * nur nicht mit. Nach `destroy()` wirkungslos.
   */
  syncSurfaceResidency(showWorld: boolean): void {
    if (this.destroyed || !showWorld) return;
    const worldView = getVisibleWorldView(this.input.scene.cameras.main);
    ArenaBuilder.updateSurfaceResidency(this.input.getArenaResult(), worldView);
  }

  /**
   * Idempotent; danach sind alle Methoden wirkungslos. Es raeumt bewusst nichts auf – insbesondere
   * bleibt `camera.scrollX/Y` unveraendert stehen, der erste Frame der naechsten World ueberschreibt
   * ihn ohnehin ueber `syncCamera()`.
   */
  destroy(): void {
    this.destroyed = true;
  }
}
