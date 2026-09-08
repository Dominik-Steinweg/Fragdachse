# Performance-Analyse: FRAGDACHSE, Map 6
Stand: 8. September 2026  
Ausrüstung laut Aufnahme: Plasma und Mini-Raketenwerfer.  
Repository-Prüfung: `Dominik-Steinweg/Fragdachse`, `main` bei `fb5acf7dbae653ccea3289c4e671fd27c37babef`.

## Ergebnis
Es gibt mehrere konkrete Optimierungsmöglichkeiten, ohne zunächst Grafikqualität oder Gameplay einzuschränken.
Am klarsten ist unnötige wiederkehrende Konfigurationsarbeit im Loadout-Pfad. Hinzu kommen drei Shader-Erstellungsruckler
mitten im Spiel und häufige Speicherbereinigungen in längeren Frames. Die Projektil-Zielsicht ist ein weiterer
gut abgrenzbarer Kandidat. Ein größerer Rendering-Umbau sollte dagegen erst nach gezielter Attribution erfolgen.

Die folgenden Zeitwerte sind aus den hochgeladenen Traces berechnet. Verbesserungen wurden nicht implementiert oder nachgemessen.

## Abgrenzung und Messwerte
Die Spielaufnahme läuft 83,67 Sekunden. Der Phasenmarker steht von 1,8635 bis 78,9921 Sekunden auf Arena.
Für die eigentliche Bewertung wurden nur vollständige Intervalle von **5,4295 bis 78,7376 Sekunden** verwendet.
Damit bleiben Aufbau und Missionsabbau draußen. Die beiden Aufnahmen wurden über 16 gemeinsame Session-Sync-Marker verbunden.

| Messgröße | Normale Arena |
|---|---:|
| Ausgewertete Dauer | 73,31 s |
| Spiel-Frames | 10.876 |
| Bildrate, aus Spiel-Frameanzahl und Zeit | 148,37 FPS |
| Median des Chrome-Präsentationsabstands | 6,059 ms |
| p95 / p99 des Präsentationsabstands | 12,114 / 12,149 ms |
| Größter Präsentationsabstand | 36,358 ms |
| Präsentationsabstände über 16,67 ms | 30 |
| Durchschnittliche RAF-Callback-Dauer | 6,210 ms |
| Durchschnittlich erfasste Host-CPU pro Frame | 1,075 ms |
| Phaser-Batch-Flushes pro Frame | 112,83 |

6,06 ms entsprechen ungefähr der beobachteten 165-Hz-Kadenz. Die Runde läuft häufig darin, verpasst aber wiederholt
einen Takt. In der Schlussphase liegt die aus vollständigen Intervallen berechnete Bildrate bei etwa 140,5 FPS.

Host-CPU ist nur der instrumentierte Host-Schritt, nicht die komplette CPU-Arbeit eines Frames. Loadout-Reconciliation,
Darstellung und Render-Submission können außerhalb davon liegen. Batch-Flushes sind nicht gleich tatsächliche Draw Calls.

## 1. Loadout-Konfigurationen nur bei Änderungen auflösen
**Priorität: sehr hoch. Evidenz: Trace-Hotspot und passender Code. Aufwand: klein für statische Vorberechnung,
mittel für sauberes revisionsgebundenes Caching.**

`applyConfiguredStats` beansprucht im CPU-Sampling rund **10,78 s**, also etwa **0,99 ms pro Spiel-Frame**.
Allein der Sortiervergleich unterhalb dieser Funktion umfasst etwa **5,28 s / 0,49 ms pro Frame**.
Diese Werte sind inklusive verschachtelter Arbeit und dürfen nicht addiert werden.

In `src/loadout/CoopDefenseLoadoutModifiers.ts` erzeugt `applyConfiguredStats` bei jedem Aufruf
`Object.entries(CONFIG_STAT_DESCRIPTORS)`, sortiert nach Modifier-Stufe und Namen, filtert anschließend passende
Deskriptoren und validiert die resultierende Konfiguration erneut. Die große Deskriptor-Menge ist statisch.

Der Aufrufpfad erklärt die Häufigkeit:
`ArenaScene.update` → `syncHostLoadoutsFromCommittedSelections` → `resolveCommittedLoadoutSelection` →
`applyCoopDefenseModifiersToLoadoutSelection`. Die Vergleichslogik erkennt unveränderte Ergebnisse erst,
nachdem ein Teil der teuren Arbeit bereits geschehen ist.

Zusätzlich arbeitet `PersistentBaseWorldMaterializer.refreshForRelevantBuildChanges` vor seinem Änderungsvergleich
mit neuem Map-Objekt, `JSON.stringify` und frisch aufgelösten Restore-Tools. Dieser Teil umfasst etwa **2,48 s**;
er überschneidet sich wesentlich mit dem genannten Loadout-Hotspot.

### Maßnahmen
1. Die sortierte Deskriptorliste einmalig vorberechnen; optional nach Konfigurationsart und Slot aufteilen.
   Die bestehende Reihenfolge der Modifier-Stufen unverändert erhalten.
2. Effektive Waffen-, Utility- und Ultimate-Konfigurationen an stabile Build-/Loadout-/Modifier-Revisionen binden.
   Änderungsprüfung VOR teurer Auflösung und Validierung.
3. Bereits aufgelöste Ergebnisse in HUD, Utility-Abfragen und PB-Restore-Tools wiederverwenden.
4. Schema-Prüfungen nicht ersatzlos entfernen, sondern bei neuen/invalidierten Konfigurationen durchführen.

Dynamische Buffs und zeitabhängige Zustände müssen weiterhin korrekt berücksichtigt werden. Kein pauschales Einfrieren
aller Spielerwerte und kein Abschalten notwendiger Runtime-Reconciliation.

**Nutzen:** klare Chance auf weniger dauerhafte CPU-Arbeit und weniger temporäre Objekte. Die 0,99 ms sind die Größe
des gemessenen Problemblocks, keine garantierte Einsparung. Schon die statische Sortierung ist ein eigenständiger,
vergleichsweise risikoarmer erster Schritt.

## 2. Erste Shader-Erstellung aus der Kampfphase entfernen
**Priorität: hoch für Ruckelfreiheit. Evidenz: drei sehr klare Chrome-Callstacks. Aufwand: mittel.**

| Zeitpunkt ab Aufnahmebeginn | RAF-Callback | Gesampelte Zeit in getProgramParameter |
|---|---:|---:|
| 9,418 s | 30,956 ms | 19,774 ms |
| 10,351 s | 35,825 ms | 21,388 ms |
| 10,712 s | 31,349 ms | 19,798 ms |

Diese drei Frames enthalten keine MajorGC-Überlappung. Der gemeinsame Stack führt über
`SpriteGPULayerWebGLRenderer` → `getShaderProgram` → `createShaderProgram` → `WebGLProgramWrapper.createResource`
→ `_completeProgram` → `getProgramParameter`.

Die mitgelieferte Phaser-Quelle zeigt im Abschlussweg die synchrone Prüfung des Link-Status.
Damit sind dies keine bloßen allgemeinen „zu viele Partikel“-Spitzen, sondern Initialisierung von Programmen
während des normalen Spielens.

### Maßnahme
Die tatsächlich benötigten Render-/Shader-Varianten des gewählten Loadouts und der relevanten Effekte vor dem
spielbaren Rundenstart vorbereiten. Das muss den tatsächlichen Renderpfad erreichen; ein unsichtbares, ausgespartes
Objekt reicht nicht automatisch. Ein Warmup darf keine echten Gameplay-Effekte auslösen.

`KHR_parallel_shader_compile` ermöglicht nicht blockierendes Polling des Fertigstellungsstatus. Die Extension
allein verhindert keine Blockierung, wenn unmittelbar ein synchroner Link-Status abgefragt wird.
Ein bloßes Überspringen unfertiger Shader ist keine ausreichende Lösung, wenn dadurch wichtige Effekte zunächst fehlen.
Die Aufzeichnung identifiziert den SpriteGPU-Programmpfad, aber nicht sicher die konkrete Effekt-Lane jedes Rucklers.

**Nutzen:** vor allem bessere erste Schüsse/erste Effekte; kleinerer Effekt auf den Durchschnitt über die gesamte Runde.

## 3. Projektil-Zielsicht nicht ständig vollständig neu aufbauen
**Priorität: mittel bis hoch. Evidenz: Trace plus strukturell unnötige Wiederholung im Code. Aufwand: klein bis mittel.**

`runHostInteractionStage` umfasst gesampelt etwa **2,66 s**. Davon entfallen etwa **1,71 s / 0,16 ms pro Frame**
auf `ProjectileCollisionProcessor.readTargets`. Auch in einem Abschnitt ohne aktive Projektile wird die Zielsicht gebaut.

`ProjectileCollisionProcessor.run` liest zunächst alle Ziele ein und iteriert erst danach über die Projektile.
`readTargets` leert die Map der physischen Schlüssel. Der World-Adapter in `WorldCombatGameplayBinding.ts`
durchläuft aktive Weltfelsen, Runtime-Bauten, Basen und Zugsegmente. Basisgrenzen werden erneut über Zell-Bounds vereinigt.
Die Slot-Pools verhindern nicht alle neuen Referenzobjekte und Schlüssel.

### Maßnahmen
Eine sichere Leerfall-Abkürzung vor dem Zielaufbau, nachdem vorherige Interaktionsstufen berücksichtigt sind.
Statische Geometrie und Basis-Bounds mit expliziter Invalidierung bei Weltänderungen wiederverwenden;
dynamische Ziele gesondert aktualisieren. Referenzen und Scratch-Strukturen möglichst wiederverwenden.
Räumliche Kandidatenabfragen erst ergänzen, wenn diese über den begrenzten Cache-Fix hinaus sinnvoll sind.

Wichtig: Die dokumentierte Live-Iteration für neu in derselben Stage entstehende Plasma-Swarm-/Interaktionsprojektile,
die kanonische Ziel-Deduplizierung und Trefferreihenfolge müssen erhalten bleiben.

**Nutzen:** kleiner als Loadout-Caching, aber klar begrenzter CPU- und Allokationsgewinn, mit Skalierungsnutzen bei größeren Welten.

## 4. Allokationsdruck als Ursache wiederkehrender Ruckler reduzieren
**Priorität: hoch als Begleitziel der Punkte 1 und 3, nicht als globaler Pooling-Umbau.**

Im ausgewählten Fenster gibt es **1.208 MinorGC-Ereignisse** und **25 MajorGC-Ereignisse**.
Die MajorGC-Dauer summiert sich auf etwa 194 ms; der längste dieser Abschnitte dauert 9,30 ms.
**24 der 28 RAF-Callbacks über 16 ms überlappen eine MajorGC.**

Das belegt eine enge Verbindung zwischen Speicherbereinigung und vielen längeren Frames. Es bedeutet nicht,
dass deren gesamte Dauer GC ist, und beweist weder ein Speicherleck noch den genauen Erzeuger jedes freigegebenen Objekts.

Zuerst temporäre Arrays, Sortierlisten, rekonstruierte Konfigurationen und Zielreferenzen in den belegten Hotpaths vermeiden.
Bei verbleibenden Spitzen gezielt einen Allocation-Sampling-Vergleich aufnehmen. Kein pauschales Pooling aller Spielobjekte.

## 5. Rendering gezielt untersuchen, nicht blind Beleuchtung umbauen
Der Phaser-Renderpfad umfasst gesampelt etwa **29,93 s**; darin erreicht `GraphicsWebGLRenderer` etwa
**7,10 s / 0,65 ms pro Frame**. Ein großer Teil der Graphics-Stacks läuft über normale Display-List-/Container-Pfade.
Der Trace liefert keine verlässliche Zuordnung der gesamten Graphics-Zeit zu konkreten HUD-, Welt- oder Effektobjekten.

`LightingSystem` besitzt bereits Cache-Pfade für stationäre Explosionslichter; die Spielaufnahme enthält Cache-Hits.
Die Behauptung, sämtliches Licht werde unnötig ohne Cache neu berechnet, wäre daher falsch.

Sinnvoll ist ein getrennter A/B-Vergleich von HUD, sonstigen Graphics-Formen und Licht-/Schattenvektoren.
Erst danach häufige unveränderte Geometrie oder wiederholt identische Graphics-Formen in wiederverwendete Geometrie,
Texturen oder passende GPU-Darstellung überführen. Animationen und Gamefeel müssen dabei nicht reduziert werden.

**Bewertung:** relevantes Potential, aber noch kein ebenso präzise eingegrenzter Umbauauftrag wie Punkt 1.

## 6. Raketenrauch erreicht ein Kapazitätslimit
Die Lane `rocket-smoke` hat Kapazität **640**, High-Water-Mark **640** und meldet in ihrer Session-Zusammenfassung
**10.996 Capacity-Drops** bei 34.393 erfolgreichen Rearms. Die aggregierten Arena-Intervalle melden 10.968 Drops;
die beiden Zählansichten unterscheiden sich leicht. Belastbar ist: ungefähr 11.000 Rauch-Spawns werden am Limit verworfen.

Dies ist eine Partikelpool-Kapazität, KEINE GPU-Auslastungsmessung. Die isoliert gesampelten Rocket-/GPU-VFX-Updatefunktionen
sind wesentlich kleiner als der Loadout-Hotspot; nachgelagerte Renderkosten sind darin nicht vollständig enthalten.

Rauch-Emissionsrate und Abstände kontrolliert an Gesamtbudget, Sichtbarkeit und bestehende Belegung anpassen.
Nicht pauschal die Kapazität stark erhöhen. Ziel ist gleichmäßigerer Rauch bei begrenztem Aufwand, nicht einfach weniger sichtbares Feedback.

## Nicht zuerst optimieren
- Fels-Buffer-Uploads: in der gesamten Session nur 97.944 Bytes und keine vollständigen Uploads im Rocks-Summary.
- Flowfield-Worker: im ausgewählten CPU-Profil etwa 97,74 % Idle; kein dominanter Rechenhotspot.
- Adrenalin-/Plasma-/Mini-Raketen-Gameplay: kein Beleg für einen ähnlich großen einzelnen Logikhotspot wie die Konfigurationsarbeit.
- GPU-Qualität pauschal senken: dafür fehlt eine belastbare GPU-Zeitmessung.

## Messlücken und Einordnung
GPU-Timer: `supported`, eingeschaltet, aber `samplesCompleted: 0` und keine GPU-Samples.
`drawCalls` steht ebenfalls durchgehend auf 0, obwohl Renderarbeit stattfindet.
Diese Werte sind keine echten Nullkosten. Die Erfassung sollte korrigiert werden; Batch-Flushes bleiben ein eigener Proxy.

Aufnahme mit Vite-Entwicklungsmodulen von localhost, aktivem Live-HUD und Trace-Assist.
Die kleine ausgewiesene Recorder-Eigenzeit ist kein Nachweis, dass die gesamte Instrumentierung kostenlos ist.
Ein abschließender Vergleich sollte dieselbe Runde und dieselben Einstellungen in einem Produktionsbuild mit reduzierter
Diagnostik wiederholen. Der Trace enthält keinen Commit-Hash, der die genaue Binärübereinstimmung mit dem geprüften main beweist.

Nur ein Host mit einem Spieler; keine Aussage über Multiplayer-Skalierung aus RTT-Nullwerten ableiten.
Keine kontrollierten Ablationen oder Nachher-Messungen vorhanden, daher keine seriöse feste FPS-Gewinnzusage.

## Empfohlene Reihenfolge
Zunächst die statische Modifier-Sortierung beseitigen und effektive Konfigurationen sauber cachen.
Danach Shader-Warmup und die Projektil-Zielsicht bearbeiten. GC-Spitzen anschließend erneut vergleichen.
Rendering und Rauchbudget erst auf Basis verbesserter Attribution beziehungsweise verlässlicher GPU-Messung weiter optimieren.

## Quellen und Nachvollziehbarkeit
Primärquellen: die beiden hochgeladenen Dateien (Dateinamen und SHA-256 in measurement_summary.json).
Code-Prüfung an der oben genannten Repository-Revision:
- src/loadout/CoopDefenseLoadoutModifiers.ts
- src/scenes/ArenaScene.ts
- src/scenes/arena/ArenaLifecycleCoordinator.ts
- src/world/PersistentBaseWorldMaterializer.ts
- src/projectile/ProjectileCollisionProcessor.ts
- src/projectile/WorldProjectileRuntime.ts
- src/world/WorldCombatGameplayBinding.ts
- src/effects/LightingSystem.ts
- src/scenes/arena/ArenaRuntimeProfiler.ts
Zusätzlich: mit der Chrome-Aufnahme gelieferte Phaser-Quellen; offizielle Khronos-Spezifikation KHR_parallel_shader_compile.

Die zugehörigen CSV-/JSON-Auswertungen sind im Messwerte-Archiv enthalten.
