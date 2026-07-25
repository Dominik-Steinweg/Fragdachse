import * as Phaser from 'phaser';
import { getTextResolution } from './RenderResolution';

/**
 * `Text` rastert seine Glyphen in eine eigene Canvas und zeigt sie als Textur. Die Rasterung
 * geschieht in Designpixeln, unabhängig davon, wie groß das Bild am Ende ausgegeben wird.
 * Rendert das Spiel oberhalb der Designauflösung (siehe `RenderResolution`), wird diese
 * Textur hochskaliert und der Text wirkt weich – sichtbar vor allem bei den kleinen
 * Monospace-Labels der Seitenpanels.
 *
 * `Text.setResolution()` behebt genau das: die interne Canvas wächst um den Faktor, die
 * dargestellte Größe im Designraum bleibt gleich.
 *
 * Umgesetzt als Wrapper um `scene.add.text` statt an 119 Aufrufstellen – dasselbe Muster, mit
 * dem `GraphicsQualityController` bereits `scene.add.particles` überlagert. Ein explizit in
 * der Textstyle übergebenes `resolution` gewinnt und bleibt unangetastet.
 */
export function installTextResolution(scene: Phaser.Scene): () => void {
  const factory = scene.add.text.bind(scene.add);

  scene.add.text = ((
    x: number,
    y: number,
    text: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle,
  ) => {
    const created = factory(x, y, text, style);
    if (style?.resolution === undefined) {
      created.setResolution(getTextResolution(scene.scale));
    }
    return created;
  }) as Phaser.GameObjects.GameObjectFactory['text'];

  // Fullscreen-Wechsel und Fenstergrößen ändern die Renderauflösung mitten im Betrieb.
  // Bereits bestehende Texte müssen dann neu rastern, sonst bleiben Lobby und HUD auf der
  // Auflösung stehen, die beim Aufbau galt.
  const onResize = (): void => applyTextResolution(scene);
  scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);

  return () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    scene.add.text = factory as Phaser.GameObjects.GameObjectFactory['text'];
  };
}

function applyTextResolution(scene: Phaser.Scene): void {
  const resolution = getTextResolution(scene.scale);
  forEachText(scene.children.list, (text) => {
    if (text.style.resolution === resolution) return;
    text.setResolution(resolution);
  });
}

/** Läuft die Anzeigeliste ab und steigt dabei in Container und Layer hinab. */
function forEachText(
  objects: readonly Phaser.GameObjects.GameObject[],
  apply: (text: Phaser.GameObjects.Text) => void,
): void {
  for (const object of objects) {
    if (object instanceof Phaser.GameObjects.Text) apply(object);
    else if (object instanceof Phaser.GameObjects.Container) forEachText(object.list, apply);
    else if (object instanceof Phaser.GameObjects.Layer) forEachText(object.list, apply);
  }
}
