# Marker-Glyphen / M3-G

Weiße gefüllte SVG-Silhouetten mit Alpha, 64 × 64 Quellraster und mindestens
4 px Außenrand. Tragende Stege mindestens 4 px breit; spitze Abschlüsse erlaubt.
Keine Texturen oder eingebauten Badge-Farben. Formreferenz:
`art/poc/dawn/markers/marker-icons-01.png`.

## Verbindliche IDs

Exakt `MARKER_GLYPH_IDS` aus `src/effects/markers/MarkerTypes.ts`, Branch
`dawn`, Commit `0eb7d320`, in Vertragsreihenfolge:

| ID | Form |
| --- | --- |
| `base` | Bastion mit offenem Innenhof |
| `boss` | Hornschädel |
| `site-wreck` | Gebrochener Rotor |
| `site-extractor` | Tankpaar mit Abwärtspfeil |
| `site-brood-nest` | Ei-Cluster |
| `site-supply` | Fallschirm mit Kiste |
| `site-scrap-heaps` | Kantige Schrottstücke |
| `scavenger` | Dachs von oben, Nase nach Norden, Streifen und Schrottsack rechts |
| `mission-destroy` | Gekreuzte Hämmer |
| `mission-hold` | Schild mit Haltebalken |
| `mission-carry` | Kiste mit Griff und Bewegungspfeil nach rechts |
| `crate` | Kiste mit Diagonalverstrebung, ohne Griff oder Pfeil |
| `flag` | Freistehende Flagge |
| `hazard` | Ausrufezeichen für prozeduralen Dreieck-Badge |
| `timebomb` | Runde Bombe mit Zünder und ausgeschnittener Uhr |
| `tool` | Schraubenschlüssel |
| `check` | Häkchen |
| `cross` | Diagonales Kreuz |

`glyphs/merchant.svg` bleibt als ungenutzte Quelle erhalten und ist ausdrücklich
vom Export ausgeschlossen. Atlanten und JSON enthalten weder `merchant` noch
`delivery` oder alte Alias-IDs.

## Export und Dateien

`npm run assets:marker-glyphs` startet den
[Exporter](../../../../scripts/export-marker-glyphs.mjs) mit vorhandenem `sharp`.
SVGs werden mit 4× Quellauflösung gerendert und auf die Zielgröße reduziert.
Die zusätzliche 64er-Stufe bleibt im Speicher und liefert den SDF.

| Bild in `runtime/` | Begleitdatei | Atlasgröße |
| --- | --- | --- |
| `marker-glyphs-16.webp` | `marker-glyphs-16.json` | 100 × 80 |
| `marker-glyphs-24.webp` | `marker-glyphs-24.json` | 140 × 112 |
| `marker-glyphs-32.webp` | `marker-glyphs-32.json` | 180 × 144 |
| `marker-glyphs-sdf.webp` | `marker-glyphs-sdf.json` | 340 × 272 |

Alle WebPs sind **verlustfrei**, vier Kanäle mit 8 Bit. Raster-Alpha bedeutet
Flächendeckung; SDF-Alpha bedeutet Distanz. Sichtbares RGB ist weiß; RGB komplett
transparenter Texel darf der WebP-Encoder verwerfen. Der Export prüft nach dem
Dekodieren jede Alpha-Probe auf Bytegleichheit.

Fünf Spalten und vier Zeilen, zwei leere Zellen. Jeder quadratische Frame ist
unbeschnitten und hat **2 px Padding je Seite**, also 4 px zum Nachbarframe.
Der Quellrand bleibt im Frame. Eine feste Dateiliste entfernt die abgelösten
PNG-Atlanten und das alte gemeinsame `marker-glyphs.json`.

Prüfbogen: `art/poc/dawn/markers/glyphs-review.png`, alle 18 IDs in 16/24/32 px
auf Walnuss `#2b211b`, Gold/Blau/Violett/Rot als Randbeispiele und SDF 64 → 192 px.
Er liest die gespeicherten WebPs zurück und rekonstruiert den SDF bilinear mit
Smoothstep. Randfarben kommen aus `GOLD_1`, `BLUE_2`, `PURPLE_1`, `RED_1` in
`src/config.ts`, entsprechend `HUD_TONES`; Rot erscheint aktuell rost-orange.

## JSON und Verwendung

Jede JSON-Datei beschreibt genau das gleichnamige WebP, Schema-Version 2.
`file` ist relativ zur JSON-Datei. `size`, `width`, `height`, `padding` beschreiben
Raster und Atlas. **`frames[id] = {x,y,w,h}`** verwendet die Vertrags-ID direkt
als Key, ohne zusätzliche `frame`-Verschachtelung. Beispiel im 16er-Atlas:
`frames.boss = {"x":22,"y":2,"w":16,"h":16}`.

Koordinaten beginnen links oben und schließen Padding aus. Metadaten:
`sourceSize`, `sourceMargin`, `columns`, `rows`, `frameOrigin: "top-left"`,
`trimmed: false`. `glyphs[id]` enthält SVG-Pfad und SHA-256.
Das ist ein GPU-Frame-Rechteckformat, kein direktes Phaser-Atlas-JSON.

Anker: `(w/2,h/2)`. UVs:
`(frame.xy + localUV * frame.wh) / atlasDimensions`, `localUV` von 0 bis 1.
Texelzentren entstehen durch die Fragmentposition; Y bei abweichender
GPU-Texturorientierung konsistent wenden. Raster mit gewünschter Farbe und
Deckkraft multiplizieren, linear filtern, keine Mipmaps. Möglichst die passende
Rastergröße wählen. Ring, Scheibe, Rand und Zeiger bleiben prozedural.
Hier wird kein Runtime-Code integriert.

SDF-JSON ergänzt `channel: "alpha"`, `spread: 6`, `edge: 0.5`,
`inside: "positive"`, `decode: "(alpha - 0.5) * 12"`, `filter: "linear"`,
`mipmaps: false`. Euklidische Distanz wird je Glyphe einschließlich Padding
berechnet, mit antialiasgewichteten Randpixeln. Spread **±6 Quellpixel**;
Kodierung `alpha = clamp(0.5 + distance / 12, 0, 1)`. Kontur bei 0,5, innen
positiv, 8-Bit-Schrittweite etwa 0,047 px. Keine Premultiplikation oder
Gammatransformation auf den Alpha-Datenkanal anwenden.

```glsl
float distancePx = (texture(glyphAtlas, atlasUV).a - 0.5) * 12.0;
float aa = max(0.5 * fwidth(distancePx), 0.0001);
float alpha = smoothstep(-aa, aa, distancePx) * glyphOpacity;
outColor = vec4(glyphColor * alpha, alpha); // premultipliziertes Blend-Ziel
```

SDF kann sehr spitze Ecken minimal abrunden. Für 16 px bleibt der Rasteratlas
die direkte Lesbarkeitsreferenz. Große Outline-/Glow-Effekte brauchen zusätzliche
Quad-Fläche und sind nicht Teil dieses Formats.

## Prüfung und Reproduzierbarkeit

Exporter zweimal ausführen, SHA-256 aller acht Runtime-Dateien und des
Prüfbogens vergleichen, `git diff --check`. Feste ID-Reihenfolge, Encoder-Optionen
und JSON enthalten keine Zeitstempel. Mit identischen Quellen,
Node/sharp/libvips und Fonts sind Ausgaben bytegleich; Fonts betreffen nur den
Prüfbogen. Validiert werden Quelleninventar, ViewBox, belegte Pixel, Außenrand
und verlustfreies Alpha. Bis 8/255 Lanczos-Fringe am 4-px-Rand sind toleriert.
Browser oder Dev-Server sind nicht erforderlich.
