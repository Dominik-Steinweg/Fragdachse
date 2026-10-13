# Dawn UI — V1-5

Auswahl der Leit-Session vom 2026-10-13. Acht Imagegen-PNGs unverändert aus
`C:/Fragdachse-worktrees/dawn/art/poc/dawn/` kopiert. [prompts.json](prompts.json)
enthält Prompt-Kerne, gemeinsame Stilvorgaben, Quellpfade, Datum, SHA-256 und die
Auswahlgründe aus `SELECTION.md`. Die Kandidaten-READMEs dokumentieren Prompt-Kerne,
keine vollständigen Tool-Aufrufe. UI-Embleme und Dreiviertelbüste sind keine World-Sprites.

| Asset | Verwendung | Runtime-Größen |
| --- | --- | --- |
| [scrap.png](scrap.png) | Schrott-Währung / Ressourcenanzeige | 32, 64, 128 |
| [threat.png](threat.png) | Nachtbedrohung / Threat-Emblem | 32, 64, 128 |
| [dealer-expansion.png](dealer-expansion.png) | Händlerkategorie Basiserweiterung | 32, 64, 128 |
| [dealer-infrastructure.png](dealer-infrastructure.png) | Händlerkategorie Infrastruktur / Reparaturdrohne | 32, 64, 128 |
| [dealer-upgrades.png](dealer-upgrades.png) | Händlerkategorie Upgrades / Boss-Punkte | 32, 64, 128 |
| [dealer-equipment.png](dealer-equipment.png) | Händlerkategorie Ausrüstung | 32, 64, 128 |
| [recalibration-core.png](recalibration-core.png) | Rekalibrierung / erneute Auswahl | 32, 64, 128 |
| [dealer-portrait.png](dealer-portrait.png) | Händlerdialog / UI-Büste | 256 |

## Export

`npm run assets:dawn-ui` oder `node scripts/export-dawn-ui.mjs` aus dem Repository.
Das [Skript](../../../../scripts/export-dawn-ui.mjs) löst Pfade relativ zu sich selbst auf;
der Quell-Worktree wird nur für die ursprüngliche Übernahme benötigt.
Die vorhandene Sharp-Abhängigkeit genügt; keine Bildgenerierung oder Netzwerkverbindung.

SHA-256 schützt die Originale. Alpha-Bounds verwenden Alpha > 1/255, damit vereinzelte
unsichtbare Generierungsreste den Zuschnitt nicht aufblähen. Zwei Quellpixel Kantenschutz
bleiben erhalten; innerhalb des Ausschnitts werden weder Alpha noch Farben korrigiert.
Der Ausschnitt wird ohne Verzerrung mittig quadratisch aufgefüllt. Transparenter Rand:
6,25 % pro Seite (2/4/8 px bei Icons, 16 px beim Porträt), zusätzlich zum notwendigen
Ausgleich bei nicht quadratischen Motiven. Kubische Verkleinerung erhält weiche Kanten;
kein Nachschärfen, keine Farbänderung, kein Hochskalieren. WebP wird verlustfrei aus den
verkleinerten RGBA-Pixeln kodiert. Jeder Export entsteht direkt aus dem Original.

Runtime-Pfade: `/assets/ui/dawn/runtime/<asset>-<größe>.webp`.
[runtime/manifest.json](runtime/manifest.json) enthält Zuschnitte, Hashes, Maße und Bytes.
Keine Registrierung oder Integration in `src/` erfolgt durch diesen Export.
Reproduzierbarkeit gilt mit den installierten Sharp/libvips-Versionen und derselben
Schriftumgebung für die Beschriftung des Prüfbogens.

## Lesbarkeitsprüfung

[Prüfbogen](../../../../art/poc/dawn/v1-review/ui-icons.png): Icons bei 20/24/32/48 px,
Porträt bei 128/256 px, jeweils auf `#63372f` und `#f2eee5`. Der Holzton entspricht
`FOREST.wood` aus `src/ui/UiSkin.ts` (BROWN_6/GOLD_4, Faktor 0,38). Alle Größen beziehen
sich auf die gesamte quadratische Fläche einschließlich Rand. Der Bogen verwendet die
Runtime-WebPs: 32 für 20/24/32 px, 64 für 48 px, 256 für beide Porträtansichten.
Zur Beurteilung bei 100 % betrachten. Lokale Bildprüfung, keine Browser-/Spielabnahme.

| Asset | Befund auf beiden Hintergründen |
| --- | --- |
| scrap | Helles Blech und kompakte Zahnradform bei 20/24 erkennbar; Materialdetails erst ab 32. |
| threat | Runde Marke und heller Mond erkennbar; rote Klauen bei 20/24 schwach, besonders auf Holz. Keine gut lesbare Zahl innerhalb der Marke bei diesen Größen erwarten. |
| dealer-expansion | Bei 20/24 nur Ring-/Rautenform; Palisade und auswärts gerichtete Pfeile nicht zuverlässig lesbar. Mindestens 32, vorzugsweise 48 px. |
| dealer-infrastructure | Bei 20/24 zerfällt die Drohne in kleine Teile; Werkzeugfunktion kaum lesbar. Vorzugsweise 48 px. |
| dealer-upgrades | Heller Schädel als Mittelpunkt bei 24 erkennbar; Medaille und Bänder ab 32 deutlicher. |
| dealer-equipment | Kompakte Handschuhform; auf Holz bei 20/24 dunkel, Panzerplatten ab 32 deutlich. |
| recalibration-core | Cyan-Zentrum und goldene Fassung bei 20/24 unterscheidbar; Ringrotation erst ab 32 klarer. |
| dealer-portrait | Gesicht, Brille und warmer Schal bei 128 wie 256 klar; weiche freigestellte Kontur ohne sichtbaren Hintergrundsaum. |

Keine optionale `*-small`-Neugenerierung vorgenommen. Die gewählte Auswahl bleibt erhalten.
Für textlose 20–24-px-Bedienflächen sind insbesondere Expansion/Infrastruktur noch keine
uneingeschränkt lesbaren Symbole. Die Büste bleibt wie beauftragt unverändert: Der Wunsch
aus `SELECTION.md`, sie an Konzept 02 mit Mütze und rotem Halstuch anzugleichen, ist mit
diesem Export nicht umgesetzt (vorhanden: keine Mütze, orangefarbenes Halstuch).

## Vollständige Dateiliste dieses Auftrags

```text
package.json (npm-Script ergänzt)
scripts/export-dawn-ui.mjs
public/assets/ui/dawn/README.md
public/assets/ui/dawn/prompts.json
public/assets/ui/dawn/scrap.png
public/assets/ui/dawn/threat.png
public/assets/ui/dawn/dealer-expansion.png
public/assets/ui/dawn/dealer-infrastructure.png
public/assets/ui/dawn/dealer-upgrades.png
public/assets/ui/dawn/dealer-equipment.png
public/assets/ui/dawn/recalibration-core.png
public/assets/ui/dawn/dealer-portrait.png
public/assets/ui/dawn/runtime/manifest.json
public/assets/ui/dawn/runtime/scrap-32.webp
public/assets/ui/dawn/runtime/scrap-64.webp
public/assets/ui/dawn/runtime/scrap-128.webp
public/assets/ui/dawn/runtime/threat-32.webp
public/assets/ui/dawn/runtime/threat-64.webp
public/assets/ui/dawn/runtime/threat-128.webp
public/assets/ui/dawn/runtime/dealer-expansion-32.webp
public/assets/ui/dawn/runtime/dealer-expansion-64.webp
public/assets/ui/dawn/runtime/dealer-expansion-128.webp
public/assets/ui/dawn/runtime/dealer-infrastructure-32.webp
public/assets/ui/dawn/runtime/dealer-infrastructure-64.webp
public/assets/ui/dawn/runtime/dealer-infrastructure-128.webp
public/assets/ui/dawn/runtime/dealer-upgrades-32.webp
public/assets/ui/dawn/runtime/dealer-upgrades-64.webp
public/assets/ui/dawn/runtime/dealer-upgrades-128.webp
public/assets/ui/dawn/runtime/dealer-equipment-32.webp
public/assets/ui/dawn/runtime/dealer-equipment-64.webp
public/assets/ui/dawn/runtime/dealer-equipment-128.webp
public/assets/ui/dawn/runtime/recalibration-core-32.webp
public/assets/ui/dawn/runtime/recalibration-core-64.webp
public/assets/ui/dawn/runtime/recalibration-core-128.webp
public/assets/ui/dawn/runtime/dealer-portrait-256.webp
art/poc/dawn/v1-review/ui-icons.png
```

`art/poc/` ist repositoryweit Git-ignoriert. Der lokale Prüfbogen wird bei jedem Export
neu erzeugt und gehört zur Lieferung im Worktree; keine Ignore-Regeln wurden geändert.
