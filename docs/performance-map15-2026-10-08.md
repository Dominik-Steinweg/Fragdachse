# Map 15: Boss und expandierendes VoidFire

## Szenario

`boss.map15` misst 60 Sekunden auf einer Diagnosekopie der echten Map 15, mit Seed
16092026, geschütztem passivem Beobachter, regulären Gegnern, Leerenjäger, Nuke,
Armageddon und radialer Feuer-Ausbreitung. Tutorial und die Boss-Freigabe durch das
Räumen der Anfangswelle entfallen. Die Anfangswelle bleibt bestehen; die Basis wird
alle 250 ms repariert, damit die passive Messung nicht durch eine Niederlage abbricht.
Die Reparaturmenge steht im Ergebnis unter `baseHpRepaired`.

Die Messung wartet auf Phase 1 und Anfangsfeuer. Nach zehn Sekunden setzt der
Diagnoseeingang die Boss-HP auf den konfigurierten Phasen-Schwellwert; die normalen
Spielsysteme führen den Übergang und sämtliche Effekte aus. Die Unterfenster sind
`boss.map15.phase1`, `.expansion` und `.phase2`. Phase 2 beginnt nach mindestens 95 %
der aus der Kartengeometrie ermittelten permanenten Feuerfläche. Fehlende Phasen,
Nuke, Meteore, sichtbares Feuer oder volle Feuerlast lassen den Lauf scheitern.

## Befund und Änderung

Ein separater CPU-Profillauf und die vorhandene Renderdiagnose zeigen hohen Aufwand
in Phasers allgemeiner Renderübergabe. Bis zu 500 Blutflecken liegen als einzelne
Images auf der DisplayList. `BloodStainBatch` ersetzt deren Renderaufrufe durch den
bereits verwendeten persistenten GPU-Quad-Writer `EnemyEyeBatch`.

Die ursprünglichen Images bleiben die Ziele der unveränderten Tween-Animationen.
Nach dem Update werden Position, Größe, Rotation, Tint und Alpha in den Batch
geschrieben. Zusammengefasst werden nur zusammenhängende Blutflecken desselben
Depth-Werts: Gegner auf derselben Höhe unterbrechen einen Batch und behalten damit
ihre bisherige Zeichenreihenfolge. Textur, Menge, Lebensdauer und Spielregeln bleiben
unverändert. World-Clear und Scene-Shutdown zerstören auch die aus der DisplayList
entfernten Images und ihre Tweens. Canvas nutzt weiterhin die bisherigen Images.
Die Alpha-Werte werden wie bei Phasers Image-Submitter auf acht Bit quantisiert,
damit überlappende Flecken beim Wechsel zum Float-Alpha des GPU-Batches gleich aussehen.

## Messung

High, 1920 × 1080, DPR 1, 2 Sekunden Warmup, keine CPU-Drosselung. Je drei
unprofilierte Läufe mit frischem Chrome-Profil, wechselnde A/B-Reihenfolge und keine
parallel laufenden Builds oder Tests. Hardware: Ryzen 7 5800X, RTX 3080,
Chrome 154.0.8037.98. Die Tabelle enthält den Median der drei jeweiligen Laufstatistiken.
Referenz ist `362552aa` plus dasselbe neue Szenario, ohne Blutflecken-Optimierung.

| Messgröße | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| CPU pro Frame, Mittelwert | 7,902 ms | 7,912 ms | +0,1 % |
| CPU pro Frame, p95 | 11,2 ms | 11,3 ms | +0,9 % |
| CPU pro Frame, p99 | 13,2 ms | 13,2 ms | unverändert |
| CPU-Renderübergabe, Mittelwert | 4,307 ms | 4,166 ms | −3,3 % |
| CPU-Renderübergabe in Phase 2 | 5,276 ms | 4,986 ms | −5,5 % |
| CPU pro Frame in Phase 2 | 9,420 ms | 9,376 ms | −0,5 % |
| Post-Update, Mittelwert | 0,065 ms | 0,117 ms | +0,052 ms |
| GPU-Renderphase, Mittelwert | 2,580 ms | 2,633 ms | +2,1 % |
| Draw Calls pro Frame | 164,7 | 172,1 | +4,5 % |
| Frameabstand, p95 | 15,3 ms | 15,4 ms | +0,7 % |

Die Einsparung liegt in weniger einzelnen Phaser-Renderaufrufen. Das Schreiben der
GPU-Quads kostet zusätzliche Post-Update-Zeit; getrennte Batches sparen keine Draw
Calls; GPU-Zeit und Draw Calls steigen leicht. Die gesamte Framezeit verbessert sich
im Median nicht: CPU-Mittelwerte vorher 7,773 / 7,902 / 8,053 ms, nachher
7,912 / 7,912 / 9,659 ms. Der dritte optimierte Lauf streut stark nach oben,
auch schon in Phase 1; eine Ursache ist nicht belegt und der Lauf wurde nicht
ausgeschlossen. In Phase 1 steigt der Median von 5,011 auf 5,110 ms. Der nachgewiesene
Gewinn betrifft die CPU-Renderübergabe, nicht die gesamte Framerate. Es gibt keinen
belastbaren Nachweis besserer maximaler Hitches oder eines allgemeinen FPS-Gewinns.

Alle sechs Läufe erreichen 4.896 permanente Feuerzellen, beide Bossphasen, eine
aktive Nuke und bis zu sieben Meteore. Das Gegnermaximum variiert durch den laufenden
Kampf zwischen 48 und 51, mindestens 302–354 VoidFire-Zellen bleiben sichtbar.
Der Seed fixiert die Kartengenerierung; die zeitabhängige Simulation ist keine
bitidentische Wiedergabe. Die GPU-Zeit erfasst die vorhandene Renderphase, nicht
sämtliche Offscreen-Arbeit vor dem Rendern. Gemessen wird ein lokaler Host ohne
Spielerschüsse, keine WebRTC-Verbindung und kein schwächeres Endgerät.

## Visuelle und technische Prüfung

Ein eingefrorener echter Map-15-Zustand mit 481 Blutflecken wird abwechselnd über
die ursprünglichen Images und die beiden GPU-Batches gerendert, bei Zoom 0,65, 1
und 1,4. Die Referenz-Images durchlaufen beim Wiedereinsetzen die reguläre
Weltkamera-Zuordnung; andernfalls würden sie zusätzlich auf der HUD-Kamera erscheinen.
Wiederholte Referenzaufnahmen sind pixelidentisch. Zwischen Images und GPU-Batches
unterscheiden sich 186, 589 bzw. 1.035 von 2.073.600 Pixeln, maximal zwei Farbwerte
pro Kanal. Das sind höchstens 0,05 % der Bildpunkte; Textur, Lage und Sichtbarkeit
bleiben erhalten. Evidenz: `build/map15/blood-parity-final/evidence.json` und PNGs.

Der isolierte Vergleich desselben eingefrorenen Frames, mit 40 Aufwärmdurchläufen
und 120 abwechselnden Samples je Variante, ergibt 4,4 → 4,0 ms mediane CPU-Renderzeit.
`gl.finish()` liegt vor der Zeitmessung. Diese isolierte Messung enthält keine
Simulation und keine Kosten des neuen Post-Update-Schreibens und ist kein FPS-Wert.

`npm run check` ist erfolgreich: 5.462 Core-Tests, 54 Architekturtests, Spiel-,
Map-Editor- und Balance-Editor-Build. Zusätzlich bestehen die Feuer-Stressprüfung
und die gezielten Tests zu Batch-Reihenfolge, Alpha, Cleanup und GPU-Kameratransformationen.

## Reproduktion und Artefakte

```powershell
npm run perf:chrome -- --case boss.map15
```

Der kontrollierte Vergleich verwendet die bestehende Suite:

```powershell
npm run perf:chrome -- --suite --sites build/map15/ab-final-sites.json --output-root build/map15/ab-final --runs 3 --qualities high --case boss.map15 --max-c-growth-mib 8192
```

Lokale, nicht versionierte Artefakte: `build/map15/{baseline,final}/site`,
`build/map15/ab-final/suite.json`, sechs `run.json` und `build/map15/summary-final.json`.
Profiler und instrumentierte Diagnose liegen getrennt unter `profile-ready` und
`diagnostic` und fließen nicht in die A/B-Tabelle ein. Frühere Kalibrierungsversuche
unter `profile-baseline` und `profile-calibrated` waren ungültig und sind ebenfalls
ausgeschlossen. Der CPU-Profillauf allein ist kein Vorher-Nachher-Nachweis.
Die frühere Serie unter `ab` misst einen Zwischenstand vor der Alpha-Angleichung.
