import { describe, expect, it } from 'vitest';
import {
  ShadowQuadBuffer,
  SHADOW_QUAD_STRIDE,
  projectCircleShadowQuad,
  projectRectShadowQuads,
} from '../src/effects/lightShadowGeometry';

interface Point { x: number; y: number }

function quadPoints(buffer: ShadowQuadBuffer, index: number): Point[] {
  const offset = index * SHADOW_QUAD_STRIDE;
  return [0, 1, 2, 3].map((corner) => ({
    x: buffer.data[offset + corner * 2],
    y: buffer.data[offset + corner * 2 + 1],
  }));
}

/** Ein Punkt liegt im Schatten, wenn er in einem der Quads liegt (konvex, beliebige Ordnung). */
function isInsideAnyQuad(buffer: ShadowQuadBuffer, x: number, y: number): boolean {
  for (let index = 0; index < buffer.length; index += 1) {
    const points = quadPoints(buffer, index);
    let positive = false;
    let negative = false;
    for (let corner = 0; corner < 4; corner += 1) {
      const a = points[corner];
      const b = points[(corner + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (cross > 1e-9) positive = true;
      if (cross < -1e-9) negative = true;
    }
    if (!(positive && negative)) return true;
  }
  return false;
}

// Ein 32×32-Felsen um (100, 100) – dieselbe Größe wie eine Arena-Zelle.
const ROCK = { left: 84, top: 84, right: 116, bottom: 116 };

describe('projectRectShadowQuads', () => {
  it('wirft den Schatten vom Licht weg und lässt die zugewandte Seite frei', () => {
    const buffer = new ShadowQuadBuffer();
    // Licht links vom Felsen: nur die rechte Kante ist abgewandt.
    projectRectShadowQuads(buffer, 0, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, 400);

    // Ober-, Unter- und rechte Kante sind abgewandt; zusammen ergeben sie den Schatten.
    expect(buffer.length).toBe(3);
    // Hinter dem Felsen ist es dunkel …
    expect(isInsideAnyQuad(buffer, 200, 100)).toBe(true);
    // … davor nicht.
    expect(isInsideAnyQuad(buffer, 50, 100)).toBe(false);
    // Seitlich versetzt liegt der Punkt außerhalb des Schattenkegels.
    expect(isInsideAnyQuad(buffer, 130, 300)).toBe(false);
  });

  it('wählt bei diagonalem Licht beide abgewandten Kanten', () => {
    const buffer = new ShadowQuadBuffer();
    // Licht oben links: rechte und untere Kante sind abgewandt.
    projectRectShadowQuads(buffer, 0, 0, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, 600);

    expect(buffer.length).toBe(2);
    expect(isInsideAnyQuad(buffer, 300, 300)).toBe(true);
    expect(isInsideAnyQuad(buffer, 40, 40)).toBe(false);
  });

  it('erzeugt kein Quad, wenn das Licht im Hindernis steckt', () => {
    const buffer = new ShadowQuadBuffer();
    projectRectShadowQuads(buffer, 100, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, 400);

    expect(buffer.length).toBe(0);
  });

  it('sammelt mehrere Hindernisse im selben Puffer und lässt sich zurücksetzen', () => {
    const buffer = new ShadowQuadBuffer(1);
    projectRectShadowQuads(buffer, 0, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, 400);
    projectRectShadowQuads(buffer, 0, 100, 200, 84, 232, 116, 400);
    expect(buffer.length).toBe(6);

    buffer.reset();
    expect(buffer.length).toBe(0);
  });
});

describe('projectCircleShadowQuad', () => {
  it('verschattet den Bereich hinter einem Baumstamm', () => {
    const buffer = new ShadowQuadBuffer();
    projectCircleShadowQuad(buffer, 0, 100, 100, 100, 12, 400);

    expect(buffer.length).toBe(1);
    expect(isInsideAnyQuad(buffer, 200, 100)).toBe(true);
    expect(isInsideAnyQuad(buffer, 50, 100)).toBe(false);
  });

  it('erzeugt kein Quad, wenn das Licht innerhalb des Kreises liegt', () => {
    const buffer = new ShadowQuadBuffer();
    projectCircleShadowQuad(buffer, 100, 100, 100, 100, 12, 400);

    expect(buffer.length).toBe(0);
  });
});
