# Dawn UI — V1-5 / V1-6

Auswahl der Leit-Session vom 2026-10-13. Acht Imagegen-PNGs unverändert aus
`C:/Fragdachse-worktrees/dawn/art/poc/dawn/` kopiert. [prompts.json](prompts.json)
enthält Prompt-Kerne, gemeinsame Stilvorgaben, Quellpfade, Datum, SHA-256 und die
Auswahlgründe aus `SELECTION.md`. Die Kandidaten-READMEs dokumentieren Prompt-Kerne,
keine vollständigen Tool-Aufrufe. UI-Embleme und Dreiviertelbüste sind keine World-Sprites.

| Asset | Verwendung | Runtime-Größen |
| --- | --- | --- |
| [scrap.png](scrap.png) | Schrott-Währung / Ressourcenanzeige | 32, 64, 128 |
| [scrap-magnet.png](scrap-magnet.png) | Infrastruktur-Angebot Schrottmagnet | 32, 64, 128 |
| [threat.png](threat.png) | Nachtbedrohung / Threat-Emblem | 32, 64, 128 |
| [dealer-expansion.png](dealer-expansion.png) | Händlerkategorie Basiserweiterung | 32, 64, 128 |
| [dealer-infrastructure.png](dealer-infrastructure.png) | Händlerkategorie Infrastruktur / Reparaturdrohne | 32, 64, 128 |
| [dealer-upgrades.png](dealer-upgrades.png) | Händlerkategorie Upgrades / Boss-Punkte | 32, 64, 128 |
| [dealer-equipment.png](dealer-equipment.png) | Händlerkategorie Ausrüstung | 32, 64, 128 |
| [recalibration-core.png](recalibration-core.png) | Rekalibrierung / erneute Auswahl | 32, 64, 128 |
| [dealer-portrait.png](dealer-portrait.png) | Händlerdialog / UI-Büste | 256 |

## Export

V1-6 ergänzt vier mit dem integrierten Imagegen erzeugte Schrottmagnet-Kandidaten:
`art/poc/dawn/icons/candidates/icon-scrap-magnet-01.png` bis `-04.png` im aktuellen
Worktree `dawn-assets`. Kandidat **02** wurde unverändert als `scrap-magnet.png`
übernommen. Seine aufrechte Hufeisenform, der offene Innenraum und die hellen Stahlpole
sind bei 32/48 px am klarsten; abgenutzter Lack, Stahl, Messing und Rost passen zu
`scrap` und `dealer-infrastructure`. Die diagonalen Varianten 01/04 verteilen die
Schrottteile stärker, die Kranvariante 03 verliert klein ihre eindeutige Magnetform.
Bei 24 px bleiben einzelne Schrottteile nur eingeschränkt lesbar.

Die vollständigen vier Tool-Prompts stehen im Asset-Eintrag von [prompts.json](prompts.json)
und lokal in `art/poc/dawn/icons/candidates/scrap-magnet-prompts.json`.
Der Eintrag überschreibt für dieses neue Asset den historischen `sourceWorktree`.
Der zusätzliche [Lesbarkeitsbogen](../../../../art/poc/dawn/v1-review/ui-scrap-magnet.png)
zeigt alle vier Kandidaten sowie die gewählten Runtime-Exporte bei 24/32/48 px auf
dunklem HUD-Ton `#24282b`, ergänzt durch 72-px-Detailansichten. Alle Anzeigegrößen
enthalten den transparenten Rand. Der Export erzeugt diesen Bogen erneut, sofern die
vier lokalen Kandidaten vorhanden sind; sie sind wie der restliche `art/poc/`-Ordner
Git-ignoriert. Die Runtime-Exporte benötigen diese Kandidaten nicht.

V1-6-Dateien: `scrap-magnet.png`, `runtime/scrap-magnet-{32,64,128}.webp`,
`runtime/manifest.json`, `prompts.json`, diese README und
`scripts/export-dawn-ui.mjs`; lokal die vier Kandidaten, deren Prompt-JSON und beide
Prüfbögen (`ui-icons.png`, `ui-scrap-magnet.png`).

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

## V1-7: Elite-Affixe, Nacht-Modifikatoren und Schrottscanner

29 neue Einzelbilder mit dem integrierten Imagegen erzeugt; Panzer-Kandidat 01 aus
dem abgebrochenen Vorlauf wiederverwendet. Je drei Kandidaten pro Icon, insgesamt 30.
Alle zehn gew?hlten PNG-Originale wurden unver?ndert kopiert. Vollst?ndige Prompts,
Kandidaten-Hashes, Auswahlgr?nde und Original-Hashes stehen in [prompts.json](prompts.json).
Die lokalen Kandidaten und ihr Prompt-Satz liegen unter
`art/poc/dawn/icons/candidates/icon-<name>-{01,02,03}.png` und `ui-m3-prompts.json`.
UI-Plaketten und Medaillons sind frontale Embleme, keine World-Sprites.

| Original / Vertragsname | Wahl | Grund |
| --- | --- | --- |
| [elite-armored.png](elite-armored.png) | 01 | Breite Panzerplatte mit gut sichtbarem Mittelschlitz. |
| [elite-swift.png](elite-swift.png) | 01 | Gerade doppelte Chevrons mit klarem Abstand. |
| [elite-volatile.png](elite-volatile.png) | 01 | Ruhiger vierstrahliger Funkenstern statt vieler d?nner Zacken. |
| [elite-regenerating.png](elite-regenerating.png) | 02 | Breites Kreuz; einzelnes Blatt st?rt die Hauptform wenig. |
| [elite-shielding.png](elite-shielding.png) | 01 | Offener Schild und separater Schutzbogen, klar anders als die Panzerplatte. |
| [night-blood-moon.png](night-blood-moon.png) | 02 | Rote Sichel bleibt klein eindeutig als Mond erkennbar. |
| [night-fog.png](night-fog.png) | 01 | Zwei horizontale Nebelb?nder vor dem Mond, wenig Unruhe. |
| [night-bombers.png](night-bombers.png) | 02 | Breite helle Flugzeugsilhouette nutzt die Medaillonfl?che. |
| [night-fire.png](night-fire.png) | 01 | Drei hohe Flammenzungen mit hellem Kern. |
| [scrap-scanner.png](scrap-scanner.png) | 02 | Gro?er Radarschirm und breiter Suchsektor im kompakten Holz/Messing-Geh?use. |

Runtime: `runtime/<name>-{32,64,128}.webp`, bei allen f?nf Elite-Glyphen zus?tzlich
`runtime/<name>-{16,24}.webp` (40 neue WebPs). Rand pro Seite: `round(size / 16)`,
also 1 px bei 16, 2 px bei 24/32, 4 px bei 64 und 8 px bei 128. Die ?lteren Gr??en
behalten ihre bisherigen Pixel. SHA-Pr?fung, Alpha-Zuschnitt, kubischer Filter und
verlustfreie WebP-Kodierung gelten unver?ndert; keine manuelle Farb-/Formkorrektur.

[Lesbarkeitsbogen](../../../../art/poc/dawn/v1-review/ui-m3-icons.png): alle drei
Kandidaten plus gew?hlte Runtime bei 16/24/32/48 px auf HUD `#24282b` und auf einem
Waldbodenausschnitt aus `art/poc/dawn/m3-concepts/night-mod-fog-02.png` (x820/y390,
660?340). Zus?tzlich 72-px-Details. Elite 16/24 verwenden die entsprechenden Exporte;
sonstige 16/24/32 werden aus 32, 48 aus 64 und Details aus 128 verkleinert.
Bei 100 % betrachten: ein Bildpixel entspricht einem Anzeigepixel, inklusive Rand.
Der Waldboden stammt aus einem freigegebenen Konzept, nicht aus einer neuen Spielaufnahme.
Die lokale Bildpr?fung ersetzt keinen Browser-/Spieltest; es wurde kein Browser gestartet.

Die Elite-Hauptformen sind auch in Graustufen bei 16/24 unterscheidbar; Materialtextur
und Blattdetails brauchen gr??ere Darstellung. Der zus?tzliche Schutzbogen ist bei
16 px eng, ab 24 klarer. F?r Nacht-Medaillons sind 24?32 px sinnvoller als 16;
bei 16 gehen Krater, Nebeldetails und Bomberdetails verloren. Der Scanner ist ab 32
als Radar lesbar, das Zahnrad-Echo ben?tigt eher 48 px; bei 16/24 bleibt vor allem
Ger?tesilhouette plus Suchsektor.

`npm run assets:dawn-ui` erzeugt Runtime und den M3-Bogen (wenn alle lokalen
Kandidaten und das Waldkonzept vorhanden sind). Runtime funktioniert ohne diese
Git-ignorierten Pr?fquellen. Historische B?gen `ui-icons.png`/`ui-scrap-magnet.png`
werden nur noch explizit mit `node scripts/export-dawn-ui.mjs --legacy-review` geschrieben.
Die V1-5/V1-6-Abschnitte oben beschreiben deren urspr?ngliche Lieferung.

V1-7-Dateien: zehn PNG-Originale, 40 Runtime-WebPs, `runtime/manifest.json`,
`prompts.json`, diese README, `scripts/export-dawn-ui.mjs`; lokal 30 Kandidaten,
Prompt-JSON, Detail-/Graustufenpr?fungen im Kandidatenordner und `ui-m3-icons.png`.
Keine ?nderungen an `src/`, Katalogen oder Blender-Rezepten.
