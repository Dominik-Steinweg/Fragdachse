# Content und Konfiguration

Content ist authored Quelle, nicht eine zweite Implementierung in Markdown. Wenn ein Wert oder eine Liste zuverlässig aus JSON, Types oder einer Registry beantwortet wird, auf diese Quelle verweisen statt sie zu kopieren.

## Loadout-Authoring

Die familienweise JSON-Quelle liegt unter src/loadout/content/data/. ViteContentSource sammelt sie; LoadoutContentLoader und LoadoutSchemas parsen/prüfen; LoadoutRegistry veröffentlicht die gemeinsamen Weapon-, Utility- und Ultimate-Registries; LoadoutCatalog liefert die UI-Auswahl. GameContentValidation.validateGameContentReferences() prüft Querverweise, Audio-Keys, Unlocks, Modifier-Ziele und systemische Fallbacks.

Netzwerk- und Ready-Snapshots führen Loadout-IDs und committed, sanitisierten Zustand. Sie übertragen keine vollständigen Config-Objekte. Modusfilter und Fallbacks laufen über isWeaponAllowedInMode(), sanitizeWeaponForMode(), sanitizeUltimateForMode() und die Utility-Resolver.

Varianten dürfen nur über die vorhandene Lineage-/Variantensystematik erben. Ein neuer Coop-Stat braucht einen expliziten Descriptor in src/loadout/CoopDefenseLoadoutModifiers.ts; ein JSON-Feld ohne Resolver ist keine implementierte Mechanik. Besitzerabhängige Werte platzierter Objekte müssen beim Platzieren in deren repliziertem Runtime-Zustand eingefroren werden, wenn der globale Config-Resolver sie später nicht mehr kennt.

## Coop-Content

Map-Registry und Map-JSON sind in [coop-defense-authoring.md](coop-defense-authoring.md) beschrieben. Weitere authored Quellen sind:

- Gegner: src/config/coopDefenseEnemies.json und src/config/coopDefenseEnemies.ts;
- Konstruktionen: src/config/coopDefenseConstructions.json und src/config/coopDefenseConstructions.ts;
- Coop-Upgrades: src/config/coopDefenseUpgrades.json und src/utils/coopDefenseUpgrades.ts;
- allgemeine Runtime-/Power-up-Definitionen: src/powerups/PowerUpConfig.ts und src/config/.

Upgrade-IDs bleiben auch beim inhaltlichen Umbau eines Upgrades stabil: Icon-Auflösung (getCoopDefenseUpgradeTextureKey), gespeicherte Profile in src/utils/localPreferences.ts und die sprachgetrennten Presentation-Keys unter src/i18n/de/upgrades.ts sowie src/i18n/en/upgrades.ts hängen an der ID. Neue Anzeigenamen und Effekte werden über die Presentation- und Effektfelder geändert, nicht über eine neue ID.

Diese Dateien enthalten sowohl Balance als auch technische Verträge. Balance darf sich ändern; IDs, Discriminators, Referenzpfade und die Bedeutung von Feldern sind Stabilitätsverträge und werden von Normalisierern/Validatoren geschützt.

## World- und Activity-Authoring

Die Zustaendigkeiten des authored Coop-Contents sind in zwei Vertraege getrennt: `WorldDefinition` beschreibt, was ohne laufende Mission existiert (Metriken, Terrain, Basen, Gleise, Persistent-Base-Site, Start-Uhrzeit), `ActivityDefinition` beschreibt, was es nur waehrend einer Mission gibt (Objective, Dauer, Respawns, Encounter, Events, Nebenziele, Boss, Power-ups, Item-Drop, Uhrverlauf, Tutorial). Beide liegen unter src/config/authoring/; `AuthoredScenario` erlaubt ausdruecklich `activity: null` – eine Welt ohne Mission braucht kein Pseudo-Objective und keinen Dummy-Timer.

Die Datenquelle bleibt vorerst src/config/coopDefenseMaps/*.json. coopDefenseAuthoringAdapter.ts projiziert eine bereits normalisierte `CoopDefenseMapConfig` in beide Richtungen und trifft dabei keine eigenen Defaults; unnormalisierte Maps lehnt er ab. Jedes Feld der Map gehoert genau einer Seite (`WORLD_SOURCE_FIELDS`, `COOP_MISSION_SOURCE_FIELDS`, `SHARED_SOURCE_FIELDS`); ein neues Map-Feld erzwingt eine Zuordnung. Der Round-Trip ist verlustfrei und in tests/WorldActivityAuthoring.test.ts abgesichert.

`normalizeCoopDefenseMapConfig()` ist nicht idempotent: sie leitet u. a. `spawnArea` aus `front` ab und lehnt beides gemeinsam ab. Normalisierte Configs deshalb nie erneut normalisieren.

## Referenzintegrität

Beim Hinzufügen von Content immer prüfen:

- ID ist im passenden Registry-/Katalogpfad vorhanden;
- jede weaponId, utilityId, ultimateId, baseId, eventId, encounterId und powerUpDefId verweist auf eine bekannte Quelle;
- erlaubte Slots und Modi stimmen mit der Config überein;
- neue Upgrade-/Item-Stats haben einen Descriptor und einen Verbraucher auf Host und Client;
- authored Map-Graphen sind zyklusfrei und normalisieren in eine für beide Peers identische Runtime-Struktur.

Keine Registry-Anzahlen, aktuellen HP-/Damage-/Cooldown-Werte oder einzelne Mapdaten in diese Wissensbasis übernehmen.
