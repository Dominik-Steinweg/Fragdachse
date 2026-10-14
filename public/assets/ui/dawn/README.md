# Dawn UI – Druckregister V2 / S-2

Stand: 2026-10-14. Alle 18 beauftragten Icons wurden mit dem integrierten **image_gen** als zusammenhängendes Holz-/Linolschnitt-Set neu erzeugt. Je drei finale Kandidaten, insgesamt 54; acht unpassende Erstfassungen wurden neu generiert und lokal als rejected-* aufbewahrt. Die 18 gewählten Originale sind unveränderte Kandidatenkopien. Vertragsnamen und Runtime-Größen bleiben erhalten.

Verbindlich: [Bildsprache V1](../../../../docs/GDDs/Fragdachse_From_Dachs_Till_Dawn_Art_Direction_V1.md), Register Druck. Visuell geprüfte Referenzen: C-icon-scrap.png, C-icon-threat.png und style-C-board.png unter art/poc/dawn/style/. Frontale UI-Embleme, keine World-Sprites.

## Bildsprache und Hintergrund

**Einheitlich dunkle, opake Holzkohle-Druckplatten.** Sie entsprechen der Stil-Exploration und halten die Knochenformen auf Walnuss-Holz und unruhigem nächtlichem Waldboden kontrastreich. Die quadratische Platte gehört sichtbar zum Druckzeichen. Der angelegte Rand bleibt erhalten; der Export fügt keinen zweiten Rand hinzu. Das Motiv beansprucht ungefähr 85 Prozent der Breite/Höhe mit handgeschnittenen Abweichungen.

Kräftige Schnittflächen, breite dunkle Zwischenräume, wenige Maserungszüge; kein Glanz oder Bloom. Palette: Holzkohle #1b1a17, Rußbraun #2a241d, Knochen #d9cfb6, Papier #c8b98f, Umbra #5a4632. Die Generierung interpretiert diese Farben mit geringer Texturvariation; keine nachträgliche Palettenquantisierung.

Händler teilen den runden geschnitzten Knochen-/Umbra-Rahmen. Elites teilen eine eckige Plakette mit abgeschnittenen Ecken, violettem Rand #7a4a7f und heller Glyphe. Nachtzeichen teilen den runden Medaillonrand. Je ein Akzent: Blutmond Rot #8f2f24, Nebel Schiefer #4a5157, Bomber und Feuer Orange #d9822b. Ausschließlich der Rekalibrierungskern trägt Cyan #5fb3b0.

Prompt-Kern: hand-carved woodcut / linocut print, bold flat carved ink masses, rough gouge edges, sparse broad woodgrain cuts, bone and aged paper on charcoal, grim field-manual plate, asymmetric carving, no gradients, gloss, glow or text. [prompts.json](prompts.json) enthält vollständige finale Kandidaten-Prompts, Datum, Auswahlgründe und SHA-256. Referenzen wurden visuell ausgewertet, nicht als Edit-Eingaben angehängt.

## Auswahl

| Original / Vertragsname | Wahl | Grund |
| --- | --- | --- |
| [scrap.png](scrap.png) | 01 | Das große Zahnradloch und das klar abgesetzte diagonale Blech bleiben bei 24 px getrennt. |
| [threat.png](threat.png) | 01 | Die seitliche Mondsichel sitzt deutlich über drei getrennten diagonalen Klauenspuren. |
| [dealer-expansion.png](dealer-expansion.png) | 03 | Vier kräftige Palisadenpfähle und zwei breite Außenpfeile ergeben die ruhigste Erweiterungsmarke. |
| [dealer-infrastructure.png](dealer-infrastructure.png) | 03 | Der breite Drohnenkörper und der große quer gehaltene Schlüssel trennen Fluggerät und Reparaturfunktion. |
| [dealer-upgrades.png](dealer-upgrades.png) | 02 | Der breite Schädel mit großen eckigen Augenhöhlen bleibt innerhalb der Medaille klein am eindeutigsten. |
| [dealer-equipment.png](dealer-equipment.png) | 01 | Der seitlich abgesetzte Daumen und die breiten Panzerplatten ergeben eine klare Handschuhform. |
| [recalibration-core.png](recalibration-core.png) | 02 | Der kompakte Cyan-Kern bleibt zwischen den zwei kräftigen Kardanringen als eigene Fläche sichtbar. |
| [scrap-magnet.png](scrap-magnet.png) | 01 | Die aufrechte offene Hufeisenform mit hellen Polen und zwei angezogenen Teilen liest sich am schnellsten. |
| [scrap-scanner.png](scrap-scanner.png) | 02 | Der große Radarschirm trennt Suchsektor und einzelnes Echo auch bei 24 px. |
| [elite-swift.png](elite-swift.png) | 01 | Breite flache Doppel-Chevrons behalten bei 16 px ihren deutlichen Zwischenraum. |
| [elite-armored.png](elite-armored.png) | 03 | Die massive geschlossene Schildplatte und ihr Mittelschnitt bleiben auch in Graustufen bei 16 px erkennbar. |
| [elite-volatile.png](elite-volatile.png) | 01 | Der zusammenhängende vierstrahlige Funkenstern liest sich bei 16 px klarer als die geteilten Varianten. |
| [elite-regenerating.png](elite-regenerating.png) | 01 | Das dominante Kreuz bleibt bei 16 px erkennbar, während die seitliche Ranke die Heilform ergänzt. |
| [elite-shielding.png](elite-shielding.png) | 02 | Der offene Schild und der separate flache Kuppelbogen unterscheiden sich bei 16 px von der massiven Panzerplatte. |
| [night-blood-moon.png](night-blood-moon.png) | 03 | Die breite rote Sichel bleibt bei 24 px klar vom dünnen Medaillonrand getrennt. |
| [night-fog.png](night-fog.png) | 02 | Der ruhige Mond und drei breite Schieferbänder zeigen Nebel ohne störende Kraterdetails. |
| [night-bombers.png](night-bombers.png) | 02 | Die breiten gepfeilten Tragflächen halten die Bomber-Silhouette bei 24 px zusammen. |
| [night-fire.png](night-fire.png) | 03 | Drei ungleich hohe verbundene Flammen bilden eine breite, bei 24 px klare Feuerfront. |

## Lokale Bildprüfung

[Prüfbogen set-board.png](../../../../art/poc/dawn/icons/v2/set-board.png): alle gewählten Runtime-Icons bei 16/24/32/48 px auf dunklem Walnuss-HUD-Ton #2a241d und nächtlichem Waldboden, darunter je drei Kandidaten bei 64 px. Elites zusätzlich bei 16/24 px in Graustufen. Bei 100 Prozent betrachten: ein Bildpixel entspricht einem Anzeigepixel einschließlich Plattenrand.

Elites verwenden echte 16-/24-px-Exporte. Andere Icons werden für 16/24 aus Runtime 32 verkleinert; 48 stammt aus Runtime 64. Hauptformen sind bei 24 px unterscheidbar; Drohnenmechanik, einzelne Palisadenbretter, Magnet-Schrottdetails und Blattstruktur benötigen 32–48 px. Bei 16 px bleiben die fünf Elite-Hauptglyphen erkennbar; die Ranke ist dort nur eine Nebenform. Nacht-/Händlerzeichen sind primär für mindestens 24 px beurteilt.

Waldboden: unveränderter Ausschnitt aus art/poc/dawn/m3-concepts/night-mod-fog-02.png (x820/y390, 660×340), lokal als forest-review.png gesichert. Konzeptausschnitt, keine Spielaufnahme. Kein Dev-Server, Browser oder Spieltest.

## Export und Dateien

Ausführen: `npm run assets:dawn-ui`. [Exportskript](../../../../scripts/export-dawn-ui.mjs) verwendet Sharp, prüft Original-Hashes und quadratische opake Druckplatten und exportiert direkt aus Originalen mit kubischem Filter als verlustfreie WebPs. Keine Farbkorrektur, Schärfung oder Hochskalierung. Reproduzierbar mit denselben Sharp/libvips- und Schriftversionen.

- 18 Originale: `public/assets/ui/dawn/<name>.png`.
- 64 Icon-WebPs: `runtime/<name>-{32,64,128}.webp`; alle fünf Elites zusätzlich `-{16,24}.webp`.
- [runtime/manifest.json](runtime/manifest.json): Hashes, Hintergrundmodus, Zuschnitte, Maße und Bytes. paddingFraction/alphaThreshold/sourceEdgeGuard gelten ausschließlich für transparente Altbestände; Druckplatten werden vollständig exportiert.
- 54 finale Kandidaten: `art/poc/dawn/icons/v2/<name>-{01,02,03}.png`.
- Im selben lokalen V2-Ordner: set-board.png, forest-review.png, selection-review-{first,elites,night}.png, generation-prompts.json, revision-prompts.json, final-prompts.json, selection.json und rejected-*.
- [Prüfnachweis](../../../../art/poc/dawn/icons/v2/verification.json): Kandidaten, Hashes, Maße und zweiter Export ohne geänderte Dateien; export-hashes-before.json hält Vergleichshashes.

Runtime-Export funktioniert ohne lokale Kandidaten. Der Prüfbogen wird nur mit vorhandenen Kandidaten und forest-review.png erzeugt; Kandidaten-Hashes werden ebenfalls geprüft. Historische V1-/M3-Prüfbögen werden nicht mehr geschrieben. art/poc/ bleibt Git-ignoriert; lokale Prüfdateien gehören zur Lieferung im Worktree.

Das historische dealer-portrait.png und sein 256-px-Export behalten Bilddaten und Provenienz. Diese Büste gehört nicht zum S-2-Icon-Set. Die separate Art-Lane unter public/assets/ui/dawn/art/ wird vom UI-Export weder gelesen noch geschrieben.

## U-7: Händler-Unterkategorien und Item-Slots

Ergänzung vom 2026-10-14: **10 neue Icons, 37 Kandidaten**, erzeugt mit dem integrierten `image_gen`. Je Motiv drei Erstkandidaten und sieben zusätzliche flache Fassungen. Leit-Auswahl: geätzt statt flach, Art Direction. Die vier Items, Drohne und Boss-Trophäe verwenden die geätzten Kandidaten; deren flache 04-Fassungen sind als Clip-Art/comichaft verworfen. Items erscheinen auf Karten ab 64 px; 32 px ist für ihre Auswahl nicht maßgeblich. Die gewählten PNG-Originale sind bytegleiche Kandidatenkopien. Dunkle opake Druckplatten, Knochen/Papier/Umbra und grob geschnittene Rundrahmen führen das Druckregister fort. Der Marktzettel trägt als einziges neues Motiv einen roten Händlerstempel; die vier Item-Slots enthalten keine Raritätsfarbe. Frontale UI-Druckzeichen, keine World-Sprites.

| Dateistamm / Manifest-Key | Vorgesehener Texture-Key | Wahl | Auswahlgrund |
| --- | --- | --- | --- |
| dealer-sub-base | dawn-ui-dealer-sub-base | 04 | Der vierte Kandidat ersetzt die feinen Palisadenstäbe durch breite Holzblöcke um einen offenen quadratischen Hof. Zwei große diagonale Außenpfeile bleiben bei 32 px deutlich. Er unterscheidet sich stärker vom bestehenden Icon mit vier hohen Einzelpfählen als 01–03. |
| dealer-sub-drones | dawn-ui-dealer-sub-drones | 02 | Leit-Auswahl: geätzt statt flach, Art Direction. Der geätzte Quadkopter mit rechts aufrechtem Schraubenschlüssel bleibt bei 32 px lesbar. Die mechanische Materialität entspricht dem ernsten Druckregister; Variante 04 wirkt zu flach und comichaft. |
| dealer-sub-branches | dawn-ui-dealer-sub-branches | 02 | Die drei quadratischen Knoten sitzen auf ungleichen Höhen an einem nach rechts verzweigten Stamm. Große Abstände halten die Hierarchie bei 32 px offen; die runden Enden von 01 wirken pflanzlicher, die gemischten Knoten von 03 unruhiger. |
| dealer-sub-boss-points | dawn-ui-dealer-sub-boss-points | 01 | Leit-Auswahl: geätzt statt flach, Art Direction. Der geätzte Dachsschädel im Lorbeer passt in seiner Schnittstruktur zu branches 02. Die ernsthafte Trophäenwirkung entspricht der Art Direction; Variante 04 wirkt zu flach. |
| dealer-sub-round-offers | dawn-ui-dealer-sub-round-offers | 01 | Die schmale, eingerissene Kartenform mit zwei Ausstanzungen bleibt als Marktzettel erkennbar. Der große rote Sonne/Mond-Stempel ist der einzige motivierte Akzent. 02 benötigt die feine Schnur; 03 wirkt eher wie ein gefaltetes Buch. |
| dealer-sub-crafting | dawn-ui-dealer-sub-crafting | 03 | Zwischen dem vollständigen Zahnrad und dem breiten Amboss bleibt ein dunkler Spalt. Beide Formen sind bei 32 px getrennt erkennbar; 01 und 02 verdecken einen Teil des Zahnrads hinter dem Amboss. |
| item-helmet | dawn-ui-item-helmet | 03 | Leit-Auswahl: geätzt statt flach, Art Direction. Geätzte Metallkappe mit Nietenband und getragenem Ledernackenschutz; ernsthafte Materialwirkung auf Karten ab 64 px. 32 px ist für die Item-Auswahl nicht maßgeblich; die flache 04-Fassung ist als Clip-Art/comichaft verworfen. |
| item-gloves | dawn-ui-item-gloves | 03 | Leit-Auswahl: geätzt statt flach, Art Direction. Geätztes Handschuhpaar mit Stoffflicken, Leder und Knöchelplatte; die getrennten Handschuhe wirken getragen und funktional auf Karten ab 64 px. 32 px ist für die Item-Auswahl nicht maßgeblich; die flache 04-Fassung ist als Clip-Art/comichaft verworfen. |
| item-armor | dawn-ui-item-armor | 01 | Leit-Auswahl: geätzt statt flach, Art Direction. Geätzte Weste mit angenieteter Blechplatte, Ledergurt und geflicktem Stoff; die Materialität trägt den ernsten Söldner-Look auf Karten ab 64 px. 32 px ist für die Item-Auswahl nicht maßgeblich; die flache 04-Fassung ist als Clip-Art/comichaft verworfen. |
| item-boots | dawn-ui-item-boots | 03 | Leit-Auswahl: geätzt statt flach, Art Direction. Geätztes versetztes Stiefelpaar mit breiten Zehen, Ledernähten und Stoffumschlägen; getragene Ausrüstung auf Karten ab 64 px. 32 px ist für die Item-Auswahl nicht maßgeblich; die flache 04-Fassung ist als Clip-Art/comichaft verworfen. |

Die Texture-Keys folgen `src/assets/DawnUiAssets.ts`, sind im bestehenden Dawn-UI-Loader registriert: Unterkategorien mit 32 px, Item-Karten mit 64 px und Item-Details mit 128 px. Die Slot-Zuordnung gilt nur im Händler; das Kampagnen-Items-Overlay bleibt unverändert. `dawn-ui-dealer-sub-crafting` ist der vorgesehene stilistische Ersatz für `dawn-merchant/category-crafting`; die alte Kit-Datei bleibt bestehen. Die Auswahl samt Vergleich zu verworfenen Kandidaten steht vollständig in [prompts.json](prompts.json) und im lokalen [Auswahlprotokoll](../../../../art/poc/dawn/ui/icons-u7/selection.json).

### Dateien und Prüfung

- Zehn Originale: `<Dateistamm>.png` direkt in diesem Ordner.
- 30 neue verlustfreie WebPs: `runtime/<Dateistamm>-{32,64,128}.webp`.
- [runtime/manifest.json](runtime/manifest.json): zehn zusätzliche Einträge. Bestand insgesamt 28 Icons plus historisches Porträt, 95 WebPs einschließlich Porträt.
- [board.png](../../../../art/poc/dawn/ui/icons-u7/board.png): alle 37 Kandidaten mit markierter Wahl, ausgewählte echte 32/64/128-px-Exporte, sechs bestehende Dawn-Icons in denselben Größen und eine Probe mit Seitenleisten-/Karten-Texturen des Händler-Kits bei 1× Designgröße.
- Lokale Kandidaten: `art/poc/dawn/ui/icons-u7/candidates/<Dateistamm>-{01,02,03[,04]}.png`.
- [Lokaler Lieferbericht](../../../../art/poc/dawn/ui/icons-u7/README.md), [Dateiliste](../../../../art/poc/dawn/ui/icons-u7/file-list.json) und [Prüfnachweis](../../../../art/poc/dawn/ui/icons-u7/verification.json).

Der Bogen wurde als lokale Rasterdatei visuell geprüft, bei 100 % entsprechen seine Größenproben echten Anzeigepixeln. Unterkategorien werden bei 32 px beurteilt; Item-Slots auf Karten ab 64 px. Die 32-px-Item-Exporte bleiben als Größenvergleich erhalten und sind kein Auswahlmaßstab. Geätzte Materialität und ernsthafte Wirkung haben gemäß Leit-Auswahl Vorrang vor flächiger Vereinfachung. Die Probe ist eine statische Montage, keine Browser- oder Spielaufnahme.

### Reproduzierbarer Export

`npm run assets:dawn-ui -- --u7`

Der additive Schalter exportiert dieselben Runtime-Dateien wie `npm run assets:dawn-ui`, unterdrückt aber den historischen V2-Prüfbogen außerhalb des U-7-Schreibbereichs. Das U-7-Bogenskript wird bei vorhandenen lokalen Quellen zusätzlich geladen. Ohne lokale Prüfquellen funktionieren die Runtime-Exporte weiterhin allein aus den Originalen und `prompts.json`. Bestehende Originale, Runtime-Bilddaten und das Porträt bleiben unverändert.

Original- und Kandidaten-Hashes werden geprüft; Resize direkt aus den Originalen mit Sharp/kubischem Filter, verlustfreie WebPs, keine Schärfung, Farbkorrektur oder zusätzliche Ränder. Bei gleichen Sharp/libvips- und Schriftversionen erzeugt der zweite Lauf identische Bytes einschließlich Manifest und Prüfbogen. [verification.json](../../../../art/poc/dawn/ui/icons-u7/verification.json) hält den Vergleich fest. Die Bildgenerierung selbst wird beim Export nicht erneut ausgeführt.

Lokale Authoring-Helfer: `node art/poc/dawn/ui/icons-u7/select.mjs` kopiert die festgelegte Wahl und aktualisiert die U-7-Provenienz; `node art/poc/dawn/ui/icons-u7/build-board.mjs` baut nur den Prüfbogen. Exakte Erst- und Revisionsprompts liegen in `generation-prompts.json` und `revision-prompts.json`. `art/poc/` bleibt Git-ignoriert; diese lokalen Prüfdateien sind im Worktree vorhanden.
