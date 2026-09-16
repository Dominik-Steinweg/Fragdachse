# KI-Navigation: abgeschlossene Umsetzung

## Entscheidung

Die neue Navigation ist nach automatisierten Prüfungen und erfolgreichen Spieltests
angenommen und bleibt der Produktivpfad. Vergleiche gegen die alte Logik werden
nicht mehr durchgeführt. Die eingefrorenen Quellen, Vergleichs-Builds, Archive,
temporären Messdaten und zugehörigen Vergleichsscripts wurden entfernt.

Der ausführliche damalige Abschlussbericht ist in der Git-Historie unter
Commit `0179efb622b7c0d048d269b38527529636ba90e9` erhalten.
Die produktive Navigation einschließlich Worker und Inline-Fallback sowie die
gezielten Verhaltenstests bleiben bestehen.

## Produktiver Umfang

- Eine Activity-eigene Zielabsicht verbindet Gegner und Nekromantie-Verbündete.
  Spielerjäger bevorzugen frei erreichbare Spieler; Belagerer behalten ihre
  Basisabsicht. Explizite Nebenaktionen und verbindlich begonnene Fähigkeiten
  bleiben erhalten.
- Das World-Raster bleibt bei 32 px. Die körpergerechte Navigation verwendet
  ausgerichtete 16-px-Punkte und kanonische Rechtecke, Kreise, Wasser, aktive
  Basen und Missionsbarrieren. Ganze Bewegungssegmente, Startanschlüsse und
  Angriffsbereiche werden geometrisch geprüft.
- Freie Wege haben Vorrang. Ausstehende Routen oder Gedränge erlauben keinen
  Durchbruch. Geteilte Durchbruchsaufträge berücksichtigen Körperbreite,
  mehrteilige Öffnungen und Zerstörungsrechte; Basen bleiben letzter Ausweg.
  Schaden läuft durch die bestehende Combat-Pipeline.
- Normale Bewegung verwendet einen konsistenten Nachbarschaftsstand, lokale
  Alternativen, weiche Angriffsplatzreservierungen und überschneidungsreduzierende
  Recovery. Exklusive Fähigkeiten behalten Vorrang. Es gibt keinen neuen
  allgemeinen Teleport.
- Navigation und Suchzustände bleiben hostlokal und enden mit der Activity.
  Die [Gegnerprofile](navigation-enemy-migration.md) dokumentieren Zielrollen,
  Fallbacks, Nebenaktionen und Durchbruchsrechte aller bestehenden Arten.
- Globale Dichtekosten bleiben standardmäßig aus. Neue Schwarmgegner gehören
  zu einem späteren Ausbau.

## Abgesicherte Korrekturen und Ergebnisse

Der Spawn-Executor verwendet nach der Rasterumstellung durchgehend die tatsächliche
World-Position und den Körperradius. Verwechslungen von 16-px-Navigationsindizes
mit authored 32-px-Zellen und ungeprüfter Spawn-Jitter sind behoben. Das korrigiert
auch die späteren Map-1-Encounter. Derselbe Koordinatenfehler bei Zeitbomben gegen
Konstrukte wurde ebenfalls behoben.

Die Abschlussprüfung erfasste 6.199 kollisionsfreie normale Spawns über 18 Maps
und zehn Seeds. Auf Map 1 entstanden alle 490 angeforderten Gegner einschließlich
verzögerter Gruppen und aktiver Missionsbarrieren. Tatsächlich gesperrte Fronten
dürfen weiterhin ohne Spawn bleiben.

Bei bewegten Zielen läuft eine sichere Fortsetzung zum selben Ziel oder ein
geometrisch bestätigter direkter Anschluss weiter, während neue Felder ausstehen.
Geänderte Ziel-IDs oder physische Topologie übernehmen keine fremde bzw. veraltete
Route. Der Integrationstest mit 360 bewegten Spielerpositionen und Zielwechsel
zeigte keine zusätzlichen Bewegungspausen. Ausstehende Wegkosten allein
blockieren bei bestätigter freier Regionsverbindung auch keine Spawns.

Alle 90 kontrollierten Bewegungsfälle erreichten mit sämtlichen Einheiten das
Ziel, ohne unsichere Bewegungsvorschläge. Bei 100 Einheiten lag die Navigation
im damaligen Inline-Harness bei etwa 0,50–0,58 ms p95 pro Simulationsschritt.
Diese Werte sind keine isolierte Browser-Main-Thread-Messung. Mehr Kampf,
Population oder Effekte durch wirksamere KI werden gesondert als Spiellast
eingeordnet.

Core-, Architektur-, Integrations- und Stresssuiten bestanden beim Abschluss.
Browserproben ergänzten Spawn, Verfolgung und dynamische Hindernisänderungen.
Kurze Arcade-Kontakte an Felsecken bleiben eine bekannte Aussagegrenze;
ein allgemeiner Null-Überlappungsnachweis oder zusätzlicher manueller
Mehrrechner-Koop-Durchlauf wird nicht behauptet.

## Verbleibende Werkzeuge

Die [Lab-Anleitung](navigation-lab.md) beschreibt:

- das aktuelle Lab mit Start, Pause, Einzelschritt und JSON-Export;
- gezielte Spawn-, Verfolgungs- und Hindernisänderungsprüfungen;
- `npm run build:nav-lab` für ein Profiling-Bundle der aktuellen Version;
- `npm run nav:stress` und dessen `--smoke`-Variante für sichere Bewegung
  unter fester Population.

Weitere Arbeit richtet sich nach konkreten Fehlerberichten. Falls Profiling
nötig wird, stehen die eigenen Navigationsphasen, Nachbarschaftssuche und lokalen
Körperprüfungen im Vordergrund. Eine weitere Vergleichsserie mit alter KI ist
keine Voraussetzung.
