# Getragene Waffen: neues Symbol anlegen

Kurzanleitung für die Bilder, die die Spielfigur in den Pfoten hält. Die Begründungen hinter den
Regeln stehen in [`visual-guidelines.md`](visual-guidelines.md); hier steht nur der Ablauf.

## Zwei Dateien, zwei Einträge

**1. Pixelkarte** in [`scripts/generate-held-item-sprites.mjs`](../../scripts/generate-held-item-sprites.mjs), Liste `ITEMS`:

```js
{
  file: 'AK47.png',
  grip: { x: 2.5, y: 9 },
  pixels: [
    '.kkk.',
    '.mlm.',
    // … von der Mündung nach hinten
  ],
},
```

**2. Registry-Zeile** in [`src/loadout/HeldItemVisuals.ts`](../../src/loadout/HeldItemVisuals.ts), `HELD_ITEM_SPRITES`:

```ts
AK47: sprite('AK47', 2.5, 9),
```

Der Schlüssel ist die Loadout-Item-ID, `sprite(dateiname, gripX, gripY)`. Griffpunkt in beiden
Dateien identisch halten — das ist die einzige Stelle, an der sich Doppelpflege einschleichen kann.

Dann `npm run sprites:held`. Preload, Texture-Key, Größe und Positionierung ergeben sich von selbst.

## Die vier Regeln

| | |
|---|---|
| **Norden ist vorne** | Zeile 0 der Karte ist die Mündung. Die Rotation kommt komplett von der Figur. |
| **1 Texturpixel = 1 Figurenpixel** | Die Figur ist 32 px. Eine Waffe ist damit 5–6 px breit. Nicht feiner zeichnen. |
| **Griffpunkt liegt auf dem Pfotenanker** | `grip` in Texturpixeln ab linker oberer Ecke. Halbe Pixel sind erlaubt und bei ungerader Breite nötig, um mittig zu zentrieren. |
| **Höchstens 13,4 px vor dem Anker** | `gripY` ist die Reichweite nach vorn. Darüber entsteht der Schuss sichtbar *im* Lauf. Nach hinten und zur Seite gibt es keine Grenze. |

## Palette

| Zeichen | Verwendung |
|---|---|
| `.` | transparent |
| `k` | Kontur, nur an Mündung und Heck |
| `d` | dunkles Metall, Seitenkanten **im Bereich der Figur** |
| `m` | mittleres Metall, Standardkörper |
| `l` | helles Metall, Mittellinie |
| `w` | Spitzlicht, sehr sparsam |
| `o` `O` `e` | Oliv mittel / hell / dunkel |
| `b` | warmes Kennband |

## Gestalten auf fünf Pixeln

- **Randspalten auf `m`, nicht auf `d`.** Alles, was vor dem Kopf über dem Boden liegt, verschwindet
  in Dunkel gegen das Grasgrün. `d` gehört nur dorthin, wo die Waffe auf der Figur aufliegt.
- **Unterscheidung zuerst über Länge und Breite**, dann über eine helle Fläche, zuletzt über Farbe.
  Pistole ≈ 5×10, PDW ≈ 6×13, Wurfkörper ≈ 6×8.
- **Ein Farbakzent pro Waffe, nicht mehr.** Im ganzen Satz ist bisher nur das orange Kennband der
  HE-Granate bunt — das macht sie auf einen Blick von jeder Waffe unterscheidbar.
- **Symmetrisch zur Längsachse.** Asymmetrie liest sich bei dieser Größe als verrutscht.

## Ohne eigenen Eintrag

Ein Item ohne Zeile in `HELD_ITEM_SPRITES` bleibt nie mit leeren Pfoten stehen:

- Schusswaffen → `generic_gun`
- geworfene Utilities → `generic_throwable`
- Modusvarianten (`…_COOP`) erben das Bild ihrer Basis

Soll ein Item **bewusst nichts** zeigen, gehört seine Art in `SLOTLESS_WEAPON_FIRE_TYPES` bzw.
`SLOTLESS_UTILITY_TYPES` in derselben Datei. Dort stehen bereits Nahkampf (Biss und Klauen *sind*
die Waffe), Schild, Tesla-Kuppel und Heil-Aura (haben eine eigene, größere Weltdarstellung) sowie
platzierte Konstrukte, Translocator und Taser.

## Prüfen

```bash
npm run sprites:held && npm test -- tests/HeldItemVisuals.test.ts
```

Der Test hält Maßstab, Griffpunkt innerhalb der Textur, Mündungsgrenze und die Rückfallformen fest.
