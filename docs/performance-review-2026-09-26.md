# Performance-Prüfung vom 26. September 2026

Erweiterte Gesamtläufe und wiederholte gezielte Gegenmessungen sind abgeschlossen. Die Einschränkung langer Chrome-Aufnahmen mit JS-Sampling ist unten dokumentiert.

## Änderungen

- Build-Archive teilen identische Dateien über einen privaten SHA-256-Objektspeicher und Hardlinks. Arbeitsdateien bleiben unabhängig. Eine typische weitere Version dieser Prüfung schreibt rund **21 MB statt 146 MB** Dateiinhalte neu (rund **85 % weniger**, ohne Dateisystem-Metadaten). Bereits archivierte Builds lassen sich mit `--build <Hash>` erneut messen.
- Der Runner prüft freien Speicher vor großen Schreibvorgängen und während des Laufs. **1 GiB Reserve plus 128 MiB Puffer** bleiben vorgesehen; der erwartete Schreibbedarf kommt hinzu. Chrome-Traces werden direkt komprimiert, ohne unkomprimierte Zwischenkopie.
- Die Offline-Auswertung verarbeitet nur passende Zeitbereiche und verwendet bereits aufgelöste Aufrufstapel erneut. Am ursprünglichen vollständigen Trace waren die Ergebnisse exakt gleich: Frame-Auswertung **18,54 → 3,26 s**, Chrome-Auswertung **101,34 → 82,78 s**. Das ist eine lokale Gegenmessung, kein allgemeines Laufzeitversprechen.
- Große Spielberichte werden nach der Aufnahme als JSON in begrenzten Textstücken übertragen. Vergleichsberichte zeigen auch die einzelnen CPU-Abschnitte und warnen bei deutlich unterschiedlichem beobachtetem Lobby-Frametakt.
- Augen- und Lichtquads vermeiden wiederholtes Packen unveränderlicher Animationseigenschaften. Energiekugeln erneuern Emissionsgeometrie und Skalierungsparameter nur bei Änderungen. Form, Menge und Animation der Effekte bleiben erhalten.
- Projektilspuren übertragen nur geänderte Pufferbereiche und zeichnen den ungenutzten Pufferabschluss nicht. Shader und der begrenzte Spurpufferpool werden über mehrere Ladeframes vorbereitet; die vorhandene Ladefreigabe wartet darauf.

## Repräsentative Abdeckung

Der Parcours wächst von **26 auf 29 Fälle**. Die drei Ergänzungen benötigen zusammen **38 Sekunden Mess- und Nachlaufzeit**, zuzüglich normalem Laden und Rückweg:

| Ergänzung | Zusätzlicher Schutzwert |
|---|---|
| `environment.dawn` | Uferbewegung bei authored 06:00 Uhr, Wasser, sichtbare Fische/Wildlife und reagierender Bodennebel |
| `weapon.hydra` | Aufteilung am Felskontakt, nachführende Split-Projektile und tatsächliche Treffer |
| `utility.time-bubble` | Regulär geworfenes Zeitfeld mit Fokus, Resonanz und Prismenspirale; aktive Darstellung, Prismengeschosse und Treffer |

Viele bisherige Waffenfälle enthalten bereits umfangreiche Upgrades, etwa P90, Plasma, Mini-Raketen, Shotgun, Molotov und Smoke. Deshalb wurden eigenständige fehlende Mechaniken ergänzt, statt weitere ähnliche Waffenvarianten aufzunehmen. Umgebung und Tag-/Nachtkampf protokollieren jetzt sichtbare Tierarten und Nebelaktivität. Eine vollständige Waffen-, Klassen-, Karten- oder Mehrspieler-Matrix ist das weiterhin nicht.

**Gefundene Messlücke:** Ältere Performance-Builds schalteten Bodennebel grundsätzlich ab. Ab `reference-1-candidate.6` ist er aktiviert und in den Messbedingungen ausgewiesen. Alte Gesamtergebnisse ohne Nebel sind deshalb keine direkte Baseline für den erweiterten Parcours.

## Gezielte Gegenmessung mit aktivem Nebel

Zwei unmittelbar aufeinanderfolgende 30-Sekunden-Paare verwenden den erweiterten Parcours, aktivierten Nebel und das reduzierte Aufnahmeprofil (Reihenfolge Ausgangsstand → Optimierung → Ausgangsstand → Optimierung). Die Lobby-Mediane betragen jeweils 7,6 ms; beide Vergleiche melden keine abweichenden Messbedingungen.

| `enemies.high`, Paar 1 | Ursprünglich | Optimiert |
|---|---:|---:|
| Durchschnittliche FPS | 37,82 | 40,36 |
| p95 Frame-Abstand | 37,2 ms | 31,2 ms |
| Median visueller Update-Abschnitt | 3,9 ms | 3,1 ms |
| Mediane gemessene GPU-Zeit | 7,95 ms | 7,59 ms |
| Mittlerer Gegnerbestand | 240 | 240 |
| Mittlerer Projektilbestand | 173,54 | 176,42 |

| `enemies.high`, Paar 2 | Ursprünglich | Optimiert |
|---|---:|---:|
| Durchschnittliche FPS | 38,81 | 40,08 |
| p95 Frame-Abstand | 31,6 ms | 31,3 ms |
| Median visueller Update-Abschnitt | 3,7 ms | 3,1 ms |
| Mediane gemessene GPU-Zeit | 8,23 ms | 7,57 ms |
| Mittlerer Gegnerbestand | 240 | 240 |
| Mittlerer Projektilbestand | 173,64 | 175,25 |

Beide Paare zeigen **3,3–6,7 % mehr FPS**, **16–21 % weniger visuellen CPU-Aufwand** und **5–8 % weniger gemessene GPU-Zeit**. Die p95-Verbesserung streut dagegen von knapp 1 % bis 16 %; ein entsprechend gleichmäßiger Gewinn bei langsamen Frames ist nicht belegt. Das sind beobachtete Unterschiede aus wiederholten Aufnahmen, kein Signifikanztest.

[Vergleichspaar 1 mit Nebel](../build/performance-results/comparison-1790451388956/comparison.md), [Vergleichspaar 2 mit Nebel](../build/performance-results/comparison-1790451596237/comparison.md).

## Frühere gezielte Gegenmessung mit JS-Sampling

Ryzen 7 5800X, RTX 3080, 32 GB RAM, Chrome 153, 1920 × 1080, DPR 1, hohe Grafikqualität. Diese beiden 30-Sekunden-Läufe benutzen dieselbe frühere Szenarioversion ohne Nebel und das Standardprofil mit JS-Sampling. Der Gegnerbestand bleibt bei 240; die tatsächlich aktiven Projektile schwanken leicht.

| `enemies.high` | Ursprünglich | Optimiert |
|---|---:|---:|
| Durchschnittliche FPS | 30,63 | 32,14 |
| p95 Frame-Abstand | 42,5 ms | 42,4 ms |
| Mediane gemessene GPU-Zeit | 13,60 ms | 10,53 ms |
| Median visueller Update-Abschnitt | 3,9 ms | 3,2 ms |

Das entspricht hier **rund 5 % mehr FPS und 23 % weniger GPU-Zeit**. Ein weiteres Paar zeigte ebenfalls etwa 23 % weniger GPU-Zeit. Das sind beobachtete Unterschiede; insbesondere einzelne Maximalframes, schwankende Projektilbestände und der Bildschirmtakt dürfen nicht als gesicherter allgemeiner Gewinn interpretiert werden. Die hohe Gegnerlast bleibt auch CPU-seitig teuer.

- [Gezielte Baseline](../build/performance-results/2026-09-26T17-53-31.014Z-04c250ed/summary.md)
- [Gezielter optimierter Lauf](../build/performance-results/2026-09-26T17-55-48.790Z-74abe8ad/summary.md)
- [Direkter Vergleich](../build/performance-results/comparison-1790449949779/comparison.md)
- [Exakte Gegenprüfung der Offline-Auswertung](../build/performance-results/offline-optimization-check.json)

## Gesamtabgleich und Grenzen

Die vollständige ursprüngliche Aufnahme ohne Nebel ist erhalten:
[26-Fälle-Baseline](../build/performance-results/2026-09-26T17-16-42.857Z-783180f0/summary.md).

Zwei erweiterte Standardläufe mit JS-Sampling durchliefen die Spieltests, stürzten aber beim abschließenden Lobby-Rückweg im Chrome-Renderer ab: einmal mit ursprünglichen und einmal mit optimierten Renderern. Sie sind ausdrücklich **keine vollständigen Ergebnisse**. Festplatte und gemessener JavaScript-Heap waren nicht ausgeschöpft; diese Werte erklären die Absturzursache nicht. [Fehlerbeleg Ausgangsstand](../build/performance-results/2026-09-26T18-24-49.011Z-80c43db3/manifest.json), [Fehlerbeleg Optimierung](../build/performance-results/2026-09-26T19-40-04.314Z-0fe48db9/manifest.json).

Deshalb verwendet der vollständige Parcours jetzt standardmäßig `reduced`; gezielte Tests behalten das Standardprofil mit JS-Sampling. Explizite Profilangaben bleiben möglich. Spielumfang, Qualität und Spielprofiler bleiben gleich. Das ist eine begrenzte Umgehung des beobachteten Problems, keine behauptete Reparatur des ungeklärten Renderer-Absturzes.

Der abschließende Zeitfeld-Einzeltest mit dem endgültigen Build und automatischer Profilauswahl wurde im Standardprofil vollständig aufgenommen und exportiert: [Abschlussprüfung des Einzeltest-Ablaufs](../build/performance-results/2026-09-26T19-57-39.203Z-6b9dc828/summary.md).

Der erweiterte Gesamtabgleich wurde deshalb auf beiden Seiten mit demselben vorhandenen reduzierten Aufnahmeprofil ausgeführt. Beide Aufnahmen sind vollständig, alle 29 Fälle haben ihre Funktionsprüfungen bestanden. Dieses Profil erhält Spiel-, Frame-, CPU-Abschnitts- und GPU-Messungen; JavaScript-Sampling von Chrome fehlt. Die ursprünglichen Renderer stammen aus Commit `e0b19af82f1c021e150adce73a6fd4ac1bce716d`, die Lab-Fälle und aktivierter Nebel sind auf beiden Seiten gleich. Die optimierten Arbeitsdateien wurden nach Archivierung der Vergleichsversion unverändert wiederhergestellt.

**Die beobachtete Grundtaktung änderte sich zwischen diesen beiden langen Aufnahmen:** Der Lobby-Median beträgt 6,1 bzw. 7,6 ms. Der Vergleich warnt ausdrücklich davor. Beispielsweise laufen die Umgebungsfälle mit rund 164 bzw. 132 FPS. Im Tageskampf schwankt zudem der mittlere Gegnerbestand von 71 auf 85. Aus diesen Gesamtergebnissen lässt sich kein allgemeiner FPS-Gewinn oder -Rückschritt ableiten. Auch der kurze Hochlastfall streut stark (39,13 bzw. 27,78 FPS); deshalb wurden die längeren unmittelbaren Gegenmessungen oben ausgeführt. Die hohe Gegnerlast bleibt ein Engpass und erreicht das 120-FPS-Ziel nicht.

Der Median der gemessenen Arena-Ladephasen beträgt 7,07 bzw. 7,25 Sekunden. Einzelne spätere Übergänge dauern deutlich länger und bleiben im Bericht sichtbar. Ein allgemeines Verschwinden aller Nachladeruckler ist durch diese Messungen nicht belegt.

- [Erweiterte vollständige Baseline](../build/performance-results/2026-09-26T18-42-18.953Z-3ab92a2c/summary.md)
- [Erweiterter vollständiger optimierter Lauf](../build/performance-results/2026-09-26T19-17-45.436Z-cfa869fd/summary.md)
- [Gesamtvergleich mit Bedingungswarnung](../build/performance-results/comparison-1790451178234/comparison.md)

Ein vorheriger optimierter Durchlauf wurde nach beendeter Aufnahme während eines zu langsamen Berichtsexports abgebrochen. Die Ursache im Transferpfad wurde korrigiert: Der JSON-Text verbleibt jetzt in einem Browser-Objekt, statt als primitiver String bei Protokollaufrufen erneut vollständig übertragen zu werden. Der anschließende Gesamtlauf hat den rund 70 MB großen Spielbericht erfolgreich exportiert.

## Prüfung

- `npm run check` auf dem endgültigen Stand: 4.406 Kern- und 54 Architekturtests sowie Produktions- und Map-Editor-Build erfolgreich.
- Integration: 610 Tests erfolgreich.
- Passende Stressprüfungen für VoidFire, Bodennebel, Augen und Arena-Laden erfolgreich.
- Die zusätzlich ausgeführte gesamte Stress-Suite meldet einen unabhängig reproduzierbaren Fehler in `NavigationSpawns.test.ts`: Map 7, Seed 731, Encounter `medic-3` erzeugt 74 statt erwarteter 77 Gegner. Spawn- und Navigationsregeln wurden in dieser Performance-Arbeit nicht verändert.

Die Renderprüfungen sichern Byte-Parität zum installierten Phaser-Packer, vollständige GPU-Pufferinhalte nach Teilupdates, Nachholen übersprungener Versionen und die Ladefreigabe erst nach Shader-/Puffervorbereitung. Weitere Tests sichern unveränderliche Archive, Speicherreserve, komprimierten Trace-Transfer und Ergebnisübertragung.

Die Arbeit endete nach rund 2 Stunden 50 Minuten innerhalb des vereinbarten Limits. Abschließend waren noch rund **19,1 GiB frei**; die vorgegebene Reserve von mindestens 1 GB wurde eingehalten. Ältere Ergebnisarchive wurden nicht gelöscht.

Bedienung und Messverträge: [Performance-Lab](performance-lab.md).
