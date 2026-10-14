# From Dachs Till Dawn – Bildsprache V1

Stand: 2026-10-14, Leit-Session. Grundlage: Stil-Exploration S-1 (`art/poc/dawn/style/`, lokal),
User-Vorgabe: „nicht so fröhlich und comicartig, klar abgehoben vom typischen KI-Bild".
Gilt für alle neu generierten Dawn-Bilder (Icons, Porträts, Key Art, Embleme, Texturen, Decals).
Spielgrafik in 90°-Draufsicht folgt weiterhin `docs/ai/visual-guidelines.md`; diese Seite regelt die Bildsprache.

## Leitidee: „verwitterter Waldkrieg"
Dachse verteidigen nachts ihre Basis im dunklen Wald und bergen tagsüber Schrott. Alles wirkt benutzt, geflickt,
ernst und handgemacht – nicht niedlich, nicht glänzend, nicht heroisch überhöht.

## Zwei Register
| Register | Wofür | Stil |
|---|---|---|
| **Druck** | 2D-Kunst: Icons, Embleme, Porträts, Key Art, Modus-Kachel, Ergebnis-/Ankündigungsbilder | **Holz-/Linolschnitt**: kräftig geschnittene Flächen, sichtbare Schnittkanten und Maserung im Druck, 2–3 Farbtöne plus Papier/Grund |
| **Material** | Welt: Material-Texturen der Props, Boden-Decals, Effekt-Texturen | **Dunkler Malrealismus**: geerdet, matt, ehrliche Abnutzung, gleichmäßig ausgeleuchtet (Albedo-artig), keine Drucklinien |

Das Druck-Register ist diegetisch gedacht: Es sind die gedruckten Tafeln, Stempel und Aushänge der Dachse.

## Palette
- Grund: Holzkohle `#1b1a17`, Ruß-Braun `#2a241d`.
- Druckfarbe/Papier: Knochen `#d9cfb6`, vergilbtes Papier `#c8b98f`.
- Erdtöne: Umbra `#5a4632`, Moos `#4d5a36`, Schiefer `#4a5157`, Rost `#8a4a2b`.
- Akzente (höchstens EINER pro Bild, nur mit Grund): Lampen-Orange `#d9822b` (Spielerfraktion, Licht), Kalt-Cyan `#5fb3b0` (seltene Technik), kränkliches Violett `#7a4a7f` (Feinde), Halstuch-Rot `#8f2f24` (Händler).
- Niedrige Sättigung insgesamt; kein Bonbon-Bunt, kein Teal-Orange-Klischee.

## Licht und Form
- Eine erkennbare Lichtquelle, tiefe Schatten; kein Rundum-Rim-Light, kein Bloom, keine Lichtstrahlen ohne Grund.
- Formen schwer, funktional, asymmetrisch, leicht grob; Kanten über Wert bzw. Schnitt, keine schwarzen Comic-Outlines.
- Gesichter ernst, misstrauisch, müde – keine Kulleraugen, kein Lächeln für die Kamera.

## Ausdrücklich verboten (typische KI-Merkmale)
Glatte Airbrush-Verläufe, Plastikglanz und Glanzpunkte, zentrierte Spiegelsymmetrie, Rauschen aus Mikrodetails,
Leuchten überall, perfekt saubere Kanten, weiche Vignetten-Hintergründe, dramatisches „Öl-Porträt in Rembrandt-Licht"
als Standardlösung, Schrift/Logos/Wasserzeichen.

## Lesbarkeit
- Icons: Silhouette zuerst, bei 24 px eindeutig; Druckstruktur darf bei 24 px verschwinden, die Form nicht.
- Elite-/Status-Glyphen: Form unterscheidet ohne Farbe.
- Texturen: grobe, bei 24–96 px lesbare Materialstruktur statt Mikrodetail; nahtlos kachelbar.

## Prompt-Kerne (für Astra-Briefings)
- **Druck:** „hand-carved woodcut / linocut print, bold carved shapes, visible gouge marks and wood grain in the ink,
  2–3 ink colours on bone paper over charcoal, limited palette, grim folklore field-manual plate, asymmetric,
  no gradients, no gloss, no glow, no text".
- **Material:** „seamless tileable top-down material, evenly diffuse lit, grounded dark painterly realism, matte,
  honest wear (chipped paint, rust bleed, grime, soot), muted earthy palette, no perspective, no highlights, no text".

## Abnahme-Checkliste (Leit-Session)
1. Würde man es für ein typisches KI-Bild halten? Dann neu.
2. Höchstens ein Akzent, Palette gedämpft?
3. Bei Zielgröße lesbar (Icons 24/48 px, Texturen 64 px, Decals 1×)?
4. Passt es neben die Holz/Efeu-HUD-Rahmen bzw. auf den dunklen Waldboden bei Tag und Nacht?
