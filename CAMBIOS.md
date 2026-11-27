# Cambios de la versión 2 (La Cresta Dorada)

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
