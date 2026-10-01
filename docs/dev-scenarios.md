# Dev-Szenarien

Mit `npm run dev:browser` starten und [dev-scenario.html](http://127.0.0.1:8090/dev-scenario.html) öffnen.
Die Seite startet das echte Spiel mit einem lokalen Host, ohne Broker oder Mitspieler.
LocalStorage und SessionStorage werden **vor dem Import des Spiels** durch flüchtige Speicher ersetzt.
Der normale Spielstand und seine Freischaltungen werden dadurch weder gelesen noch verändert.
Der Einstieg und die Bedienoberfläche werden vom normalen Produktionsbuild nicht ausgeliefert.

## Bedienung

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
| `speed` | `value` (0.1…2) |
| `camera` | optional `zoom` (0.25…8), `focusTarget` |
| `panel` | `collapsed`: Boolean |
| `options` | `values`: `timeOfDay`, `freezeMission`, `hideTutorial`, `suppressWaves`, `refillHp`, `refillAdrenaline`, `playerFreeForAll`, `hideAim` |
| `temporaryUtility` | `utility` (z. B. `NUKE`, `BFG`, `HOLY_HAND_GRENADE`), optional `chargeMs`; nutzt ein Pickup-Utility auf das Ziel |
| `train` | optional `invulnerable`; lässt auf Maps mit Zugstrecke sofort einen Zug einfahren |
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
// Nach Abschluss: Messung mit Qualitätsstufe und tatsächlichen Rendergrößen.
const measurement = dev.status().worldLightingMeasurement;
```

Messmodi: `stationary`, `destruction` (Fels nahe dem eingestellten Ziel), `walk` und `traverse` (Kamerafahrt).
Eine Messung setzt Pause fort; Änderungen an Uhrzeit, Tuning, Zoom oder Qualitätsstufe brechen sie ab.
Das Ergebnis enthält Frameintervalle, Draws, Upload-/Ressourcendaten, `graphicsQuality` und `sunRendering`.
Frameintervalle enthalten Browser-Scheduling und sind keine GPU-Zeiten.
`sunTuning` ist ein lokaler Override; gültige Schlüssel und Grenzen stehen in
[`src/config/sunlight.ts`](../src/config/sunlight.ts). Reset oder ein neuer World-Aufbau beendet die Overrides.
Das Wolkenfeld bleibt in Weltkoordinaten verankert. `cloudCover` und `cloudDensity` steuern
Bedeckung und Kontrast, `cloudScale` die Größe, `cloudWarp` die Form und `cloudSoftness` die weichen Ränder.
`shade`, `daylight` und `sun` steuern getrennt k�hlen Wolkenschatten, neutrales Tageslicht und warme Licht�ffnungen.
`fogShade` und `fogSun` f�rben nur die Nebelradiance; Dichte und Fl�chenbudget �ndern sich dadurch nicht.
`cloudSpotAmount` (Standard `.22`, aus: `0`) und `cloudSpotScale` (Standard `180` Weltpx, Bereich `80�300`) steuern die kleineren Licht�ffnungen.
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
