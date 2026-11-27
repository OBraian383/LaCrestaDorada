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
    // Perfiles de personas: cada sesión (teléfono) solo puede crear o modificar el suyo.
    match /negocios/{codigo}/perfiles/{uid} {
      allow read: if request.auth != null && codigo.size() >= 16;
      allow create, update: if request.auth != null && request.auth.uid == uid && codigo.size() >= 16;
      allow delete: if false;
    }
    // Resto de los datos: con sesión y el código largo del negocio. Nada se borra.
    match /negocios/{codigo}/{coleccion}/{id} {
      allow read, create, update: if request.auth != null && codigo.size() >= 16 && coleccion != 'perfiles';
      allow delete: if false;
    }
  }
}
```

(Es el contenido de `firestore.rules`. **No se permite borrar** nada: los errores se corrigen anulando o rectificando. Desde la 0.3 cada teléfono solo puede crear o modificar su propio perfil. Si venís de una versión anterior, **volvé a publicar estas reglas**.)

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

## Quién sos (perfiles)

La primera vez que se abre la app en un teléfono, tocá tu nombre (Kevin, Ramiro o Mamá) o escribilo. Se crea un **perfil en la base**, atado a la sesión anónima de Firebase de ese teléfono. Desde ahí la app te reconoce sola y cada operación guarda tu nombre, tu identificador y la hora. No se vuelve a pedir el nombre.

- Si se borran los datos de la app o se cambia de teléfono, la sesión es nueva: hay que elegir el nombre otra vez (y pegar el código del local). **No se pierde ningún dato**, solo se crea un perfil nuevo.
- Para sumar a Mamá: mandale el enlace de invitación (⚙ > Copiar enlace). Al abrirlo, toca «Mamá».
- ⚙ muestra las personas con acceso y permite recordar o no el último medio de pago y categoría.

## Cómo se anota (0.3)

Hay tres modos: **Venta**, **Egreso** y **Cobro de deuda**. El importe se escribe siempre **sin signo**: el egreso se guarda negativo solo.

- **Venta:** artículo, importe, medio (Efectivo, Transferencia / electrónico o Fiado) y detalles opcionales. Débito y crédito ya no se ofrecen; lo ya registrado con esos medios se conserva igual y se muestra como «Débito» o «Crédito».
- **Transferencia:** nombre de quien pagó (opcional) y cuenta receptora (Kevin, Ramiro, Mamá u otra). El alias se eliminó (los alias viejos siguen visibles en los registros antiguos).
- **Fiado:** cliente, importe recibido, medio de lo recibido y saldo pendiente. Después de un fiado no queda marcado «Fiado»: vuelve a tu último medio normal.
- **Egreso:** concepto, importe, medio de salida, persona responsable y motivo opcional. Tipos: gasto, compra de mercadería, retiro personal, pago a proveedor, otro.
- **Recuerda** tu último medio de pago y categoría (por usuario, guardado en tu perfil).
- **↻ Repetir:** copia artículo, medio y categoría de tu última operación; no copia cliente, datos de transferencia, motivos ni detalles. Solo falta el importe.
- **Artículos:** se sugieren los usados antes (sin consultar la base) y no se completa ningún precio.
- **Corregir:** «Editar» guarda el valor anterior, quién y cuándo. «Anular» no borra y recalcula saldos. El texto estilo chat sigue funcionando.

## Caja diaria (0.3)

En **Caja** elegí el día. Hay dos apartados independientes:

**A. Distribución por responsable.** Los movimientos del día (ventas, fiados y egresos) aparecen **pendientes**. Pasalos a Kevin, Ramiro o Mamá con los botones o arrastrando el ⠿ hasta la columna de arriba. Podés cambiar la asignación, devolverlo a pendientes o **Dividir** (la suma de las partes tiene que dar exacto el importe; no se duplica nada). El botón resaltado es la sugerencia según la categoría. Cada columna muestra ingresos, egresos, neto asignado y cantidad de movimientos. «Neto asignado» = ingresos − egresos; no es la ganancia comercial real porque todavía no se cargan costos de mercadería. Los cobros de deudas no se redistribuyen: se listan aparte con la venta original a la que corresponden.

**B. Conciliación de caja.** Fondo inicial, ingresos en efectivo y electrónicos, cobros de deudas anteriores, egresos en efectivo y electrónicos, efectivo esperado, contado y diferencia. Lo fiado cuenta como venta pero no suma al efectivo hasta que se cobra.

**Cerrar.** «Cerrar caja» (definitivo) solo se habilita con todo asignado; «Guardar cierre incompleto» permite dejarlo para después y retomarlo (las asignaciones quedan guardadas en la base). Un cierre definitivo **bloquea** ese día. Para corregirlo hay que **Rectificar**: se pide un motivo, y al cerrar de nuevo se crea un cierre nuevo que apunta al original, que no se toca.

Las asignaciones se guardan una por movimiento, así dos teléfonos no se pisan: si alguien cambió una asignación mientras la mirabas, la app avisa.

## Copia de seguridad y restauración

En **⚙ Ajustes > Copia de seguridad**:

- **Copia completa (JSON):** movimientos, clientes, cierres y configuración. Se guarda en la carpeta Descargas del teléfono. Conviene hacerla una vez por semana y mandarla a Drive o WhatsApp.
- **Planillas (CSV):** movimientos, clientes y cierres, para abrir en Excel o Google Sheets (separador «;»).

**Para restaurar:** abrí la app con el código del negocio (la misma base o una nueva), andá a ⚙ > «Restaurar desde una copia», elegí el archivo JSON, revisá el resumen y tocá **Restaurar**. Los documentos se reescriben con su mismo identificador, así que restaurar dos veces no duplica nada. Si es una base nueva, primero hacé los pasos 1 a 3 y entrá con el mismo código (o con uno nuevo).

## Catálogo e inventario (a futuro)

Hoy los artículos son texto libre; la app sugiere los ya usados. Cuando se quiera, se puede sumar la colección `negocios/{codigo}/productos` con: nombre, categoría, responsable, unidad de venta (kg, unidad), precio actual, historial de precios y existencias opcionales. Los movimientos ya guardan `desc`, `cat` y `resp`, y un campo `reparto` (lista de partes responsable/categoría/importe) que permitirá ventas con mercadería de varios responsables y pagos combinados sin rehacer datos. No se pidió inventario obligatorio y no hay.

## Cosas para tener en cuenta

- **Quién tiene el enlace tiene acceso.** Cualquiera que abra el enlace puede ver y anotar. Compartilo solo con quien confiás. Si se filtra, creá un código nuevo y volvé a invitar (se puede restaurar una copia JSON en el código nuevo).
- **Actualizar la app.** Subí la carpeta de nuevo a Netlify (Deploys > arrastrar la carpeta). La 0.3 ya trae `libreta-v4` en `sw.js`; para futuras actualizaciones, subí ese número. Los celulares toman la versión nueva al abrir la app una o dos veces (si no, cerrarla del todo y abrirla de nuevo).
- **Cuota gratuita.** Spark permite unas 50.000 lecturas y 20.000 escrituras por día. La app lee solo los últimos 90 días en vivo y trae períodos más viejos únicamente cuando los pedís en Historial, Caja o Resumen.
