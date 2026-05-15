# Planen Sie Ihren Rollout

Bevor Sie eine einzige Karte erstellen, nehmen Sie sich eine Stunde Zeit, um vier Fragen zu beantworten. Die Teams, die diesen Schritt überspringen, enden mit einem Inventar, dem niemand vertraut, weil sich niemand darauf geeinigt hat, wofür es da war.

## 1. Definieren Sie einen engen Geltungsbereich

Der größte Fehler bei EA-Rollouts ist der Versuch, das gesamte Unternehmen auf einmal zu modellieren. Wählen Sie **eines** der folgenden:

- Eine **Geschäftsdomäne** (z. B. Vertrieb, Finanzen, Kundenservice, Produktion).
- Eine **juristische Einheit** oder **Region** (eine Tochtergesellschaft, ein Land, eine kürzlich erworbene Geschäftseinheit).
- Eine **Plattform** (z. B. der E-Commerce-Stack, die Datenplattform, das ERP-Portfolio).

Ein guter erster Geltungsbereich enthält etwa **50–200 Anwendungen**. Weniger und es gibt nichts zu analysieren; mehr und Ihnen wird die Energie ausgehen, bevor Sie zur Analyse kommen.

!!! warning "Nicht tun"
    Wählen Sie nicht „das gesamte Unternehmen" oder „die gesamte IT". Sie werden drei Monate damit verbringen, Daten zu jagen und nie zu einem funktionierenden Bericht kommen.

## 2. Wählen Sie den richtigen ersten Anwendungsfall

Der Anwendungsfall entscheidet, welche Felder wichtig sind, welche Stakeholder Sie benötigen und welchen Bericht Sie am Ende zeigen werden. Der häufigste — und derjenige, den dieser Leitfaden ab Seite 3 voraussetzt — ist:

> **Anwendungsportfolio-Rationalisierung**
>
> Inventarisieren Sie die im Geltungsbereich befindlichen Anwendungen, klassifizieren Sie jede nach Geschäftswert und technischer Eignung und entscheiden Sie, was zu **T**olerieren, in was zu **I**nvestieren, was zu **M**igrieren und was zu **E**liminieren ist (das TIME-Framework).

Andere gültige erste Anwendungsfälle — aber wählen Sie **einen**:

| Anwendungsfall | Was Sie hauptsächlich befüllen | Was Sie überspringen |
|----------|----------------------------|------------------|
| **Anwendungsportfolio-Rationalisierung** | Anwendungen, Kosten, Lebenszyklus, Geschäftswert | Detailliertes Prozessmodell, Schnittstellen |
| **Capability-basierte Planung** | Business Capabilities, Anwendungen, Capability Heatmap | Kostendetails, Technologie-Stack |
| **Cloud-Migrationsbewertung** | Anwendungen, IT-Komponenten, Bereitstellungsmodell | Geschäftswert, Prozesse |
| **M&A-Integration** | Beide Portfolios als Anwendungen, Überschneidungsanalyse | Langfristige Lebenszyklusdaten |

Wenn Sie unsicher sind, **wählen Sie Anwendungsportfolio-Rationalisierung**. Es ist der universellste nützliche Ausgangspunkt, und der Rest dieses Leitfadens ist darauf ausgerichtet.

## 3. Identifizieren Sie Ihre Stakeholder

Turbo EA verfügt über ein integriertes **Stakeholder**-Modell (siehe [Kartendetails](../guide/card-details.md)): Jede Karte trägt eine Liste von Personen in definierten Rollen (Business Owner, Technical Owner usw.), pro Kartentyp im Metamodell definiert. Entscheiden Sie im Voraus, wer jede Rolle für eine Anwendung ausfüllt:

- **Application Owner** — verantwortlich für die Anwendung im Geschäftsbereich. Eine Person pro App. Sie zeichnet die TIME-Disposition ab.
- **Technical Owner** — verantwortlich dafür, dass sie läuft. Häufig der Engineering Manager.
- **Architect** — wahrscheinlich Sie. Agiert als EA-seitiger Prüfer und genehmigt Karten.

Sie müssen nicht am ersten Tag Stakeholder für jede Karte zuweisen, aber Sie müssen wissen, wer sie *sein werden* — denn in Woche drei werden Sie ihnen Umfragen senden, um die Daten zu validieren.

!!! tip "Bewährte Praxis"
    Ein echter Name in der Rolle des Application Owner ist mehr wert als zehn perfekt ausgefüllte benutzerdefinierte Felder. Wenn Sie jemals nur ein Feld über Name und Lebenszyklus hinaus befüllen, machen Sie es zum Application Owner.

## 4. Setzen Sie ein realistisches Datenqualitätsziel

Turbo EA berechnet einen **Data Quality**-Score (0–100 %) für jede Karte, basierend auf den im Metamodell definierten gewichteten Feldern. Es ist der einzige beste Frühindikator dafür, ob Ihr Inventar nutzbar ist.

Realistische Ziele für die ersten 90 Tage:

| Phase | Ziel-Ø-Datenqualität (Anwendungen) | Was befüllt ist |
|-------|----------------------------------------|---------------|
| Ende Woche 2 (Crawl) | **40–60 %** | Name, Lebenszyklusphase, Beschreibung, Business Owner |
| Ende Woche 6 (Walk) | **60–75 %** | + Capability-Mapping, Kosten, TIME-Disposition |
| Ende Monat 3 (Run) | **75–90 %** | + Technologie-Stack, Schnittstellen, benutzerdefinierte Domänenfelder |

Streben Sie nicht 100 % an. Die letzten 10 % kosten mehr als die ersten 60 % und ändern selten eine Entscheidung.

## 5. Verpflichten Sie sich zu einem einzelnen Liefergegenstand

Beenden Sie Ihre Planungssitzung mit einer schriftlichen Aussage wie:

> *„Bis Ende Woche 6 wird das Inventar der Vertriebsdomäne jede Anwendung mit jährlichen Kosten > 50.000 € enthalten, die jeweils mindestens einer Business Capability zugeordnet ist und eine TIME-Disposition trägt. Wir werden den Portfolio-Bericht in Woche 7 dem Vertriebs-CIO präsentieren."*

Heften Sie ihn an ein Wiki, in eine Kickoff-Folie, in eine Slack-Kanalbeschreibung — irgendwo sichtbar. Dieser Satz ist es, der den Rollout davon abhält, in das Fegefeuer „wir sammeln noch Daten" abzudriften.

Weiter: [Beginnen Sie mit Ihrem Anwendungsinventar](start-with-applications.md).
