# Felsbasis

Produktionsquelle der Felsbasis (`public/assets/sprites/rock_base.png`, Laufzeit:
`src/arena/RockBaseConfig.ts`). Export: `npm run sprites:rockbase`.

- [`material.json`](material.json) wählt die Materialquelle aus [`candidates-01`](candidates-01/README.md)
  (aktuell 08, dunkler kühler Schiefer), ihren Maßstab (4 × 4 m = 128 Weltpixel), eine leichte
  Farbabstimmung und die Kantenparameter.
- Das Material wird nahtlos auf 8 × 8 Zellen gequiltet. Jeder 47-Blob-Frame existiert in 64
  Materialphasen; eine Zelle zeichnet die Phase ihrer Rasterposition, das Gestein läuft dadurch
  ohne Wiederholung pro Zelle über Zellgrenzen weiter.
- Silhouette: Kanten zu Nachbarfelsen bleiben voll deckend. Freie konvexe Ecken werden mit
  `cornerRadius` gerundet, freie Kanten um wenige Pixel weltfest eingezogen. Die Kollision bleibt
  auf dem 32-px-Raster; `tests/assets/RockBase.test.ts` begrenzt die Abweichung.
- Kantenlicht oben links, Schattenkante unten rechts, ein dunkler Randabschluss und eine schmale
  dunkle Kontur an freien Kanten (`outline`) sind eingebacken. Die Farbabstimmung hält den Fels
  kühl grau und deutlich dunkler als die warme Erde: Fels muss sich als Kollisionsfläche in
  Helligkeit und Farbton vom Boden abheben. Moos und Randbewuchs bleiben dunkel und gedeckt.
  Eckentints, schwache Wertvariation, Moos, Vegetation und Decals liegen weiterhin darüber.
