# FRAGDACHSE Asset-Pipeline V1

Codex steuert Blender über den vorhandenen MCP. Bildgenerierung liefert Texturgrundlagen; diese Skripte vereinheitlichen Kamera, Material, Export und Prüfung. Keine Spielsimulation oder Runtime-Integration.

## Start

```powershell
node scripts/asset-pipeline/export.mjs export art/poc/pipeline-v1/runs/v1-e
npm run dev:browser
```

Nach HTTP 200 auf Port 8090 öffnen:

`http://127.0.0.1:8090/scripts/asset-pipeline/viewer/?run=v1-e`

Im Viewer zuerst bei Faktor 1 prüfen. A/B wählen unabhängig Materialvariante und Quellauflösung. Eine 128er Quelle bleibt beim Dachs 32 Einheiten groß. Faktoren 0,5/0,75/1/1,33/2 verändern die Anzeige. Gegnerprofile 22–30 und Bossprofile 52–68 überschreiben nur die Vorschaugröße. Der optionale Kollisionskreis zeigt den hinterlegten Durchmesser × Größenfaktor und folgt der Bewegung; ein Anzeigeprofil verändert diesen Referenzdurchmesser nicht. Die Master-Vergrößerung ergänzt die Formkontrolle.

Aktueller Dachs: `art/poc/pipeline-v1/runs/v1-e/badger/`. Der direkte Vorgänger bleibt unter `runs/v1-d/`; der Turm unter `runs/v1-c/` (`?run=v1-c`). Jeweils `calm/` und `rich/` enthalten `master.png`, `asset.blend`, `render.json`, `export.json`, `sprite-<Größe>.png`. Eine Ebene darüber: `preferred.png`, `selection.json`, `review.png`. Frühere Durchgänge bleiben erhalten.

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
result = pipeline.build(repo, 'scripts/asset-pipeline/examples/badger.json', 'v1-f')
```

Für weitere Assets wiederholen. Vorhandene Asset-Verzeichnisse werden abgelehnt. Laufende Blender-Szenen bleiben erhalten. `pipeline.create_template(repo, 'template-v2.blend')` erzeugt eine leere Vorlage; die aktuelle liegt unter `art/poc/pipeline-v1/template-v1.blend`.

4. Render zuerst bei Nominalgröße, danach im Master prüfen. Erst Formen korrigieren, dann Textur. Änderungen bekommen neue Revisionen. Der Export erzeugt PNGs, Berichte, Review und Viewer-Katalog.
5. Nach Sichtprüfung eine Produktionsquelle auswählen:

```powershell
node scripts/asset-pipeline/export.mjs select art/poc/pipeline-v1/runs/v1-f/badger rich 128 "Dunkle Flanken und helle Muskelpartien bleiben bei 32 Einheiten erkennbar."
```

Bestehende Auswahlen werden nicht überschrieben. Unveränderte Master lassen sich identisch neu exportieren. Veränderte Master, Beschreibungen oder Texturdateien erfordern neue Revisionen; SHA-256 belegt ihre Identität.

## Stil und Vorlage

Moderner, farbenfroher, texturierter, leicht stilisierter 2D-Look. Geometrie liefert klare Form und weiche Schattierung. Keine künstliche Pixelrasterung, schwarze Outline, fotografischen Reflexe oder Miniaturbeleuchtung.

- XY ist die Bildebene, Z die Höhe. Orthografische Kamera exakt entlang -Z, Rotation null. +Y = Norden (Figuren), +X = Osten (Turmvertrag). Weltursprung ist der Drehpunkt. `pivot` ist dessen normierte Bildposition, Y von oben. Kein Autocrop. `orthoScale` legt den quadratischen Canvas fest; mindestens 2% Sicherheitsrand bleiben frei.
- Cycles 64 Samples, Seed 37, Denoising; Standard-Farbmanagement, Exposure 0, Gamma 1. Roughness 0,92, schwacher Specular. Ambient plus zwei große weiche seitliche Flächenlichter; kein zusätzliches Oberlicht, Boden, Tiefenunschärfe oder Bloom. Kleine Emissives bleiben lokale Farbakzente.
- `Authoring.material(name, rgb, family, emission, form_shading=False)` bietet `technical` und `organic`. RGB sind Blender-Linearwerte. Technisch: Lack, dunkles Metall, Warnfarben, sparsame Abnutzung. Organisch: breite Fellwerte und ruhige Variation. Ohne eigene Einstellungen bleiben `calm`/`rich` bei Texturstärke .22/.78 und Formschatten 0; Turmmaterialien bleiben unverändert.
- `materialVariants.calm` und `.rich` dürfen `label`, `textureStrength` und `formShadowStrength` setzen (Stärken 0–1). Die IDs bleiben stabil, auch bei anderen Anzeigenamen. Der Dachs v1-e nutzt Textur .22 in beiden Varianten, Formschatten .55 („Weich schattiert“) bzw. 1 („Kräftig · dunkler“). Nur die Formschattierung unterscheidet sich. Seine Rezeptur setzt eine eigene dunklere Werteskala; die gemeinsame Materialbasis und die Turmdefaults bleiben erhalten.
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

`art/poc/` bleibt komplett Git-ignoriert. Nur Skill, Skripte, Beschreibungen und Prompts werden versioniert. Runtime-Assets bleiben unverändert. Rigging, Laufanimationen und Integration folgen später.
