# FRAGDACHSE Asset-Pipeline V2

Codex steuert Blender über den vorhandenen MCP. Die Pipeline erzeugt orthografische Turm-, Gegner- und Figurensprites einschließlich Blender-Actions, transparenten Animationsframes und vollständigen Quellenpaketen. Der separate Phaser-Viewer prüft sie bei Spielgröße. Runtime-Integration bleibt ein eigener Auftrag.

## V2-Katalog und Produktionsstand

[catalog-v2.json](catalog-v2.json) ist der Bedarfskatalog: neun Turmgrafiken für elf Waffen-IDs, 14 Gegner und die Spielfigur. `gameIds`, `reference`, `targetSize` und optionale `referenceTransform` beziehen sich auf die bestehenden Spielverträge. Silhouette, Farbgruppen und Anatomie beziehungsweise Mechanik stehen in `description`; `requiredClips` nennt die Produktionsaufgabe. Assettests gleichen Abdeckung, gemeinsame Turmgrafiken, Anzeigegrößen und Referenzkorrekturen mit den aktuellen Spielregistries ab.

- `production: "planned"` bedeutet ein vollständiges Briefing ohne ausführbare Rezeptur.
- `production: "reference"` bedeutet eine unterstützte Referenzrezeptur. Erst ein vollständiger Build, Sichtprüfung, `selection.json` und Quellenarchiv belegen die tatsächlich produzierte Auswahl. Der Katalog allein behauptet keine Freigabe.

| Referenz-ID | Anzeigegröße | Framequellen | Clip |
| --- | ---: | --- | --- |
| `rocket` | 40 | 80/160 | `fire`: einmaliger Podrückstoß, erneut auslösbar |
| `tesla` | 40 | 80/160 | `fire`: Spulenbewegung und Eigenleuchten als Aktivitätsloop |
| `spore` | 32 | 64/128 | `fire`: Zusammenziehen, Ausstoßbewegung, Entspannen |
| `zombie-badger` | 28 | 64/128 | `move`: schwerfälliger Vierbeingang |
| `alien-badger` | 30 | 64/128 | `move`: Zweibeingang mit eigener Anatomie |
| `badger` | 32 | 64/128 | `move`: schneller Lauf mit stabilen Waffengriffen |

Die Produktionsbibliothek erweitert diese ursprünglichen Referenzen auf sämtliche neun Turmgrafiken und 14 Gegner des Katalogs. Gemeinsame Anatomie- und Mechanikhelfer liefern Geometriewerkzeuge; Proportionen, Materialgruppen, Ausrüstung und Gangparameter bleiben in den einzelnen Rezepten gestaltet. Der Spieler verwendet einen schnellen Lauf mit Körper-, Kopf- und Schulterbewegung. Gewichtete Arme lassen die Schulterbewegung bis zu den festen Handgelenken auslaufen; Griffe und Daumen bleiben am Export-Root. Seine enger stehenden Füße greifen weiter vor als zurück. Die V2-F-Archive bewahren den früheren Lauf mit festem Oberkörper, V2-G den ausbalancierten Lauf mit bewegten Händen.

Türme erhalten `mount: {rockSize: 32, maxBaseDiameter: 27}` und liefern alle tatsächlich tragenden Unterbaumeshes in `parts.base_meshes`. Die Pipeline prüft pro Pose den um den Drehpunkt liegenden Umkreis in Anzeigeeinheiten. Damit passt der Unterbau auch gedreht innerhalb des 32×32-Felsens; Waffenläufe dürfen etwas überragen. `frame.baseDiameter` speichert den geprüften Wert. Der Viewer zeigt auf Wunsch den echten freistehenden Felsframe unter dem Turm, ohne den Fels in das exportierte Asset einzubauen.

Quellauflösung und Anzeigegröße sind unabhängig. Neue Figuren schauen nach Norden (+Y), Türme nach Osten (+X); Weltursprung und Bildmitte bleiben der gemeinsame Drehpunkt. Die Original-Spore erhält im Vergleich ihre bestehende +7/-7-Pixel-Korrektur, der Original-Leerenjäger seine Drehung um π. Diese `referenceTransform` betrifft ausschließlich das alte Vergleichsbild; `rotationOffset` ist im Bogenmaß.

## V2 bauen und erweitern

1. Originalbild und aktuelle Spielkonfiguration prüfen. Für Serienassets den vorhandenen Katalogeintrag ausarbeiten; keine abweichenden Kopien von Spiel-IDs oder Anzeigegrößen anlegen.
2. Unter `recipes_v2/` eine asseteigene Rezeptur ergänzen. `build(ctx, resolvedSpec)` liefert ein `AssetModel` als Dictionary mit `root`, `parts`, optionalem `rig` und `sockets`. `parts` und `sockets` enthalten direkt referenzierte Blender-Daten; keine nachträgliche Suche über automatisch nummerierte Objektnamen. Gemeinsame Hierarchien und explizite starre Knochengewichte stehen in [rigs_v2.py](rigs_v2.py).
3. `model`, `recipe`, `orthoScale`, `textures`, `materialVariants` und `clips` im Katalog ergänzen und `production` auf `reference` setzen. `model` enthält nur die vom Rezept tatsächlich verwendeten Parameter. Die Lauf- und Schussbausteine stehen in [motions_v2.py](motions_v2.py): `mechanical_fire`, `energy_fire`, `organic_pulse`, `sustained`, `quadruped`, `biped`, `player_walk`. Numerische `clip.parameters` stimmen Vor-/Rückschritt, Fußheben, Rumpf-/Kopfbalance, Armbewegung sowie Rückstoß und Eigenleuchten ab. Die Bewegung addiert sich auf die erhaltene Ruhetransformation jedes direkt referenzierten Gelenks.
4. Über Blender MCP / `execute_blender_code` eine neue Revision bauen:

```python
import importlib.util
repo = 'C:/Fragdachse'  # an den Checkout anpassen
module_spec = importlib.util.spec_from_file_location(
    'fd_assets_v2', repo + '/scripts/asset-pipeline/blender_pipeline_v2.py')
pipeline = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(pipeline)
result = pipeline.build(repo, 'badger', 'v2-a')
```

Der Build verwendet eine neue eigene Szene. Bestehende Szenen, V1-Ergebnisse und lokale Dachsänderungen bleiben erhalten. Der V2-Dachs übernimmt die aktuelle Schulter-/Armform der V1-Rezeptur und ergänzt getrennte bewegte Beine. Seine beiden Materialvarianten vergleichen zurückhaltende und kräftigere gemalte Fellgruppen bei identischer Formschattierung. `badger_material_parts.py` richtet die gepackte Felltextur über gespeicherte Ruhekoordinaten entlang der Arme aus; die Koordinaten folgen der Hautverformung. Der versionierte Texturprompt steht als `badgerQuietFurV2J` in `texture-prompts.json`. Die Fellmaterialien neutralisieren prozedurale Wolkenvariation; warme Oberseiten und kühle Seiten folgen den Oberflächennormalen. Weiche objektübergreifende Material-AO vertieft den Kontakt zwischen Kopf und Armen, ohne Geometrie, Alpha oder Beleuchtung zu ändern.

`build(..., device='CPU')` ist der portable Standard. `device='CUDA'` beziehungsweise `'OPTIX'` verwendet ein vorhandenes passendes Cycles-Gerät; fehlt es, schlägt der Auftrag ausdrücklich fehl. Die Gerätewahl gehört zum Input-Fingerprint und darf bei einer Wiederaufnahme nicht wechseln. Auf der Blender-Kommandozeile stehen `--device CPU|CUDA|OPTIX`, `--max-frames <Anzahl>` und `--asset references` für alle ausführbaren Referenzeinträge bereit; `references` ist eine CLI-Auswahl, keine Asset-ID für `build()`:

```powershell
blender --background --python scripts/asset-pipeline/blender_pipeline_v2.py -- --repo C:/Fragdachse --asset references --revision v2-a --device OPTIX
```

`blender` durch den vorhandenen absoluten Programm-Pfad ersetzen, falls es nicht im PATH steht. Unter Windows verwendet die Veröffentlichung bei einem vom Python-Dateisystem abgelehnten Verzeichnis-Rename den vorhandenen nativen Helfer `publish-v2.ps1`. Er prüft beide absoluten Pfade gegen das deklarierte Pipeline-Verzeichnis und verschiebt das fertige Verzeichnis ohne Überschreiben; kein Kopier- oder Löschersatz ist erforderlich.

`max_frames` begrenzt bei Bedarf die Anzahl neuer Render eines Aufrufs. Derselbe Auftrag kann mit denselben Eingaben und Quellen fortgesetzt werden. Änderungen an Beschreibung, Pipeline, Rezepten, Bewegungsbausteinen oder Originaltexturen erfordern eine neue Revision; abgeschlossene Assetverzeichnisse sind unveränderlich. Noch unvollständige Builds liegen unter `art/poc/pipeline-v2/incomplete/<revision>/<id>` und werden nach Abschluss atomar nach `runs/<revision>/<id>` verschoben. Rezeptdateien tragen die wörtliche ID, etwa `recipes_v2/zombie-badger.py`; der Import erfolgt über Dateipfad.

Jedes Asset hat einen Ruheframe. Clipdefinitionen enthalten `name`, `motion`, `frameCount`, `frameRate`, `loop` und optional `parameters`. Ausgangswerte sind zwölf Frames bei zwölf Bildern pro Sekunde für Bewegung und Daueraktivität sowie acht Frames bei 24 Bildern pro Sekunde für Einzelschüsse. Die Schlussphase eines Loops wird für eine geschlossene Action authoriert, aber nicht nochmals als identischer Pausenframe exportiert. Figuren laufen am Ursprung; Richtungsänderung erfolgt später durch Rotation. Der Spieler-Lauf kennzeichnet `model.upperBodyMotion: "stable-grip"` und explizite Geometrierollen für Körper, Kopf, Arme, Beine und feste Griffe. Der ältere Modus `balanced` bleibt im Prüfer lesbar. Einzelschüsse kehren zur Ruhe zurück und enthalten keine vollständige Salve.

Der optionale Dachs-Face-Pass `model.combatFace` verwendet `badger_face_parts.py`: Kopfflächen werden nur in Z abgeflacht, während die Ruhekontur in XY und die Nase erhalten bleiben. Matte Augenöffnungen mit einer flachen, vom oberen Lid angeschnittenen dunklen Iris und niedrige Fellbrauen werden auf die bestehende Kopfoberfläche projiziert; `model.eyeSouthOffset` verschiebt die ganze Augenpartie nach hinten. Die Iris nutzt gespeicherte Ruhekoordinaten statt einer aufgesetzten Augenkugel. Die Koordinaten der Gesichtsbänder werden lokal um Augen und Brauen gebogen und weich in die ursprünglichen Wangenstreifen zurückgeführt. Dunkle Augenhöhlen liegen direkt im Kopfmaterial. Das Weiß nutzt weder die warme Fellabtönung noch Emission oder Glanzpunkte. Körper, Waffenhände und Bewegungsparameter bleiben unabhängig davon.

Die optionale Texturfamilie `bodyFur` ersetzt nur Körper-, Griff- und Pfotenfell; Kopf und Ohren behalten ihre ursprüngliche Textur. Gerichtete Fellgruppen modulieren die breiten Formwerte, ohne die Geometrie zu verändern. `model.clawedPaws` baut kompakte Pfoten und kurze matte Krallen über `badger_paw_parts.py`; sämtliche Teile gehören zur jeweiligen Beingeometrie und folgen den vorhandenen Beinsteuerungen. Der Standabstand und die Gelenkpunkte verwenden gemeinsam `model.footSpacing`.

## V2-Authoring-Vorschauen

[preview-v2.mjs](preview-v2.mjs) verbindet Blender-Render und Bildvergleich in einem Aufruf:

```powershell
npm run assets:preview -- badger
```

Standardmäßig entstehen drei tatsächliche 1024er-Render: idle sowie die verfügbaren Posen bei ungefähr 25 % und 75 % des ersten Clips, Variante `rich`. Vor dem Rendern prüft [preview-v2.py](preview-v2.py) weiterhin die Geometrie aller Posen mit den bestehenden Kamera- und Größenverträgen. Ein neuer unsichtbarer Blender-Hintergrundprozess erhält die interaktive Szene. Das eindeutige Label entsteht automatisch; die Ergebnisse liegen unter `art/poc/pipeline-v2/previews/<Label>/<id>`.

Blender wird in dieser Reihenfolge gesucht: `--blender`, Umgebungsvariable `BLENDER_PATH`, `PATH`. Falls Blender nicht im Suchpfad liegt, genügt beispielsweise:

```powershell
npm run assets:preview -- badger --blender "D:/Blender Foundation/Blender 5.2/blender.exe"
```

| Option | Wirkung |
| --- | --- |
| `--label bewegung-a` | Eigenes neues Label; bestehende Labels werden abgelehnt. |
| `--variant calm` | Eine Materialvariante rendern; Standard `rich`. |
| `--indices all` oder `--indices 0,3,6,9` | Alle bzw. bestimmte Posen; idle wird für den Vergleich immer ergänzt. |
| `--device AUTO` | Standard: verfügbares OPTIX-, dann CUDA-Gerät, sonst CPU. Explizites `CPU`, `CUDA` oder `OPTIX` möglich; ein nicht verfügbares explizites GPU-Gerät führt zum Fehler. |
| `--patch datei.json` | Bestehendes lokales Override-Format: Asset-ID auf flache Spec-Änderungen abbilden, optional unter `assets`; alternativ Asset-Liste. Der Katalog wird nicht geändert. |
| `--compare bild.png` | Eigenes Vergleichsbild statt automatischer Vorgängerauswahl. |
| `--review <Vorschauordner>` | Nur Bildübersichten neu erstellen, ohne Blender; kombinierbar mit `--compare`. |

`comparison.png` zeigt bisherigen und neuen idle vergrößert und in echter Nominalgröße, darunter die ausgewählten neuen Bewegungsposen. `scale.png` zeigt den neuen idle bei 0°/45°/90° auf hellem, dunklem, Gras- und Stahluntergrund aus dem vorhandenen Viewer. Türme stehen zum Größenvergleich auf dem echten 32×32-Fels; der Fels dreht sich nicht mit dem Turm.

Der bisherige Stand ist das aktuell importierte Asset mit seiner eigenen Revision und Variante: Wenn lokal vorhanden, wird der entsprechende Master verwendet, andernfalls das importierte Runtime-Bild mit Kennzeichnung der geringeren Quellauflösung. Ohne Import gilt die Katalogreferenz einschließlich ihrer bisherigen Positions-/Drehkorrektur. Fehlende Vergleiche werden im Bild ausdrücklich markiert. `preview.json` speichert tatsächlich gewählte Posen, Gerät, Renderdauer und Vergleichsquelle. Alte Vorschau-Manifeste bleiben lesbar; wenn ihnen idle fehlt, wird dies markiert.

Die normale Ausgabe enthält nur Ergebnis und Bildpfade. Vollständige Blender-Ausgabe steht in `<Label>/blender.log`; bei Fehlern erscheinen Exitstatus, kurzer Logauszug und Logpfad. Vorhandene Übersichten lassen sich beliebig oft erneuern:

```powershell
npm run assets:preview -- --review art/poc/pipeline-v2/previews/bewegung-a/badger
```

[review-preview-v2.mjs](review-preview-v2.mjs) bleibt auch direkt mit einem Vorschauordner aufrufbar. Die neuen Übersichten ersetzen den bisherigen `review.png`-Aufbau. Nach tatsächlicher Bildprüfung die Rezeptur oder Bewegung korrigieren und eine neue Vorschau erzeugen. Statische Posen prüfen keine kontinuierliche Bewegung; dafür bleibt der vorhandene Viewer nach ausdrücklichem Browserauftrag zuständig. Erst danach den vollständigen Build mit beiden Varianten erzeugen. Produktionsrevisionen, Auswahl, Archive und Import bleiben von diesem Vorschauwerkzeug unberührt. Quellenpakete erfassen auch die gemeinsamen Python-Anatomie-/Mechanikhelfer; Änderungen in der Authoring-Bibliothek erfordern eine neue Revision.

## V2 exportieren, prüfen und archivieren

```powershell
node scripts/asset-pipeline/export.mjs export art/poc/pipeline-v2/runs/v2-a
npm run dev:browser
```

Nach HTTP 200 auf Port 8090 den **sichtbaren** Viewer mit [V2-Beispieladresse](http://127.0.0.1:8090/scripts/asset-pipeline/viewer/?version=2&run=v2-a) öffnen. Browserprüfung bleibt opt-in; ein ausdrücklich beauftragter Browser-/Viewer-Review autorisiert sie. Ohne Browserauftrag oder bei verborgenem Pane die Sichtprüfung als nicht verifiziert melden.

Der Viewer lädt echte Animationsframes und synchronisiert A/B über Materialvarianten und Quellgrößen. Clipauswahl, Abspielen/Pause, Einzelbildsteuerung und Tempo sind getrennt von räumlicher Bewegung und Rotation. Schüsse lassen sich sofort neu auslösen; Daueraktivität lässt sich ein- und ausschalten. Der Einzelbildregler und die offline erzeugte Frameübersicht helfen beim Prüfen des Loopübergangs. Auswahlgründe erscheinen nach erneutem Export auch im Viewer.

Bei Faktor 1 jedes produzierte Asset mit beiden Quellgrößen auf hellen/dunklen sowie Gras-/Stahl-Untergründen prüfen: 0/45/90 Grad, laufende Rotation, normale Geschwindigkeit und Zeitlupe. Abnahme verlangt erkennbare Bewegung bei Nominalgröße, beim Spieler eine stabile Waffenhaltung mit abgestimmter Körper-, Kopf- und Schulterbewegung, geschlossene Loops, zuverlässige Rückkehr zur Ruhepose und keine flackernden oder abgeschnittenen Formen. Mechanik und lokales Eigenleuchten gehören zum Asset; Mündungsfeuer, Projektile, Blitze, ausgestoßene Partikel und Wirkungsbereiche bleiben separate Spieleffekte.

```powershell
node scripts/asset-pipeline/prepare-review-v2.mjs art/poc/pipeline-v2/runs/v2-a/badger art/poc/pipeline-v2/reviews/v2-a-badger.json
node scripts/asset-pipeline/export.mjs select art/poc/pipeline-v2/runs/v2-a/badger rich 128 "Der Pfotenwechsel ist bei 32 Einheiten klar; Rumpf, Kopf und Arme folgen dem Lauf natürlich."
node scripts/asset-pipeline/export.mjs archive art/poc/pipeline-v2/runs/v2-a/badger
node scripts/asset-pipeline/export.mjs export art/poc/pipeline-v2/runs/v2-a
```

Der Auswahlgrund muss die tatsächliche Sichtprüfung beschreiben. `archive` nutzt Python aus `FD_ASSET_PYTHON`, sonst `python`; alternativ `--python <absoluter-Pfad-zur-python.exe>` übergeben.

Vor der Auswahl die tatsächlichen Prüfergebnisse als JSON-Objekt innerhalb des Repositorys festhalten und mit `prepare-review-v2.mjs` beilegen. Der separate Review-Schritt kopiert Original- und gegebenenfalls Vorgänger-PNG unter ihren Repositorypfaden nach `archive-source/`, erhält den Bericht unverändert als `review.json` am Asset und als Quellenkopie und archiviert seinen eigenen Skriptstand. `archive-source/review-inputs.json` belegt diese zusätzlichen Eingaben mit SHA-256; Render- und Exportmanifeste bleiben unverändert. Eine vorhandene Auswahl sperrt spätere Review-Änderungen. Ein identischer erneuter Aufruf ist vorher erlaubt; abweichende bereits archivierte Quelldateien werden nicht überschrieben.

- Jeder transparente Masterframe hat 1024 × 1024 Pixel. Kamera, Licht, Canvas und Drehpunkt bleiben über alle Posen gleich. Ausgewertete Geometrie und Alpha-Bounds werden pro Frame auf Clipping geprüft; kein Autocrop oder automatisches Zentrieren.
- Jede Framegröße wird direkt aus dem Master alpha-aware abgeleitet. Ein Spritesheet hat höchstens acht Spalten. Zwei transparente Pixel rund um jede Zelle ergeben `margin=2`, `spacing=4`; der Rand gehört nicht zur Frame- oder Anzeigegröße.
- Pro Materialvariante entstehen `masters/frame-NNNN.png`, `asset.blend`, `render.json`, `export.json`, `sprite-<Größe>.png` als Ruhebild und `sheet-<Größe>.png`. Der Rendervertrag enthält Frames, Ruheframe, Clipzuordnung, Framerate, Loop, Ausrichtung, Drehpunkt, Anzeigegrößen und Quellenbelege; der Exportvertrag ergänzt Rasterbelegung, Pixelprüfungen und Hashes.
- `review.png` zeigt sämtliche Frames beider Varianten; `catalog.json` auf Run-Ebene ist die abgeleitete Viewer-Liste. Unveränderte Master können identisch neu exportiert werden; beschädigte oder veränderte Quellen werden abgelehnt.
- `selection.json` bindet das vollständige ausgewählte Assetpaket mit Ruhebild, Sheet, Clip-/Rastermetadaten und SHA-256-Dateiliste. V2 kopiert kein einzelnes `preferred.png`; Material und Auflösung sind eine gemeinsame unveränderliche Auswahl.
- `source-bundle.zip` enthält die gewählte Variante mit Blend-Datei/Actions, Masterframes, Exporten und Prüfdaten sowie `build.json`, `selection.json`, Originaltexturen und sämtliche verwendeten Quellen unter `archive-source/`. `archive-manifest.json` belegt alle gepackten Dateien per SHA-256. Alternativen bleiben im Run erhalten. Auswahl und fertiges ZIP werden nicht überschrieben.
- Eine archivierte Blend-Datei exemplarisch unabhängig von der Arbeitsszene öffnen, den gespeicherten Asset-Scene wählen und einen Frame rendern; den Ausgabepfad auf einen separaten Prüfpfad setzen. Gepackte Texturen und Actions müssen ohne die ursprüngliche Arbeitsszene funktionieren. Pixelidentität über unterschiedliche Blender-/GPU-Versionen ist nicht zugesichert.

`art/poc/pipeline-v2/` bleibt lokal und Git-ignoriert. Skripte, Rezepte, Katalog und Prompts werden versioniert. Für die Abnahme `npm run test:assets`, `node scripts/asset-pipeline/check-viewer.mjs`, `npm run check` und `git diff --check` ausführen. Bei Skilländerungen zusätzlich `npm run ai:sync`. Der Viewer-Build ersetzt keinen sichtbaren Browserreview.

## Gespeicherte V2-Animation in echtem Blender verifizieren

[verify_asset_pipeline_v2.py](../../tests/assets/verify_asset_pipeline_v2.py) prüft eine gespeicherte Blend-Datei unabhängig von der Arbeitsszene. Es gehört zur gezielten Assetprüfung, benötigt Blender und läuft nicht als Vitest-Abhängigkeit. Neben der Blend-Datei werden `render.json` und die zugehörigen `archive-source/`-Dateien benötigt; das Layout bleibt auch nach dem Entpacken eines Quellenarchivs erhalten.

```powershell
blender --background art/poc/pipeline-v2/runs/v2-a/badger/rich/asset.blend --python-exit-code 1 --python tests/assets/verify_asset_pipeline_v2.py -- --manifest art/poc/pipeline-v2/runs/v2-a/badger/rich/render.json --report art/poc/pipeline-v2/verification/v2-a/badger.json
```

Die Prüfung wählt die passende eingebettete Asset-Scene, auch wenn Blender das Library-Blend zunächst mit einer leeren Startszene öffnet. Sie überprüft Originaltexturen und eingebettete Quellen, Actions, 24-fps-Timelines, sämtliche ausgewerteten Posen, festen Drehpunkt/Kamera/Licht, Clipping, Loop-Schluss und Rückkehr von Einzelschüssen zur Ruhe. Bei Figuren müssen riggesteuerte Gliedmaßen bewegt werden. Beim ausbalancierten Spieler müssen zusätzlich alle expliziten Körper-, Kopf- und Armrollen Bewegung zeigen. `model.upperBodyMotion: "stable-grip"` verlangt zusätzlich unbewegte Geometrie mit der Rolle `grip`; ältere Spielerclips behalten die Prüfung ihres festen Oberkörpers. Turmunterbauten werden gegen ihren maximalen Umkreisdurchmesser geprüft. Der JSON-Bericht nennt bestandene Prüfungen beziehungsweise den konkreten Fehler.

Für einen exemplarischen unabhängigen Render `--render-frame 1 --render-output <neuer-absoluter-Pfad.png>` anhängen. Der Index bezeichnet den exportierten Frame. Dieser Portabilitätscheck verwendet CPU und behält 1024er-Auflösung, Cycles 64 Samples, Seed 37, Kamera und Materialien unverändert. Bericht und PNG müssen neue Dateien sein. Das Skript speichert niemals eine Blend-Datei und verändert keine Produktionsquellen; für die endgültige Dokumentation werden Prüferskript und Berichte als zusätzliche Review-Quellen beigelegt.

## Ausgewählte Assets ins Spiel übernehmen

`node scripts/asset-pipeline/import-runtime.mjs v2-g` übernimmt die ausgewählten Ruhebilder und
Sheets unverändert nach `public/assets/sprites/pipeline-v2/` und erzeugt die versionierte
`src/config/pipelineAssets.json`. Der Import prüft die Dateien gegen die SHA-256-Werte der
jeweiligen `selection.json`. Er rendert nichts und verändert keine Produktionsquelle.
Für einen gezielten Austausch `node scripts/asset-pipeline/import-runtime.mjs v2-h badger`
verwenden; weitere Asset-IDs können folgen. Ein Einzelimport erhält die übrigen Runtime-Einträge
und PNGs. Die Revision am Asset bezeichnet dessen Quelle; die Paketrevision bleibt die des
letzten Vollimports und gilt für ältere Einträge ohne eigene Revision.
Runtime und Build benötigen nur diese versionierten Dateien; Blender, Quellenarchive und
`art/poc/` bleiben lokale Authoring-Werkzeuge. Die Runtime-Bindung beschreibt
[rendering.md](../../docs/ai/rendering.md#figuren--und-turmassets).

## V1-Kompatibilität und vorhandene statische Referenzen

Die folgenden V1-Befehle, Verzeichnisse und Materialhinweise bleiben gültig. Ohne Versionsparameter zeigt der Viewer weiterhin V1. Die gemeinsame Stil-/Materialbasis gilt auch für V2.


Codex steuert Blender über den vorhandenen MCP. Bildgenerierung liefert Texturgrundlagen; diese Skripte vereinheitlichen Kamera, Material, Export und Prüfung. Keine Spielsimulation oder Runtime-Integration.

## Start

```powershell
node scripts/asset-pipeline/export.mjs export art/poc/pipeline-v1/runs/v1-f
npm run dev:browser
```

Nach HTTP 200 auf Port 8090 öffnen:

`http://127.0.0.1:8090/scripts/asset-pipeline/viewer/?run=v1-f`

Im Viewer zuerst bei Faktor 1 prüfen. A/B wählen unabhängig Materialvariante und Quellauflösung. Eine 128er Quelle bleibt beim Dachs 32 Einheiten groß. Faktoren 0,5/0,75/1/1,33/2 verändern die Anzeige. Gegnerprofile 22–30 und Bossprofile 52–68 überschreiben nur die Vorschaugröße. Der optionale Kollisionskreis zeigt den hinterlegten Durchmesser × Größenfaktor und folgt der Bewegung; ein Anzeigeprofil verändert diesen Referenzdurchmesser nicht. Die Master-Vergrößerung ergänzt die Formkontrolle.

Aktueller Dachs: `art/poc/pipeline-v1/runs/v1-f/badger/`. Der direkte Vorgänger bleibt unter `runs/v1-e/`; der Turm unter `runs/v1-c/` (`?run=v1-c`). Jeweils `calm/` und `rich/` enthalten `master.png`, `asset.blend`, `render.json`, `export.json`, `sprite-<Größe>.png`. Eine Ebene darüber: `preferred.png`, `selection.json`, `review.png`. Frühere Durchgänge bleiben erhalten.

## Neues Asset

1. [Beschreibung](examples/badger.json) und [Rezeptur](recipes/badger.py) kopieren. Anzeigegröße im aktuellen Runtime-Code prüfen. Piloten: Dachs Anzeige 32, Quellen 64/128; Turm Anzeige 40, Quellen 80/160. Master 1024. Original-Dachsanimation: 64er Frames, Anzeige 32. Der statische 32er Sprite im Viewer ist die Anatomie-/Farbvorlage.
2. `id`, `category` (`character`, `enemy`, `turret`), `recipe`, `targetSize`, `sourceSizes`, `forward`, `pivot`, `orthoScale`, `textures`, `reference` ausfüllen. Pfade relativ zum Repository; Rezept unter `recipes/<name>.py`. Optional: `collisionDiameter` für den Vorschaukreis, `previousReference: {label, path}` für eine vierte Vergleichsspalte und `materialVariants` für die unten beschriebenen Varianten.
3. Neue Run-ID wählen und über **Blender MCP / execute_blender_code** ausführen:

```python
import importlib.util
repo = 'C:/Fragdachse'  # an den Checkout anpassen
spec = importlib.util.spec_from_file_location(
    'fd_assets', repo + '/scripts/asset-pipeline/blender_pipeline.py')
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
result = pipeline.build(repo, 'scripts/asset-pipeline/examples/badger.json', 'v1-g')
```

Für weitere Assets wiederholen. Vorhandene Asset-Verzeichnisse werden abgelehnt. Laufende Blender-Szenen bleiben erhalten. `pipeline.create_template(repo, 'template-v2.blend')` erzeugt eine leere Vorlage; die aktuelle liegt unter `art/poc/pipeline-v1/template-v1.blend`.

4. Render zuerst bei Nominalgröße, danach im Master prüfen. Erst Formen korrigieren, dann Textur. Änderungen bekommen neue Revisionen. Der Export erzeugt PNGs, Berichte, Review und Viewer-Katalog.
5. Nach Sichtprüfung eine Produktionsquelle auswählen:

```powershell
node scripts/asset-pipeline/export.mjs select art/poc/pipeline-v1/runs/v1-g/badger rich 128 "Dunkle Flanken und helle Muskelpartien bleiben bei 32 Einheiten erkennbar."
```

Bestehende Auswahlen werden nicht überschrieben. Unveränderte Master lassen sich identisch neu exportieren. Veränderte Master, Beschreibungen oder Texturdateien erfordern neue Revisionen; SHA-256 belegt ihre Identität.

## Stil und Vorlage

Moderner, farbenfroher, texturierter, leicht stilisierter 2D-Look. Geometrie liefert klare Form und weiche Schattierung. Keine künstliche Pixelrasterung, schwarze Outline, fotografischen Reflexe oder Miniaturbeleuchtung.

- XY ist die Bildebene, Z die Höhe. Orthografische Kamera exakt entlang -Z, Rotation null. +Y = Norden (Figuren), +X = Osten (Turmvertrag). Weltursprung ist der Drehpunkt. `pivot` ist dessen normierte Bildposition, Y von oben. Kein Autocrop. `orthoScale` legt den quadratischen Canvas fest; mindestens 2% Sicherheitsrand bleiben frei.
- Cycles 64 Samples, Seed 37, Denoising; Standard-Farbmanagement, Exposure 0, Gamma 1. Roughness 0,92, schwacher Specular. Ambient plus zwei große weiche seitliche Flächenlichter; kein zusätzliches Oberlicht, Boden, Tiefenunschärfe oder Bloom. Kleine Emissives bleiben lokale Farbakzente.
- `Authoring.material(name, rgb, family, emission, form_shading=False)` bietet `technical` und `organic`. RGB sind Blender-Linearwerte. Technisch: Lack, dunkles Metall, Warnfarben, sparsame Abnutzung. Organisch: breite Fellwerte und ruhige Variation. Ohne eigene Einstellungen bleiben `calm`/`rich` bei Texturstärke .22/.78 und Formschatten 0; Turmmaterialien bleiben unverändert.
- `materialVariants.calm` und `.rich` dürfen `label`, `textureStrength` und `formShadowStrength` setzen (Stärken 0–1). Die IDs bleiben stabil, auch bei anderen Anzeigenamen. Der Dachs v1-f nutzt Textur .22 in beiden Varianten, Formschatten .55 („Weich schattiert“) bzw. 1 („Kräftig · originalnah“). Nur die Formschattierung unterscheidet sich. Seine Rezeptur setzt eine eigene dunklere Werteskala mit gedämpften Muskellichtern und ein unabhängiges helles Kopfmaterial; Schwanz und Gesichtsbänder bleiben separat kontrollierbar. Die gemeinsame Materialbasis und die Turmdefaults bleiben erhalten.
- Für gezielte Formwerte organisches Material mit `form_shading=True` erzeugen und nach der Modellierung `paint_form_mask(mesh, sampler)` auf den verwendenden Meshes aufrufen. Das gespeicherte Punkt-Farbattribut `FD_FormMask` moduliert die Oberflächenausrichtung zur Z-Achse. Breite dunkle Einschnitte und begrenzte helle Muskelpartien gestalten; keine gleichmäßig schwarze Randlinie. Kopfmaterial und Augen bleiben unabhängig. Größere Körpermasse modellieren, ohne Kamera oder Kopf-/Handbreite mitzuziehen.
- [Exakte Textur-Prompts](texture-prompts.json) liegen im Git. Die tatsächlich generierten Originalpixel liegen unter `art/poc/pipeline-v1/textures/`, werden per SHA-256 belegt und in jede finale Blend-Datei gepackt. Prompts allein sind keine exakt reproduzierbare Bildquelle.
- Texturen nutzen lokale Generated-XY-Projektion ohne Wiederholung (`EXTEND`). Es gibt keine Kachelgrenze; Übergänge zusammengesetzter Formen trotzdem prüfen. Komplexe Modelle benötigen später gezielte UVs. Diese Basen sind keine freigegebenen nahtlosen Terrain-Tiles.
- Gesichtsbänder, Augen, Ohren, Brauen, Schwanz, Warnmarkierungen und Anzeigen werden gezielt gestaltet. KI-Texturen bestimmen keine Anatomie. Mikrodetails dürfen diese Merkmale bei Nominalgröße nicht auflösen.

## Export und Viewer

Jede PNG-Größe entsteht direkt aus dem Master ohne Autocrop, wiederholtes Verkleinern oder pauschale Nachschärfung. Sharp/libvips berücksichtigt Alpha beim Lanczos3-Resampling. `render.json` enthält Skript-/Rezepthashes, Materialparameter und Texturbelege; `export.json` Master-/Exporthashes, Alpha-Bounds und fast weißen Pixelanteil. `report.native` misst Breite, Höhe und belegte Pixel der Nominaldatei ab Alpha 128/255. Bei `previousReference` enthält `native-comparison.json` dieselben Werte für beide Varianten, Vorgänger und Original. Diese Messungen unterstützen die Sichtprüfung; die GPU-Vorschau kann beim Skalieren leicht abweichen. Kamera, Alpha, Größen, Rand und Texturbelege werden geprüft.

Der Viewer nutzt die installierte Phaser-Version und `createWebGLStartupContext` des Spiels: WebGL2 bevorzugt, WebGL1 als Fallback; `smoothPixelArt` nur bei WebGL1 wie in `src/main.ts`, sonst geglättete Skalierung. Quell- und Anzeigeauflösung bleiben getrennt. 1 Einheit entspricht bei Faktor 1 einem CSS-Pixel, Display-DPR bis 2 wird berücksichtigt. Browser-Zoom 100% verwenden. Keine Spielkamera-Skalierung, Welt-FX oder Spielsimulation. Die GPU-Generation wird eingeblendet; WebGL2-Prüfung ist kein Nachweis für WebGL1.

Gras und Stahl verwenden vorhandene Repositorybilder; Erde zeigt den vollflächigen Frame 12 des vorhandenen `dirt47blob.png` (32er Frames). Dieses Referenzbild wird nur angezeigt; keine neuen 47-Blob-Flächen entstehen. Hell neutral zeigt dunkle Farbsäume. Master und Offline-Review ersetzen keine Rotation-/Bewegungskontrolle.

## Prüfung und Aufbewahrung

```powershell
npm run test:assets
node scripts/asset-pipeline/check-viewer.mjs
npm run ai:sync
npm run check
git diff --check
```

Tests schützen Alpha-Resampling, Kamera-/Drehpunktvertrag, Clipping, Texturbelege und identische Exporte. Im Viewer beide Assets bei 0/45/90°, laufender Rotation und langsamer Bewegung auf hellen/dunklen Untergründen sowie beide Produktionsauflösungen vergleichen. Auswahlgründe stehen in `selection.json` und im lokalen Review-Protokoll.

Blend-Dateien enthalten gepackte Originaltexturen und eingebettete Erstellungsskripte. Die Szene kann unabhängig vom Repository geöffnet und gerendert werden; auf anderen Rechnern Ausgabepfad anpassen. Geometrie lässt sich aus gespeichertem Skriptstand mit denselben Originaltexturen neu erzeugen. Pixelidentische Exporte werden vom unveränderten Master geprüft; identische Blender-Render über verschiedene Blender-/GPU-Versionen sind nicht zugesichert.

`art/poc/` bleibt komplett Git-ignoriert. Skill, Skripte, Beschreibungen, Prompts und die ausdrücklich importierte Runtime-Auswahl werden versioniert. V1 bleibt statisch; Rigging, Animationsexport und Runtime-Import sind oben als V2 beschrieben.
