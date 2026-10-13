# Dev-Szenarien

Mit `npm run dev:browser` starten und [dev-scenario.html](http://127.0.0.1:8090/dev-scenario.html) öffnen.
Die Seite startet das echte Spiel mit einem lokalen Host, ohne Broker oder Mitspieler.
LocalStorage und SessionStorage werden **vor dem Import des Spiels** durch flüchtige Speicher ersetzt.
Der normale Spielstand und seine Freischaltungen werden dadurch weder gelesen noch verändert.
Der Einstieg und die Bedienoberfläche werden vom normalen Produktionsbuild nicht ausgeliefert.

## Bedienung

### Mörser-Dachs: Gate 1

Map `0` (`00-test`) enthält einen Mörser-Encounter. Für isolierte Versuche im bestehenden
Dev-Szenario Map `0`, `suppressWaves: true` und einen festen Seed wählen. Einen freien Bereich
mit etwa 700–1000 px Abstand zwischen Spieler/Konstrukt und Mörser suchen; eine Zelle hat 32 px.
Über `target` zuerst die gewünschte freie Zelle auswählen, dann:

```js
devScenario.run({ action: 'spawn', kind: 'mortar-badger', pinned: false });
```

Mit dem Inspector einen ausgerüsteten Turm oder eine `rock_barrier` als Ziel platzieren
(`build`, `id` und freie Grid-Koordinaten). Im offenen Bereich und anschließend mit mehreren
natürlichen Felsen zwischen Ziel und Mörser wiederholen. Deckung beeinflusst Gate 1 noch nicht;
Felsen dürfen nur beim Einschlag Kollateralschaden erhalten. Der Mörser nähert sich über das
Flow-Field und hält während des offenen lila Zielkreises an. Das Ziel dann bewegen oder abbauen:
Der markierte Punkt bleibt fest. Vor dem geschlossenen Ring töten → Abbruch; danach töten →
Einschlag bleibt. Zusätzlich während des Windups in den Nahbereich laufen: kein Abbruch, aber
kein nächster Windup, solange ein lebender Spieler innerhalb der Mindestreichweite bleibt.

#### Mörser Gate 2: reproduzierbare Bildfolge

Bei belegtem Port 8090 einen eigenen Worktree-Server verwenden:
`npx vite --host 127.0.0.1 --port 8091 --strictPort`. Nach HTTP 200
`/dev-scenario.html?visual-test=1#scenario=…` mit diesem URL-kodierten Rezept öffnen:

```js
{ version: 1, mapId: '0', seed: 12345, classId: 'inspector_gadachs',
  player: { gridX: 12, gridY: 50 }, timeOfDay: 720,
  suppressWaves: true, freezeMission: true, hideTutorial: true, hideAim: true }
```

Nach `devScenario.whenReady()` Kamera auf Grid `(24,45)`, Zoom `1.2`,
`focusTarget: true`; zunächst 180 Frames `step`, dann 30 Frames `settle`.
Einen ungepinnten Mörser auf `(24,51)` spawnen. Die freundliche Basis liegt etwa
766 px entfernt. `step` 12 Frames und `capture()` ergeben mit den Gate-1-Zeiten
10 % Windup. Danach jeweils `step` und `capture()`: 47 Frames → 50 %, 47 → 90 %,
11 → THUMP, 6 → THUMP +117 ms, 22 → Flug +500 ms, 20 → Flug +850 ms,
8 → Impact, 14 → Impact +250 ms, 26 → Impact +700 ms.
`capture()` führt im pausierten Modus selbst einen Frame aus; Zeitpunkte daher
immer gegen die absoluten Zeiten in `mortarStrikes` prüfen.

Für den Abbruch einen Mörser mit `hp: 1` verwenden und während des Windups mit
der GLOCK töten. Für den Randpfeil während des Windups auf die Basis `(2,40)`
mit Zoom `1.8` fokussieren; der Source liegt rechts außerhalb des Bildes. Für die Nacht die
Live-Option `timeOfDay: 0` setzen und vor dem Spawn die Beleuchtung einpendeln lassen.
Vollbilder unverändert speichern; beschriftete Detailausschnitte dürfen für den
Übersichtsbogen ohne Skalierung oder Farbkorrektur kombiniert werden.

### Kraken: Abgrundteich (Dev-Review)

`kraken-abyss-lab` ist eine nur im Dev-Modus registrierte Diagnosekarte (70×48 Zellen)
mit einem etwa 27×21 Zellen großen Teich und Spielerstart am Südufer. Die Fixture hat
keine Gegner-, Treffer- oder Netzwerklogik. URL-Rezept (JSON URL-kodieren):

```js
location.hash = 'scenario=' + encodeURIComponent(JSON.stringify({
  version: 1, classId: 'dachs_nukem', mapId: 'kraken-abyss-lab', seed: 12345, timeOfDay: 720,
  player: { gridX: 39, gridY: 36 }, suppressWaves: true,
  freezeMission: true, hideTutorial: true, hideAim: true
}));
await devScenario.whenReady();
await devScenario.run({ action: 'krakenReview', run: 'kraken-v9', asset: 'abyssal-kraken', size: 320,
  land: { asset: 'abyssal-kraken-land', size: 360 },
  tentacle: { asset: 'abyssal-kraken-tentacle', size: 448 },
  egg: { asset: 'abyssal-kraken-egg', size: 64 }, waterLevel: .38 });
await devScenario.run({ action: 'krakenReview', clip: 'intro-rise', playing: true });
await devScenario.run({ action: 'krakenReview', tentacleClip: 'rise', tentacleFrame: 0,
  tentacleSequence: true, camera: 'tentacle', playing: true });
await devScenario.run({ action: 'krakenReview', eggClip: 'hatch', eggFrame: 8, camera: 'egg' });
```

Aufrufe sind Patches; ersten Aufruf und Assetwechsel immer `await`en. `run` kann auch
`pipeline-v8-smoke-2` sein, sobald dessen Exporte lokal vorliegen. Der Legacy-Standard
`kraken-v7` bleibt für den Sheet-Fallback nutzbar, enthält aber keine Elevation/Boss-Teile.

| Parameter | Bedeutung / Standard |
| --- | --- |
| `run`, `asset`, `size` | `kraken-v7`, `abyssal-kraken`, `320`; Pfad unter `art/poc/pipeline-v2/runs/<run>/<asset>/standard/` |
| `clip`, `frame` | `idle`, `0`; nullbasierter Clip-Index. Frameauswahl pausiert, Clipwechsel setzt den zugehörigen Frame zurück. |
| `playing`, `speed` | `false`, `1`; exportierte Bildrate × Geschwindigkeit. Szenariopause hält Animation und Shaderzeit an. `next` wird verfolgt; `terminal/free` ohne Nachfolger hält, `rest` kehrt zur Ruhepose zurück. |
| `phase`, `waterLevel` | `water` / `land`; `waterLevel:null` nutzt je Asset `elevation.previewWaterLevel` (sonst 0), explizit 0–1 Blender-Einheiten. |
| `submersion` | `true`; `false` schaltet nur den Objektfilter für den Lichtvergleich aus. Kein globaler Lichtwechsel. |
| `land`, `tentacle`, `egg` | Optionale Quellen `{run, asset, size, atlas?, elevationAtlas?}`; `null` entfernt das Teil. Run/Size können geerbt werden; Teile haben meist andere Zielgrößen. Drei Eier stehen an Land. |
| `tentacleClip`, `tentacleFrame`, `tentacleSequence` | `rise`, `0`, `false`; Sequenz spielt `rise → hover → slam → retract` je einmal, auch den Hover-Loop. |
| `eggClip`, `eggFrame` | `idle`, `0`; unabhängig vom Körper, auch `hatch`. |
| `tentaclePivot` | Fallback `[.5,.85]` im ungetrimmten Frame. Ein exportiertes `manifest.sockets.waterEntry:[u,v]` hat Vorrang. Fehlt der Socket, meldet `socketSource` den Fallback; er ist keine verifizierte Socket-Position. |
| `direction` | `90` Grad; 0 = rechts, 90 = unten. Nordwärts authored Tentakel und Bahn teilen den am Wassermodell ermittelten Uferpunkt. |
| `telegraphLength`, `telegraphWidth`, `telegraphProgress` | `320`, `112` Weltpixel, `.5`; reine Darstellung. |
  | `grid`, `camera` | `false`, `overview` / `body` / `tentacle` / `egg` / `effect`; Raster 32 Weltpixel. `effect` zentriert den Effektbereich. |
| `atlas`, `elevationAtlas` | Ohne Override: `export.json.atlases[size]` mit Per-Clip-Seiten laden, sonst optional `atlas.json`, sonst Sheet. `atlas:false` erzwingt Sheet. Sichere relative JSON-Pfade unter `standard/`. |

### Kraken-Körper und Eierflug (R5)

`effect: 'intro' | 'dive' | 'surface' | 'egg-throw'` steuert die Körperclips automatisch.
Alle vier benötigen `phase:'water'` und `submersion:true`; der Eierwurf zusätzlich ein Ei-Asset
mit `idle` und `hatch`. `effectTime` setzt die absolute Zeit in Sekunden, etwa `123/60` für
Review-Frame 123. `playback:'play'` spielt dieselbe Zeitachse ab. `camera:'effect'` zeigt den
Körper beziehungsweise folgt dem ersten Ei. `camera:'overview'` zeigt die gesamte Inszenierung.

| Parameterblock | Benannte Look-/Timing-Parameter (Standard) |
| --- | --- |
| `intro` | `lead:.6`, `radius:112`, `lifetime:1.65`, `foamOpacity:.72`, `sprayCount:80`, `spraySpeed:135`, `drain:.85`, `shakeScale:.35` |
| `intro` Ersatzmarker | `armsBreak:.875`, `keelBreak:1.45`, `eyesOpen:2.0625`, `roar:2.5` |
| `surface` | `lead:.2`, `radius:96`, `lifetime:1.1`, `foamOpacity:.62`, `sprayCount:56`, `spraySpeed:105`, `drain:.65`; Ersatzmarker `armsBreak:.25`, `keelBreak:.55`, `eyesOpen:.9` |
| `dive` | `submerged:.95` (Ersatzmarker), `radius:110`, `lifetime:1.5`, `foamOpacity:.65`, `shadowOpacity:.12` |
| `eggFlight` | `release:.65` (Ersatzmarker), `count:6` (1–8), `flight:.95`, `arcScale:.65`, `launchRadius:108`, `landInset:48`, `incubation:3.5`, `pulse:.16`, `slimeRadius:24`, `residue:1.6` |
| `eggTargets` | `[]`: radiale Landsuche; alternativ genau `count` Punkte `{x,y}` in Welt-Gridkoordinaten, geprüft auf Land und Weltgrenzen |
| `eggLaunches` | `[]`: `egg1`…`egg8`-Sockets, sonst radialer `launchRadius`-Fallback; alternativ genau `count` normierte Körperpunkte `{x,y}` in 0…1 |

Marker des Exports haben Vorrang vor Ersatzzeiten. `lead` wird auf die Clipzeit addiert;
`keel-break` wird verwendet, sofern vorhanden. `krakenReview.choreography` meldet Markerquellen,
Flugpunkte und die Startpunktquelle. v10 besitzt keine Armsockel: Die radialen Startpunkte sind
ein abstimmbarer Prototyp-Fallback. Exakte Armspitzen können über `eggLaunches` vorgegeben werden.
Abtauchen hält nach `submerged` einen schwachen Restschatten bis zum Effektwechsel. Eier und
Schleim verschwinden nach Hatch plus `residue`. Effektwechsel blendet alle privaten Quads aus;
die Fixture besitzt Pool, Filter und Texturen. Auftauchen verwendet keinen Kameraruck.

```js
await devScenario.run({action:'krakenReview', run:'kraken-v10', asset:'abyssal-kraken', size:320,
  egg:{asset:'abyssal-kraken-egg',size:64}, effect:'intro', effectTime:0, camera:'effect'});
await devScenario.run({action:'krakenReview', effect:'dive', effectTime:75/60});
await devScenario.run({action:'krakenReview', effect:'surface', effectTime:45/60});
await devScenario.run({action:'krakenReview', effect:'egg-throw', effectTime:0,
  eggFlight:{count:3}, eggTargets:[{x:30,y:37},{x:35,y:38},{x:40,y:37}]});
await devScenario.run({action:'krakenReview', effectTime:0, playback:'play'});
```

```powershell
node scripts/visual/kraken-review.mjs --run=kraken-v10 --r5=only
# Nach Fertigstellung des parallelen Exports:
node scripts/visual/kraken-review.mjs --run=kraken-v11 --r5=only
```

Der Runner erzeugt je Effekt 8–12 Zeitpunkte in Übersicht und Nahsicht als
`build/kraken-review/<timestamp>/r5-<effect>-<overview|effect>.png`, plus `report.json`.
Jede Aufnahme muss bytegleich eingefroren bleiben. R5-Rückwärtssprünge erlauben ausschließlich
Shader-Rundung von höchstens 3/255 je Kanal, ohne Pixelausnahmen; Messwerte stehen in
`report.json.seekComparisons`. Die Eier-Nahsicht verwendet Zoom 6 über den vorhandenen Kamerabefehl.
Der Aufnahme-Tab hält Vites Hot-Reload-Verbindung an, damit parallele Dateiedits keinen
laufenden Bogen neu laden. Ein neuer Runner-Aufruf lädt den aktuellen Code.

### Kraken-Ausstieg und Landkampf (R7)

`effect: 'ashore' | 'land-move' | 'land-claw'` verwendet die Hostwerte aus `krakenBoss.json`.
`effectTime` ist die exakte Zeit in Sekunden; `playback: 'play'` spielt ab der gewählten Zeit.
`krakenReview.landTimeline` zeigt Pose, Asset, Clipframe, Ausstiegsanker und eingefrorene Angriffslane.
Der Ausstieg verwendet dieselbe Distanzkurve wie der Host und wechselt erst bei `gripAt` zum Landasset.
Die Landbewegung läuft bis zum Stillstand; der Klauenangriff zeigt Windup, Ausfall, Impact und Erholung.

```js
await devScenario.run({action:'krakenReview', run:'kraken-v10', asset:'abyssal-kraken', size:320,
  land:{run:'kraken-v10', asset:'abyssal-kraken-land', size:360}, effect:'ashore', effectTime:0});
await devScenario.run({action:'krakenReview', effect:'land-claw', effectTime:0.53});
await devScenario.run({action:'krakenReview', effect:'land-move', effectTime:0, playback:'play'});
```

```powershell
node scripts/visual/kraken-review.mjs --run=kraken-v10 --r7=only
```

Mit `--r7=ashore` werden nur die beiden Ausstiegsbögen mit denselben neun Zeitpunkten aufgenommen.

Neun Zeitpunkte je Effekt und Kamerasicht landen unter
`build/kraken-review/<timestamp>/r7-<effect>-<overview|effect>.png`.
`report.json` enthält Zeitanker, Kameraversatz, Fehler und Rückwärts-Seek-Vergleiche.
Die Aufnahme verwendet vorhandene Atlanten; sie baut oder verändert keine Assets.

### Kraken-Effekte (R3)

`effect: 'ink' | 'erupt' | 'slam' | 'none'` wählt den Prototyp. `effectTime` ist die absolute
Zeit in Sekunden; für ein exaktes 60-Hz-Bild `frame / 60` übergeben. `playback:'manual'`
(Standard) hält diese Zeit, `playback:'play'` führt sie mit Szenariozeit × `speed` fort.
Ein explizites `effectTime` pausiert die Effektzeit, ein Effektwechsel setzt sie auf null.
`camera:'effect'` fokussiert die Aktion, `overview` zeigt alle bis zu drei Uferbahnen.
`clip` und `tentacleClip` bleiben frei wählbar. Die Effektzeit sampelt die gewählte Pose;
`erupt` sampelt bei vollständigem Export `rise → hover → slam → retract` ohne Schleife.
`ink-spit:charge/spit` und `slam:impact` (ersatzweise `strike`) aus `export.json` haben Vorrang
vor Ersatzzeiten. Der Status `krakenReview.effects` nennt Markerquellen, Mundpunkt und fehlende Assets.
Der scharf begrenzte Tintensektor beginnt bei Clipzeit 0 und füllt sich bis `spit`.
Die Tinte löst sich über Noise-Schwellen auf; Wasser hält eingerollte Schlieren länger.
Diese Fixture erzeugt keine Treffer und keinen Schaden.

Alle folgenden Gruppen sind partielle Parameterobjekte, z. B. `ink:{hold:1.15}`:

| Gruppe | Parameter | Standard | Wirkung |
| --- | --- | --- | --- |
| `ink` | `range`, `halfAngle` | 240 px, 30° | Reichweite und halbe Sektoröffnung |
| `ink` | `mouthOffset` | 74 px | Abstand vom Körperanker; ein exportierter `mouth`-Socket hat Vorrang |
| `ink` | `charge`, `spit` | 0.45, 0.6 s | Ersatzzeiten ab Clipbeginn |
| `ink` | `travel`, `hold`, `dissolve` | 0.22, 1, 0.65 s | Ausstoß, Halten, Auflösen nach `spit` |
| `ink` | `opacity`, `waterSpread` | 0.98, 1.18 | Deckkraft; zusätzliche Breite über der tatsächlichen Wassermaske |
| `ink` | `coreColor`, `edgeColor` | `0x120a1c`, `0x3a2252` | Indigokern und schwacher violetter Rand |
| `ink` | `cloudWarp`, `sheen` | 1.3, 0.14 | Domain-Warp der Wolken; Glanz entlang der Wasserschlieren |
| `erupt` | `radius`, `lifetime` | 66 px, 1.25 s | Ausbruchgröße und Lebensdauer je Platschen |
| `erupt` | `rise`, `retract` | 0.15, 2.5 s | Ausbruchzeit und Ersatzzeit fürs Einziehen; vollständige Clipfolge bestimmt `retract` |
| `erupt` | `retractScale` | 0.55 | Kleineres Platschen beim Einziehen |
| `erupt` | `count`, `spacing` | 3, 128 px | Gleichzeitige, am Wassermodell verankerte Bahnen; maximal 3 |
| `erupt` | `bulgeDuration`, `sprayCount`, `spraySpeed`, `foamOpacity` | 0.15 s, 72, 150 px/s, 0.75 | Vorwölbung, maximal 96 ballistische Tropfen, Spraytempo und Schaumdeckkraft |
| `slam` | `whipDelay`, `curveBend`, `contactWidth` | 0.18 s, 12 px, 42 px | Basis-Spitze-Verzögerung, S-Kurve und Abdruckbreite innerhalb der unveränderten Lane |
| `slam` | `impact` | 0.6 s | Ersatzzeit für Aufschlagmarker |
| `slam` | `dustLifetime`, `decalLifetime` | 0.85, 2 s | Staub-/Brockenwolke und Bodenabdruck |
| `slam` | `shakeScale` | 0.45 | Anteil des vorhandenen `impactLight`-Kamerapresets; 0 schaltet es aus |
| Gemeinsam | `direction`, `telegraphLength`, `telegraphWidth` | 90°, 320, 112 px | Blickrichtung bzw. Aufschlagbahn |

```js
await devScenario.run({action:'krakenReview', run:'kraken-v10', asset:'abyssal-kraken', size:320,
  effect:'ink', clip:'ink-spit', effectTime:0.75, direction:90, camera:'effect'});
await devScenario.run({action:'krakenReview', effect:'erupt', effectTime:0.35});
await devScenario.run({action:'krakenReview', effect:'slam', tentacleClip:'slam', effectTime:0.68});
await devScenario.run({action:'krakenReview', effectTime:0, playback:'play'});
```

Der Runner bevorzugt v10. Fehlt der Tentakelexport, lädt er die statische v9-Impact-Referenz
`tentacle:{run:'kraken-v9-tent-a',asset:'abyssal-kraken-tentacle',size:366,previewFrame:44}`
mit `tentaclePivot:[0.5,0.948]`. Die Referenz nutzt Clipzeiten/Marker aus `preview.json`,
zeigt nur das Kontaktbild beim Slam und ersetzt keine Rise-/Retract-Animation.
`previewFrame` lädt ausschließlich vorhandene Bilder; Produktionsdaten werden nicht geändert.

`idle` bleibt ein expliziter Platzhalter für ältere Runs ohne `ink-spit`. Beim neuen Export
`run:'kraken-v10', clip:'ink-spit'` setzen und die verfügbaren Tentakelquellen angeben.
Ohne Tentakelquelle bleiben Ausbruch und Aufschlag sichtbar, die Tentakel-Silhouette fehlt.
`node scripts/visual/kraken-review.mjs --effects=only` erstellt je Effekt 10–11 feste Zeitpunkte
in Übersicht und Nahsicht unter `build/kraken-review/<timestamp>/effect-<name>-<camera>.png`.
`--effects=all` ergänzt die bisherigen Assetbögen. Der Runner prüft eingefrorene Bilder und
Rückwärtssprünge auf Pixelgleichheit; der JSON-Bericht hält Optionen und Markerquellen fest.

Farbe und Elevation werden über denselben Clip-Frame-Namen aufgelöst, auch auf verschiedenen
Atlas-Seiten. Phaser erhält Trim/Pivot, der Shader die ungetrimmte Elevation-Größe und den
aktuellen Frame. Beim Sheet-Fallback kommen Elevationsbilder aus `elevation/frames-<size>/`.
Die Maske sampelt `WaterSurfaceModel` aus dem tatsächlichen World-Layout mit World-Offset,
Skalierung, Drehung und Pivot; auf der trockenen Seite ist sie null. Look-Werte stammen
unverändert aus `SUBMERSION_DEFAULTS`. Status meldet fehlende Elevation ausdrücklich.
Fixture-Teardown entfernt Sprites/Filter, Maskentexturen, Atlas-Seiten und Loader-Hooks.

Aufnahmen gegen den laufenden Server (HTTP 200 auf Port 8090):

```sh
npm run dev:browser
node scripts/visual/kraken-review.mjs --run=kraken-v9 --frames=6
node scripts/visual/kraken-review.mjs --run=pipeline-v8-smoke-2 --frames=6
node scripts/visual/kraken-review.mjs --run=kraken-v7 --frames=3
```

Ohne `--run` wird der erste vorhandene Körperexport aus v10, v9, Rauchtest, v7 gewählt.
Vorhandene Teile werden anhand ihrer exportierten Zielgröße zugeladen. Fehlende Teile und
Elevation stehen in `report.json.unavailable`; Legacy-Aufnahmen belegen keinen Untertaucheffekt.
`--origin`, `--asset`, `--size`, `--options=<JSON>` und `CHROME_PATH` bleiben verfügbar.

Ausgabe: `build/kraken-review/<timestamp>/`, Clipbögen (einschließlich Intro, falls vorhanden),
Wasserstände 0/.38/.8, Telegraphen, Tentakel/Eier und eine schrittweise Tentakelsequenz.
Pausierte Aufnahmen werden auf Pixelgleichheit geprüft. `lighting-game.png`,
`lighting-source.png` und `report.json.lighting` vergleichen dieselben deckenden Innenpixel
bei unverändertem Weltlicht und ausgeschaltetem Untertauchfilter: sRGB-Luma sowie lineare
Rec.709-Luminanz. Das ist ein Bildvergleich der gesamten Weltkomposition, keine isolierte
Messung eines einzelnen Lichtpasses. Der Dev-Server bleibt laufen.

### Allgemeine Steuerung

Power-Ups gezielt auf einer freien Zelle erzeugen: `devScenario.run({action:'spawnPowerUp', id:'HEALTH_PACK', gridX:24, gridY:24})`.
Erlaubt sind `HEALTH_PACK`, `ARMOR`, `RAGE`, `ADRENALINE`, `DOUBLE_DAMAGE`, `NUKE`, `HOLY_HAND_GRENADE`, `BFG`.
Ohne Koordinaten gilt das aktuelle Ziel; die Aktion nutzt den normalen Host-Pickup-Pfad und wird nicht im Rezept gespeichert.
Bei Pause bleibt der Symbolpuls stehen; Einzelschritte setzen ihn fort. UI-Komposite bleiben statisch.

1. Map, Klasse, Seed und Waffen wählen. Alle für die Klasse erlaubten Freischaltungen stehen bereit.
2. Werkzeuge ergänzen, Upgrade-Stufen setzen und bei Bedarf Items erzeugen. Voraussetzungen werden ergänzt;
   ungültige Stufen, Klassenkombinationen, Slots und Itemwerte werden abgelehnt.
3. **Szenario starten / neu aufbauen** betätigen. Der normale World-/Activity-/Ready-Ablauf wird durchlaufen.
4. Ein Ziel in Grid-Koordinaten einstellen. Eine Zelle hat 32 Pixel; `(0,0)` ist die erste Zellenmitte relativ
   zum World-Offset. **Freie Zelle suchen** zeigt die nächstgelegene freie Zelle, **Zum Ziel teleportieren** versetzt den Spieler.
5. Gegner oder Bauwerke platzieren. Bauwerke müssen ausgerüstet sein und verwenden echte Bauflächen-,
   Reichweiten-, Cooldown- und Kapazitätsregeln. Gegner können an ihrer Position gehalten werden; ihre KI und Angriffe bleiben aktiv.
6. Bewegung wird als Richtung plus Dauer ausgelöst. **weapon1/2 halten** erzeugt gehaltenen Diagnose-Input
   zusammen mit normalen Waffenaktionen. **Alle Aktionen stoppen** gibt Waffen, Bewegung, Utility-Aufladung und Ultimate frei.
7. Pause, 1/10 Frames, Zeitlupe, Tagesminute und Kamera-Zoom dienen der Sichtprüfung.
   **PNG aufnehmen** zeigt einen scrollbar dargestellten Screenshot in der tatsächlichen Canvas-Auflösung.
   **PNG im Workspace speichern** legt ihn unter `build/dev-scenarios/` ab und zeigt den absoluten Dateipfad an.
   So hängt die Übergabe an KI-Werkzeuge nicht von Browser-Downloads ab.

Das Utility-Kommando verwendet das **erste Utility im Werkzeug-Loadout** und lädt aufladbare Utilities voll auf.
Für ein anderes Utility die Werkzeugreihenfolge im JSON ändern und neu starten. Ultimate hat getrennte
Drücken-/Loslassen-Kommandos; beim Drücken wird Rage aufgefüllt. **Eingraben**/**Auftauchen** senden dieselbe
Host-Anfrage wie die Grabtaste; Adrenalin- und Austrittsregeln gelten unverändert.
Adrenalin und HP können pro Simulationsframe aufgefüllt werden. HP-Auffüllen verhindert keinen tödlichen Einzeltreffer.

## Wiederholbare Aufbauten

Der URL-Hash enthält ein versioniertes JSON-Rezept. Start, Teleport, Gegner- und Bauaktionen sowie laufende
Ressourcen-/Tageszeitänderungen aktualisieren den Link. Nach Reload wird das Rezept automatisch gestartet.
Auch ein Wechsel **nur des URL-Hashes** baut das neue Rezept automatisch auf. Ungültige Rezepte zeigen
einen Fehler und ersetzen den laufenden Aufbau nicht. Ein Neustart gibt laufende Eingaben frei.
Gespeicherte Bauwerke entstehen vor den konfigurierten Gegnern; für den Bau wird kurz eine gültige Position
in Reichweite verwendet und danach die Beobachterposition wiederhergestellt.

Das Rezept ist **kein Savegame oder Frame-Replay**: verbleibende HP, aktuelle Projektile, abgebaute Felsen,
abgelaufene Missionszeit, laufende Eingaben und Kamerazustand werden nicht rekonstruiert.
Seed und Inhalt stabilisieren den Weltaufbau; Worker, Browser-Timer und nicht gesäte Zufallsquellen bleiben asynchron.
Pause stoppt die Phaser-Schleife und die ganzzahlige Gameplay-Uhr im isolierten Tab. Eine PNG-Aufnahme bei Pause
führt genau einen weiteren Simulationsframe aus. Sehr kurze Effekte lassen sich über Schritte oder Zeitlupe erfassen.

JSON lässt sich im Panel bearbeiten, validieren und exportieren. Items enthalten die echten vollständigen
Itemdaten einschließlich Affix-IDs und Werten; der Katalog-Export liefert die aktuellen Definitionen.
Der Bericht enthält angeforderte Konfiguration, tatsächlich übernommenes Loadout, World-Seed/Fingerprint,
Ladezustand, Spieler-/Gegnerpositionen, Effekt- und Konstruktionszustand sowie die letzte Aktionsantwort.
`ready: true` bestätigt den abgeschlossenen Aufbau einschließlich geprüfter Startposition nach dem Host-Frame.
`initialPosition` enthält angeforderte und tatsächlich angewendete Koordinaten. Ein späterer Tod verwendet
weiterhin den normalen Respawn der Map; der Bericht zeigt die jeweils aktuelle Spielerposition separat.
Teleportieren beendet eine laufende Bewegung, erhält aber gehaltene Waffen, Utility-Aufladungen und Ultimate.

`freezeMission: true` (Standard) hält Missionsfortschritt, Ziele, Missionsuhr, Missionsabschluss und den
Verbrauch vorhandener Respawns an. Kampf, Gegnerfähigkeiten, Effekte und echte Tod-/Respawn-Abläufe laufen weiter.
Beim Fortsetzen wird die pausierte Zeit nicht nachgeholt; ein bereits aufgebrauchtes Budget wird nicht erneuert.
`suppressWaves` bleibt die getrennte Analysis-Policy für authored Encounter. Für normale Missionsabläufe
**beide** Schalter ausschalten. `hideTutorial: true` (Standard) blendet Tutorialtext und Steuerungshilfe
auch in PNGs aus; mit `false` sind sie wieder sichtbar. Alte Rezepte erhalten diese neuen Standardwerte.
Bei globaler Pause werden Live-Optionen mit dem nächsten Schritt oder der nächsten Aufnahme angewendet.

Fixierte Gegner melden `pinned: true`, `pinnedPosition`, `moving: false` und Geschwindigkeit null.
Ihre KI-Absicht bleibt unter `desiredMovement` erhalten. Bei freien Gegnern sind `moving`/`vx`/`vy`
weiterhin gewünschte Bewegung, keine gemessene Verschiebung.

## Browser-Agenten

Im isolierten Dev-Einstieg steht nach dem Scene-Start `window.devScenario` zur Verfügung. Die API
funktioniert auch bei eingeklapptem Panel. Der Knopf **Panel einklappen** verkleinert die gesamte Fläche.

```js
const dev = window.devScenario;
await dev.whenReady(); // { ok, status }; maximal 180 s, mit optionalem timeoutMs
dev.run({ action: 'target', gridX: 18, gridY: 23 });
dev.run({ action: 'holdWeapon', slot: 'weapon2' });
dev.run({ action: 'teleport', gridX: 14, gridY: 23 }); // Waffe bleibt gehalten
dev.run({ action: 'options', values: { freezeMission: true, hideTutorial: true } });
dev.run({ action: 'camera', zoom: 2, focusTarget: false });
dev.run({ action: 'panel', collapsed: true });
const shot = await dev.capture(); // { ok: true, path: 'C:\\…\\build\\dev-scenarios\\….png', url, status }
const report = dev.status(); // eigenständiger Snapshot, kein veränderlicher Runtime-Verweis
dev.run({ action: 'stop' });
```

`run` liefert synchron `{ok, status}` oder `{ok:false, error, status}`. `capture` liefert dasselbe
asynchron, bei Erfolg zusätzlich den absoluten PNG-Pfad und die URL. Eine zweite gleichzeitige Aufnahme
wird abgelehnt. `whenReady()` wartet auf den aktuellen Aufbau; ein Szenario-Wechsel bricht eine laufende
Aufnahme ab. Nach Scene-Teardown wird die globale API entfernt und wartende Aufrufe werden beendet.

| Aktion | Zusätzliche Felder |
|---|---|
| `start` | `scenario`: vollständiges oder um Standardwerte ergänzbares Rezept |
| `status`, `findFree`, `stop`, `utility`, `clearEnemies`, `pause`, `resume` | keine |
| `target`, `teleport` | `gridX`, `gridY`; Teleport ohne Koordinaten verwendet das Ziel |
| `move` | `dx`, `dy` (−1…1), `durationMs` (0…10000) |
| `holdWeapon`, `fire` | `slot`: `weapon1` oder `weapon2` |
| `ultimate` | `phase`: `press` (Standard) oder `release` |
| `burrow` | `phase`: `enter` (Eingraben) oder `exit` (Auftauchen); gleiche Host-Anfrage wie die Grabtaste |
| `spawn` | `kind`, optional `pinned`, `hp`, `gridX`, `gridY`; ohne Position am Ziel |
| `build` | `id`, optional `gridX`, `gridY`; ohne Position am Ziel |
| `step` | optional `frames` (1…600, ganzzahlig) |
| `settle` | optional `frames` (1…600): ausstehende Render-/Worker-Arbeit mit Delta null verarbeiten; erst nach Abschluss vorheriger Schritte aufrufen |
| `quality` | `level`: `high`, `medium` oder `low` |
| `speed` | `value` (0.1…2) |
| `camera` | optional `zoom` (0.25…8), `focusTarget` |
| `panel` | `collapsed`: Boolean |
| `options` | `values`: `timeOfDay`, `freezeMission`, `hideTutorial`, `suppressWaves`, `refillHp`, `refillAdrenaline`, `playerFreeForAll`, `hideAim` |
| `temporaryUtility` | `utility` (z. B. `NUKE`, `BFG`, `HOLY_HAND_GRENADE`), optional `chargeMs`; nutzt ein Pickup-Utility auf das Ziel |
| `train` | optional `invulnerable`; lässt auf Maps mit Zugstrecke sofort einen Zug einfahren |
| `trainShowcase` | Standard `park:'center'`: spawnt stehend mit Zugmitte in Gleismitte; Kamera umfasst Zugbounds und Effektraum (`zoom` ist Obergrenze). Optional `move:true` (60 Weltpx/s), `speedPxPerSec:0..600`, `follow` (true). `park:'entry'` erhaelt die normale Einfahrt. `whenReady()` wartet auf bestaetigten Start. `trainExplosion` sprengt den geparkten Zug sofort. `status().train`: `devPassState:'parked'`, `speed:0`, `visible`, `fullyVisible`, `cameraBounds` sowie Owner-/Startdiagnose. Wiederholte Aufrufe nutzen die Zugmap; Live-`options` erhalten den Zug. |
| `trainExplosion` | optional `whenVisible: true`: wartet auf Einfahrt, zoomt f?r den vollst?ndigen Zug samt Tr?mmerraum heraus und fixiert die Kamera auf der Hauptdetonation; ohne Option sofortige Z?ndung; `stop`/Szenariowechsel verwirft wartende Z?ndungen, `speed`/`step` gelten weiterhin |
| `bot` | `index`, optional `place` + `gridX`/`gridY`, `move` {`dx`, `dy`, `durationMs`}, `aim` {`gridX`, `gridY`} oder `null`, `fire` (`weapon1`/`weapon2`/`null`), `burrow` (`enter`/`exit`), `temporaryUtility` + `chargeMs` |

Browser-Werkzeuge, die keine schreibenden JavaScript-Aufrufe erlauben, können denselben JSON-Befehl
im Feld **API-Befehl JSON** ausführen. Das Ergebnis erscheint direkt im Bericht; es wird kein JavaScript evaluiert.

Alle Steuerelemente sind HTML mit Labels und stabilen `dev-*`-IDs. Ein Canvas-Klick, Cheat-Menü oder Zugriff
auf private Scene-Felder ist für den Aufbau nicht nötig. Bei fehlerhafter Klickskalierung des Browser-Panes
funktionieren fokussierte Buttons mit Enter und Checkboxen mit Leertaste. Selects unterstützen normale Auswahlaktionen.

### Bots, Freund-Feuer und Züge

Das Rezeptfeld `bots` (höchstens 11 Einträge `{ name, weapon1, weapon2, player }`) lässt vor dem Start skriptgesteuerte
Dachse über den normalen Raum-Handshake beitreten. Sie teilen Klasse, Upgrades und Items des Szenario-Spielers, bestätigen
Assets und World sofort und handeln ausschließlich über dieselben Host-Ports (Eingaben, Waffenaktionen, Graben, Utilities).
Bots bleiben für die Lebensdauer des Tabs im Raum; für eine andere Bot-Anzahl den Tab neu laden.
`refillHp` und `refillAdrenaline` gelten auch für Bots. `playerFreeForAll` lässt Spieler und Bots einander wie in der
freien Lobby-World treffen. Unterdrückte Encounter pausieren auch Map-Events; `train` fährt den authored Zug dann direkt.
Pickup-Utilities wie Atombombe, BFG oder Heilige Handgranate sind keine Werkzeuge; `temporaryUtility` vergibt sie über den
normalen temporären Utility-Besitzer. Aufladbare Utilities werden nach voller Ladung (oder `chargeMs`) ausgelöst.

Beispiel für einen vollständig über die Oberfläche geprüften Aufbau: Map `7`, Klasse `inspector_gadachs`,
Werkzeug `construction:flame_turret`, Spieler bei Grid `(98,26)`, Flammenturm bei `(102,25)`, fixierter
`zombie-badger` mit erhöhten HP bei `(106,25)`, Seed `12345`. Andere Maps/Klassen/Inhalte verwenden dieselben Kommandos.

## Produktionsdarstellung diagnostizieren

Figurenschatten vergleichen: `dev.run({action:'renderDebug',disable:['characterShadows']})`;
mit `disable:[]` wieder einschalten. Bei 08:00/12:00/17:00/00:00 drehen, laufen und stehen bleiben;
Waffenwechsel/Rueckstoss, Wolken, Wasserrand und Basen pruefen. High -> Low -> High und World-Wechsel
muessen die Schatten korrekt entfernen und wieder aufbauen. Die Nacht behaelt nur den Fusskontakt.

`dev.status().characterShadows` zeigt geladene Meshes, aktive Instanzen, Pose, Waffenproxy,
Sonnenvektor, Slot, Depth und Deckkraft am Koerperpivot. `costs` meldet CPU-Zeit des letzten Sync,
Geometrie-Draws, Dreiecke, Uploadbytes und Ziel-Speicher; `gpuMs:null` bedeutet nicht gemessen.
`instances[].coreDarkeningEstimate` schaetzt die Kernabdunklung bei Maskendeckung 1 ausserhalb
des Fusskontakts vor dem Camera-Grade (CPU-Wolkenwert, Empfaenger und Sprite-Alpha enthalten).
`dev.run({action:'renderDebug',disable:[],characterShadowSolid:true})` zeigt die echte Vereinigungsmaske
deckend magenta ohne Blur, weiterhin mit Empfaengerausschluss und regulaerer Depth.
`dev.run({action:'renderDebug',disable:[]})` stellt die weiche Schattenkomposition wieder her.

Mesh-Pruefszene (High/Medium; Low verwendet die Ellipse):

```js
dev.run({action:'start',scenario:{version:1,mapId:'1',seed:12345,classId:'inspector_gadachs',
  weapon1:'GLOCK',weapon2:'AWP',player:{gridX:20,gridY:24},timeOfDay:480}});
dev.run({action:'camera',zoom:3,focusTarget:false});
dev.run({action:'target',gridX:24,gridY:24}); // danach 20/20, 16/24, 20/28: rundum drehen
dev.run({action:'move',dx:1,dy:0,durationMs:1500});
dev.run({action:'fire',slot:'weapon1'});
dev.run({action:'fire',slot:'weapon2'}); // dargestellter Waffenwechsel samt Rueckstoss
dev.run({action:'options',values:{timeOfDay:720}}); // auch 480 / 1020 / 0
dev.status().characterShadows;
```

Fuer 12 Spieler vor dem Start elf `bots` im Rezept angeben (siehe Bots oben).
Masken ohne Doppelkanten bei freier Drehung, alle Laufphasen und Waffenwechsel pruefen;
Nacht nur Fusskontakt, Wasserrand schwaecher, keine Schatten auf Fels/Basen.
High/Medium/Low-Wechsel, World-Wechsel und WebGL-Kontext-Wiederherstellung separat pruefen.

Lokale Render-Ausgaben isolieren: `dev.run({action:'renderDebug',disable:['sunComposite','fogDisplay','lightmap','characterShadows']})`.
Die Liste ersetzt die bisherige Auswahl; zusätzlich sind `distortion`, `bloom`, `grade`, `vignette`, `focus`, `barrel` erlaubt.
`disable:[]` stellt alle Ausgaben wieder her; beim Szenariostart und Teardown wird ebenfalls zurückgesetzt.
Simulation, Nebeldichte, Wolkenfeld und Lichtquellen laufen bei ausgeblendeter Ausgabe unverändert weiter.
Felskanten isolieren: jeweils einzeln `disable:['rockSurface']`, `['rockGround']` oder `['rockFoliage']`
unter `renderDebug` verwenden. Das unterdrueckt den Mineral-Multiply-Pass, den Boden-Schattenpass
bzw. die Beleuchtung der Felsvegetation, ohne Worker-Daten oder Geometrie zu aendern.
Mit `disable:['fogDisplay']` den Nebel getrennt vergleichen; `disable:[]` setzt alles zurueck.

Mit `disable:['rockOverlays']` alle gebackenen Felsauflagen (Moos, Decals, Kolonien) ausblenden.
Im Unterschied dazu entfernt `rockFoliage` nur deren Beleuchtung. Vergleichsbilder mit
`dev.run({action:'pause'})` bei angehaltener Praesentationszeit aufnehmen, dann `disable:[]`.
Die GPU-Reparaturdiagnose enthaelt `channelErrors`: pro Kanal Maximum, Texelposition,
Soll-/Ist-Byte und `count` (Anzahl Abweichungen >1). Der Grenzwert bleibt unveraendert.

Optionales `composite`: `material` zeigt die RGB8-Faktortextur vor dem Modulate-Blend (neutral ≈ grau),
`neutral` zeichnet Faktor 1 mit weiterhin laufendem Material-Pass, `neutralInline` zeichnet Faktor 1 ohne diesen Pass.
`normal` ist der Standard. Diese drei Diagnoseansichten ändern absichtlich die Ausgabe, nicht das Tuning.
`dev.run({action:'renderDebug',disable:[],probe:true}).status.lastAction.material` liest einmalig das zuletzt gerenderte
Material-Target aus: `minRGB`/`maxRGB`, `zeroRGB`, `minAlpha`/`maxAlpha` (Bytes). VFX über dem Display-Quad
sind darin nicht enthalten. Der synchrone Readback ist nur für Diagnose, nicht für Performance-Messungen bestimmt.

Sporenturm-Repro über die normale Bau-/Zielvalidierung (danach `await dev.whenReady()`, `camera` mit Zoom 1.4):
`dev.run({action:'start',scenario:{version:1,classId:'inspector_gadachs',mapId:'7',seed:12345,timeOfDay:720,tools:[{kind:'construction',id:'spore_turret'}],player:{gridX:98,gridY:26},constructions:[{id:'spore_turret',gridX:102,gridY:25}],enemies:[{kind:'zombie-badger',gridX:106,gridY:25,pinned:true,hp:10000000}]}})`.
Der Turm steht vier Zellen vom bewegungsfixierten Ziel entfernt; der Nahkämpfer erreicht ihn dort nicht.
`SPORE_TURRET` ist die interne Utility-ID; das Szenario-Werkzeug verwendet die kanonische Construction-ID.
Einzelspawn: `dev.run({action:'spawn',kind:'zombie-badger',gridX:106,gridY:25,pinned:true,hp:10000000})`.


### Ladezeit statt Framezeit messen

In Dev und im Produktionsbuild ist `window.__FD_BOOT__.timeline()` auch w?hrend des Ladens abrufbar.
Der JSON-Bericht h?lt die letzten zw?lf Boot-, World-, Deferred- und Szenario-L?ufe fest.
`topSections` trennt CPU-/Treiber-Aufrufe, Worker-Rechenzeit und verstrichene Wartezeit.
Diese teilweise parallelen oder verschachtelten Zeiten nicht addieren. `barriers` und
`criticalPath` zeigen beobachtete Ready-?berg?nge und noch offene Bedingungen, keinen
kausal rekonstruierten CPU/GPU-Abh?ngigkeitsgraphen. Boot-Reveal und replizierte World-Readiness
bleiben getrennt: Nur letztere wartet auf den Terrain-Farbsnapshot. Der Szenario-Status f?hrt
unter `loading.loadTimelineId` die zugeh?rige World-Kennung.

Dev: `npm run dev:browser`, dann `http://127.0.0.1:8090/dev-scenario.html` f?r Szenarien oder
`http://127.0.0.1:8090/` f?r den normalen Start. Einen vorhandenen Server weiterverwenden.
Produktion: `npm run build`, danach
`npm run preview -- --host 127.0.0.1 --port 8091 --strictPort` und `http://127.0.0.1:8091/` ?ffnen.
Der Produktionsbuild enth?lt den Timeline-Abruf, nicht den Dev-Szenario-Einstieg. Dieselbe Map dort
?ber den normalen Host-/Lobby-Ablauf w?hlen; World- und Boot-Lauf getrennt vom Szenario-Gesamtwert vergleichen.

```js
// W?hrend eines Stillstands und erneut nach Ready; copy() ist eine DevTools-Hilfe.
copy(JSON.stringify(window.__FD_BOOT__.timeline(), null, 2));
```

`resources` gruppiert Resource Timing nach Assetverzeichnis sowie Modulen und nennt die gr??ten
Dateien. Global umfasst es auch Requests vor Phaser-preload; je Lauf nur darin gestartete Requests.
`transferBytes` enth?lt HTTP-Overhead, `encodedBytes` den komprimierten Body.
`decodedBytes` bezeichnet HTTP-Dekompression, nicht Bild-RGBA. Null Transfer kann Cache oder
fehlende Timing-Freigabe bedeuten. Die HTML-Einstiege erweitern den Puffer vor den Modulen auf 10000; fr?here
?berl?ufe k?nnen nicht r?ckwirkend behoben werden. Vor Navigation exportieren.

Loader-Verarbeitung misst Downloadende bis Cache-Fertigstellung (Decode/Upload einschlie?lich
Scheduling), Woodland zus?tzlich synchrone Upload-/Coverage-Arbeit. Worker-Start umfasst
Moduldownload, Auswertung, Initialisierung und Message-Delivery; Worker-Initialisierung und
Rechenzeit werden separat gemeldet. Der Restwert `module-startup-and-delivery` ist keine reine
Downloadzeit. Worker-Unterimports liegen nicht im Resource-Timing-Puffer des Hauptfensters.
CPU-Submit ist keine GPU-Ausf?hrungszeit; asynchrones Shader-Linking erscheint in der Warmup-Barriere.
Die Formation-Queue ist keine zus?tzliche Ready-Bedingung; ihr vorhandener Diagnosez?hler bleibt
f?r nach Ready weiterlaufende Jobs ma?geblich.

Je Rechner/Qualit?t/Viewport/Seed mindestens f?nf Vordergrundl?ufe: kalter HTTP-Cache, warmer Cache,
World-Wechsel im selben Tab; Maps 1/7/15 und Lobby. Cachezustand, Build, Map, Qualit?t und
Tab-Sichtbarkeit zum Bericht notieren. Keine Overrides oder Frame-Messung gleichzeitig starten.

### Framezeit und Darstellung

Der Panel-Bereich **Sonnenwald: Diagnose und Messung** bietet Uhrzeit-Kurzbefehle, **Kamera: nächster Baum**,
Formationsstatus und Messungen im Stand, bei Felszerstörung oder während einer Kamerafahrt.
Die Tagesminute lässt sich unter Simulation setzen; Pause und Einzelschritte halten auch die Präsentationszeit an.
Die Grafikqualität (`high`, `medium`, `low`) wird in den regulären Spieloptionen gewählt, nicht über die Szenario-API.

```js
const dev = window.devScenario;
dev.run({ action: 'options', values: { timeOfDay: 720 } });
dev.run({ action: 'sunTuning', values: { cloudWarp: .65, cloudSoftness: .25 } });
dev.run({ action: 'sunTuning', reset: true });
dev.run({ action: 'measureWorldLighting', mode: 'stationary' });
// Several rocks through the same authoritative damage path (isolated dev host).
// Set the target inside a formation; grid multiples of 16 exercise chunk borders.
dev.run({ action: 'target', gridX: 16, gridY: 16 });
dev.run({ action: 'measureWorldLighting', mode: 'explosion', radius: 2.5 });
// Nach Abschluss: Messung mit Qualitätsstufe und tatsächlichen Rendergrößen.
const measurement = dev.status().worldLightingMeasurement;
```

Messmodi: `stationary`, `destruction` (Fels nahe dem eingestellten Ziel), `explosion` (mehrere Felsen), `walk` und `traverse` (Kamerafahrt).
Eine Messung setzt Pause fort; Änderungen an Uhrzeit, Tuning, Zoom oder Qualitätsstufe brechen sie ab.
Das Ergebnis enthält Frameintervalle, Draws, Upload-/Ressourcendaten, `graphicsQuality` und `sunRendering`.
Frameintervalle enthalten Browser-Scheduling und sind keine GPU-Zeiten.
`rockPresentationFrameCpuMs` und `rawRockPresentationFrameCpuMs` messen die CPU-Arbeit des
`RockVisualSystem.flush` je aufgezeichnetem Frame (Renderer-Updates und Formation-Uploads).
Andere Chunk-Bakes und GPU-Ausfuehrung sind darin nicht enthalten; dafuer die Frameintervalle mitpruefen.
`formation.lastRepairPublishMs`, `maxRepairPublishMs`, `repairWorkerMs` und `repairLatencyMs`
trennen Veroeffentlichung, Worker-Arbeit und Wartezeit der Geometrie-Reparatur.
`rockRepair` meldet den Reparaturpfad (`gpu` oder `worker`), `latencyFrames` und
CPU-/GPU-Kosten. Bei `gpu` muss `latencyFrames` null Frames betragen; die GPU-Daten
werden vor dem Welt-Draw veroeffentlicht. `gpu.validated` und `maxChannelError`
stammen aus einem echten Readback-Vergleich beim Erstaufbau (maximal ein Byte
Abweichung zur Worker-Referenz durch Float32-Rundung). Bei fehlender Float-FBO-
Unterstuetzung oder fehlgeschlagener Paritaet bleibt der Worker-Pfad aktiv;
`gpu.reason` nennt den Grund. Dieser Fallback erfuellt nicht die Same-Frame-Abnahme.
`gpu.gpuMs` ist eine asynchron abgefragte GPU-Zeit; `null` bedeutet nicht messbar,
nicht null Millisekunden. `gpu.lastCpuMs` misst Submission, nicht GPU-Ausfuehrung.

`sunTuning` ist ein lokaler Override; gültige Schlüssel und Grenzen stehen in
[`src/config/sunlight.ts`](../src/config/sunlight.ts). Reset oder ein neuer World-Aufbau beendet die Overrides.
Das Wolkenfeld bleibt in Weltkoordinaten verankert. `cloudCover` und `cloudDensity` steuern
Bedeckung und Kontrast, `cloudScale` die Größe, `cloudWarp` die Form und `cloudSoftness` die weichen Ränder.
`shade`, `daylight` und `sun` steuern getrennt k�hlen Wolkenschatten, neutrales Tageslicht und warme Licht�ffnungen.
`fogShade` und `fogSun` f�rben nur die Nebelradiance; Dichte und Fl�chenbudget �ndern sich dadurch nicht.
`cloudSpotAmount` (Standard `.28`, aus: `0`) und `cloudSpotScale` (Standard `130` Weltpx, Bereich `80�300`) steuern die kleineren Licht�ffnungen.
`cloudSpeed`, `cloudEvolution` und `cloudGust` steuern Drift und Formwandel über die pausierbare Präsentationszeit.
Die Felddiagnose meldet Breite, Höhe, RGBA-Bytes und Weltpixel je Texel; die Auflösung folgt der Grafikqualität.
Rezepte mit entfernten Lichtvergleichsfeldern oder Strahlen-/Bandparametern werden mit Hinweis abgelehnt.

## Grenzen

- Die Oberfläche konfiguriert Coop-Defense-Aktivitäten. Multiplayer-/Client-Replikation braucht separate Prüfungen.
- Unterdrückte Encounter verwenden die vorhandene Analysis-Policy, die auch automatische Missionsereignisse beeinflusst.
  Für normale Missionsabläufe die Option ausschalten. Sie garantiert kein selektives Ausschalten einzelner Spawnquellen.
- Der normale Loader und die echten Renderer bleiben aktiv. Der Modus beseitigt Broker-Wartezeit und manuelle Vorbereitung;
  er stellt keine vollständige Optimierung des initialen Asset-/Modul-Ladens und kein Shader-Hot-Swapping dar.
- Einzelne Spezialaktionen, etwa ein direkter Tesla-Nova-Trigger ohne vorherige Ladung, sind keine separaten Effekt-Fixtures.
  Sie werden durch Ausrüstung, Upgrades und echte Kampfaktionen erzeugt.

Browserprüfung bleibt gemäß `AGENTS.md` opt-in. Diese Seite erteilt keine pauschale Erlaubnis für Browserstarts in anderen Aufgaben.

Zug-Abnahme train8: `dev.run({action:"trainShowcase",park:"center",focus:"center",zoom:2.2}); await dev.whenReady();` dann `dev.run({action:"trainExplosion"});` (Zug sofort weg, Splitterzerfall vor der Landung; Rauch/Glut ca. 15 s, kein liegendes Wrack).
Fahrt: `dev.run({action:"trainShowcase",focus:"center",zoom:2.2,move:true,speedPxPerSec:120});` – Nacht über `options.values.timeOfDay:0`, Tag `720`; Warmlicht benötigt den TrainVfxPorts-Lichtanschluss der World-Komposition.

## Kraken-Mission (AP2b / Live-Prüfung)

### Reproduzierbarer Performance-Parcours

Bei bereits laufendem Dev-Server auf `http://127.0.0.1:8090/`:

```powershell
npm run perf:kraken -- --output=build/kraken-perf/current
# Wiederholungen oder einzelne Qualitätsstufen:
npm run perf:kraken -- --qualities=high,medium,low --runs=3 --output=build/kraken-perf/repeated
# Vergleich mit einem gespeicherten Lauf (inklusive Inhalts-/Workload-Prüfung):
npm run perf:kraken -- --compare=build/kraken-perf/current/report.json --output=build/kraken-perf/next
# Separater Diagnoselauf: CPU-Profil, gesampelte Allokationen, GC-Trace
npm run perf:kraken -- --qualities=high --profile=true --output=build/kraken-perf/profile
# Zusätzlicher Kaltstartlauf einschließlich Boot-/Lade-Statusabfragen:
npm run perf:kraken -- --qualities=high --cold=true --output=build/kraken-perf/cold
# Kontrollmessung auf regulärer Map 1, gleicher Recorder und gleiche Auflösung:
npm run perf:kraken -- --scenario=regular --qualities=high --output=build/kraken-perf/regular
# Eingefrorene High-Vergleichsbilder: gemeinsame gegen private Shaderprogramme:
npm run perf:kraken -- --qualities=high --rendererParity=true --output=build/kraken-perf/program-parity
```

Der Runner verwendet das vorhandene Playwright-Core/Chrome, den Dev-Host, feste
60-Hz-Simulationsschritte, Seed 12345 und die echten `krakenAct`-Aktionen. Er startet
keinen Server und beendet keinen vorhandenen Browser. Jeder Lauf erhält einen
eigenen Browserprozess, 1920×1080 und DPR 1. `CHROME_PATH` überschreibt den lokalen
Chrome-Pfad. Alle Optionen verwenden `--name=wert`.

Die nur im Dev-Controller registrierte Karte `kraken-performance` übernimmt die
authored Geometrie und sämtliche Begleitwellen aus Map 20. Sie überspringt die
Boss-Freigabe durch die Eröffnungswelle und ersetzt die zu verteidigende Basis durch
den vorhandenen unbewaffneten Diagnose-Außenposten. Der Beobachter erhält laufend
HP zurück. Das ist eine Lastmessung, kein Balance- oder Kampagnen-Abnahmetest.
Der Einmal-Seed für den Diagnoseboss ist unabhängig von Ladezeit und World-Revision;
er ist nur vor dem Start und nur im isolierten Dev-Host erlaubt.

Der Ablauf enthält Intro, Wasserphase, Tinte, vollständige Stachelsalve, Eierflug
und Schlüpfen, Tauchgang mit mehreren Tentakeln, Begleitwellen, Landgang,
Klauen-Ausfall, Land-Salve, Schleimspur und Tod durch normalen Waffenschaden.
Angriffsanfragen warten auf einen frischen Wasserzyklus, statt den regulären
Tauch-Timer zu verändern. Ab der Landphase folgt die Kamera dem Beobachter.

`report.json`, `report.md` und Frame-Rohdaten je Phase enthalten Mittelwert, p95,
p99, Maxima und Hitches >33 ms, CPU-Callbackzeit, asynchrone GPU-Zeitmessungen,
Draw Calls, Programmwechsel, Compile-/Link-Aufrufe, Kraken-Residenz einschließlich
Renderzielen sowie Heap-Zuwächse/-Rückgänge. `glStatus` zählt und misst synchrone
Framebuffer-/Programmstatusabfragen und Framebuffer-Erzeugungen. `shaderPrograms`
nennt neu angelegte Phaser-Programmschlüssel. `cold.first` hält pro Effekt den ersten
beobachteten Auftritt samt den nächsten bis zu 30 Frames fest; `cold.worst` enthält
die fünf teuersten Frames jeder Phase, auch vor dem Host-Intro. `--cold=true` ergänzt
separat die GL-Aufrufe während Boot und Missionsladen. Ein frischer Browser leert
weder OS- noch Treiber-Shadercache. `--rendererParity=true` vergleicht an zehn
eingefrorenen Kampfzuständen private gegen geteilte Programme und prüft zusätzlich
die Stabilität einer unveränderten Kontrollaufnahme; dieser Lauf ist keine Zeitmessbasis.
Der Bildlauf erzwingt außerdem Renderziel-Resizes und vergleicht Phasers ursprünglichen
Framebuffer-Resize mit der Wiederverwendung, jeweils bei gleicher finaler Auflösung.
Die reguläre Kontrollmessung verwendet Map 1 ohne Wellen, mit kaltem Vorlauf und
1200 festen Schritten im eingeschwungenen Zustand.

Ab Messformat 5 wird die Qualitätsstufe über `dev-scenario.html?visual-test=1&quality=medium`
im privaten Einstellungsspeicher vor dem Spielimport gesetzt, damit die
Lade-Warmups bereits die richtige Stufe vorbereiten. Format 4 maß zusätzlich einen
Live-Qualitätswechsel nach Ready; direkte Regressionspaare daher neu aufnehmen.

Der GPU-Timer umfasst die Submissionen
des ganzen Callbacks einschließlich Lücken zwischen ihnen; er misst keine reine
GPU-Auslastung. Heap-Differenzen sind Näherungen, keine gemessenen GC-Pausen.
`--profile=true` liefert dafür gesonderte `.cpuprofile`, `.heapprofile` und
`.trace.json` sowie Main-Thread-GC-Pausen und hochgerechnete Allokationsmengen je Phase.
Das Heap-Sampling verwendet 32 KiB Abstand und behält auch bereits eingesammelte
Objekte in der Schätzung. Profilierte Zeiten nicht mit normalen Messläufen vermischen.

Die Phasenfenster enthalten ihre ausdrücklich skriptierten Wartezeiten und
Ausläufe. Die Rohdaten nennen zusätzlich echte Hostphase und Aktion. Pausen durch
Steuerbefehle und Screenshots zählen nicht zu den Frameintervallen; CPU-Zeiten
erfassen alle ausgeführten Spielschritte. Berichte führen Inhalts-Hashes und
Workload-Hashes, damit abweichende Kampagneninhalte oder Kampfverläufe beim
Vergleich erkennbar bleiben. Asynchrone Worker-/Asset-Fertigstellung und
Browser-Scheduling bleiben reale Messbedingungen.

Abdeckung, Browserfehler und Residenzbudgets werden geprüft; unvollständige Läufe
sind keine gültige Regressionsevidenz. High-Aufnahmen und Kontaktbogen landen im
Ausgabeverzeichnis. `--captures=false` deaktiviert sie. Die erweiterten
Dev-Befehle sind `krakenMission` mit `performance:true`, `measureKraken` mit
`phase:'name'` bzw. `stop:true`, und `devScenario.krakenPerformance()` für Rohdaten.

Für lokale A/B-Diagnosen kann `--modules=<Archiv>` explizit archivierte, vom selben
Vite-Server transformierte Module laden (`manifest.json`: geordnete Repositorypfade,
`0.js`, `1.js`, …). Nur aufgelistete Module werden ersetzt; der Archivpfad steht
im Bericht. Das ist kein portabler Produktionsbuild. `--parity=<Quellarchiv>` prüft
in einem separaten High-Lauf die frühere `KrakenSubmersion.update`-Methode gegen
die aktuelle an eingefrorenen Zuständen: Originalbilder, Differenzbilder und
Ergebnisse nach den vorhandenen Pixelgrenzen werden gespeichert. Das Quellarchiv
enthält den ursprünglichen Repositorypfad der Datei. Solche Bildprüfläufe sind
wegen zusätzlicher Render-Schritte von den Zeitvergleichen getrennt.

Im vorhandenen Dev-Szenario-Einstieg startet der folgende Befehl die echte Host-Coop-Mission
auf `kraken-abyss-lab`, inklusive Habitat, Boss-Intro, Tauchzyklus, Tentakeln und Brut:

```js
await devScenario.run({ action: 'krakenMission' });
await devScenario.whenReady();
// Neuester Entwurf je Rolle, sonst Produktion; kein Import nach public/.
await devScenario.run({ action: 'krakenMission', drafts: true });
// Quelle während des Kampfes wechseln oder manuell neu laden.
await devScenario.run({ action: 'krakenAssets', source: 'draft' });
await devScenario.run({ action: 'krakenReloadAssets' });
devScenario.status().krakenAssets; // Version, Ladezeit, Renderabschluss oder Ladefehler
await devScenario.run({ action: 'krakenAssets', source: 'production' });
// Form-Modus: vorher npm run assets:shape -- <asset> --export-draft.
// Kraken: dieselbe Entwurfsquelle, alle Clips zeigen die Ruhepose.
// Normale Gegner: statische Form am Zielpunkt, optional gridX/gridY.
await devScenario.run({ action: 'shapeSpawn', asset: 'rabid-badger' });
// Erneuter shapeSpawn-Aufruf lädt die neueste Form; clearEnemies räumt sie auf.
// Intro ueberspringen und aktuelle HP setzen; Max-HP bleiben erhalten (Phase 2 bei <= 50 %).
await devScenario.run({ action: 'krakenMission', skipIntro: true, hp: 4000 });
// HP im laufenden Kampf ändern, ohne Intro oder Welt neu zu starten.
await devScenario.run({ action: 'krakenHp', hp: 7680 });
// Figurenlicht/Schatten bei einer reproduzierbaren Sonne; reset hebt den Override auf.
await devScenario.run({ action: 'figureSun', azimuth: 135, elevation: 28 });
await devScenario.run({ action: 'figureSun', reset: true });
```

Der Einstieg aktiviert die vorbereiteten Boss-/Ei-Registry-Eintraege nur fuer diese Diagnose.
Die Kampagnenregistry bleibt unveraendert. Ausgewählte Körper-/Teilatlanten werden über die
Activity-Residency geladen; Materiallicht und Mesh-/Kontaktschatten sind aktiv. Ab der authored
HP-Schwelle werden Land-Restpose, Ausstieg, Idle und Bewegung vorgeladen. Weitere Landclips folgen
beim Ausstieg; mit der Greifpose werden die Wasserseiten freigegeben. Tatsächlich genutztes
Schwimmen bleibt während der Wasserphase resident. Ladefehler erscheinen im HUD-Meldungskanal.
`status().krakenResidency` enthält Hostphase/-anker, HP, Ladefehler und gemessene Phasen-Peaks
(Atlanten, Renderziele, GPU-Meshpuffer); der CPU-Meshcache wird separat ausgewiesen.
Das bisherige `krakenReview` bleibt bei eingefrorener Mission nutzbar.

Der bestehende Dev-Host ist eine isolierte `local-only`-Session; externe Client-Joins werden dort
nicht angeboten. Join/Resume und der Kraken-Slice werden durch die vorhandenen FakeNetwork-
Integrationstests geprueft. Ein interaktiver Mehrspieler-Abnahmelauf gehoert zu AP3.

Die vorhandene Playwright-Prüfung wird über `node scripts/visual/kraken-live.mjs --mode=live`
gestartet (`--elevation=45`, `--quality=medium|low` optional). `--mode=shadow --run=kraken-v12b`
misst gepaarte Aufnahmen mit/ohne Krakenschatten im Ring außerhalb der Körper-Silhouette.
Voraussetzung: ausdrücklich erlaubter Browserlauf, `npm run dev:browser` und HTTP 200 auf 8090.
Aufnahmen, Kontaktbögen und Zustandsprotokolle liegen unter `build/kraken-live/<timestamp>/`.

### Deterministische Hostaktionen und v13-Aufnahmen

`krakenAct` wählt genau die nächste passende Aktion im echten Kraken-Host. Der Befehl ist nur
in der isolierten Dev-Mission als Host verfügbar; Clients und externe Mitspieler sind ausgeschlossen.
Es werden nur Auswahl, Cooldown und Wartezeit vor einer Aktion überschrieben. Laufende Angriffe,
Ausrichtung, Reichweite, Stachel-Nachwachsen, Brutkapazität, Land-/Wassergrenzen und Exit-Reservierungen
bleiben wirksam. Es gibt keine Boss-Teleportation und keinen direkten Eingriff in Renderer oder Clips.

```js
await devScenario.run({ action: 'krakenMission', skipIntro: true });
await devScenario.whenReady();
await devScenario.run({ action: 'krakenTarget', gridX: 45, gridY: 40 });
// Nach einer Zielversetzung einen Hostframe für die normale Zielwahl ausführen.
await devScenario.run({ action: 'step', frames: 1 });
// Vor dem nächsten Befehl status().pendingSteps === 0 abwarten.
await devScenario.run({ action: 'krakenAct', act: 'spines' });
devScenario.status().krakenDevAction; // { act, status:'pending'|'started'|'failed', requestedAt, startedAt?, error? }
```

| `act` | Voraussetzung |
| --- | --- |
| `spines` | Aufgetaucht, Ziel außerhalb Tintenreichweite und innerhalb Stachelreichweite; wartet auf vollständiges Nachwachsen. |
| `ink` | Aufgetaucht oder an Land, Ziel in Mundreichweite oder durch den normalen Wasser-Anmarsch erreichbar. |
| `eggs` | Aufgetaucht oder an Land, gültiges Hostziel; normale Flug-/Landeflächen und Brutreservierungen. |
| `dive` | Aufgetaucht in Phase 1; schwimmt vor dem Abtauchen regulär in den Teichinnenraum. |
| `ashore` | Aufgetaucht und echte Phase-2-HP-Schwelle erreicht, z. B. vorher `krakenHp` mit `status().krakenResidency.maxHp / 2`. |
| `lunge` | Phase 2 an Land, Ziel in Klauenreichweite; normaler Sprung-Klauenpfad stoppt an Wasser, Hindernissen und Spielern. |

`krakenTarget` setzt den lokalen Spieler über dieselbe Freiflächenprüfung wie `teleport` (Rasterkoordinaten,
keine Bossposition). Bei ungültiger Ausgangslage antwortet `run` mit `ok:false` und Klartext.
Eine akzeptierte Aktion wartet bei Bedarf auf das Ende des laufenden Angriffs, Ausrichtung oder Nachwachsen.
Eine weitere Anfrage während `pending` wird abgelehnt. Änderungen der Lage oder fehlgeschlagene
Reservierungen werden als `failed` mit `error` gemeldet. `started` bestätigt den Aktionsbeginn, nicht
bereits einen Treffer. Neustart/Activity-Teardown verwirft die Anfrage.
`krakenDevGeometry` protokolliert Position, Winkel, trockenen Körperstand, den trockenen vollständigen
Ausfallpfad und die Lage im Teichinnenraum für die Regression; es vergibt keine Bewegungsfreigabe.

```powershell
npm run dev:browser
# HTTP 200 auf http://127.0.0.1:8090/ abwarten.
# Kurzer Infrastruktur-Rauchtest mit den aktuell importierten v12b-Assets:
node scripts/visual/kraken-live.mjs --mode=v13 --smoke=true --run=kraken-v12b
# Erst NACH Import des v13-Pakets ausführen:
node scripts/visual/kraken-live.mjs --mode=v13 --run=kraken-v13
```

Der v13-Modus verwendet Playwright-Core und installiertes Chrome, kein Chrome-Computer-Use.
Er startet jede Szene neu mit festem Seed und nimmt zwei Sonnenstände auf (135°/28° und 315°/45°).
Pro Szene entstehen 8–9 Hostzeitpunkte als unveränderte Canvas-PNGs mit Zoom 1 und Zoom 2 bei DPR 1;
eine Prüfung lehnt CSS-skalierte Canvas-Aufnahmen ab. Kontaktbögen sind verkleinerte Übersichten.
Enthalten sind Schwimmen über acht Sekunden mit separatem Positionsoverlay, Abtauchen im Teichinneren,
Tentakel-Aufstieg/Lauern/diagonaler Telegraph/Schlag und Einsinken ohne Schlag, Stacheln mit allen sechs
Abschüssen und Flug/Nachwachsen, Eierkegel samt Flug, Tinte mit authored 432-px-Reichweite, Phase-2-Ausstieg,
Sprung-Klaue vor einem Spieler und die Uferregression mit Ausfall Richtung Wasser.
Die Uferregression setzt den Kraken durch normale Navigation an den Teichrand und verlangt durchgehend
Phase `land` sowie einen trockenen Körper; ein vollständig trockener Ausgangspfad gilt nicht als Repro.

`--scene=ink,eggs` begrenzt die Rezepte; weitere Namen: `swim`, `dive`, `tentacle-strike`,
`tentacle-sink`, `spines`, `ashore`, `lunge-player`, `lunge-water`. `--quality=medium|low` und
`--captures=false` sind für Diagnose verfügbar. Letzteres liefert nur Zustände, keine Sichtprüfung.
`--smoke=true` nimmt standardmäßig nur drei Tintenzeitpunkte unter einer Sonne auf und ist keine
v13-Abnahme. Die Tintenaktion vermeidet den in v12b noch fehlenden `spine-volley`-Clip, der bei
einem expliziten `--scene=spines` den vorhandenen Renderer stoppen kann. Bekannte fehlende
Spine-Assets/-Clips werden im Rauchtest separat als erwartet protokolliert;
andere Lade-, Konsolen- und Shaderfehler lassen den Lauf scheitern. `report.json` enthält tatsächliche
Assetrevisionen, Hostzustände, Abdeckung, Fehler und geometrische Nachweise; `index.html` verlinkt die
Kontaktbögen. Zeitüberschreitungen oder fehlende Phasen ergeben einen fehlgeschlagenen Bericht statt
einer scheinbar vollständigen Bildserie.


### Brandstifter-Dachs: Gate 1

Map `0` (`00-test`) enthält zusätzlich den Encounter `firestarter-gate-1`.
Für einen isolierten Versuch dasselbe Dev-Szenario mit festem Seed, `suppressWaves: true`
und `freezeMission: true` verwenden. Über `target` eine freie Zelle etwa 400–700 px
vom Spieler auswählen (eine Zelle = 32 px), dann:

```js
await devScenario.whenReady();
await devScenario.run({ action: 'spawn', kind: 'firestarter-badger', pinned: false });
```

Während der kurzen lila Lanzenwarnung quer laufen: Der Weltzielpunkt bleibt fixiert,
die Achse geht von der aktuellen Gegnerposition durch ihn bis zur vollen Reichweite.
Im letzten Commit-Abschnitt verstärkt sich die Linie und der Gegner steht vollständig still.
Vor dem Schuss töten: Telegraph verschwindet ohne Abschuss. Mit einem natürlichen Felsen
zwischen Spieler und Gegner wiederholen: keine Angriffsplanung durch die Deckung.

Nach einem Lanzenangriff die langsamen lila Kugeln beobachten. Eine Kugel auf der realen
Lanzenachse muss den Strahl stoppen und die größere Explosion mit Brandfläche und Chunks
auslösen, auch wenn sie erst nach Telegraph-Beginn die Linie kreuzt. Bei zwei Kugeln hintereinander
zündet nur die erste. Ein zweiter Brandstifter darf fremde Kugeln zünden; ASMD-Spielerschüsse
lassen diese Kugeln intakt. Die nächste Lanze bei ausweichendem Spieler auch hinter dem
ursprünglichen Zielpunkt prüfen. Wiederbelebte Brandstifter benutzen in Gate 1 nur ihren Biss.

Headless-Nachweise: `tests/CoopDefenseFirestarter.test.ts` und der Brandstifter-Abschnitt in
`tests/integration/SharedCombatEffects.test.ts`. Browser-/Mehrspieler-Sichtprüfung,
finale Assets, Audio und taktische Dodges sind spätere Gates. Das Explosionsaudio verwendet
vorerst die vorhandene Void-Feuerball-Aufnahme unter einem eigenen austauschbaren Asset-Key.

Geprüfte Capture-Rezeptur (Seed `12345`, Spieler `(12,50)`, Tageszeit `720`):
Brandstifter ungepinnt auf `(28,54)`, Kamera auf `(20,52)`, Zoom `1.4`.
Hier bleibt auch die dicke Feuerkugel frei; auf `(28,52)` ist die Hitscan-Linie zwar frei,
die Kugel trifft aber nach etwa 33 px den benachbarten Felsen. Für drei gleichzeitig fliegende
Kugeln den Gegner auf `(42,55)` pinnen und mit Zoom `1.1` auf `(27,53)` schauen:
973 px Abstand liegen zwischen Lanzen- und Kugelreichweite; die drei Charges werden im
400-ms-Takt verbraucht, ohne Waffenwerte zu ändern. Für isolierte Combo-Nachwirkungen den
Schützen unmittelbar nach dem Einschlag mit `clearEnemies` entfernen, sonst entsteht bereits
nach 1100 ms die nächste Combo. `capture()` zählt einen Frame mit; 17 Schritte plus Capture
ergeben +300 ms, anschließend 53 Schritte plus Capture insgesamt +1200 ms.

### Schild-Anstürmer: Gate 1

Map `0` (`00-test`) enthält den Encounter `shield-charger-gate-1` (ein Anstürmer). Für einen isolierten
Versuch dasselbe Dev-Szenario mit festem Seed, `suppressWaves: true` und `freezeMission: true` verwenden,
über `target` eine freie Zelle etwa 200–350 px vom Spieler wählen und spawnen:

```js
await devScenario.whenReady();
await devScenario.run({ action: 'spawn', kind: 'shield-charger-badger', pinned: false });
```

Erwartung: Er nähert sich mit erhobenem Frontschild (120°) und dreht sichtbar langsam; seitlich laufen lässt
ihn nachdrehen statt sofort folgen. Treffer von vorn werden geblockt, von der Seite und von hinten nicht.
Steht der Spieler im Auslösebereich vor ihm, senkt er den Schild, steht still und zeigt den Korridor
(zwei Randlinien, sich füllender Boden, Pfeile, Endbalken). Die Richtung bleibt fest; seitlich aus dem
Korridor treten lässt ihn vorbeistürmen. Rückwärtslaufen entlang der Bahn reicht nicht. Am Endpunkt
oder an einem Felsen bleibt er erschöpft stehen (Schild unten, keine Warnfläche) – Zeit zum Flankieren.
Stun oder ein deutlicher Stoß während der Ankündigung brechen sie ab.

Headless-Nachweise: `tests/CoopDefenseShieldCharger.test.ts`. Asset, Clips und Kampagne sind spätere Gates.

