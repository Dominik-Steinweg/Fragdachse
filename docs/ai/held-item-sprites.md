# Getragene Item-Sprites

Der Authoring-Pfad besteht aus zwei synchron zu haltenden Einträgen:

1. Pixelkarte und PNG-Ausgabe in scripts/generate-held-item-sprites.mjs, Liste ITEMS.
2. Griff-/Texture-Metadaten in src/loadout/HeldItemVisuals.ts, Registry HELD_ITEM_SPRITES.

Nach Änderungen npm run sprites:held ausführen. Die Loadout-ID bleibt der gemeinsame Schlüssel; Varianten können den Sprite ihrer Basis erben.

## Dauerhafte Regeln

- Die Pixelkarte zeigt nach Norden; die Figur übernimmt Rotation und Physik.
- Items verwenden das 32-px-Referenzraster (`HELD_ITEM_TEXTURE_SIZE`) und werden über den Griffpunkt am Figurenanker positioniert. Dieses Raster bleibt unabhängig von der Source-/Frame-Auflösung animierter Charakter-Sprites, z. B. 64x64.
- Der Griffpunkt muss in Generator und Registry identisch sein. Die kanonische Laufzeitberechnung bleibt in src/config.ts.
- Die Mündung wird als `muzzleX`/`muzzleY` mit derselben Bildtransformation wie das Held-Item
  berechnet; Positionen für Projektil, Hitscan, Audio und Mündungsfeuer nicht separat erfinden.
- Ein fehlender Eintrag nutzt die vorhandenen generischen Gun-/Throwable-Fallbacks, sofern das Item nicht ausdrücklich slotless ist.

Prüfung: npm run sprites:held und npm test -- tests/HeldItemVisuals.test.ts. Der Generator schreibt
zusätzlich `public/assets/sprites/held/previews/held-weapon-pilots.png`; dort stehen Glock, Negev
und Rocket Launcher zeilenweise in den Rotationen 0, 90, 180 und 270 Grad.

Die Sichtpruefung nutzt ausserdem drei Vollpruefungstafeln unter
`public/assets/sprites/held/previews/`: `held-weapons-all-01.png` bis
`held-weapons-all-03.png`. Sie enthalten alle 18 Waffen zeilenweise in den Rotationen 0, 90,
180 und 270 Grad.

## Groessenstaffelung und Farbzuordnung

Standardwaffen bleiben bewusst kompakt: Pistolen und Geraete liegen typischerweise bei 5-9 px
Breite und 10-16 px Hoehe, Gewehre und schwere Waffen bei 7-13 px Breite und maximal 24 px Hoehe.
Eine einzelne echte Langwaffe darf als Ausnahme bis 32 px in das 32-px-Raster hineinreichen;
die AWP ist aktuell diese Ausnahme. Die Maximalgroesse ist kein Standardmass fuer neue Waffen.

Die Darstellung bleibt strikt orthografisch in 90-Grad-Top-Down-Ausrichtung nach Norden; die
Rotation entsteht weiterhin erst an der Spielfigur. Silhouetten duerfen asymmetrisch sein, aber
nur durch charakteristische Anbauteile wie Griff, Magazin, Munitionskasten, Visier oder Technikmodul.
Es bleiben reine Rasterdarstellungen ohne Horizont, sichtbare Seitenflaechen, seitlich gehaltene
Waffen oder 3/4-Perspektive.
Die Farbakzente folgen dem zugeordneten Loadout-Icon; wo kein Icon vorliegt, nutzt die Waffe ihre
semantische Materialfarbe. Form und Farbgruppe bilden gemeinsam die Waffenidentitaet.

## Verbindlicher Mündungs-Vertrag

Die Spezifikation enthält neben dem Griffpunkt auch `muzzleX`/`muzzleY` auf der Pixelkarte.
`getHeldWeaponMuzzleOrigin` transformiert diesen Punkt mit derselben Rotation und Skalierung wie
das sichtbare `HeldItemVisual` und bleibt der reine Render-/VFX-/Audio-Ursprung.

Direkte Spieler-Projektilaktionen berechnen optional über `getHeldWeaponGameplayMuzzleOrigin` einen
separaten `gameplayMuzzleOrigin` aus dem konkreten Fire-Request-Ursprung `x/y`, dessen Winkel und
der aktuellen Itemgröße. `x/y` bleibt damit der Shooter-/Fire-Request-Ursprung; der
`ProjectileManager` löst den kurzen Weg zur Mündung sicher auf und verwendet `resolvedSpawn` als
autoritative initiale Projektilposition. Physics-Body, Renderer, Tracer, Time-Bubble-Abfrage,
`lastX/lastY` und replizierte Projektilposition starten dort.

Der Safe-Muzzle-Resolver verwendet den bestehenden `ArenaObstacleIndex`/`CombatGeometry`-Pfad.
Die Körper-Clearance wird vor der Body-Erzeugung mit demselben Body-Profil wie beim Arcade-Body
abgeleitet. `nearestObstacleHit(..., { clearanceRadius })` bläst die Hindernisgeometrie bereits
auf; vom Trefferpunkt wird deshalb nur ein kleines Epsilon entgegen der Segmentrichtung abgezogen.
Reichweitenbudgets, Bounce, Penetration und das Netzwerk-Wire-Format ändern sich nicht.

Für direkte Projektilwaffen beginnen Aim-Beam und maximale Reichweitenmarke am normalen
Gameplay-Muzzle und verwenden weiterhin den bestehenden Gameplay-Aim-Winkel. Innerhalb der
Waffenreichweite endet der Beam weiterhin auf Cursorhöhe; der Range-Tick erscheint erst außerhalb
der Reichweite. Waffen ohne sinnvollen Gameplay-Muzzle sowie Hitscan und Melee behalten ihren
bisherigen Ursprung.

Lange Waffen dürfen bis zu 32 Pixel hoch sein. Die frühere Bindung an die halbe Spielerhöhe und
an `MUZZLE_FORWARD_OFFSET` ist keine gültige Sprite-Regel mehr.
