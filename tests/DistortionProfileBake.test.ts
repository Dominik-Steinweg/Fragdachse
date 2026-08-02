import { describe, expect, it } from 'vitest';
import {
  BLACK_HOLE_PROTECTED_CORE_RADIUS,
  DISTORTION_NEUTRAL_BYTE,
  DISTORTION_PROFILE_KEYS,
  TIME_BUBBLE_MEMBRANE_GUARD_END,
  TIME_BUBBLE_MEMBRANE_GUARD_START,
  type DistortionProfileKey,
  writeDistortionProfilePixels,
} from '../src/effects/distortion/distortionProfileBake';
import { resolveIsotropicDistortionAmounts } from '../src/effects/distortion/distortionScale';
import {
  BLACK_HOLE_DISTORTION_REFERENCE_RADIUS_PX,
  resolveBlackHoleDistortion,
  resolveBlackHoleRadiusScale,
} from '../src/effects/distortion/blackHoleDistortion';

const SIZE = 64;

function pixelAt(pixels: Uint8ClampedArray, size: number, x: number, y: number) {
  const index = (y * size + x) * 4;
  return { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2], a: pixels[index + 3] };
}

function pixelAtRadius(pixels: Uint8ClampedArray, size: number, radius: number) {
  return pixelAt(pixels, size, Math.floor(size / 2 + size / 2 * radius), size / 2);
}

/** Löst die Vormultiplikation auf – das ist der Wert, den der Shader nach dem Mischen sieht. */
function decode(channel: number, alpha: number): number {
  if (alpha === 0) return 0.5;
  return (channel / alpha) ;
}

describe('writeDistortionProfilePixels', () => {
  it('liefert fuer jedes Profil einen vollstaendigen RGBA-Puffer', () => {
    for (const profile of DISTORTION_PROFILE_KEYS) {
      expect(writeDistortionProfilePixels(profile, SIZE)).toHaveLength(SIZE * SIZE * 4);
    }
  });

  /**
   * Außerhalb des Kreises muss der Pixel vollstaendig leer sein – **und** schwarz. Bei Phasers
   * vormultipliziertem Mischen wuerde ein Restwert in RGB die gesamte Kachel verzerren, auch
   * bei Alpha 0.
   */
  it('laesst die Ecken der Kachel vollstaendig unwirksam', () => {
    for (const profile of DISTORTION_PROFILE_KEYS) {
      const pixels = writeDistortionProfilePixels(profile, SIZE);
      for (const [x, y] of [[0, 0], [SIZE - 1, 0], [0, SIZE - 1], [SIZE - 1, SIZE - 1]]) {
        const pixel = pixelAt(pixels, SIZE, x, y);
        expect(pixel.a).toBe(0);
        expect(pixel.r).toBe(0);
        expect(pixel.g).toBe(0);
      }
    }
  });

  /**
   * Der Kern des Schwarzen Lochs muss dunkel und **stabil** bleiben. Ein Betrag, der am Zentrum
   * steil ansteigt, verzerrt ihn schon im ersten Pixel.
   */
  it('haelt das Zentrum von pull und lens neutral', () => {
    for (const profile of ['pull', 'pullSwirl', 'lens'] as DistortionProfileKey[]) {
      const pixels = writeDistortionProfilePixels(profile, SIZE);
      const center = pixelAt(pixels, SIZE, SIZE / 2, SIZE / 2);
      expect(Math.abs(decode(center.r, center.a) * 255 - DISTORTION_NEUTRAL_BYTE)).toBeLessThanOrEqual(2);
      expect(Math.abs(decode(center.g, center.a) * 255 - DISTORTION_NEUTRAL_BYTE)).toBeLessThanOrEqual(2);
    }
  });

  it('schuetzt die sichtbare Kern- und Halo-Flaeche vor Verzerrung', () => {
    const pixels = writeDistortionProfilePixels('pullSwirl', SIZE);
    for (const radius of [0, 0.12, 0.52, BLACK_HOLE_PROTECTED_CORE_RADIUS - 0.03]) {
      const x = Math.floor(SIZE / 2 + SIZE / 2 * radius);
      const pixel = pixelAt(pixels, SIZE, x, SIZE / 2);
      expect(Math.abs(decode(pixel.r, pixel.a) * 255 - DISTORTION_NEUTRAL_BYTE)).toBeLessThanOrEqual(2);
      expect(Math.abs(decode(pixel.g, pixel.a) * 255 - DISTORTION_NEUTRAL_BYTE)).toBeLessThanOrEqual(2);
    }
  });

  it('legt den Sog als rotierende Linse ausserhalb des Ereignishorizonts an', () => {
    const pixels = writeDistortionProfilePixels('pullSwirl', SIZE);
    const annulus = pixelAtRadius(pixels, SIZE, 0.64);
    expect(decode(annulus.r, annulus.a) * 255).toBeLessThan(DISTORTION_NEUTRAL_BYTE);
    expect(decode(annulus.g, annulus.a) * 255).toBeGreaterThan(DISTORTION_NEUTRAL_BYTE);
  });

  it('zieht beim pull-Profil nach innen', () => {
    const pixels = writeDistortionProfilePixels('pull', SIZE);
    // Punkt rechts der Mitte: die Verschiebung muss nach links (negativ) zeigen.
    const right = pixelAtRadius(pixels, SIZE, 0.78);
    expect(right.a).toBeGreaterThan(0);
    expect(decode(right.r, right.a) * 255).toBeLessThan(DISTORTION_NEUTRAL_BYTE);
  });

  it('drueckt beim lens-Profil nach aussen', () => {
    const pixels = writeDistortionProfilePixels('lens', SIZE);
    const right = pixelAtRadius(pixels, SIZE, 0.5);
    expect(right.a).toBeGreaterThan(0);
    expect(decode(right.r, right.a) * 255).toBeGreaterThan(DISTORTION_NEUTRAL_BYTE);
  });

  it('blendet lens vor der sichtbaren Membran vollstaendig auf neutral', () => {
    const pixels = writeDistortionProfilePixels('lens', SIZE);
    const inner = pixelAtRadius(pixels, SIZE, TIME_BUBBLE_MEMBRANE_GUARD_START - 0.08);
    const membrane = pixelAtRadius(pixels, SIZE, TIME_BUBBLE_MEMBRANE_GUARD_END + 0.05);
    expect(decode(inner.r, inner.a) * 255).toBeGreaterThan(DISTORTION_NEUTRAL_BYTE);
    expect(Math.abs(decode(membrane.r, membrane.a) * 255 - DISTORTION_NEUTRAL_BYTE)).toBeLessThanOrEqual(2);
    expect(Math.abs(decode(membrane.g, membrane.a) * 255 - DISTORTION_NEUTRAL_BYTE)).toBeLessThanOrEqual(2);
  });

  it('ist radialsymmetrisch', () => {
    const pixels = writeDistortionProfilePixels('pull', SIZE);
    const right = pixelAt(pixels, SIZE, Math.round(SIZE * 0.8), SIZE / 2);
    const left = pixelAt(pixels, SIZE, SIZE - 1 - Math.round(SIZE * 0.8), SIZE / 2);
    expect(left.a).toBe(right.a);
    // Spiegelbildlich: der eine zieht nach links, der andere nach rechts.
    expect(decode(left.r, left.a) - 0.5).toBeCloseTo(-(decode(right.r, right.a) - 0.5), 2);
  });

  it('haelt jeden Kanal innerhalb des Byte-Bereichs', () => {
    for (const profile of DISTORTION_PROFILE_KEYS) {
      const pixels = writeDistortionProfilePixels(profile, SIZE);
      for (const value of pixels) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('resolveIsotropicDistortionAmounts', () => {
  it('erzeugt auf einem 16:9-Viewport denselben Pixelversatz auf beiden Achsen', () => {
    const amounts = resolveIsotropicDistortionAmounts(0.05, 1920, 1080);
    expect(amounts.x * 1920).toBeCloseTo(amounts.y * 1080, 8);
    expect(amounts.x).toBeLessThan(amounts.y);
    expect(amounts.y).toBe(0.05);
  });

  it('laesst quadratische Viewports unveraendert', () => {
    expect(resolveIsotropicDistortionAmounts(0.05, 800, 800)).toEqual({ x: 0.05, y: 0.05 });
  });
});

describe('resolveBlackHoleDistortion', () => {
  it('baut die Linse beim Entstehen auf', () => {
    const early = resolveBlackHoleDistortion(10, 1000);
    const settled = resolveBlackHoleDistortion(300, 1000);
    expect(early.strength).toBeLessThan(settled.strength);
    expect(settled.strength).toBe(1);
    expect(settled.profile).toBe('pullSwirl');
  });

  it('skaliert kleine Felder proportional, damit sie wie die Raketenwerfer-Referenz aussehen', () => {
    const turretRadius = 95;
    const turret = resolveBlackHoleDistortion(300, 1000, turretRadius);
    const rocket = resolveBlackHoleDistortion(
      300,
      1000,
      BLACK_HOLE_DISTORTION_REFERENCE_RADIUS_PX,
    );

    expect(turret.strength / turretRadius).toBeCloseTo(
      rocket.strength / BLACK_HOLE_DISTORTION_REFERENCE_RADIUS_PX,
      8,
    );
  });

  it('liefert denselben proportionalen Faktor für Linse und Partikelschichten', () => {
    expect(resolveBlackHoleRadiusScale(95)).toBeCloseTo(95 / 120, 8);
    expect(resolveBlackHoleRadiusScale(120)).toBe(1);
    expect(resolveBlackHoleRadiusScale(165)).toBe(1);
  });

  it('lässt Raketenwerfer-große Felder unverändert', () => {
    expect(resolveBlackHoleDistortion(300, 1000, 121).strength).toBe(1);
    expect(resolveBlackHoleDistortion(300, 1000, 165).strength).toBe(1);
  });

  /** Ohne Gegenimpuls endete die Linse mit einem harten Sprung zurueck auf Neutral. */
  it('kehrt beim Kollaps in einen auswaerts laufenden Ring um', () => {
    const collapse = resolveBlackHoleDistortion(930, 1000);
    expect(collapse.profile).toBe('ring');
    expect(collapse.strength).toBeGreaterThan(0);
    expect(collapse.radiusScale).toBeGreaterThan(0.65);
  });

  it('laesst den Gegenimpuls nach aussen wachsen', () => {
    const early = resolveBlackHoleDistortion(870, 1000);
    const late = resolveBlackHoleDistortion(980, 1000);
    expect(late.radiusScale).toBeGreaterThan(early.radiusScale);
  });

  it('endet sauber und meldet sich als beendet', () => {
    const done = resolveBlackHoleDistortion(1000, 1000);
    expect(done.finished).toBe(true);
    expect(done.strength).toBe(0);
    expect(resolveBlackHoleDistortion(5000, 1000).finished).toBe(true);
    expect(resolveBlackHoleDistortion(10, 0).finished).toBe(true);
  });
});
