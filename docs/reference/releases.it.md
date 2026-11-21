# Release e canale delle pre-release

Come Turbo EA assegna le versioni, crea i tag e pubblica le immagini dei container. Questa pagina è un riferimento per gli operatori che devono fissare le versioni in produzione e per i collaboratori che preparano le release.

---

## Versionamento

Turbo EA segue [Semantic Versioning](https://semver.org/). L’unica fonte attendibile della versione corrente è il file `/VERSION` nella radice del repository.

- **Patch** (ad es. `1.0.0` → `1.0.1`): solo correzioni di bug. L’aggiornamento è sempre sicuro.
- **Minor** (ad es. `1.0.0` → `1.1.0`): nuove funzionalità. Compatibile con le versioni precedenti secondo la [policy di compatibilità](compatibility.md).
- **Major** (ad es. `1.x` → `2.0.0`): modifiche incompatibili. Le note di migrazione accompagnano la release.

La versione viene incrementata una volta per PR, non per commit. La voce del CHANGELOG del PR usa la nuova versione come intestazione; la CI fallisce con [`version-check.yml`](https://github.com/TommasoChi/turbo-ea/blob/main/.github/workflows/version-check.yml) se `/VERSION` viene incrementato senza la corrispondente intestazione `## [<version>]` in `CHANGELOG.md`.

---

## Tag delle immagini dei container

Ogni push a `main` e ogni tag `v*.*.*` avvia `.github/workflows/docker-publish.yml`, che compila e pubblica su GHCR immagini multi-architettura (`amd64` + `arm64`).

Per un tag di release come `v1.2.3`, i tag pubblicati per ogni immagine sono:

| Tag           | Punta a                         | Stabile?                              |
|---------------|----------------------------------|---------------------------------------|
| `1.2.3`       | esattamente quella release       | sì — fissare in produzione             |
| `1.2`         | l’ultima patch di `1.2.x`        | avanza con le patch                    |
| `1`           | l’ultima versione minor di `1.x` | avanza con le versioni minor           |
| `latest`      | l’ultima versione non preliminare | avanza a ogni release                 |
| `sha-<short>` | il commit esatto                 | sì — debug / pre-release               |

Per i push a `main` (senza tag), vengono creati solo i tag `main` e `sha-<short>` — mai `latest`, mai un tag semver.

Tutti i manifest delle immagini pubblicate sono firmati con Cosign tramite OIDC senza chiave. I dettagli di verifica e SBOM sono in [Supply Chain](../admin/supply-chain.md).

---

## Canale delle pre-release

Per le versioni minor che modificano la disposizione dei container, le immagini di base, gli UID predefiniti, i nomi dei volumi, le porte predefinite o lo schema in modo da richiedere un intervento dell’operatore, viene creata una **release candidate** prima del tag finale.

Convenzioni:

- I tag RC seguono il formato `vX.Y.0-rc.N` — mai per una release patch, solo per versioni minor con modifiche visibili agli operatori.
- `docker/metadata-action` del workflow di pubblicazione è configurato con `flavor: latest=auto`. Questo esclude automaticamente i tag semver di pre-release da `:latest`, `:X.Y` e `:X` — le RC vengono pubblicate solo come `:X.Y.0-rc.N`. Gli operatori che fissano `:latest` non scaricheranno per errore una RC.
- GitHub contrassegna automaticamente come pre-release una release con tag `vX.Y.0-rc.N`. Un tag stabile crea una release ordinaria.

Periodo di prova:

- Una RC resta disponibile per almeno **48–72 ore**, oppure finché almeno un operatore esterno al team maintainer non conferma un aggiornamento riuscito — vale il periodo più lungo.
- Le segnalazioni di bug relative a una RC vengono pubblicate come `vX.Y.0-rc.N+1` se la correzione è giustificata. La RC precedente resta su GHCR per consentire la riproducibilità.

Promozione alla versione finale:

- Il tag finale `vX.Y.0` punta al merge del PR di promozione, che aggiorna versione e changelog dopo l’ultima RC. Il workflow di pubblicazione ricompila e ritagga le immagini multi-architettura; il digest differisce da quello della RC perché cambiano la versione e gli input di compilazione.
- Da quel momento, i tag `:X.Y`, `:X` e `:latest` puntano alla release finale.

---

## Preparare una release (checklist del maintainer)

Per una normale release patch o minor non serve il canale RC:

1. Su un feature branch, incrementa `VERSION` e aggiungi l’intestazione corrispondente `## [<version>] - YYYY-MM-DD` a `CHANGELOG.md`.
2. Esegui `python scripts/dump_openapi.py` se è cambiata una route backend o uno schema; includi il risultato se è cambiato.
3. Apri il PR. La CI esegue lint, test, controllo delle differenze OpenAPI e `version-check.yml`.
4. Esegui lo squash merge in `main`. Prima di creare il tag per quel commit, esegui gli audit completi del repository `security-audit` e `ponytail-audit`. Leggi entrambi i rapporti, risolvi i rilievi di sicurezza bloccanti e tutti i rilievi Must e Should, quindi verifica che entrambi gli audit coprano il commit finale. In una chat Codex o Claude, registra i due rapporti completati come descritto in `SETUP.md`. Questo vale per i tag stabili e per i tag release candidate.
5. Da `main`: esegui `git tag -s v<version> -m "v<version>"` (oppure `git tag v<version>` se non è configurata una chiave di firma), quindi `git push origin v<version>`.
6. Il workflow `Publish GitHub Release` estrae la sezione `## [<version>]` da `CHANGELOG.md` e crea una GitHub Release.
7. Il workflow `Publish Docker images to GHCR` compila, firma e pubblica le immagini multi-architettura.
8. Verifica con Cosign:
   ```bash
   cosign verify \
     --certificate-identity-regexp '^https://github\.com/TommasoChi/turbo-ea/\.github/workflows/docker-publish\.yml@refs/(heads/main|tags/v[^/]+)$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     ghcr.io/tommasochi/turbo-ea/backend:<version>
   ```
   Richiede Cosign 2.6 o successivo (oppure 3.x) — la firma è un bundle Sigstore; vedi [Supply Chain](../admin/supply-chain.md).

Per una versione minor che richiede una RC:

1. Segui lo stesso flusso di PR e merge descritto sopra, ma incrementa la versione a `1.Y.0-rc.1`.
2. Dopo il merge, crea il tag `v1.Y.0-rc.1` e invialo. Il workflow di pubblicazione crea e pubblica le immagini RC (solo `:1.Y.0-rc.1`, mai `:latest` o tag brevi — `flavor: latest=auto` se ne occupa). GitHub contrassegna automaticamente la release come pre-release.
3. Attendi il periodo di prova. Risolvi eventuali problemi segnalati con `-rc.2`, `-rc.3` se necessario.
4. Per promuovere la release, incrementa `VERSION` a `1.Y.0` in un PR finale (la voce CHANGELOG riunisce tutte le correzioni delle RC), esegui il merge, quindi esegui e registra entrambi gli audit di release sul commit finale. Crea e invia poi il tag `v1.Y.0`. `:latest` e i tag brevi punteranno alla release promossa.

---

## Fine del ciclo di vita

Solo la serie minor più recente riceve correzioni di sicurezza. Consulta [`SECURITY.md`](https://github.com/TommasoChi/turbo-ea/blob/main/SECURITY.md) per la policy completa. Le serie minor precedenti sono a fine ciclo e non riceveranno backport — gli operatori delle versioni precedenti dovrebbero pianificare gli aggiornamenti secondo la policy di compatibilità.
