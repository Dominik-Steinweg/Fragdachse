# Spawnbauwerk: Brutkadaver

Produktionsquelle des Spawnbauwerks (GDD Spawnbauwerk V1). Laufzeit:
`src/effects/spawnStructure/` mit `src/assets/manifests/spawn-structure.json`.

- [`concept.png`](concept.png) ist das gewählte Konzeptbild (Qwen-Image, lokal über ComfyUI;
  Prompt in [`concept.prompt.txt`](concept.prompt.txt)). Kadaver, Brutnest und Kriechboden stammen
  unverändert aus diesem Bild.
- Die übrigen Bilder sind Qwen-Bearbeitungen auf demselben Layout. Prompts liegen jeweils daneben:
  - `carcass-intact.png`: freigestellter Kadaver. Er liefert nur die äußere Silhouette, die Pixel
    kommen aus dem Konzept.
  - `ground-active.png`: Boden ohne Kadaver und ohne Kreaturen. Die Gegner kommen im Spiel selbst.
  - `carcass-damaged.png`, `carcass-rubble.png`, `ground-sealed.png` und `ground-dry.png`: Zustände.
    Sie wurden auf den bereits um 18° gedrehten Ebenen gemalt, also auf dem Kadaver auf Magenta
    bzw. dem Boden.
- Schnitt und Ausrichtung macht `python -I scripts/asset-pipeline/spawn-structure-painted.py <label>`:
  - Das Konzept wird um 18° gedreht, damit die Öffnung zwischen Schnauze und Kiefer nach Süden zeigt.
  - Die Körperzellen liegen auf einem 120-px-Raster, siehe `SOUTH_BODY` in
    `src/config/spawnStructure.ts`.
  - Freistellung per Farbabstand zu Gras bzw. Magenta.
  - Leuchtmasken für Risse, Fleisch und Eier.
  - Nichts wird übermalt.
- Danach erzeugt `node scripts/asset-pipeline/export-spawn-structure.mjs painted --label <label>`
  Sheets, Registry und Manifest, und `npm run assets:runtime` aktualisiert die WebP-Kopien.
