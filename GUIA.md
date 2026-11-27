# La Cresta Dorada: puesta en marcha

App instalable en Android (PWA) con datos compartidos en tiempo real mediante Firebase Firestore, plan Spark (gratuito). Funciona sin señal: lo que anotes se guarda en el teléfono y se sincroniza solo cuando vuelve internet.

Contenido de la carpeta:

- `index.html` + `app.js`: la app (pantallas y lógica).
- `anterior/index.html`: la versión 1, intacta, por si hiciera falta volver atrás (abrirla desde `/anterior/`; usa los mismos datos).
- `firestore.rules`: las reglas de seguridad para pegar en Firebase.
- `firebase-config.js`: acá pegás los datos de tu proyecto de Firebase.
- `manifest.json`, `sw.js` e `icons/`: lo que hace que Chrome la instale como app.

Hace falta hacer esto una sola vez, desde una computadora o desde el celular (con la computadora es más cómodo). Son unos 15 minutos.

## 1. Crear el proyecto de Firebase

1. Entrá a https://console.firebase.google.com con una cuenta de Google.
2. **Crear un proyecto**, poné un nombre (por ejemplo `almacen`). Google Analytics no hace falta, desactivalo.
3. En la pantalla del proyecto tocá el ícono web **`</>`** (Agregar app), poné un apodo (`libreta`) y **no** marques Firebase Hosting por ahora.
4. Te muestra un bloque `firebaseConfig = { ... }`. Copiá cada valor y pegalo en el archivo **`firebase-config.js`**, reemplazando los que dicen `PEGAR_...`. Esos datos no son contraseñas.

## 2. Activar el acceso anónimo

Es lo que evita que cada persona tenga que crear usuario y contraseña.

1. Menú **Compilación > Authentication > Comenzar**.
2. Pestaña **Método de acceso** > **Anónimo** > activar > **Guardar**.

## 3. Crear la base de datos y sus reglas

1. Menú **Compilación > Firestore Database > Crear base de datos**.
2. Elegí una ubicación cercana (por ejemplo `southamerica-east1`, São Paulo) y **modo producción**.
3. Pestaña **Reglas**, borrá lo que hay, pegá esto y tocá **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /negocios/{codigo}/{coleccion}/{id} {
      allow read, create, update: if request.auth != null && codigo.size() >= 16;
      allow delete: if false;
    }
  }
}
```

(Es el contenido de `firestore.rules`. Desde la versión 2 **no se permite borrar** nada: los errores se corrigen anulando o rectificando, así queda el historial. Si venís de la versión 1, **volvé a publicar estas reglas**.)

Los datos de tu almacén quedan guardados bajo un **código largo y al azar** que genera la app. Nadie puede listar ni adivinar ese código: funciona como la llave de tu libreta.

## 4. Publicar la app gratis

Chrome solo permite instalar una app que esté en una dirección `https://`. Dos formas gratuitas:

**Opción A, la más simple (Netlify Drop).** Entrá a https://app.netlify.com/drop, arrastrá la carpeta completa y te da una dirección tipo `https://nombre-raro.netlify.app`. Después podés cambiar el nombre en la configuración del sitio.

**Opción B (Firebase Hosting, en el mismo proyecto).** Requiere instalar Node.js en la computadora:

```
npm install -g firebase-tools
firebase login
firebase init hosting     # carpeta pública: la de esta app, sin reescribir a index.html
firebase deploy
```

## 5. Instalar en Android

1. Abrí la dirección en **Chrome** del celular.
2. Tocá el ícono **⚙** arriba a la derecha y, si aparece, **Instalar app**. Si no aparece, usá el menú **⋮ > Instalar aplicación** (o **Agregar a la pantalla principal**).
3. Queda el ícono de La Cresta Dorada en el cajón de apps. Abre a pantalla completa, sin barra del navegador.

La primera vez necesita internet. Después abre aunque no haya señal.

## 6. Primer uso y segundo celular

1. En el primer celular, escribí tu nombre y tocá **Soy el primero: generar código nuevo**, y **Entrar**.
2. Tocá **⚙ > Copiar enlace** y mandáselo a tu hermano por WhatsApp.
3. Cuando lo abra, el código se completa solo; solo escribe su nombre. Desde ahí ven lo mismo en tiempo real, y cada venta queda etiquetada con quién la anotó.

Para un tercer celular o un teléfono nuevo, mismo procedimiento con el enlace.

## Cómo se anota (versión 2)

En **Anotar** hay cuatro campos: **Artículo**, **Importe**, **Medio de pago** y **Detalles** (opcional). Una venta en efectivo necesita solo artículo, importe y medio. Después de agregar, el formulario queda listo para la siguiente.

- **Transferencia:** podés anotar titular, alias y la cuenta que la recibió (propietario, hermano u otras que agregues en ⚙).
- **Fiado:** el nombre del cliente es obligatorio (o «Sin nombre aún», que crea una cuenta provisoria que después se unifica). Si pagó una parte, escribí «Recibido»: queda anotado el pago inicial y el resto como saldo pendiente.
- **Egreso:** importe negativo, con tipo (gasto, compra de mercadería, retiro personal, pago a proveedor, otro). Un retiro pide quién lo hizo. Los egresos no cuentan como ventas y los retiros personales no se mezclan con los gastos del negocio.
- **Cobro:** el pago de una deuda anterior. Suma a la caja pero no como venta.
- **Responsable y categoría:** por defecto Madre (general), Propietario (avícolas y bebidas) y Hermano (cigarrillos y garrafas). Los nombres se cambian en ⚙.
- **Corregir:** «Editar» guarda el valor anterior, quién y cuándo lo cambió. «Anular» no borra: marca la anotación y recalcula saldos (si anulás un fiado también se anula su pago inicial). «Restaurar» la deja como estaba.
- **Texto estilo chat:** el desplegable «Pegar texto» sigue funcionando como en la versión 1 (`Marta Gómez debe`, `Marta Gómez pagó $3000`, chat exportado de WhatsApp, sin duplicar).

## Caja diaria

En **Caja** elegí el día, escribí el fondo inicial y el efectivo contado. La app calcula ventas por medio, fiadas, cobros de deudas anteriores, egresos por tipo, efectivo esperado y diferencia. «Cerrar caja» guarda una foto del cierre que no se modifica; si después hay cambios, se puede volver a cerrar y quedan ambos.

## Copia de seguridad y restauración

En **⚙ Ajustes > Copia de seguridad**:

- **Copia completa (JSON):** movimientos, clientes, cierres y configuración. Se guarda en la carpeta Descargas del teléfono. Conviene hacerla una vez por semana y mandarla a Drive o WhatsApp.
- **Planillas (CSV):** movimientos, clientes y cierres, para abrir en Excel o Google Sheets (separador «;»).

**Para restaurar:** abrí la app con el código del negocio (la misma base o una nueva), andá a ⚙ > «Restaurar desde una copia», elegí el archivo JSON, revisá el resumen y tocá **Restaurar**. Los documentos se reescriben con su mismo identificador, así que restaurar dos veces no duplica nada. Si es una base nueva, primero hacé los pasos 1 a 3 y entrá con el mismo código (o con uno nuevo).

## Catálogo e inventario (a futuro)

Hoy los artículos son texto libre; la app sugiere los ya usados. Cuando se quiera, se puede sumar la colección `negocios/{codigo}/productos` con: nombre, categoría, responsable, unidad de venta (kg, unidad), precio actual, historial de precios y existencias opcionales. Los movimientos ya guardan `desc`, `cat` y `resp`, y un campo `reparto` (lista de partes responsable/categoría/importe) que permitirá ventas con mercadería de varios responsables y pagos combinados sin rehacer datos. No se pidió inventario obligatorio y no hay.

## Cosas para tener en cuenta

- **Quién tiene el enlace tiene acceso.** Cualquiera que abra el enlace puede ver y anotar. Compartilo solo con quien confiás. Si se filtra, creá un código nuevo y volvé a invitar (se puede restaurar una copia JSON en el código nuevo).
- **Actualizar la app.** Subí la carpeta de nuevo a Netlify (Deploys > arrastrar la carpeta). La versión 2 ya trae `libreta-v3` en `sw.js`; para futuras actualizaciones, subí ese número. Los celulares toman la versión nueva al abrir la app una o dos veces (si no, cerrarla del todo y abrirla de nuevo).
- **Cuota gratuita.** Spark permite unas 50.000 lecturas y 20.000 escrituras por día. La app lee solo los últimos 90 días en vivo y trae períodos más viejos únicamente cuando los pedís en Historial, Caja o Resumen.
