import type * as Phaser from 'phaser';

/**
 * Alle Displayobjekte der Szene, eine Ebene tief in `Layer`-Kinder hinein.
 *
 * Diagnose und Ablationsmodus lesen die Anzeigeliste direkt. Seit der Felsbestand in einer eigenen
 * `Layer` liegt – damit die Szenenliste kurz bleibt und `scene.add.*`/`destroy()` nicht linear
 * ueber zehntausende Eintraege suchen – waeren die Felsen fuer beide sonst unsichtbar: Der
 * Ablationsmodus koennte seine `rocks`-Kategorie nicht mehr ausblenden, und die Objektzaehlung
 * meldete eine Szene ohne Welt.
 *
 * Bewusst genau eine Ebene tief und nur fuer `Layer`: `Container`-Kinder waren fuer diese Scans
 * noch nie sichtbar, und ein rekursiver Abstieg wuerde die Kosten der Diagnose an die
 * Verschachtelungstiefe der HUD-Baeume haengen.
 */
export function forEachSceneDisplayObject(
  scene: Phaser.Scene,
  visit: (object: Phaser.GameObjects.GameObject) => void,
): void {
  for (const child of scene.children.list) {
    visit(child);
    const nested = (child as Phaser.GameObjects.GameObject & { type?: string; list?: Phaser.GameObjects.GameObject[] });
    if (nested.type !== 'Layer' || !Array.isArray(nested.list)) continue;
    for (const grandChild of nested.list) visit(grandChild);
  }
}

/**
 * Ablationsscan mit Container-Unterstützung.
 *
 * Der allgemeine Diagnose-/Count-Scan bleibt bewusst flach, damit seine Kosten nicht von der
 * Verschachtelungstiefe der HUD-Bäume abhängen. Die Ablation braucht dagegen auch Graphics- und
 * Arc-Kinder in Containern. Dieser separate Scan läuft für jedes Ablationssegment inklusive
 * Baseline, damit die zusätzliche Traversierung aus dem Baseline-Vergleich herausfällt.
 */
export function forEachAblationDisplayObject(
  scene: Phaser.Scene,
  visit: (object: Phaser.GameObjects.GameObject) => void,
): void {
  const visitNested = (object: Phaser.GameObjects.GameObject): void => {
    visit(object);
    const nested = object as Phaser.GameObjects.GameObject & {
      type?: string;
      list?: Phaser.GameObjects.GameObject[];
    };
    if ((nested.type !== 'Layer' && nested.type !== 'Container') || !Array.isArray(nested.list)) return;
    for (const child of nested.list) visitNested(child);
  };

  for (const child of scene.children.list) visitNested(child);
}

/** Wie {@link forEachSceneDisplayObject}, aber als zaehlbare Gesamtzahl. */
export function countSceneDisplayObjects(scene: Phaser.Scene): number {
  let count = scene.children.list.length;
  for (const child of scene.children.list) {
    const nested = child as Phaser.GameObjects.GameObject & { type?: string; list?: Phaser.GameObjects.GameObject[] };
    if (nested.type === 'Layer' && Array.isArray(nested.list)) count += nested.list.length;
  }
  return count;
}
