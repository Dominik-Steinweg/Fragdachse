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
3. `bl.py … export.py 3500 v6` rendert senkrecht von oben bei fester Sonne. Für jede Öffnung und jeden Zustand
   entstehen:
   - die Knochen (`intact`, `damaged`, `rubble`);
   - der Boden (`sealed`, `active`, `dry`). Er ist außerhalb des Flecks transparent, damit er sauber in den
     Kartenboden übergeht, und die Knochen werfen ihren Schatten hinein;
   - zu jedem Bild ein Emissionsbild bei ausgeschaltetem Licht.

   Alles landet in `art/poc/spawn-structure/blender/<label>/`.
4. `node scripts/asset-pipeline/export-spawn-structure.mjs blender --label v6` packt Sheets, Registry und
   Manifest. Danach aktualisiert `npm run assets:runtime` die WebP-Kopien.

Die Hitbox (`SOUTH_BODY` in `src/config/spawnStructure.ts`) ist aus der Knochenabdeckung des Frames
`intact-south` abgeleitet; die Spitzen der Gliedmaßen ragen ohne Hitbox darüber hinaus.
