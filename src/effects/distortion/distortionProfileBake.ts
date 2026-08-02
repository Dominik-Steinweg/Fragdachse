/**
 * Erzeugt die Pixel der Verzerrungsprofile. Ohne Phaser-Import, damit die Kodierung prüfbar ist.
 *
 * **Kodierung.** Phasers Displacement-Shader rechnet `disp = (rgb.rg - 0.5) * amount`. Neutral
 * ist damit exakt `0x808080`; R und G tragen die vorzeichenbehaftete Richtung, nicht Farbe.
 * Deshalb werden diese Texturen per Pixelschleife geschrieben und **nicht** mit
 * Canvas-Farbverläufen: ein Gradient interpoliert Farben, keine Vektoren.
 *
 * **Vormultipliziertes Alpha.** Phaser lädt Canvas-Texturen ohne Vormultiplikation hoch, mischt
 * beim Zeichnen aber in vormultiplizierter Form (`funcSrc = gl.ONE`) – derselbe Befund, den
 * `LightingSystem.ensureConeTexture()` für ADD festhält. Über der neutralen Grundfläche gilt
 * damit `result = src.rgb + dst.rgb·(1 - a)`. Nur wenn hier bereits `rgb · a` abgelegt wird,
 * ergibt das am Rand exakt wieder Neutral und in der Mitte exakt den gewünschten Wert. Ein
 * nicht vormultipliziertes Profil würde außerhalb seines Radius die ganze Kachel verzerren.
 */

export type DistortionProfileKey = 'pull' | 'pullSwirl' | 'lens' | 'ring';

export const DISTORTION_PROFILE_KEYS: readonly DistortionProfileKey[] = ['pull', 'pullSwirl', 'lens', 'ring'];

/** Kantenlänge der gebackenen Profile. Klein genug für vier Texturen, groß genug für weiche Ränder. */
export const DISTORTION_PROFILE_SIZE = 128;

/** Neutralwert je Kanal – der Shader zieht exakt diesen Wert ab. */
export const DISTORTION_NEUTRAL_BYTE = 128;

/** Der sichtbare Ereignishorizont bleibt von der Kamera-Verzerrung vollständig unberührt. */
export const BLACK_HOLE_PROTECTED_CORE_RADIUS = 0.28;

/** Ab hier klingt die Zeitbrechung ab; die äußere Membran selbst bleibt kreisförmig. */
export const TIME_BUBBLE_MEMBRANE_GUARD_START = 0.62;
export const TIME_BUBBLE_MEMBRANE_GUARD_END = 0.84;

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Betrag der Verschiebung über dem normierten Radius, je Profil. */
function profileMagnitude(profile: DistortionProfileKey, r: number): number {
  switch (profile) {
    // Schwarzes Loch: ein echter neutraler Innenkreis hält den Ereignishorizont scharf. Erst
    // außerhalb davon steigt die Gravitationslinse an und läuft am Feldrand weich aus.
    //
    // Bewusst zwei Smoothsteps statt einer Sinuskurve über `r^0.75`: die stiege am Zentrum
    // unendlich steil an und verzerrte den Kern schon im ersten Pixel.
    case 'pull':
    case 'pullSwirl':
      return smoothstep(BLACK_HOLE_PROTECTED_CORE_RADIUS, 0.56, r)
        * (1 - smoothstep(0.68, 1, r));
    // Zeitblase: die Welt wird im Inneren gebrochen. Vor der sichtbaren Membran klingt das
    // Profil vollständig auf Neutral aus, damit der Kamera-Pass die eigene Kreisform nicht
    // mitzieht und ausbeult.
    case 'lens':
      return smoothstep(0.06, 0.46, r)
        * (1 - smoothstep(TIME_BUBBLE_MEMBRANE_GUARD_START, TIME_BUBBLE_MEMBRANE_GUARD_END, r));
    // Druckwelle: schmales Band, das über die Skalierung des Stempels nach außen läuft.
    case 'ring': {
      const d = (r - 0.78) / 0.13;
      return Math.exp(-d * d);
    }
  }
}

/** Deckkraft über dem Radius: bestimmt, wie weich die Quelle auf Neutral ausläuft. */
function profileAlpha(profile: DistortionProfileKey, r: number): number {
  if (r >= 1) return 0;
  if (profile === 'ring') return profileMagnitude('ring', r);
  return 1 - smoothstep(0.72, 1, r);
}

/**
 * Richtung der Verschiebung als Einheitsvektor.
 * `pull` zieht nach innen, `lens` und `ring` drücken nach außen, `pullSwirl` legt einen
 * tangentialen Anteil dazu – die leichte Drehung nahe dem Ereignishorizont.
 */
function profileDirection(profile: DistortionProfileKey, u: number, v: number, r: number): { x: number; y: number } {
  if (r <= 1e-6) return { x: 0, y: 0 };
  const nx = u / r;
  const ny = v / r;

  switch (profile) {
    case 'pull':
      return { x: -nx, y: -ny };
    case 'pullSwirl': {
      // Subtile Rotation direkt außerhalb des Ereignishorizonts. Der frühere Aufruf mit
      // vertauschten Smoothstep-Grenzen ergab praktisch keinen Tangentialanteil.
      const swirl = 0.38 * (1 - smoothstep(0.32, 0.82, r));
      const tx = -ny;
      const ty = nx;
      const x = -nx + tx * swirl;
      const y = -ny + ty * swirl;
      const len = Math.hypot(x, y) || 1;
      return { x: x / len, y: y / len };
    }
    case 'lens':
    case 'ring':
      return { x: nx, y: ny };
  }
}

/**
 * Schreibt ein Profil als RGBA-Puffer.
 *
 * @param size Kantenlänge in Pixeln.
 */
export function writeDistortionProfilePixels(
  profile: DistortionProfileKey,
  size: number = DISTORTION_PROFILE_SIZE,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const u = (px + 0.5 - half) / half;
      const v = (py + 0.5 - half) / half;
      const r = Math.hypot(u, v);
      const index = (py * size + px) * 4;

      if (r >= 1) {
        // Vollständig transparent **und** schwarz: bei vormultipliziertem Mischen trägt der
        // Pixel damit nichts bei und die Grundfläche bleibt exakt neutral.
        pixels[index] = 0;
        pixels[index + 1] = 0;
        pixels[index + 2] = 0;
        pixels[index + 3] = 0;
        continue;
      }

      const alpha = profileAlpha(profile, r);
      const magnitude = profileMagnitude(profile, r);
      const direction = profileDirection(profile, u, v, r);

      // 0.5 ist Neutral, der Ausschlag geht in beide Richtungen bis an die Kanalgrenze.
      const red = 0.5 + direction.x * magnitude * 0.5;
      const green = 0.5 + direction.y * magnitude * 0.5;

      pixels[index] = Math.round(red * alpha * 255);
      pixels[index + 1] = Math.round(green * alpha * 255);
      pixels[index + 2] = 0;
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

/** Texturschlüssel eines Profils. */
export function distortionProfileTextureKey(profile: DistortionProfileKey): string {
  return `__dist_${profile}`;
}
