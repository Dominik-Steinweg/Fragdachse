import * as Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

/**
 * Gesamtes Gameplay, alle HUD-Koordinaten und sämtliche Konstanten rechnen im
 * 1920x1080-Designraum. Der *Renderer* muss darin nicht arbeiten: Backing-Store der Canvas
 * und Kamera-Zoom werden gemeinsam um denselben Faktor skaliert, sodass jede Weltkoordinate
 * unverändert bleibt, das Bild aber genau so viele Pixel besitzt, wie das Ausgabegerät
 * tatsächlich darstellt.
 *
 * Ohne das rendert Phaser immer 1920x1080 und der Browser skaliert die Canvas per CSS auf die
 * echte Fläche: auf WQHD im Vollbild um Faktor 1,333, im Fenster (Browserleisten) um einen
 * krummen Faktor unter 1. Jede solche Resampling-Stufe kostet Schärfe, am sichtbarsten bei
 * kleinen Texten.
 *
 * ## Warum `origin = (0, 0)` zwingend ist
 *
 * Phaser 4 baut die Kameramatrix in `Camera.preRender` als
 *
 *     Screen = zoom * (Welt - scroll * scrollFactor - originPx) + originPx
 *
 * mit `originPx = camera.width * camera.originX`. Nur mit `originX = originY = 0` fällt
 * `originPx` weg und es bleibt exakt
 *
 *     Screen = zoom * (Welt - scroll * scrollFactor)
 *
 * also eine reine Vergrößerung des bisherigen Bildes – identisch für Weltobjekte
 * (`scrollFactor 1`) und für am Bildschirm fixiertes HUD (`scrollFactor 0`). Mit Phasers
 * Default `originX = 0.5` driftet dagegen alles mit `scrollFactor 0` gegenüber der Welt
 * auseinander, sobald `zoom != 1` ist.
 *
 * Bei `renderScale === 1` ist der gesamte Mechanismus ein No-op: `zoom = 1` macht `originPx`
 * wieder irrelevant und die Canvas hat wieder exakt 1920x1080.
 */

/**
 * Unterhalb dieses Faktors wird nicht weiter heruntergerendert. Ein sehr kleines Fenster soll
 * das Bild schärfen, nicht das Spiel unlesbar machen.
 */
const MIN_RENDER_SCALE = 0.5;

/** Obergrenze, wenn keine Qualitätsstufe etwas anderes vorgibt (entspricht 3840x2160). */
export const DEFAULT_MAX_RENDER_SCALE = 2;

/**
 * Kleinere Abweichungen als das werden nicht angewendet. Verhindert eine Endlosschleife
 * zwischen `setGameSize()` und dem dadurch ausgelösten RESIZE, da die auf ganze Pixel
 * gerundete Canvas-Breite den Zielfaktor nie exakt trifft.
 */
const RENDER_SCALE_EPSILON = 0.005;

/** Textur-Auflösung von `Text` wird auf dieses Raster gerundet, damit sie selten neu rastert. */
const TEXT_RESOLUTION_STEP = 0.5;
const MAX_TEXT_RESOLUTION = 2;

function getDevicePixelRatio(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Breite, die die Canvas im FIT-Modus in CSS-Pixeln einnimmt. Das Seitenverhältnis bleibt
 * konstant 16:9, deshalb folgt sie allein aus der engeren der beiden Begrenzungen – und ist
 * damit unabhängig davon, wie groß der Backing-Store gerade ist.
 */
function fitDisplayWidthCss(availableWidth: number, availableHeight: number): number {
  return Math.min(availableWidth, availableHeight * (GAME_WIDTH / GAME_HEIGHT));
}

function toRenderScale(displayWidthCss: number, maxRenderScale: number): number {
  const devicePixels = displayWidthCss * getDevicePixelRatio();
  return Phaser.Math.Clamp(devicePixels / GAME_WIDTH, MIN_RENDER_SCALE, maxRenderScale);
}

/**
 * Startgröße für die Spielkonfiguration. Vor dem Boot existiert weder ScaleManager noch eine
 * vermessbare Eltern-Box, deshalb wird das Fenster geschätzt. Der {@link RenderResolutionController}
 * korrigiert unmittelbar nach dem ersten RESIZE auf den exakten Wert.
 */
export function initialRenderSize(): { width: number; height: number } {
  const availableWidth  = typeof window === 'undefined' ? GAME_WIDTH  : window.innerWidth;
  const availableHeight = typeof window === 'undefined' ? GAME_HEIGHT : window.innerHeight;
  const scale = toRenderScale(
    fitDisplayWidthCss(availableWidth, availableHeight),
    DEFAULT_MAX_RENDER_SCALE,
  );
  return renderSizeFor(scale);
}

function renderSizeFor(scale: number): { width: number; height: number } {
  const width = Math.round(GAME_WIDTH * scale);
  return { width, height: Math.round(width * (GAME_HEIGHT / GAME_WIDTH)) };
}

/**
 * Aktueller Faktor zwischen Renderauflösung und Designraum. Wird aus dem ScaleManager
 * abgeleitet statt zwischengespeichert – dort steht die Wahrheit, auch nach einem
 * Fullscreen-Wechsel.
 */
export function getRenderScale(scale: Phaser.Scale.ScaleManager): number {
  return scale.width / GAME_WIDTH;
}

/**
 * Rechnet eine Zeigerposition (`pointer.x`/`pointer.y`, immer in Renderpixeln) in den
 * Designraum um. Nur nötig, wo roh mit Zeigerkoordinaten gerechnet wird – `getWorldPoint()`
 * und die Treffererkennung interaktiver Objekte invertieren die Kameramatrix bereits selbst.
 */
export function toDesignSpace(scale: Phaser.Scale.ScaleManager, value: number): number {
  const renderScale = getRenderScale(scale);
  return renderScale > 0 ? value / renderScale : value;
}

/**
 * Texturauflösung für `Text`-Objekte. Ein Text rastert seine Glyphen in eine eigene Canvas;
 * ohne Anhebung wird diese beim Hochskalieren der Kamera vergrößert und wirkt weich. Nach
 * oben begrenzt, weil jede Stufe die Textur quadratisch teurer macht.
 */
export function getTextResolution(scale: Phaser.Scale.ScaleManager): number {
  const renderScale = getRenderScale(scale);
  const stepped = Math.ceil(renderScale / TEXT_RESOLUTION_STEP) * TEXT_RESOLUTION_STEP;
  return Phaser.Math.Clamp(stepped, 1, MAX_TEXT_RESOLUTION);
}

/**
 * Hält die Canvas-Auflösung an der tatsächlich dargestellten Pixelzahl. Läuft über die
 * Lebensdauer des Spiels, nicht der Szene.
 */
export class RenderResolutionController {
  private maxRenderScale = DEFAULT_MAX_RENDER_SCALE;
  private applying = false;

  constructor(private readonly game: Phaser.Game) {}

  install(): void {
    this.game.scale.on(Phaser.Scale.Events.RESIZE, this.sync, this);
    this.sync();
  }

  /** Deckelt die Renderauflösung, etwa aus der Grafikqualität heraus. */
  setMaxRenderScale(value: number): void {
    if (value === this.maxRenderScale) return;
    this.maxRenderScale = value;
    this.sync();
  }

  sync(): void {
    // `setGameSize()` löst selbst ein RESIZE aus; ohne Sperre riefe sich das hier direkt
    // wieder auf. Andere RESIZE-Hörer (Kameras, Szene) bekommen das Ereignis weiterhin.
    if (this.applying) return;

    const scale = this.game.scale;
    if (!(scale.displaySize.width > 0)) return;

    const target = toRenderScale(scale.displaySize.width, this.maxRenderScale);
    if (Math.abs(target - getRenderScale(scale)) < RENDER_SCALE_EPSILON) return;

    const size = renderSizeFor(target);
    this.applying = true;
    try {
      scale.setGameSize(size.width, size.height);
    } finally {
      this.applying = false;
    }
  }
}

/**
 * Der Controller lebt so lange wie das Spiel, die Grafikqualität wird dagegen in der Szene
 * verwaltet. Ein Modul-Singleton verbindet beides, ohne den Controller durch die
 * Szenenkonstruktion zu reichen.
 */
let activeController: RenderResolutionController | null = null;

export function installRenderResolution(game: Phaser.Game): RenderResolutionController {
  activeController = new RenderResolutionController(game);
  activeController.install();
  return activeController;
}

export function getRenderResolutionController(): RenderResolutionController | null {
  return activeController;
}
