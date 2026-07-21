# Operaciones y actualizaciones

Esta página es la guía del operador para ejecutar Turbo EA en producción: cómo funcionan las actualizaciones y las migraciones de base de datos, cómo hacer copias de seguridad y revertir, qué entornos conviene tener y los tropiezos que atrapan a los equipos a gran escala.

## Imágenes de producción y fijación de versión

Las imágenes publicadas en `ghcr.io/vincentmakes/turbo-ea/*` son la forma recomendada de ejecutar producción: el `docker-compose.yml` estándar las descarga por defecto, y compilar desde el código fuente es un flujo de trabajo de desarrollo. Más allá de la comodidad, las imágenes publicadas ofrecen garantías de cadena de suministro que una compilación local no tiene: cada publicación es multiarquitectura (amd64 + arm64), está firmada con cosign (OIDC sin clave, verificable contra la identidad del workflow de GitHub Actions) y atestiguada con procedencia SLSA y un SBOM. Las imágenes se bloquean en la publicación ante CVE críticos, se reescanean a diario una vez publicadas y se reconstruyen semanalmente contra repositorios Alpine actualizados, de modo que los parches de las imágenes base llegan automáticamente. Si su organización exige verificación de firmas de imágenes en la admisión, las firmas cosign encajan directamente — consulte [Cadena de suministro](supply-chain.md) para los comandos de verificación.

El hábito más importante: **fije su versión**. La etiqueta `:latest` se reasigna en cada versión publicada y en la reconstrucción semanal — no en cada commit —, por lo que puede moverse según un calendario que usted no controla. Defina una etiqueta explícita en su `.env`:

```bash
TURBO_EA_TAG=2.23.1
```

Consulte [Fijar una versión](../getting-started/setup.md) para lo básico y [Versiones](../reference/releases.md) para el árbol completo de etiquetas y la política de canales de prelanzamiento.

## PostgreSQL gestionado

En entornos corporativos con acceso a un servicio de PostgreSQL gestionado — Azure Database for PostgreSQL, Amazon RDS / Aurora, Google Cloud SQL o similar —, ejecutar Turbo EA contra ese servicio es la configuración recomendada. El contenedor `db` incluido es un valor por defecto sin dependencias, no un requisito: apunte el backend a su instancia con las variables `POSTGRES_*` y omita el servicio incluido (consulte [Usar un PostgreSQL existente](../getting-started/setup.md)).

Lo que el servicio gestionado le quita de encima:

- **Copias de seguridad y recuperación a un punto en el tiempo (PITR)** — automatizadas, con retención gestionada y restaurables a cualquier momento; exactamente lo que necesita la estrategia de reversión de más abajo.
- **Alta disponibilidad y conmutación por error** — redundancia zonal o regional sin operar su propia replicación.
- **Parcheo del motor, cifrado en reposo, aislamiento de red** — gestionados según la línea base de cumplimiento de su organización (puntos de conexión privados, integración con IAM).

Tres cosas que **no** cambian: el backend sigue ejecutando sus propias migraciones de Alembic al arrancar (el modelo de actualización de esta página es idéntico), el volumen `backend_data` sigue necesitando su propia copia de seguridad (los adjuntos y las extensiones no viven en PostgreSQL), y la custodia del `SECRET_KEY` sigue siendo suya. La imagen incluida trae PostgreSQL 18 — sirve cualquier versión mayor reciente que ofrezca su proveedor.

## Cómo funcionan las actualizaciones: migraciones de Alembic

La compatibilidad del esquema de base de datos se gestiona automáticamente mediante [Alembic](https://alembic.sqlalchemy.org/). Al arrancar, el backend ejecuta `alembic upgrade head`, de modo que cada migración pendiente entre su esquema actual y la nueva versión se aplica — en orden — antes de que la aplicación sirva tráfico.

Las migraciones están numeradas secuencialmente y son acumulativas, lo que hace que los saltos de versión sean seguros: si actualiza, por ejemplo, de 2.10 a 2.23, todas las migraciones intermedias se ejecutan en secuencia. No necesita pasar por cada versión menor.

Algunos comportamientos que conviene conocer:

| Situación | Qué ocurre al arrancar |
|---|---|
| Base de datos nueva | Las tablas se crean directamente y la base se marca en head — sin repetición de migraciones. |
| Base de datos existente | Las migraciones pendientes se ejecutan automáticamente antes de que la API esté disponible. |
| `RESET_DB=true` | Todas las tablas se eliminan, se recrean y se vuelven a poblar. Nunca lo active en producción. |

Dentro de una misma línea de versión mayor, las migraciones se mantienen aditivas y compatibles hacia atrás al actualizar — consulte la [Política de compatibilidad](../reference/compatibility.md) para el contrato completo.

!!! warning "Nunca ejecute un backend antiguo contra un esquema más nuevo"
    Alembic solo migra hacia adelante al arrancar. Código antiguo contra un esquema más nuevo es comportamiento indefinido — esta es la restricción clave de la reversión (ver más abajo).

## El procedimiento de actualización

1. **Lea el changelog.** Revise las entradas de `CHANGELOG.md` entre su versión actual y la de destino. Los cambios incompatibles incrementan la versión mayor.
2. **Haga una copia de seguridad** de la base de datos y del volumen de datos (ver más abajo).
3. **Suba la etiqueta y descargue:**

    ```bash
    TURBO_EA_TAG=2.24.0 docker compose pull
    docker compose up -d
    ```

4. **Observe los registros de arranque** y confirme que las migraciones terminan limpiamente antes de que la API sirva tráfico:

    ```bash
    docker compose logs -f backend
    ```

!!! note "Ventanas de mantenimiento"
    Las migraciones suelen ser rápidas, pero con inventarios grandes algunas migraciones de datos pueden tardar unos minutos, durante los cuales el backend no responde. Programe las actualizaciones en una ventana de mantenimiento.

## Copias de seguridad

Haga una copia de seguridad **antes de cada actualización**, y automatice una nocturna en cualquier caso:

```bash
docker compose exec db pg_dump -U turboea turboea > backup-$(date +%F).sql
```

Ajuste el usuario y el nombre de la base si cambió `POSTGRES_USER` / `POSTGRES_DB`. Un snapshot del volumen `postgres_data` es una alternativa equivalente. En un [servicio de PostgreSQL gestionado](#postgresql-gestionado), prefiera las copias automatizadas y la recuperación a un punto en el tiempo del proveedor antes que los dumps artesanales — un `pg_dump` ocasional sigue mereciendo la pena como copia portable e independiente del proveedor.

Respalde también el volumen **`backend_data`** — contiene los archivos adjuntos, las extensiones instaladas y los bundles de transferencia de espacio de trabajo que no residen en PostgreSQL.

Dos puntos más sobre la postura de recuperación:

- **Pruebe sus restauraciones periódicamente.** Una copia de seguridad que nunca se ha restaurado es una esperanza, no un plan.
- **Las tarjetas archivadas se eliminan de forma reversible** con una ventana de 30 días antes de la purga definitiva — esa es su red de seguridad para errores de datos, distinta de la recuperación de infraestructura.

## Reversión y recuperación

Las migraciones de esquema son en la práctica **solo hacia adelante en producción**: aunque Alembic admite técnicamente las reversiones, las migraciones que transportan datos no siempre pueden revertirse sin pérdidas, y la aplicación nunca ejecuta reversiones automáticamente. La estrategia de reversión fiable es:

1. Detenga la pila.
2. Restaure la copia de seguridad de la base de datos tomada antes de la actualización (en PostgreSQL gestionado: restauración a un punto en el tiempo justo anterior a la actualización).
3. Devuelva `TURBO_EA_TAG` a la versión anterior.
4. `docker compose up -d` — la base restaurada coincide con el esquema del código antiguo, por lo que todo es coherente.

!!! warning "Nunca revierta solo la imagen"
    Revertir la imagen manteniendo la base de datos migrada es la única combinación de la que el sistema de migración automática no puede protegerle. La copia de seguridad de la base y la etiqueta de la imagen se mueven juntas.

## Entornos y gobernanza de versiones

Para la mayoría de las organizaciones, **dos entornos** (Staging + Producción) son suficientes, porque las actualizaciones son imágenes publicadas por el proveedor, no compilaciones propias — usted valida, no desarrolla. Una cadena completa Dev/SIT/UAT/Prod aporta valor sobre todo si construye extensiones propias o integraciones pesadas.

| Entorno | Propósito | Notas |
|---|---|---|
| Dev / sandbox (opcional) | Probar cambios de metamodelo, demostraciones | `SEED_DEMO=true` para el conjunto de datos de demostración; `RESET_DB=true` da un comienzo limpio. |
| Staging | Validar primero las versiones nuevas | Datos similares a producción; recibe primero las etiquetas nuevas. |
| Producción | Etiqueta fijada, copias de seguridad, actualizaciones en ventana de mantenimiento | Nunca `latest`, nunca `RESET_DB`. |

Dos buenas formas de llevar datos realistas a staging:

- **[Transferencia de espacio de trabajo](workspace-transfer.md)**: exporte el espacio de trabajo de producción como un bundle `.zip` e impórtelo en staging. Los secretos (credenciales SMTP, SSO, IA, ServiceNow) se eliminan por diseño y nunca salen de la instancia.
- **Restauración de base de datos**: restaure un `pg_dump` de producción en la base de staging (en un servicio gestionado, también funciona bien un clon o una restauración a un punto en el tiempo de la instancia de producción). Los secretos cifrados en la base derivan de `SECRET_KEY`, así que staging necesita el mismo `SECRET_KEY` o deberá reintroducir allí las credenciales de integración.

En cuanto a la gobernanza:

- Trate el archivo `.env` y el `TURBO_EA_TAG` fijado como configuración como código — guárdelos en su Git interno y convierta las actualizaciones en un cambio revisado (una pull request que sube la etiqueta).
- Como staging y producción descargan la misma etiqueta GHCR fijada, usted valida el artefacto idéntico byte a byte que va a promover.
- Actualice staging → déjelo reposar unos días → promueva la misma etiqueta a producción.

## Tropiezos comunes

1. **Ejecutar `latest` sin fijar** — un `docker compose pull` rutinario se convierte en una actualización imprevista con migraciones imprevistas, al ritmo de las publicaciones y no al suyo.
2. **Actualizar sin copia de seguridad** — las migraciones son solo hacia adelante; la copia de seguridad *es* su reversión.
3. **Perder o cambiar `SECRET_KEY`** — firma los JWT *y* deriva la clave de cifrado de los secretos almacenados (credenciales SMTP, SSO, ServiceNow). Cambiarlo hace que los secretos almacenados sean indescifrables. Trátelo como una credencial de base de datos: en una bóveda, estable, respaldado.
4. **`RESET_DB=true` olvidado en un archivo de entorno** — hace exactamente lo que dice, en cada arranque.
5. **Editar la base de datos directamente** — el estado del esquema pertenece a Alembic, y el DDL manual chocará con migraciones futuras. Lo mismo aplica a los datos: use la API o la interfaz para que los permisos, los eventos de auditoría y el recálculo de la calidad de los datos sigan siendo correctos.
6. **No persistir los volúmenes** — `postgres_data` y `backend_data` deben sobrevivir a la recreación de contenedores; compruebe que sus herramientas de snapshot y copia de seguridad cubren ambos.
7. **Revertir la imagen sin restaurar la base de datos** — consulte [Reversión y recuperación](#reversion-y-recuperacion).
