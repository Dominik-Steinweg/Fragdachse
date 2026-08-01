import { describe, expect, it } from 'vitest';
import {
  assignToClarity,
  assignToWorld,
  type CameraIdPair,
  clearAssignment,
  isSingleAssigned,
  rendersOnCamera,
} from '../src/scenes/arena/clarityCameraAssignment';

// Phaser vergibt Kamera-Kennungen als Bitmaske: 1, 2, 4, …
const IDS: CameraIdPair = { worldId: 1, clarityId: 2 };

function target(cameraFilter = 0) {
  return { cameraFilter };
}

describe('clarityCameraAssignment', () => {
  /**
   * Der Standardwert 0 bedeutet in Phaser "auf allen Kameras sichtbar". Mit zwei Kameras waere
   * das doppeltes Zeichnen – doppeltes Alpha, doppelte Partikel. Deshalb muss jedes Objekt
   * aktiv zugeordnet werden.
   */
  it('rendert ein unzugeordnetes Objekt auf beiden Kameras', () => {
    const object = target();
    expect(rendersOnCamera(object, IDS.worldId)).toBe(true);
    expect(rendersOnCamera(object, IDS.clarityId)).toBe(true);
    expect(isSingleAssigned(object, IDS)).toBe(false);
  });

  it('ordnet Weltinhalt genau der Weltkamera zu', () => {
    const object = target();
    assignToWorld(object, IDS);
    expect(rendersOnCamera(object, IDS.worldId)).toBe(true);
    expect(rendersOnCamera(object, IDS.clarityId)).toBe(false);
    expect(isSingleAssigned(object, IDS)).toBe(true);
  });

  it('ordnet HUD genau der Klarheitskamera zu', () => {
    const object = target();
    assignToClarity(object, IDS);
    expect(rendersOnCamera(object, IDS.clarityId)).toBe(true);
    expect(rendersOnCamera(object, IDS.worldId)).toBe(false);
    expect(isSingleAssigned(object, IDS)).toBe(true);
  });

  /** Overlays bauen ihren Wurzelcontainer beim Oeffnen neu auf und befoerdern erneut. */
  it('ist idempotent und umkehrbar', () => {
    const object = target();
    assignToWorld(object, IDS);
    assignToClarity(object, IDS);
    assignToClarity(object, IDS);
    expect(isSingleAssigned(object, IDS)).toBe(true);
    expect(rendersOnCamera(object, IDS.clarityId)).toBe(true);

    assignToWorld(object, IDS);
    expect(rendersOnCamera(object, IDS.worldId)).toBe(true);
    expect(rendersOnCamera(object, IDS.clarityId)).toBe(false);
  });

  it('laesst Bits fremder Kameras unangetastet', () => {
    const foreignId = 4;
    const object = target(foreignId);
    assignToClarity(object, IDS);
    expect(object.cameraFilter & foreignId).toBe(foreignId);
    expect(rendersOnCamera(object, foreignId)).toBe(false);
    expect(rendersOnCamera(object, IDS.clarityId)).toBe(true);
  });

  /**
   * Regressionstest fuer einen echten Fehler: Objekte entstehen hier durchweg ueber
   * `scene.add.*` und wandern **danach** in ihren Container. Sie durchlaufen die Anzeigeliste
   * also einmal und bekommen dabei die Weltzuordnung aufgestempelt. Blieb die stehen,
   * uebersprang `ContainerWebGLRenderer` beim Zeichnen jedes einzelne Kind gegen die
   * Klarheitskamera – das gesamte Lobby-Menue blieb leer.
   */
  it('macht ein weltzugeordnetes Objekt wieder sichtbar, sobald es Container-Kind wird', () => {
    const child = target();
    assignToWorld(child, IDS);                       // ueber die Anzeigeliste gestempelt
    expect(rendersOnCamera(child, IDS.clarityId)).toBe(false);

    clearAssignment(child);                          // wandert in einen Container
    expect(child.cameraFilter).toBe(0);
    expect(rendersOnCamera(child, IDS.clarityId)).toBe(true);
    expect(rendersOnCamera(child, IDS.worldId)).toBe(true);
  });

  /**
   * Container-Kinder werden nie einzeln zugeordnet: Phaser prueft beim Zeichnen und beim
   * Eingabe-Treffertest die Maske des Elternteils. Die Beförderung des Containers deckt sie
   * deshalb mit ab, auch spaeter hinzugefuegte.
   */
  it('erfasst Container-Kinder ueber den Elternteil', () => {
    const container = target();
    assignToClarity(container, IDS);
    const lateChild = target();
    clearAssignment(lateChild);
    expect(container.cameraFilter & IDS.worldId).toBe(IDS.worldId);
    expect(lateChild.cameraFilter).toBe(0);
    // Massgeblich ist allein der Container.
    expect(rendersOnCamera(container, IDS.worldId)).toBe(false);
    expect(rendersOnCamera(container, IDS.clarityId)).toBe(true);
  });

  /** Wird ein Kind aus dem Container geloest, landet es erneut auf der Anzeigeliste. */
  it('stellt die Standardzuordnung wieder her, wenn ein Kind den Container verlaesst', () => {
    const object = target();
    clearAssignment(object);
    assignToWorld(object, IDS);
    expect(isSingleAssigned(object, IDS)).toBe(true);
    expect(rendersOnCamera(object, IDS.worldId)).toBe(true);
  });
});
