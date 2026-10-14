# Dawn – Night atmosphere runtime assets

Export: `node scripts/export-dawn-night.mjs` (vom Repository-Root; funktioniert auch mit anderem Arbeitsverzeichnis).

[manifest.json](manifest.json) enthält zehn Keys, Dateipfade relativ zu diesem Verzeichnis, Pixelmaße und Typen. Dateien liegen unter `runtime/`. Alle WebPs sind verlustfrei; der Export prüft die dekodierten Pixel gegen die Quelldaten. Keine Änderung an Runtime-Registries, Shadern oder `package.json` durch diesen Export.

## Assets

| Key | Maße | Typ / Verwendung |
|---|---|---|
| `dawn-night-noise-cloud-512` | 512 × 512 | tile: neue weiche, periodische Wolkendichte |
| `dawn-night-noise-smoke-512` | 512 × 512 | tile: freigegebenes `smoke-wisps-03`, unveränderte Pixel |
| `dawn-night-ember-mask-512` | 512 × 512 | tile: freigegebenes `ember-mask-02`, unveränderte Pixel |
| `dawn-night-edge-mask-1920x1080` | 1920 × 1080 | mask: `edge-vignette-02` direkt in Zielauflösung neu berechnet |
| `dawn-night-lut-identity-256x16` | 256 × 16 | lut: exakte Identität |
| `dawn-night-lut-blood-moon-256x16` | 256 × 16 | lut: rotbraune Schatten, leicht rote Mitten, kühle gedämpfte Lichter |
| `dawn-night-lut-fog-256x16` | 256 × 16 | lut: entsättigtes Schieferblau, minimaler Dunst-Schwarzpunkt |
| `dawn-night-lut-bombers-256x16` | 256 × 16 | lut: leicht entsättigt, kühle Schatten, warme Lichter |
| `dawn-night-lut-fire-256x16` | 256 × 16 | lut: rußbraune Schatten, Orange-/Ocker-Lichter |
| `dawn-night-bomber-shadow-256x128` | 256 × 128 | sprite: zweimotoriger Bomber in Draufsicht, Nase +X |

## Masken und Wolkenfeld

Die drei Tiles und die Randmaske enthalten ausschließlich gleiche R/G/B-Werte, ohne Alpha. WebP dekodiert sie als RGB; im Shader genügt `.r`. Keine Beleuchtung oder Nachtfarbe ist eingebacken. Tile-Sampling periodisch, linear gefiltert; Randmaske mit Clamp und normalisierten Bildschirmkoordinaten. Schwarz = leer, Weiß = maximale Wirkung. Die Wolkentextur ist ein kontinuierliches Dichtefeld (Werte 5–207), keine bereits freigestellte Nebelbank. Dichteschwelle, Deckkraft und Farbe bestimmt der Atmosphären-Pass. Die Nacht bleibt dadurch unabhängig von der gut sichtbaren Masken-Prüfdarstellung dunkel.

Das neue Wolkenfeld verwendet periodisches Gradientenrauschen mit fünf Oktaven (3, 6, 11, 19, 31 Zellen), unabhängigen Winkel-Seeds und zwei sanften Domain-Warp-Stufen. Es enthält weder gespiegelte Quadranten noch gestempelte Ballen. Vignette: dasselbe Feld und derselbe Seed wie `edge-vignette-02`, direkt pro Zielpixel ausgewertet; keine Skalierung der 1024er Quelle. Alle Außenpixel sind weiß, das Zentrum schwarz.

Bomber: RGB durchgehend 0; ausschließlich Alpha trägt die weich geblurrte Silhouette, Spitzenalpha 148/255. Gerade Draufsicht, zwei Motorgondeln, keine Oberflächendetails, transparente Außenränder. Alpha ist gerade/unpremultipliziert gespeichert; normale Alpha-Komposition. Zentraler Pivot (0.5, 0.5), Flugrichtung +X; spätere Effektstärke kann über globale Alpha zusätzlich reduziert werden.

## LUT-Vertrag und Farbabsicht

16³ Stützstellen als 256 × 16-PNG-artiger Streifen in verlustfreiem WebP: `pixelX = blueIndex * 16 + redIndex`, `pixelY = greenIndex`. Indizes 0…15. Grün wächst von der oberen zur unteren Bildzeile. Identität speichert exakt `(redIndex*17, greenIndex*17, blueIndex*17)`; alle 4096 Pixel werden geprüft.

Ein- und Ausgang sind **sRGB-Codewerte** in [0,1], also Display-Farben, keine linearen Lichtwerte. Im späteren Pass nicht zusätzlich gamma-dekodieren oder doppelt kodieren. Für ein bereits linear arbeitendes Rendering muss die Umrechnung um die LUT-Anwendung explizit berücksichtigt werden.

Sampling: `p = clamp(rgb,0,1)*15`, untere/obere Blau-Scheibe getrennt sampeln; pro Scheibe `uv = ((slice*16 + p.r + 0.5)/256, (p.g + 0.5)/16)`. Beide Ergebnisse mit dem gebrochenen Blauanteil mischen. Linearer Filter für Rot/Grün, Clamp, keine Mipmaps für LUTs. Halbtexel-Offsets verhindern Scheibenübersprechen. Bei vertikal gedrehtem Upload die Y-Koordinate passend umkehren. Die Prüf-Vorschauen verwenden trilineare Interpolation der **dekodierten exportierten LUT**, keine separate analytische Näherung.

Das prozedurale Grading mischt RGB mit seiner gewichteten Luminanz (0.2126/0.7152/0.0722), skaliert die Kanäle weich zwischen Schatten- und Licht-Tönung und begrenzt auf [0,1]. Blutmond bekommt eine kleine zusätzliche Rotkomponente in den Mitten. Kein globaler Exposure-Boost; die hellsten warmen Kanäle von Bomber/Brand dürfen für lokale Lichtquellen die Ausgangsintensität behalten. Schwarz bleibt RGB 0/0/0, nur Nebel startet bei 2/3/4 und lässt diese Anhebung zu helleren Werten hin auslaufen. Die spätere Modifikatorstärke kann zwischen Identity und Grade mischen.

## Reproduktion und Prüfung

- Benötigt Node und das bereits installierte `sharp`; keine neuen Abhängigkeiten. Feste Seeds, keine Uhrzeit oder Zufallszustände im Export.
- Eingaben: `art/poc/dawn/fx/smoke-wisps-03.png`, `ember-mask-02.png` und der mitgelieferte `night-scene-source.png`. Die ursprüngliche Nachtaufnahme wird bei späteren Exporten nicht mehr benötigt. Generatorcode, diese drei Dateien und die bestehende Dependency-Version reichen für die Reproduktion.
- Der Export schreibt nur dieses Asset-Verzeichnis und `art/poc/dawn/fx/`; unveränderte Bytes werden nicht neu geschrieben. README ist handgeschrieben, Manifest und Prüfausgaben werden erzeugt.
- [Prüfbogen](../../../../art/poc/dawn/fx/night-runtime-board.png): alle Tiles als echte 2×2-Wiederholung ohne kaschierende Nähte, komplette Vignette, Bomber auf Waldboden und fünf LUT-Vorschauen derselben Nachtaufnahme ohne Belichtungsanhebung. Einzelvorschauen liegen daneben.
- [Messwerte](../../../../art/poc/dawn/fx/night-runtime-validation.json): Dateihashes, verlustfreie Roundtrips, Maße, Wolken-Periodizität/-Korrelation und LUT-Schwarz/Mitten/Weiß. Identity-Vorschau ist pixelidentisch zur Aufnahme.
- Nachtaufnahme: Ausschnitt x=280, y=1060, 736 × 512 aus `C:/Fragdachse-worktrees/dawn/build/dawn/G1/board__lichtung-night.png`. Nur eine Szene, ohne Board-Beschriftungen/HUD-Banner; der Quellausschnitt wird unverändert in den Prüfausgaben aufbewahrt.
- Zweiter Exportlauf auf identische Inhalte und unveränderte Änderungszeiten geprüft. `git diff --check` geprüft. Keine Browser-/Runtime-Prüfung und kein Build: nur Offline-Assets, keine Runtime-Integration.

## Selbstbewertung Nebel

Die neue Maske wirkt als zusammenhängendes, weiches Dunstfeld; die isolierten, wiedererkennbaren T-5-Ballen und Spiegelwirkung sind entfernt. Die native 2×2-Vorschau zeigt keine Nahtlinie. Horizontale/vertikale Spiegelkorrelation liegen bei rund 0.061/0.056. Die geprüften Verschiebungen um 64/128/256 Pixel zeigen keine frühe Kopie (Korrelationsbetrag maximal 0.201). Das sind unterstützende Messwerte, kein Beweis für jede mögliche Symmetrieachse oder visuelle Abnahme.

Die volle 512-Pixel-Kachel wiederholt sich definitionsgemäß: Bei bewusstem Vergleich im statischen 2×2-Bogen sind großflächige Helligkeitsgebiete wiederzufinden. Es wäre falsch, vollständige Unsichtbarkeit dieser Grundperiode zu behaupten. Innerhalb einer Kachel gibt es keine wiederholten Ballen-Stempel; für den endgültigen Bildschirmmaßstab steht die Abnahme durch den Atmosphären-Pass noch aus.

Knowledge writeback: No durable project knowledge discovered.
