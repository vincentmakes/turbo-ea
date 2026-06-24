# Transferencia de workspace

La Transferencia de workspace (**Administración → Configuración → Migración → Transferencia de workspace**) traslada un workspace completo de Turbo EA de una instancia a otra como un único paquete autocontenido. El caso de uso principal: construye un workspace en una instancia **local** y necesita promover todo a **Producción**.

![Transferencia de workspace](../assets/img/es/58_workspace_transfer.png)

## Qué se incluye

La exportación captura el workspace completo como un paquete `.zip` que contiene un libro de Excel (todos los datos estructurados, una hoja por dominio) y, cuando corresponde, una carpeta `assets/` para archivos no estructurados:

- **Metamodelo** — tipos de tarjeta y tipos de relación, incluidos todos los campos personalizados, subtipos, secciones y traducciones.
- **Configuración** — roles, roles de partes interesadas por tipo, grupos de etiquetas y etiquetas, campos calculados, principios de EA y regulaciones de cumplimiento.
- **Ajustes** — moneda, formato de fecha, indicadores de funciones, personalización de la pantalla de inicio de sesión, idiomas habilitados y el resto de los ajustes generales de la aplicación.
- **Usuarios** — correo electrónico, nombre para mostrar, rol e indicador de actividad (se usan para revincular la propiedad y las asignaciones en el destino). Sin contraseñas ni identidades SSO.
- **Inventario** — cada tarjeta (con su jerarquía, ciclo de vida y atributos), etiquetas de tarjeta y relaciones.
- **Contexto de tarjeta** — partes interesadas, enlaces a documentos, comentarios, tareas pendientes y archivos adjuntos.
- **Datos de módulos** — BPM (diagramas de proceso, elementos, versiones de flujo, evaluaciones), PPM (informes de estado, costes, presupuestos, riesgos, tareas, WBS, dependencias), el registro de riesgos de GRC (riesgos, tareas de mitigación y sus ocurrencias, enlaces a tarjetas), decisiones de arquitectura y Statements of Architecture Work, diagramas de dibujo libre, informes guardados, marcadores, portales web y encuestas.
- **Activos** — los archivos adjuntos binarios, el XML de diagramas y BPMN, y el logo/favicon viajan como archivos separados dentro de la carpeta `assets/` del paquete.

## Qué nunca se incluye

Por seguridad, **los secretos nunca se exportan**:

- Contraseña SMTP
- Secreto de cliente SSO
- Clave de API del proveedor de IA
- Credenciales de ServiceNow

Debe volver a introducirlos en la instancia de destino después de importar. Esto es inevitable por diseño: los valores cifrados están vinculados a la `SECRET_KEY` de la instancia de origen y no pueden descifrarse en ningún otro lugar.

## Exportar

1. Abra **Administración → Configuración → Migración → Transferencia de workspace**.
2. (Opcional) marque **Incluir tarjetas archivadas** para añadir el inventario archivado al paquete.
3. Haga clic en **Exportar paquete**. Su navegador descarga `workspace_export_<timestamp>.zip`.

## Importar

1. En la instancia de **destino**, abra **Administración → Configuración → Migración → Transferencia de workspace**.
2. Bajo **Importar workspace**, haga clic en **Elegir paquete…** y seleccione el `.zip` que exportó.
3. Turbo EA analiza el paquete y muestra una **vista previa de simulación** — una tabla por sección de cuántas entidades se crearían, actualizarían, omitirían o están en conflicto. Aún no se escribe nada.
4. Revise la vista previa y, a continuación, haga clic en **Aplicar importación**.

La importación es **idempotente**: el metamodelo y la configuración se emparejan por clave, las tarjetas por id externo o por tipo + ruta de jerarquía, y los usuarios por correo electrónico. Volver a importar el mismo paquete es seguro — las entidades ya presentes se omiten en lugar de duplicarse. Los tipos de metamodelo built-in existentes conservan su identidad; solo se fusiona su esquema editable.

## Después de importar

- Vuelva a introducir cualquier credencial de SMTP, SSO e IA en sus respectivas pestañas de configuración.
- Los usuarios sintéticos referenciados por el paquete se crean **desactivados**; actívelos en **Administración → Usuarios** según sea necesario.

## Permisos

La Transferencia de workspace está protegida por dos permisos dedicados, ambos concedidos a los administradores:

- `admin.export_workspace` — exportar el paquete.
- `admin.import_workspace` — previsualizar y aplicar una importación.
