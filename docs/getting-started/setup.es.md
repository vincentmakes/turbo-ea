# Instalación y configuración

Esta guía le explica cómo instalar Turbo EA con Docker, configurar el entorno, cargar datos de demostración e iniciar servicios opcionales como la IA y el servidor MCP.

## Requisitos previos

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

## Paso 1: Clonar y configurar

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Abra `.env` en un editor de texto y configure los valores requeridos:

```dotenv
# Credenciales de PostgreSQL (utilizadas por el contenedor de base de datos integrado)
POSTGRES_PASSWORD=elija-una-contraseña-segura

# Clave de firma JWT — genere una con:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=su-clave-generada

# Puerto en el que estará disponible la aplicación
HOST_PORT=8920
```

## Paso 2: Elegir la opción de base de datos

### Opción A: Base de datos integrada (recomendada para empezar)

El archivo `docker-compose.db.yml` inicia un contenedor PostgreSQL junto con el backend y el frontend. No se necesita una base de datos externa — los datos se persisten en un volumen Docker.

```bash
docker compose -f docker-compose.db.yml up --build -d
```

### Opción B: PostgreSQL externo

Si ya tiene un servidor PostgreSQL (base de datos gestionada, contenedor separado o instalación local), utilice el archivo base `docker-compose.yml` que inicia únicamente el backend y el frontend.

Primero, cree una base de datos y un usuario:

```sql
CREATE USER turboea WITH PASSWORD 'su-contraseña';
CREATE DATABASE turboea OWNER turboea;
```

Después, configure su `.env`:

```dotenv
POSTGRES_HOST=su-host-postgresql
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=su-contraseña
```

Inicie la aplicación:

```bash
docker compose up --build -d
```

!!! note
    El archivo base `docker-compose.yml` espera una red Docker llamada `guac-net`. Créela con `docker network create guac-net` si no existe.

## Paso 3: Cargar datos de demostración (opcional)

Turbo EA puede iniciarse con un metamodelo vacío (solo los 14 tipos de card integrados y los tipos de relación) o con un conjunto de datos de demostración completamente poblado. Los datos de demostración son ideales para evaluar la plataforma, realizar sesiones de formación o explorar funcionalidades.

### Opciones de carga

Añada estas variables a su `.env` **antes del primer inicio**:

| Variable | Predeterminado | Descripción |
|----------|----------------|-------------|
| `SEED_DEMO` | `false` | Carga el conjunto completo de datos de NexaTech Industries, incluyendo BPM y PPM |
| `SEED_BPM` | `false` | Carga solo los procesos de demostración BPM (requiere que existan los datos base) |
| `SEED_PPM` | `false` | Carga solo los datos de proyecto PPM (requiere que existan los datos base) |
| `RESET_DB` | `false` | Elimina todas las tablas y las recrea desde cero al iniciar |

### Demostración completa (recomendada para evaluación)

```dotenv
SEED_DEMO=true
```

Esto carga todo el conjunto de datos de NexaTech Industries con una sola configuración. **No** necesita configurar `SEED_BPM` o `SEED_PPM` por separado — se incluyen automáticamente.

### Cuenta de administrador de demostración

Cuando se cargan los datos de demostración, se crea una cuenta de administrador predeterminada:

| Campo | Valor |
|-------|-------|
| **Correo electrónico** | `admin@turboea.demo` |
| **Contraseña** | `TurboEA!2025` |
| **Rol** | Administrador |

!!! warning
    La cuenta de administrador de demostración utiliza credenciales conocidas. Cambie la contraseña o cree su propia cuenta de administrador para cualquier entorno más allá de la evaluación local.

### Qué incluyen los datos de demostración

El conjunto de datos de NexaTech Industries contiene aproximadamente 150 cards en todas las capas de arquitectura:

**Datos EA principales** (siempre incluidos con `SEED_DEMO=true`):

- **Organizaciones** — Jerarquía corporativa: NexaTech Industries con unidades de negocio (Ingeniería, Fabricación, Ventas y Marketing), regiones, equipos y clientes
- **Capacidades de negocio** — Más de 20 capacidades en una jerarquía multinivel
- **Contextos de negocio** — Procesos, flujos de valor, recorridos del cliente, productos de negocio
- **Aplicaciones** — Más de 15 aplicaciones (NexaCore ERP, Plataforma IoT, Salesforce CRM, etc.) con datos completos de ciclo de vida y costes
- **Componentes TI** — Más de 20 elementos de infraestructura (bases de datos, servidores, middleware, SaaS, modelos de IA)
- **Interfaces y objetos de datos** — Definiciones de API y flujos de datos entre sistemas
- **Plataformas** — Plataformas Cloud e IoT con subtipos
- **Objetivos e iniciativas** — 6 iniciativas estratégicas con diferentes estados de aprobación
- **Etiquetas** — 5 grupos: Valor de Negocio, Pila Tecnológica, Estado del Ciclo de Vida, Nivel de Riesgo, Ámbito Regulatorio
- **Relaciones** — Más de 60 relaciones que conectan cards entre todas las capas
- **Entrega EA** — Registros de decisiones de arquitectura y documentos de trabajo de arquitectura

**Datos BPM** (incluidos con `SEED_DEMO=true` o `SEED_BPM=true`):

- ~30 procesos de negocio organizados en una jerarquía de 4 niveles (categorías, grupos, procesos, variantes)
- Diagramas BPMN 2.0 con elementos de proceso extraídos (tareas, eventos, puertas de enlace, carriles)
- Enlaces de elementos a cards que conectan tareas BPMN con aplicaciones, componentes TI y objetos de datos
- Evaluaciones de procesos con puntuaciones de madurez, efectividad y cumplimiento

**Datos PPM** (incluidos con `SEED_DEMO=true` o `SEED_PPM=true`):

- Informes de estado para 6 iniciativas que muestran la salud del proyecto a lo largo del tiempo
- Estructuras de desglose del trabajo (EDT) con descomposición jerárquica e hitos
- ~60 tareas entre iniciativas con estados, prioridades, asignados y etiquetas
- Líneas de presupuesto (capex/opex por año fiscal) y líneas de coste (gastos reales)
- Registro de riesgos con puntuaciones de probabilidad/impacto y planes de mitigación

### Restablecer la base de datos

Para borrar todo y empezar de nuevo:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Reinicie los contenedores y luego **elimine `RESET_DB` de `.env`** para evitar restablecer en cada reinicio:

```bash
docker compose -f docker-compose.db.yml up --build -d
# Después de confirmar que funciona, elimine RESET_DB=true de .env
```

## Paso 4: Servicios opcionales

### Sugerencias de descripción con IA

Turbo EA puede generar descripciones de cards utilizando un LLM local (Ollama) o proveedores comerciales. El contenedor Ollama integrado es la forma más fácil de empezar.

Añada a `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Inicie con el perfil `ai`:

```bash
docker compose -f docker-compose.db.yml --profile ai up --build -d
```

El modelo se descarga automáticamente en el primer inicio (esto puede tardar unos minutos según su conexión). Consulte [Capacidades de IA](../admin/ai.md) para más detalles de configuración.

### Servidor MCP (integración con herramientas de IA)

El servidor MCP permite que herramientas de IA como Claude Desktop, Cursor y GitHub Copilot consulten sus datos de EA.

```bash
docker compose -f docker-compose.db.yml --profile mcp up --build -d
```

Consulte [Integración MCP](../admin/mcp.md) para más detalles sobre la configuración y autenticación.

### Combinación de perfiles

Puede habilitar múltiples perfiles a la vez:

```bash
docker compose -f docker-compose.db.yml --profile ai --profile mcp up --build -d
```

## Referencia rápida: Comandos de inicio comunes

| Escenario | Comando |
|-----------|---------|
| **Inicio mínimo** (BD integrada, vacío) | `docker compose -f docker-compose.db.yml up --build -d` |
| **Demo completa** (BD integrada, todos los datos) | Configure `SEED_DEMO=true` en `.env`, luego `docker compose -f docker-compose.db.yml up --build -d` |
| **Demo completa + IA** | Configure `SEED_DEMO=true` + variables IA en `.env`, luego `docker compose -f docker-compose.db.yml --profile ai up --build -d` |
| **BD externa** | Configure las variables de BD en `.env`, luego `docker compose up --build -d` |
| **Restablecer y resembrar** | Configure `RESET_DB=true` + `SEED_DEMO=true` en `.env`, reinicie, luego elimine `RESET_DB` |

## Siguientes pasos

- Abra **http://localhost:8920** (o su `HOST_PORT` configurado) en su navegador
- Si cargó datos de demostración, inicie sesión con `admin@turboea.demo` / `TurboEA!2025`
- De lo contrario, registre una nueva cuenta — el primer usuario obtiene automáticamente el rol de **Administrador**
- Explore el [Panel de control](../guide/dashboard.md) para obtener una visión general de su paisaje EA
- Configure el [Metamodelo](../admin/metamodel.md) para personalizar tipos de cards y campos
