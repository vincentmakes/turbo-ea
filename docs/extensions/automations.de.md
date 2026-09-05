# Automations

Der größte Teil der EA-Governance ist eine Liste von Dingen, die jemand von Hand
zu erledigen versprochen hat: ein Risiko anlegen, wenn eine Anwendung ohne
Eigner eine Kostenschwelle überschreitet, den technischen Eigner anstoßen, wenn
eine Komponente ihr End-of-Life erreicht, den fachlichen Eigner warnen, wenn eine
genehmigte Karte bearbeitet wird. Die Liste stimmt; das Tun ist es, was
untergeht — denn jeder Punkt ist eine Erinnerung in jemandes Kopf statt einer
Regel, die die Plattform einhält.

**Automations** macht aus diesen Versprechen Regeln, die Turbo EA für Sie
ausführt. Eine Regel besteht ausschließlich aus Auswahllisten — *wenn* etwas
in der Landschaft passiert, *falls* Bedingungen zutreffen, *dann* Aktionen
ausführen — und jeder Lauf wird als Mutations-Batch im Audit-Log festgehalten,
sodass eine fehlgelaufene Regel mit einem Klick zurückgenommen ist.

## Auf einen Blick

| | |
|---|---|
| **Lizenz** | Kommerziell — eine signierte Berechtigung ist erforderlich |
| **Mindestversion von Turbo EA** | 2.126.0 |
| **Berechtigungen** | `ext.automations.view`, `ext.automations.manage` |
| **Datenzugriffs-Grants** | Karten (lesen + schreiben), Karten- und Todo-Ereignisse, Todos (lesen + schreiben), das Benutzerverzeichnis, Risiken (lesen + schreiben), Entscheidungsdokumente, Benachrichtigungen, Stakeholder-Rollen |
| **Backend-Neustart nötig** | Ja — die Erweiterung liefert Backend-Code |
| **Wo sie erscheint** | **Automations** im Abschnitt **Admin** des Benutzermenüs · ein Chip mit der Anzahl der Läufe auf der Kartendetailseite |

## Eine Regel: wenn, falls, dann

![Das Regelraster](../assets/img/en/86_ext_automations_rules.png)

Der Reiter **Regeln** listet jede Regel mit ihrem Auslöser, dem Kartentyp, den
Aktionen, einem Aktivierungsschalter, ihrem letzten Lauf und einer
Abspielen-Schaltfläche. Öffnen Sie eine Regel, um den Editor zu sehen.

![Der Regeleditor](../assets/img/en/87_ext_automations_editor.png)

Der Editor liest Ihnen die Regel oben in klaren Worten vor und führt dann durch
ihre drei Teile:

**Wenn** — was einen Lauf startet. Eine Regel beobachtet einen Kartentyp und
wird ausgelöst durch eines der folgenden Ereignisse:

| Auslöser | Wird ausgelöst, wenn |
|---|---|
| eine Karte wird erstellt / aktualisiert / archiviert / wiederhergestellt | sich diese Karte ändert |
| eine Beziehung wird hinzugefügt / entfernt | eine Beziehung — optional eines bestimmten Typs — die Karte berührt |
| ein Todo wird erledigt | ein an die Karte angehängtes Todo geschlossen wird |
| nach Zeitplan | ein fünfteiliger Cron-Ausdruck (UTC) fällig wird — die Regel prüft dann jede Karte des Typs |

**Falls** — die Bedingungen, als verschachtelte Gruppen **alle von** / **eine
von**. Jede Zeile ist ein Feld, ein Operator und ein Wert aus Auswahllisten:
die eigenen Felder und Lebenszyklusphasen der Karte, ihre Tags, ihre
Stakeholder-Rollen (*wird von niemandem gehalten*, *wird gehalten von* …), ihre
Beziehungen, ihr End-of-Life-Status bei Anwendungen und IT-Komponenten und — bei
*eine Karte wird aktualisiert* — was sich **geändert** hat, sodass eine Regel
nur auslöst, wenn ein Wert von einem Zustand in einen anderen gewechselt ist.
Lassen Sie die Gruppe leer, damit die Regel für jede Karte läuft.

**Dann** — die Aktionen, der Reihe nach ausgeführt. Eine fehlschlagende Aktion
beendet den Lauf, und die Laufzeile nennt den Schritt, der fehlgeschlagen ist.

| Aktion | Was sie tut | Benötigt |
|---|---|---|
| Ein Feld setzen / leeren, ein Lebenszyklusdatum setzen, Subtyp, übergeordnetes Element, Namen oder Beschreibung setzen | Bearbeitet die Karte | Schreibzugriff auf das Inventar |
| Tags setzen | Ersetzt, ergänzt oder entfernt Tags und respektiert dabei Einfachauswahl-Gruppen | Schreibzugriff auf das Inventar |
| Eine verknüpfte Karte erstellen, eine Beziehung anlegen | Legt eine Karte eines anderen Typs an und verbindet sie, oder verbindet zwei bestehende Karten | Schreibzugriff auf das Inventar |
| Die Karte archivieren | Archiviert sie (30 Tage lang wiederherstellbar) | Schreibzugriff auf das Inventar |
| Eine Stakeholder-Rolle zuweisen / entfernen | Gibt eine Rolle an eine Person, einen Rolleninhaber, den Rolleninhaber des übergeordneten Elements oder die Person, die die Regel ausgelöst hat | Stakeholder-Rollen |
| Ein Todo erstellen | Ein Todo auf der Karte für eine zuständige Person, mit Fälligkeitsdatum | Todos |
| Personen benachrichtigen | Eine In-App-/E-Mail-Benachrichtigung gemäß den eigenen Einstellungen der Empfänger | Benachrichtigungen |
| Ein Risiko anlegen, ein Risiko aktualisieren | Erfasst ein Risiko im Risikoregister mit Kategorie, Wahrscheinlichkeit und Auswirkung, verknüpft mit der Karte und einer Person als Eigentümer; ein späterer Lauf kann Titel, Eigentümer oder Zieldatum aktualisieren | Risiken |
| Einen Entscheidungsentwurf ablegen | Ein Architecture Decision Record als Entwurf, verknüpft mit der Karte — niemals von einer Regel unterzeichnet | Entscheidungsdokumente |
| Einen Webhook aufrufen | Eine signierte HTTPS-Anfrage an ein externes System mit der Karte, der Änderung und der Regel | — |
| Stopp | Beendet die Aktionsliste | — |

Titel, Beschreibungen und Nachrichten sind Vorlagen: `{{card.name}}`,
`{{card.attributes.costTotalAnnual}}`, `{{actor.name}}`, `{{change.old}}` und
dergleichen werden pro Karte ausgefüllt, und der Editor bietet die Variablen aus
einem Menü an.

Unter den Aktionen liegen zwei Optionen. **Einmal pro Karte auslösen**
(standardmäßig aktiv) merkt sich, wofür eine Regel ausgelöst hat, damit eine
nächtliche Regel nicht jede Nacht dasselbe Risiko anlegt; sie löst erneut aus,
sobald sich die Werte ändern, die sie liest. Der **nächtliche Abgleich** prüft
jede Karte um 03:00 UTC erneut, sodass sich ein verpasstes Ereignis von selbst
heilt.

## Simulieren und Jetzt ausführen

**Simulieren** lässt die Regel im Vorschaumodus gegen jede Karte ihres Typs
laufen — es wird nichts geschrieben — und zeigt, wie viele Karten zutreffen und,
pro Karte, genau das, was jede Aktion tun würde. Wer eine Regel aktiviert, die
noch nie simuliert wurde, wird gebeten, zuerst zu simulieren; aktivieren lässt
sie sich trotzdem.

**Jetzt ausführen** tut dasselbe im Ernstfall: Die Regel löst sofort für jede
zutreffende Karte aus und respektiert dabei *Einmal pro Karte auslösen*, sofern
Sie nicht *Für bereits behandelte Karten erneut auslösen* ankreuzen. Der
Ergebnisdialog zeigt Karte für Karte, was getan wurde, und verlinkt auf den
Audit-Batch.

![Laufergebnisse](../assets/img/en/88_ext_automations_run_results.png)

## Läufe und das Audit-Log

![Der Reiter Läufe](../assets/img/en/89_ext_automations_runs.png)

Jeder Lauf ist eine Zeile auf dem Reiter **Läufe**: welche Regel, auf welcher
Karte, wie er gestartet wurde (ein Ereignis, der Zeitplan, der nächtliche
Abgleich, Jetzt ausführen), wie er endete, und jede Aktionszeile. Filtern Sie
nach Regel oder Ergebnis; die Anzahl der Läufe einer Karte sitzt als Chip auf
ihrer Detailseite.

Jeder Schreibvorgang eines Laufs landet unter **Admin → Einstellungen →
Audit-Log** als Erweiterungs-Batch mit Diffs pro Ereignis. Ein **Scan** — ein
Zeitplan, der nächtliche Abgleich oder Jetzt ausführen — ist **ein Batch für
alle Karten, für die er ausgelöst hat**, sodass eine fehlgelaufene Regel ein
einziges **Rollback** ist und nicht eines pro Karte. Das Rollback macht die
Karten- und Beziehungsschreibvorgänge rückgängig und, ab Turbo EA 2.127.0, auch
die Risiken, die der Lauf angelegt oder bearbeitet hat, die Rollen, die er
zugewiesen hat, die Tags, die er gesetzt hat, und die Entscheidungsentwürfe, die
er abgelegt hat. Todos und Benachrichtigungen bleiben bewusst bestehen — eine
Bitte an eine Person und eine zugestellte Nachricht macht man nicht ungeschehen,
indem man sie löscht — und die Rollback-Vorschau sagt das, bevor irgendetwas
angewendet wird.

## Benachrichtigungen werden gebündelt

Eine Regel sendet nie eine Benachrichtigung pro Karte. Ein Scan sammelt, was
jeder Person zusteht, und sendet am Ende **eine** Benachrichtigung pro Person
und Regel — eine einzelne Karte kommt als eigene Nachricht an, mehrere als
Sammelnachricht (Digest), die die Karten nennt und deren Titel Sie in der Aktion
festlegen (*Digest-Titel*). Änderungen, die nacheinander eintreffen — ein Import,
der dreihundert Karten berührt — senden die erste Benachrichtigung sofort und
halten den Rest für das **Gruppierungsfenster** aus den Einstellungen zurück; in
der nächsten Minute geht das Angesammelte als ein Digest hinaus. Die eigenen
Benachrichtigungseinstellungen jeder Person entscheiden weiterhin über Glocke,
E-Mail oder einen Erweiterungskanal.

## Vorlagen

Der Reiter **Vorlagen** ist eine Galerie fertiger Regeln — eine teure Anwendung
ohne Eigner, End-of-Life innerhalb von 180 Tagen, eine neue Anwendung ohne
Geschäftsfähigkeit, eine genehmigte Karte, die bearbeitet wurde, einen Monat
lang niedrige Datenqualität, eine Anwendung im Übergang zum Phase-out, eine
archivierte Karte mit offenen Beziehungen, eine Initiative, die aktiv wird, eine
kritische Anwendung ohne technischen Eigner, ein neu registrierter Anbieter,
eine IT-Komponente am End-of-Life. Jede öffnet sich deaktiviert im Editor, damit
Sie sie anpassen und simulieren können.

## Einstellungen

![Einstellungen](../assets/img/en/90_ext_automations_settings.png)

| Einstellung | Wirkung |
|---|---|
| **Ersatzperson** | Erhält das Todo, das Risiko oder die Benachrichtigung, wenn eine Regel in der angefragten Rolle niemanden findet |
| **Webhook-Host-Freigabeliste** | Hosts, die die Aktion *Einen Webhook aufrufen* erreichen darf, einer pro Zeile; leer erlaubt jeden öffentlichen HTTPS-Host. Private und interne Adressen werden immer abgelehnt |
| **Geprüfte Karten pro geplantem Lauf** | Wie viele Karten ein geplanter Scan betrachtet, bevor er stoppt und den Rest dem nächsten überlässt |
| **Benachrichtigungen bündeln, die eintreffen innerhalb von** | Das Gruppierungsfenster in Minuten; 0 sendet jede in der nächsten Minute |

## Demodaten

**Demodaten laden** in den Einstellungen installiert die Vorlagen und drei
Vorzeigeregeln auf der Beispiel-Landschaft, aktiviert die meisten davon und
führt einige einmal aus, damit die Reiter Regeln, Läufe und Audit-Log etwas zu
zeigen haben. **Entfernen** nimmt genau das wieder heraus — Regeln, Läufe, die
von ihnen erstellten Todos und Risiken.

## Berechtigungen

| Berechtigung | Erlaubt |
|---|---|
| `ext.automations.view` | Die Regeln, ihre Läufe und die Vorlagengalerie sehen, dazu den Chip mit der Anzahl der Läufe auf Karten |
| `ext.automations.manage` | Regeln erstellen, bearbeiten, aktivieren, simulieren, ausführen und löschen; die Einstellungen ändern; Demodaten laden |

## Wenn die Lizenz abläuft oder die Erweiterung deaktiviert wird

Die Seite verschwindet aus dem Menü, die Zeitpläne stoppen, und Ereignisse werden
nicht mehr zugestellt. Nichts wird gelöscht: Die Regeln, ihre Läufe und alles,
was sie geschrieben haben — Karten, Risiken, Todos, Entscheidungen — bleiben
genau so, wie sie sind. Eine erneuerte Lizenz oder das erneute Aktivieren der
Erweiterung bringt die Regeln zurück, weiterhin aktiviert.

## Hinweise und Grenzen

- Turbo EA gestattet einer Erweiterung 60 auditierte Batches pro Minute. Ein
  Scan über ein sehr großes Inventar pausiert an dieser Grenze und macht beim
  nächsten Takt weiter; Jetzt ausführen sagt das in seinem Ergebnis, und der
  nächste Scan nimmt die verbleibenden Karten auf.
- Eine Regel, die *eine Karte wird aktualisiert* beobachtet, sieht nur
  Änderungen, die nach ihrer Aktivierung vorgenommen wurden; nutzen Sie für die
  bestehende Landschaft Jetzt ausführen oder warten Sie auf den nächtlichen
  Abgleich. Bedingungen auf **was sich geändert hat** greifen nur bei
  Live-Aktualisierungen.
- Webhooks sind ausschließlich HTTPS, mit einem instanzspezifischen Geheimnis
  signiert, folgen niemals Weiterleitungen und laufen nach 10 Sekunden ab; die
  Antwort wird beim Lauf festgehalten.
- Eine Regel kann nur die Risiken aktualisieren, die sie selbst angelegt hat,
  und sie kann niemals eine Entscheidung unterzeichnen, ein Risiko in einen
  anderen Status überführen oder ein Todo erledigen — das bleiben menschliche
  Handlungen.
