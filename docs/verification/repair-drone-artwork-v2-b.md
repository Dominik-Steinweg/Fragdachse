# Reparaturdrohnen-Artwork S-02

Stand: 25.09.2026. Ausgewählte Produktionsrevision: `v2-repair-drone-b`.

## Ergebnis

- Eigenes Blender-Modell mit zwei offenen Seitenrotoren, zwei Greifzangen, hinterer Akkukassette und eingelassenem Schraubenschlüssel-Symbol. Die breite Zweirotor-Silhouette unterscheidet sich von der bewaffneten Vierrotor-Angriffsdrohne. Keine Station.
- Matte elfenbeinfarbene Emaille auf petrolgrünem Chassis, Graphitmechanik, satinierte Aluminiumkanten, Kupferleitungen und kleine mintgrüne Arbeitsleuchten. Gemeinsame technische Albedotextur plus abgestimmte Rauheit, Körnung, Kontaktfugen und sparsame Gebrauchsspuren.
- Zwei gegenläufige Blender-Actions: 16 Flugphasen bei 48 fps und eine zusätzliche Ruhepose. Rumpf, Rotorgehäuse und Werkzeuge bleiben innerhalb des Clips fest.
- Orthografische 90°-Draufsicht, Nordausrichtung, zentrierter Drehpunkt, transparente 1024-px-Master. Quellen 64/128 px, ausgewählte Quelle 128 px; Anzeige im Spiel weiterhin 32 px.

[Rezept](../../scripts/asset-pipeline/recipes_v2/repair-drone.py), [Katalog](../../scripts/asset-pipeline/catalog-v2.json) und [importierte Laufzeitmetadaten](../../src/config/pipelineAssets.json) sind versioniert. Die Vergleichsreferenz `repair-drone-legacy.png` rekonstruiert Geometrie und Farben der bisherigen Canvas-Zeichnung; sie ist kein Browser-Screenshot.

## Spielintegration

Die Arena lädt das ausgewählte Spritesheet über `preloadRepairDroneAssets`. `RepairDroneRenderer` und `CoopDefenseObjectiveRepairDroneRenderer` verwenden dieselbe Körperdarstellung und sampeln den Rotorclip aus der Szenenzeit. Damit erhalten sowohl die Missionsdrohnen, etwa auf Map 1, als auch die spielergebundene Reparaturdrohne das neue Artwork.

Die Werkzeuge zeigen zum Reparaturziel beziehungsweise in Flugrichtung. Die frühere zeitgesteuerte Drehung des gesamten Körpers entfällt. Besitzerfarben erscheinen am äußeren Ring und übermalen die Materialien nicht. Reparaturregeln, replizierter Zustand und Missionszeitachse bleiben unverändert. Verborgene Missionsdrohnen benötigen keine eigenen Animationstimer.

## Prüfung

- Tatsächliche Blender-Master, Phasenübersicht und 32-px-Darstellung bei 0/45/90° auf hellen, dunklen, Gras- und Stahluntergründen geprüft.
- Gespeicherte Blender-Datei geprüft: eingebettete Quellen, gepackte Originaltextur, feste Kamera und Pivot, Actions, unverdeckter Bildrand aller Posen und geschlossener Loop. Alle 16 Rotorphasen unterscheiden sich auch bei 32 px.
- Endgültiges Quellenarchiv unabhängig entpackt, mit dem archivierten Prüfer geöffnet und auf CPU erneut gerendert; bestanden. Die überlappenden Symbolflächen sind in Revision B getrennt, der erneute Render wurde visuell geprüft.
- `npm run test:assets`: 117 Tests bestanden. Nach dem endgültigen Import erneut `PipelineRuntimeAssets.test.ts` und `RepairDroneRenderer.test.ts`: 8 Tests bestanden. Die neuen Darstellungstests schützen Clipzuordnung, feste Körperausrichtung, Besitzerkennzeichnung und vollständiges Ausblenden beziehungsweise Zerstören der Darstellungen.
- `npm run check`: 4.340 Core-Tests, 54 Architekturtests, Spiel- und Map-Editor-Build bestanden. Separater Asset-Viewer-Build bestanden. Nach der abschließenden Symbolkorrektur und dem endgültigen Import besteht auch der erneute Spiel-Build.
- Browser-/GPU-Laufzeitprüfung nicht beauftragt und nicht durchgeführt. Die Offline-GIF-Vorschau ersetzt diese Prüfung nicht.

## Lokale Lieferdateien

Diese großen Quelldateien bleiben gemäß Pipeline-Konvention Git-ignoriert:

- [Blender-Werkdatei](../../art/poc/pipeline-v2/repair-drone-workshop-v2-b.blend)
- [Animierter Vergleich mit der Angriffsdrohne](../../art/poc/pipeline-v2/verification/v2-repair-drone-b/rotor-preview.gif)
- [Statische Übersicht](../../art/poc/pipeline-v2/verification/v2-repair-drone-b/artwork-preview.png)
- [Prüfberichte und unabhängiger Render](../../art/poc/pipeline-v2/verification/v2-repair-drone-b/)
- [Produktionslauf mit unveränderlichem Quellenarchiv](../../art/poc/pipeline-v2/runs/v2-repair-drone-b/repair-drone/)

Das Quellenarchiv enthält Blend-Datei, Actions, Originaltextur, verwendete Pipeline-Skripte, Masterframes, Exporte, Auswahl und Prüfbelege. Die endgültige Szene ist im laufenden Blender ausgewählt; vorhandene Szenen wurden erhalten.
