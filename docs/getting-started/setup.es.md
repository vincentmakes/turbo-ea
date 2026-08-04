# Instalación y configuración

Esta guía le acompaña a través de la instalación de Turbo EA con Docker, la configuración del entorno, la carga de datos de demostración y el inicio de servicios opcionales como sugerencias de IA y el servidor MCP.

## Requisitos previos

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

Aproximadamente 2 GB de espacio libre en disco, unos minutos de ancho de banda para el primer pull de imágenes y los puertos `8920` (HTTP) y opcionalmente `9443` (HTTPS) libres en el host.

## Paso 1: Obtener la configuración

Necesita `docker-compose.yml` y un archivo `.env` configurado en un directorio de trabajo. La forma más sencilla es clonar el repositorio:

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Abra `.env` y establezca los dos valores obligatorios:

```dotenv
# Credenciales de PostgreSQL (utilizadas por el contenedor de base de datos integrado).
# Elija una contraseña fuerte — persiste en el volumen integrado.
POSTGRES_PASSWORD=choose-a-strong-password

# Clave de firma JWT. Genere una con:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

Todo lo demás en `.env.example` tiene valores predeterminados razonables.

!!! note
    El backend se niega a iniciarse con el `SECRET_KEY` de ejemplo fuera del entorno de desarrollo. Genere uno real antes de continuar.

## Paso 2: Pull y arranque

El stack integrado (Postgres + backend + frontend + nginx perimetral) se ejecuta desde imágenes multi-arquitectura precompiladas en GHCR — no se requiere compilación local:

```bash
docker compose pull
docker compose up -d
```

Abra **http://localhost:8920** y registre el primer usuario. El primer usuario registrado se promueve automáticamente a **Admin**.

Para cambiar el puerto del host, establezca `HOST_PORT` en `.env` (predeterminado `8920`). La terminación HTTPS directa se trata en el [Paso 5](#paso-5-https-directo-opcional).

## Paso 3: Cargar datos de demostración (opcional)

Turbo EA puede iniciarse vacío (solo el metamodelo integrado) o con el conjunto de datos de demostración **NexaTech Industries**, ideal para evaluación, formación y exploración de funciones.

Establezca el flag de seed en `.env` **antes del primer arranque**:

```dotenv
SEED_DEMO=true
```

Luego `docker compose up -d` (si ya ha arrancado, consulte «Restablecer y volver a sembrar» más abajo).

### Opciones de carga

| Variable | Predeterminado | Descripción |
|----------|----------------|-------------|
| `SEED_DEMO` | `false` | Carga el conjunto completo de NexaTech Industries, incluidos datos BPM y PPM |
| `SEED_BPM` | `false` | Carga solo procesos BPM de demostración (subconjunto de `SEED_DEMO`) |
| `SEED_PPM` | `false` | Carga solo datos de proyectos PPM (subconjunto de `SEED_DEMO`) |
| `RESET_DB` | `false` | Elimina todas las tablas y las recrea desde cero al iniciar |

`SEED_DEMO=true` ya incluye datos BPM y PPM — no es necesario establecer los flags de subconjunto por separado.

!!! note "Los datos de demostración se cargan una sola vez"
    Cada cargador se ejecuta **una vez por instalación** y lo registra. Eliminar
    contenido de demostración — un diagrama de ejemplo, una encuesta de
    demostración — es definitivo: no volverá en el siguiente reinicio, aunque
    `SEED_DEMO=true` siga definido. Para recuperar el conjunto de datos de
    demostración, restablece la base de datos (consulta *Restablecer y recargar*
    más abajo).

### Cuenta de administrador de demostración

Cuando se cargan los datos de demostración, se crea una cuenta de administrador predeterminada:

| Campo | Valor |
|-------|-------|
| **Email** | `admin@turboea.demo` |
| **Contraseña** | `TurboEA!2025` |
| **Rol** | Admin |

!!! warning
    La cuenta de administrador de demostración utiliza credenciales conocidas y públicas. Cambie la contraseña — o cree su propia cuenta de administrador y deshabilite ésta — para cualquier entorno más allá de la evaluación local.

### Qué incluye la demostración

Aproximadamente 150 cards a través de las cuatro capas de arquitectura, además de relaciones, etiquetas, comentarios, tareas, diagramas BPM, datos PPM, ADR y un Statement of Architecture Work:

- **Núcleo EA** — Organizaciones, ~20 Capacidades de Negocio, Contextos de Negocio, ~15 Aplicaciones, ~20 Componentes IT, Interfaces, Objetos de Datos, Plataformas, Objetivos, 6 Iniciativas, 5 grupos de etiquetas, 60+ relaciones.
- **BPM** — ~30 procesos de negocio en una jerarquía de 4 niveles con diagramas BPMN 2.0, vínculos elemento-a-card y evaluaciones de procesos.
- **PPM** — Informes de estado, Work Breakdown Structures, ~60 tareas, líneas de presupuesto y coste, y un registro de riesgos sobre las 6 Iniciativas de demostración.
- **EA Delivery** — Architecture Decision Records y Statements of Architecture Work.

### Restablecer y volver a sembrar

Para borrar la base de datos y empezar de nuevo:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Reinicie el stack, luego **elimine `RESET_DB=true` de `.env`** — dejarlo establecido restablecerá la base de datos en cada reinicio:

```bash
docker compose up -d
# Verifique que los nuevos datos están ahí, luego edite .env para eliminar RESET_DB
```

## Paso 4: Servicios opcionales (perfiles de Compose)

Ambos complementos son opcionales mediante perfiles de Docker Compose y se ejecutan junto al stack principal sin perturbarlo.

### Sugerencias de descripción con IA

Genere descripciones de cards con un LLM local (Ollama integrado) o un proveedor comercial. El contenedor Ollama integrado es la vía más sencilla para configuraciones autohospedadas.

Añada a `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Inicie con el perfil `ai`:

```bash
docker compose --profile ai up -d
```

El modelo se descarga automáticamente en el primer arranque (unos minutos, dependiendo de su conexión). Consulte [Capacidades de IA](../admin/ai.md) para la referencia completa de configuración, incluido cómo usar OpenAI / Gemini / Claude / DeepSeek en lugar del Ollama integrado.

### Servidor MCP

El servidor MCP permite que herramientas de IA — Claude Desktop, Cursor, GitHub Copilot y otras — consulten sus datos EA mediante el [Model Context Protocol](https://modelcontextprotocol.io/) con RBAC por usuario. Es de solo lectura.

```bash
docker compose --profile mcp up -d
```

Consulte [Integración MCP](../admin/mcp.md) para la configuración OAuth y los detalles de las herramientas.

### Ambos a la vez

```bash
docker compose --profile ai --profile mcp up -d
```

## Paso 5: HTTPS directo (opcional)

El nginx perimetral integrado puede terminar TLS por sí mismo — útil si no dispone de un proxy inverso externo. Añada a `.env`:

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

Coloque `cert.pem` y `key.pem` en `./certs/` (el directorio se monta en modo solo lectura dentro del contenedor de nginx). La imagen deriva `server_name` y el esquema reenviado de `TURBO_EA_PUBLIC_URL`, sirve HTTP y HTTPS, y redirige HTTP a HTTPS automáticamente.

Para configuraciones detrás de un proxy inverso existente (Caddy, Traefik, Cloudflare Tunnel), deje `TURBO_EA_TLS_ENABLED=false` y deje que el proxy gestione TLS.

## Permitir la inserción de diagramas (opcional)

Un [diagrama publicado](../guide/diagrams.md) puede insertarse en otro sitio — una página de Confluence, un portal de intranet — pero solo si indicas antes ese sitio. De forma predeterminada, ningún sitio externo puede colocar Turbo EA en un marco.

```dotenv
TURBO_EA_EMBED_ALLOWED_ORIGINS=https://tuempresa.atlassian.net
```

Separa varios orígenes con comas. Reinicia la pila para que el cambio surta efecto.

Esto se aplica **solo** a las páginas de diagramas publicados. La aplicación en sí — incluido el editor de diagramas — no puede insertarse en ningún caso, y los enlaces publicados siguen funcionando al abrirlos directamente aunque no configures esto.

## Anclar una versión

`docker compose pull` toma `:latest` por defecto. Para anclar a una versión específica en producción, establezca `TURBO_EA_TAG`:

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

Las versiones publicadas se etiquetan como `:<full-version>`, `:<major>.<minor>`, `:<major>` y `:latest`. El workflow de publicación excluye las prereleases (`-rc.N`) de `:latest` y de las etiquetas cortas `:X.Y` / `:X`. Consulte [Publicaciones](../reference/releases.md) para el árbol completo de etiquetas y la política del canal de prelanzamiento.

## Usar un PostgreSQL existente

Si ya ejecuta una instancia de PostgreSQL gestionada o compartida, apunte el backend a ella y prescinda del servicio `db` integrado.

Cree la base de datos y el usuario en su servidor existente:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

Sobreescriba las variables de conexión en `.env`:

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

Luego inicie como de costumbre: `docker compose up -d`. El servicio `db` integrado sigue definido en `docker-compose.yml`; puede dejarlo en reposo o detenerlo explícitamente.

### Presupuesto de conexiones

El backend se ejecuta como un único proceso y abre **hasta `DB_POOL_SIZE + DB_MAX_OVERFLOW` conexiones (30 de forma predeterminada)**. El servicio `db` incluido permite 100, por lo que los valores predeterminados nunca causan problemas ahí. Una instancia gestionada en un plan económico suele limitar la base de datos muy por debajo de 30, y PostgreSQL responde entonces:

```
too many connections for database "turboea"
```

Compruebe sus límites antes de cambiar:

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

`-1` en `datconnlimit` o `rolconnlimit` significa «sin límite específico»; cualquier valor inferior a 30 exige subir el tope o reducir el pool:

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

Un pool más pequeño significa menos solicitudes atendidas simultáneamente, no solicitudes perdidas: cuando el pool está lleno, una solicitud espera hasta `DB_POOL_TIMEOUT` segundos a que se libere una conexión. Deje algunas conexiones libres para las copias de seguridad y sus propias sesiones de `psql`.

## Verificar imágenes

Desde `1.0.0` cada imagen publicada está firmada con cosign keyless OIDC y se distribuye con una SBOM SPDX generada por buildkit. Consulte [Cadena de suministro](../admin/supply-chain.md) para el comando de verificación y cómo obtener la SBOM desde el registry.

## Desarrollo desde el código fuente

Si desea construir el stack desde el código fuente (modificando código de backend o frontend), use la sobrescritura de Compose para desarrollo:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

O el target de conveniencia:

```bash
make up-dev
```

La guía completa para desarrolladores — nomenclatura de ramas, comandos de lint y pruebas, comprobaciones pre-commit — está en [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md).

## Referencia rápida

| Escenario | Comando |
|-----------|---------|
| Primer arranque (datos vacíos) | `docker compose pull && docker compose up -d` |
| Primer arranque con datos de demostración | Establezca `SEED_DEMO=true` en `.env`, luego el mismo comando |
| Añadir sugerencias de IA | Añada variables IA, luego `docker compose --profile ai up -d` |
| Añadir servidor MCP | `docker compose --profile mcp up -d` |
| Anclar una versión | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| Restablecer y volver a sembrar | `RESET_DB=true` + `SEED_DEMO=true`, reinicie, luego elimine `RESET_DB` |
| Usar Postgres externo | Sobrescriba variables `POSTGRES_*` en `.env`, luego `docker compose up -d` |
| Construir desde código fuente | `make up-dev` |

## Próximos pasos

- Abra **http://localhost:8920** (o su `HOST_PORT` configurado) e inicie sesión. Si cargó datos de demostración, use `admin@turboea.demo` / `TurboEA!2025`. De lo contrario, regístrese — el primer usuario se promueve automáticamente a Admin.
- Explore el [Dashboard](../guide/dashboard.md) para una vista general de su panorama EA.
- Personalice [tipos de cards y campos](../admin/metamodel.md) — el metamodelo está totalmente basado en datos, sin cambios de código.
- Para despliegues productivos, revise [Política de compatibilidad](../reference/compatibility.md) y [Cadena de suministro](../admin/supply-chain.md).
