# Catena di approvvigionamento

A partire dalla versione 1.0.0, le immagini container che Turbo EA pubblica su GHCR portano metadati verificabili della catena di approvvigionamento, così che gli operatori possano confermare che un'immagine proviene dalla CI di questo progetto prima di portarla in produzione.

Questa pagina spiega cosa viene firmato, quale versione di cosign serve, come verificare un'immagine e il chart Helm, dove si trova la SBOM e come si inserisce il gate di Trivy.

---

## Cosa viene firmato

Ogni immagine costruita da `.github/workflows/docker-publish.yml` e pubblicata su `ghcr.io/vincentmakes/turbo-ea/<image>` è firmata con [cosign](https://github.com/sigstore/cosign) tramite **OIDC senza chiave**: non esiste alcuna chiave di firma a lunga durata. Il certificato è emesso dal Fulcio di Sigstore per l'identità del workflow (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`), registrato nel log pubblico di trasparenza Rekor e scartato appena la firma è stata creata.

Immagini firmate:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

Il chart Helm, `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`, è firmato nello stesso modo da `.github/workflows/helm-publish.yml` a ogni tag di release (identità `…/helm-publish.yml@<ref>`).

L'immagine `ollama` viene ricostruita manualmente fuori dalla matrice e al momento non è firmata; se dipendete dal profilo Ollama incluso e vi serve la verifica, costruitela dal sorgente.

La firma si applica al digest della manifest list OCI, quindi una sola firma copre in modo trasparente sia `linux/amd64` sia `linux/arm64`. Non c'è alcuna firma per piattaforma da rincorrere.

---

## Formato della firma e versione di cosign necessaria

**Verificate con cosign 2.6 o più recente, oppure con qualsiasi versione 3.x.** I client più vecchi — cosign 2.5 e precedenti — rispondono `no signatures found` per ogni immagine e chart pubblicati dalla 1.37.0 in avanti, anche se la firma c'è.

Il motivo è un cambio del formato di archiviazione, non della firma. Fino alla 1.36.0 il workflow di pubblicazione usava cosign 2, che salvava la firma sotto il tag `sha256-<digest>.sig` accanto all'immagine. Dalla 1.37.0 (giugno 2026, quando l'installer di cosign è passato a cosign 3) la firma è un [bundle Sigstore](https://docs.sigstore.dev/about/bundle/): un *referrer* OCI 1.1 dell'immagine. GHCR non implementa l'API referrers, perciò cosign conserva il bundle sotto il tag di indice di ripiego `sha256-<digest>` — senza suffisso `.sig` —, esattamente il punto che un client precedente alla 2.6 non guarda mai. `cosign tree` mostra cosa è allegato a un'immagine:

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| Release | Formato della firma | Verificabile con |
|---------|---------------------|------------------|
| 1.0.0 – 1.36.0 | tag legacy `sha256-<digest>.sig` | qualsiasi cosign |
| 1.37.0 e successive, e ogni chart Helm | bundle Sigstore (referrer OCI) | cosign ≥ 2.6, oppure 3.x |

Ogni pubblicazione ora verifica la propria firma con cosign 2.6 — il client più vecchio che questa pagina promette — prima che il job risulti verde, così un futuro cambio di formato farebbe fallire la CI e non il vostro deploy. Il progetto emette deliberatamente una sola firma, nel formato Sigstore corrente: se un admission controller o un motore di policy nel vostro cluster legge ancora solo il tag legacy, aggiornatelo invece di aspettarvi una seconda firma.

---

## Verificare un'immagine

Installate [cosign](https://docs.sigstore.dev/cosign/installation/) 2.6 o più recente, poi:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

Cosa fanno le opzioni:

- `--certificate-identity-regexp` — accetta qualsiasi percorso di workflow all'interno di questo repository, quindi lo stesso comando funziona sia che l'immagine sia stata pubblicata da `docker-publish.yml` su `main` sia su un tag. Se volete essere più rigorosi, sostituitela con `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`.
- `--certificate-oidc-issuer` — vincola l'emittente OIDC all'endpoint dei token di GitHub. Una firma emessa da qualsiasi altro emittente (ad esempio la CI di un fork) fallirà la verifica.

Una verifica riuscita stampa il payload firmato e una voce del log di trasparenza Rekor. Un fallimento termina con codice di uscita diverso da zero e una diagnostica — fate fallire il deploy su di essa. Se la diagnostica è `no signatures found`, controllate prima `cosign version`: vedere la sezione precedente.

Potete anche verificare per digest, la forma più rigorosa (immune allo spostamento dei tag):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## Verificare il chart Helm

Il chart è un artefatto OCI nello stesso registry e si verifica con lo stesso comando:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

Un'eccezione all'identità del tag: il chart `2.141.0`, la prima release del chart, è stato pubblicato ma non firmato (il suo passo di firma è fallito sull'autenticazione al registry) ed è stato firmato in seguito dal branch `main`, quindi la sua identità di certificato è `…/helm-publish.yml@refs/heads/main` e non un riferimento a tag. L'espressione regolare qui sopra le accetta entrambe; una `--certificate-identity` rigorosa deve indicare `refs/heads/main` per quella sola versione.

---

## SBOM

Una distinta base software [SPDX](https://spdx.dev/) viene generata automaticamente da buildkit (`sbom: true` nel passo di build) e allegata a ogni immagine come referrer OCI. Non c'è nulla di aggiuntivo da installare — vive nel registry accanto all'immagine.

Scaricatela con:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

La SBOM elenca ogni pacchetto che buildkit ha osservato nell'immagine finale (pacchetti apk, wheel Python, moduli Node, ecc.) con versioni e URL di origine. Un input utile per il vostro scanner di vulnerabilità, gli strumenti di conformità delle licenze o l'inventario dei componenti.

---

## Scansione delle vulnerabilità (Trivy)

Il workflow di pubblicazione esegue [Trivy](https://github.com/aquasecurity/trivy) su ogni immagine costruita, in due passi:

- **Osservazione** — i rilievi HIGH e CRITICAL vengono caricati come SARIF nella scheda **Security** del repository su GitHub. Questo passo non fa mai fallire il job.
- **Gate** — qualsiasi rilievo CRITICAL con una correzione disponibile **fa fallire la pubblicazione**, a meno che la CVE non sia elencata in `.github/trivy-allowlist` con una motivazione scritta (ogni voce viene rivalutata ogni trimestre e rimossa appena upstream rilascia una patch).

Gli stessi due passi vengono ripetuti ogni giorno sui manifest `:latest` effettivamente pubblicati, e un rilievo HIGH o CRITICAL correggibile su un'immagine pubblicata avvia una ricostruzione sui repository Alpine aggiornati. I rilievi HIGH restano per ora in sola osservazione: le basi sono alpine (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`) e portano regolarmente rilievi di fondo su musl-libc e dipendenze apk transitive che nessun percorso di codice di Turbo EA raggiunge, ma che Trivy segnala comunque.

**Per gli operatori:** il gate protegge le immagini pubblicate, ma eseguite anche il vostro scanner sull'immagine scaricata — la vostra policy può differire dalla nostra. La SBOM pubblicata è un input pulito.

**Per i contributori:** se individuate un rilievo davvero sfruttabile in un percorso d'uso di Turbo EA, segnalatelo tramite un [avviso di sicurezza privato](https://github.com/vincentmakes/turbo-ea/security/advisories/new) invece di commentare in una issue pubblica. Vedere [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## Pinning delle action allo SHA

Ogni GitHub Action usata dal workflow di pubblicazione è fissata a uno SHA di commit di 40 caratteri, non a un tag major mobile. Un maintainer upstream compromesso o un typosquat non può quindi cambiare in silenzio ciò che gira nella nostra CI senza un diff visibile in questo repository. Gli aggiornamenti passano dall'ecosistema `github-actions` di Dependabot con cadenza mensile, così i rinnovi avvengono comunque — solo attraverso una revisione.
