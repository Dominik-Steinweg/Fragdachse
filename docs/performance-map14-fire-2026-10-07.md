# Map 14: großflächiges Feuer – Performance-Vergleich

## Ergebnis

`hazards.map14-fire`, drei unprofilierte Läufe je Build, jeweils 30 Sekunden Messung
nach der Vorbereitung und zwei Sekunden Warmup. Die folgende Tabelle zeigt den
Median der drei jeweiligen Laufstatistiken; Frames unterschiedlicher Läufe werden
nicht zusammengelegt.

| Kriterium | Vorher | Nachher | Änderung |
|---|---:|---:|---:|
| CPU pro Frame, Mittelwert | 7,05 ms | 6,13 ms | −13,0 % |
| CPU pro Frame, p95 | 9,40 ms | 7,80 ms | −17,0 % |
| CPU pro Frame, p99 | 12,10 ms | 9,10 ms | −24,8 % |
| Renderübergabe auf CPU, Mittelwert | 3,89 ms | 3,26 ms | −16,3 % |
| Frameabstand, Mittelwert | 7,25 ms | 6,50 ms | −10,3 % |
| Frameabstand, p95 | 12,20 ms | 12,10 ms | nahezu unverändert |
| GPU-Renderphase, Mittelwert | 1,88 ms | 1,77 ms | −6,1 % |
| Draw Calls pro Frame, Mittelwert | 144,9 | 145,8 | nahezu unverändert |
| JS-Heap während der Aufnahme, Mittelwert | 728 MiB | 721 MiB | nahezu unverändert |
| Geschätzte Quelltexturen, RGBA8 | 1.101 MiB | 1.099 MiB | nahezu unverändert |

Alle optimierten Läufe liegen bei der mittleren CPU-Zeit unter allen Referenzläufen:
vorher 7,01–7,34 ms, nachher 6,07–6,45 ms. Der Gewinn betrifft hauptsächlich
CPU-Verwaltung und Renderübergabe. Die Frameabstände liegen vielfach bei etwa 6,1
oder 12,1 ms; die Verbesserung des CPU-Budgets beseitigt die längeren Frameabstände
nicht vollständig. Die gemessene GPU-Phase war hier nicht der größte Kostenblock.

## Änderungen

- `GroundHazardWarningRenderer`: Abgelaufene Warnbilder verlassen die Display-Liste.
  Der Pool bleibt wiederverwendbar, muss aber nach Ende der Feuerfront nicht mehr
  bei Tiefensortierung und Renderdurchlauf besucht werden. Die Synchronisierung
  deaktiviert nur die zuvor aktiven Bilder und durchläuft nicht jeden Frame den
  gesamten ehemaligen Warnband-Pool.
- `GroundFireClusterRenderer`: Lichtgeometrie und Rangfolge bleiben erhalten, solange
  sich der Snapshot nicht ändert und keine Ausblendphase beginnt. Änderungen,
  Ablauf und rückwärts korrigierte Zeit invalidieren die Auswahl. Aktive Lichter
  erhalten weiterhin jedes Frame ihre normale Lebensdauerbestätigung.
- Die CLI lässt `hazards.map14-fire` jetzt auch im einfachen Messaufruf zu.
- Der Suite-Runner bietet `--max-c-growth-mib` für eine explizit begrenzte zusätzliche
  Belegung auf C:. Der bisherige Standard von 128 MiB und die Mindestreserve von
  1 GiB bleiben erhalten. Für diese Messung wurden 2.048 MiB erlaubt; Chrome-Profile
  und Rohdaten liegen auf D:. Zwei früh abgebrochene Versuche mit dem alten Limit
  sind keine Messwerte.

Feuerdichte, Partikelparameter, Leuchtintensitäten, Schaden und Gegnerpläne wurden
nicht reduziert. Das erste CPU-Profil zeigte unter anderem hohe Selbstzeit bei
Phasers Tiefensortierung, Renderdurchlauf und `GroundFireClusterRenderer.syncLights`.

Die separaten CPU-Profile bestätigen die Kostenverschiebung. Auf einen gemessenen
Frame normierte Stichproben-Selbstzeit: `sortByDepth` etwa 0,25 → 0,05 ms,
`willRender` 0,18 → 0,06 ms und `syncLights` 0,12 → 0,01 ms. Das sind gesampelte
Funktionskosten, keine vollständigen inklusiven Laufzeiten; sie werden nicht zu
den oben gemessenen Framezeiten addiert.

## Messbedingungen und Grenzen

- Ryzen 7 5800X, RTX 3080 über ANGLE/D3D11, 32 GiB RAM; Chrome 154.0.8037.98.
- High, 1920 × 1080, DPR 1, CPU-Throttle 1, sichtbares Chrome-Fenster, frisches Profil
  pro Lauf. Brokerfreier lokaler Host über die vorhandenen Spielverträge.
- Seed `16092026`, Layout `f5d9b733`, 1.776 Felsen. In allen sechs Läufen durchgehend
  5.220 VoidFire-Zellen, davon mindestens 2.642 sichtbar.
- Gegnermaximum vorher jeweils 45, nachher 45/45/44. Dynamische Gegner-, Projektil-
  und Lichtzustände können trotz gleicher authored Last wegen der Echtzeitabläufe
  leicht variieren. Das Szenario verwendet die frühen Gegnerpläne mit beschleunigtem
  Feuer und ist kein gespeicherter Zustand der 90. Rundensekunde.
- Referenzläufe zuerst, danach optimierte Läufe; keine zufällig alternierende
  Reihenfolge. Die drei Wiederholungen zeigen eine konsistente Verbesserung auf
  diesem Rechner, ersetzen aber keinen Vergleich auf weiterer Hardware.
- Die GPU-Zeit umfasst den vorhandenen PRE_RENDER–POST_RENDER-Messbereich, nicht
  sämtliche vorherigen Offscreen-Arbeiten. Verschachtelte CPU-Bereiche dürfen nicht
  addiert werden. Kleine GPU-/Speicherunterschiede werden nicht als eigener
  Optimierungsnachweis gewertet. Heapwerte enthalten die Aufnahme; RGBA8-Werte sind
  keine vollständige VRAM-Messung.

## Reproduktion und Belege

Die getrennten Builds liegen unter `build/map14-optimization/{baseline,current}/site`.
Die jeweiligen `*-sites.json` binden diese Builds an das gemeinsame unveränderte
`public`-Verzeichnis. Aufruf für den optimierten Build:

```powershell
npm run perf:chrome -- --suite --sites build/map14-optimization/current-sites.json --output-root D:/perf/map14-20261007/current --runs 3 --qualities high --case hazards.map14-fire --max-c-growth-mib 2048
```

Für neue Wiederholungen ein neues Ausgabeverzeichnis wählen; abgeschlossene Läufe
werden andernfalls wiederverwendet. Ein gesonderter Lauf mit `--profile on` dient
der Funktionszuordnung und wird nicht mit unprofilierten Framezeiten vermischt.

- [Messwertübersicht und Einzelwerte](../build/map14-optimization/summary.json)
- [Referenzläufe](../build/map14-optimization/baseline-suite.json)
- [Optimierte Läufe](../build/map14-optimization/current-suite.json)
- [CPU-Profil vorher](../build/map14-optimization/profile-before-suite.json)
- [CPU-Profil nachher](../build/map14-optimization/profile-after-suite.json)

Die Build-/Messartefakte sind lokal und nicht Teil der Versionsverwaltung.

## Prüfung

- 5.425 Core-Tests bestanden, darunter die neuen Warnbild-Lifecycle- und Lichttests.
- Beide Fälle in `tests/stress/PerformanceLabVoidFire.test.ts` bestanden.
- Performance-Lab-, Spiel-, Map-Editor- und Balance-Editor-Build bestanden.
- `git diff --check` bestanden.
- `npm run check` ist insgesamt nicht grün: 53 von 54 Architekturtests bestanden.
  Der unveränderte `src/effects/ShockComboExplosionRenderer.ts:219` erzeugt ein
  Graphics-Objekt ohne Eintrag in `GRAPHICS_FAMILIES`; der bestehende Test
  `ArenaVisualAttribution.test.ts` meldet die fehlende Zuordnung. Die nach diesem
  Abbruch nicht gestarteten Builds wurden separat erfolgreich ausgeführt.

Eine visuelle Pixelvergleichssuite wurde nicht ausgeführt. Die Renderer-Tests
prüfen Wiederverwendung, Sichtbarkeit, Cleanup, unveränderte Lichtbestätigung,
Flächenwechsel, Ausblendung und Ablauf; die Browserläufe prüfen die reale Feuerlast.
