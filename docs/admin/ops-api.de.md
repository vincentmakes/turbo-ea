# Ops-API (verwaltete Bereitstellungen)

Die Ops-API (`/api/v1/ops`) ist eine **optionale** Verwaltungsoberfläche, die eine Turbo-EA-Cloud-Steuerungsebene zum Betrieb gehosteter Instanzen verwendet. Bei einer selbst gehosteten Installation ist sie **standardmäßig deaktiviert** — jede Route antwortet mit `404`, sofern die Instanz nicht mit einer `OPS_PUBLIC_KEY`-Umgebungsvariable gestartet wurde. In Turbo EA selbst gibt es keinerlei Abrechnungs- oder Lizenzierungslogik.

## Authentifizierung

Jede Ops-Anfrage muss mit dem Ed25519-**privaten** Schlüssel signiert werden, den die Steuerungsebene verwahrt; die Instanz prüft die Signatur mit dem **öffentlichen** Schlüssel aus `OPS_PUBLIC_KEY` (base64, rohe 32 Byte). Die Signatur umfasst die HTTP-Methode, den Pfad einschließlich Abfragezeichenfolge, einen SHA-256-Hash des Bodys, einen Zeitstempel und eine einmal verwendbare Nonce:

```
canonical = METHOD \n PATH_WITH_QUERY \n sha256(body) \n timestamp \n nonce
```

Header: `X-Ops-Timestamp` (Unix-Sekunden, ±5 Minuten), `X-Ops-Nonce` (einmalig verwendet, Replay-Schutz), `X-Ops-Signature` (base64-Ed25519-Signatur).

## Endpunkte

| Methode | Pfad | Zweck |
|--------|------|---------|
| GET | `/api/v1/ops/info` | Version, Anzahl Benutzer/Karten, Datenbankstatus |
| POST | `/api/v1/ops/rescue-access` | Erstellt ein **zeitlich begrenztes** Operator-Administratorkonto |
| DELETE | `/api/v1/ops/rescue-access` | Widerruft ein Rettungskonto sofort |
| GET | `/api/v1/ops/export` | Streamt das bereinigte Workspace-Exportpaket ohne Geheimnisse |

## Rettungszugriff — Transparenzgarantien

Zeitlich begrenzter Operatorzugriff („Rettungszugriff“) ist so ausgelegt, dass er niemals unbemerkt erfolgen kann:

- **Jede Erteilung und jeder Widerruf benachrichtigt alle Instanzadministratoren** in der App *und* per E-Mail, einschließlich Name des Operators, angegebenem Grund und Ablaufzeitpunkt.
- **Jede Aktion wird im eigenen Ereignisprotokoll der Instanz erfasst.**
- **Der Ablauf wird von der Instanz selbst durchgesetzt**: Rettungskonten haben einen Zeitstempel `access_expires_at`; abgelaufene Konten werden bei der Authentifizierung abgewiesen und durch eine stündliche Hintergrundaufgabe deaktiviert. Ein Ausfall der Steuerungsebene kann den Zugriff niemals verlängern.
- Rettungskonten verwenden eine eigens reservierte Adresse (`rescue-…@rescue.turboea.invalid`), sodass sie in der Benutzerliste leicht zu erkennen und jederzeit manuell deaktivierbar sind.

## Workspace-Export

`GET /api/v1/ops/export` gibt dasselbe Paket zurück wie **Admin → Einstellungen → Migration → Workspace-Transfer → Export**: den vollständigen Workspace ohne Geheimnisse. Die Steuerungsebene nutzt dies für von Kunden angeforderte Datenexporte (Datenübertragbarkeit gemäß DSGVO) und für Sicherheits-Backups vor Upgrades oder Löschungen.
