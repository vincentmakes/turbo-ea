# Versiones y canal de versiones preliminares

Cómo Turbo EA versiona, etiqueta y publica imágenes de contenedor. Esta página es una referencia para operadores que necesitan fijar versiones en producción y para colaboradores que preparan versiones.

---

## Versionado

Turbo EA sigue [Semantic Versioning](https://semver.org/). La única fuente de verdad de la versión actual es el archivo `/VERSION` en la raíz del repositorio.

- **Patch** (p. ej., `1.0.0` → `1.0.1`): solo correcciones de errores. Siempre es seguro actualizar.
- **Minor** (p. ej., `1.0.0` → `1.1.0`): nuevas funciones. Compatible con versiones anteriores según la [política de compatibilidad](compatibility.md).
- **Major** (p. ej., `1.x` → `2.0.0`): cambios incompatibles. La versión incluye notas de migración.

La versión se incrementa una vez por PR, no por commit. La entrada del CHANGELOG del PR usa la nueva versión como encabezado; CI falla con [`version-check.yml`](https://github.com/TommasoChi/turbo-ea/blob/main/.github/workflows/version-check.yml) si se incrementa `/VERSION` sin un encabezado `## [<version>]` correspondiente en `CHANGELOG.md`.

---

## Etiquetas de imágenes de contenedor

Cada push a `main` y cada etiqueta `v*.*.*` activa `.github/workflows/docker-publish.yml`, que compila y publica en GHCR imágenes multiarquitectura (`amd64` + `arm64`).

Para una etiqueta de versión como `v1.2.3`, las etiquetas publicadas para cada imagen son:

| Etiqueta       | Apunta a                         | ¿Estable?                             |
|----------------|----------------------------------|---------------------------------------|
| `1.2.3`        | exactamente esa versión          | sí — fíjela en producción              |
| `1.2`          | el último parche de `1.2.x`      | avanza con los parches                 |
| `1`            | la última versión minor de `1.x` | avanza con las versiones minor         |
| `latest`       | la última versión no preliminar  | avanza con cada versión                |
| `sha-<short>`  | el commit exacto                  | sí — depuración / versión preliminar   |

En los pushes a `main` (sin etiqueta), solo se generan las etiquetas `main` y `sha-<short>`: nunca `latest` ni ninguna etiqueta semver.

Todos los manifiestos de imágenes publicados están firmados con Cosign mediante OIDC sin clave. Los detalles de verificación y SBOM están en [Supply Chain](../admin/supply-chain.md).

---

## Canal de versiones preliminares

Para versiones minor que cambian la disposición de los contenedores, las imágenes base, los UID predeterminados, los nombres de volumen, los puertos predeterminados o el esquema de forma que requiere acciones del operador, se crea una **release candidate** antes de la etiqueta final.

Convenciones:

- Las etiquetas RC tienen el formato `vX.Y.0-rc.N`: nunca para una versión patch, solo para versiones minor con cambios visibles para el operador.
- `docker/metadata-action` del flujo de publicación está configurado con `flavor: latest=auto`. Esto excluye automáticamente las etiquetas semver preliminares de `:latest`, `:X.Y` y `:X`; las RC solo se publican como `:X.Y.0-rc.N`. Así, los operadores que fijan `:latest` no obtienen accidentalmente una RC.
- GitHub marca automáticamente como versión preliminar las releases etiquetadas `vX.Y.0-rc.N`. Una etiqueta estable crea una release ordinaria.

Periodo de prueba:

- Una RC permanece disponible al menos **48–72 horas**, o hasta que al menos un operador ajeno al equipo mantenedor confirme una actualización correcta, lo que dure más.
- Los informes de errores de una RC se publican como `vX.Y.0-rc.N+1` si merece la pena corregirlos. La RC anterior permanece en GHCR para poder reproducirla.

Promoción a la versión final:

- La etiqueta final `vX.Y.0` apunta al merge del PR de promoción, que actualiza la versión y el changelog después de la última RC. El flujo de publicación reconstruye y vuelve a etiquetar las imágenes multiarquitectura; el digest diferirá del de la RC porque cambian la versión y las entradas de compilación.
- En ese momento, las etiquetas `:X.Y`, `:X` y `:latest` pasan a apuntar a la versión final.

---

## Publicar una versión (lista del mantenedor)

Para una versión patch o minor normal, no hace falta un canal RC:

1. En una rama de funcionalidad, incremente `VERSION` y añada el encabezado correspondiente `## [<version>] - YYYY-MM-DD` a `CHANGELOG.md`.
2. Ejecute `python scripts/dump_openapi.py` si ha cambiado alguna ruta del backend o algún esquema; confirme el resultado si ha cambiado.
3. Abra el PR. CI ejecuta lint, pruebas, la comprobación de diferencias de OpenAPI y `version-check.yml`.
4. Fusione mediante squash en `main`. Antes de etiquetar ese commit, ejecute `security-audit` y `ponytail-audit` en todo el repositorio. Lea ambos informes, resuelva los hallazgos de seguridad bloqueantes y todos los Must y Should, y compruebe que ambas auditorías cubren el commit final. En un chat de Codex o Claude, registre los dos informes completados según se describe en `SETUP.md`. Esto se aplica tanto a las etiquetas estables como a las release candidates.
5. Desde `main`: ejecute `git tag -s v<version> -m "v<version>"` (o `git tag v<version>` si no hay una clave de firma configurada) y `git push origin v<version>`.
6. El flujo `Publish GitHub Release` extrae la sección `## [<version>]` de `CHANGELOG.md` y crea una GitHub Release.
7. El flujo `Publish Docker images to GHCR` compila, firma y publica las imágenes multiarquitectura.
8. Verifique con Cosign:
   ```bash
   cosign verify \
     --certificate-identity-regexp '^https://github\.com/TommasoChi/turbo-ea/\.github/workflows/docker-publish\.yml@refs/(heads/main|tags/v[^/]+)$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     ghcr.io/tommasochi/turbo-ea/backend:<version>
   ```
   Requiere Cosign 2.6 o posterior (o 3.x): la firma es un paquete Sigstore; consulte [Supply Chain](../admin/supply-chain.md).

Para una versión minor que requiere una RC:

1. Siga el mismo flujo de PR y fusión que se indicó arriba, pero cambie la versión a `1.Y.0-rc.1`.
2. Después de fusionar, etiquete `v1.Y.0-rc.1` y súbalo. El flujo de publicación compila y publica las imágenes RC (solo `:1.Y.0-rc.1`, nunca `:latest` ni etiquetas cortas; `flavor: latest=auto` se encarga de ello). GitHub marca automáticamente la release como versión preliminar.
3. Espere el periodo de prueba. Resuelva los problemas notificados con `-rc.2`, `-rc.3` según sea necesario.
4. Para promocionarla, cambie `VERSION` a `1.Y.0` en un PR final (la entrada del CHANGELOG consolida todas las correcciones de las RC), fusione, ejecute y registre ambas auditorías de versión sobre el commit final y, después, etiquete `v1.Y.0` y súbalo. Las etiquetas `:latest` y las cortas apuntarán entonces a la versión promocionada.

---

## Fin de vida útil

Solo la línea minor más reciente recibe correcciones de seguridad. Consulte [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md) para ver la política completa. Las líneas minor antiguas han llegado al fin de vida útil y no recibirán adaptaciones retroactivas; los operadores de versiones antiguas deben planificar las actualizaciones conforme a la política de compatibilidad.
