/**
 * Nicht-periodische Materialstoerung ("Mottle") der Felsflaeche.
 *
 * Alle 47 Blob-Kacheln teilen dieselbe 32-px-Materialflaeche, das Feld ist also ein pro
 * Zelle wiederholtes Motiv. Ein Farb-/Helligkeitsfeld allein (siehe
 * `RockSurfaceShading`) kann das nicht aufloesen, weil ihm die Detailstruktur fehlt; eine
 * Rotation je Zelle ebenfalls nicht, weil das Motiv nur mit sich selbst in gleicher
 * Orientierung nahtlos ist und jede Transformation Zellnaehte erzeugt.
 *
 * Deshalb werden weich radial maskierte, gedrehte und skalierte Kopien der Materialflaeche
 * ueber den Verbund gestreut. Weil die Masken weich sind und die Flecken sich ueberlappen,
 * entstehen keine Naehte; weil ihre Groesse und Position nichts mit `CELL_SIZE` zu tun
 * haben, verschwindet das Raster.
 *
 * Das Ergebnis liegt in einem MULTIPLY-Layer: der Fleck kann nur abdunkeln, wodurch der
 * HP-Schadenstint des Felsens verhaeltnisgleich erhalten bleibt. Ein deckender
 * NORMAL-Layer wuerde ihn um seine eigene Alpha verwaessern.
 */

import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import { fillRadialGradientTexture } from '../effects/EffectUtils';

const TEX_MOTTLE = '__rock_surface_mottle';
const TEX_MOTTLE_FALLOFF = '__rock_surface_mottle_falloff';

/**
 * Hellster Kanalwert der Materialflaeche nach dem Ausgleichs-Tint, am Vollfels-Frame
 * gemessen. Bezugspunkt fuer die Anhebung: an dieser Stelle soll der Multiplikator genau 1
 * ergeben, damit der Fleck die hellsten Materialstellen unangetastet laesst.
 */
const MATERIAL_PEAK = 68;

/** Ab hier klemmt die Anhebung; darueber verliert der Fleck seinen wirkungslosen Hellpunkt. */
export const MOTTLE_MAX_GAIN = 255 / MATERIAL_PEAK;

export const ROCK_MOTTLE = {
  /** Vollfels-Frame (Maske 255) – seine Innenflaeche ist die gemeinsame Materialflaeche. */
  materialFrame: 12,
  /**
   * Kantenlaenge der Fleck-Textur. Bewusst gleich `CELL_SIZE`: das Spiel laeuft mit
   * `smoothPixelArt`, also linearer Filterung. Eine groessere Fleck-Textur wuerde das 32-px-
   * Material erst hochskalieren und beim Stempeln wieder herunter – zwei Resampling-Schritte,
   * die genau das Detail wegwaschen, das den Fleck ueberhaupt wirksam macht.
   */
  textureSize: CELL_SIZE,
  /**
   * **Der Amplitudenregler.** Wie oft die Materialflaeche additiv uebereinander liegt.
   *
   * Im MULTIPLY-Layer ist die Amplitude die *absolute* Spannweite der Quelle geteilt durch
   * 255. Eine reine Anhebung Richtung Weiss verschiebt diese Spannweite nur; das rohe
   * Material traegt ~33 Stufen, also 13 % Modulation – zu wenig gegen die ~36 % des
   * Kachelmotivs. Jeder additive Durchgang spreizt sie: Gain 2 ergibt ~26 %, Gain 3 ~39 %.
   *
   * Gebrochene Werte sind erlaubt (letzter Durchgang mit Teil-Alpha). Obergrenze ist
   * {@link MOTTLE_MAX_GAIN}: darueber klemmt die hellste Materialstelle und der Fleck
   * beginnt, den Fels auch dort abzudunkeln, wo er wirkungslos sein soll. Mehr Amplitude
   * heisst zwangslaeufig dunklere Felsmasse – ein Multiplikator kann nicht aufhellen.
   */
  materialGain: 3,
  /**
   * Ausgleich der Kanalmaxima vor dem Gain.
   *
   * Das Material ist blaustichig (Maxima rot 68, gruen 90, blau 96). Ohne Ausgleich klemmt
   * Blau bei hoeherem Gain als Erstes, verliert dort seine Variation und faerbt den Fleck
   * kalt – die Amplitude steigt dann nicht weiter, nur der Farbstich. Der Tint zieht alle
   * drei Maxima auf {@link MATERIAL_PEAK} herunter, danach spreizt der Gain alle Kanaele
   * gleichmaessig.
   */
  materialEqualizeTint: 0xffc1b5,
  /**
   * Zwei Laengen mit klarer Aufgabenteilung. Der erste Durchgang traegt die Wirkung: seine
   * Flecken liegen in derselben Groessenordnung wie das Kachelmotiv und ueberdecken es
   * deshalb ueberhaupt. Grosse, weiche Flecken allein reichen nicht – sie fuegen Energie in
   * einer anderen Ortsfrequenz hinzu und lassen das 32-px-Raster daneben sichtbar. Der
   * zweite Durchgang gibt dem Verbund darueber hinaus eine Grossform.
   *
   * `perCell` ist die erwartete Fleckenzahl je belegter Zelle; der gebrochene Anteil
   * entscheidet sich pro Zelle einzeln.
   */
  passes: [
    { perCell: 1.35, minScale: 0.7, maxScale: 1.4, alpha: 1 },
    { perCell: 0.3, minScale: 2.2, maxScale: 3.6, alpha: 0.6 },
  ],
} as const;

/**
 * Anhebung Richtung Weiss, aus dem Gain abgeleitet statt frei konfiguriert: nur so bleibt
 * der hellste Materialwert bei jedem Gain genau wirkungslos (Multiplikator 1). Ein separat
 * eingestellter Wert wuerde bei jeder Gain-Aenderung stillschweigend entweder klemmen oder
 * die ganze Felsmasse zusaetzlich abdunkeln.
 */
function resolveLiftAlpha(gain: number): number {
  return Math.max(0, (255 - MATERIAL_PEAK * gain) / 255);
}

/**
 * Deterministischer Hash einer Zelle.
 *
 * Die Platzierung haengt ausschliesslich an den Gitterkoordinaten der Zelle, nie an ihrer
 * Position in einer Liste und nie an der Anzahl lebender Felsen. Das ist keine Feinheit,
 * sondern die Bedingung dafuer, dass der Layer bei jeder Hindernisaenderung neu gebacken
 * werden darf: eine listenabhaengige Zufallsfolge wuerde beim Wegfall einer einzigen Zelle
 * die gesamte Felsflaeche neu einfaerben – im Spiel als Aufflackern aller Felsen sichtbar,
 * sobald irgendein Fels zerstoert wird.
 */
function hash01(gridX: number, gridY: number, salt: number): number {
  let h = Math.imul(gridX + 0x9e3779b1, 0x85ebca6b)
    ^ Math.imul(gridY + 0x7f4a7c15, 0xc2b2ae35)
    ^ Math.imul(salt + 0x165667b1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x2545f491);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Baut die Fleck-Textur einmalig: Materialflaeche mit erhoehtem Kontrast, Richtung Weiss
 * angehoben, dann per invertiertem Radialverlauf zu einem weich auslaufenden Fleck gestanzt.
 */
export function ensureRockMottleTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(TEX_MOTTLE)) return TEX_MOTTLE;

  const size = ROCK_MOTTLE.textureSize;
  // Aussen voll deckend loeschen, im Zentrum unangetastet: ergibt den weichen Fleckrand.
  // Der flache Kern ist bewusst breit, damit der Fleck seine Amplitude auf der Flaeche
  // wirklich abliefert und nicht fast vollstaendig aus Auslauf besteht.
  fillRadialGradientTexture(scene.textures, TEX_MOTTLE_FALLOFF, size, [
    [0, 'rgba(0,0,0,0)'],
    [0.62, 'rgba(0,0,0,0.04)'],
    [0.85, 'rgba(0,0,0,0.42)'],
    [1, 'rgba(0,0,0,1)'],
  ]);

  const texture = scene.textures.addDynamicTexture(TEX_MOTTLE, size, size);
  if (!texture) return TEX_MOTTLE;

  // NEAREST, obwohl das Spiel mit `smoothPixelArt` linear filtert: der Fleck wird beim
  // Stempeln auf 0.7–3.6 Zellen skaliert, und lineare Filterung wuerde dabei genau das
  // Mitteldetail wegglaetten, mit dem er das Kachelmotiv ueberdeckt. Ohne dieses Detail
  // bleibt nur eine grossflaechige Helligkeitsschwankung uebrig, neben der das 32-px-Raster
  // unveraendert sichtbar ist.
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

  const gain = Math.min(ROCK_MOTTLE.materialGain, MOTTLE_MAX_GAIN);
  const fullPasses = Math.floor(gain);
  const partialAlpha = gain - fullPasses;
  const sources: Phaser.GameObjects.GameObject[] = [];

  for (let pass = 0; pass < fullPasses + (partialAlpha > 0 ? 1 : 0); pass += 1) {
    const isPartial = pass === fullPasses;
    const material = new Phaser.GameObjects.Image(scene, 0, 0, 'rocks', ROCK_MOTTLE.materialFrame)
      .setOrigin(0, 0)
      .setDisplaySize(size, size)
      .setTint(ROCK_MOTTLE.materialEqualizeTint);
    // Der erste Durchgang legt die Flaeche, jeder weitere addiert sie und spreizt damit
    // die Spannweite, auf die es im MULTIPLY-Layer ankommt. Der letzte darf ein Teil-
    // Durchgang sein, damit auch gebrochene Gains moeglich sind.
    if (pass > 0) material.setBlendMode(Phaser.BlendModes.ADD);
    if (isPartial) material.setAlpha(partialAlpha);
    texture.draw(material);
    sources.push(material);
  }

  // Graphics statt Rectangle: dieselbe Bauform, die das Projekt fuer reine Zeichenquellen
  // ausserhalb der Display-List nutzt (siehe `LightingSystem.createOccluderSlot`).
  const liftAlpha = resolveLiftAlpha(gain);
  if (liftAlpha > 0) {
    const lift = scene.make.graphics({}, false)
      .fillStyle(0xffffff, liftAlpha)
      .fillRect(0, 0, size, size);
    lift.setBlendMode(Phaser.BlendModes.ADD);
    texture.draw(lift);
    sources.push(lift);
  }
  texture.render();

  const falloff = new Phaser.GameObjects.Image(scene, 0, 0, TEX_MOTTLE_FALLOFF)
    .setOrigin(0, 0)
    .setDisplaySize(size, size);
  texture.erase(falloff);
  texture.render();
  sources.push(falloff);

  for (const source of sources) source.destroy();
  return TEX_MOTTLE;
}

export interface RockMottleMetrics {
  offsetX: number;
  offsetY: number;
}

/**
 * Erzeugt die Fleck-Bilder in Weltkoordinaten. Die Aufrufseite backt sie in einen
 * MULTIPLY-Layer und beschneidet ihn danach exakt auf die Fels-Silhouette – die Flecken
 * duerfen deshalb hier ueber die Kante hinausragen.
 */
export function createRockMottleImages(
  scene: Phaser.Scene,
  cells: readonly { gridX: number; gridY: number }[],
  metrics: RockMottleMetrics,
): Phaser.GameObjects.Image[] {
  if (cells.length === 0) return [];

  ensureRockMottleTexture(scene);
  const result: Phaser.GameObjects.Image[] = [];

  for (const { gridX, gridY } of cells) {
    for (let passIndex = 0; passIndex < ROCK_MOTTLE.passes.length; passIndex += 1) {
      const pass = ROCK_MOTTLE.passes[passIndex];
      const guaranteed = Math.floor(pass.perCell);
      const extra = hash01(gridX, gridY, passIndex * 97 + 11) < pass.perCell - guaranteed ? 1 : 0;

      for (let index = 0; index < guaranteed + extra; index += 1) {
        const salt = passIndex * 997 + index * 31;
        const scale = pass.minScale + (pass.maxScale - pass.minScale) * hash01(gridX, gridY, salt + 1);
        // Streuung ueber die ganze Zelle: die Fleckmitten sollen nicht auf dem Zellraster sitzen.
        const worldX = metrics.offsetX + (gridX + hash01(gridX, gridY, salt + 2)) * CELL_SIZE;
        const worldY = metrics.offsetY + (gridY + hash01(gridX, gridY, salt + 3)) * CELL_SIZE;
        result.push(
          new Phaser.GameObjects.Image(scene, worldX, worldY, TEX_MOTTLE)
            .setDisplaySize(CELL_SIZE * scale, CELL_SIZE * scale)
            .setRotation(hash01(gridX, gridY, salt + 4) * Math.PI * 2)
            .setAlpha(pass.alpha),
        );
      }
    }
  }

  return result;
}
