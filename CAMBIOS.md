# Actualización 0.3

La 0.2 se conserva en la carpeta `../libreta-almacen-0.2` si la guardaste; esta carpeta ya incluye todo lo anterior. No se reconstruyó nada: se modificó `index.html` y `app.js`, se agregaron colecciones nuevas a Firestore (`perfiles`, `asignaciones`) y no se cambió la estructura de movimientos, clientes ni cierres.

| Punto | Qué se hizo | Estado |
|---|---|---|
| 1 Usuarios | Perfil en Firestore (`perfiles/<uid>`) vinculado a la sesión de Firebase. Cada operación guarda `por` y `porUid`. Ajustes lista a las personas; Mamá se suma con el enlace. | Hecho y probado |
| 2 Medios | Solo Efectivo, Transferencia/electrónico y Fiado. Alias eliminado. Pagador opcional y cuenta receptora (Kevin, Ramiro, Mamá, otra). Débito/crédito históricos intactos (probado byte a byte). | Hecho y probado |
| 3 Preferencias | Recuerda último medio y categoría (por usuario, en su perfil); nunca deja «Fiado» marcado. | Hecho y probado |
| 4 Formulario | Solo campos pertinentes por modo; egreso con medio de salida, persona responsable y motivo; formulario más bajo. | Hecho y probado |
| 5 Importes | Siempre positivos; el egreso se guarda negativo. Un importe con signo se rechaza con aviso. | Hecho y probado |
| 6–9 Distribución | Sección A en Caja: pendientes + 3 columnas, botones, arrastrar y soltar, dividir, totales en vivo, bloqueo del cierre con pendientes, cierre incompleto, persistencia en Firestore, copia en el cierre, bloqueo y rectificación auditable. | Hecho y probado |
| 8 Conciliación | Sección B separada; fiado no suma efectivo; cobros no son ventas; cobro enlazado a la venta original (FIFO). | Hecho y probado |
| 10 Autocompletado | Sugerencias locales de artículos (sin precios, sin lecturas extra). | Hecho y probado |
| 11 Repetir | Botón ↻ Repetir. | Hecho y probado |

Corregido de paso: al guardar un cierre se borraba el fondo inicial y un segundo cierre del mismo día calculaba mal.

## Pruebas
`test_v3.js` (62 comprobaciones, Firestore simulado y dos teléfonos): identificación, medios, histórico, preferencias, repetir, fiados, egresos, asignar/reasignar/devolver, arrastrar, dividir, cierre incompleto/completo, bloqueo, rectificación, sincronización, respaldo y pantalla sin scroll horizontal.

## Límites conocidos
- Probado con Firestore simulado, no contra el proyecto real. No probado en un Android físico.
- Si se borran los datos de la app, el teléfono recibe una sesión anónima nueva y hay que elegir el nombre de nuevo (para evitarlo del todo haría falta login con Google/correo).
- Arrastrar mueve el movimiento completo; para repartirlo se usa «Dividir».
- Si cambia el importe de un movimiento ya asignado, vuelve a pendientes con aviso.
- La 0.2 permitía débito/crédito: ya no se ofrecen para registros nuevos.
- Pago inicial de un fiado por transferencia no pide cuenta receptora.

---

# Historial: versión 0.2

La versión 1 quedó intacta en `anterior/index.html`. No se migró de tecnología: sigue siendo HTML, CSS y JavaScript con Firestore. Los datos de la v1 se leen sin conversión.

| Etapa | Qué se hizo | Estado |
|---|---|---|
| 1 | Libreta de 4 campos (Artículo, Importe, Medio, Detalles) con fecha de alta y modificación, quién registró, id único. Teclado numérico. | Hecho y probado |
| 2 | Importes negativos = egresos, con 5 tipos; retiro con quién retiró y quién registró; no cuentan como ventas. | Hecho y probado |
| 3 | Transferencia: titular, alias, cuenta receptora (campo aparte). Todo opcional. | Hecho y probado |
| 4 | Fiado con cliente obligatorio (o provisorio), pago inicial, pendiente validado, cobros de deudas fuera de «ventas». | Hecho y probado |
| 5 | Cuentas: saldo atómico (`increment` en el mismo lote), historial con saldo corrido, observaciones, anular/restaurar, rectificar con historial, unificar cuentas, corrección de saldo. | Hecho y probado (unificar sin prueba automática) |
| 6 | Responsables y categorías independientes del usuario y del medio; `reparto` listo para varios responsables; resumen por responsable/categoría. | Hecho y probado |
| 7 | Cierre de caja con todos los rubros, fondo inicial, contado, diferencia, historial inmutable. | Hecho y probado |
| 8 | Historial con filtros (fecha, tipo, medio, responsable, categoría, ingresos/egresos/retiros/cuentas, texto), paginado; resumen hoy/7 días/mes; ventana de 90 días y carga por rango. | Hecho y probado |
| 9 | Exportar JSON y CSV; restaurar desde JSON (idempotente). | Hecho y probado |
| 10 | Solo estructura (`cat`, `resp`, `reparto`, texto libre con sugerencias); sin inventario. | Documentado en GUIA.md |

Otros: ícono nuevo desde el logo, manifest «La Cresta Dorada», service worker `libreta-v3`, reglas que impiden borrar (`firestore.rules`), importaciones de chat con ids determinísticos (sin duplicados al reintentar).

## Pendiente de verificar en tu entorno real
- Las pruebas usan un Firestore simulado; no se probó contra el proyecto `almacencrestadorada`.
- Republicar las reglas (`firestore.rules`) y subir la carpeta a Netlify.
