# FRAGDACHSE – GDD: Zeus-Upgradebaum

**Status:** Fachlicher Zielstand als Implementierungsgrundlage. Alle Zahlen sind initiale, zentral anpassbare Balancewerte.

## 1. Zielbild und Baseline

Zeus ist eine offensive Nahbereichs-Utility mit ausgeprägtem **Risk & Reward**: sehr hoher Schaden pro direktem Treffer, geringe Reichweite und langer Grund-Cooldown. Im PvE soll gutes Positionieren und gezielte Bewegung die starke Einzelaktion auf viele Gegner übertragbar machen.

Die Kernfantasien sind:

- **Riskanter Nahkampfangriff:** nahe herankommen, einen entscheidenden Treffer setzen und Überlebende kurz ausschalten.
- **Lebende Zeus:** den Körper nach kurzem Aufladen vorübergehend elektrifizieren und eine präzise Schneise durch die Horde ziehen.
- **Elektrischer Flächenausbruch:** direkte Treffer erzeugen mit dem Boss schnelle Blitzsalven; tödliche direkte Treffer erweitern deren Reichweite.
- **Koop-Nutzen:** Nervenschock kontrolliert Überlebende, Blitzboden unterstützt die Bewegung des Teams.

### Baseline-Werte und Bedienung

| Parameter | Zielwert |
|---|---:|
| Direkter Zeus-Basisschaden | 200 |
| Reichweite des normalen Zeus | 80 px |
| Trefferwinkel des normalen Zeus | 70° |
| Grund-Cooldown | 10 s |
| Aktivierung | Sofort über E |

E kurz drücken und loslassen löst den normalen gerichteten Zeus aus. Mit Kugelblitz aktiviert 0,5 Sekunden Halten automatisch den elektrischen Körperzustand. Die Angriffsform hängt nicht vom Dash ab; beide Formen funktionieren auch während beider Dash-Phasen.

Der Cooldown beginnt beim akzeptierten Zeus-Einsatz, unabhängig davon, ob anschließend ein Gegner getroffen wird. Ein verfehlter Angriff verbraucht den Einsatz ebenfalls. Abgelehnte Eingaben während des Cooldowns erzeugen keine Wirkung und keinen neuen Cooldown.

## 2. Baumstruktur

```text
                         ZEUS
                       /      \
                 L1 Dynamo    R1 Kugelblitz
                     |             |
              L2 Nervenschock R2 Blitzboden
                       \      /
                    BOSS Donnerfront
                       /      \
                 BL1 Blitzflut BR1 Durchbruch
```

L2 benötigt L1, R2 benötigt R1. Der Boss benötigt beide Vorgängerknoten L2 und R2. BL1 und BR1 benötigen den Boss. Beide Boss-Voraussetzungen müssen mindestens Stufe I erreicht haben. Normale Stufen kosten jeweils einen Upgradepunkt, Donnerfront einen Bosspunkt.

| Knoten | Stufen | Wirkung |
|---|---:|---|
| L1 – Dynamo | 3 | Jeder akzeptierte Dash verkürzt einen laufenden Zeus-Cooldown um 0,5 / 1,0 / 1,5 s. |
| L2 – Nervenschock | 3 | Direkte Zeus-Treffer, Kugelblitzkontakte und Donnerfront-Bolzen betäuben 0,2 / 0,4 / 0,6 s. |
| R1 – Kugelblitz | **3** | Nach 0,5 s Halten elektrischer Körperzustand für 1,5 / 3 / 4,5 s, unabhängig vom Dash. Kein Dash-Reichweitenbonus. |
| R2 – Blitzboden | **1** | Kugelblitz hinterlässt 3 s bestehenden Boden: 5 Schaden/s gegen Gegner und +20 % Bewegung für 2 s bei freundlichem Kontakt. |
| Boss – Donnerfront | **1** | Jeder direkte Zeus-/Kugelblitztreffer erzeugt gleichzeitig 8 schnelle Blitzprojektile mit je 10 Basisschaden. |
| BL1 – Blitzflut | 3 | +4 Donnerfront-Projektile pro Stufe: insgesamt 12 / 16 / 20. |
| BR1 – Durchbruch | 3 | Die Donnerfront eines sofort tödlichen direkten Treffers erhält +25 / +50 / +75 % Reichweite. |

## 3. L1 – Dynamo

Beim **erfolgreichen Start eines Dashs** wird der zu diesem Zeitpunkt laufende Zeus-Cooldown um 0,5 / 1,0 / 1,5 Sekunden reduziert.

Ein Dash zählt genau einmal. Halten, Verlängern, Richtungswechsel und der Übergang in die Erholung erzeugen keine weiteren Rückerstattungen. Ein abgelehnter Dash-Versuch zählt nicht. Ist Zeus bereits bereit, wird nichts für später angespart; die Restzeit kann höchstens auf null sinken.

Es gibt **keine zusätzliche Rückerstattungsobergrenze**. Die regulären Dash-Nutzungsregeln begrenzen die Häufigkeit. Ein bereits vor dem Zeus-Einsatz gestarteter Dash wird nachträglich nicht erneut angerechnet.

**Designziel:** Aktive Bewegung verkürzt die Downtime deutlich. Häufiges Dashen darf Zeus wesentlich früher als nach zehn Sekunden wieder verfügbar machen.

## 4. L2 – Nervenschock

Ein gültiger Zeus-Treffer betäubt ein überlebendes Ziel entsprechend der Upgrade-Stufe:

| Stufe | Stun-Dauer |
|---|---:|
| I | 0,2 s |
| II | 0,4 s |
| III | 0,6 s |

Nervenschock wirkt vollständig auf den normalen Zeus, alle direkten Kugelblitzkontakte und alle Donnerfront-Bolzen. Er gilt **nicht** für Blitzboden-Schaden.

Es handelt sich um eine Betäubung, nicht bloß einen Bewegungsslow. Betroffene Bewegung und Kampfaktionen werden gemäß den allgemeinen Stun-Regeln unterbunden. Bosse erhalten dieselbe volle Dauer, ohne neue Boss-Immunität oder abnehmende Wirksamkeit. Laufende Angriffsvorbereitungen, verbleibende Salventeile und gehaltene Angriffe werden abgebrochen. Danach gelten normale Cooldowns und eine neue Vorbereitung. Gesundheitsabhängige Phasenfortschritte bleiben erhalten; bereits abgefeuerte Projektile und unabhängige Flächen bestehen weiter.

Weitere Treffer erneuern den Stun, addieren seine Dauer aber nicht auf. Eine kürzere Anwendung darf einen bereits länger verbleibenden Stun nicht verkürzen. Viele zeitversetzte Treffer dürfen einen Gegner dadurch länger kontrollieren, ohne ihre Dauern aufzusummieren.

**Designziel:** Überlebende nach einem riskanten Treffer kontrollieren. Mit Donnerfront wird diese Kontrolle auf die Umgebung erweitert; BR1 kann sie bis zu weiter entfernten Gegnern tragen.

## 5. R1 – Kugelblitz

**Drei Stufen.** Jede Stufe verlängert den elektrischen Körperzustand um 1,5 Sekunden: Stufe I 1,5 s, Stufe II 3 s, Stufe III 4,5 s. Kugelblitz verändert die Dash-Reichweite nicht.

### 5.1 Aktivierung und Dauer

| Bedienung | Ergebnis |
|---|---|
| E vor 0,5 s loslassen | Normaler Zeus beim Loslassen |
| E mindestens 0,5 s halten, R1 erworben | Kugelblitz aktiviert automatisch beim Erreichen der Ladezeit |
| E mindestens 0,5 s halten, R1 nicht erworben | Normaler Zeus beim Erreichen der Ladezeit |

Die Ladeanzeige verwendet dieselbe vorhandene Animation wie BFG und Granaten. Während des Aufladens entsteht noch kein Treffer und kein Cooldown. Nach der automatischen Aktivierung erzeugen weiteres Halten und anschließendes Loslassen keinen zusätzlichen Einsatz. Der Host prüft die Ladedauer über die bestehende Held-Action-Identität.

Die Dauer beginnt bei der bestätigten Kugelblitz-Aktivierung. Normales Laufen und Dashen erzeugen dieselben elektrischen Kontakte. Dash-Start, Phasenwechsel und Dash-Ende verändern die verbleibende Dauer nicht. Ein Dash bleibt durch seine schnelle Bewegung eine Synergie.

Zeitablauf, Tod oder Entfernen des Spielers beenden den Körperzustand. Dabei entsteht **kein Abschlussprojektil und keine zusätzliche Entladung ohne Treffer**. Bereits erzeugte Donnerfront-Bolzen und Bodenflächen laufen nach ihren eigenen Regeln aus.

### 5.2 Hitbox und Treffer

Der Kugelblitz verwendet **Position und aktuell wirksame Kollisionsform des Spielers**, einschließlich Dash-Verkleinerung und Wiedervergrößerung. Es gibt keinen unabhängigen festen 16-px-Angriffsradius und keine zusätzliche größere Schadenshülle.

Die Schadensprüfung nutzt diese Geometrie, verändert aber nicht die Bewegungskollision des Spielers. Gegner werden durch Kontakt elektrisch getroffen; Weltblocker und sonstige reguläre Bewegungsregeln bleiben bestehen. Kugelblitz gewährt keine zusätzliche Unverwundbarkeit.

Die tatsächlich zurückgelegte Strecke muss berücksichtigt werden, damit schnelle Bewegungen keine Ziele überspringen. Ein bloßer Überlappungstest an wenigen Einzelpositionen genügt nicht. Sprunghafte Positionsänderungen wie Portaltransfers gelten dabei nicht als durchquerte Dashstrecke.

### 5.3 Wirkung und Trefferverlauf

Jeder erstmals direkt getroffene gültige Gegner erhält **100 % des aufgelösten Zeus-Schadens**, baseline 200. Der Kontakt ist ein direkter Zeus-Treffer und kann Nervenschock, Donnerfront und bei tödlichem Ausgang BR1 auslösen.

Pro Kugelblitz-Aktivierung erhält ein Gegner **höchstens einen direkten Kugelblitztreffer**. Das gilt über die gesamte Aktivierungsdauer, einschließlich normaler Bewegung, mehrerer Dashes und Richtungswechseln. Wiederholtes Berühren oder das Anwachsen der Hitbox erzeugt keinen zweiten direkten Treffer auf dasselbe Ziel.

Donnerfront-Bolzen sind davon unabhängige Projektile. Die jeweils auslösende Zielinstanz ist für ihre gesamte eigene Salve ausgeschlossen; Bolzen anderer Salven dürfen sie nach den normalen Trefferregeln beschädigen. Der Kugelblitz endet nicht am ersten Gegner: Alle entlang der Bewegung tatsächlich erreichten gültigen Ziele können getroffen werden.

**Designziel:** Ein anspruchsvoll gesteuerter Dash überträgt den vollen Zeus-Schaden auf viele Gegner. Auch die langsamere Erholungsphase bleibt offensiv gefährlich, ohne ihre Bewegungsnachteile aufzuheben.

## 6. R2 – Blitzboden

**Eine Stufe.** Solange Kugelblitz aktiv ist, entsteht entlang der realen Spielerbewegung eine elektrische Bodenspur – auch in der Erholungsphase.

| Parameter | Zielwert |
|---|---:|
| Lebensdauer jedes Bodenabschnitts ab Erzeugung | 3 s |
| Schaden an Gegnern bei Kontakt | 5 HP/s |
| Bewegungsbonus für Besitzer und Verbündete | +20 % |
| Dauer des Bewegungsbonus ab Kontakt | 2 s |

Der Bonus erhöht ausschließlich normales Laufen, nicht Dashgeschwindigkeit oder Dashreichweite. Andere Bewegungseffekte behalten ihre reguläre Kombination. Die Breite der Spur folgt der beim Erzeugen durchlaufenen Körpergeometrie.

Der Bewegungsbonus wird durch erneuten Kontakt aufgefrischt, nicht mit sich selbst gestapelt. Verschiedene Abschnitte oder überlappende freundliche Spuren multiplizieren den Bonus nicht. Heilung, Schutz oder zusätzlicher Nervenschock werden nicht gewährt.

Der Gegner-Schaden gilt während des Bodenkontakts. Blitzboden erzeugt keinen zusätzlichen Brandstatus und übernimmt keine unbeabsichtigten Feuer-Sonderwirkungen. Alle überlappenden Abschnitte desselben Besitzers verursachen zusammen höchstens einen Schadensbeitrag. Spuren verschiedener Besitzer dürfen unabhängig beitragen.

Neue Abschnitte entstehen nur durch reale Bewegung. Stillstand stapelt keine neuen Flächen. Nach Kugelblitz-Ende werden keine weiteren Abschnitte erzeugt; bestehender Boden bleibt bis zu seinem eigenen Ablauf erhalten. Portal- oder Teleportdistanzen werden nicht mit Boden verbunden.

Blitzboden-Ticks lösen **weder Nervenschock noch Donnerfront oder BR1** aus.

**Designziel:** Eine schwach schädigende Spur und eine schnelle Route für das Team. R2 ergänzt den Ansturm, ersetzt aber weder dessen direkte Treffer noch die Donnerfront.

## 7. Boss – Donnerfront

### 7.1 Auslöser

Jeder gültige direkte Treffer des normalen Zeus oder Kugelblitzes erzeugt **eine vollständige Donnerfront-Salve am getroffenen Gegner**. Ein sofort getöteter Gegner erzeugt die Salve ebenfalls.

Die Salve entsteht unabhängig davon, ob weitere Gegner in der Umgebung vorhanden sind. Ohne weitere Ziele fliegen die Bolzen in ihren Startrichtungen weiter und verschwinden regulär. Ein Zeus-Einsatz ohne direkten Treffer erzeugt keine Salve.

Beim Kugelblitz kann jeder erstmals direkt getroffene Gegner eine eigene Salve auslösen. Mehrere Kontakte entlang einer Bewegungsbahn dürfen entsprechend viele elektrische Ausbrüche erzeugen.

### 7.2 Projektilwerte

| Parameter | Zielwert |
|---|---:|
| Basisanzahl pro Salve | 8 |
| Basisschaden je Bolzen | **10** |
| Fluggeschwindigkeit | **1.500 px/s** |
| Grundreichweite | **250 px** |
| Startzeitpunkte innerhalb einer Salve | gleichzeitig |
| Zielsuche | leicht zielsuchend, unmittelbar aktiv |

Die 10 Schaden sind ein eigener Balancewert, kein Prozentanteil des direkten Zeus-Schadens. Allgemeine gültige Schadensmodifikatoren werden über die normale Schadensauflösung angewendet.

Die Reichweite ist die maximal zurückgelegte Flugstrecke. Ohne weitere Einflüsse entspricht der Grundwert etwa **167 ms Flugzeit**. Homing benötigt deshalb eine unmittelbare Zielerfassung ohne lange Startverzögerung und nur leichte Kurskorrekturen; abrupte Kehrtwenden sind nicht das Zielbild.

Die Bolzen verwenden die vorhandene Tesla-Bolt-Projektil-/Darstellungsfamilie mit eigenen Zeus-Parametern. Sie sind reguläre, blockierbare Projektile, keine garantierten Radius-Treffer. Ein Bolzen wird beim regulären Treffer verbraucht; mehrere Bolzen dürfen dasselbe gültige Ziel treffen. Es gibt kein zusätzliches Piercing oder Abprallen durch dieses Upgrade.
Größe, zufällige Geschwindigkeitsvariation und Homing-Grundparameter werden von den vorhandenen Tesla-Bolzen übernommen. Zeus überschreibt die Startverzögerung mit 0 ms und das Suchintervall mit initial 25 ms; beide Werte bleiben zentral einstellbar. Eine technische Lebensdauer darf die tatsächliche Flugstrecke bei regulärer Geschwindigkeitsvariation nicht vorzeitig abschneiden.

### 7.3 Startmuster

**Normaler Zeus:** Die Bolzen starten am getroffenen Gegner in einem **120°-Fächer** nach vorne. Maßgeblich ist die beim Zeus-Einsatz festgelegte Welt-Angriffsrichtung, nicht eine spätere Mausbewegung.

**Kugelblitz:** Die Bolzen starten am getroffenen Gegner **rundum über 360°**, unabhängig von Blick- und Dashrichtung. Das gilt beim normalen Laufen und in beiden Dash-Phasen.

Die Startrichtungen werden über den jeweiligen Winkelbereich verteilt und leicht zufällig variiert. Das Ergebnis soll eine verlässliche Flächenabdeckung besitzen, ohne wie eine starre geometrische Zeichnung auszusehen. Alle Bolzen einer Salve starten im selben Zeitpunkt; getrennte direkte Treffer besitzen jeweils ihren eigenen Auslösezeitpunkt.

Die Salve darf nicht unmittelbar in ihrem Ursprungsgegner hängen bleiben oder durch sofortiges Rücklenken zu konzentriertem Eigentrefferschaden werden. Die auslösende Zielinstanz bleibt während der gesamten eigenen Salve sowohl für Kollision als auch Homing ausgeschlossen. Eine spätere neue Instanz mit wiederverwendeter ID wird dadurch nicht ausgeschlossen.

### 7.4 Folgeeffekte und Grenzen

Donnerfront-Bolzen wenden den **vollen Nervenschock der aktuellen L2-Stufe** an. Sie erzeugen jedoch keine neue Donnerfront. Ein Bolzen-Kill erzeugt weder eine neue Salve noch einen BR1-Reichweitenbonus für andere Bolzen.

Der physische Weg der Bolzen bestimmt ihre Treffer. Alle Projektile einer Salve dürfen auch bei fehlenden Zielen sichtbar fliegen. Treffer, Reichweite und Homing dürfen nicht von rein visuellen Effekten abhängig sein.

**Designziel:** Ein gelungener kurzer Nahbereichstreffer wird zu einem lokalen elektrischen Flächenausbruch. Beim Kugelblitz entsteht eine Serie solcher Ausbrüche entlang der selbst gesteuerten Bewegungsbahn.

## 8. BL1 – Blitzflut

**Drei Stufen.** Jede Stufe erhöht die Anzahl der Donnerfront-Bolzen pro direkt getroffenem Gegner um **4**.

| BL1-Stufe | Gesamtzahl pro Salve |
|---|---:|
| Ohne BL1 | 8 |
| I | 12 |
| II | 16 |
| III | 20 |

Schaden je Bolzen, Geschwindigkeit, Reichweite, Startmuster und Nervenschock bleiben unverändert. Die zusätzlichen Bolzen entstehen ebenfalls gleichzeitig.

**Designziel:** Mehr elektrische Dichte und Flächenabdeckung gegen Horden, ohne die direkte Zeus-Reichweite zu erhöhen. Viele gelungene Kugelblitzkontakte sollen entsprechend spektakulär eskalieren.

## 9. BR1 – Durchbruch

**Drei Stufen.** Ist ein direkter Zeus- oder Kugelblitztreffer **sofort tödlich**, erhalten die Donnerfront-Bolzen genau dieses Treffers erhöhte Reichweite.

| BR1-Stufe | Bonus auf Grundreichweite | Bolzen-Reichweite |
|---|---:|---:|
| Ohne BR1 | – | 250 px |
| I | +25 % | 312,5 px |
| II | +50 % | 375 px |
| III | +75 % | **437,5 px** |

Der Bonus ist additiv relativ zur Grundreichweite. Geschwindigkeit, Schaden, Anzahl und Startmuster bleiben unverändert. Die maximale unbeeinflusste Flugzeit steigt auf Stufe III auf etwa **292 ms**.

Entscheidend ist das autoritative Ergebnis des direkten Treffers: Schaden auflösen, tödlichen Ausgang feststellen, anschließend die zugehörige Salve mit der passenden Reichweite erzeugen. Der Effekt darf nicht verloren gehen, weil das Ziel bereits entfernt wurde.

Ein späterer Tod während Nervenschock, durch einen Verbündeten, durch Blitzboden oder durch einen Donnerfront-Bolzen zählt **nicht** als BR1-Auslöser. Bereits fliegende Salven werden nicht nachträglich verlängert. BR1 erzeugt keine zusätzlichen Todesprojektile.

**Designziel:** Gezielte tödliche Nahbereichstreffer tragen die elektrische Wirkung und den Nervenschock weiter in die Umgebung. Die zusätzliche Reichweite ist eine Kill-Belohnung, keine sichere Fernkampf-Erstaktivierung.

## 10. Verbindliche Auslösermatrix

| Schaden/Wirkung | Nervenschock | Donnerfront-Salve | BR1 bei sofort tödlichem Treffer |
|---|:---:|:---:|:---:|
| Normaler direkter Zeus-Treffer | Ja | Ja, gerichteter Fächer | Ja |
| Direkter Kugelblitzkontakt | Ja | Ja, rundum | Ja |
| Donnerfront-Bolzen | Ja | **Nein** | **Nein** |
| Blitzboden-Schaden | **Nein** | **Nein** | **Nein** |

Die Matrix gilt nur bei erworbenem jeweiligem Upgrade. Normale Dash-Aufpralltreffer oder andere elektrische Waffen werden dadurch nicht zu Zeus-Treffern. Pro direktem Treffer entsteht eine Salve, auch wenn dieser Treffer zugleich tödlich ist; BR1 verändert diese Salve und erzeugt keine zweite.

## 11. Darstellung, Integration und Lesbarkeit

**Kugelblitz:** Der Spieler wird als kompakte elektrische Kugel oder deutlich elektrifizierte Silhouette dargestellt. Ihr erkennbarer Kern folgt der aktuellen Spieler-Hitbox, einschließlich Verkleinerung und Erholung. Dekoratives Leuchten darf darüber hinausreichen, ohne einen größeren Trefferbereich vorzutäuschen. Der elektrische Zustand muss auch in der langsameren Erholung eindeutig sichtbar bleiben.

**Gemeinsames elektrisches Material:** Kugelblitz und Blitzboden verwenden die vorhandenen GPU-VFX-Pools mit Tesla-blauem Grundschein, türkisen Filamenten und weißheißen Kernen. Kugelblitz zeigt eine lebendige Hülle mit inneren Entladungen; Blitzboden bleibt als flache, verbundene Spur sichtbar. Gleichmäßig abgetastete Adern überbrücken aufeinanderfolgende Bewegungsschritte, aber keine Portalversätze. Weiches Leuchten, wandernde Helligkeitswellen und kurze Verästelungen ergänzen die klaren Kerne. GPU-Lebenszeiten und Quellfreigabe verhindern Nachbilder; reduzierte Detailqualität erhält die Hauptadern. Es werden vorhandene Atlas-Motive wiederverwendet.

**Donnerfront:** Extrem schnelle, kurze Tesla-Bolzen mit gezackten Leuchtspuren und knappem Nachglühen. Das Bild soll wie ein schlagartiger elektrischer Ausbruch wirken, nicht wie langsame Energiekugeln. Auch Salven ohne weitere Ziele sind sichtbar. Nervenschock und Blitzboden müssen davon unterscheidbar bleiben.

**Integration:** Schaden, Betäubung, Dash-Rückerstattung und Bodenwirkung bleiben hostautoritativ. Clients stellen dieselben Ereignisse dar und erhalten korrekte Cooldown-Aktualisierungen. Bestehende Regeln für Freund/Feind, Kollisionsblocker, Zeitfelder, Portale, Quellenzuordnung und Modifikatoren werden nicht durch parallele Zeus-Sonderpfade ersetzt.

Die elektrische Trefferauswertung gehört fachlich zu Zeus; die Spielerphysik bleibt Eigentümer der Bewegung. Körperkontakte, erzeugte Bolzen und Bodenflächen benötigen eine klare gemeinsame Herkunft, aber unterschiedliche Auslöserrollen gemäß Abschnitt 10.

Bestehende allgemeine Dash-Upgrades bleiben nutzbar. Während eines aktiven Kugelblitzes darf der größere Bereich von Dash-Aufprall Gegner erst nach dem elektrischen Körperkontakt treffen. Dadurch kann er die Donnerfront nicht durch vorzeitiges Töten oder Wegstoßen verhindern. Kugelblitz wird vor Dash-Aufprall ausgewertet; überlebende Gegner können anschließend dessen regulären Schaden und Rückstoß erhalten. Ohne aktiven Kugelblitz bleibt Dash-Aufprall unverändert. Auswirkungen auf Dashdauer und Erholung sind im Zusammenspiel zu prüfen. Die Kugelblitzdauer bleibt unabhängig von Dashdauer und Erholung.

## 12. Abnahme und Balancing-Prüfung

1. **Bedienung:** Kurzes E löst beim Loslassen normalen Zeus aus. 0,5 s Halten aktiviert mit R1 genau einmal Kugelblitz, auch ohne Dash. Weiteres Halten und Loslassen lösen keinen zweiten Einsatz aus. Ladeanzeige und Abbruch folgen den bestehenden Utility-Verträgen.
2. **Dauer:** Die Stufen ergeben 1,5 / 3 / 4,5 s ab Aktivierung. Dash-Start, Erholung und Dash-Ende verändern diese Zeit nicht. Ablauf im Stillstand und Ausblenden bei fehlendem Endpaket sind abgesichert. Es entsteht kein Abschlussprojektil.
3. **Kontakt:** Der elektrische Bereich folgt der tatsächlichen Spieler-Hitbox. Schnelle Durchquerung trifft zuverlässig; derselbe Gegner erhält pro Aktivierung nur einen direkten Kugelblitztreffer. Hindernisse und Portalversätze erzeugen keine Treffer entlang fiktiver Wege.
4. **Dynamo:** Nur akzeptierte Dash-Starts reduzieren einen laufenden Zeus-Cooldown, genau einmal und um den korrekten Stufenwert. Kein Ansparen, keine negative Restzeit; HUD und Host stimmen überein.
5. **Donnerfront:** Pro direktem Treffer entstehen exakt 8 / 12 / 16 / 20 Bolzen, gleichzeitig und auch ohne weitere Ziele. Normale Treffer verwenden den Fächer, Kugelblitzkontakte das Rundummuster.
6. **Nervenschock:** Direkte Treffer und Bolzen betäuben vollständig. Wiederholungen erneuern ohne additive Stapelung; kürzere Anwendungen verkürzen keine längere Restdauer. Boden bleibt ohne Stun.
7. **BR1:** Sofort tödliche direkte Treffer erzeugen ihre Salve mit 312,5 / 375 / 437,5 px Reichweite. Nichttödliche direkte Treffer bleiben bei 250 px. Spätere Kills und Bolzen-Kills erzeugen keine Zusatzreaktion.
8. **Blitzboden:** Nur tatsächliche Kugelblitzbewegung legt Boden. Besitzer und Allies erhalten den nicht stapelnden Bewegungsbonus; Gegner den vorgesehenen Kontaktschaden. Bestehende Flächen behalten nach Kugelblitz-Ende ihre eigene Lebensdauer.
9. **Koop und Last:** Mehrere Zeus-Spieler und dichte Horden prüfen. Zehn direkte Kontakte mit BL1 III erzeugen insgesamt 200 Bolzen, zwanzig Kontakte 400. Trefferzahlen, Host/Client-Darstellung und kurze Projektillebenszeiten müssen auch bei solchen Ausbrüchen korrekt bleiben; die vereinbarte technische Abnahme erfolgt headless. Browser-Framerate, visuelle Lesbarkeit und Spielgefühl bleiben ohne separate Browserprüfung unbestätigt.

**Balancing-Priorität:** Zuerst die zuverlässige, gut steuerbare Kugelblitz-Aktivierung und die starke PvE-Flächenwirkung herstellen. Danach Dynamo mit allgemeinen Dash-Upgrades, die tatsächliche Nervenschock-Kontrolldauer und den Mehrwert von BR1 in verschiedenen Gegnerdichten prüfen. Werteanpassungen sollen die klare Trennung aus riskantem Direktkontakt und belohnender elektrischer Folgewirkung erhalten.

## 13. Umsetzung und Kompatibilität

Der Basis-Cooldown gilt global; der Upgradebaum bleibt Teil des bestehenden Koop-Systems. Es gibt keine zusätzlichen Kontakt-, Salven- oder Dynamo-Limits und keine Zeus-spezifischen PvP-Schalter.

Aufgelöste Upgradeparameter und Quellenzuordnung werden pro Einsatz eingefroren. Laufende Einsätze werden durch einen Profilwechsel nicht rückwirkend verändert. Hostzustände enthalten Einsatz-Identitäten und Kugelblitz-Endzeiten, Bodenabschnitte und zielinstanzgebundene Stun-Endzeiten. Fehlende Delta-Slices bedeuten unverändert; leere Sammlungen beenden den Zustand ausdrücklich. World-Teardown räumt Simulation und Darstellung vollständig auf.

Alte Zeus-Käufe werden nicht migriert oder gutgeschrieben. Inkompatible alte Spielstände sind akzeptiert; die vorhandene Speicherfehlerbehandlung bleibt zuständig, ohne automatische Löschung.

Die Abnahme umfasst npm run check, passende Integrationsprüfungen sowie Lastfälle mit 200/400 Bolzen und mehreren Besitzern. Bestehende Darstellung, Sounds und Icons werden wiederverwendet; neue externe Grafikassets und eine Browserprüfung sind nicht Bestandteil dieser Umsetzung.
