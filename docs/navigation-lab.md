# Navigations-Lab und reproduzierbare Vergleiche

## Einstieg

`npm run dev:browser` startet den vorgesehenen lokalen Server auf Port 8090.
`http://127.0.0.1:8090/navigation-lab.html?scenario=rock-field&seed=183&count=100&autorun=1`
startet die produktive Arena ohne Lobby. Start, Pause, Einzelschritt, Neustart,
Diagnoseansicht und JSON-Export sind normale HTML-Bedienelemente.

Parameter: `scenario=rock-field|siege|combat|allies`, `seed`, `count`, `warmup`
und `duration` (Sekunden), `autorun=1`, `density=1`. Dichtekosten sind ohne
expliziten Parameter ausgeschaltet. Die Simulation bleibt hostautoritativ;
der lokale Raumadapter wird ausschließlich vom Lab-Einstieg installiert.

Die Referenzfälle verwenden reale Maps, Gegner, Waffen, Fähigkeiten, Arcade-Physik
und Darstellung. Der Spieler bleibt an einer freien zentralen Position und wird
für den Versuch am Leben gehalten. Gestorbene Gegner werden ersetzt. Die feste
Übersichtskamera umfasst den gesamten Spawn-Bereich. Bevölkerung, sichtbare Bevölkerung,
Ersatzspawns, Kampfereignisse und Konfigurationen stehen im Rohbericht. Das Lab
ersetzt keine individuelle Geometrie- oder Fähigkeitsprüfung.

`rock-field` schaltet nur das automatische Feuern des Referenzspielers aus;
Gegner greifen weiterhin mit ihrer produktiven Kampflogik an. Die Browserfälle
sind deshalb keine kampffreien Navigations-Microbenchmarks. `siege` verwendet
die Belagerer-Mischung auf Map 6. Deren drei ungebundene Vorposten sind nach dem
bestehenden Zielquellenvertrag keine strategischen Basisziele; hier wird auch
das Spieler-Fallback belastet. Echte Basisbindung und Durchbrüche werden durch
die kontrollierten Verhaltenstests geprüft.

Seed und Konfiguration fixieren Layout und Lab-Spawns. Das vollständige
Kampfgeschehen ist wegen Echtzeit-Taktung und bestehender zufälliger Fähigkeiten
kein bitidentisches Replay. Deshalb werden gepaarte Wiederholungen, tatsächliche
Population und Schadensereignisse ausgewertet. Fähigkeitsspawns können die
Mindestpopulation überschreiten.

`combatantDamageEvents` zählt über den vorhandenen passiven Combat-Beobachter
tatsächlich zugefügten Spieler-/Gegnerschaden nach Zielart und Schadensart.
Grafikobjektzahlen sind eigene Render-Messgrößen und werden nicht als Angriffszahlen
interpretiert. Der Beobachter wird nach Messende, Fehler oder Scene-Teardown entfernt.

## Spawn- und Verfolgungsregressionen

`navigation-lab.html?spawnAudit=1&map=1&seed=183&autorun=1` prüft jede authored Encounter-Gruppe
über den produktiven Spawn-Executor und echte Arcade-Körper. Pro Gruppe wird ein Gegner erzeugt,
seine Körperfreiheit sofort sowie über 600 ms Bewegung beobachtet. Der Referenzspieler steht dabei
in der Nähe des jeweiligen Bereichs. Missionsfortschritt und vollständige Gruppenzahlen prüft zusätzlich
`npx vitest run tests/stress/NavigationSpawns.test.ts`: alle Maps mit zehn Seeds sowie sämtliche
Map-1-Encounter mit verzögerten Gruppen und den jeweils aktiven Missionsbarrieren.

`navigation-lab.html?scenario=siege&pursuit=1&count=20&seed=183&warmup=5&duration=30&autorun=1`
bewegt den Referenzspieler kontinuierlich mit 140 px/s auf einer geometrisch freien Strecke.
Der Spieler feuert in diesem Fall nicht automatisch; Gegner und vorhandene Türme bleiben produktiv.
`pursuitTrack`, Wartegründe und begrenzte `overlapEvents` stehen im Rohbericht. Dieser Fall ist
eine Verhaltensprüfung und gehört nicht zur vierteiligen Performance-Serie.

## Eingefrorene Ausgangsversion

Der Ausgangsstand ist `2ebed407226a290858a071bc54c1a431957aba5a` mit sauberem
Arbeitsverzeichnis. Er enthält die inzwischen eingecheckten Audioänderungen.
Die instrumentierte Quelle liegt lokal in `build/navigation-baseline-source/`.
Zur Wiederherstellung zuerst `navigation-original-source.zip` in dieses Verzeichnis
entpacken, dann `navigation-baseline-source.zip` darüber entpacken. Das zweite Archiv
enthält die eingefrorenen instrumentierten Quellen und Builddateien; die unveränderten
Assets kommen aus dem Originalarchiv. Die Projektabhängigkeiten werden wie gewohnt im
Repository-Stamm installiert.
`npm run build:nav-baseline` baut ausschließlich diese Quelle; es übernimmt keine
späteren KI-Änderungen aus dem Arbeitsverzeichnis. Fehlt die eingefrorene Quelle,
bricht das Kommando ab. Das Originalarchiv liegt in `build/navigation-original-source.zip`.

`npm run build:nav-candidate` baut den aktuellen Quellstand. Beide Builds liegen
getrennt unter `build/navigation-baseline/` bzw. `build/navigation-candidate/`.
Der lokale Server liefert ihre HTML-Einstiege unverändert ohne HMR aus. Änderungen
am Quellcode dürfen eine laufende Vergleichsmessung nicht neu laden.

## Browser-Serie

Nach beiden Builds folgende Adresse öffnen:

```text
http://127.0.0.1:8090/build/navigation-baseline/navigation-lab.html?scenario=rock-field&seed=183&count=100&warmup=10&duration=60&autorun=1&suite=paired&repetitions=3&pair=0&phase=0&session=EINDEUTIGE-SERIE
```

Die Serie wechselt Baseline und Kandidat in umgekehrter Reihenfolge je Paar und
bearbeitet alle vier Szenarien. Sie speichert die Rohdaten automatisch unter
`build/navigation-results/`. Die Seite muss sichtbar bleiben; währenddessen keine
Builds, Tests oder anderen CPU-lastigen Arbeiten ausführen. Auflösung und
Grafikqualität zwischen den Builds gleich lassen. Manuelle Eingriffe oder die
Diagnoseansicht machen den Lauf für die Performanceabnahme ungültig.

```text
npm run nav:compare -- --session EINDEUTIGE-SERIE --max-regression 0.16
```

Der Vergleich prüft Build-Identitäten, Ausgangsgeometrie, Konfigurationen, Population,
Browser, Hardware, Auflösung und Messdauer. Jedes Szenario erhält einen eigenen
p95-Vergleich für Framezeit und CPU. Unsichere Ergebnisse verlangen sieben Paare;
unvollständige Messbarkeit heißt `OPEN`. Ein guter Durchschnitt ersetzt keinen
schlechten Einzelfall. CPU umfasst den vollständigen produktiven `Phaser.Game.step`,
einschließlich Input, Audio, Scene-Plugins, Physik, Rendering und neutralem Lab-Aufwand.
Arcade-Update und -PostUpdate werden zusätzlich durch transparente Lab-Messhüllen in
der ursprünglichen Aufrufreihenfolge erfasst; diese schließen Kollisionscallbacks ein.
`physicsMs` bezeichnet dagegen nur die vorhandene Host-Physikvorbereitung.
Worker-Zeit wird separat erfasst. Dies ist keine Messung der gesamten Browserprozess-CPU oder GPU-Zeit.
GC wird nur als verfügbar ausgewiesen, wenn der Browser dafür Daten liefert.

Die neue Navigation protokolliert außerdem kumulative Besuche lokaler Nachbarn,
Beobachtungen wartender Nachbarn und Expansionen der Durchbruchssuche. Diese Zähler
stehen nur für den neuen Pfad zur Verfügung; fehlende Baseline-Zähler werden als
unverfügbar ausgewiesen. Differenzen zwischen Anfang und Ende grenzen die Messphase ab.

### Reaktionszeit nach einer Hindernisänderung

`mutations=1` entfernt während eines Kandidatenlaufs bis zu drei nahe Felsen über
den kanonischen World-Mutationspfad. Der Bericht enthält unter `geometryChanges`
Objekt, betroffene Einheit, Topologie vorher/nachher und die Wall-Clock-Zeit bis zu
deren erster nutzbarer Routenentscheidung. Zwei Sekunden ohne Ergebnis werden als
Timeout erfasst. Beispiel: Kandidaten-URL mit `scenario=rock-field&count=100&seed=183&warmup=10&duration=20&autorun=1&mutations=1`.
Diese veränderlichen Läufe erhalten eine eigene Session und gehören nicht zur
unveränderten Performance-Referenzserie. Fehlende Ereignisse sind keine bestandene Prüfung.

## Kontrollierte Headless-Vergleiche

```text
npm run nav:headless
npm run nav:headless -- --density
```

Jeweils zehn feste Seeds, 20/50/100 Einheiten, Felsfeld, ein 32-px-Engpass und zwei
Alternativwege. Seeds verändern im Felsfeld die Hindernisse und in allen Fällen die
Zuordnung der Einheiten zu den Startplätzen. Der erste Lauf vergleicht eingefrorene und aktuelle produktive
Steuerung, der zweite aktuelle Steuerung ohne/mit Dichtekosten. Die Körperbewegung
wird durch einen exakten Sweep-Harness integriert; Kampflogik und Arcade-Zeiten
werden hier nicht behauptet. Angekommene Einheiten starten erneut, damit der
Ausgang frei und die Population konstant bleibt. Das ist eine Szenarioregel und
keine Teleport-Recovery im Spiel.

Rohdaten: `headless.json` und `headless-density.json`, einschließlich Quellhashes,
Umgebung, erster Ankunft, Durchsatz, Stillstand, unsicheren Bewegungsvorschlägen
und CPU-Perzentilen. Unsichere Vorschläge der Baseline sind keine gezählten
Wanddurchtritte im normalen Spiel: dort greift zusätzlich die Physik ein.

`--smoke` reduziert auf einen Seed und 20 Einheiten; diese Kurzprüfung zählt nicht
als Abnahme. `NAVIGATION_DURATION_MS` überschreibt die standardmäßigen 60 Sekunden.

## Ergänzende Prüfungen

Die bestehenden Suiten schützen Zielbindung, Köder, Rauch, Angriffe, Fähigkeiten,
Fraktionen, Activity-Lifetime und Netzwerk. Die zusätzlichen Navigationstests
prüfen Körperfreiheit, Rasterausrichtung, Worker-Generationen, gesperrte und
ausstehende Routen, Angriffserlaubnis, mehrteilige Öffnungen und Basisvorrang.
Die [Gegner-Migration](navigation-enemy-migration.md) ordnet jedes bestehende Profil
seinem Primärziel, Fallback und erlaubten Nebenaktionen zu.
