# Bild-Asset-Audit – Ersatzkandidaten

Stand: 28.09.2026. Ergebnis: **34 Ersatzkandidaten**, zusätzlich **7 bedingte Prüfkandidaten**. Dies ist eine Arbeitsliste für eine spätere Überarbeitung, keine Freigabe zur Generierung. Es wurden keine Spielassets, Daten oder Renderer geändert.

Bearbeitungsstand A01: Die [neue Todessequenz r03 mit Animationsvergleich](../art/death-sequence-a01/README.md) wurde auf gesonderten Auftrag erstellt, freigegeben und ins Spiel übernommen. **A01 ist erledigt.** Der folgende Befund beschreibt weiterhin den ursprünglichen Audit-Stand.

## Grundlage und Grenzen

Bearbeitungsstand A03–A14: Die [neuen Icons r01 mit Vergleichsseite](../art/icon-refresh-a03-a14/README.md) wurden auf gesonderten Auftrag erstellt, am 29.09.2026 vollständig freigegeben und als 256×256-PNGs ins Spiel übernommen. A03–A06 basieren auf perspektivischen Ansichten der Pipeline-Waffen, A07–A14 bewahren die bisherigen Pickup-Motive. Die Power-up-Icons A07–A14 wurden anschließend erneut überarbeitet und nach ausdrücklicher Freigabe durch [r05 mit einheitlichem, kräftig schattiertem Rahmen](../art/icon-refresh-a03-a14/r05/README.md) ersetzt. **A03–A14 sind erledigt.** Die folgenden Befunde beschreiben weiterhin den ursprünglichen Audit-Stand.

- Bewertungsmaßstab: [visuelle Leitlinien](ai/visual-guidelines.md), aktuelle Pipeline-Figuren und -Türme sowie die Waldboden-UI. Weltobjekte benötigen eine orthografische 90°-Draufsicht; UI-Illustrationen dürfen eine andere Perspektive verwenden. Bestehende World-Tiles müssen laut Leitlinien nicht pauschal dem neuen Figurenstil angepasst werden.
- 827 Bilddateien visuell in Kontaktübersichten bzw. als Original gesichtet: 339 Loadout-/Upgrade-Icons, 56 Pipeline-Standbilder, 43 Bilder im Sprites-Hauptverzeichnis, 31 Ausrüstungs-/Missions-/Schießstandbilder, 31 Natur-/Boden-/Zugmaterialien, 25 UI-Bilder, 147 Groundcover-Bilder, 130 Decals, 24 Felsvegetationsbilder und die Todesanimation. Darunter waren auch Altbestände, die anschließend anhand des Codes ausgeschlossen wurden.
- Verwendung über Loader, Registry **und** darstellenden Code verfolgt. „Verwendet“ bedeutet ein erreichbarer Anzeigeweg im aktuellen Code, gegebenenfalls abhängig von Modus, Freischaltung oder Mission; es bedeutet nicht, dass das Asset in jedem Match erscheint.
- Auffällige Icons zusätzlich bei 22, 32 und 64 Pixeln auf dunklem Untergrund betrachtet. Die Codegrößen sind: Loadout-Picker 22 px, regulärer Slot bis 30 px, Upgrade-Icon 32 px, Radialmenü bis 42 px. Weltgrößen beziehen sich auf Spielkoordinaten vor Kamerazoom.
- **Keine laufende Browser-/Matchprüfung durchgeführt.** Aussagen zu Kontrast und Stil beruhen auf den Bilddateien und den verifizierten Anzeigegrößen. Beleuchtung, Bewegung, Kamerazoom und sämtliche Frames der Pipeline-Animationen sind nicht abschließend beurteilt. Die Kontaktübersichten waren temporäre Prüfmittel und gehören nicht zum Repository-Ergebnis.
- Kleine Quellauflösung allein ist kein Qualitätsmangel. Insbesondere werden die 306 registrierten Upgrade-Icons nicht pauschal zum Austausch empfohlen. Schwache Silhouetten, konkurrierende Details und konkrete Stilbrüche sind die Gründe der folgenden Auswahl.

## Kategorien und Priorität

| Kürzel | Kategorie | Bedeutung |
| --- | --- | --- |
| S | Stilbruch | Auffällige Abweichung von der aktuellen Darstellung vergleichbarer Assets. |
| L | Lesbarkeit | Motiv, Kontur oder wesentliche Details verschwinden bei der vorgesehenen Größe. |
| P | Perspektive | Weltgrafik liest sich als Seitenansicht statt als Draufsicht. |
| K | Konsistenz | Wiedererkennbarkeit zwischen Zuständen, UI oder zusammengehörigen Bildern leidet. |

| Priorität | Empfehlung |
| --- | --- |
| P1 | Zuerst ersetzen: deutlicher Qualitäts- oder Konsistenzbruch. |
| P2 | Anschließend gezielt überarbeiten oder neu exportieren; Motiv und Funktion erhalten. |
| P3 | Nachrangige Angleichung ohne unmittelbaren Gameplay-Nachteil. |
| Prüfen | Noch keine feste Ersatzempfehlung; vor Aufwand eine gezielte Ansicht im Spiel durchführen. |

## 1. Figuren und primäre Loadout-Icons

Verwendung: [ArenaScene](../src/scenes/ArenaScene.ts) lädt die Bilder. [EffectSystem.playPlayerDeathAnimation](../src/effects/EffectSystem.ts) spielt den Todesatlas; [LoadoutCatalog.describeLoadoutItem](../src/loadout/LoadoutCatalog.ts) bestimmt die tatsächlich sichtbaren Icons. [LoadoutSlotPicker](../src/ui/LoadoutSlotPicker.ts), [LoadoutSlotControl](../src/ui/LoadoutSlotControl.ts) und [RadialActionMenu](../src/ui/RadialActionMenu.ts) zeigen sie an.

| ID | Prio | Kategorie | Datei und Größe | Befund / gewünschte Überarbeitung |
| --- | --- | --- | --- | --- |
| A01 | P1 | S, K | [dachs_death_ani3.png](../public/assets/player/dachs_death_ani3.png), 1216×64; Frames 32×64 | Todessequenz beginnt mit dem alten kantigen Pixel-Dachs und wechselt in einen weißen Comic-Geist mit Kreuzaugen. Deutlicher Sprung gegenüber dem heutigen texturierten Pipeline-Dachs. Die gesamte Sequenz auf dessen Form und Materialität abstimmen; Todeszustand weiterhin klar erkennbar halten. |
| A02 | P1 | S, K | [DACHS_TUNNEL.png](../public/assets/sprites/Loadout/DACHS_TUNNEL.png), 32×32 | Graue, schwarz umrandete Streifen-/Bohrerform mit wenigen flachen Farbflächen. Wirkt neben den modellierten Item-Icons wie ein Prototyp und vermittelt den Dachstunnel nur schwach. Ein eindeutiges Tunnel-/Grabmotiv im Materialstil der übrigen Icons schaffen. |
| A03 | P1 | L | [NEGEV.png](../public/assets/sprites/Loadout/NEGEV.png), 32×32 | Sehr dunkle, flache Waffensilhouette; bei 22–32 px bleibt auf dunklem Grund wenig erkennbare Form. Helligkeitstrennung und charakteristische MG-Masse herausarbeiten. |
| A04 | P2 | L | [ASMD_PRIM.png](../public/assets/sprites/Loadout/ASMD_PRIM.png), 32×32 | Kleines, weiches dunkles Gehäuse; primär bleibt ein blauer Leuchtstreifen. Körperkontur und Hauptform stärken, ohne Primär-/Sekundärfarbcode zu verlieren. |
| A05 | P2 | L, K | [ASMD_SEC.png](../public/assets/sprites/Loadout/ASMD_SEC.png), 32×32 | Gleiches Problem in Violett. Mit A04 als Paar überarbeiten und beide Modi bei kleiner Größe unterscheidbar halten. |
| A06 | P2 | L | [AWP.png](../public/assets/sprites/Loadout/AWP.png), 32×32 | Sehr dünne, dunkelgrüne Diagonale; der Waffencharakter geht bei 22 px weitgehend verloren. Aussagekräftigere Silhouette, hellere Kanten und bessere Nutzung der Iconfläche. |

Hinweise: Die ASMD-Dateien erhalten in [LoadoutIconLayout](../src/ui/LoadoutIconLayout.ts) bereits ausdrücklich NEAREST-Sampling, um schwache Außenpixel zu erhalten. Das stützt den Bedarf an robusteren Ausgangskonturen, ersetzt aber keine spätere UI-Abnahme. Beim Todesatlas müssen die zugehörigen [Frame-Metadaten](../public/assets/player/dachs_death_ani3.json), die Animation in ArenaScene und der untere Ursprung im EffectSystem zusammen berücksichtigt werden.

## 2. Pickup-Familie

Verwendung: [PowerUpConfig](../src/powerups/PowerUpConfig.ts) ordnet die Keys zu; [PowerUpRenderer.sync](../src/powerups/PowerUpRenderer.ts) zeichnet normale Pickups mit **16×16 Spieleinheiten**. Einige Bilder erscheinen zusätzlich über [PersistentBaseRewardCatalog](../src/persistentBase/PersistentBaseRewardCatalog.ts) im Basenmenü bzw. über [RadialActionModel](../src/systems/RadialActionModel.ts) im Radialmenü. Damit betrifft die Familie sowohl World als auch UI.

Gemeinsamer Befund: dicke schwarze Rasterkontur und ein dominanter hellgrauer, abgeschrägter Kachelrahmen; die eigentliche Symbolfläche ist klein. Die Bilder sind untereinander konsistent und ihre Farbcodes nützlich, passen aber deutlich weniger zu den aktuellen weicheren Weltobjekten. **Als Familie überarbeiten**, mit größerem Symbolanteil und weniger massivem Rahmen. Keine detailreichen Miniaturgegenstände erzwingen: Lesbarkeit bei 16 Spieleinheiten bleibt das Ziel.

| ID | Prio | Kategorie | Datei, jeweils 16×16 | Texture-Key / zu erhaltendes Merkmal |
| --- | --- | --- | --- | --- |
| A07 | P2 | S, L | [16x16HP.png](../public/assets/sprites/16x16HP.png) | `powerup_hp`; rotes Heilkreuz. |
| A08 | P2 | S, L | [16x16Armor.png](../public/assets/sprites/16x16Armor.png) | `powerup_arm`; goldener Schild. |
| A09 | P2 | S, L | [16x16Rage.png](../public/assets/sprites/16x16Rage.png) | `powerup_rage`; rote Wut-/Flammenform. |
| A10 | P2 | S, L | [16x16adrenalin.png](../public/assets/sprites/16x16adrenalin.png) | `powerup_adr`; blaue Spritze, besonders dünnes Binnenmotiv. |
| A11 | P2 | S, L | [16x16damageamp.png](../public/assets/sprites/16x16damageamp.png) | `powerup_dam`; violetter Schadensbonus, derzeit sehr abstrakte Ringform. |
| A12 | P2 | S, L | [16x16holy_grenade.png](../public/assets/sprites/16x16holy_grenade.png) | `powerup_hhg`; goldene heilige Granate. |
| A13 | P2 | S, L | [16x16nuke.png](../public/assets/sprites/16x16nuke.png) | `powerup_nuk`; gelb-schwarzes Strahlensymbol. |
| A14 | P2 | S, L | [16x16bfg.png](../public/assets/sprites/16x16bfg.png) | `powerup_bfg`; grüne Energiekugel. |

## 3. Schwache Upgrade-Icons

Alle folgenden IDs stehen sowohl in den aktiven [Upgrade-Definitionen](../src/config/coopDefenseUpgrades.json) als auch in `withIcon` der [Icon-Registry](../src/config/coopDefenseUpgradeIcons.json). Der [Resolver](../src/utils/coopDefenseUpgrades.ts) bildet daraus `UPGRADE_<ID>.png`; [CoopDefenseUpgradesOverlay](../src/ui/CoopDefenseUpgradesOverlay.ts) verwendet diese Keys. Die Unlock-Icons dienen zusätzlich der Loadout-/Konstruktionsdarstellung. Jede aufgeführte Datei ist **32×32 px** groß.

Ziel: deutliche Hauptform und ein gut erkennbares Zusatzzeichen für den jeweiligen Effekt. Die überwiegend funktionierenden übrigen Upgrade-Icons können unverändert bleiben. Ein bloßes Hochskalieren würde die aufgeführten Probleme nicht beheben.

| ID | Prio | Kategorie | Datei | Konkreter Befund |
| --- | --- | --- | --- | --- |
| A15 | P2 | L | [UPGRADE_P90_ACCURACY.png](../public/assets/sprites/Loadout/UPGRADE_P90_ACCURACY.png) | Dünnes Fadenkreuz mit sehr dunkler Waffe im Zentrum; wenig sichtbare Motivmasse. |
| A16 | P2 | L | [UPGRADE_P90_ADRENALINE_COST.png](../public/assets/sprites/Loadout/UPGRADE_P90_ADRENALINE_COST.png) | Dunkles Gehäuse über kleinen blauen Zeichen; Waffe und Ressourcenbezug sind schwach getrennt. |
| A17 | P2 | L | [UPGRADE_P90_BULLET_STORM_SPREAD.png](../public/assets/sprites/Loadout/UPGRADE_P90_BULLET_STORM_SPREAD.png) | Sehr feiner, stumpfgoldener Streufächer; einzelne Punkte statt einer tragfähigen Symbolform. |
| A18 | P2 | L | [UPGRADE_P90_DAMAGE.png](../public/assets/sprites/Loadout/UPGRADE_P90_DAMAGE.png) | Fast nur ein kleiner orangefarbener Lichtpunkt am Ende einer dunklen schmalen Waffe. Wirkung überstrahlt den kaum erkennbaren Gegenstand. |
| A19 | P2 | L | [UPGRADE_P90_RANGE.png](../public/assets/sprites/Loadout/UPGRADE_P90_RANGE.png) | Dunkle Waffe und dünne Diagonale mit winzigem Zielpunkt; Motiv zerfällt bei kleiner Ansicht. |
| A20 | P2 | L | [UPGRADE_SHOTGUN_RANGE.png](../public/assets/sprites/Loadout/UPGRADE_SHOTGUN_RANGE.png) | Sehr schmaler Lauf, verstreute graue Punkte und kleines Ziel; zu wenig zusammenhängende Form. |
| A21 | P2 | L | [UPGRADE_SHOTGUN_ROUND_SHOT.png](../public/assets/sprites/Loadout/UPGRADE_SHOTGUN_ROUND_SHOT.png) | Dünner radialer Punktfächer und kleines Zentrum; der eigentliche Effekt ist wesentlich schwächer lesbar als andere Schrotflinten-Upgrades. |
| A22 | P2 | L | [UPGRADE_AWP_ADRENALINE_COST.png](../public/assets/sprites/Loadout/UPGRADE_AWP_ADRENALINE_COST.png) | Extrem schmale vertikale Waffe mit wenigen blauen Markierungen; auf dunklem Grund beinahe nur eine Linie. |
| A23 | P2 | L | [UPGRADE_NEGEV_ADRENALINE_COST.png](../public/assets/sprites/Loadout/UPGRADE_NEGEV_ADRENALINE_COST.png) | Dunkles vertikales Motiv mit kleinen cyanfarbenen Akzenten; geringe Form- und Bedeutungslesbarkeit. |
| A24 | P2 | L | [UPGRADE_NEGEV_RANGE.png](../public/assets/sprites/Loadout/UPGRADE_NEGEV_RANGE.png) | Leuchtende Messlinie dominiert die dunkle Miniaturwaffe. Waffenbezug und Reichweitenwirkung deutlicher miteinander verbinden. |
| A25 | P2 | L | [UPGRADE_GAUSS_MAGNETIC_DISCHARGE.png](../public/assets/sprites/Loadout/UPGRADE_GAUSS_MAGNETIC_DISCHARGE.png) | Kleine diagonale Waffe in schwachem, unterbrochenem Ring; Entladung hat keine kräftige Hauptform. |
| A26 | P2 | L | [UPGRADE_GAUSS_RIFLE_CHARGE_DURATION.png](../public/assets/sprites/Loadout/UPGRADE_GAUSS_RIFLE_CHARGE_DURATION.png) | Dünner blauer Ring um eine dunkle horizontale Waffe. Lade-/Zeitinformation geht im kleinen Gesamtmotiv unter. |
| A27 | P2 | L, K | [UPGRADE_UNLOCK_AIRSTRIKE.png](../public/assets/sprites/Loadout/UPGRADE_UNLOCK_AIRSTRIKE.png) | Schmales Funk-/Zielmotiv mit winzigem unteren Leuchtpunkt; schwach für eine prominente Ultimate-Auswahl. Größere Silhouette mit erkennbarem Luftschlagbezug. |
| A28 | P2 | L, S | [UPGRADE_UNLOCK_ROCK_BARRIER.png](../public/assets/sprites/Loadout/UPGRADE_UNLOCK_ROCK_BARRIER.png) | Kleine braune rechteckige Steinreihe, viel ungenutzte Höhe; liest sich als Texturstreifen. Eigenständiges Barrierenmotiv mit klarerer räumlicher Form. |

## 4. Missionsobjekte und Vegetations-Decals

| ID | Prio | Kategorie | Datei und Größe | Verwendungsnachweis | Befund / gewünschte Überarbeitung |
| --- | --- | --- | --- | --- | --- |
| A29 | P2 | S, K | [mission_reward_pedestal.png](../public/assets/sprites/mission_reward_pedestal.png), 72×72 | `PowerUpRenderer.sync`, `objective-marker`, 38×38 Spieleinheiten. | Harte dunkle Pixelkonturen, kleinteilige Nieten und sehr kontrastreiche blaue Metallringe. Gegenüber den heutigen Pipeline-Sockeln gröber; als ruhigen, lesbaren Missionssockel angleichen. |
| A30 | P2 | S, L | [mission_reward_pickup.png](../public/assets/sprites/mission_reward_pickup.png), 48×48 | `PowerUpRenderer.sync`, `objective-placement`, 14×14 Spieleinheiten. | Viele dunkle Kammern um einen cyanfarbenen Diamanten werden auf 14 px reduziert. Weniger Randdetail und größerer zusammenhängender Kern; mit A29 als Familie gestalten. |
| A31 | P2 | P, S | [flower01.png](../public/assets/sprites/decals/flower01.png), 16×16 | [DecalConfig](../src/arena/DecalConfig.ts), aktive Grasvarianten; [ArenaGenerator](../src/arena/ArenaGenerator.ts) und [LobbyWorldLayout](../src/arena/LobbyWorldLayout.ts). | Gelbe Blüten auf sichtbaren aufrechten Stängeln: liest sich als frontales Blumenbüschel. Durch Blüten-/Blattgruppe von direkt oben ersetzen. |
| A32 | P2 | P, S | [flower03.png](../public/assets/sprites/decals/flower03.png), 16×16 | Derselbe aktive Gras-Decal-Pfad. | Rosa Blüten mit vertikalen Stängeln und seitlichen Blättern; gleiches Perspektivproblem. Zur aktuellen Groundcover-Draufsicht passend überarbeiten. |
| A33 | P2 | P, S | [flower04.png](../public/assets/sprites/decals/flower04.png), 16×16 | Derselbe aktive Gras-Decal-Pfad. | Blaue Blüten entlang eines von vorn lesbaren Stängelgerüsts. Draufsicht mit erhaltener blauer Akzentfarbe. |

Die Blumen sind ein gezielter Perspektivbefund, kein Auftrag, sämtliche bestehenden 16-px-Decals neu zu malen. Gedämpfte Erd-, Moos- und Kieselstempel erfüllen als Hintergrunddetail eine andere Aufgabe als gut sichtbare Item-Icons.

## 5. Nachrangige Angleichung

| ID | Prio | Kategorie | Datei und Größe | Verwendung / Befund |
| --- | --- | --- | --- | --- |
| A34 | P3 | K | [32x32dachs.png](../public/assets/sprites/32x32dachs.png), 32×32 | In [index.html](../index.html) weiterhin als Favicon eingebunden. Zeigt den alten Pixel-Dachs, während Spielfigur und Cursor einen anderen Look besitzen. Bei einer Branding-Runde durch eine für 16–32 px optimierte Fassung des aktuellen Dachszeichens ersetzen. Kein dringender Gameplay-Mangel. |

## 6. Bedingte Prüfkandidaten – noch nicht in der Ersatzmenge

| ID | Kategorie | Datei | Beobachtung und notwendige Entscheidung |
| --- | --- | --- | --- |
| B01 | S, L | [canopy01.png](../public/assets/sprites/canopies/canopy01.png), 384×384 | Sehr kleinteiliges hellgrünes Blattkorn und deutlich dunkle Innenpartien. Im tatsächlichen Zoom prüfen, ob die Baumkrone gegenüber dem weicheren Bodenbewuchs zu körnig wirkt. |
| B02 | S, L | [canopy02.png](../public/assets/sprites/canopies/canopy02.png), 384×384 | Derselbe Familienbefund; nicht isoliert austauschen. |
| B03 | S, L | [canopy03.png](../public/assets/sprites/canopies/canopy03.png), 384×384 | Derselbe Familienbefund; nicht isoliert austauschen. |
| B04 | S, L | [canopy04.png](../public/assets/sprites/canopies/canopy04.png), 384×384 | Derselbe Familienbefund; nicht isoliert austauschen. |
| B05 | S, L | [canopy05.png](../public/assets/sprites/canopies/canopy05.png), 384×384 | Derselbe Familienbefund; nicht isoliert austauschen. |
| B06 | S | [BahnstreckeSchienen.png](../public/assets/sprites/BahnstreckeSchienen.png), 64×32 | Sichtbar rasterige Schienen/Schwellen neben höher aufgelösten Zugmaterialien. Draufsicht und Rasteranschluss sind korrekt. Erst eine Strecke mit Zug bei normalem Zoom vergleichen; bestehende Weltgrafiken sind vom neuen Figurenstil ausdrücklich ausgenommen. |
| B07 | S, K | [rewards/plasma_turret.png](../public/assets/sprites/rewards/plasma_turret.png), 1254×1254 | Sehr kräftige Cartoon-Outlines und glänzende blaue Flächen gegenüber dem matteren Pipeline-Turm. Das Bild ist jedoch ein **UI-Icon**, kein Weltsprite: Die Dreiviertelansicht ist hier kein Perspektivfehler. Nur ersetzen, wenn es im Basenmenü/Radialmenü sichtbar herausfällt. |

Verwendung B01–B05: [CanopyConfig](../src/arena/CanopyConfig.ts), `CANOPY_VARIANTS`, geladen in ArenaScene. B06: Texture-Key `bg_tracks`, unter anderem [ArenaVisualFactory](../src/arena/ArenaVisualFactory.ts). B07: `reward_plasma_turret` in [PersistentBaseRewardCatalog](../src/persistentBase/PersistentBaseRewardCatalog.ts), angezeigt über [PersistentBaseEditorScene](../src/scenes/PersistentBaseEditorScene.ts) und RadialActionModel.

## 7. Bewusst nicht als Ersatzauftrag aufgenommen

- **Vier alte Ultimate-Icons:** `public/assets/sprites/Loadout/AIRSTRIKE.png`, `ARMAGEDDON.png`, `GAUSS_RIFLE.png` und `HONEY_BADGER_RAGE.png` sind auffällig einfach. Der aktuelle `describeLoadoutItem`-Pfad ersetzt sie aber durch die registrierten `UPGRADE_UNLOCK_*`-Bilder. Nur Vorhandensein und Preload wären hier ein falscher Nachweis sichtbarer Verwendung. A02/Dachstunnel besitzt diese Ersetzung nicht.
- **Alte Gegner, Türme und Handwaffen:** Die existierenden Dateien in `sprites/enemies/`, `sprites/turrets/` sowie die alten spezifischen Bilder in `sprites/held/` nicht pauschal neu produzieren. Die aktuellen Loader/Visual-Specs nutzen [pipelineAssets.json](../src/config/pipelineAssets.json). Die generischen Handwaffen bleiben Fallbacks; ohne konkreten sichtbaren Einsatz kein priorisierter Ersatzauftrag.
- **Neue Pipeline-Figuren und -Türme:** Standbilder wurden gesichtet; daraus ergibt sich kein ausreichend belastbarer pauschaler Austauschgrund. Bewegungsqualität, einzelne Animationsframes und kleine Gegnerdetails bleiben außerhalb der abschließenden Bewertung dieses Audits.
- **UI-Rahmen und Ausrüstungsbilder:** Waldrahmen, Modal-, Upgrade-, Ergebnis- und Ausrüstungsbilder bilden überwiegend eine zusammenhängende Familie. Seitenansichten bei Rüstungs-/Waffen-Icons sind keine Verletzung der World-Perspektive. Alte Exportversionen nicht mit den aktuell referenzierten WebP-Dateien verwechseln.
- **World-Tiles und Materialschichten:** Kein pauschaler Austausch von 47-Blob-Sheets, Bodentexturen, Masken, Moos- und Streudetails. Ein weißes Maskenbild, schwaches Overlay oder kleinteiliges Materialmuster ist isoliert kein Qualitätsmangel.
- **Ausgeschaltete/archivierte Bilder:** `decals/decal01.png` und `decals/decal02.png` sind in DecalConfig auskommentiert. `Loadout/_review_unused/`, `sprites/old/`, `art/`, `tools/source-art/` und Generierungsordner sind keine eigenständigen Belege für aktuelle Spielverwendung.
- **Keine Bilddateien:** Prozedurale Projektile, Shader, Partikel und zur Laufzeit erzeugte Texturen wurden nicht als Ersatzassets aufgenommen. Sounds und Fonts sind nicht Teil dieses Auftrags.

## Empfohlene Bearbeitungsreihenfolge

1. A01–A03: Todessequenz, Dachstunnel und NEGEV als die deutlichsten Einzelbrüche.
2. A04–A06 und A15–A28: schwache UI-Motive gezielt verbessern; bei 22/32 px und im Radialmenü abnehmen.
3. A07–A14 zusammen: einheitliche Pickup-Familie, geprüft bei 16 Spieleinheiten und in der vergrößerten UI-Verwendung.
4. A29–A33: Missionsobjekte als Paar und die drei perspektivisch auffälligen Blumen.
5. A34 optional; B01–B07 erst nach gezieltem Vergleich im Spiel entscheiden.

Bei einer späteren Umsetzung funktionierende Keys, Farbbedeutungen, Anker und Anzeigegrößen erhalten bzw. bewusst gemeinsam migrieren. Höhere Exportauflösung erst nach Klärung der Silhouette wählen. **In diesem Schritt bleibt es ausschließlich bei dieser Datei.**
