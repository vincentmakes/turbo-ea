# Sus primeros 30 días con Turbo EA

Así que ha instalado Turbo EA. La pantalla de inicio de sesión funciona, los datos de demostración se cargan, cada elemento del menú le muestra algo — y ahora está mirando un inventario vacío preguntándose por dónde empezar realmente. Esta guía es para usted.

Es un recorrido secuenciado y con opiniones de la **primera iniciativa concreta de EA** que la mayoría de las organizaciones ejecutan en Turbo EA: poner bajo control un inventario de aplicaciones y usarlo para responder preguntas reales sobre el portafolio. Ignora deliberadamente los módulos más avanzados (Registro de Riesgos, Cumplimiento, PPM, TurboLens AI) — esos resultan útiles una vez que su inventario está vivo, no antes.

## Para quién es esta guía

- **Arquitectos Empresariales** que están comenzando una práctica de EA desde cero o migrando desde hojas de cálculo, Confluence u otra herramienta.
- **Arquitectos de Soluciones y Propietarios de Aplicaciones** a quienes se les ha pedido "llenar la herramienta de EA" sin mucho contexto.
- **Administradores** preparando la plataforma para un despliegue más amplio.

Necesitará el rol de **admin** (o al menos `admin.metamodel` e `inventory.edit`) para seguir cada paso. Los roles de solo lectura aún pueden beneficiarse — simplemente no podrán realizar los cambios en el metamodelo de la página 5.

## El arco gatear → caminar → correr

No intente modelar toda la empresa en la primera semana. Los equipos que tienen éxito con las herramientas de EA siguen un camino por fases:

1. **Gatear** — Un alcance limitado (un dominio de negocio, un país, una plataforma). Un tipo de ficha (Aplicaciones). Cinco campos por ficha. Llegue a datos "suficientemente buenos" en 50–200 fichas.
2. **Caminar** — Agregue Capacidades de Negocio desde el catálogo incluido. Mapee aplicaciones a capacidades. Ejecute su primer análisis de portafolio. Muéstreselo a un interesado.
3. **Correr** — Expanda a procesos, interfaces, objetos de datos. Agregue más campos personalizados. Abra los módulos más avanzados.

Esta guía cubre **gatear** y el inicio de **caminar**. Al final, tendrá un portafolio de aplicaciones funcional con una disposición TIME (**T**olerar / **I**nvertir / **M**igrar / **E**liminar) y un Informe de Portafolio que puede presentar a un CIO.

## Qué hay en esta guía

| # | Página | Qué hará |
|---|--------|----------|
| 1 | [Planifique su despliegue](plan-your-rollout.md) | Defina el alcance de la iniciativa, elija interesados, establezca un objetivo realista de calidad de datos |
| 2 | [Comience con su inventario de aplicaciones](start-with-applications.md) | Pueble Aplicaciones mediante importación, ServiceNow o entrada manual |
| 3 | [Aproveche los catálogos de referencia](leverage-reference-catalogues.md) | Ahorre meses de modelado manual importando capacidades y procesos |
| 4 | [Personalice el metamodelo — ligeramente](customise-the-metamodel.md) | Agregue un campo personalizado (TIME) de la manera correcta |
| 5 | [Su primer análisis: Armonización de Aplicaciones](your-first-analysis.md) | Mapee aplicaciones a capacidades, ejecute el Informe de Portafolio y el Mapa de Calor de Capacidades |

!!! tip "Buena práctica"
    Lea las cinco páginas en orden antes de abrir Turbo EA. El plan en su cabeza es más valioso que las primeras 50 fichas en el inventario.

## Requisitos previos

- Una instancia de Turbo EA en funcionamiento (vea [Instalación y configuración](../getting-started/setup.md)).
- Una cuenta de administrador (el primer usuario en registrarse se convierte automáticamente en admin).
- **Opcional pero recomendado para usuarios primerizos:** inicie el stack con `SEED_DEMO=true` una vez para ver cómo se ve un inventario poblado (la empresa ficticia NexaTech Industries). Luego puede reiniciar con `RESET_DB=true` y comenzar limpio con sus datos reales.
- Una idea aproximada del **dominio de negocio** que desea modelar primero. "Toda la TI" no es un dominio.

## Lo que omitirá — por ahora

Estos son módulos potentes, pero asumen que ya tiene un inventario poblado. No los abra todavía:

- **Registro de Riesgos** y **Escaneo de Cumplimiento** — útiles una vez que tenga aplicaciones y capacidades a las que adjuntar riesgos.
- **PPM** (Gestión de Portafolio de Proyectos) — útil una vez que tenga una cartera de proyectos que valga la pena rastrear.
- **TurboLens AI** (análisis de proveedores, detección de duplicados, asistente Architect) — útil una vez que tenga suficientes fichas para que la IA encuentre patrones.

Encontrará un breve puntero de "qué sigue" para cada uno de ellos en la [página final](your-first-analysis.md) de esta guía.

¿Listo? Diríjase a [Planifique su despliegue](plan-your-rollout.md).
