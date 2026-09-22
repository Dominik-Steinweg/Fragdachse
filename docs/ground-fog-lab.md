# Bodennebel-Lab und Implementierung V1

Das Lab verwendet `GroundFogSystem`, Terrain-Autotiling, Wasser und Beleuchtung aus dem Spiel.
Einstieg: `fog-lab.html`, Code: `src/dev/fogLab.ts`. Es ist kein Gameplay-Modus und sendet keine Netzwerk-Nachrichten.

## Start und Bedienung

```powershell
npm run dev:browser
# Nach HTTP 200: http://127.0.0.1:8090/fog-lab.html
npm run build:fog-lab
# Unveränderlicher Messbuild über denselben Dev-Server:
# http://127.0.0.1:8090/build/fog-lab/fog-lab.html
```

Ein belegter Port wird nicht freigeräumt. Für die Implementierungsprüfung war 8090 bereits
durch den Map-Editor belegt; verwendet wurde `npm run dev:browser -- --port 8092`.

- **Durchbruch / Explosion:** Zielhindernis entfernen, mit beziehungsweise ohne radialen Impuls.
  Bei der Basis verschwindet die Kollision sofort, die Produktionsoberfläche in zeitversetzten Zellen.
- **Laufen / Dash:** Wiederholbarer Lauf mit schnellem Abschnitt und anschließendem Stillstand;
  daneben bewegt sich ein größerer Gegner. **Teleport** unterbricht die Quellrevision.
- **Dauerfeuer / Einzelschuss:** P90, Glock, Schrot, große Geschosse, Abpraller oder 12-ms-Geschosse.
  Bestätigte Wegstücke laufen durch `ProjectilePathCursor`, einschließlich des Abschlusssegments.
  Ohne Historie tastet `ProjectilePresentationRuntime` die dargestellten Positionen ab.
  Hitscan und Nahkampf sind zusätzlich auswählbar. Gerade, diagonale und schwenkende
  Fächerschüsse dienen der Spurprüfung; Lauf und Dash lassen sich einzeln wiederholen.
- **Schützen / Projektile pro Schuss:** Bis zu vier gleichzeitige P90-Schützen mit je drei
  Projektilen. P90-Takt, Geschwindigkeit und Reichweite stammen aus dem Waffen-Authoring.
  Die Stresssuite ergänzt wiederholte Richtungswechsel zu den sichtbaren Fächern.
- **Flammenwerfer / Laubbläser / BFG:** Produktions-VFX zum Vergleich; die Strömungswaffen
  verbreitern ihre Spur mit der Projektilgröße. BFG-Größe, Tempo und Reichweite kommen aus dem Authoring.
- **Spurbreite × / Spurdauer ×:** Vorschau der beiden Waffenfaktoren (0–8, Standard 1),
  einschließlich Hitscan und Nahkampf. Änderungen gelten für neue Abschnitte.
  **Pfadquelle → Ohne Flugbahnhistorie** erzwingt den gemeinsamen Pose-Eingang für jedes Geschoss.
- **Zug / Nachlauf:** Eine RB-54-Durchfahrt; Pause und Einzelschritt erlauben feste Ansichten.
- **Kamerapfad:** Hin- und Rückweg durch die World; **Zoom** enthält auch einen extremen
  Sichtbereich zur Kapazitätsprüfung. **Kamerawackeln** nutzt den gemeinsamen Camera-Feedback-Owner.
- **Pause / Einzelschritt / Langer Frame:** Fortschreibung, Impulsalter und Materialzeit prüfen.
  Der lange Frame darf höchstens zwei Simulationsschritte nachholen.
- **URL aktualisieren / JSON exportieren:** Parameter reproduzieren beziehungsweise Messbericht exportieren.
  Nach einem Parameterwechsel dient **Welt neu aufbauen** zum identischen Ausgangszustand.

Transportmaske, Darstellungsmaske, Wassergewichtung, Dichte, unerreichte Öffnungen,
Geschwindigkeit und Impulsbelegung lassen sich getrennt anzeigen.

## Akzeptierte Grundabstimmung

Nach Nutzerrückmeldung wurde der Standard dichter und sichtbarer eingestellt:
Deckkraft **0,50**, zentraler Dichtefaktor **1,85**, Map-Stärke weiterhin **1**.
Das entspricht ungefähr den vorherigen Reglern nahe ihrem Maximum. Die gemeinsame
Deckkraftgrenze bleibt 0,30; Lichtmap und Tageskurve gelten weiterhin.
Zentrale Werte stehen in `src/effects/groundFog/FogConfig.ts`.

Die Lobby verwendet ebenfalls die normale Nebelstärke. Ihre Nebeldichte folgt der
angezeigten, vom Host gewählten Lobby-Uhrzeit über denselben Zeitwert wie die Beleuchtung;
das gilt auch beim Betreten des Testgeländes. Die lokale Grafikoption „Bodennebel“ bleibt wirksam.

Waffenspuren verwenden die feine GPU-Maske: Das 8-Pixel-Feld erzeugte bei schmalen
Spuren punktförmige Löcher. Bestätigte, gerade Flugsegmente derselben Projektilidentität
werden deshalb unabhängig vom groben Impulsbudget zusammengefasst. Abpraller und
Unterbrechungen bleiben getrennt. Höchstens 8.192 gespeicherte Abschnitte begrenzen die Last;
ein lokales Tile-Limit existiert nicht mehr. Ein GPU-Aufruf zeichnet die tatsächlich sichtbaren
Kapsel-Flächen. Eine Maximum-Verknüpfung verhindert dunkle Knoten an Endkappen und Kreuzungen.
Die RGBA8-Kommandotextur ist 1.024 Pixel breit; es werden keine Float-Renderziele benötigt.
WebGL 1 benötigt `EXT_blend_minmax`, WebGL 2 bietet diese Verknüpfung direkt. Fehlt sie,
greift die vorhandene Abschaltung bei fehlenden Nebel-Fähigkeiten.
Abstand, stetiges Alter und Auslaufen über 3,2 Sekunden bleiben auf der GPU. Zeitstempel
werden niemals in die Zukunft gerundet. Unveränderte Geometrie wird nicht erneut hochgeladen.
Die Maske moduliert ausschließlich vorhandene Dichte und entfällt bei niedriger Qualität.
Das Lab zeigt gespeicherte und sichtbare Abschnitte, Zeichnungsaufrufe und verworfene Eingaben.

Flamme und Laubbläser verwenden eine mit der Projektilgröße wachsende, weiche Spurbreite.
Der Laubbläser teilt seine Größenfunktion mit dem Partikelrenderer.
Projektile ohne replizierte Flugbahn (unter anderem Laubbläser und BFG) erhalten
lokale Segmente aus der tatsächlich dargestellten Host-/Client-Pose. Dieser Eingang in
`ProjectilePresentationRuntime` gilt für jeden Projektiltyp. Das Lab verwendet denselben Weg.
Stillstand, Positionssprünge, Entfernen und World-Wechsel erzeugen keine verbindenden Ersatzspuren.
Bestätigte Historien bleiben vorrangig; beide Eingänge erzeugen keine doppelten Spuren.

Die Zugspur ist ungefähr
1,7 Zugbreiten breit und klingt über zehn Sekunden aus. Lokfront und Zugende liefern dafür
Segmente aus der dargestellten, auch auf Clients interpolierten Zugposition. Zusätzlich
verdrängen sie das grobe Nebelfeld; diese Feldreaktion bleibt auch auf Niedrig aktiv.

Die Reaktionsabstimmung vom 22. September erhöht den Eingangsimpuls beim Laufen um
Faktor 9 und beim Dash um Faktor 1,35 (jeweils mit Sättigung). Größere Projektile erhalten
einen moderaten Zuschlag. Hitscan nutzt den gemeinsamen Tracer-Eingang nach dessen
Prediction-Deduplizierung; Nahkampf wirkt als gerichteter Sektor, auch bei Biss und Taser.
GPU-Druckausgleich und Bewegungsaustausch über offene Zellflächen verbreitern den Stau
vor Hindernissen und tragen die abgelenkte Strömung über die Ecken weiter.

## Optionale Faktoren pro Waffe

Im jeweiligen Eintrag unter `src/loadout/content/data/` können die Felder neben `id`,
`damage` oder `cooldown` stehen, zum Beispiel in `weapons-ballistic.json` bei P90:

```json
"fogTrailWidthFactor": 1.5,
"fogTrailDurationFactor": 2
```

Breite und komplette Ausblendkurve werden unabhängig multipliziert. Fehlend bedeutet 1,
0 bei einem der Faktoren deaktiviert die Waffenspur. Zulässig sind endliche Werte von 0 bis 8.
Der Validator und die vorhandene Variantenvererbung unterstützen beide Felder.
Die BFG steht im Utility-Eintrag `BFG` in `utilities-tactical.json`.
Hitscan und Nahkampf verwenden dieselben Faktoren; beim Nahkampf skaliert die Breite
die Reichweite des Sektors. Der Öffnungswinkel bleibt gleich.

Die Auflösung erfolgt über die konkrete Waffen-ID, nicht über den geteilten Grafikstil.
Dafür tragen die vorhandenen Projektil-Statik- und Kampf-VFX-Daten optional
`weaponSourceId` (Peer-Protokoll 20). Es gibt keine Nebel-Simulationsnachrichten.
Auch große Geschosse und Nahkampf altern nun analytisch in der GPU-Spurmaske,
damit ihre Dauer vollständig vom Faktor bestimmt wird. Niedrig zeigt weiterhin nur
Nahkampf-, Figuren- und Zugreaktionen, keine Projektil- oder Hitscanspuren.

## Eigentümer und Datenfluss

`WorldPresentationBinding` besitzt das Nebelsystem. `WorldGroundFogBinding` sammelt Gelände,
Explosionen und bestätigte Projektilpfade; `WorldPresentationFrameBinding` liefert dargestellte
Figuren, Uhrzeit, Qualität und Kamera. Beim Handoff werden Eingänge getrennt, während das
bereits gezeichnete Bild eingefroren bleibt. Der endgültige Presentation-Teardown entfernt GPU-Ressourcen.

`FogTerrainModel` hält Sperren, Dirty-Zellen und das Öffnungsjournal. `FogResidency` verwaltet
weltfeste Slots. `FogGpuField` führt die RGBA8-Ping-Pong-Pässe aus. `FogImpulses` und
`FogTrailSegments` enthalten begrenzte Beobachtungen, keine CPU-Nebelsimulation.
`FogTrailRenderer` zeichnet die Spurmaske als begrenzten Geometrie-Batch über Phasers
WebGL-Zustandswrapper. Seine Puffer gehören zum GPU-Feld und enden mit dessen Lifetime.

Transport erfolgt über vier offene Zellflächen. Gepackte 16-Bit-Werte werden vor
Interpolation dekodiert; Datenpässe verwenden Nearest-Sampling, kein Blending und kein Dithering.
Maskenänderungen in eingefrorenen Cache-Chunks bleiben bis zur Wiederaufnahme erhalten,
ohne unveränderte Zellen zurückzusetzen. Nach Verdrängung verhindern bekannte Öffnungen
einen neuen lokalen Grundnebel. Es gibt keine GPU-Rücklesung im normalen Spielbetrieb.

## Prüfung und Messprotokoll

**GPU-Verträge prüfen** erzeugt einen isolierten Produktionsrenderer und liest kontrolliert
einzelne Pixel aus. Geprüft werden Sperren, geschlossene Wände, randseitiger Zufluss,
leere Öffnungsmitten, erneutes Bebauen, Geschwindigkeitskodierung, numerische Stabilität,
Cache-Änderungen und schmale, auslaufende Projektilspuren. Diese Auslesungen erfolgen niemals
während einer Performance-Messung.

**A/B/C messen** baut für jeden Lauf denselben Seed und Weltzustand neu auf, aktiviert zwei
Figuren, P90-Dauerfeuer und alle vier Sekunden eine Explosion. Kamera, Qualität und Auflösung
bleiben gleich. Pro Variante werden drei Läufe mit jeweils zehn Sekunden Aufwärmzeit und
30 Sekunden Messung ausgeführt. Alle Regler bleiben währenddessen gesperrt.

Das Lab nutzt einen festen 60-Hz-Timer, weil der eingebettete Browser RAF im Hintergrund
stark drosseln kann. Der Bericht enthält `validCadence`; zu wenige Frames oder zu wenig
fortgeschrittene World-Zeit machen einen Lauf ungültig. Frame-Percentile beschreiben daher
den Lab-Takt und sind keine Aussage über eine maximal erreichbare Spiel-FPS.

CPU-Submission und optionale asynchrone GPU-Timer werden getrennt berichtet. Ungültige
Disjoint-Abfragen werden verworfen. Ohne Extension steht ausdrücklich „GPU-Zeit nicht verfügbar“.
Bei ausgeschaltetem Nebel werden keine Nebelpässe ausgeführt und keine GPU-Zeit abgefragt.

Aktuelle Lastmesswerte und Prüfstatus stehen in
[ground-fog-load-validation.md](ground-fog-load-validation.md), frühere Abnahmen in
[ground-fog-validation.md](ground-fog-validation.md).
