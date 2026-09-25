# Waldboden-Lab

Start: `npm run dev:browser`, dann [Boden-Lab](http://127.0.0.1:8090/ground-lab.html).
`npm run build:ground-lab` prueft und buendelt den separaten Lab-Einstieg. Das Lab wird
nicht mit dem normalen Spiel-Bundle geladen.

## Bedienung und Sichtpruefung

- **Material- und Grenzproben:** Flaechen, Loch, diagonale Treppe, schmaler Streifen,
  Einzelzelle und Insel. Die bewusst einfachen Formen zeigen Material- und Kantenfehler.
- **Waldprobe:** unveraenderte Dirt-/Fels-/Baumpositionen aus dem Lobby-Layout, bestehende
  Fels- und Baumassets und eine Figur als Groessenreferenz. Kein eigener Nebel oder Post-FX.
- Seed, Zoom 75/100/150/200 %, Bodenbedeckung an/aus und Ziehen zum Kameraverschieben.
  Der weltfeste 1-Meter-Massstab entspricht 32 Weltpixeln.
- Chunkgrenzen, Weltversatz 37/19, Neuaufbau und Kamera weg/zurueck pruefen Wiederaufbau
  und Naehte. Die Materialprobe ist gross genug fuer echte Chunk-Eviction.
- Status: residente Chunks, ausstehende Bakes, Chunktexturspeicher und Bake-Zeit.

Abnahme bei Normalzoom und 75 %, zuerst ohne, dann mit Bodenbedeckung. Die Erde laeuft ueber
eine unregelmaessig breite Zone ins Gras aus: Halme und Bueschelgruppen ragen in die Erde,
Erde erscheint zuerst in den Luecken zwischen den Halmen. Keine erhoehte Erdplatte, kein
gleichmaessiger Saum, keine Kachelwiederholung. Auch im normalen Spiel mit Licht und Nebel
pruefen; das Lab ersetzt diesen Schritt nicht.

## Aufbau

| Ebene | Tiefe | Quelle |
|---|---|---|
| Gras | `DEPTH.GRASS` | `gras_bg_tile`, TileSprite, 1 Texel = 1 Weltpixel |
| Erde samt Uebergang | `DEPTH.DIRT` | `DirtSurfaceLayer`, gestreamte Chunk-Bakes |
| Bodenbedeckung | `DEPTH.GROUND_COVER` | Moosflecken, Blatthorste, Halmbueschel |
| Grossflaechige Variation | `DEPTH.GROUND_MACRO` | `ground_macro`, Multiply-TileSprite, 5,5-fach gestreckt |

`DirtSurfaceField` berechnet nur Darstellung aus Seed, Dirt-Belegung und World-Rahmen und
schreibt fertiges RGBA: Eine gefilterte, weltfest verformte Belegungsdichte bestimmt die
Kontur. Im Uebergang entscheidet ein Height-Blend je Pixel zwischen Gras und Erde; die Hoehe
stammt aus der Graskachel selbst (`deriveGrassHeight`) plus Klumpenrauschen, die Breite der
Zone variiert entlang der Kante. Davor liegt ein schwacher Erdton im Gras, direkt an der Kante
ein leichter Kontaktschatten. Chunk-Bakes und Terrain-Farbsnapshot rufen denselben Bake auf,
das Ergebnis haengt nicht von Bake-Reihenfolge oder Regionsaufteilung ab. Netz- und
Layoutdaten bleiben unveraendert.

Die Bodenbedeckung hat sieben Stufen (`GROUND_COVER_TIERS`), in Zeichenreihenfolge: grosse flache
Erd- und Laubflaechen auf den Freiflaechen, grosse gruene Flaechen (Moos, Klee, Bodendecker; 2-7 m
Radius) unter den Wuchsinseln, sparsame Farbkolonien (Blueten, Sauerklee, Flechten, Pilze, Kupferlaub;
`forest-detail/candidates-03-color`) am Rand der Wuchsinseln, mittlere, weich auslaufende Moosflecken, flache Waldstreu (Kiesel, Zweige, Laub), kleine Halmbueschel und
aufrechte Waldvegetation (Grashorste, Farne und Stauden, Bluetengruppen). Streu und Vegetation
behalten ihre physische Groesse. Streu, Halmbueschel und Vegetation wachsen gruppiert: Ein gemeinsames,
weltfestes Wachstumsfeld (`groundGrowthLevel`) bildet unregelmaessige Inseln und Baender, dort
entstehen Cluster meist derselben Art, dazwischen bleiben ruhige Freiflaechen. Die 16-px-Gras-Decals
des Layouts folgen beim Backen demselben Feld (`isGroundDecalInGrowth`); Layout und Wire-Format
bleiben unveraendert. Felszellen tragen keine Anker; freie Zellen direkt neben einem
Felsen bilden den Anker `rockFoot` mit Kieseln und Pflanzen am Felsfuss. Erdflaechen mischen
ueber ein grossflaechiges, weltfestes Feld feuchten Humus (`dirt_material`) mit trockenerem,
hellerem Lehm (`dirt_material_alt`).

Um Wasser legt dieselbe Erdschicht eine Uferboeschung: Eine vorzeichenbehaftete, weltfeste Distanz
zu den Wasserzellen bestimmt Deckung, Naesse und Material. Unter dem durchscheinenden Wasserrand
liegt deckender, nur leicht abgedunkelter Grund, und das Wasser bleibt ueber eine flache Uferzone
durchscheinend und wird erst allmaehlich tief; eine zurueckweichende Welle legt so feuchten
Schlamm statt einer dunklen Abbruchkante frei; an der Wasserlinie feiner nasser Schlamm
(`bank_material_wet`), dahinter durchwurzelter Humus (`bank_material`), dessen Aussenkante
unregelmaessig breit ist und wie die Erdnaht ueber die Grashoehe ins Gras auslaeuft. Die
Kollision bleibt die Wasserzelle. Die Bodenbedeckung kennt dazu den Anker `bank` (Kiesel,
Zweige, Grashorste und Seggen, die ueber die Wasserlinie ragen duerfen). Quellen:
[`shoreline/candidates-01`](../tools/source-art/shoreline/candidates-01/README.md).

Der Kieshof der persistenten Basis nutzt dasselbe Feld: `DirtSurfaceField` mit den Zellen der
aktuellen Bauflaeche und dem Kiesmaterial (grauer Schotter `gravel_material`, grossflaechig
mit sandigem Kies `gravel_material_alt` gemischt, Quellen
`ground-materials/candidates-set-05-gravel`). Er bekommt damit dieselbe organische Naht zum
Gras. Die dezenten Kiesstempel (`PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG`) bleiben im Inneren
der Zone.

Das Gleisbett (`TrackGravelField`) entsteht pixelgenau aus demselben Kiesmaterial, grau gestimmt:
dichter Schotter unter den Schwellen, eine entlang des Gleises unregelmaessig breite Schulter, in
der die Steine gruppenweise in ein dunkles, verdichtetes Erdbett auslaufen. Den organischen Erdrand
um die Gleise liefert weiterhin die Karte. Sichtpruefung im Gleis-Lab (`track-lab.html`).

## Quellen und reproduzierbarer Export

`npm run sprites:ground` erzeugt alle Bodenassets in dieser Reihenfolge:

1. `scripts/generate-grass-tiles.mjs` liest
   [`materials.json`](../tools/source-art/ground-materials/materials.json): Quelle,
   physische Groesse (32 Pixel/Meter), Farbabstimmung und optionale Mischschichten
   (`blend`). Das Gras (dunkles Farngruen aus `candidates-set-04-rich-grass`) nutzt bewusst
   keine Mischschicht, damit die Flaeche ruhig bleibt; Variation kommt aus Makrokarte und
   Bodenbedeckung. Deterministisches Image-Quilting setzt
   daraus nahtlose 1024-Pixel-Kacheln zusammen, ohne Schaerfen oder kuenstliches Rauschen.
2. `scripts/generate-ground-macro.mjs` erzeugt die nahtlose, niederfrequente Multiply-Karte.
3. `scripts/generate-ground-cover-textures.mjs` erzeugt Moosflecken aus
   `tools/source-art/groundcover` (gemeinsame organische Pipeline, an die neue Graskachel
   angeglichen), Halmbueschel aus `tools/source-art/ground-materials` sowie Streu und
   Vegetation (`forest_*`) aus [`forest-detail/candidates-01`](../tools/source-art/forest-detail/candidates-01/README.md).
   Namen und physische Groessen stehen nur in der Variantentabelle von
   `src/arena/GroundCoverConfig.ts`; der Export liest sie direkt.

Die Material- und Bueschelquellen wurden mit dem eingebauten Imagegen-Werkzeug erzeugt;
Prompts stehen in [`prompts.json`](../tools/source-art/ground-materials/prompts.json) und
[`candidates-set-02/prompts.json`](../tools/source-art/ground-materials/candidates-set-02/prompts.json).
Die neutralweisse alte Detailtextur bleibt fuer das unabhaengige Nebel-Lab erhalten.

## Automatische Pruefung

`npm run check`, `npm run test:assets`, `npm run test:integration` und `npm run build:ground-lab`.
Die Bodenpruefungen schuetzen Determinismus, Kachelkanten, Chunk-/Snapshot-Paritaet und Teardown;
sie ersetzen keine Sichtpruefung und schreiben keine aesthetischen Parameter fest.
