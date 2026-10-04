# Deterministische visuelle Regression

## Ursache und Grenze

Die alte Testuhr lieferte bereits feste Frame-Deltas, `Date.now()` und eine pro Frame
gesetzte `Math.random`-Folge. Die Freigabe der Lobby hing trotzdem von
`BootScreen.fadeOut()` ab: CSS-`transitionend` oder dessen echter Timeout beendeten
den Boot. Währenddessen wurden native Browserframes in feste Simulationsschritte
übersetzt. Browserlast und Bildwiederholrate bestimmten deshalb die Anzahl dieser
Schritte und den Startzeitpunkt der Runde.

Beleg aus unverändertem Code: Der archivierte Spawn-Kontrolllauf nahm den zerstörten
Zug bei 7533,333 ms auf, die lokale Main-Gegenprobe bei 7350 ms. Die Rundenversionen
endeten auf 883 bzw. 716 ms; der Kameraversatz unterschied sich um rund 1,47 / 2,31
Weltpixel. Die zwölf angeforderten Explosionsframes allein definierten den Zustand
also nicht. Nachtaugen und Lichtphasen lesen ebenfalls die Scene-Uhr.

Zusätzlich akkumulierte `+= 1000 / 60` Gleitkommafehler. Das anschließende Abrunden
für `Date.now()` konnte eine nominell ganzzahlige Framegrenze eine Millisekunde zu
früh ausgeben. Ein vorhandener Uhrtest schützt nun auch diese Grenze.

## Entscheidung

- Nur `dev-scenario.html?visual-test=1` bindet die DOM-Bootfreigabe an Phasers
  Scene-Timer. Ein fester Boot-Vorlauf von 800 ms bewahrt die Phase der bestehenden
  Lobby-/HUD-Referenzen. Er ist Simulationszeit, keine Wartefrist für Assets.
- Der Visualtest berechnet die Zeit aus der ganzzahligen Anzahl der Schritte.
  Produktionszeit, normale Dev-Szenarien, Zufallsalgorithmen, Zug-Choreografie,
  Gegner-Spawns, Licht- und Partikelcode bleiben unverändert.
- Netzwerkfreier Szenarioaufbau, World-Renderbarriere, feste Effektframes und
  Delta-null-Publikation bleiben bestehen. Downloads, Worker-Budgets und
  Fehlerfristen verwenden weiterhin echte Zeit.
- Pausierte Bilder werden nach zwei weiteren nativen Browserframes erneut
  aufgenommen. Ohne Masken müssen alle Pixel und die Simulationszeit identisch sein.
- Jeder Wiederholungslauf startet Chrome mit neuem temporärem Profil auf dem
  Arbeitslaufwerk. `--shot` ermöglicht gezielte Updates samt vorausgehenden Cues.

Die Zug-Planung und ihre kosmetischen Burst-Phasen besitzen bereits lokale Seeds.
GPU-Partikel altern mit Scene-Deltas; Licht- und Kameraphasen lesen Scene-Zeit.
Keine zusätzliche Zufallsquelle musste im Spiel ersetzt werden. Optionales
Gegner-Schatten-Mesh-Warmup war nicht die Ursache der Nachtabweichung: nachts fehlt
der Sonnenschatten. Seine Vorverlegung würde die bestehende Tagansicht ändern und
ist nicht Bestandteil dieser Reparatur.

Ein globaler Ladestopp wurde verworfen: Lobby-Ausblendung und World-Übergangs-Timer
benötigen Zeit. Die Korrektur sitzt stattdessen an der nachgewiesenen DOM-/Scene-
Zeitgrenze. Toleranz und Masken wurden nicht gelockert.

## Nachweis

Aktuelle Abnahme und Zahlen: [verification.json](../../tests/visual/verification.json).
Nur `enemies-night.webp` und `train-destroyed-f12.webp` werden neu referenziert.
Die übrigen 21 Referenzbilder bleiben bytegleich. Die Zahl der Ansichten ist seit
Integration der Turmgruppe auf Main von 20 auf 23 gestiegen.

Abnahme am 4. Oktober 2026: fünf vollständige Läufe mit je frischem Chrome-Profil,
115/115 Bildvergleiche bestanden. Jede eingefrorene Bildpaarung blieb pixelgleich;
Simulationszeit, Rundenversion und Kameraposition waren für jede Ansicht über alle
fünf Läufe identisch. Die maximale Referenzabweichung war 0,0895 % bei unverändert
0,1 % Toleranz. `npm run check` bestand mit 4.934 Core- und 54 Architekturtests sowie
beiden Builds; `npm run test:assets` bestand mit 180 Tests. Das bereits vorhandene,
ignorierte Offline-Manifest für zwei Assettests wurde unverändert aus dem Hauptrepo
in den Klon kopiert; Pfad und Prüfsumme stehen im Prüfprotokoll.

Die Prüfung gilt für die dokumentierte Windows-/Chrome-/GPU-Umgebung und die
gewählten Standbilder; sie ist kein vollständiger Gameplay- oder Leistungstest.
