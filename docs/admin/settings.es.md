# Configuración General

La página de **Configuración** (**Administrador > Configuración**) proporciona la configuración centralizada para la apariencia, el correo electrónico y los interruptores de módulos de la plataforma.

## Apariencia

### Logotipo

Cargue un logotipo personalizado que aparecerá en la barra de navegación superior. Formatos compatibles: PNG, JPEG, SVG, WebP, GIF. Haga clic en **Restablecer** para volver al logotipo predeterminado de Turbo EA.

### Favicon

Cargue un icono de navegador personalizado (favicon). El cambio se aplicará en la siguiente carga de página. Haga clic en **Restablecer** para volver al icono predeterminado.

### Moneda

Seleccione la moneda utilizada para los campos de costo en toda la plataforma. Esto afecta a cómo se formatean los valores de costo en las páginas de detalle de fichas, informes y exportaciones. Se admiten más de 20 monedas, incluyendo USD, EUR, GBP, JPY, CNY, CHF, INR, BRL, entre otras.

### Idiomas Habilitados

Active o desactive los idiomas disponibles para los usuarios en su selector de idioma. Los ocho idiomas soportados pueden habilitarse o deshabilitarse individualmente:

- English, Deutsch, Français, Español, Italiano, Português, 中文, Русский

Al menos un idioma debe permanecer habilitado en todo momento.

### Inicio del Año Fiscal

Seleccione el mes en que comienza el año fiscal de su organización (enero a diciembre). Esta configuración afecta cómo se agrupan las **líneas de presupuesto** en el módulo PPM por año fiscal. Por ejemplo, si el año fiscal comienza en abril, una línea de presupuesto de junio de 2026 pertenece al AF 2026–2027.

El valor predeterminado es **enero** (año calendario = año fiscal).

## Correo Electrónico (SMTP)

Configure la entrega de correo electrónico para correos de invitación, notificaciones de encuestas y otros mensajes del sistema.

| Campo | Descripción |
|-------|-------------|
| **Host SMTP** | El nombre de host de su servidor de correo (por ejemplo, `smtp.gmail.com`) |
| **Puerto SMTP** | Puerto del servidor (normalmente 587 para TLS) |
| **Usuario SMTP** | Nombre de usuario de autenticación |
| **Contraseña SMTP** | Contraseña de autenticación (almacenada cifrada) |
| **Usar TLS** | Habilitar cifrado TLS (recomendado) |
| **Dirección del Remitente** | La dirección de correo electrónico del remitente para los mensajes salientes |
| **URL Base de la Aplicación** | La URL pública de su instancia de Turbo EA (utilizada en los enlaces del correo electrónico) |

Después de configurar, haga clic en **Enviar Correo de Prueba** para verificar que la configuración funciona correctamente.

!!! note
    El correo electrónico es opcional. Si SMTP no está configurado, las funciones que envían correos (invitaciones, notificaciones de encuestas) omitirán el envío de correo electrónico de forma transparente.

## Módulo BPM

Active o desactive el módulo de **Gestión de Procesos de Negocio** (BPM). Cuando está desactivado:

- El elemento de navegación **BPM** se oculta para todos los usuarios
- Las fichas de Proceso de Negocio permanecen en la base de datos, pero las funciones específicas de BPM (editor de flujos de proceso, panel de control BPM, informes BPM) no están accesibles

Esto es útil para organizaciones que no utilizan BPM y desean una experiencia de navegación más limpia.

## Módulo PPM

Active o desactive el módulo de **Gestión de Portafolio de Proyectos** (PPM). Cuando está desactivado:

- El elemento de navegación **PPM** se oculta para todos los usuarios
- Las fichas de Iniciativa permanecen en la base de datos, pero las funciones específicas de PPM (informes de estado, seguimiento de presupuesto y costos, registro de riesgos, tablero de tareas, diagrama de Gantt) no están accesibles

Cuando está habilitado, las fichas de Iniciativa obtienen una pestaña **PPM** en su vista de detalle y el panel de portafolio PPM está disponible en la navegación principal. Consulte [Gestión de Portafolio de Proyectos](../guide/ppm.md) para la guía completa de funciones.
