# Felsbasis

Produktionsquelle der Felsbasis (`public/assets/sprites/rock_base.png`, Laufzeit:
`src/arena/RockBaseConfig.ts`). Export: `npm run sprites:rockbase`.

- [`material.json`](material.json) verwendet [`rock-strata.png`](rock-strata.png): breite, gestufte
  Bruchflächen in orthografischer Draufsicht. Quelle mit dem eingebauten Imagegen erzeugt;
  vollständiger Prompt: [`rock-strata.prompt.txt`](rock-strata.prompt.txt). Maßstab: 8 × 8 m,
  entsprechend 256 Weltpixeln. Farbabstimmung und Kantenparameter liegen in derselben Rezeptdatei:
  dunkles, kühles Schiefergrau mit zurückgenommenen Glanzkanten hält die Felsflächen im Hintergrund.
- Die Quelle belegt die volle Materialperiode; nur die Übergänge an den Wiederholungskanten
  werden angeglichen. Keine Rotation einzelner Patches, damit das Facettenlicht konsistent bleibt.
  Kleinere Quellen können weiterhin gequiltet werden. Jeder 47-Blob-Frame existiert in 64
  Materialphasen; eine Zelle zeichnet die Phase ihrer Rasterposition, das Gestein läuft dadurch
  ohne Wiederholung pro Zelle über Zellgrenzen weiter.
- Silhouette: Kanten zu Nachbarfelsen bleiben voll deckend. Freie konvexe Ecken werden mit
  `cornerRadius` gerundet, freie Kanten um wenige Pixel weltfest eingezogen. Die Kollision bleibt
  auf dem 32-px-Raster; `tests/assets/RockBase.test.ts` begrenzt die Abweichung.
- Kantenlicht oben links, eine breite geneigte Randfacette und eine unregelmäßige Bruchlippe
  (`shelfWidth`, `shelfVariation`, `shelfLift`) sind eingebacken. Eine schmale dunkle Kontur
  (`outline`) trennt den Fuß vom Boden, ohne die Schattenflächen zu verschlucken. Die Kontur
  variiert in linearen Segmenten; ihre Abweichung vom Kollisionsraster bleibt auf wenige Pixel
  begrenzt. Eckentints, schwache Wertvariation, Moos, Vegetation und Decals liegen weiterhin darüber.
