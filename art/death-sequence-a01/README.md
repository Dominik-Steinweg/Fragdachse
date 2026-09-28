# A01 – Todessequenz r03

Der Entwurf **r03** basiert auf dem tatsächlich importierten Pipeline-Dachs **v2-ai / standard**. Dessen gepacktes Blender-Modell wird in Ruhepose übernommen. Dunkles Fell wird blass, die Figur zieht sich zusammen und geht in einen aufsteigenden Geist über. Kreuzaugen, offener Mund, Zusammenziehen und Verblassen erhalten den Ansatz der alten Sequenz.

Gegenüber r02 sind Kreuzaugen größer und dunkler, der Mund ist eine gefüllte Öffnung und die Ohren haben deutlichere Konturen mit sichtbaren Innenflächen. Zwei phasenversetzte Formanimationen erzeugen eine laufende S-Welle im unteren Schweif. Arme und Körper ziehen sich vor der kurzen Überblendung nach innen; das Geistgesicht wird erst sichtbar, während der Körper verschwindet. Der Aufstieg beginnt nach diesem Übergang. r02 bleibt unverändert erhalten.

**r03 ist auf Nutzerfreigabe ins Spiel übernommen.** [Runtime-Atlas](../../public/assets/player/death-a01-r03/death-atlas.json) und [PNG-Sheet](../../public/assets/player/death-a01-r03/death-sheet.png) sind unveränderte Kopien der freigegebenen Exporte. `ArenaScene` lädt sie unter dem bestehenden Texture-Key `dachs_death` und registriert `player_death` mit 72 Frames bei 60 fps. `EffectSystem` zeigt die Sequenz mit 48×96 Spieleinheiten und Ursprung (0,5; 0,75) direkt an der Todesposition. Der Sprite wird nach `ANIMATION_COMPLETE` entfernt. Gegner-Tode bleiben unverändert. Die historischen Vergleichsdateien und Quellenarchive dokumentieren weiterhin den damaligen Freigabeentwurf; das normale V2-Character-Manifest bleibt unverändert.

## Vergleich ansehen

- [Interaktiver Vorher-/Nachher-Vergleich](r03/vergleich.html) – zeigt zunächst r02 gegen r03; „Vorher“ kann auf die aktuelle Spielversion umgeschaltet werden. Selbstständige HTML-Datei mit Pause, Einzelbildern, Zeitlupe, Phasensynchronisation und vier Hintergründen.
- [Direkter Vergleich r02 → r03](r03/r02-r03.gif).
- [Spielversion → r03](r03/vorher-nachher.gif) – gemeinsamer Start bei vorgesehener Geschwindigkeit, dreifache Spielgröße, wiederholte Wiedergabe.
- [Phasenübersicht](r03/phasen.png).
- [PNG-Sheet](r03/death-sheet.png), [Atlas](r03/death-atlas.json), [Exportprüfung](r03/review.json).

| Eigenschaft | Vorher | Entwurf |
| --- | --- | --- |
| Bildgröße je Frame | 32×64 | 256×512 |
| Frames | 38 | 72 |
| Wiedergabe | 60 fps, ca. 0,63 s | 60 fps, 1,20 s |
| Figur | Alter Pixel-Dachs | Aktuelles V2-AI-Modell |
| Logisches Canvas | 32×64 | 48×96 |
| Körpermaßstab | Alter 32er Körper | Aktuelle 38,4er Spieleranzeige |
| Position der Spielfigur im Canvas | (0,5; 0,75) | (0,5; 0,75) |

Die neue Sequenz ist bewusst länger, um die Verwandlung lesbar zu machen. „Gleiche Phase“ im HTML streckt lediglich die Wiedergabe des Originals zum Vergleich. Die Originaldatei und ihr tatsächliches Spieltempo werden dadurch nicht geändert. Das GIF ist ein 30-fps-Vergleichsexport; der HTML-Viewer verwendet alle 60-fps-Frames.

Die größere Canvas-Fläche schafft Platz zum Aufsteigen und vergrößert nicht die Spielfigur. Die neue Form wird aus transparenten 1024×2048-Mastern exportiert. Der Atlas hat acht Spalten, zwei Pixel Rand und vier Pixel Abstand; Frames bleiben unbeschnitten. Der letzte Frame ist vollständig transparent.

## Quellen und Reproduktion

- [Blender-Authoring](build-preview.py): übernimmt ausgewertete Ruhegeometrie und Materialien des archivierten Dachsmodells, erzeugt die Geistsilhouette, Materialübergänge und gespeicherte Animationen. Die ursprüngliche Blend-Datei wird nur gelesen.
- [Export und Vergleich](export-preview.mjs): packt die Frames, prüft Alpha/Randabstand und erzeugt Atlas, HTML, GIF und Phasenübersicht. Nutzt vorhandene `sharp`-/`gifwrap`-Pakete.
- [Vergleichsvorlage](review-template.html).
- Vollständige Render-/Blender-Quellen liegen lokal unter `art/poc/death-sequence-a01/r03/`, einschließlich `death-preview.blend`, gepackter Texturen, aller Masterframes und unabhängiger Renderprüfung.
- Das lokale Quellenpaket `art/poc/death-sequence-a01/r03-source-bundle.zip` erhält zusätzlich die verwendete ursprüngliche Blend-Datei, Vergleichsbilder, Skripte und Exporte. Diese großen Produktionsquellen liegen im bereits ignorierten `art/poc/`-Bereich. Die r02-Quellen und ihr Archiv bleiben erhalten.

Eine neue Bearbeitung benötigt eine neue Revisionskennung; abgeschlossene Renderverzeichnisse werden nicht überschrieben. Beispiel aus dem Repository-Root:

```powershell
& 'D:/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python art/death-sequence-a01/build-preview.py -- --repo C:/Fragdachse --revision r04 --indices all
node art/death-sequence-a01/export-preview.mjs r04
```

Die vorhandene Blender-Installation wurde zunächst im Hintergrund verwendet; nach Herstellung der MCP-Verbindung wurde die gespeicherte Vorschau zusätzlich in eine eigene Szene eingelesen und ein Frame unabhängig neu gerendert. Die vorherige interaktive Szene blieb erhalten.

## Prüfungen und Runtime-Integration

**Prüfung nach der freigegebenen Runtime-Integration:** `npm run check` vollständig bestanden (4.494 Core-Tests einschließlich der acht Tests in `EffectSystemDeathAnimation.test.ts`, 54 Architekturtests, Spiel- und Map-Editor-Build). `npm run test:assets`: 138 Tests bestanden. Importierte PNG-/Atlas-Dateien sind byteidentisch mit r03; alle 72 registrierten Frame-Namen existieren, Frames bleiben unbeschnitten und der letzte Frame ist vollständig transparent. Protokolle: `art/poc/death-sequence-a01/r03-integration-check.log` und `r03-integration-assets.log`. Es erfolgte keine zusätzliche Match-Sichtprüfung bei diesem Integrationsschritt. Die folgenden Absätze dokumentieren die vorherige Entwurfsprüfung.

Exportprüfung: 72 gleich große RGBA-Frames, mindestens 2 % Sicherheitsrand bei Alpha > 2, vollständig transparenter Abschluss. Kamera orthografisch, Rotation (0,0,0), gleicher fester Anker über die Sequenz. Gespeicherte r03-Blend-Datei unabhängig geöffnet und Frame 46 mit CPU neu gerendert; verwendete Bilddateien sind gepackt. Beide Schweif-Formanimationen erlauben negative Werte für die Bewegung in beide Richtungen. Bestehende Asset-Suite bei r02: 138 Tests bestanden; keine Runtime-Dateien für r03 geändert.

Der erneute Build bei r03 war durch parallel vorhandene TypeScript-Änderungen außerhalb dieses Entwurfs blockiert: `RockBaseConfig.ts:43` (TS2345), `RockSurfaceRendering.ts:55` (TS2339), `WorldPresentationFrameBinding.ts:674` (TS2551). Diese Dateien wurden für die Todessequenz nicht bearbeitet; das Protokoll liegt unter `art/poc/death-sequence-a01/r03-build.log`.

Der sichtbare Browservergleich wurde auf dunklem, hellem und Gras-Hintergrund geprüft. Start, Pause, Zeitlupe, Scrubbing, Einzelbildschritt und Phasenvergleich wurden bedient; beide Bildquellen und alle Frames werden geladen. Die helle Kontur bleibt auf Gras und die kühle Randzeichnung auf hellem Grund sichtbar.

Der Vergleich enthält bewusst keine gleichzeitig auftretenden Gore-, Licht- oder Partikeleffekte der Arena. In der Runtime startet die Sequenz weiterhin gemeinsam mit dem bestehenden GPU-Todeseffekt. Die separate Vergleichsseite belegt die Asset-Abnahme, nicht eine Prüfung aller gleichzeitig auftretenden Effekte im Match.
