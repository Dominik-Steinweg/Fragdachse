# Navigation: Fehler- und Performance-Review

Stand: 16. September 2026. Ausgangspunkt und HEAD bei Beginn waren
`25845263358409aae91d1c4422ec673bfb8ba528` (AI Navigation 0.21).
Die Korrekturen liegen im Arbeitsbaum. Parallel entstandene Audioänderungen
wurden nicht bearbeitet. 16-px-Navigation, gemeinsame Zielabsicht, körpergerechte
Bewegung und Host-Autorität bleiben bestehen. Globale Dichtekosten bleiben aus.

## Befunde und Korrekturen

| Prüfpunkt | Ergebnis |
|---|---|
| 1. Vollständig ummauerte Ziele | **Bestätigt und korrigiert.** Ein gültiger Spieler in einer engen geschlossenen Tasche konnte keine freien Angriffsplätze liefern; `invalid-goal` verhinderte den Durchbruch. Die Suche berücksichtigt jetzt mögliche Angriffsplätze nach einer Öffnung und prüft Körperfreiheit, Reichweite und Sichtlinie. Freier Startanschluss und beschädigbarer erster Blocker bleiben Pflicht. Regression mit 30-/56-px-Körper, äußerer Sperre und innerer Umschließung; Ziel außerhalb der Welt löst keinen Durchbruch aus. |
| 2. Häufige Weltänderungen | **Bestätigt und korrigiert.** 60 entfernte Änderungen während einer Verfolgung um eine Felsecke verursachten zuvor 60 Pausen. Jetzt sind es null. Ein altes Feld darf nur eine lokale Bewegungsrichtung zum selben Ziel liefern; Anschluss und jedes Segment werden gegen aktuelle Geometrie geprüft. Veraltete Regionen erlauben weiterhin keinen Durchbruch. |
| 3. Durchbruchssuche | **Bestätigt, gezielt entschärft.** Bei einer notwendigen Basisöffnung kombinierte die Suche vorher unnötig viele irrelevante Felsöffnungen. Eine budgetierte vorgeschaltete Erreichbarkeitsprüfung mit hypothetisch entfernten zulässigen Objekten beweist nun früh, ob Basisschaden notwendig ist. Zerstörungskosten werden einmal pro logischem Objekt gelesen. Gemeinsame Aufträge bleiben erhalten; Budgetende bleibt `pending`. Der allgemeine kombinatorische Extremfall ist nicht beseitigt. |
| 4. Nachbarschaft/Prognose | **Bestätigt und korrigiert.** Eingebuddelte, inaktive und physikalisch deaktivierte Einheiten werden ausgefiltert. Vorhersagen lesen die zuletzt tatsächlich angewendete Körpergeschwindigkeit einschließlich Slow, TimeBubble, Stun, Dash und Impulsen. Der Suchradius berücksichtigt auch schnell ankommende Nachbarn. Tests prüfen die Unabhängigkeit vom veralteten Bewegungswunsch und schnelle Annäherung. |
| 5. Bekannte Blocker | **Bestätigt und korrigiert.** Geometrie hält einen ID-Index für alle Teilformen eines Objekts. Zielgebundene Angriffe greifen direkt auf Fels-, Basis- und Konstrukt-IDs zu; auch die abschließende Angriffsfreigabe braucht kein `indexOf`. Ein Test mit 1.000 Hindernisplätzen greift ausschließlich auf den freigegebenen Blocker zu. Schaden läuft weiterhin durch die Combat-Pipeline. |
| 6. Entscheidungsbudget | **Bestätigt und korrigiert.** Kandidatenlisten und vollständige Wahrnehmungsprüfungen entstehen erst bei einer fälligen Auswahl. Dazwischen wird das gebundene Ziel aktuell validiert; blockierte oder ausstehende Routen erzwingen keine vollständige Neuauswahl. Die rotierende Auswahl bleibt fair, ungültige Ziele und geänderte Zielrolle reagieren sofort. |
| 7. Geometrie/Worker | **Teilweise optimiert.** Zwischenzeitlich materialisierte komplette Geometriesnapshots werden vor dem nächsten Worker-Auftrag auf den neuesten Stand zusammengefasst. Vollständige Körpergraph-Neuberechnungen bei Topologieänderungen und redundante Graphkopien pro Feld sind bestätigt. Der Graph selbst wird bereits einmal pro Körperprofil gebaut. Ein größerer Umbau von inkrementeller Geometrie oder Puffereigentum wurde nicht vorgenommen. |

## Isolierte Messungen

AMD Ryzen 7 5800X, Windows, Node 24.14.0, Inline-Runner. Keine Darstellung,
Kampfeffekte oder sinkende Population im Messaufbau. Die Referenz ist die **neue
Navigation vor diesem Review**, keine Wiederaufnahme der früheren alten KI.
Je Zielentscheidungsfall 60 Aufwärm- und 600 Messschritte, 100 Einheiten und vier
Spielerziele. Einzelne Microbenchmark-Läufe, keine statistisch abgesicherte FPS-Abnahme.

| Messung | Vor Review | Nach Korrektur |
|---|---:|---:|
| Freie Zielentscheidung p50 / p95 / p99 | 0,190 / 0,342 / 0,475 ms | 0,101 / 0,159 / 0,277 ms |
| Blockierte Zielentscheidung p50 / p95 / p99 | 0,915 / 1,315 / 1,527 ms | 0,498 / 0,742 / 0,939 ms |
| Wahrnehmungsprüfungen je 600 Schritte | 240.000 | 88.800 |
| Geteilte Suchaufträge bei 100 Einheiten am selben Hindernis | 1 | 1 |
| Felsöffnung mit 30 irrelevanten Felsen, gesamte Suchzeit | 3,84 ms, fertig | 3,48 ms, fertig |
| Notwendige Basisöffnung mit 30 irrelevanten Felsen | Nach 67,80 ms / 6.797 Expansionen weiterhin `pending` | Fertig nach 2,68 ms / 696 Expansionen |
| Integritätsabfragen bei diesem Basisfall | 8.221 | 31 |
| Acht Felder, ein Körperprofil, initiale Ergebnisübertragung | 1.475.792 Bytes | 1.475.792 Bytes |

Im Basisfall umfasst das neue Ergebnis 472 Erreichbarkeits- und 224 eigentliche
Suchschritte; 412 Suchzustände sind gespeichert, 143 noch in der Suchwarteschlange.
Die p95-Zeit einer 64-Schritt-Scheibe liegt bei 0,48 ms. Das sind Referenzwerte,
keine obere Zeit- oder Speichergrenze für beliebige Maps.

Zehn kleine Geometrieänderungen mit acht Feldern benötigen nach der Korrektur
19,54 ms p50 / 31,70 ms p95 **einschließlich sämtlicher synchron berechneter Felder**.
Die reine Main-Thread-Geometrieprojektion benötigt in dieser dünn belegten Testwelt
0,017 / 0,080 ms. Im Produktivbetrieb laufen Körpergraphen, Regionen und Felder im
Worker; die Inline-Gesamtzeit darf daher nicht als zusätzliche Framezeit gelesen werden.
Zielentscheidung, Durchbruchssuche, lokale Bewegung und unmittelbare Körperprüfungen
bleiben Main-Thread-Arbeit. Die Verbesserungen dieses Reviews betreffen vor allem dortige Arbeit.

Die Graphkopien machen bei acht gleichartigen Feldern etwa 352 KB vermeidbare
Mehrfachübertragung aus. Ein geteiltes unveränderliches Profilergebnis wäre ein
möglicher Folgeschritt, benötigt aber einen eigenen Versions- und Eigentumsvertrag
für Aktivierung und Recycling. Der aktuelle Vertrag bleibt intakt.

Rohdaten (lokale, ignorierte Build-Artefakte):

- [Referenz vor dem Review](../build/navigation-results/review-before.json)
- [Korrigierter Stand](../build/navigation-results/review-after.json), mit Commit und Hash des Source-Diffs
- [90 Bewegungsfälle](../build/navigation-results/movement.json), mit Quellhash, Seeds, Layouts und Konfiguration

## Verifikation

- `npm run check`: **3.774 Core-Tests, 35 Architekturtests und Produktionsbuild bestanden**.
- `npm run test:integration`: **490 Tests bestanden**, darunter Verfolgung mit verzögerten
  Feldern, bewegtes eingeschlossenes Ziel, entfernte Weltänderungen, Kampf, Fähigkeiten und Lifetime.
- `npm run nav:stress`: **90/90 Fälle bestanden**. Felsfelder, Engpass und zwei Wege,
  zehn Seeds, je 20/50/100 Einheiten, je 60 simulierte Sekunden. Alle Einheiten
  kamen an; null unsichere Bewegungsvorschläge. Mit 100 Einheiten liegen die
  p95-Navigationszeiten je Fall bei **0,99–1,60 ms**, die höchste p99 bei 3,20 ms.
  Der Harness berücksichtigt jetzt die ausgeführte Geschwindigkeit beim folgenden
  Nachbarschaftsschritt. Es ist keine Arcade- oder Renderzeitmessung.
- Der opt-in Microbenchmark `tests/stress/NavigationReview.test.ts` wurde ausgeführt.
  Er enthält keine hardwareabhängigen Timing-Assertions.

## Aussagegrenzen und nächste Schritte

**Nicht durchgeführt:** neue Browser-/GPU-Messungen, ein gerendertes Solo-Match mit
100 Einheiten als 60-FPS-Nachweis, manuelles Mehrrechner-Koop, Langzeit-Heap-Profiling
mit kontrollierter GC oder ein vollständiger Browser-Fähigkeitsmix. Vorhandene
Core-/Integrationsprüfungen dieser Fähigkeiten bestanden; die neuen Nachbarschaftstests
prüfen die physikalischen Geschwindigkeiten, nicht jede Statuskombination im Renderer.
Unkontrollierte Heap-Differenzen stehen nur als Allokationsbeobachtung in den Rohdaten.

Priorisierte Folgeschritte bei weiterem Bedarf:

1. Aktuelles gebautes Lab mit 100 Gegnern profilieren und Main-Thread-Navigationsphasen,
   Worker-Latenz und Framezeiten getrennt ausweisen. Derzeit kein Beleg für stabile 60 FPS.
2. Sehr große Öffnungsprobleme mit vielen zulässigen Objektkombinationen untersuchen;
   Suchzustände können weiterhin stark wachsen. Das Expansionsbudget ist keine harte
   Millisekunden- oder Speichergrenze. Auch Zielverlust bei vielen Einheiten kann
   absichtlich sofortige Neuauswahl und damit eine Lastspitze auslösen.
3. Nur bei nachgewiesenem Engpass inkrementelle Körpergraphen oder gemeinsam
   übertragene Profildaten einführen. Die aktuelle dünne Geometrietestwelt belegt
   keine ausreichende Performance dicht bebauter Maps.

Bewegungsprognosen verwenden einen konsistenten physikalischen Stand des letzten
Schritts. Neu beginnende Impulse oder Fähigkeiten werden damit erst im folgenden
Nachbarschaftsstand sichtbar; exklusive Bewegungsprioritäten und abschließende
physische Kollision bleiben zuständig.
