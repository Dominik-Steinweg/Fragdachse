# Performance-Iteration vom 8./9. Oktober 2026

**Abgeschlossen:** Die Blutflecken-Zuordnung wurde in zwei gemessenen Schritten
optimiert. Im direkten Vergleich sinkt die CPU-Zeit bei 300 Gegnern um 23,4 %,
bei 500 Gegnern um 36,3 % und im gemischten Kampf um 5,2 %; Map 15 bleibt praktisch
gleich. Diese Werte gelten für die unten beschriebenen Szenarien, einschließlich
der Einschränkungen durch unterschiedliche dynamische Last bei starker Überlastung.

Über beide Runden wurden 17 unprofilierte Vergleichsserien mit 114 Browserläufen
abgeschlossen, davon 54 Läufe direkt zwischen Ausgangsbuild und beibehaltenem Stand.
Der bestehende Vergleicher meldet keine Abweichung seiner geprüften Workload-Verträge;
alle Läufe bestehen seine Browserfehler-Prüfung. Der beibehaltene Stand besteht
6.245 Tests, alle drei Builds und den kalibrierten Bildvergleich. Drei weitere
lokale Optimierungskandidaten wurden mangels messbaren Gewinns verworfen.

Das geplante Zeitfenster war der 8. Oktober 23:53 bis 9. Oktober 05:53 Uhr
Europe/Berlin. Der letzte laufende Vergleich endete am 9. Oktober um 05:02:23 Uhr,
etwa 5 Stunden 9 Minuten nach Beginn. Nach dem letzten aktiven Fortschritt kam
erst um 08:30 Uhr ein weiterer Wecklauf an. Deshalb wurden die vorbereitete
abschließende CPU-Profilaufnahme, der Tag-/Nacht-/Erholungsvergleich und eine späte
300-Gegner-Wiederholung nicht gestartet. Es wird keine durchgehende sechsstündige
Messung behauptet. Der Abschluss erfolgte anschließend ohne neue Messreihen;
die Automation ist deaktiviert. Lokale Fortschrittsnotizen:
`build/perf-six-hour-20261008/progress.md`.

## Direkter Vergleich des beibehaltenen Stands

Diese neuen Serien vergleichen den unveränderten ursprünglichen Build direkt mit
dem vollständig geprüften Stand aus Runde 2. Je drei High-Paare laufen abwechselnd;
die dichten Gegnerfälle haben 30 Sekunden Warmup. Alle fünf Serien sind vollständig.
Tabellenwerte sind Mediane der drei jeweiligen Laufstatistiken, keine gepoolten
Frames oder Signifikanztests. CPU-Zeit und Frameabstand werden getrennt ausgewiesen.

| Fall | CPU-Mittelwert vorher → nachher | Änderung | CPU-p95 vorher → nachher | Frame-p95 vorher → nachher |
|---|---:|---:|---:|---:|
| 300 Gegner | 42,720 → 32,721 ms | −23,4 % | 77,0 → 49,2 ms | 76,1 → 52,5 ms |
| 500 Gegner | 104,218 → 66,367 ms | −36,3 % | 174,8 → 119,3 ms | 213,5 → 120,0 ms |
| Map 15 | 7,849 → 7,863 ms | +0,2 % | 11,0 → 10,8 ms | 15,3 → 15,2 ms |
| Armageddon | 7,357 → 7,128 ms | −3,1 % | 8,4 → 8,3 ms | 8,1 → 8,1 ms |
| Gemischter Kampf | 14,024 → 13,291 ms | −5,2 % | 21,8 → 19,5 ms | 23,2 → 22,7 ms |

Bei 300 Gegnern liegen die drei CPU-Mittelwerte vorher bei 43,136 / 42,369 / 42,720 ms,
nachher bei 32,982 / 32,721 / 32,510 ms. CPU-p99 sinkt von 93,3 auf 59,3 ms. Alle
Läufe haben dieselbe Gegnerzahl, denselben Layout-Fingerprint und 300 vorbereitete
Schattenwerfer. Die Projektilspitzen liegen vorher bei 331 / 317 / 324 und nachher
bei 334 / 337 / 320. Es gibt keine Workload-Warnung des bestehenden Vergleichers.
Die GPU-Renderphase liegt bei 10,433 → 6,805 ms, obwohl keine Shader-Änderung
vorgenommen wurde; dies wird als Laufbeobachtung und nicht als eigene GPU-Optimierung
ausgewiesen. Die Grenzen der zeitabhängigen Simulation gelten weiterhin.
Evidenz: `build/perf-six-hour-20261008/final-enemies300/suite.json`.

Bei 500 Gegnern liegen die CPU-Mittelwerte vorher bei 110,897 / 104,218 / 100,615 ms,
nachher bei 66,367 / 65,549 / 68,173 ms. CPU-p99 sinkt von 307,0 auf 154,1 ms.
Alle Läufe halten 500 Gegner und 500 vorbereitete Schattenwerfer bei gleichem
Layout. Die Projektilspitzen unterscheiden sich jedoch: 729 / 599 / 814 gegenüber
528 / 539 / 599. Der Gewinn ist deshalb ein beobachtetes Gesamtergebnis der
überlasteten, zeitabhängigen Simulation mit unterschiedlicher Projektilpopulation.
Er darf nicht vollständig als Einsparung bei identischer Arbeit interpretiert
werden. Auch der optimierte Fall erreicht keine flüssigen 60 FPS.
Evidenz: `build/perf-six-hour-20261008/final-enemies500/suite.json`; keine Warnung
der vom bestehenden Vergleicher geprüften Workload-Verträge.

Map 15 bleibt insgesamt praktisch gleich. Alle sechs Läufe erreichen beide
Bossphasen, 4.896 permanente Feuerzellen, eine Nuke und sieben Meteore; das Layout
ist identisch. Die CPU-Zeit der zweiten Phase liegt bei 9,301 → 9,127 ms (−1,9 %).
Die Post-Update-Spanne des gesamten Falls steigt noch von 0,115 auf 0,146 ms.
Armageddon liegt mit dem zweiten Stand leicht unter dem Ausgangsbuild; der zuvor
bei Runde 1 gemessene Rückschritt erscheint hier nicht mehr. Seine Frame-p95 bleibt
gleich. Beide Vergleiche haben keine Workload-Warnung. Evidenz:
`final-map15/suite.json` und `final-armageddon/suite.json` unter dem Artefaktverzeichnis.

Der gemischte Kampf erzeugt weiterhin 162 Gegner und vier Gebäude auf identischem
Layout. CPU-p99 sinkt von 32,1 auf 25,7 ms; die geringe Verbesserung des Frameabstands
bleibt deutlich kleiner als die CPU-Einsparung. Die CPU-Mittelwerte der einzelnen
Läufe betragen vorher 14,897 / 14,024 / 13,939 ms, nachher 13,538 / 13,291 / 13,028 ms.
Lebende Gegner und Treffer variieren zeitabhängig, ohne Warnung des bestehenden
Vergleichers. Evidenz: `final-combat/suite.json`.

## Abschließender High-/Low-Parcours

Weitere zwölf unprofilierte Läufe vergleichen den ursprünglichen Build mit dem
beibehaltenen Stand über den kompletten `review`-Katalog. Je drei Paare pro
Qualitätsstufe sind vollständig, ohne Warnung der geprüften Workload-Verträge.
Hier gelten regulär zwei Sekunden Warmup pro Fall.

| Fall | High vorher → nachher | Änderung | Low vorher → nachher | Änderung |
|---|---:|---:|---:|---:|
| 100 Gegner | 13,627 → 13,116 ms | −3,7 % | 10,635 → 10,256 ms | −3,6 % |
| 300 Gegner | 39,601 → 31,308 ms | −20,9 % | 33,269 → 25,738 ms | −22,6 % |
| 500 Gegner | 367,772 → 101,545 ms | −72,4 % | 154,893 → 93,197 ms | −39,8 % |
| Spieler | 5,313 → 5,147 ms | −3,1 % | 4,081 → 4,108 ms | +0,7 % |
| Nebel/Felsen | 5,419 → 5,389 ms | −0,6 % | 4,586 → 4,447 ms | −3,0 % |
| Kamera | 6,769 → 6,724 ms | −0,7 % | 5,979 → 5,786 ms | −3,2 % |
| Explosionen | 5,662 → 5,563 ms | −1,7 % | 4,519 → 4,545 ms | +0,6 % |
| Zug | 4,957 → 5,018 ms | +1,2 % | 4,069 → 3,984 ms | −2,1 % |
| Armageddon | 10,224 → 10,406 ms | +1,8 % | 8,611 → 8,541 ms | −0,8 % |
| Gemischter Kampf | 19,525 → 18,499 ms | −5,3 % | 15,650 → 15,039 ms | −3,9 % |

Die Tabelle enthält mediane CPU-Mittelwerte pro Frame. Kleine Rückschritte in
einzelnen leichten Fällen bleiben sichtbar. Ihr Szenarienvorlauf unterscheidet
sich von den isolierten Messungen. Der extrem überlastete 500-Gegner-Fall mit
kurzem Warmup erreicht vorher eine CPU-p95 von 1.181 ms; sein Gewinn von 72 %
ist kein allgemeiner Performancegewinn. Für länger laufende dichte Gegnerlast
gelten die oben ausgewiesenen separaten Vergleiche mit 30 Sekunden Warmup.
Evidenz: `final-review/suite.json` und `final-review-comparison.json`.

## Low mit vierfacher CPU-Drosselung

Chrome-CDP drosselt ausschließlich die Seiten-CPU mit Faktor 4; GPU und Rechner
bleiben dieselben. Dies simuliert CPU-Druck und ersetzt keine Prüfung auf einem
physischen schwachen Gerät. Je drei Low-Paare verwenden die unveränderten Builds.

| Fall | CPU-Mittelwert vorher → nachher | Änderung | CPU-p95 vorher → nachher | Frame-p95 vorher → nachher |
|---|---:|---:|---:|---:|
| 100 Gegner, 30 s Warmup | 146,164 → 121,378 ms | −17,0 % | 220,3 → 142,4 ms | 234,1 → 148,3 ms |
| Gemischter Kampf, 2 s Warmup | 213,664 → 136,846 ms | −36,0 % | 1.019,2 → 306,5 ms | 1.027,4 → 309,4 ms |

Alle sechs Läufe halten 100 Gegner auf gleichem Layout. Die Projektilspitzen liegen
vorher bei 198 / 178 / 175, nachher bei 150 / 136 / 135. Die starke Überlastung
verändert die dynamische Population; der beobachtete Gewinn ist kein Vergleich
bitidentischer Simulationsarbeit. Die CPU-Zeiten bleiben sehr hoch, und die
GPU-Messung steigt von 10,279 auf 10,733 ms. Keine Workload-Warnung des bestehenden
Vergleichers. Evidenz: `final-low100-cpu4/suite.json`.

Auch der gedrosselte Kampf ist mit allen sechs Läufen vollständig. Die drei
CPU-Mittelwerte betragen vorher 203,852 / 213,664 / 234,742 ms, nachher
136,846 / 134,898 / 142,853 ms. Alle Läufe erzeugen 162 Gegner in vier Wellen und
vier Gebäude auf gleichem Layout. Die Projektilspitzen liegen jedoch bei
446 / 400 / 471 gegenüber 281 / 269 / 260; auch Treffer und verbleibende Gegner
unterscheiden sich erheblich. Die extreme Überlastung bleibt bestehen. Der Gewinn
ist daher eine Beobachtung des Gesamtszenarios und keine isolierte Einsparung bei
identischer Arbeit. Die Post-Update-Spanne steigt von 0,707 auf 2,727 ms, die
GPU-Messung bleibt mit 11,503 → 11,523 ms praktisch gleich. Keine Workload-Warnung;
Evidenz: `final-lowcombat-cpu4/suite.json`.

## Runde 1: Blutflecken unter hoher Gegnerlast

Ausgangspunkt ist `63e3126a6ed597f295efc9d475c95a14603df410`, mit sauberem Working Tree
vor Beginn. Ein gesonderter CPU-Profillauf über den bestehenden `review`-Katalog
identifiziert `BloodStainBatch.add` als größten Anwendungshotspot bei 300 und
500 Gegnern: Jeder neue Fleck durchsucht rückwärts die gesamte Display-Liste nach
dem vorhergehenden Objekt gleicher Tiefe. Die Stichproben ergeben dort 1,22 bzw.
1,81 Sekunden Selbstzeit während der jeweils zwölf Sekunden langen Messphase;
Depth-Getter verursachen zusätzliche Kosten. Profilierte Framezeiten werden nicht
als Vergleichsmessung verwendet.

[BloodStainBatch.ts](../src/effects/BloodStainBatch.ts) sammelt neue Flecken jetzt
bis zum Post-Update und ermittelt ihre Gruppen mit einem gemeinsamen Durchlauf.
Neue GPU-Layer ersetzen den jeweiligen Lauf an seiner ursprünglichen Position.
Gegner gleicher Tiefe unterbrechen weiterhin einen Lauf; unterschiedliche Tiefen
dürfen dieselbe Gruppe nicht falsch verbinden. Die ursprünglichen Images bleiben
Tween-Ziele. Auch vor dem nächsten Render abgelaufene oder durch World-Teardown
gelöschte Flecken werden freigegeben.

### Messbedingungen

- Vorher/Nachher als getrennte, unveränderte Performance-Lab-Builds.
- Je drei Läufe, Reihenfolge A/B, B/A, A/B, frische Chrome-Profile.
- High, 1920 × 1080, DPR 1, CPU-Drosselung 1.
- Dichte Gegnerszenarien mit 30 Sekunden Warmup und vorbereiteten Schatten-Meshes.
- Ryzen 7 5800X, RTX 3080, 32 GiB RAM, Chrome 154.0.8037.98.
- Keine parallelen Builds, Tests oder zweiten Messbrowser während der Messung.
- Tabellenwerte sind Mediane der drei jeweiligen Laufstatistiken, keine gepoolten Frames.

### 300 Gegner

| Messgröße | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| CPU pro Frame, Mittelwert | 52,764 ms | 41,287 ms | −21,8 % |
| CPU pro Frame, p95 | 69,5 ms | 52,5 ms | −24,5 % |
| CPU pro Frame, p99 | 86,2 ms | 64,1 ms | −25,6 % |
| Frameabstand, p95 | 72,6 ms | 54,5 ms | −24,9 % |
| GPU-Renderphase, Mittelwert | 5,915 ms | 5,882 ms | praktisch gleich |

Die CPU-Mittelwerte streuen vorher zwischen 50,86 und 55,90 ms, nachher zwischen
39,78 und 46,33 ms. Alle sechs Läufe halten 300 Gegner; die Projektilspitzen betragen
vorher 329/351/362 und nachher 332/323/340. Der bestehende Vergleicher meldet keine
Abweichung der geprüften Workload-Verträge. Die Simulation läuft zeitabhängig und
ist trotz gleichem Seed kein bitidentisches Replay.

Die Post-Update-Kosten steigen erwartungsgemäß von 0,367 auf 1,397 ms, weil die
Zuordnung nun dort gebündelt statt bei jedem Treffer stattfindet. Die gesamte
CPU-Framezeit enthält diese zusätzliche Arbeit bereits. Es wird kein GPU- oder
allgemeiner FPS-Gewinn aus einer einzelnen verschachtelten Messspanne abgeleitet.

### 500 Gegner

| Messgröße | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| CPU pro Frame, Mittelwert | 106,349 ms | 66,061 ms | −37,9 % |
| CPU pro Frame, p95 | 223,9 ms | 119,1 ms | −46,8 % |
| CPU pro Frame, p99 | 291,7 ms | 140,3 ms | −51,9 % |
| Frameabstand, p95 | 226,5 ms | 121,1 ms | −46,5 % |

Alle sechs Läufe halten 500 Gegner. Die CPU-Mittelwerte liegen vorher bei
104,08–112,58 ms und nachher bei 64,49–66,75 ms. Die Projektilspitzen unterscheiden
sich deutlicher: vorher 648/733/637, nachher 493/538/604. Diese stark überlastete,
zeitabhängige Simulation liefert daher einen beobachteten Gesamtgewinn mit
unterschiedlicher Projektilpopulation; die gesamte Differenz lässt sich nicht als
isolierte Einsparung im Blutflecken-Code ausweisen. Auch die niedrigere GPU-Messung
ist kein Beleg für eine separate Shader-Optimierung. Die Szene bleibt trotz des
Gewinns weit von flüssigen 60 FPS entfernt.

### Gemischter Kampf

Der vorhandene Fall `combat.day` verwendet zwei Sekunden Warmup und 30 Sekunden
Messzeit. Alle sechs Läufe erzeugen 162 Gegner, vier Wellen und vier Gebäude.

| Messgröße | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| CPU pro Frame, Mittelwert | 14,066 ms | 13,476 ms | −4,2 % |
| CPU pro Frame, p95 | 21,6 ms | 18,9 ms | −12,5 % |
| CPU pro Frame, p99 | 31,3 ms | 26,5 ms | −15,3 % |
| Frameabstand, p95 | 23,1 ms | 22,9 ms | praktisch gleich |
| GPU-Renderphase, Mittelwert | 3,651 ms | 3,614 ms | praktisch gleich |

Die drei CPU-Mittelwerte liegen vorher zwischen 13,705 und 14,562 ms, nachher
zwischen 13,226 und 13,700 ms. Die Gameplay-Spanne bleibt mit etwa 2,94 ms gleich.
Die geringere CPU-Last ergibt in diesem Szenario keinen entsprechend großen
Bildratengewinn. Lebende Gegner, Projektile und Treffer entwickeln sich trotz
gleicher Ausgangsparameter zeitabhängig; die Vergleiche sind Beobachtungen dieser
Läufe und keine deterministischen Replays.

### Map 15: kein Gesamtgewinn

Die drei Vergleichspaare von `boss.map15` erreichen beide Bossphasen, jeweils
4.896 permanente Feuerzellen, eine Nuke und sieben Meteore. Der Layout-Fingerprint
ist gleich, die Gegnermaxima liegen zwischen 47 und 50. Der Vergleicher meldet
keine Abweichung der geprüften Workload-Verträge.

| Messgröße | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| CPU pro Frame, Mittelwert | 7,885 ms | 7,927 ms | +0,5 % |
| CPU pro Frame, p95 | 10,9 ms | 11,3 ms | +3,7 % |
| CPU pro Frame in Phase 1 | 5,071 ms | 5,025 ms | −0,9 % |
| CPU pro Frame in Phase 2 | 9,221 ms | 9,417 ms | +2,1 % |
| Post-Update, Mittelwert | 0,121 ms | 0,184 ms | +0,063 ms |
| Frameabstand, p95 | 15,2 ms | 15,2 ms | unverändert |

In dieser Szene verbessert die Änderung die Gesamtperformance nicht. Der neue
Post-Update-Durchlauf kostet unter niedrigerer Trefferlast etwas zusätzliche Zeit.
Die CPU-Mittelwerte aller Läufe betragen vorher 7,511 / 7,954 / 7,885 ms und
nachher 7,574 / 8,849 / 7,927 ms. Der langsame zweite optimierte Lauf bleibt in
der Auswertung; seine Ursache ist nicht belegt. GPU-Zeit und Draw Calls ändern
sich um +2,7 % bzw. +0,9 %. Die Änderung wird wegen des klaren Gewinns unter dichter
Gegnerlast beibehalten, ohne einen allgemeinen Geschwindigkeitsgewinn zu behaupten.

### Bildtreue und Korrektheit

Ein eingefrorener realer Map-15-Zustand mit 480 Blutflecken in sechs Gruppen wurde
bei Zoom 0,65, 1 und 1,4 gegen normale Phaser-Images desselben Zustands gerendert.
Wiederholte Referenzbilder sind pixelidentisch. Zwischen Referenz und GPU-Layern
weichen 221, 566 bzw. 1.025 von 2.073.600 Pixeln ab, maximal zwei Farbwerte pro Kanal
und höchstens 0,05 % der Pixel. Der vorhandene Rastervergleich besteht; das
Kandidatenbild wurde zusätzlich angesehen. Ergebnisse:
`build/perf-six-hour-20261008/round1-parity/evidence.json`.

- `npm run check` besteht mit vier Vitest-Workern: 5.464 Core-Tests, 54
  Architekturtests, Spiel-, Map-Editor- und Balance-Editor-Build.
- Die vollständige Integrationssuite besteht: 726 Tests.
- Bestehende Tests schützen Reihenfolge zwischen gleich tiefen Gegnern, Tween-Werte,
  Ablauf vor dem ersten Render, Scene-Shutdown und World-Clear.
- `git diff --check` besteht.

Der Renderkatalog wurde an die neue Erzeugungsstelle angepasst. Zwei bereits im
Ausgangsstand defekte Integrations-Fixtures wurden korrigiert: eine fehlende
Renderer-Angabe und ein Dekorationstest, dessen Fixture die geprüfte Dekoration
deaktivierte. Die ursprüngliche Laufzeitversion reproduziert alle fünf betroffenen
Fehler (`baseline-integration.log`). Ein unveränderter Wildlife-Test überschritt
bei hoher Testparallelität einmal seine vorhandene Fünf-Sekunden-Grenze; isoliert
und im vollständigen Lauf mit vier Workern besteht er. Tests und Fristen wurden
nicht abgeschwächt.

### Reproduktion und Grenzen

```powershell
npm run perf:chrome -- --suite --sites build/perf-six-hour-20261008/round1-sites.json --output-root build/perf-six-hour-20261008/round1-enemies300 --runs 3 --qualities high --case review.enemies-300 --warmup-ms 30000 --max-c-growth-mib 8192
npm run perf:compare -- --suite build/perf-six-hour-20261008/round1-enemies300/suite.json --output build/perf-six-hour-20261008/round1-enemies300-comparison.json
```

Lokale Artefakte liegen unter `build/perf-six-hour-20261008/`: `baseline/site`,
`round1/site`, `round1.patch`, `round1-provenance.json`, `profile-baseline`,
`round1-enemies300`, `round1-enemies500`, `round1-combat`, `round1-map15`,
`round1-parity` und die Verifikationslogs. Diese Dateien sind
nicht versioniert. Der Diagnosekatalog wird vom Produktionsrenderer nicht importiert;
seine spätere Metadatenkorrektur verändert den gemessenen Build nicht.

Gemessen wird die lokale Host-Simulation auf einem Rechner. WebRTC-Transport und
physische Low-End-Geräte sind damit nicht geprüft. Der GPU-Timer erfasst die
vorhandene Renderphase, nicht sämtliche früheren Offscreen-Arbeiten. Gewinne in
anderen Szenarien müssen separat gemessen werden.

## Runde 2: verbliebene Hotspots untersuchen

### Breiter High-/Low-Parcours

Zwölf weitere unprofilierte Läufe vergleichen den vollständigen bestehenden
`review`-Katalog: je drei Paare auf High und Low, in wechselnder Reihenfolge.
Dieser Parcours verwendet das reguläre Warmup von zwei Sekunden pro Fall. Seine
Ergebnisse bleiben deshalb von den oben dokumentierten, länger aufgewärmten
Dichtelastmessungen getrennt.

Die folgende Tabelle zeigt die medianen CPU-Mittelwerte pro Frame. Alle zwölf
Läufe sind vollständig; der Vergleicher meldet keine Abweichung der geprüften
Workload-Verträge. Zeitabhängige Populationen und der Verlauf vorheriger Fälle
bleiben dennoch mögliche Einflussgrößen.

| Fall | High vorher → nachher | Änderung | Low vorher → nachher | Änderung |
|---|---:|---:|---:|---:|
| 100 Gegner | 13,907 → 13,035 ms | −6,3 % | 10,657 → 10,803 ms | +1,4 % |
| 300 Gegner | 40,004 → 31,001 ms | −22,5 % | 33,554 → 25,115 ms | −25,2 % |
| 500 Gegner | 289,867 → 101,967 ms | −64,8 % | 149,922 → 90,887 ms | −39,4 % |
| Spieler | 5,166 → 5,236 ms | +1,4 % | 4,276 → 4,133 ms | −3,3 % |
| Nebel/Felsen | 5,340 → 5,294 ms | −0,9 % | 4,499 → 4,530 ms | +0,7 % |
| Kamera | 6,729 → 6,755 ms | +0,4 % | 5,828 → 5,860 ms | +0,6 % |
| Explosionen | 5,510 → 5,459 ms | −0,9 % | 4,523 → 4,656 ms | +2,9 % |
| Zug | 5,024 → 5,240 ms | +4,3 % | 4,031 → 4,071 ms | +1,0 % |
| Armageddon | 10,264 → 10,719 ms | +4,4 % | 8,585 → 8,749 ms | +1,9 % |
| Gemischter Kampf | 19,886 → 18,608 ms | −6,4 % | 16,031 → 15,392 ms | −4,0 % |

Der extrem überlastete 500-Gegner-Fall mit kurzem Warmup ist kein Nachweis eines
allgemeinen Gewinns von 65 %. Maßgeblich für die länger laufende Dichtelast bleiben
die separaten 30-Sekunden-Warmups. Die schlechteren Werte leichter Fälle werden
nicht ausgeblendet; Zug und Armageddon wurden isoliert nachgeprüft. Lokale Evidenz:
`round1-review/suite.json`, `round1-review-comparison.json` und `summary.json` unter
`build/perf-six-hour-20261008/`.

Die abgeschlossene isolierte Zug-Nachprüfung mit drei weiteren High-Paaren
reproduziert die Verlangsamung nicht: CPU-Mittelwert 4,080 → 3,975 ms (−2,6 %),
CPU-p95 4,9 → 4,7 ms, Frame-p95 jeweils 8,1 ms. Beide Serien bleiben dokumentiert;
der isolierte Fall hat einen anderen Vorlauf als der vollständige Parcours.
Evidenz: `round1-train/suite.json` und `round1-train-comparison.json`.

Armageddon bestätigt in drei isolierten High-Paaren einen kleinen Rückschritt:
CPU-Mittelwert 7,146 → 7,517 ms (+5,2 %), CPU-p95 8,3 → 9,4 ms und Frame-p95
8,1 → 8,6 ms. Die Post-Update-Spanne steigt von 0,096 auf 0,302 ms. Die CPU-Mittelwerte
liegen vorher bei 7,554 / 7,045 / 7,146 ms und nachher bei 7,517 / 7,544 / 7,279 ms;
keine Warnung der geprüften Workload-Verträge. Dieser Fall war deshalb ein Ziel
der zweiten Blutflecken-Variante. Evidenz: `round1-armageddon/suite.json`.

### Verworfene Kandidaten

Das separate Profil des optimierten 300-Gegner-Falls mit 30 Sekunden Warmup zeigt
`EnemyLocomotion.solve` als größten Anwendungseintrag (391 ms gesampelte Selbstzeit
in zwölf Sekunden). Der bisherige Blutflecken-Eintrag liegt mit
`BloodStainBatch.flushPending` bei 151 ms. Weitere Kosten verteilen sich auf
Partikelverarbeitung, Renderübergabe, Physik und Speicherbereinigung. Auch dieser
Profillauf ist kein Vorher-Nachher-Zeitvergleich.

Ein lokaler Versuch prüft eine zusätzliche obere Schranke für die Bewertung von
Ausweichrichtungen. 428.160 Vergleiche mit dem unveränderten Solver liefern exakt
gleiche Bewegungsentscheidungen, einschließlich fortgesetzter Bewegung, Recovery,
wechselnder Geometrie und unterschiedlicher Körpergrößen. Die zusätzliche
Berechnung lohnt sich jedoch nicht: In zehn gewerteten, wechselnd angeordneten
Node-Läufen steigt die mediane Dauer des identischen Testkatalogs von 272,21 auf
278,27 ms (+2,2 %). Der Kandidat wird verworfen und wurde nicht in den
Produktionsquellcode übernommen. Lokale Evidenz:
`build/perf-six-hour-20261008/locomotion-experiment/result.json`.

Ein zweiter isolierter Kandidat überspringt das temporäre Float64-Schreiben und
Lesen für exakt vorhergesagte Projektilpfadwerte. 2.785 Prüfungen bestätigen
identische Werte einschließlich negativem Nullwert sowie dieselbe Ablehnung
beschädigter Payloads. In den aus der vorhandenen Codec-Stressprüfung abgeleiteten
Datensätzen mit acht und 200 Projektilen liegen die medianen Decoderzeiten aber
nahezu gleich: bei 200 Projektilen 1,205 → 1,203 ms mit festen und
2,273 → 2,280 ms mit wechselnden Physikintervallen. Der Kandidat wird ebenfalls
verworfen. Ein anfänglicher Fehler betraf nur den lokalen Prüfer, der explizit
`undefined` gesetzte optionale Felder mit vom Wire ausgelassenen Feldern verglich;
der strikte Vergleich beider Decoder bestand bereits. Zahlen wurden bei der
Korrektur nicht normalisiert. Evidenz: `flight-float-experiment/result.json`.

Ein dritter lokaler Versuch berechnet Attribute pro Endpunkt einer Projektilspur
einmal und kopiert die gepackten Float32-Werte auf ihre wiederholten Dreiecksvertices.
249 vollständige Puffer- und Lifecycle-Vergleiche stimmen bitgenau überein, darunter
scharfe Kurven, Regenbogenspuren, Geburt und Ende, Pooldruck und Bounce-Diagnostik.
Der Ansatz wird dennoch verworfen: Bei Poolgrößen 512 und 4.096 steigen die medianen
Zeiten des gleichen lokalen Ablaufs von 14,103 auf 14,221 ms bzw. von 14,908 auf
15,166 ms. Produktionscode und sichtbare Spuren bleiben hier unverändert.
Evidenz: `ribbon-copy-experiment/result.json`.

### Zweite Blutflecken-Variante beibehalten

Der verbliebene Durchlauf wird rückwärts ausgeführt und endet, sobald die
Vorgänger aller neuen Flecken gefunden sind. Die Gruppen behalten ihre ursprüngliche
Position und interne Reihenfolge. Ein zusätzlicher Test vergleicht die tatsächliche
Zeichenreihenfolge über 24 Folgen gemischter Tiefen, neuer und abgelaufener Flecken
mit gewöhnlichen Images.

Der erste Vergleich dieser Variante **gegen Runde 1**, jeweils drei High-Paare in
Armageddon, senkt die mediane CPU-Zeit von 7,367 auf 7,149 ms (−3,0 %), CPU-p95 von
8,8 auf 8,2 ms und die Post-Update-Spanne von 0,295 auf 0,147 ms. Diese Zahlen sind
kein direkter Vergleich zum ursprünglichen Ausgangsstand.
Evidenz: `round2-armageddon/suite.json`.

Der anschließende Vergleich mit 300 Gegnern und 30 Sekunden Warmup senkt die
Post-Update-Spanne ebenfalls: 1,107 → 0,691 ms (−37,6 %). Die gesamte CPU-Zeit
ändert sich nur von 33,461 auf 33,006 ms (−1,4 %), CPU-p95 von 50,6 auf 51,1 ms
und Frame-p95 von 53,0 auf 53,1 ms. CPU-p99 steigt von 58,5 auf 62,0 ms und die
GPU-Messung von 6,553 auf 7,303 ms; ein allgemeiner Zusatzgewinn wird daraus nicht
abgeleitet. Alle Läufe halten 300 Gegner mit vorbereiteten Schatten und gleichem
Layout; Projektilspitzen liegen bei 325 / 323 / 328 gegenüber 327 / 325 / 315.
Der bestehende Vergleicher meldet keine Workload-Warnung. Die absoluten Zeiten
unterscheiden sich auch vom früheren Messzeitpunkt; für den Abschluss wurden
deshalb neue direkte Vergleiche zum unveränderten Ausgangsbuild durchgeführt.
Evidenz: `round2-enemies300/suite.json`.

Die Bildprüfung mit 480 Flecken in vier Gruppen besteht bei Zoom 0,65 / 1 / 1,4:
207 / 607 / 1.058 abweichende Pixel von 2.073.600, maximal 2 / 3 / 2 Kanalwerte.
Die Fleckenzustände sind exakt gleich, aufeinanderfolgende Screenshots jedes
einzelnen Renderzustands sind pixelidentisch. Verwendet wird das bestehende
Verfahren aus `scripts/performance/suite-parity.mjs`: vier Referenzrenders zur
Kalibrierung bei unverändertem GPU-Dithering, Grenze 3/255 auf höchstens 0,1 % der
Pixel. Die Referenzen variieren selbst an 0 / 15 / 13 HUD-Pixeln um maximal einen
Kanalwert; außerhalb ihrer Wertebereiche liegen 207 / 607 / 1.045 Kandidatenpixel.
Drei frühere Versuche mit dem älteren lokalen Helfer scheiterten an dessen
zusätzlicher Annahme, auch jeder Referenz-Rerender müsse bitidentisch sein. Alle
Rohbilder und Fehlerbefunde bleiben erhalten; die Projektgrenzen wurden nicht
erhöht. Evidenz: `round2-parity-calibrated/evidence.json` und
`round2-parity-control-analysis.json`.

Die vollständige Prüfung dieses Stands besteht: 5.465 Core-Tests, 54
Architekturtests, 726 Integrationstests sowie Spiel-, Map-Editor- und
Balance-Editor-Build. Die Variante wird beibehalten. Fünf weitere direkte
Vergleichsserien zum ursprünglichen Build sind abgeschlossen: 300 und 500 Gegner,
Map 15, Armageddon und gemischter Kampf. Alle verwenden denselben unveränderten
Ausgangsbuild. Der breite High-/Low-Parcours des beibehaltenen Stands und beide
Low-Vergleiche mit vierfacher CPU-Drosselung sind ebenfalls abgeschlossen.

## Abschlussprüfung und Reproduktion des beibehaltenen Stands

- `npm run check` mit vier Vitest-Workern: 5.465 Core-Tests, 54 Architekturtests,
  Spiel-, Map-Editor- und Balance-Editor-Build erfolgreich; `round2-check.log`.
- Vollständige Integrationssuite: 726 Tests erfolgreich; `round2-integration.log`.
- Kalibrierter Vollbildvergleich bei drei Zoomstufen erfolgreich;
  `round2-parity-calibrated/evidence.json`. Die früheren fehlgeschlagenen
  Referenzkontrollen bleiben oben beschrieben und in den Rohdaten erhalten.
- Abschließender Datencheck: 17 vollständige unprofilierte Serien, 114 Läufe,
  366 Messfenster einschließlich Boss-Unterphasen, keine Workload-Warnung und
  keine aufgezeichneten Browserfehler; `final-audit.json` und `summary.json`.
- Die aufgezeichneten SHA-256-Werte für Laufzeitdatei, Kerntest, Renderkatalog und
  Build-Einstiegsdateien stimmen weiterhin mit Runde 2 überein. `git diff --check`
  besteht. Es wurden keine Grafikdetails, Effektlebenszeiten oder Spielregeln
  reduziert. Die Änderungen liegen lokal und sind nicht committed.

Der direkte Vergleich verwendet `final-sites.json`: `baseline/site` ist der
ursprüngliche Build, `round2/site` der beibehaltene Stand. Die folgenden Befehle
verwenden die vorhandenen Runner mit einem neuen Ausgabeverzeichnis:

```powershell
npm run perf:chrome -- --suite --sites build/perf-six-hour-20261008/final-sites.json --output-root build/perf-six-hour-20261008/reproduce-enemies300 --runs 3 --qualities high --case review.enemies-300 --warmup-ms 30000 --max-c-growth-mib 8192
npm run perf:compare -- --suite build/perf-six-hour-20261008/reproduce-enemies300/suite.json --output build/perf-six-hour-20261008/reproduce-enemies300-comparison.json
```

Die Builds, Rohdaten, Profile, Vergleichsskripte und Hash-Belege liegen lokal unter
`build/perf-six-hour-20261008/` und sind nicht versioniert. Der normale
Produktionsbuild enthält keine neue Messinfrastruktur. Die zwei separaten
CPU-Profile dienen ausschließlich der Hotspot-Suche. Die noch sichtbaren Kosten
verteilen sich auf Bewegungssuche, Partikel, Renderübergabe, Physik und
Speicherbereinigung; für den endgültigen Stand wurde kein weiteres Profil erhoben.

Es gibt keinen Signifikanztest, keinen Nachweis einer Speicherleckfreiheit über
lange Spielsessions und keine Messung des WebRTC-Transports. CPU-Drosselung ersetzt
keine reale schwache Hardware. Die kleinen Rückschritte einzelner leichter Fälle
und die neutralen Map-15-Ergebnisse bleiben Bestandteil des Befunds. Die separat
geplante Tag-/Nacht-Erholungsprüfung und die späte Wiederholung wurden nicht
ausgeführt; vorhandene Lifecycle-Tests ersetzen diese Laufzeitmessungen nicht.

Knowledge writeback: No durable project knowledge discovered.
