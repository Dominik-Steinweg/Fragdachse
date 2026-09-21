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
- **Dauerfeuer:** P90, Schrot, große Geschosse, Abpraller oder 12-ms-Geschosse.
  Alle Wegstücke laufen durch `ProjectilePathCursor`, einschließlich des Abschlusssegments.
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

Kleine Geschosse benötigen zusätzlich die feine GPU-Maske: Das 8-Pixel-Feld verlor
schmale, rasterparallel verlaufende P90-Spuren. Die Ergänzung verwendet höchstens
2.048 bestätigte Segmente, berechnet Abstand und Alter im Shader und moduliert ausschließlich
vorhandene Dichte. Sie verbreitert den Transportkanal nicht und entfällt bei niedriger Qualität.

## Eigentümer und Datenfluss

`WorldPresentationBinding` besitzt das Nebelsystem. `WorldGroundFogBinding` sammelt Gelände,
Explosionen und bestätigte Projektilpfade; `WorldPresentationFrameBinding` liefert dargestellte
Figuren, Uhrzeit, Qualität und Kamera. Beim Handoff werden Eingänge getrennt, während das
bereits gezeichnete Bild eingefroren bleibt. Der endgültige Presentation-Teardown entfernt GPU-Ressourcen.

`FogTerrainModel` hält Sperren, Dirty-Zellen und das Öffnungsjournal. `FogResidency` verwaltet
weltfeste Slots. `FogGpuField` führt die RGBA8-Ping-Pong-Pässe aus. `FogImpulses` und
`FogTrailSegments` enthalten begrenzte Beobachtungen, keine CPU-Nebelsimulation.

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

Messwerte und Prüfstatus stehen in [ground-fog-validation.md](ground-fog-validation.md).
