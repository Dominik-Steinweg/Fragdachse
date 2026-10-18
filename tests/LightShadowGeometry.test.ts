import { describe, expect, it } from 'vitest';
import {
  ALL_EDGES_EXPOSED,
  EDGE_BOTTOM,
  EDGE_LEFT,
  EDGE_RIGHT,
  EDGE_TOP,
  ShadowQuadBuffer,
  SHADOW_QUAD_STRIDE,
  projectCircleShadowQuad,
  projectRectBackShadowQuads,
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
const RIM = 8;

describe('projectRectShadowQuads', () => {
  it('verschattet ab der beleuchteten Kante nach hinten', () => {
    const buffer = new ShadowQuadBuffer();
    // Licht links: die linke Kante ist zugewandt.
    projectRectShadowQuads(buffer, 0, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, RIM, 400);

    expect(buffer.length).toBe(1);
    // Die Oberseite hinter dem Verlauf liegt im Schatten …
    expect(isInsideAnyQuad(buffer, ROCK.left + RIM + 4, 100)).toBe(true);
    // … ebenso der Boden hinter dem Felsen.
    expect(isInsideAnyQuad(buffer, 200, 100)).toBe(true);
    // Vor dem Felsen bleibt es hell.
    expect(isInsideAnyQuad(buffer, 50, 100)).toBe(false);
  });

  it('setzt Verlaufs- und Vollschattenzone lückenlos aneinander', () => {
    const falloffPx = 14;
    const band = new ShadowQuadBuffer();
    const core = new ShadowQuadBuffer();
    // Diagonales Licht, damit die Ecken nicht zufällig zusammenfallen.
    projectRectShadowQuads(band, 10, 20, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, 0, falloffPx);
    projectRectShadowQuads(core, 10, 20, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, falloffPx, 400);

    expect(band.length).toBe(core.length);
    for (let quad = 0; quad < band.length; quad += 1) {
      const offset = quad * SHADOW_QUAD_STRIDE;
      // Streifenende (Punkte 2/3) trifft exakt den Beginn des Vollschattens (0/1).
      expect(band.data[offset + 6]).toBeCloseTo(core.data[offset], 9);
      expect(band.data[offset + 7]).toBeCloseTo(core.data[offset + 1], 9);
      expect(band.data[offset + 4]).toBeCloseTo(core.data[offset + 2], 9);
      expect(band.data[offset + 5]).toBeCloseTo(core.data[offset + 3], 9);
    }
  });

  it('verschiebt den seitlichen Schattenrand nicht, egal wie lang der Verlauf ist', () => {
    // Regression: ein Versatz des Startpunkts entlang des Lichtstrahls darf die
    // Silhouette nicht verschieben – sonst beginnen die Schatten neben dem Fels falsch.
    const light = { x: 0, y: 100 };
    const short = new ShadowQuadBuffer();
    const long = new ShadowQuadBuffer();
    projectRectShadowQuads(short, light.x, light.y, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, 0, 900);
    projectRectShadowQuads(long, light.x, light.y, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, 40, 900);

    // Weit hinten je ein Punkt knapp innerhalb und knapp außerhalb des Silhouettenstrahls.
    const rayToCorner = (cx: number, cy: number, t: number) => ({
      x: light.x + (cx - light.x) * t,
      y: light.y + (cy - light.y) * t,
    });
    const insideEdge = rayToCorner(ROCK.left, ROCK.top, 4);
    for (const [dy, expected] of [[6, true], [-6, false]] as const) {
      expect(isInsideAnyQuad(short, insideEdge.x, insideEdge.y + dy)).toBe(expected);
      expect(isInsideAnyQuad(long, insideEdge.x, insideEdge.y + dy)).toBe(expected);
    }
  });

  it('nutzt bei diagonalem Licht beide zugewandten Kanten', () => {
    const buffer = new ShadowQuadBuffer();
    // Licht oben links: linke und obere Kante sind zugewandt.
    projectRectShadowQuads(buffer, 0, 0, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, RIM, 600);

    expect(buffer.length).toBe(2);
    expect(isInsideAnyQuad(buffer, 300, 300)).toBe(true);
    expect(isInsideAnyQuad(buffer, 40, 40)).toBe(false);
  });

  it('überspringt Kanten zu belegten Nachbarzellen, damit ein Block keine Binnenschatten wirft', () => {
    // Rechte Zelle eines waagerechten Zweierblocks: ihre linke Kante grenzt an den
    // Nachbarfelsen und existiert im 47-Blob gar nicht.
    const buffer = new ShadowQuadBuffer();
    const exposed = ALL_EDGES_EXPOSED & ~EDGE_LEFT;
    projectRectShadowQuads(buffer, 0, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, RIM, 400, exposed);

    expect(buffer.length).toBe(0);
  });

  it('wirft weiterhin an den Außenkanten des Blocks', () => {
    // Linke Zelle desselben Blocks: ihre linke Kante ist die Außenkante.
    const buffer = new ShadowQuadBuffer();
    const exposed = ALL_EDGES_EXPOSED & ~EDGE_RIGHT;
    projectRectShadowQuads(buffer, 0, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, RIM, 400, exposed);

    expect(buffer.length).toBe(1);
    expect(isInsideAnyQuad(buffer, 300, 100)).toBe(true);
  });

  it('lässt eine Zelle im Blockinneren komplett aus', () => {
    const buffer = new ShadowQuadBuffer();
    projectRectShadowQuads(buffer, 0, 0, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, RIM, 600, 0);

    expect(buffer.length).toBe(0);
  });

  it('berücksichtigt beim diagonalen Licht nur die freiliegende der beiden Kanten', () => {
    const buffer = new ShadowQuadBuffer();
    // Oberkante verdeckt durch einen Nachbarn darüber, linke Kante frei.
    const exposed = ALL_EDGES_EXPOSED & ~EDGE_TOP;
    projectRectShadowQuads(buffer, 0, 0, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, RIM, 600, exposed);

    expect(buffer.length).toBe(1);
  });

  it('erzeugt kein Quad, wenn das Licht in der Zelle steckt', () => {
    const buffer = new ShadowQuadBuffer();
    projectRectShadowQuads(buffer, 100, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, RIM, 400);

    expect(buffer.length).toBe(0);
  });

  it('sammelt mehrere Hindernisse im selben Puffer und lässt sich zurücksetzen', () => {
    const buffer = new ShadowQuadBuffer(1);
    projectRectShadowQuads(buffer, 0, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, RIM, 400);
    projectRectShadowQuads(buffer, 0, 100, 200, 84, 232, 116, RIM, 400);
    expect(buffer.length).toBe(2);

    buffer.reset();
    expect(buffer.length).toBe(0);
  });

  it('beginnt der Verlauf ohne Startversatz exakt an der beleuchteten Kante', () => {
    const buffer = new ShadowQuadBuffer();
    projectRectShadowQuads(buffer, 0, 100, ROCK.left, ROCK.top, ROCK.right, ROCK.bottom, 0, 14);

    // Die beiden ersten Punkte des Quads liegen auf der Kante selbst.
    expect(buffer.data[0]).toBeCloseTo(ROCK.left, 9);
    expect(buffer.data[2]).toBeCloseTo(ROCK.left, 9);
  });
});

describe('projectCircleShadowQuad', () => {
  it('verschattet den Bereich hinter einem Baumstamm', () => {
    const buffer = new ShadowQuadBuffer();
    projectCircleShadowQuad(buffer, 0, 100, 100, 100, 12, RIM, 400);

    expect(buffer.length).toBe(1);
    expect(isInsideAnyQuad(buffer, 200, 100)).toBe(true);
    expect(isInsideAnyQuad(buffer, 50, 100)).toBe(false);
  });

  it('erzeugt kein Quad, wenn das Licht innerhalb des Kreises liegt', () => {
    const buffer = new ShadowQuadBuffer();
    projectCircleShadowQuad(buffer, 100, 100, 100, 100, 12, RIM, 400);

    expect(buffer.length).toBe(0);
  });
});

describe('Kantenmasken', () => {
  it('deckt alle vier Richtungen ab', () => {
    expect(EDGE_TOP | EDGE_BOTTOM | EDGE_LEFT | EDGE_RIGHT).toBe(ALL_EDGES_EXPOSED);
  });
});

describe('Felsfront-Eindringtiefe (Nachtsicht N-4)', () => {
  const CELL = { left: 0, top: 0, right: 32, bottom: 32 };
  const REACH = 40;
  const lights = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => [dx, dy]))
    .filter(([dx, dy]) => dx !== 0 || dy !== 0)
    .map(([dx, dy]) => ({ x: 16 + dx * 150, y: 16 + dy * 150 }));
  const inside = (x: number, y: number): boolean => x >= CELL.left && x <= CELL.right && y >= CELL.top && y <= CELL.bottom;

  function project(light: { x: number; y: number }) {
    const legacy = new ShadowQuadBuffer(), core = new ShadowQuadBuffer();
    projectRectShadowQuads(legacy, light.x, light.y, CELL.left, CELL.top, CELL.right, CELL.bottom, 0, 600);
    projectRectShadowQuads(core, light.x, light.y, CELL.left, CELL.top, CELL.right, CELL.bottom, REACH, 600);
    projectRectBackShadowQuads(core, light.x, light.y, CELL.left, CELL.top, CELL.right, CELL.bottom, 0, 600);
    return { legacy, core };
  }

  it('lässt hinter einem einzelligen Fels aus keiner Richtung Licht durch', () => {
    for (const light of lights) {
      const { legacy, core } = project(light);
      for (let x = -120; x <= 152; x += 4) for (let y = -120; y <= 152; y += 4) {
        if (inside(x, y) || Math.hypot(x - light.x, y - light.y) > 400) continue;
        // Außerhalb des Hindernisses bleibt der Schlagschatten exakt der bisherige.
        expect(isInsideAnyQuad(core, x, y), `${light.x},${light.y} @ ${x},${y}`).toBe(isInsideAnyQuad(legacy, x, y));
      }
    }
  });

  it('hält die Felsfront innerhalb der Eindringtiefe frei vom Kernschatten', () => {
    // Licht links: die Front liegt bei x = 0, der Kern beginnt erst nach REACH.
    const { core } = project({ x: -150, y: 16 });
    expect(isInsideAnyQuad(core, 4, 16)).toBe(false);
    expect(isInsideAnyQuad(core, 28, 16)).toBe(false);
    // Hinter der abgewandten Kante beginnt der Schatten sofort.
    expect(isInsideAnyQuad(core, 36, 16)).toBe(true);
  });

  it('wirft hinter verdeckten Innenkanten eines Verbunds keinen Schatten', () => {
    const buffer = new ShadowQuadBuffer();
    projectRectBackShadowQuads(buffer, -150, 16, CELL.left, CELL.top, CELL.right, CELL.bottom, 0, 600, EDGE_LEFT);
    expect(buffer.length).toBe(0);
  });
});
