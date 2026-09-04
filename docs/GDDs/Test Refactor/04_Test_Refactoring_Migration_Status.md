# Fragdachse – Test Refactoring: Migrationsstatus

**Architektur:** `01_Test_Architecture_Core.md` + `02_Test_Architecture_Details.md`  
**Plan:** `03_Test_Refactoring_Implementation_Plan.md`

> Temporäres, bewusst kleines Arbeitsprotokoll für Coding-KIs.  
> Nach jeder Phase nur den **aktuellen handlungsrelevanten Zustand** pflegen.  
> Abgeschlossene Detailhistorie, frühere Dateilisten und erledigte Risiken wieder entfernen.  
> Keine Commit-SHAs eintragen – die Commit-Historie liegt in Git.  
> `01`, `02` und `03` werden während der Umsetzung nicht selbständig geändert.

---

## Statuslegende

- ⬜ offen
- 🟨 aktiv
- 🟧 blockiert
- ✅ abgeschlossen

---

## 1. Aktueller Stand

- **Aktive Phase:** keine — Plan vollständig umgesetzt
- **Zuletzt abgeschlossen:** `Phase 6 – Dauerhafte AI-Testpolicy und finaler Gate`
- **Gesamtstatus:** Phasen 1–6 abgeschlossen.
- **Letzter automatisierter Gate:** alle definierten Test-Suites, Build, `npm run ai:sync` und `git diff --check` — grün
- **Bekannte Regressionen:** keine
- **Sichtprüfung:** nicht vorgesehen

---

## 2. Phasenstatus

| Phase | Status | Kurzgegenstand |
|---|:---:|---|
| 1 | ✅ | Baseline + handlungsrelevante Migrationskarte |
| 2 | ✅ | Runner-/Suite-Trennung |
| 3 | ✅ | Source-Ratchets + Architecture-Tests |
| 4 | ✅ | Config-/Content-/Visual-Tuning-Kopplung |
| 5 | ✅ | Redundanz + Mock-Shape + Restballast |
| 6 | ✅ | AI-Testpolicy + Final Gate |

---

## 3. Offene Test-Migrationskarte

> Nur problematische oder noch ungeklärte Cluster aufnehmen.  
> Gute `KEEP`-Tests nicht vollständig inventarisieren.  
> Erledigte Einträge nach Abschluss des Clusters entfernen.

| Cluster / Testbereich | Problem | Zielaktion | Zielphase | Status |
|---|---|---|---:|:---:|

---

## 4. Offene Risiken / Entscheidungen

- Keine offenen handlungsrelevanten Risiken. Verbleibende positional Mocks schützen eigenständige Orchestrierungs-, Netzwerk- oder Renderer-Grenzen.

Während der Umsetzung hier nur Punkte führen, die die **nächste Phase** beeinflussen, z. B.:

- echter Vertrag unklar;
- Test lässt sich nicht ohne Produktionsänderung sinnvoll retten;
- Runner-Zuordnung technisch problematisch;
- unerwartete Flakiness;
- möglicher Produktionsbug.

Erledigte Punkte entfernen.

---

## 5. Dokumentations-Follow-ups

Für Phase 6 vorgesehen und abgeschlossen: zentrale Testpolicy, kurze Router-/Entwicklungs-
Verweise, Phaser-Skill-Verweis und `npm run ai:sync`.

Keine dieser Änderungen vor Phase 6 nur vorsorglich durchführen, sofern ein früherer Runner-Umbau nicht zwingend einen kleinen aktuellen Kommando-Hinweis erfordert.

---

## 6. Nächster konkreter Schritt

Keine offene Phase. Die dauerhafte Testpolicy ist verlinkt, synchronisiert und durch den Final-Gate
verifiziert.

---

## 7. Update-Format nach jeder Phase

Nur aktualisieren:

- aktive Phase;
- zuletzt abgeschlossen;
- Gesamtstatus;
- letzter automatisierter Gate;
- bekannte aktuelle Regressionen;
- Phasenstatus;
- offene handlungsrelevante Migrationscluster;
- offene Risiken/Entscheidungen;
- Dokumentations-Follow-ups;
- nächster konkreter Schritt.

Nicht pflegen:

- Commit-SHAs;
- chronologische Historie;
- Liste aller guten Tests;
- abgeschlossene Detailmigrationen;
- vollständige Teststatistik je Phase, sofern sie für den nächsten Schritt nicht relevant ist.
