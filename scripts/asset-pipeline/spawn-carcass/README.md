# Brutkadaver (Spawnbauwerk) in Blender

Das Spawnbauwerk (GDD Spawnbauwerk V1) ist das Skelett eines eingerollten Drachen über einem Brutnest. Es wird
in einem laufenden Blender gebaut. Die Skripte steuern Blender über den Socket des Blender-Lab-MCP-Add-ons
(`localhost:9876`); `bl.py` setzt `ROOT`, `LIVE` und `LABEL` vor jedes Skript.

1. `python -I scripts/asset-pipeline/spawn-carcass/albedo.py` und `trace.py` schreiben Projektion, Höhenkarte,
   Spurlinie, Rippen und Bodensaum aus dem gemalten Konzept (`tools/source-art/spawn-structure/`) nach
   `build/spawn-structure/live/`.
2. In Blender den MCP-Server des Add-ons starten, dann der Reihe nach:
   - `python -I scripts/asset-pipeline/spawn-carcass/bl.py scripts/asset-pipeline/spawn-carcass/carcass.py 1500`
     baut die Knochen.
   - Mit `atmosphere.py` und danach `tweak.py` kommen Waldboden, Becken, Wucherungen, Schleimfäden, Eier und
     Moos dazu. `tweak.py` setzt außerdem Augen und Eierglut und verteilt die Streueier.
3. Organischer Fleck und ältere Knochen:
   - `bl.py … export.py 3500 <label>` einmal rendern (siehe 4), dann
     `python -I scripts/asset-pipeline/spawn-carcass/proximity.py <label>` die Knochennähe aus dem Frame
     `intact-south` als Maske nach `build/spawn-structure/live/bone-proximity.png` backen.
   - `bl.py … ground.py 120` dunkelt die Knochen ab, lässt den Augen nur dunkle Glut (das Spiel leuchtet sie
     auf der GPU aus) und ersetzt den runden Fleck durch einen verzerrten Nestkern mit Ausläufern entlang
     der Knochen und ausgefranstem Rand. Das Skript ist wiederholbar.
4. `bl.py … export.py 3500 <label>` rendert senkrecht von oben bei fester Sonne. Für jede Öffnung entstehen:
   - die Knochen (`intact`; die Zerstörung ist zur Laufzeit eine Knochenexplosion, es gibt keine
     Schadens- oder Trümmerbilder);
   - der Boden (`sealed`, `active`). Er ist außerhalb des Flecks transparent, damit er sauber in den
     Kartenboden übergeht, und die Knochen werfen ihren Schatten hinein;
   - zu jedem Bild ein Emissionsbild bei ausgeschaltetem Licht.

   Alles landet in `art/poc/spawn-structure/blender/<label>/`.
5. `node scripts/asset-pipeline/export-spawn-structure.mjs blender --label <label>` packt Sheets, Registry und
   Manifest. Danach aktualisiert `npm run assets:runtime` die WebP-Kopien.

Die Hitbox (`SOUTH_BODY` in `src/config/spawnStructure.ts`) ist aus der Knochenabdeckung des Frames
`intact-south` abgeleitet. `carcass.py` spiegelt sie als `BODY` und hält Schwanz, Hinterbein und Vorderklaue
auf diesen Zellen. Die Schwanzwirbel sind fein ausgearbeitet (eigenes Objekt `v6_tail` mit feinerem Raster);
ihre langen Querfortsätze überspannen die Zellen wie die Rippen den Brustkorb. Ändert sich die Vorlage, müssen beide Stellen gemeinsam angepasst werden.
`python -I scripts/asset-pipeline/spawn-carcass/hitbox_check.py <frame.png> <overlay.png>` misst die Abdeckung je Zelle.
