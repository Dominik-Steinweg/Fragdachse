# Angriffsdrohnen-Artwork V2-B

Stand: 24.09.2026. Produktionsrevision: `v2-attack-drone-b`.

## Ergebnis

- Eigenes Blender-Modell anhand des bereitgestellten Quadrocopter-Artworks: vier offene, segmentierte Rotorgehäuse, fünf geschwungene Blätter je Rotor, facettierter Rumpf und bernsteinfarbene Positionsleuchten.
- Matte Titan-/Phosphatoberflächen, Graphit, Kupferkontakte und abgenutzte Markierungen. Die gepackte technische Albedotextur wird durch eigens abgestimmte Materialien mit gerichteter Körnung, variabler Rauheit, Kontaktfugen und sparsamen Gebrauchsspuren ergänzt.
- Separates, passend gestaltetes Bordgeschütz und einfache Bodenstation mit zwei Ladeschienen, H-Markierung und Serviceanzeigen.
- 16 gegenläufige Rotorphasen bei 48 fps, zusätzlich eine feste Ruhepose. Der vorhandene Renderer nutzt den Flugclip außerhalb der Andock-/Versorgungsphasen.
- Unveränderte Anzeigegrößen: Drohne/Geschütz 40 px, Station 32 px. Ausgewählte Quellen: 160/160/128 px; transparente Master jeweils 1024 px, feste orthografische 90°-Kamera und zentrierter Pivot.

Rezept: [attack-drone.py](../../scripts/asset-pipeline/recipes_v2/attack-drone.py). Die drei ausgewählten PNG-Pakete und ihre Clipmetadaten sind über den bestehenden Import in [pipelineAssets.json](../../src/config/pipelineAssets.json) übernommen. Gameplay- und Rendereränderungen sind kein Bestandteil dieses Artwork-Auftrags.

## Prüfung und Quellen

- Tatsächliche Blender-Master, Nominalgrößen auf hellen/dunklen/Gras-/Stahluntergründen, Phasenübersicht und zusammengesetzte Drohne/Geschütz-Vorschau geprüft.
- Der unabhängige Blender-Prüfer besteht für alle drei gespeicherten Assets: gepackte Quellen/Texturen, Kamera, Pivot, Clipping, Actions und Loop-Schluss. Alle 16 Flugphasen unterscheiden sich auch nach Verkleinerung auf 40 px.
- Das Body-Quellenarchiv wurde unabhängig entpackt, mit dem archivierten Prüferskript geöffnet und auf CPU erneut gerendert; Prüfung bestanden.
- `npm run test:assets`: 108 Tests nach Import bestanden. Separater Viewer-Build bestanden.
- `npm run check`: 4.312 Core-Tests, 54 Architekturtests sowie Spiel- und Map-Editor-Build bestanden. Der erste Lauf während des parallelen CPU-Archivrenders erreichte Timeouts in `AmbientWildlife` und `ActivityRebindingContracts`; der vollständige Wiederholungslauf ohne parallelen Render bestand unverändert.
- Browser-/GPU-Laufzeitprüfung: nicht beauftragt, nicht durchgeführt. Die GIF-Vorschau ist ein Offline-Export und ersetzt diese Prüfung nicht.

Lokale, Git-ignorierte Lieferdateien:

- [Blender-Werkdatei mit drei Szenen](../../art/poc/pipeline-v2/attack-drone-workshop-v2-b.blend)
- [Animierte Vorschau](../../art/poc/pipeline-v2/verification/v2-attack-drone-b/rotor-preview.gif)
- [Statische Übersicht](../../art/poc/pipeline-v2/verification/v2-attack-drone-b/artwork-preview.png)
- [Prüfberichte](../../art/poc/pipeline-v2/verification/v2-attack-drone-b/)
- [Produktionslauf](../../art/poc/pipeline-v2/runs/v2-attack-drone-b/): pro Asset unveränderliches `source-bundle.zip`, `selection.json`, Review, gepackte Blend-Datei, Originaltexturen, verwendete Skripte und Masterframes.

Das bereitgestellte Artwork ist unverändert als Designreferenz in den Drohnen-/Geschützarchiven erhalten. Die drei vorherigen Sprites liegen als versionierte Vergleichsreferenzen unter `scripts/asset-pipeline/references/`.
