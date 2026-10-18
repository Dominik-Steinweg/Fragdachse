# Void-Felsmoos: Quellbilder mit Leuchtmasken

Stand: 2026-10-18, Phase G2 der Void-Botanik. 13 Teile: Das Moosnest 01 entstand über Argon, die übrigen zwölf vollautomatisch über ComfyUI (siehe unten). Eingebunden über `scripts/export-void-flora.mjs`.

Moos und Flechte auf Fels, vom Void übernommen. Das Polstermoos ist schwärzlich violett-pflaumig, durchzogen von violetten myzelartigen Fäden. Die Sporenkapseln erscheinen von oben als kleine unregelmäßige Punkte. Bei der Flechte sind es violette Fruchtkörper. Die Farbe ist dunkel gesättigt und matt, damit das Moos mit dem Fels beleuchtet wird und nicht aufgeklebt wirkt. Das Leuchten entsteht über die Lichtkarte aus der Maske.

Gleiches Verfahren und gleiches Skript wie bei den Seerosen: [`../../pond-ecology-v8/void/void_flora.py`](../../pond-ecology-v8/void/void_flora.py). Freistellung, Maskenregeln, Prompt-Stilblöcke und Begründungen stehen in [`../../pond-ecology-v8/void/README.md`](../../pond-ecology-v8/void/README.md). Entscheidungen je Kandidat stehen in `selection.json`.

## Dateien

| Frame | Rolle |
|---|---|
| `void-moss-nest-01.png` | nierenförmiges Polster mit Mulde, Fäden und Sporenkapseln, zwei tote Halme |
| `void-moss-nest-02..04.png` | Silhouetten von `moss-nest-02`, `-04`, `-05`; dunkles Polster, Fäden und Sporenkapseln |
| `void-moss-strip-01..03.png` | Silhouetten von `moss-strip-01`, `-02` und gespiegelt `-01`; 02 ist an einem Ende dichter befallen |
| `void-lichen-02..04.png` | Lappenstruktur von `lichen-06`, `-07` und gedreht `-06`; dunkle Kruste mit dünnen Fäden |
| `void-edge-overhang-01..03.png` | Silhouetten von `edge-overhang-02`, `-04`, `-05`; dunkler Efeu mit violetten Blattadern und Moosanker |

Zu jedem Frame gehört `<frame>-emissive.png`: eine 8-Bit-Graustufenmaske auf derselben Leinwand. Außerhalb der Farb-Alpha ist sie 0 und an der Silhouette 3 px erodiert.

## Nachlieferung über ComfyUI

Die zwölf Teile außer Nest 01 entstanden am 2026-10-18 über den Skill `comfy` mit lokalem ComfyUI (Qwen-Image 2.1 int8, 25 Schritte, drei Seeds je Teil). Den Prompt jedes Frames enthält `<frame>.prompt.txt`, Modell und Seed stehen in `selection.json` unter `generator`. Die Rohbilder liegen lokal unter `build/void-comfy/` (gitignoriert).

- **Bild 1** ist die natürliche v8-Quelle derselben Familie, flach auf `#00FF00`. Der Prompt verlangt, Umriss, Lücken und Kanten exakt zu behalten. So passt jedes Void-Teil zur Silhouette seiner natürlichen Familie.
- **Bild 2** ist ein Materialausschnitt aus `void-moss-nest-01` ohne Umriss. Mit dem ganzen Nest als Bild 2 übernahm das Modell bei gleich großen Bildern dessen Nierenform (Nester 03/04 im ersten Lauf, verworfen).
- **Pflichtsatz gegen Umfärben:** „do not tint the whole plant violet … nearly black … violet ONLY as thin broken threads and tiny irregular dots“. Ohne ihn färbt das Modell die Pflanze gleichmäßig violett.

## Leinwand je Familie

| Familie | Füllung der Alpha-BBox | Leinwand | Bezug im Exporter |
|---|---|---|---|
| Nest | 73 % | fest 1768:1178 (3:2) wie `moss-nest-01/04` | `preserveCanvas`, `minWorld 28` / `maxWorld 64` |
| Überhang | 82 % | Seitenverhältnis der BBox (≈ 2,1–2,9:1) | `preserveCanvas`, `80`/`120` |
| Streifen, Flechte | 82 % / 77 % | BBox | Trim-Pfad (`trim threshold 4`, `contain` in 256²) |

## Hinweise für die Integration (G2)

- **Präfix:** `void-` ist Pflicht. `colonyName()` in `scripts/lib/rock-ecology-v8-export.mjs` prüft `^(edge-overhang|…|lichen)-`, `void-…` fällt nicht hinein. Neue Void-Rezepte brauchen deshalb ihre eigene Regel für `surfaceFinish`. Frame-Namen sind immer `void-` plus der natürliche Familienname, also `void-edge-overhang-NN` (Rohbild `void_overhang_NN`), `void-moss-strip-NN` und `void-lichen-NN`.
- **Deckungsgleichheit:** Die Maske muss dieselben geometrischen Schritte durchlaufen wie die Farbe. Für `preserveCanvas` heißt das nur Resize. Im Trim-Pfad muss die Trim-Box aus der **Farb-Alpha** bestimmt und auf die Maske angewendet werden. Ein eigener Trim der Maske würde verrutschen. Den Weichzeichner aus `surfaceFinish` (σ 1,2) auch auf die Maske anwenden, die Farbmodulation nicht.
- **Kontaktsilhouette:** `exportRockContact` arbeitet nur auf der Alpha und braucht keine Maske.

## Prompts

Der Stilblock ist derselbe wie bei den Seerosen; siehe das Pond-README.

- `void_moss_nest_01` (Pilot, 3:2): A small, low, dense moss cushion growing on a rock surface (the rock itself is NOT shown), irregular kidney-shaped footprint with a shallow depressed centre and feathered real moss tips at the edge. The whole cushion is converted: blackish violet-plum moss felt with real moss texture (tiny leaflets and shoots), fine threads of saturated violet woven through it like mycelium, and scattered tiny moss spore capsules (seen from directly above as small round dots) in bright lilac-violet #d98cff. Two thin dead dark grass blades. Flat and embedded-looking, not a raised ball.
- `void_lichen_01` (Pilot, 1:1, **verworfen**): A flat crustose lichen colony as it grows on rock (the rock itself is NOT shown), irregular rounded and frayed outline, broken into many small eroded flecks toward the edges with plenty of gaps where the green background shows through. Dark slate-plum and grey-violet crust (#3a3240 to #4d4256), very flat with no relief, dotted with small round lichen fruiting discs (apothecia) in saturated violet #b347ff, a few with brighter lilac cores #d98cff, clustered unevenly. No white or chalky parts. → Ergebnis mit Konturlinien und großen Kreisscheiben, zu illustrativ und zu laut.

Offene Serienmotive (Nummern 13–24 des Serien-Briefings):

- `void_moss_nest_02` (3:2): Small low dark moss nest of three unequal closely merged lobes, soft fine organic edge, real dense cushion-moss texture in blackish violet-plum, fine violet threads partly hidden under the moss shoots, scattered tiny moss spore capsules (seen from above as small irregular dots) in lilac-violet; one off-centre dead grass sprig. Flat and embedded-looking, not a ball.
- `void_moss_nest_03` (3:2): Small dark flattened moss nest following a gentle S bend, broad low lobes and a finer tapered end, blackish plum cushion moss with a few surviving very dark green tips, sparse violet threads and tiny spore capsules concentrated in one lobe.
- `void_moss_nest_04` (3:2): Small low broad triangular moss nest with rounded unequal corners and ragged soft edges, blackish violet cushion moss, shallow dark creases, violet threads following the creases, a scatter of tiny spore capsules, two short dead grass blades.
- `void_moss_strip_01` (21:9): Thin ragged dark moss felt strip for a rock edge, long horizontal footprint about 4:1 with a slight arc, blackish plum moss, a few violet threads running along it and sparse tiny spore capsules. Only moss, no leaves.
- `void_moss_strip_02` (21:9): Dark moss edging strip about 4:1, broken asymmetric contour, denser at one end where the infection is strongest (violet threads, spore capsules), thinning out and still very dark green at the other end.
- `void_moss_strip_03` (21:9): Long low moss felt strip about 4:1 with a subtle S curve, two connected knots and sparse fine tendrils, blackish violet, sparse violet threads.
- `void_lichen_02` (1:1): Very flat crustose lichen colony like a stain on rock, uneven rounded footprint dissolving into many tiny eroded flecks toward the edge with plenty of gaps where the background shows through. Dark slate-plum and grey-violet crust, no relief, no outlines, a few small irregular violet fruiting discs and many tiny violet specks, unevenly clustered.
- `void_lichen_03` (1:1): Flat lichen colony of two merging irregular patches, eroded jagged tiny edges, many real gaps, dark grey-violet and plum crust, thin violet infection threads in the crust, tiny violet specks concentrated where the two patches meet.
- `void_lichen_04` (1:1): Very understated flat dark grey-plum lichen patch with fine branching rounded edges and transparent openings, sparse tiny violet specks, the quietest lichen variant.
- `void_overhang_01` (21:9): Wide moss and creeping-vine overhang draping over a rock edge, seen from directly above: an irregular dense moss anchor along the upper side, and on the lower side 3 to 4 unequal trails of small ivy-like leaves spreading downward with open gaps. Leaves blackish plum with thin violet veins, sparse spore capsules in the moss anchor. Bent irregular footprint, never a straight band; plant only, no rock.
- `void_overhang_02` (21:9): Wide creeping-vine overhang, dense off-centre moss anchor upper-left, lower side ragged with branching leafy tendrils of unequal length; dark plum leaves with violet veins, some leaves still very dark green.
- `void_overhang_03` (21:9): Wide moss-felt overhang mixed with tiny creeping leaves, crooked thick upper anchor and a loosely branching leafy lower fringe with a deep offset gap; blackish violet moss with violet threads, leaves plum with thin violet veins.
