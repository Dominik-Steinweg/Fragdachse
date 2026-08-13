# Getragene Item-Sprites

Der Authoring-Pfad besteht aus zwei synchron zu haltenden Einträgen:

1. Pixelkarte und PNG-Ausgabe in scripts/generate-held-item-sprites.mjs, Liste ITEMS.
2. Griff-/Texture-Metadaten in src/loadout/HeldItemVisuals.ts, Registry HELD_ITEM_SPRITES.

Nach Änderungen npm run sprites:held ausführen. Die Loadout-ID bleibt der gemeinsame Schlüssel; Varianten können den Sprite ihrer Basis erben.

## Dauerhafte Regeln

- Die Pixelkarte zeigt nach Norden; die Figur übernimmt Rotation und Physik.
- Items verwenden das Pixelraster der 32-px-Figur und werden über den Griffpunkt am Figurenanker positioniert.
- Der Griffpunkt muss in Generator und Registry identisch sein. Die kanonische Laufzeitberechnung bleibt in src/config.ts.
- Die Mündung darf nicht vor dem gemeinsamen MUZZLE_FORWARD_OFFSET liegen; Positionen für Projektil, Hitscan, Audio und Mündungsfeuer nicht separat erfinden.
- Ein fehlender Eintrag nutzt die vorhandenen generischen Gun-/Throwable-Fallbacks, sofern das Item nicht ausdrücklich slotless ist.

Prüfung: npm run sprites:held und npm test -- tests/HeldItemVisuals.test.ts.
## Verbindlicher Mündungs-Vertrag

Die Spezifikation enthält neben dem Griffpunkt auch `muzzleX`/`muzzleY` auf der Pixelkarte.
`getHeldWeaponMuzzleOrigin` transformiert diesen Punkt mit derselben Rotation und Skalierung wie
das sichtbare `HeldItemVisual`. Gameplay darf den alten autoritativen Ursprung behalten; nur
Mündungsfeuer, Projektil-/Beam-Start und räumliches Schuss-Audio verwenden den visuellen Punkt.

Lange Waffen dürfen bis zu 32 Pixel hoch sein. Die frühere Bindung an die halbe Spielerhöhe und
an `MUZZLE_FORWARD_OFFSET` ist keine gültige Sprite-Regel mehr.
