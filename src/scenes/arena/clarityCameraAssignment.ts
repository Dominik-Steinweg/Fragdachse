/**
 * Bitmasken-Logik der Welt-/Klarheitstrennung. Ohne Phaser-Import, damit die Zuordnung
 * deterministisch prüfbar bleibt.
 *
 * Phaser führt die Ausschlussliste pro Objekt als Bitmaske `cameraFilter`. `camera.ignore(obj)`
 * setzt darin das Bit der Kamera; `willRender` blendet das Objekt genau dann aus. Ein Wert von 0
 * bedeutet **auf allen Kameras sichtbar** – mit zwei Kameras also doppelt gezeichnet. Der
 * Standard muss deshalb aktiv gesetzt werden, nicht passiv gelten.
 *
 * `camera.ignore()` wird bewusst nicht verwendet: bei Containern rekursiert es über die
 * **aktuellen** Kinder und verfehlt alles später Hinzugefügte. Container-Kinder rendern ohnehin
 * über ihren Elternteil, dessen eigenes `cameraFilter` das Tor ist – deshalb wird die Maske hier
 * direkt gesetzt.
 */

export interface CameraAssignmentTarget {
  cameraFilter: number;
}

export interface CameraIdPair {
  readonly worldId: number;
  readonly clarityId: number;
}

/** Standard: Weltinhalt. Wird von der Klarheitskamera ignoriert. */
export function assignToWorld(target: CameraAssignmentTarget, ids: CameraIdPair): void {
  target.cameraFilter = (target.cameraFilter & ~ids.worldId) | ids.clarityId;
}

/** HUD und Overlays: von der Weltkamera ignoriert, damit keine Post-FX darauf wirken. */
export function assignToClarity(target: CameraAssignmentTarget, ids: CameraIdPair): void {
  target.cameraFilter = (target.cameraFilter & ~ids.clarityId) | ids.worldId;
}

/**
 * Setzt die Maske zurück, sobald ein Objekt die Anzeigeliste verlässt – also sobald es Kind
 * eines Containers wird.
 *
 * Das ist keine Feinheit, sondern der Kern der Zuordnung. Objekte entstehen in diesem Projekt
 * durchweg über `scene.add.*` und wandern **danach** in ihren Container. Sie durchlaufen die
 * Anzeigeliste also einmal und bekommen dabei die Weltzuordnung aufgestempelt. Bliebe die
 * stehen, prüfte `ContainerWebGLRenderer` beim Zeichnen `child.willRender(camera)` gegen die
 * Klarheitskamera und überspränge jedes einzelne Kind – ein befördertes HUD-Panel bliebe leer.
 *
 * Als Kind ist die eigene Maske bedeutungslos: das Tor ist der Elternteil. Genau deshalb ist
 * `0` hier der richtige Wert. Wird das Kind später wieder aus dem Container gelöst, landet es
 * erneut auf der Anzeigeliste und bekommt die Standardzuordnung zurück.
 */
export function clearAssignment(target: CameraAssignmentTarget): void {
  target.cameraFilter = 0;
}

export function rendersOnCamera(target: CameraAssignmentTarget, cameraId: number): boolean {
  return (target.cameraFilter & cameraId) === 0;
}

/**
 * Ein Objekt darf nie auf beiden Kameras liegen – das wäre doppeltes Zeichnen mit doppeltem
 * Alpha und doppelter Partikelzahl. Dient als Zusicherung in Tests und Diagnose.
 */
export function isSingleAssigned(target: CameraAssignmentTarget, ids: CameraIdPair): boolean {
  return rendersOnCamera(target, ids.worldId) !== rendersOnCamera(target, ids.clarityId);
}
