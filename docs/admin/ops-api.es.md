# API de operaciones (despliegues gestionados)

La API de operaciones (`/api/v1/ops`) es una superficie de gestión **opcional** que utiliza un plano de control de Turbo EA Cloud para operar instancias alojadas. En una instalación autoalojada está **desactivada de forma predeterminada**: todas las rutas responden `404`, salvo que la instancia se haya iniciado con una variable de entorno `OPS_PUBLIC_KEY`. Turbo EA no incluye ninguna lógica de facturación ni de licencias.

## Autenticación

Cada solicitud de operaciones debe firmarse con la clave Ed25519 **privada** que conserva el plano de control; la instancia verifica la firma con la clave **pública** de `OPS_PUBLIC_KEY` (base64, 32 bytes sin procesar). La firma cubre el método HTTP, la ruta con la cadena de consulta, un hash SHA-256 del cuerpo, una marca de tiempo y un nonce de un solo uso:

```
canonical = METHOD \n PATH_WITH_QUERY \n sha256(body) \n timestamp \n nonce
```

Encabezados: `X-Ops-Timestamp` (segundos Unix, ±5 minutos), `X-Ops-Nonce` (se usa una vez, protección contra repetición), `X-Ops-Signature` (firma Ed25519 en base64).

## Endpoints

| Método | Ruta | Función |
|--------|------|---------|
| GET | `/api/v1/ops/info` | Versión, recuentos de usuarios y fichas, estado de la base de datos |
| POST | `/api/v1/ops/rescue-access` | Crea una cuenta de administrador operador **por tiempo limitado** |
| DELETE | `/api/v1/ops/rescue-access` | Revoca inmediatamente una cuenta de rescate |
| GET | `/api/v1/ops/export` | Transmite el paquete de exportación del espacio de trabajo sin secretos |

## Acceso de rescate: garantías de transparencia

El acceso de operador por tiempo limitado («acceso de rescate») está diseñado para que nunca pueda producirse de forma invisible:

- **Cada concesión y revocación notifica a todos los administradores de la instancia** dentro de la aplicación *y* por correo electrónico, incluido el nombre del operador, el motivo indicado y la hora de caducidad.
- **Cada acción queda registrada en el propio registro de eventos de la instancia.**
- **La instancia aplica la caducidad por sí misma**: las cuentas de rescate llevan una marca de tiempo `access_expires_at`; las cuentas caducadas se rechazan durante la autenticación y una tarea en segundo plano cada hora las desactiva. Una interrupción del plano de control nunca puede ampliar el acceso.
- Las cuentas de rescate usan una dirección reservada específica (`rescue-…@rescue.turboea.invalid`), por lo que son fáciles de reconocer en la lista de usuarios y se pueden desactivar manualmente en cualquier momento.

## Exportación del espacio de trabajo

`GET /api/v1/ops/export` devuelve el mismo paquete que **Administrador → Configuración → Migración → Transferencia del espacio de trabajo → Exportar**: el espacio de trabajo completo sin secretos. El plano de control lo utiliza para las exportaciones de datos solicitadas por los clientes (portabilidad de datos del RGPD) y para copias de seguridad de seguridad antes de actualizaciones o eliminaciones.
