# Nachtsicht, Mondlicht und Void-Botanik (V1)

Status: in Umsetzung seit 2026-10-18 im Branch `night-visibility`. Gates G0–G3 siehe unten. G0 und G1 sind umgesetzt.
G2 ist umgesetzt: 12 Seerosen- und 13 Fels-Frames mit Leuchtmasken. Argon lieferte den ersten Satz, ComfyUI die übrigen
15 Teile. Ein Spieltest steht noch aus.

Map-Felder: `moonlight` (`strength` 0–1,5, `cover` −0,3–0,3) und `voidFlora` (`level` 0–1, `hotspots`, `foci`). Beide
lassen sich im Map-Editor unter „Nacht“ bearbeiten; Fokuszonen werden im JSON gesetzt.

## 1. Anlass

In Spieltests waren Felsen und Wasser nachts kaum zu erkennen. Spieler liefen dagegen, und die
Taschenlampe half kaum:

- Die Lampenschatten beginnen an der beleuchteten Felskante. Vom Felsdach bleibt nur ein schmaler
  Saum hell, der Felsshader kennt nachts kein Relief.
- Wasser hat keinen Nacht- oder Lampeneingang. Unter der Lampe wirkt es wie matter Boden.
- Mondlicht gibt es nur als Prototyp beim Dawn-Blutmond.

Ziel: Felsen und Wasser sind nachts lesbar, ohne die Atmosphäre zu opfern. Die Nacht bleibt sehr
dunkel; Licht entsteht lokal durch Mondinseln, Lampe und befallene Flora. Die Void-Botanik
verbessert zusätzlich die Optik und markiert ab Map 12 das Feindesland.

## 2. Entscheidungen (2026-10-18)

| Nr. | Entscheidung |
|---|---|
| N-1 | Jede Nacht gibt es kühle, silberblaue Mondinseln durch weltverankerte Wolkenlücken. In der tiefen Nacht (23:30–03:00) sind es weniger und kleinere Inseln; dazwischen bleibt es extrem dunkel. Stärke und Abdeckung sind pro Map einstellbar. |
| N-2 | Der Blutmond ist ein rotes Preset desselben Mondsystems. |
| N-3 | Die Mondinseln driften mit der synchronisierten World-Uhr, damit alle Peers dieselben Inseln sehen. Es entsteht kein neuer replizierter Zustand. |
| N-4 | Die Lampe beleuchtet die ihr zugewandte Felsfront bis zu einer abstandsabhängigen Eindringtiefe mit Relief. Der Rest des Felsdachs bleibt dunkel, der geworfene Schatten hinter dem Fels bleibt unverändert. |
| N-5 | Wasser bekommt nachts einen eigenen Materialteil: kühlere, sattere Körperfarbe, Mondreflex in den Inseln und Glanz unter der Lampe. Die Uferlinie bleibt unverändert. |
| N-6 | Void-Botanik: Seerosen und Felsmoos werden vom Feind übernommen. Tagsüber wirken sie violett verfärbt, ab der Dämmerung leuchten sie über die Lichtkarte und erhellen Wasser und Felskanten. |
| N-7 | Verteilung: Maps 1–11 haben vereinzelte Befallsstellen, ab Map 12 steigt der Befall deutlich bis Map 20. Dazu kommen automatische Hotspots (feindliche Basen, Void-Feuer, Kraken-Teich) und setzbare Fokuszonen. PvP, Lobby und Dawn nutzen einen mittleren Standardwert. |
| N-8 | Neue Assets mit Leuchtmasken entstehen über Argon oder lokal über ComfyUI. Vorher kommt ein Entwurf mit eingefärbten Bestands-Assets. |
| N-9 | Kein additiver Glow über Figuren und kein bildschirmweiter Farbfilter. Eine skotopische Nachtgewichtung im Grade gibt es nur als A/B-Versuch nach Freigabe. |

## 3. Gates

| Gate | Inhalt |
|---|---|
| G0 | Sichtbarkeitskern: Mondinseln, Lampe an Felsen, Wasser nachts |
| G1 | Void-Botanik als Entwurf: Datenfluss, Intensitätsfeld, Auswahl, Leuchten |
| G2 | Produktions-Assets über Argon und ComfyUI |
| G3 | Feinschliff, Performance, Map-Editor, Doku, Merge |

## 4. Entscheidungslog

- 2026-10-18 (G0/G1-Rückmeldung): Mondinseln bleiben wie umgesetzt; die Lichtkante im Fels folgt der echten Felskontur statt dem Zellraster; Wasser ist nachts deutlich blau; der Blutmond behält seinen roten Schein; keine Purkinje-Verschiebung.
- 2026-10-18: Void-Befall steigt in der Kampagne nur sanft. Feindliche Basen sind voll befallene Zentren mit weitem Abfall, damit sich das Vorarbeiten ins Feindesgebiet spüren lässt. Der Kraken-Teich ist vollständig befallen.
- 2026-10-18: Void-Pflanzen tragen leuchtende Adern und schwebende Sporen, damit sie klar anders wirken als eingefärbte Pflanzen.
- 2026-10-18: Befall ist zusammenhängend. Benachbarte Pflanzen und ganze Teiche kippen gemeinsam, Ränder zeigen teilweisen Befall; einzelne violette Pflanzen neben grünen gibt es nicht.
- 2026-10-18: Die Farbe bleibt einheitlich (kein zweites, natürliches Leuchten). Wirkt Violett am Ende nicht, entsteht eine neue Variante, in der alles in einer gemeinsamen Farbe leuchtet.
- 2026-10-18: Die restlichen 15 Bilder (Seerosengruppen 04–06, Moos-Set) entstehen lokal über ComfyUI statt über Argon, damit nicht auf das Antigravity-Kontingent gewartet wird. Felsteile übernehmen die Silhouette ihrer natürlichen Familie.
