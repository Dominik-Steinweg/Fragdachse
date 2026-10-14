# Dawn Merchant UI-Kit

37 Teile für die Gestaltungsvorgabe Händler-UI V1. Imagegen liefert Materialität, Wald, Eckornament und Glyphen; sharp bereinigt Alpha, schneidet zu und montiert pixelgenaue Zustände. Kein Runtime-Code ist integriert.

## Export

`node scripts/export-dawn-merchant-ui.mjs`

Alle PNG-Master liegen hier mit **2× Designauflösung**. Unveränderte Imagegen-Quellen und exakte Prompts liegen in `sources/`. Der Export braucht nur diese Quellen, Node und das vorhandene sharp; keine API, keine Fonts, kein Browser. Zweiter Lauf erzeugt dieselben Bytes und schreibt unveränderte Dateien nicht neu. Für bytegleiche Exporte dieselbe sharp/libvips-Version verwenden.

`runtime/manifest.json` führt pro logischem Key Designgröße, PNG-Master, SHA-256, Verwendung, Insets und 1×/2×-WebP-Varianten. `exports[].file` ist relativ zum Manifest, `original` ebenfalls; `sources.*.file` ist relativ zu diesem Ordner. Alle WebPs sind verlustfrei; dekodierte Pixel werden bei jedem Export verglichen.

## 9-Slice und Ebenen

Insets unten sind **Designpixel**, Reihenfolge links/oben/rechts/unten. Bei 2×-Texturen verdoppeln; die skalierten Werte stehen zusätzlich je Export im Manifest. Ecken und Statuszeichen bleiben fest, Mittelsegmente skalieren. Die Rahmenbreite ist nicht der Slice-Inset: Fenster 24px sichtbare Schiene, 64px feste Ecken. Mindestens 1px skalierbare Mitte belassen. Griff mindestens 37px hoch, da seine festen Kappen je 18px benötigen.

Unter den transparenten Fenster-/Kartenrahmen `panel-fill` kacheln. Dann Inhalte, Raritäts-Innenkante, Rahmenzustand und zuletzt Status/Siegel. Icon-/Textabstände nach `contentInsets`; Unterkategorien enthalten bereits 16px transparenten linken Einzug, also nicht doppelt einrücken. `category-row` bleibt 56px hoch. Kartenzustände besitzen identische Maße und Insets. Locked dimmt den Rahmen; Icon/Text muss die UI zusätzlich dimmen. Owned enthält ein Häkchen. Selected trägt eine rote Eckmarke. Hover hat eine zusätzliche helle Kontur. Kostenrot und zugängliche Statusnamen werden durch die spätere UI gesetzt.

`panel-fill` ist XY-kachelbar, `header-panorama` horizontal. Gegenüberliegende Randpixel werden bei beiden Exportgrößen exakt angeglichen. Struktur und Raritäten bleiben matt; Blau/Gelb sind gezielte semantische Innenkanten-Ausnahmen zur sonst roten Akzentpalette. Status nicht ausschließlich über Farbe vermitteln. Keine Labels in den Bildern außer GEKAUFT. Siegel und Pips sind formbasierte Ergänzungen; keine Schriftdateien erforderlich.

## Teile

| Key (Präfix dawn-merchant/) | Designgröße | Insets L/O/R/U | Verwendung |
|---|---|---|---|
| window-frame | 256×256 | 64/64/64/64 | Äußerer Fensterrahmen; Innenfläche separat darunter kacheln. |
| panel-fill | 256×256 | – | Ruhige Holzkohle-/Papierfläche hinter Text; in X und Y kacheln. |
| header-panorama | 1024×160 | – | Sekundäres Walddekor im Kopf; horizontal kacheln, bei wenig Höhe beschneiden. |
| category-row-normal | 288×56 | 16/12/16/12 | Kategorie: Platz für separates Icon, Label und Zähler. Zustand normal. |
| category-row-hover | 288×56 | 16/12/16/12 | Kategorie: Platz für separates Icon, Label und Zähler. Zustand hover. |
| category-row-active | 288×56 | 16/12/16/12 | Kategorie: Platz für separates Icon, Label und Zähler. Zustand active. |
| subcategory-row-normal | 288×56 | 32/12/16/12 | Unterkategorie: 16px transparente Einrückung eingebaut; Inhalt zusätzlich ab x=32. Zustand normal. |
| subcategory-row-hover | 288×56 | 32/12/16/12 | Unterkategorie: 16px transparente Einrückung eingebaut; Inhalt zusätzlich ab x=32. Zustand hover. |
| subcategory-row-active | 288×56 | 32/12/16/12 | Unterkategorie: 16px transparente Einrückung eingebaut; Inhalt zusätzlich ab x=32. Zustand active. |
| card-frame-normal | 200×220 | 28/28/28/28 | Transparenter Kartenrahmen normal; Füllung und Angebotsinhalt separat. Status sitzt im festen rechten oberen Eck. |
| card-frame-hover | 200×220 | 28/28/28/28 | Transparenter Kartenrahmen hover; Füllung und Angebotsinhalt separat. Status sitzt im festen rechten oberen Eck. |
| card-frame-selected | 200×220 | 28/28/28/28 | Transparenter Kartenrahmen selected; Füllung und Angebotsinhalt separat. Status sitzt im festen rechten oberen Eck. |
| card-frame-locked | 200×220 | 28/28/28/28 | Transparenter Kartenrahmen locked; Füllung und Angebotsinhalt separat. Status sitzt im festen rechten oberen Eck. |
| card-frame-owned | 200×220 | 28/28/28/28 | Transparenter Kartenrahmen owned; Füllung und Angebotsinhalt separat. Status sitzt im festen rechten oberen Eck. |
| card-rarity-white | 200×220 | 28/28/28/28 | Matte white-Innenkante; über dem Kartenrahmen, unter Status/Badge. Kein Leuchten. |
| card-rarity-blue | 200×220 | 28/28/28/28 | Matte blue-Innenkante; über dem Kartenrahmen, unter Status/Badge. Kein Leuchten. |
| card-rarity-yellow | 200×220 | 28/28/28/28 | Matte yellow-Innenkante; über dem Kartenrahmen, unter Status/Badge. Kein Leuchten. |
| badge-new | 48×48 | – | Textloses rotes Drucksiegel mit Stern; NEU als zugänglichen UI-Text ergänzen. |
| stamp-purchased | 220×64 | – | Temporärer Kaufstempel GEKAUFT; nach bestätigtem Kauf einblenden. Nicht 9-slicen. |
| stamp-purchased-blank | 220×64 | – | Textlose Kaufstempel-Alternative mit Häkchen. Nicht 9-slicen. |
| button-buy-normal | 256×56 | 12/12/12/12 | Textloser Kaufen-/Aktionsknopf normal; Label und optionales Cart-Icon separat. |
| button-buy-hover | 256×56 | 12/12/12/12 | Textloser Kaufen-/Aktionsknopf hover; Label und optionales Cart-Icon separat. |
| button-buy-disabled | 256×56 | 12/12/12/12 | Textloser Kaufen-/Aktionsknopf disabled; Label und optionales Cart-Icon separat. |
| button-close | 48×48 | – | Fester Schließen-Knopf mit X; proportional skalieren. |
| icon-lock | 32×32 | – | Freigestelltes lock-Drucksymbol; Knochenfarbe, ohne Fläche. |
| icon-check | 32×32 | – | Freigestelltes check-Drucksymbol; Knochenfarbe, ohne Fläche. |
| icon-cart | 32×32 | – | Freigestelltes cart-Drucksymbol; Knochenfarbe, ohne Fläche. |
| icon-search | 32×32 | – | Freigestelltes search-Drucksymbol; Knochenfarbe, ohne Fläche. |
| icon-filter | 32×32 | – | Freigestelltes filter-Drucksymbol; Knochenfarbe, ohne Fläche. |
| category-sensors | 64×64 | – | Peilgerät mit Antenne und Rundskala. |
| category-supply | 64×64 | – | Versorgungskiste am Fallschirm. |
| category-crafting | 64×64 | – | Gekreuzter Hammer und Zange. |
| pip-empty | 16×16 | – | Leerer Stufen-Pip; Rautenform, proportional skalieren. |
| pip-filled | 16×16 | – | Gefüllter Stufen-Pip; Rautenform, proportional skalieren. |
| scrollbar-track | 12×128 | 3/8/3/8 | Vertikale Schiene; feste Breite, Höhe über 9-Slice anpassen. |
| scrollbar-thumb | 8×48 | 2/18/2/18 | Vertikaler Griff; mindestens 37px sichtbare Höhe und größere unsichtbare Trefferfläche. |
| field-search | 320×48 | 10/10/10/10 | Textloses Suchfeld; Lupe links separat, auch als Filterfeld verwendbar. |

## Prüfbögen

- `art/poc/dawn/ui/kit/kit-board.png`: alle Teile einzeln auf Schachbrett sowie zusammengesetztes 16:9-Probe-Layout.
- `art/poc/dawn/ui/kit/probe-layout.png`: Probe-Layout separat bei 1920×1080, Fenster 1690×928 (88%×86%), Text als Balken.
- `art/poc/dawn/ui/kit/seam-board.png`: wiederholte Texturen, 9-Slice-Streckproben und Icons bei 24/32/64px.

Das Probe-Layout montiert ausschließlich Kit-Teile plus bereits vorhandene Dawn-Icons und das vorhandene Händlerporträt. Diese vorhandenen Referenzbilder sind optional und werden nicht neu exportiert. Ohne sie verwendet der Prüfbogen die neuen Platzhalter.
