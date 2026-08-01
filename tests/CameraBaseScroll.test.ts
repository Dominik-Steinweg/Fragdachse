import { describe, expect, it } from 'vitest';
import {
  getCameraBaseScroll,
  getUnshakenPointerWorldPoint,
  setCameraBaseScroll,
} from '../src/graphics/cameraBaseScroll';

/**
 * Kamera-Attrappe mit derselben affinen Abbildung, die Phaser bei `origin = (0, 0)` und ohne
 * Rotation verwendet: `world = screen / zoom + scroll`.
 */
function makeScene(zoom = 1) {
  const camera = {
    scrollX: 0,
    scrollY: 0,
    zoom,
    getWorldPoint(x: number, y: number) {
      return { x: x / this.zoom + this.scrollX, y: y / this.zoom + this.scrollY };
    },
  };
  return { scene: { cameras: { main: camera } } as never, camera };
}

const pointer = { x: 640, y: 360 } as never;

describe('cameraBaseScroll', () => {
  it('liefert ohne hinterlegte Basis den unveraenderten Weltpunkt', () => {
    const { scene, camera } = makeScene();
    camera.scrollX = 200;
    const point = getUnshakenPointerWorldPoint(scene, pointer);
    expect(point.x).toBe(840);
  });

  /**
   * Der Kern des Vertrags: der visuelle Kamera-Versatz darf die Zielerfassung nicht verschieben.
   * Ohne diese Korrektur wanderte bei jedem Rumpeln der Weltpunkt unter dem Zeiger mit – aus
   * einem reinen Bildeffekt wuerde eine Gameplay-Aenderung.
   */
  it('rechnet den Kamera-Versatz aus der Zeigerumrechnung heraus', () => {
    const { scene, camera } = makeScene();

    camera.scrollX = 200;
    camera.scrollY = 0;
    setCameraBaseScroll(scene, 200, 0);
    const unshaken = getUnshakenPointerWorldPoint(scene, pointer);

    // Feedback traegt seinen Versatz auf die Kamera auf.
    camera.scrollX = 200 + 37.5;
    camera.scrollY = -12.25;
    const shaken = getUnshakenPointerWorldPoint(scene, pointer);

    expect(shaken.x).toBeCloseTo(unshaken.x, 10);
    expect(shaken.y).toBeCloseTo(unshaken.y, 10);
  });

  it('bleibt bei erhoehter Renderaufloesung exakt', () => {
    const { scene, camera } = makeScene(2);

    camera.scrollX = 120;
    setCameraBaseScroll(scene, 120, 0);
    const unshaken = getUnshakenPointerWorldPoint(scene, pointer);

    camera.scrollX = 120 - 44;
    camera.scrollY = 31;
    const shaken = getUnshakenPointerWorldPoint(scene, pointer);

    expect(shaken.x).toBeCloseTo(unshaken.x, 10);
    expect(shaken.y).toBeCloseTo(unshaken.y, 10);
  });

  it('haelt die Basis pro Szene getrennt und aktualisiert sie an Ort und Stelle', () => {
    const a = makeScene();
    const b = makeScene();

    setCameraBaseScroll(a.scene, 10, 20);
    setCameraBaseScroll(b.scene, 30, 40);
    expect(getCameraBaseScroll(a.scene)).toEqual({ x: 10, y: 20 });
    expect(getCameraBaseScroll(b.scene)).toEqual({ x: 30, y: 40 });

    setCameraBaseScroll(a.scene, 11, 21);
    expect(getCameraBaseScroll(a.scene)).toEqual({ x: 11, y: 21 });
    expect(getCameraBaseScroll(b.scene)).toEqual({ x: 30, y: 40 });
  });
});
