# Cadena de suministro

A partir de la versión 1.0.0, las imágenes de contenedor que Turbo EA publica en GHCR llevan metadatos verificables de la cadena de suministro, de modo que los operadores puedan confirmar que una imagen procede de la CI de este proyecto antes de llevarla a producción.

Esta página explica qué se firma, qué versión de cosign necesita, cómo verificar una imagen y el chart de Helm, dónde está la SBOM y cómo encaja la puerta de Trivy.

---

## Qué se firma

Cada imagen construida por `.github/workflows/docker-publish.yml` y publicada en `ghcr.io/vincentmakes/turbo-ea/<image>` se firma con [cosign](https://github.com/sigstore/cosign) mediante **OIDC sin clave**: no existe ninguna clave de firma de larga duración. El certificado lo emite el Fulcio de Sigstore para la identidad del flujo de trabajo (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`), queda registrado en el registro público de transparencia Rekor y se descarta en cuanto se crea la firma.

Imágenes firmadas:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

El chart de Helm, `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`, lo firma del mismo modo `.github/workflows/helm-publish.yml` en cada etiqueta de versión (identidad `…/helm-publish.yml@<ref>`).

La imagen `ollama` se reconstruye manualmente fuera de la matriz y actualmente no está firmada; si depende del perfil de Ollama incluido y necesita verificación, constrúyala desde el código fuente.

La firma se aplica al digest de la lista de manifiestos OCI, así que una sola firma cubre de forma transparente tanto `linux/amd64` como `linux/arm64`. No hay firmas por plataforma que perseguir.

---

## Formato de la firma y versión de cosign necesaria

**Verifique con cosign 2.6 o posterior, o con cualquier versión 3.x.** Los clientes más antiguos — cosign 2.5 e inferiores — devuelven `no signatures found` para cada imagen y chart publicados desde la 1.37.0, aunque la firma está ahí.

La causa es un cambio en el formato de almacenamiento, no en la firma. Hasta la 1.36.0 el flujo de publicación usaba cosign 2, que guardaba la firma bajo la etiqueta `sha256-<digest>.sig` junto a la imagen. Desde la 1.37.0 (junio de 2026, cuando el instalador de cosign pasó a cosign 3) la firma es un [bundle de Sigstore](https://docs.sigstore.dev/about/bundle/): un *referrer* OCI 1.1 de la imagen. GHCR no implementa la API de referrers, así que cosign guarda el bundle bajo la etiqueta de índice alternativa `sha256-<digest>` — sin sufijo `.sig` —, justo el lugar que un cliente anterior a 2.6 nunca consulta. `cosign tree` muestra lo que hay adjunto a una imagen:

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| Versiones | Formato de la firma | Verificable con |
|-----------|---------------------|-----------------|
| 1.0.0 – 1.36.0 | etiqueta heredada `sha256-<digest>.sig` | cualquier cosign |
| 1.37.0 y posteriores, y todos los charts de Helm | bundle de Sigstore (referrer OCI) | cosign ≥ 2.6, o 3.x |

Cada publicación verifica ahora su propia firma con cosign 2.6 — el cliente más antiguo que promete esta página — antes de que el trabajo se dé por bueno, de modo que un futuro cambio de formato haría fallar la CI y no su despliegue. El proyecto emite deliberadamente una única firma en el formato actual de Sigstore: si un controlador de admisión o un motor de políticas de su clúster solo lee la etiqueta heredada, actualícelo en lugar de esperar una segunda firma.

---

## Verificar una imagen

Instale [cosign](https://docs.sigstore.dev/cosign/installation/) 2.6 o posterior y después:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

Qué hacen las opciones:

- `--certificate-identity-regexp` — acepta cualquier ruta de flujo de trabajo dentro de este repositorio, así que el mismo comando funciona tanto si la imagen se publicó desde `docker-publish.yml` en `main` como en una etiqueta. Si quiere ser más estricto, sustitúyala por `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`.
- `--certificate-oidc-issuer` — fija el emisor OIDC al punto de conexión de tokens de GitHub. Una firma emitida por cualquier otro emisor (por ejemplo, la CI de un fork) fallará la verificación.

Una verificación correcta imprime la carga firmada y una entrada del registro de transparencia Rekor. Un fallo termina con un código de salida distinto de cero y un diagnóstico — haga fallar su despliegue con él. Si el diagnóstico es `no signatures found`, compruebe primero `cosign version`: vea la sección anterior.

También puede verificar por digest, la forma más estricta (inmune a que se muevan las etiquetas):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## Verificar el chart de Helm

El chart es un artefacto OCI del mismo registro y se verifica con el mismo comando:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

Una excepción en la identidad de la etiqueta: el chart `2.141.0`, la primera versión del chart, se publicó sin firmar (su paso de firma falló en la autenticación con el registro) y se firmó después desde la rama `main`, así que su identidad de certificado es `…/helm-publish.yml@refs/heads/main` y no una referencia de etiqueta. La expresión regular anterior acepta ambas; una `--certificate-identity` estricta debe indicar `refs/heads/main` para esa única versión.

---

## SBOM

buildkit genera automáticamente una lista de materiales de software [SPDX](https://spdx.dev/) (`sbom: true` en el paso de construcción) y la adjunta a cada imagen como referrer OCI. No hay nada más que instalar — vive en el registro junto a la imagen.

Descárguela con:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

La SBOM enumera cada paquete que buildkit observó en la imagen final (paquetes apk, wheels de Python, módulos de Node, etc.) con versiones y URL de origen. Es una entrada útil para su propio escáner de vulnerabilidades, sus herramientas de cumplimiento de licencias o su inventario de componentes.

---

## Análisis de vulnerabilidades (Trivy)

El flujo de publicación ejecuta [Trivy](https://github.com/aquasecurity/trivy) sobre cada imagen construida en dos pasos:

- **Observación** — los hallazgos HIGH y CRITICAL se suben como SARIF a la pestaña **Security** del repositorio en GitHub. Este paso nunca hace fallar el trabajo.
- **Puerta** — cualquier hallazgo CRITICAL con corrección disponible **hace fallar la publicación**, salvo que la CVE figure en `.github/trivy-allowlist` con una justificación escrita (cada entrada se reevalúa trimestralmente y se retira en cuanto upstream publica un parche).

Los mismos dos pasos se repiten a diario contra los manifiestos `:latest` realmente publicados, y un hallazgo HIGH o CRITICAL corregible en una imagen publicada desencadena una reconstrucción contra repositorios de Alpine actualizados. Los hallazgos HIGH siguen siendo por ahora solo de observación: las bases son alpine (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`) y arrastran con regularidad hallazgos de fondo contra musl-libc y dependencias apk transitivas que ningún camino de código de Turbo EA alcanza, pero que Trivy notifica de todos modos.

**Para operadores:** la puerta protege las imágenes publicadas, pero ejecute también su propio escáner sobre la imagen descargada — su política puede diferir de la nuestra. La SBOM publicada es una entrada limpia.

**Para colaboradores:** si detecta un hallazgo realmente explotable en un camino de uso de Turbo EA, notifíquelo mediante un [aviso de seguridad privado](https://github.com/vincentmakes/turbo-ea/security/advisories/new) en lugar de comentar en una incidencia pública. Consulte [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## Fijación de acciones por SHA

Cada GitHub Action que usa el flujo de publicación está fijada a un SHA de commit de 40 caracteres, no a una etiqueta mayor flotante. Así, un mantenedor upstream comprometido o un typosquat no puede cambiar en silencio lo que se ejecuta en nuestra CI sin un diff visible en este repositorio. Las actualizaciones llegan a través del ecosistema `github-actions` de Dependabot con cadencia mensual, de modo que las renovaciones siguen produciéndose — solo que pasan por revisión.
