# KI-Navigation: Implementierung und Vergleich

## Ergebnis

Die gemeldeten Spawn- und Verfolgungsregressionen sind behoben und durch gezielte Tests sowie
Browserproben abgesichert. Die kontrollierte Navigation bewältigt alle 90 Fälle; bei 100 Einheiten
kostet sie etwa 0,43–0,48 ms zusätzliche p95-CPU-Zeit pro Simulationsschritt. Der Qualitätsgewinn
ist über Ankünfte, Durchsatz und Stillstandszeiten belegt. Globale Dichtekosten bleiben aus.

Auf Nutzerwunsch vom 16.09.2026 wurde die ausgedehnte Gesamtlastserie beendet. Zusätzliche
Kämpfe, Effekte und Population durch wirksamere KI werden als veränderte Spiellast ausgewiesen,
nicht pauschal als schlechtere Performance der Navigation bewertet. Die früheren strengen
Gesamtframe-Bewertungen bleiben historische Rohdaten, sind aber keine aktuelle Abnahmebedingung.
[Zusammengefasste Messdaten und Quellenidentitäten](../build/navigation-results/final-assessment.json).

## Implementierter Umfang

Der neue Produktivpfad verbindet die bestehenden Gegner und Nekromantie-Verbündeten über
eine Activity-eigene Zielabsicht, körpergerechte Navigation und gemeinsame normale Bewegung.
Neue Schwarmgegner gehören nicht zu dieser Lieferung. Die eingefrorene alte KI liegt
ausschließlich im separaten Vergleichsbuild; das Spiel besitzt keinen Alt/Neu-Schalter.

- Kanonische World-Rechtecke, runde Stämme, Wasser, aktive Basen und Missionsbarrieren
  werden in eine serialisierbare Navigationsgeometrie projiziert.
- Punkte liegen bei World-Ursprung plus Vielfachen von 16 px. Ganze Kreisbewegungen,
  Startanschlüsse und Angriffsbereiche werden geometrisch geprüft. Körperprofile,
  Regionen, Ziele und Worker-Generationen werden gemeinsam aktiviert.
- Spielerjäger bevorzugen frei erreichbare Spieler. Belagerer behalten ihre Basisabsicht;
  ausdrückliche Nebenwaffen und verbindlich begonnene Fähigkeiten bleiben erhalten.
  Ein Waffenmodus `all` erteilt keine zusätzliche strategische Erlaubnis.
- Nachbarschaft und gewünschte Geschwindigkeiten stammen aus einem konsistenten Stand.
  Lokale Alternativen, weiche Angriffsplatzreservierungen und überschneidungsreduzierende
  Recovery verwenden dieselbe Geometrie. Es gibt keinen neuen allgemeinen Teleport.
- Geteilte Durchbruchsaufträge berücksichtigen logische Hindernisse, mehrere Lagen und
  Körperbreite. Sie sind nach Ziel, Region, Profil, Topologie, Besitzer und Waffenrechten
  getrennt. Budgetende bleibt `pending`; Basen kommen erst nach Ausschluss einer
  zulässigen Lösung ohne Basisschaden in Betracht.
- Alle Schäden laufen durch die vorhandene Combat-Pipeline. Die interne Navigation bleibt
  hostlokal und endet mit der Activity.

Bedienung und Reproduktion: [Navigations-Lab](navigation-lab.md).
Rollen und Fähigkeiten aller bestehenden Arten: [Gegner-Migration](navigation-enemy-migration.md).

## Ausgangsstand und Nachvollziehbarkeit

Tatsächlicher Ausgangsstand: `2ebed407226a290858a071bc54c1a431957aba5a`, Arbeitsbaum zu
Implementierungsbeginn sauber. Der Stand ist neuer als die ursprüngliche Planreferenz.
Die bereits eingecheckten Audioänderungen sind enthalten.

Originalquellen, instrumentierte Quellen und beide gebauten Varianten liegen getrennt unter
`build/`. Das [Manifest](../build/navigation-results/manifest.json) enthält SHA-256-Prüfsummen.
89 Audiodateien bzw. Audio-Quelldateien stimmen zwischen beiden Varianten überein; lediglich
CRLF/LF wird beim Vergleich von TypeScript normalisiert. Die Audioassets werden bytegenau verglichen.
Der eingefrorene EnemyManager besitzt weiterhin exakt den Git-Blob des Ausgangsstands.

## Kontrollierter Vorher-/Nachher-Vergleich

Zehn feste Seeds, jeweils 20, 50 und 100 Einheiten, drei Geometrieszenarien, 60 Sekunden pro
Lauf: 90 Fälle pro Version. In allen 90 Kandidatenfällen erreichten sämtliche Einheiten das
Ziel; es gab keinen unsicheren Bewegungsvorschlag.

Für 100 Einheiten, Mittelwerte über zehn Seeds:

| Szenario | Erste Ankunft: alt → neu | Durchläufe: alt → neu | Stillstand in Einheiten-Sekunden: alt → neu |
|---|---:|---:|---:|
| Felsfeld | 18,8 → 100 | 29,2 → 284,7 | 3.986 → 215 |
| 32-px-Engpass | 0 → 100 | 0 → 193,6 | 4.110 → 969 |
| Zwei Wege | 22,3 → 100 | 22,3 → 194,8 | 3.418 → 926 |

Angekommene Einheiten beginnen erneut; so bleiben Population und freier Ausgang konstant.
Die neue Navigation benötigt bei 100 Einheiten ungefähr 0,50–0,58 ms p95 gegenüber
0,08–0,10 ms für die alte Steuerung. Das ist zusätzliche Navigationsarbeit für den Qualitätsgewinn,
kein Beleg für die Gesamtperformance.

| Szenario, jeweils 100 Einheiten | Alte Steuerung, mittleres p95 | Neue Steuerung, mittleres p95 | Zusätzliche Zeit |
|---|---:|---:|---:|
| Felsfeld | 0,076 ms | 0,502 ms | 0,426 ms |
| 32-px-Engpass | 0,099 ms | 0,582 ms | 0,483 ms |
| Zwei Wege | 0,094 ms | 0,576 ms | 0,483 ms |

Die alte Steuerung bleibt in vielen Fällen stehen und erledigt weniger erfolgreiche Bewegung.
Die Prozentsteigerung ihrer sehr kleinen Navigationszeit allein ist deshalb kein ausreichender
Effizienzmaßstab. Umgekehrt wird die zusätzliche Rechenarbeit der neuen Steuerung nicht verschwiegen.

**Messgrenze:** Dieser Vergleich nutzt produktive Zielentscheidung und Steuerung mit einem
Körper-Sweep-Harness. Er bildet Arcade-Gleiten und Kampf nicht nach. Zurückgewiesene Vorschläge
der Baseline sind deshalb keine gezählten Wanddurchtritte im normalen Spiel.
[Rohdaten](../build/navigation-results/headless.json).

Die anfänglichen 40-Sekunden-Läufe mit variierten Startplatzzuordnungen waren noch
nicht vollständig: Bei vier Seeds am 100er-Engpass fehlten 1 bis 5 erste Ankünfte.
Die Verlängerung auf 60 Sekunden erfolgt für beide Versionen und alle Fälle;
die ursprünglichen [40-Sekunden-Daten](../build/navigation-results/headless-v3-40s.json)
bleiben erhalten. Eine vollständige Räumung innerhalb von 40 Sekunden wird nicht behauptet.

Die Taktung unterscheidet unverändertes Gedränge von bewegten Nachbarn. Eine wartende
Einheit prüft weiter ihre Körperfreiheit und beobachtet die Nachbarn; Bewegung oder
Entfernung hebt die Wartephase sofort auf. Gegenüber dem vorigen Messstand steigt
dadurch am Engpass der Durchsatz von 174,1 auf 193,6. Mehr aktive Bewegung kann auch
mehr Navigationsarbeit bedeuten; eine Ersparnis in jeder einzelnen Phase wird nicht
behauptet. [Voriger kontrollierter Stand](../build/navigation-results/headless-v6.json).

## Behobene Spawn- und Verfolgungsregressionen

Der Spawn-Executor hatte nach der Rasterumstellung Navigationsindizes (16 px) mit authored
World-Zellen (32 px) vermischt. Er prüfte dadurch einen anderen Ort als den tatsächlichen Spawn
und las spätere Map-1-Bereiche an falschen Positionen. Kandidatenauswahl und Erzeugung verwenden
jetzt dieselbe World-Position; die Körperprüfung berücksichtigt die tatsächliche Gegnergröße.
Ungeprüfter Spawn-Jitter entfällt. Derselbe Koordinatenfehler bei Zeitbomben gegen Konstrukte
wurde ebenfalls behoben.

- 18 Maps × zehn Seeds: 6.199 normale Spawns ohne Hindernisüberschneidung; gesperrte Fronten
  dürfen weiterhin leer bleiben. [Map-Prüfung](../build/navigation-results/spawn-maps.json).
- Alle vier Map-1-Encounter einschließlich ihrer sechs verzögerten Gruppen × zehn Seeds:
  490 von 490 angeforderten Gegnern erzeugt, ohne Überschneidung. Die Prüfung benutzt den
  produktiven Director, Spawn-Executor, generierte Geometrie und Missionsbarrieren.
  [Encounter-Prüfung](../build/navigation-results/spawn-map1-encounters.json).
- Browser: alle sechs Map-1-Gruppen erzeugen über den echten Executor einen kollisionsfreien
  Arcade-Körper, der sich anschließend bewegt. Der Spieler wird für diese Bereichsprüfung
  in die Nähe des jeweiligen Bereichs gesetzt; sie ersetzt keinen kompletten Kampagnenlauf.
  [Browser-Spawnprüfung](../build/navigation-results/rock-field-183-100-1789544491721.json).

Bei der Verfolgung machte jede relevante Zielbewegung die neue Route vorübergehend `pending`.
Die Bewegung hält jetzt einen sicheren Fortsatz zum selben Ziel oder folgt einem geometrisch
bestätigten direkten Anschluss. Ein Wechsel der Ziel-ID übernimmt keine fremde Route;
geänderte physische Topologie verwirft alte Fortsätze. `pending` erlaubt keinen Durchbruch.
Ein Integrationstest mit 360 bewegten Spielerpositionen und Zielwechsel zeigt keine zusätzlichen
Bewegungspausen. Bewegte Ziele blockieren auch Spawns nicht mehr allein wegen ausstehender
Wegkosten: Die aktuelle Verbindung über freie Regionen bleibt dafür maßgeblich.

Der 30-Sekunden-Browserfall mit 20 Verfolgern und kontinuierlich bewegtem Spieler enthält
keine `route-pending`-Wartezeit und keinen als ungewollt klassifizierten Stillstand. Fünf
Hindernisüberschneidungs-Beobachtungen betrafen kurze Kontakte an einer Ecke; die alte KI
zeigte dort ebenfalls zwei Beobachtungen. Damit ist dieser Zusatzfall kein Null-Überlappungsnachweis.
Er prüft reale Bewegung und Kampf; die kurzzeitigen Kontakte bleiben im Rohbericht sichtbar.
[Kandidat](../build/navigation-results/siege-183-20-1789545262324.json),
[Ausgangsversion](../build/navigation-results/siege-183-20-1789545343282.json).

## Dichtekosten

Dichtekosten bleiben standardmäßig aus. Bei 100 Einheiten verbessert die Ablation den Durchsatz
im Felsfeld von 284,7 auf 315,1 und bei zwei Wegen von 194,8 auf 280,7. Am engen Durchgang
ändert er sich nur von 193,6 auf 194,5. Alle ersten Ankünfte gelingen auch mit Dichtekosten.
Die zusätzlichen Navigationskosten liegen am Engpass bei etwa 35 %. Ein entsprechend
großer Qualitätsgewinn ist dort nicht nachgewiesen. Alle Varianten blieben geometrisch sicher.
[Ablationsdaten](../build/navigation-results/headless-density.json).

## Browser-Ergänzung und Performancebewertung

Die Serie `20260916-nav-acceptance-v10` wurde auf Nutzerwunsch verkürzt beendet. Gespeichert
sind 17 vollständige Läufe: drei Ally-Paare, fünf Kampfpaare und ein weiterer Kandidatenlauf.
Jeder Lauf verwendet zehn Sekunden Aufwärmen und 60 Sekunden Messung; die Reihenfolge wechselt.
Die angefangene Erweiterung auf sieben Kampfpaare und eine erneute vollständige Vier-Szenarien-
Serie werden ausdrücklich nicht als abgeschlossen behauptet. Frühere Serien bleiben erhalten.

Gemessen werden vollständiger `Phaser.Game.step`, Arcade-Update einschließlich
Kollisionscallbacks, Scene-Update, Host-Phasen, Renderübergabe, Worker, Bevölkerung,
Stillstand, Angriffs-/Sonderzeiten, Heap und verfügbare Long-Frame-Ereignisse. Der
Diagnoseoverlay bleibt geschlossen. GPU- und GC-Daten ohne Browserunterstützung bleiben
ausdrücklich unverfügbar.

Die feste Übersichtskamera umfasst den Spawn-Bereich; die sichtbare Population wird
zusätzlich protokolliert. Das verhindert, dass weniger dargestellte, außerhalb des
Bildausschnitts festhängende Gegner als Renderoptimierung erscheinen. Die Zahlen gelten
für diese dokumentierte Kamera, Auflösung und Hardware, nicht für jeden Spielausschnitt.

**Status: bewusst beendet; Navigation statt Effektlast im Mittelpunkt.** Die Ally-Gruppe hält
100 Einheiten. Ihre p95-Gesamt-CPU-Zeit liegt in den drei Paaren zwischen ungefähr −1 % und +7 %.
Im vollständigen Kampf steigt die Population durch das reale Kampf- und Spawn-Geschehen stärker
und schwankt zwischen Läufen. Gesamtframe-Mehrkosten werden dort nicht der Navigation allein
zugerechnet. Die einzelnen Phasen und Populationen stehen im Rohbericht; p95-Werte verschiedener
Phasen dürfen nicht zu einer vermeintlichen p95-Gesamtsumme addiert werden.

Bei der festen Ally-Gruppe liegen die Mediane der pro Lauf gemessenen p95-Zeiten für gemeinsame
Zielentscheidung bei 0,4 ms, feindliche Bewegung bei 0,5 statt 0,2 ms und Ally-Verarbeitung bei
0,2 statt 0,1 ms. Der kontrollierte Headless-Vergleich oben bleibt die besser zuordenbare Messung
der eigentlichen Navigationsänderung. Alle 17 v10-Browserläufe melden null Hindernisüberschneidungen;
die weiter oben beschriebenen kurzen Kontakte der separaten Verfolgungsprobe bleiben davon getrennt.

Ein während der Messarbeit gefundener bestehender Engpass wurde korrigiert:
Unveränderte World-Grenzen invalidierten den vollständigen Hindernisindex in jedem Frame.
Der neue Vergleich der Bounds vermeidet diese Neubauten; tatsächliche Änderungen
invalidieren weiterhin. Der gezielte Pilot zeigte 0 statt 359 zusätzliche Neubauten in
359 Frames. Der Verhaltenstest schützt sowohl Wiederverwendung als auch echte Änderungen.

Die Kampfspitzen zeigten außerdem wiederholte Triangulierung unveränderlicher
Bisskonturen. Diese Konturen werden jetzt einmal beim Erzeugen trianguliert und
über Phasers vorhandenen Dreiecks-Batch gezeichnet. Farben, Konturen, Partikel,
Lebensdauer und Kampfregeln bleiben erhalten. Kurvenproben werden zwischen den
Farbschichten desselben Effekts geteilt. Ein Verhaltenstest prüft konkave Flächen,
Transformation, Ausblenden und Freigabe; die Darstellung wurde im Lab geprüft.

Blut- und Splitterpartikel verwenden außerdem vier wiederverwendbare Scene-Emitter.
Einzelne Treffer erzeugen keine eigenen Emitter mehr; beim World-Teardown werden laufende
Partikel vollständig zurückgesetzt. Partikelanzahl, Lebensdauer und Bewegungsparameter bleiben
erhalten. Ein Regressionstest deckt mehrere gleichzeitige Treffer und Wiederverwendung nach Cleanup ab.

Die Zwischenserie `20260916-nav-acceptance-v8` überschritt im Belagerungsfall den neuen
16-%-Korridor (etwa 18–31 % zusätzliche p95-CPU-Zeit). Ihre Rohdaten bleiben erhalten.
Daraufhin wurden punktförmige Geometrieprüfungen vereinfacht, Hindernisse vor teuren Sweeps
über ihre Begrenzungen ausgeschlossen und Nachbarabstände ohne unnötige Quadratwurzeln geprüft.
Eine Routenabfrage wird nur bei identischem Standpunkt, Zielpunkt, Feld, Snapshot und Topologie
wiederverwendet. Ankünfte, Durchläufe und Stillstandszeiten aller 90 kontrollierten Standardfälle
bleiben gegenüber v8 identisch. In v9 lagen die drei vollständigen Kampfpaare weiterhin bei
20–36 % Mehrkosten; dieser Zwischenstand ist keine Abnahme. V10 ergänzt daher einen begrenzten
Pool von 32 vorbereiteten Bisskonturen je Konfiguration. Größe, Farben, Partikel und Lebensdauer
bleiben erhalten, die prozedurale Formvarianz stammt nach dem Aufwärmen aus diesem Pool.
Live-Effekte besitzen eigene Animationen und Canvas-Puffer; gemeinsam benutzte Dreiecke werden
beim Entfernen eines einzelnen Effekts nicht gelöscht. Der World-Teardown gibt den Konturpool frei.
Die aktuelle Browserzusammenfassung benutzt ausschließlich v10. Die kontrollierten Navigations-
und Dichteberichte stammen aus v9; danach wurden ausschließlich diese beiden Renderer geändert.
Diese Quellgleichheit außerhalb der Renderer wurde über den v9-Quellhash geprüft und im
abschließenden JSON-Bericht festgehalten.

## Prüfungen und Aussagegrenzen

- `npm run check`: 3.768 Core-Tests, 35 Architekturtests und Produktionsbuild bestanden.
- Integration: 481 Tests bestanden.
- Stress: 76 Tests bestanden; vier explizit optionale Fälle übersprungen.
- Zusätzliche kontrollierte Fälle: 30-px-Körper im 32-px-Gang und Knick, Bossöffnung,
  Kreisgeometrie, sichere Diagonalen, überlagerte Blocker, veraltete Worker-Ergebnisse,
  Zielverlust, Rauch-Erinnerung, freie Umwege, unerlaubte Basisangriffe, mehrlagige
  Öffnungen, bewegte eingeschlossene Ziele, Basen als letzter Ausweg und unterschiedliche
  Ally-Berechtigungen. Eine konfigurierte Profilprüfung deckt alle 14 Gegnerarten ab.
- Bestehende Fähigkeits-, Fraktions-, Netzwerk-, Late-Join- und Lifecycle-Suiten laufen
  weiter. Ein zusätzlicher manueller Mehrrechner-Koop-Durchlauf wird nicht behauptet.
- Ein früherer Referenzlauf mit drei realen Felsentfernungen bei 100 Einheiten (Seed 183) lieferte nach 214, 242,5
  und 265,4 ms wieder eine nutzbare Entscheidung für die betroffene Einheit. Erfasst
  wird die Wall-Clock-Zeit vom kanonischen World-Mutationsaufruf bis zur tatsächlich
  aktivierten Route mit neuer Topologie. Damit liegt der Referenzfall ungefähr bei
  250 ms; eine harte Obergrenze von 250 ms oder ein allgemeines Worst-Case-Limit ist
  nicht belegt. Dieser Zusatzfall wurde nach der gewünschten Testverkürzung nicht erneut ausgeführt.
  [Änderungsdaten](../build/navigation-results/rock-field-183-100-1789522627898.json).
- Heap-Samples sind keine vollständige Speicher- oder GC-Profilierung. Offene
  Messbarkeit wird nicht als bestanden gewertet.
- `stationaryWithoutAttackMs` enthält auch zulässiges Warten. Umgekehrt hängt
  `unwantedStationaryMs` vom Bewegungswunsch der jeweiligen Steuerung ab. Beide
  Browserzähler allein beweisen deshalb keine beseitigte Bewegungsklemme; dafür
  dienen die kontrollierten Ankunfts- und Durchsatzmessungen.
- Der neue Pfad protokolliert kumulative Nachbarschaftsbesuche, Beobachtungen wartender
  Nachbarn und Expansionen der Durchbruchssuche. Gleich definierte Baseline-Zähler fehlen;
  diese Werte sind deshalb keine gepaarte Alt/Neu-Messung. Feld-/Jobzahlen, Worker-Zeiten
  und Hindernisprüfungen werden gesondert erfasst.

## Begründete Abweichungen vom GDD

1. Relativer Qualitäts-/Performancevergleich statt einer pauschalen 60-FPS-Zusage bei
   100 Gegnern. Der zunächst vereinbarte 5-%-Korridor wurde am 16.09.2026 vom Nutzer
   ausdrücklich auf akzeptable Mehrkosten von 12–16 % erweitert. Die aktuelle Auswertung
   gewichtet auf anschließenden Nutzerwunsch die kontrollierten Navigationskosten und die
   Bewegungsqualität. Mehr Spiellast durch erfolgreichere KI ist kein pauschaler Navigations-
   Performancefehler. Frühere Gesamtframe-Messungen und ihre damalige Bewertung bleiben erhalten.
2. Lab, neutrale Instrumentierung und eingefrorene Baseline wurden vor dem KI-Umbau
   angelegt. Nachträgliche Messpräzisierungen wurden auf beide Builds übertragen.
3. Globale Dichtekosten bleiben nach der Ablation optional.
4. Der Durchbruch sucht budgetiert auf derselben Körpergeometrie und berechnet Kosten
   pro logischem Öffnungsobjekt. Ein zusätzlicher Regions-Portalgraph ist nicht nötig.
   Die Zerstörungszeit ist eine Heuristik aus verfügbarer Waffe, Kadenz und
   Strukturmultiplikatoren, keine vollständige zukünftige Kampfsimulation.
5. Normale Recovery verwendet sichere lokale Alternativen und die gemeinsamen Felder.
   Eine zusätzliche allgemeine lokale A*-Suche wurde mangels eines ungelösten
   konstruierten Erreichbarkeitsfalls nicht eingeführt. Der bestehende Nekromantie-Leash
   bleibt eine eigene Fähigkeit.

## Mögliche nächste Schritte

1. Ein regulärer Map-1-Kampagnenlauf bis zu den späten Encountern ergänzt die automatisierte
   Spawnprüfung; gezielte Verfolgung um Felsecken ergänzt den kontinuierlichen Bewegungstest.
2. Weitere Optimierung nur anhand eigener Navigationsphasen: Nachbarsuche und lokale
   Bewegungsalternativen bei gleicher Population, Zielbewegung und Geometrie vergleichen.
3. Kurze Arcade-Kontakte an Ecken und die Reaktionszeit bei dynamischen Hindernisänderungen
   bei Bedarf gezielt nachprüfen. Eine weitere allgemeine Effekt-Optimierungsrunde ist dafür
   nicht erforderlich; neue Schwarmgegner bleiben ein eigener Ausbau.
