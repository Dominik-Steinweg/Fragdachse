# Held-Item-Sprites

## Geltungsbereich

Getragene Items sind Presentation einer replizierten Loadout- oder Slot-Entscheidung. Der Slot ist Gameplay-Zustand; Textur, Griffpunkt und sichtbare Mündung sind visuelle Daten. Die Darstellung darf keine Schuss-, Treffer- oder Ressourcenentscheidung autorisieren.

## Authoring-Vertrag

[src/loadout/HeldItemVisuals.ts](../../src/loadout/HeldItemVisuals.ts) ist die zentrale Zuordnung von Loadout-Item-ID zu HeldItemSpriteSpec. [scripts/generate-held-item-sprites.mjs](../../scripts/generate-held-item-sprites.mjs) erzeugt die Pixel-Assets und hält die Pixelkarten.

Für ein neues sichtbares Item gelten diese Invarianten:

- Die Textur nutzt das 32-px-Referenzraster der getragenen Items; ihre Anzeigeskalierung wird aus der Figur abgeleitet.
- Die Textur zeigt nach Norden. Die Figur liefert Rotation und Pose.
- Grip- und Muzzle-Punkte liegen in Texturkoordinaten und werden mit derselben Transformation wie das Bild in den World Space übertragen.
- Das Asset wird über die zentrale ID-Zuordnung geladen; keine zweite Renderer-eigene Item-Tabelle anlegen.
- Slotlose Item-Arten liefern bewusst kein Bild. Unbekannte IDs liefern keinen erfundenen Fallback.

Generische Fallbacks für bekannte, bildfähige Gattungen sind ein Darstellungsvertrag der zentralen Zuordnung. Sie ersetzen keine fehlende authored ID und dürfen unbekannte Datenfehler nicht verdecken.

## Laufzeit

[HeldItemVisual.ts](../../src/entities/HeldItemVisual.ts) hält pro Figur ein eigenständiges Image. Ein Waffenwechsel tauscht die Textur und erzeugt kein neues Game Object pro Wechsel. Das Bild entsteht lazy beim ersten sichtbaren Item, wird mit der Figur synchronisiert und beim Teardown zerstört.

Das Image bleibt bewusst außerhalb des Player-Sprites. PlayerBody beziehungsweise die Player-Runtime ist die kanonische Quelle für Position, Ausrichtung, Bounds, Physik und Collision-/Hit-Geometrie; PlayerEntity kapselt die optionale Presentation. Der Held-Item-Renderer kann eigene Clarity-, Depth- oder Scroll-Regeln erhalten, ohne die Runtime oder ihre Geometrie an ein Sprite zu binden.

Die zentrale Asset-Preload-Funktion lädt jede verwendete Textur höchstens einmal. Ist ein Asset beim Setzen noch nicht resident, darf der nächste Sync-Versuch die Zuordnung erneut anbieten, statt ein dauerhaft leeres Item zu merken.

## Mündung und Gameplay

Die visuelle Mündung wird aus Bildpose, Grip und Muzzle-Punkt berechnet. Eine Gameplay-Mündung erhält dagegen Ursprung und Winkel aus dem konkreten Fire-Request und darf nicht von einer lokalen Renderpose abhängen. Beide Pfade dürfen dieselbe Geometrie-Hilfe verwenden, aber nicht ihre Autorität vermischen.

## Änderungen prüfen

Bei einer Änderung an Pixelkarte, Grip, Muzzle, Mapping oder Lazy-Lifetime den passenden Test [HeldItemVisuals.test.ts](../../tests/HeldItemVisuals.test.ts) und die vorhandenen Loadout-/Fire-Tests prüfen. Die Art-Direction-Regeln stehen in [visual-guidelines.md](visual-guidelines.md).
