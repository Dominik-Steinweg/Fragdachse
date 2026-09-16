# Navigations-Lab und Regressionstests

Das Lab prüft die aktuelle produktive Navigation. Frühere Implementierungsstände
und Vergleichsberichte sind über die Git-Historie nachvollziehbar; die alte KI
wird nicht mehr lokal mitgeführt oder ausgeführt.

## Einstieg

`npm run dev:browser` startet den vorgesehenen lokalen Server auf Port 8090.

```text
http://127.0.0.1:8090/navigation-lab.html?scenario=rock-field&seed=183&count=100&autorun=1
```

Der Einstieg startet die produktive Arena ohne Lobby. Start, Pause, Einzelschritt,
Neustart, Diagnoseansicht und JSON-Export sind normale HTML-Bedienelemente.

Parameter: `scenario=rock-field|siege|combat|allies`, `seed`, `count`, `warmup`
und `duration` (Sekunden), `autorun=1`, `density=1`. Globale Dichtekosten sind
ohne expliziten Parameter ausgeschaltet. Die Simulation bleibt hostautoritativ;
der lokale Raumadapter wird ausschließlich vom Lab-Einstieg installiert.

Die Szenarien verwenden reale Maps, Gegner, Waffen, Fähigkeiten, Arcade-Physik
und Darstellung. Der Referenzspieler wird am Leben gehalten; gestorbene Gegner
werden ersetzt. Fähigkeitsspawns können die Mindestpopulation überschreiten.
Seed und Konfiguration fixieren Layout und Lab-Spawns. Das vollständige
Kampfgeschehen ist wegen Echtzeit-Taktung und zufälliger Fähigkeiten kein
bitidentisches Replay. Population, Ersatzspawns und Kampfereignisse stehen deshalb
im Bericht. Mehr Kämpfe oder Effekte sind für sich kein Navigations-Performancefehler.

`rock-field` schaltet nur das automatische Feuern des Referenzspielers aus;
Gegner greifen weiterhin an. Die Browserfälle sind keine kampffreien
Navigations-Microbenchmarks. `siege` verwendet die Belagerer-Mischung auf Map 6.
Deren ungebundene Vorposten sind nach dem Zielquellenvertrag keine strategischen
Basisziele; hier wird auch das Spieler-Fallback belastet. Echte Basisbindung
und Durchbrüche schützen die kontrollierten Verhaltenstests.

## Gezielte Fehlerprüfungen

- `navigation-lab.html?spawnAudit=1&map=1&seed=183&autorun=1` prüft jede authored
  Encounter-Gruppe über den produktiven Spawn-Executor und echte Arcade-Körper.
  Pro Gruppe wird ein Gegner erzeugt und seine Körperfreiheit sofort sowie über
  600 ms Bewegung beobachtet. Der Referenzspieler steht nahe dem jeweiligen Bereich.
  Die vollständigen Gruppenzahlen und den Missionsfortschritt prüft zusätzlich
  `tests/stress/NavigationSpawns.test.ts`: alle Maps mit zehn Seeds sowie sämtliche
  Map-1-Encounter mit verzögerten Gruppen und aktiven Missionsbarrieren.
- `navigation-lab.html?scenario=siege&pursuit=1&count=20&seed=183&warmup=5&duration=30&autorun=1`
  bewegt den Spieler kontinuierlich auf einer geometrisch freien Strecke.
  Er feuert nicht automatisch; Gegner und vorhandene Türme bleiben produktiv.
  `pursuitTrack`, Wartegründe und begrenzte `overlapEvents` stehen im Bericht.
- `mutations=1` entfernt bis zu drei nahe Felsen über den kanonischen
  World-Mutationspfad. `geometryChanges` enthält Objekt, betroffene Einheit,
  Topologie und die Wall-Clock-Zeit bis zur ersten nutzbaren neuen Route.
  Zwei Sekunden ohne Ergebnis zählen als Timeout. Beispiel:
  `navigation-lab.html?scenario=rock-field&count=100&seed=183&warmup=10&duration=20&autorun=1&mutations=1`.
  Fehlende Änderungsereignisse sind keine bestandene Prüfung.

## Profiling mit gebautem Bundle

`npm run build:nav-lab` erzeugt das aktuelle Lab unter `build/navigation-lab/`.
Der lokale Server liefert seinen HTML-Einstieg ohne HMR aus; Quelländerungen laden
einen laufenden Profilingfall dadurch nicht neu.

```text
http://127.0.0.1:8090/build/navigation-lab/navigation-lab.html?scenario=rock-field&seed=183&count=100&warmup=10&duration=60&autorun=1
```

Optional führt `suite=reference` alle vier aktuellen Szenarien mit jeweils drei
Wiederholungen aus. Berichte werden unter `build/navigation-results/` gespeichert.
Es gibt keinen automatischen Wechsel zu einer alten Version.

Für aussagekräftiges Profiling bleibt die Seite sichtbar und die Diagnoseansicht
geschlossen. Während der Messung keine Builds, Tests oder anderen CPU-lastigen
Arbeiten ausführen. Build-Identität, Layout-Fingerprint, Konfigurationen, Seed,
Dauer, Browser, Hardware, Grafikqualität und Renderauflösung stehen im Bericht.

### Messwerte richtig einordnen

- `frameCpuMs` umfasst den vollständigen `Phaser.Game.step`, einschließlich
  Input, Audio, Kampf, Rendering und Lab-Aufwand. Arcade-Update und -PostUpdate
  werden separat erfasst, einschließlich ihrer Kollisionscallbacks.
  `physicsMs` bezeichnet nur die Host-Physikvorbereitung.
- Zielentscheidung, lokale Bewegung, unmittelbare Körperprüfungen, Recovery und
  Durchbruchssuche laufen im Main Thread. Globale Körpergraphen, Regionen und
  Felder werden im Worker berechnet; Startvorbereitung und Inline-Fallback können
  synchron laufen.
- `navWorkerComputeMs` ist die Rechenzeit des zuletzt abgeschlossenen Jobs.
  Sie ist keine zusätzliche Main-Thread-Zeit pro Frame. Kumulative Arbeitszähler
  über Differenzen zwischen Messanfang und -ende auswerten. Die p95-Werte
  einzelner Phasen lassen sich nicht zu einem Gesamt-p95 addieren.
- `stationaryWithoutAttackMs` enthält zulässiges Warten.
  `unwantedStationaryMs` hängt vom Bewegungswunsch ab. Ankünfte und Durchsatz
  ergänzen diese Zähler bei der Bewertung von Bewegungsklemmen.
- `combatantDamageEvents` zählt tatsächlich zugefügten Spieler-/Gegnerschaden
  über den passiven Combat-Beobachter. Dieser wird nach Messende, Fehler oder
  Scene-Teardown entfernt. Grafikobjektzahlen sind keine Angriffszahlen.
- Nicht verfügbare GC- oder GPU-Daten gelten nicht als gemessen. Heap-Samples
  sind keine vollständige Speicherprofilierung.

## Kontrollierte Bewegungsregressionen

```text
npm run nav:stress -- --smoke
npm run nav:stress
```

Der Test `tests/stress/NavigationMovementStress.test.ts` verwendet ausschließlich
die aktuelle Navigation. Er prüft Felsfelder, einen 32-px-Engpass und zwei
Alternativwege. Der vollständige Lauf umfasst zehn feste Seeds und 20/50/100
Einheiten, insgesamt 90 Fälle. `--smoke` reduziert auf einen Seed und 20 Einheiten,
also drei Fälle. Jeder Fall simuliert 60 Sekunden und verlangt sichere
Bewegungsvorschläge sowie die Ankunft aller Einheiten.

Seeds verändern im Felsfeld die Hindernisse und in allen Fällen die Zuordnung
zu Startplätzen. Angekommene Einheiten starten erneut, damit Ausgang und Population
für die Belastung konstant bleiben. Dieser Szenario-Reset ist keine
Teleport-Recovery im Spiel. Die längere Suite ist explizit über `nav:stress`
aktiviert und wird bei allgemeinen Testläufen übersprungen.

Berichte liegen unter `build/navigation-results/movement.json` bzw.
`movement-smoke.json`, mit Quellhash, Umgebung, Ankünften, Durchsatz, Stillstand
und CPU-Perzentilen. Die Prüfung verwendet einen Inline-Runner und einen exakten
Körper-Sweep-Harness. Sie misst keine isolierte Browser-Main-Thread-Zeit und
bildet Kampf oder Arcade-Gleiten nicht nach.

## Weitere Verhaltenstests

Die bestehenden Suiten schützen Zielbindung, Köder, Rauch, Angriffe, Fähigkeiten,
Fraktionen, Activity-Lifetime und Netzwerk. Navigationstests prüfen Körperfreiheit,
Rasterausrichtung, Worker-Generationen, ausstehende Routen, Angriffserlaubnis,
mehrteilige Öffnungen und Basisvorrang.
Die [Gegnerprofile](navigation-enemy-migration.md) ordnen jede bestehende Art
ihrem Primärziel, Fallback und erlaubten Nebenaktionen zu.
