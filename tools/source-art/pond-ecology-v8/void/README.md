# Void-Seerosen: Quellbilder mit Leuchtmasken

Stand: 2026-10-18, Phase G2 der Void-Botanik (Plan „Nachtsicht, Mondlicht und Void-Botanik“). Blätter und Gruppen 01–03 entstanden halbautomatisch über den Skill `argon` mit Antigravity (Gemini), die Gruppen 04–06 vollautomatisch über ComfyUI (siehe unten). Antigravity liefert JPG mit 1024² Pixeln ohne Alphakanal. Deshalb wurde vor flachem Chroma-Key `#00FF00` generiert und offline freigestellt. Eingebunden über `scripts/export-void-flora.mjs`.

Seerosen, die vom Void übernommen wurden: dunkles Pflaumen-/Aubergine-Gewebe, Reste von dunklem Flaschengrün, violette Adern entlang der echten Blattadern und unregelmäßige Sporenpunkte (`VOID_PALETTE`: deep `#6f16a8`, primary `#b347ff`, bright `#d98cff`). Die Farbtextur ist matt und leuchtet selbst nicht. Tagsüber liest sie sich als violett verfärbt und fremdartig. Das nächtliche Leuchten entsteht im Spiel über die Lichtkarte, gesteuert durch die Maske.

## Dateien

| Frame | Rolle |
|---|---|
| `void-lily-pad-02.png` | fast vollständig befallen, feines radiales Adernetz |
| `void-lily-pad-04.png` | Frühbefall, viel dunkles Grün-Teal, schmale Schlitzkerbe |
| `void-lily-pad-05.png` | altes, zerfressenes Blatt mit Löchern |
| `void-lily-pad-06.png` | ungleiches Zweierpaar (Gegenstück zu `lily-pad-03`) |
| `void-lily-pad-07.png` | dunkelste, leiseste Variante, Sporen nur an der Kerbe |
| `void-lily-pad-08.png` | großes Blatt, Pflaume/Teal gebändert, dünne Adern |
| `void-lily-group-01.png` | vier Blätter mit Befallsgradient und violetter Knospe |
| `void-lily-group-02.png` | vier dicht gelagerte, teilweise befallene Blätter |
| `void-lily-group-03.png` | Mittelblatt voll befallen, Ausbreitung auf Nachbarn, zwei Knospen |
| `void-lily-group-04.png` | fünf Blätter, Befallsgradient mit Teal-Blättern am einen Ende (Frühbefall-Stufe) |
| `void-lily-group-05.png` | Bogen aus zwei großen und zwei kleinen Blättern, halb geöffnete dunkle Void-Blüte |
| `void-lily-group-06.png` | Void-Fassung der natürlichen Dreiergruppe `lily-group-02` |

Zu jedem Frame gehört `<frame>-emissive.png`: eine 8-Bit-Graustufenmaske (L) auf exakt derselben Leinwand. 0 bedeutet kein Eigenleuchten, 255 volles Leuchten der Adern und Sporenpunkte. Außerhalb der Farb-Alpha ist die Maske überall 0. Sie ist 3 px von der Silhouette nach innen erodiert, damit die Blattkante nie als Leuchtkontur erscheint.

`selection.json` hält für jeden Kandidaten Rohdatei, SHA-256 der Rohdatei, Entscheidung und Begründung fest. Die Rohbilder liegen nur lokal unter `build/void-flora/raw/` (gitignoriert) und im Antigravity-Verlauf.

Die Nummern sind Kandidatennummern und bewusst nicht durchgezählt, wie bei den v8-Quellen (`moss-nest-01/02/04/05`).

## Nachlieferung über ComfyUI (Gruppen 04–06)

Die Gruppen 04–06 entstanden am 2026-10-18 vollautomatisch über den Skill `comfy` mit lokalem ComfyUI (Qwen-Image 2.1 int8, 25 Schritte). Der Prompt jedes Frames liegt als `<frame>.prompt.txt` neben der Quelle. `selection.json` nennt in `generator` Modell und Seed. Freistellung und Maske laufen unverändert über `void_flora.py`. Die Rohbilder liegen nur lokal unter `build/void-comfy/` (gitignoriert).

Verfahren:

- **Gruppen 05 und 06:** Bild 1 legt das Layout fest, nämlich ein aus natürlichen Blättern gelegtes Layout (05) bzw. die natürliche Gruppe `lily-group-02` (06). Bild 2 ist nur ein Materialausschnitt aus `void-lily-pad-02` ohne Umriss, damit das Modell keine Form übernimmt.
- **Gruppe 04:** einziges Bild ist `void-lily-group-03` als Materialreferenz, verbunden mit der Anweisung, ein neues Layout zu erfinden. Nur einer von drei Seeds hielt sich daran. Ein erster Lauf mit diesem Verfahren für 05 und 06 lieferte fast nur Kopien von Gruppe 03 und wurde verworfen.
- **Pflichtsatz gegen Umfärben:** „do not tint the pads uniformly violet … violet appears only as thin broken veins … and tiny irregular spore points“. Ohne ihn färbt das Modell die ganze Pflanze gleichmäßig violett.
- Hintergrund `#00FF00` wie bei Argon. Magenta, der Standard des Skills, liegt zu nah am Void-Violett.

## Verarbeitung (`void_flora.py`)

1. **Freistellen:** Die Alpha ergibt sich aus der Grün-Dominanz `G − max(R, B)` gegen den am Rand gemessenen Key. Die Farbe wird gegen den Key dekontaminiert und die Randpixel entspillt.
2. **Highlights dämpfen:** Helle, nicht violette Sprenkel wie cremefarbene Fraßränder oder JPEG-Glanz werden auf einen Spitzenwert von 118 gedämpft. Violettes Gewebe bleibt unverändert.
3. **Leinwand normalisieren:** Das Bild wird auf die Pflanze zugeschnitten und so aufgefüllt, dass die Alpha-Bounding-Box 71 % (Blatt) bzw. 72 % (Gruppe) der Leinwand belegt. Das entspricht den v8-Quellen (`lily-pad-01`: 71 %), sodass Void- und Naturblätter bei gleicher `size` gleich groß wirken.
4. **Maske ableiten:** Die Maske wird aus der gespeicherten 8-Bit-PNG abgeleitet, nicht separat generiert. Grundlage ist ein violetter Farbton-Gate mit Chroma `B − G`. Die Schwellen passen sich am 99,6-%-Perzentil des Bildes an. Ein Hochpass gegen die lokale Umgebung lässt breite Prellungsflecken dunkel, nur dünne Adern und Punkte leuchten. Erodiert und mit Alpha multipliziert.

Masken lassen sich bitgenau aus dem Repo neu erzeugen, ohne Rohbilder:

```bash
python -I tools/source-art/pond-ecology-v8/void/void_flora.py --mask-only tools/source-art/pond-ecology-v8/void/void-lily-pad-02.png
```

Alle Masken wurden mit `--gain 1` erzeugt. Python 3.13 mit pillow und numpy (`FD_ASSET_PYTHON`).

## Hinweise für die Integration (G2)

- **Präfix:** `void-` ist Pflicht. `PondEcologyField` filtert natürliche Familien mit `startsWith('lily-pad' | 'lily-group')`. `void-lily-…` fällt nicht hinein, die natürliche Liste bleibt unverändert.
- **Exporter:** `scripts/export-woodland-ecology-v8.mjs` passt die ganze Leinwand per `contain` auf 248² ein (lanczos3) und erweitert sie um 4 px. Für den Begleitatlas `-emissive` muss die Maske genau dieselbe Operation durchlaufen: gleiche Leinwand, Hintergrund schwarz bzw. transparent, 4 px Rand. Dann bleibt sie deckungsgleich.
- **Alpha:** Die Farbquellen tragen eine authored Alpha (`hasAlpha` ist erfüllt), die RGB-Werte sind dort, wo Alpha 0 ist, ebenfalls 0.
- **Leuchten:** Die Maske ist für die Lichtkarte bzw. den Glow-Owner gedacht und nicht für additive Sprites.

## Auswahl und Verworfenes

| Kandidat | Entscheidung | Grund |
|---|---|---|
| `void_lily_pad_01` (Pilot) | verworfen | breite „Tortenstück“-Kerbe, illustrativer Look; die Serie ist realistischer |
| `void_lily_pad_03` | verworfen | harte, gerade Halbteilung grün/violett wirkt künstlich |
| `void_lily_pad_07` | angenommen | Rohbild hatte dunkelgrünen statt reinen Key (`#0b8c2d`), die Freistellung ist trotzdem sauber |
| `void_lily_group_01` (Pilot) | angenommen | trotz leicht illustrativer Kerben der klarste Befallsgradient der Gruppen |

Die übrigen Begründungen stehen in `selection.json`. Die Zwischenauswahl (6 Blätter, Gruppen 01–03) hat der User am 2026-10-18 anhand des Kontaktblatts abgenommen.

## Prompts

Die Bilder entstanden in einer Antigravity-Unterhaltung: erst ein Pilot mit 4 Bildern, dann eine Serie mit 24 Bildnamen. Der Agent übernimmt den Stilblock wörtlich in jeden Bildprompt und hängt das jeweilige Motiv an.

### Serie: gemeinsamer Stil (pad 02–08, group 02–06, Moos-Serie)

Korrekturen gegenüber dem Pilot, im Briefing vorangestellt: realistischer wie ein eingescanntes botanisches Präparat, keine Umrisslinien, dünne unterbrochene Adern statt Blitzen, unregelmäßige Sporenpunkte statt Perlen, schmale V-Kerbe. Bestehende Assets (`lily-group-01`, `moss-nest-01`, `edge-overhang-02`) waren nur als Maßstab für Realismus und Malqualität angehängt.

```text
Production source sprite for a serious, grounded top-down forest game. EXACT ORTHOGRAPHIC 90-DEGREE OVERHEAD VIEW: camera looks straight down, the plant lies flat on the image plane, no perspective, no tilt, no side view, no visible thickness.
Realistic natural plant material rendered like a high-resolution scanned botanical specimen or macro photograph, only lightly painterly; fine natural tissue texture everywhere, subtle decay spots. The plant has been slowly taken over by an alien force ("the Void"), like a parasitic infection spreading through its own vascular tissue. Natural, eerie and quiet, never kitsch.
COLOUR: dark saturated base material, mostly blackish aubergine and deep plum (around #2a1630, #3b1d45, #4a2556), dull bruised violet mottling, a few surviving patches of very dark bottle-green or teal (#1f3a30) where the infection has not arrived yet. The infection shows as thin, irregular, naturally branching veins that follow the plant's real vein structure, partly broken and fading, slightly diffused into the tissue like soaked-in pigment, in saturated violet #b347ff with deep violet #6f16a8 transitions, plus sparse irregular spore points (mostly tiny, a few small, unevenly clustered, never perfect circles) in brighter lilac-violet #d98cff. Veins and points cover only about 5 to 12 percent of the plant; most of the surface stays dark. In daylight the plant must clearly read as violet-discoloured and alien.
LIGHT: flat diffuse ambient light only. NO directional light, NO cast shadow, NO glow, NO bloom, NO halo, NO light spilling onto the surroundings. The violet is matte pigment inside the tissue, like a bruise or a dye, not a light source. No specular highlights, no wet gloss.
AVOID: dark outlines or contour lines, illustration or vector look, cel shading, neon or sci-fi circuit patterns, lightning-like veins, beads or bubbles, fantasy sparkle, airbrush gradients, plastic look, perfect symmetry, cheerful or cartoon style, generic AI-art look, micro-detail noise.
BACKGROUND: the whole canvas outside the plant is ONE completely flat, uniform pure chroma-key green #00FF00, no gradient, no shadow, no vignette, no texture, no water, no ground, no rock. The plant itself contains no bright green. Soft natural plant edges with no halo or fringe.
COMPOSITION: single isolated subject, centred, entirely inside the central 70 percent of the canvas, at least 15 percent empty green margin on all four sides, nothing clipped.
No text, no watermark, no frame, no labels.
```

Motive (alle 1:1):

- `void_lily_pad_02`: One single round floating water-lily pad with a narrow deep V notch, almost fully converted: blackish plum tissue with a fine dense violet vein net radiating from the centre, a small cluster of tiny spore points around the stem point.
- `void_lily_pad_03`: One single round lily pad, half infected: violet veins invade from the centre into one half of the leaf; the other half is still very dark bottle-green; between them a bruised plum stain. Narrow deep V notch.
- `void_lily_pad_04`: One small youthful oval lily pad, early infection: mostly very dark green-teal with a plum stain at the centre and only a few short violet veins starting from it. Narrow notch, natural asymmetry.
- `void_lily_pad_05`: One old decaying lily pad, ragged torn rim with two small holes, fully converted, darker and more brownish plum, sparse violet veins with a crust of tiny spore points along the main veins.
- `void_lily_pad_06`: Two small floating lily pads, one half the size of the other, airy separation, both dark plum with thin violet veins; the larger one has a few spore points near its centre.
- `void_lily_pad_07`: One medium lily pad, dark plum with irregular bruised violet blotches and a sparse thin vein net, a small bite missing from the rim, tiny spore points gathered along the notch.
- `void_lily_pad_08`: One large round lily pad with very subtle infection: deep plum and dark teal mottling, the violet veins visible only faintly and thinly, a few isolated tiny spore points – the quietest variant.
- `void_lily_group_02`: Three rounded lily pads in an open triangular loose group, little overlap, no flowers, all partially infected with violet veins spreading from their centres.
- `void_lily_group_03`: Five lily pads of very unequal size in a dense but asymmetric cluster; the middle pad is fully converted and the infection visibly spreads outward to its neighbours; one small closed bud turned blackish violet.
- `void_lily_group_04` *(nicht über Argon erzeugt, Motiv für ComfyUI übernommen)*: Two large and two small lily pads in a loose diagonal chain, an infection gradient along the chain: one end still very dark green, the other end fully plum with a dense violet vein net.
- `void_lily_group_05` *(nicht über Argon erzeugt, Motiv für ComfyUI übernommen)*: Four lily pads, one of them decayed and ragged, plus one half-open void lily flower seen from directly above with narrow dark aubergine petals and a violet heart; no pink, no white, no glow.
- `void_lily_group_06` *(nicht über Argon erzeugt; ComfyUI nutzt die natürliche Dreiergruppe)*: Three overlapping lily pads in a tight cluster plus two tiny young pads nearby, mostly converted, thin veins and sparse spore points.

### Pilot: gemeinsamer Stil (pad 01, group 01, Moos-Pilot)

Wie der Serienblock, jedoch ohne die Realismus- und Anti-Kontur-Zusätze. Stattdessen stand dort: „Painterly-realistic natural plant material …“. Adern „fine, naturally branching“, Rand mindestens 12 %, AVOID ohne „dark outlines“, „lightning-like veins“ und „beads“.

- `void_lily_pad_01`: One single round floating water-lily pad with a characteristic deep V notch, taken over by the Void. Blackish-plum leaf tissue; violet infection veins radiate from the leaf centre along the natural radial veins, densest around the centre and along the notch, thinning out toward the rim; a few tiny violet spore pustules near the centre. One section of the rim is still very dark bottle-green, a short stretch of the edge is slightly decayed and darkened.
- `void_lily_group_01`: A loose asymmetric group of four floating water-lily pads of clearly unequal size, little overlap, airy gaps between them, at different stages of infection: one almost completely converted (dark plum with a dense violet vein network), two partially infected (violet veins creeping in from the leaf centres, the rest still dark bottle-green and plum), one still mostly dark green with only a first small violet stain. Instead of a flower: one small closed bud that has turned blackish violet, with a slightly brighter violet tip.
