import type * as Phaser from 'phaser';
import {
  assignToClarity,
  assignToWorld,
  type CameraAssignmentTarget,
  type CameraIdPair,
  clearAssignment,
} from './clarityCameraAssignment';

// Aus `Phaser.Scenes.Events`; als Literale gehalten, damit dieses Modul ohne Phaser-Wert-Import
// auskommt.
const ADDED_TO_SCENE_EVENT = 'addedtoscene';
const REMOVED_FROM_SCENE_EVENT = 'removedfromscene';

type SceneEventEmitter = {
  on: (event: string, listener: (object: unknown) => void, context?: unknown) => unknown;
  off: (event: string, listener: (object: unknown) => void, context?: unknown) => unknown;
};

const registries = new WeakMap<Phaser.Scene, ClarityCameraRegistry>();

/**
 * Trennt die Spielwelt von den Elementen, die jederzeit lesbar bleiben müssen.
 *
 * Post-FX werden in Phaser 4 pro Kamera angewendet und erfassen alles, was diese Kamera
 * zeichnet. Ein Color-Grading oder Bloom auf der einzigen Kamera träfe deshalb zwangsläufig
 * auch HUD, Lebensbalken und Overlays. Die Klarheitskamera liegt über der Weltkamera, ist
 * transparent, hat keinen Scroll und trägt niemals Filter.
 *
 * **Zuordnung ist Opt-in.** `install()` erklärt jedes neu hinzugefügte Objekt zu Weltinhalt;
 * nur ausdrücklich beförderte Objekte landen auf der Klarheitskamera. Der Standard muss aktiv
 * gesetzt werden, weil ein unzugeordnetes Objekt sonst auf **beiden** Kameras gezeichnet würde.
 *
 * Bewusst **nicht** befördert werden:
 * - die Lichtkarte und ihre Occluder-Puffer – bildschirmfest, aber Weltdarstellung: das
 *   MULTIPLY muss auf die Welt wirken, und der Bloom soll eine beleuchtete Welt sehen;
 * - das Fadenkreuz, Statusringe und Namensschilder – sie stehen in Weltkoordinaten;
 * - Warnzonen, Telegraphen und Platzierungsvorschauen – sie liegen bewusst unter dem
 *   Blätterdach und würden auf der Klarheitskamera ihre Tiefenbeziehung zur Welt verlieren.
 */
export class ClarityCameraRegistry {
  private readonly ids: CameraIdPair;
  private readonly events: SceneEventEmitter;
  private installed = false;

  private readonly onAddedToScene = (object: unknown): void => {
    assignToWorld(object as CameraAssignmentTarget, this.ids);
  };

  /**
   * Ein Objekt verlässt die Anzeigeliste genau dann, wenn es Kind eines Containers wird
   * (`Container.addHandler` ruft `removeFromDisplayList`). Ab da gilt allein die Maske des
   * Elternteils, die eigene muss zurückgesetzt werden.
   */
  private readonly onRemovedFromScene = (object: unknown): void => {
    clearAssignment(object as CameraAssignmentTarget);
  };

  constructor(
    scene: Phaser.Scene,
    worldCamera: Phaser.Cameras.Scene2D.Camera,
    private readonly clarityCamera: Phaser.Cameras.Scene2D.Camera,
  ) {
    this.ids = { worldId: worldCamera.id, clarityId: clarityCamera.id };
    this.events = (scene as unknown as { events: SceneEventEmitter }).events;
    registries.set(scene, this);
  }

  /**
   * Muss vor dem ersten `scene.add.*` laufen. Alles, was davor auf die Anzeigeliste kommt,
   * bliebe unzugeordnet und würde doppelt gezeichnet.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.events.on(ADDED_TO_SCENE_EVENT, this.onAddedToScene);
    this.events.on(REMOVED_FROM_SCENE_EVENT, this.onRemovedFromScene);
  }

  /**
   * Hebt ein Wurzelobjekt auf die Klarheitskamera. Container decken ihre Kinder mit ab: Phaser
   * prüft beim Zeichnen und beim Eingabe-Treffertest die Maske des Elternteils.
   *
   * Overlays, die ihren Wurzelcontainer beim Öffnen neu aufbauen, rufen das jedes Mal erneut –
   * deshalb ist der Aufruf idempotent und gehört in den Aufbaupfad, nicht in den Konstruktor.
   */
  promote(object: object | null | undefined): void {
    if (!object) return;
    assignToClarity(object as CameraAssignmentTarget, this.ids);
  }

  demote(object: object | null | undefined): void {
    if (!object) return;
    assignToWorld(object as CameraAssignmentTarget, this.ids);
  }

  getClarityCamera(): Phaser.Cameras.Scene2D.Camera {
    return this.clarityCamera;
  }

  destroy(): void {
    if (!this.installed) return;
    this.installed = false;
    this.events.off(ADDED_TO_SCENE_EVENT, this.onAddedToScene);
    this.events.off(REMOVED_FROM_SCENE_EVENT, this.onRemovedFromScene);
  }
}

export function getClarityCameraRegistry(scene: Phaser.Scene): ClarityCameraRegistry | null {
  return registries.get(scene) ?? null;
}

/**
 * Bequemer Aufruf für UI-Klassen, damit sie keine Abhängigkeit auf die Scene-Klasse oder den
 * Registry-Aufbau brauchen. Ohne Registry ein No-op – dieselbe Form wie
 * `getGraphicsQualityController`.
 */
export function promoteToClarityCamera(scene: Phaser.Scene, object: object | null | undefined): void {
  registries.get(scene)?.promote(object);
}
