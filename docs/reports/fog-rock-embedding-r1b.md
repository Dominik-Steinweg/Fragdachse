# Fog/Rock R1c: freigegebene Luftperspektive

Die Kontakt-/Sonnenwerte sind jetzt .34/.14 in
`src/effects/groundFog/FogRockLighting.ts`. R1 bleibt ohne weiteren Pass.
Die mildere Ausgangsversion (.22/.10) und die neuen Werte sind als getrennte
Boegen gespeichert. R1 verbessert den Fuss, loest den ausgeschnittenen Eindruck
gegen hellen Nebel aber nur teilweise. Tagsueber kein auffaelliger schwarzer
Graben oder heller Halo; die Blockadensilhouette bleibt klar. Nacht ist bei
unveraenderter Belichtung sehr dunkel und deshalb eingeschraenkt beurteilbar.

## Luftperspektive

`renderDebug.rockAerialPerspective` ist standardmaessig true. Ein
mineralmaskierter Quad mischt lokale Nebelradiance mild in die Felsoberflaeche;
Standardstaerke .20, optional `rockAerialPerspectiveStrength` von 0 bis .5.
Die Mischung hebt Schwarz an und mindert Kontrast/Chroma dort, wo Nebel liegt.
Kein Hoehenschleier und keine Kantenwisps. Sie verbindet Fels und Nebel sichtbar besser; mittags wirken die Flanken
bei .26 etwas milchiger. R1c ist nach User-Freigabe schwaecher und standardmaessig
aktiv, auch auf Low. Ein weiches Gate anhand lokaler Fog-Alpha unterdrueckt
die Aufhellung durch duennen Grunddunst; ohne Nebel ist der Beitrag null.
Alle Staerken und Gate-Schwellen stehen in FogRockLighting.ts.

Der Quad liegt bei 9.13 (ueber anhaftender Vegetation, unter
Tagesnebel). Vorhandene Depths bleiben unveraendert. Er leiht Material-, Spur-
und Surface-Texturen; maximal drei Sampler, keine weitere Rendertextur.
Bei aktiver Luftperspektive entsteht ein zusaetzlicher Draw. Ausschalten zerstoert den Quad;
fehlende Bindung/Residency und Diagnoseansichten liefern keine Luftperspektive.
RGB verwendet PMA-Mischung (ONE, ONE_MINUS_SRC_ALPHA), Alpha explizit (ZERO, ONE).
Der Blend gilt nur innerhalb des Draws und wird danach wiederhergestellt:
Phaser ADD verwendet DST_ALPHA. Der Effect-Layer-Katalog wurde nicht editiert;
die experimentelle Depth muss vor einer dauerhaften Aktivierung mit dessen Owner
abgestimmt werden.

## Live-Befehle

Frische Lobby: `http://127.0.0.1:8090/dev-scenario.html`, kein Szenario starten.

```js
const dev = window.devScenario;
dev.run({action:'panel',collapsed:true});
dev.run({action:'renderDebug',disable:[],lobbyTimeOfDay:480});
dev.run({action:'renderDebug',disable:['fogRockContact','fogRockSunShadow','rockAerialPerspective']}); // A
dev.run({action:'renderDebug',disable:['rockAerialPerspective']}); // R1 ohne Aerial
dev.run({action:'renderDebug',disable:[]}); // neuer Standard: R1 + Aerial
dev.run({action:'renderDebug',disable:[],rockAerialPerspective:true}); // explizit an
dev.run({action:'renderDebug',disable:[],rockAerialPerspective:true,rockAerialPerspectiveStrength:.20});
dev.run({action:'renderDebug',disable:[],lobbyTimeOfDay:720}); // 12:00
dev.run({action:'renderDebug',disable:[],lobbyTimeOfDay:0}); // 00:00
```

Die disable-Liste akzeptiert zusaetzlich `rockAerialPerspective` und hat Vorrang.
Jeder neue renderDebug-Aufruf ohne Aerial-Flag setzt es auf an. Szenariostart
und Teardown setzen alle optischen Overrides zurueck. Simulation, Geometrie,
Readiness und die optische Dichte des bestehenden Nebelpasses bleiben unberuehrt.

## Reproduzierbare Aufnahme

`node build/fogrock/capture.mjs` und danach `node build/fogrock/boards.mjs`;
beide Befehle mit `--aerial` erzeugen den Optionsvergleich.
Sie benutzen den vorhandenen Vite auf 8090 und eigenes sichtbares Chrome mit
deaktivierter Hintergrunddrosselung; Browser werden in finally geschlossen.
Nur im eigenen Aufnahmetab werden HMR-Updates verworfen, um Parallel-Edits
nicht mitten in einen A/B-Satz zu laden. Neu starten uebernimmt neue Module.

Viewport 1600x900, DPR 1, normale Lobby-Kamera, High. Der Schriftzug zeigt links
dichten Nebel und rechts freie Felsen. Der Helfer friert den 08-Uhr-Nebel und
seine nichtfarblichen sunTuning-Parameter fuer alle Zeiten ein, da regulaerer
Mittagsnebel fast verschwindet. Lichtfarben, Sonnenrichtung und Ambient folgen
480/720/0. Er setzt nur im Aufnahmetab die 800-ms-Uhrzeitueberblendung zurueck,
wartet Worker-Publikation ab und beendet die Horizontueberblendung. Fog-, Cloud-
und Szenariophase bleiben innerhalb eines Bogens gleich. Manifeste dokumentieren
die Werte und Browserfehler. Das ist eine kontrollierte Vergleichsszene, kein
Screenshot des regulaeren Mittagswetters. Keine Farbkorrektur/Aufhellung.

`r1-ab.png`, `r1-ab-v2.png`, `r1-aerial.png` liegen unter `build/fogrock/`.
Alle Boegen sind 1600 Pixel breit. Unter der verkleinerten Gesamtansicht liegt
ein Ausschnitt in originaler Spielgroesse; B-Zoom ist ein 2x-Pixelausschnitt
derselben Aufnahme, kein weiterer Kamera-/Nebelzustand. Volle Frames bleiben
ebenfalls dort erhalten.

## Pruefung und Patches

62 Tests in temporaeren Kopien der fuenf erweiterten Fog-/Dev-Dateien bestanden,
zusaetzlich 41 vorhandene Formationstests (einschliesslich GPU-/Worker-Reparatur).
Live: keine Console-/Shaderfehler in den finalen beiden Aufnahmelaeufen.
Low behaelt Kontakt .34 und deaktiviert Sonnenhorizonte. Nach Aerial Ein/Aus
ist der R-A-G-D-Ausschnitt pixelgleich; gemessener Blend [1,771,0,1].
Details: build/fogrock/verification.json. Eigene Browser geschlossen.
Tests pruefen Default-aus, Wertevalidierung vor Mutation, Reset, Low, Sampler,
fehlende Bindung, Resize/Teardown und explizite Alpha-Erhaltung.
`npm run build` wurde ausgefuehrt: eigener Typfehler korrigiert; letzter Lauf
scheitert ausschliesslich an fremden fehlenden TrainAftermathSmoke/-Debris-
Eintraegen in `src/effects/EffectLayerContract.data.ts:798`. Diese Spur bleibt
unveraendert. Keine Live-Zerstoerungsabnahme in dieser Lobby-Aufnahmerunde.

`build/fogrock-r1b-source.patch` dokumentiert die bereits angewendeten eigenen
Source-Aenderungen gegen den R1-Ausgangszustand. Fremde Zug-Hunks sind entfernt.
Tests und diese Doku liegen ausschliesslich als `fogrock-r1b-tests.patch` und
`fogrock-r1b-docs.patch` zum Anwenden vor. Keine Commits.

## Kontrolle R1c

`node build/fogrock/capture-r1c.mjs` und `node build/fogrock/boards-r1c.mjs`
erzeugen `build/fogrock/r1c.png` mit 08/12 Uhr: alles aus | R1 | R1+Aerial .20.
Wie oben werden Nebelparameter/Phase fuer den Beleuchtungsvergleich festgehalten.
Low nutzt dieselbe Maske und drei vorhandene Texturen, ohne weitere Rendertextur;
Sonnenhorizonte bleiben dort aus. Der separate Draw erhaelt Scene-Alpha.

R1c-Tests pruefen Default-an bereits am Systemkonstruktor, optisches Abschalten,
Reset bei Szenariostart auch nach explizitem false und lokale Dichtekopplung.
43 Tests in angepassten build-Kopien und 19 vorhandene Fog-/Dev-Tests bestanden.
Source direkt angewendet; Tests/Doku nur als build/fogrock-r1c-*.patch.

Finale Live-Kontrolle: 08/12 Uhr ohne Shader-/Consolefehler; klare aeussere
E-Arme pixelgleich zwischen R1 und R1+Aerial, nur der Nebel-Uebergang reagiert.
Mittags bleiben Moos, Kanten und Relief lesbar; die Wirkung ist dezenter als .26.
Low Ein/Aus stellt den geprueften Felsausschnitt pixelgleich wieder her.
Der Build bleibt am oben genannten fremden TrainAftermath-Contractfehler blockiert.
Browser geschlossen; keine Commits.
