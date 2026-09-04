# Erweiterungen

**Erweiterungen** fügen Turbo EA Funktionen hinzu, ohne den Kern zu verändern —
zusätzliche Metamodell-Inhalte, Integrationen mit den Werkzeugen, die Ihre Teams
ohnehin nutzen, regulatorisches Berichtswesen und ganz neue Seiten. Sie werden
von Turbo EA erstellt und signiert und über **Admin → Erweiterungen**
installiert.

Dieser Abschnitt beschreibt, *was* jede veröffentlichte Erweiterung leistet und
wie Sie sie nutzen. Wie der Extension Store selbst funktioniert — Vertrauen und
Signaturen, Lizenzen, Instanz-IDs, Installation, Updates und Testphasen —
beschreibt [Administration → Extension Store](../admin/extensions.md).

## Verfügbare Erweiterungen

### Strategie, Planung & Transformation

| Erweiterung | Funktion | Lizenz |
|-------------|----------|--------|
| [Digital Autonomy Assessment](digital-autonomy.md) | Bewertet jede Anwendung anhand des Digital Autonomy Assessment Framework der Universität Utrecht — 22 gewichtete Indikatoren, ein automatischer Autonomie-Wert von 1–10 und ein Risiko-/Mitigations-Quadrant | **Kostenlos** |
| [EA Value Tracker](value-savings.md) | Macht aus Architekturentscheidungen ein prüfbares Wertregister: kategorisierte Einsparungsmeldungen, Vier-Augen-Genehmigung der Realisierung und ein Wert-Dashboard | Kommerziell |
| [Roadmap Studio](roadmap-studio.md) | Plant alternative Zukünfte der Landschaft als Was-wäre-wenn-Szenarien, schreitet durch Übergangsplateaus, vergleicht sie nach Kosten und End-of-Life-Exposition und führt sie durch Prüfung und die Entscheidung eines Prüfgremiums | Kommerziell |

### Integrationen

| Erweiterung | Funktion | Lizenz |
|-------------|----------|--------|
| [Jira Todo Sync](jira-todos.md) | Hält Turbo-EA-Todos und ein Jira-Cloud-Projekt in beide Richtungen synchron — Status, Titel, Fälligkeit und Zuständige | Kommerziell |
| [Slack Notifications](slack-notify.md) | Stellt jeder Person ihre Turbo-EA-Benachrichtigungen als Slack-Direktnachricht zu, mit Opt-in pro Person und Typ | Kommerziell |

### Regulierung

| Erweiterung | Funktion | Lizenz |
|-------------|----------|--------|
| [DORA Register of Information](dora-roi.md) | Führt das Informationsregister nach EU-DORA Art. 28 auf Ihren vorhandenen Karten und exportiert das offizielle xBRL-CSV-Einreichungspaket | Kommerziell |

## Was alle Erweiterungen gemeinsam haben

- **Herstellersigniert.** Jedes Bundle trägt eine Ed25519-Signatur, die Turbo EA
  beim Hochladen *und* bei jedem Backend-Start prüft. Was sich installieren
  lässt, ist genau das, was der Hersteller gebaut hat.
- **Zur Laufzeit lizenzgebunden** (außer bei kostenlosen Erweiterungen). Läuft
  eine Lizenz ab, wird die Erweiterung stillgelegt — ihre Seiten verschwinden,
  ihre Jobs pausieren — aber **Ihre Daten werden niemals gelöscht**. Eine
  erneuerte Lizenz stellt alles wieder her.
- **Geringstmögliche Rechte.** Alles, was eine Erweiterung über ihre eigenen
  Daten hinaus liest oder schreibt, wird als **Grant** im signierten Bundle
  deklariert und ist vor der Installation einsehbar. Siehe
  [Datenzugriffs-Grants](../admin/extensions.md).
- **Eigene Berechtigungen.** Jede Erweiterung definiert Berechtigungsschlüssel
  der Form `ext.<name>.…`, die nach dem Laden unter **Admin → Benutzer und
  Rollen** erscheinen — Sie entscheiden, wer sie nutzen darf.
- **Nachvollziehbar.** Jede Änderung, die eine Erweiterung an Ihrem Inventar
  vornimmt, wird im **Admin → Audit-Log** unter der Herkunft **Erweiterung**
  protokolliert und kann zurückgenommen werden.

## Vor der Installation

Prüfen Sie die **Mindestversion von Turbo EA** auf der Seite der jeweiligen
Erweiterung — auf einem älteren Kern lässt sie sich nicht installieren.
Erweiterungen mit Backend-Code benötigen nach der Installation einmalig einen
Backend-Neustart; Turbo EA blendet dann einen entsprechenden Hinweis ein.
