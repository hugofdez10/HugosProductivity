# Hugo's Productivity

![PWA](https://img.shields.io/badge/PWA-instalable-111827?style=for-the-badge&logo=pwa)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?style=for-the-badge&logo=javascript&logoColor=111827)
![Supabase](https://img.shields.io/badge/Supabase-sync-3FCF8E?style=for-the-badge&logo=supabase&logoColor=0f172a)
![Netlify](https://img.shields.io/badge/Netlify-deploy-00C7B7?style=for-the-badge&logo=netlify&logoColor=white)

Una PWA personal para organizar tareas, rutinas, calendario y recordatorios desde el ordenador o el iPhone.

La idea nació de una sensación bastante simple: probé aplicaciones de productividad, pero ninguna encajaba del todo con mi forma de organizarme. Unas eran demasiado rígidas, otras demasiado cargadas, y casi todas me obligaban a trabajar como quería la herramienta. Así que decidí desarrollar la mía: una app hecha a mi medida, con los flujos, prioridades y pequeños detalles que yo quería usar cada día.

URL publicada: [hugosproductivity.netlify.app](https://hugosproductivity.netlify.app)

## Qué Puedes Hacer

- Capturar tareas rápido con fecha, hora, aviso, energía, lugar, área y notas.
- Ver el plan del día, los pendientes y un calendario mensual.
- Crear rutinas diarias, semanales, mensuales, por días concretos o por objetivo semanal.
- Activar avisos con fecha y hora usando notificaciones del navegador.
- Recibir avisos en segundo plano en movil mediante Web Push, Supabase y una Edge Function programada.
- Exportar e importar una copia de tus datos en JSON.
- Usarla como app instalada gracias al manifest y al service worker.
- Sincronizar tareas con Supabase al iniciar sesión y al detectar cambios remotos.

## Por Qué Es Diferente

Hugo's Productivity no intenta ser un gestor universal para equipos enormes. Está pensada para una persona que quiere mantener rutinas vivas, ordenar pendientes y tener un sistema claro sin pelearse con veinte pantallas.

La app combina tres ideas:

- **Captura rápida:** añadir una acción tiene que costar poco.
- **Contexto real:** no todas las tareas sirven para cualquier momento; importan el tiempo, la energía y el lugar.
- **Control personal:** los datos pueden vivir en local, sincronizarse con Supabase o moverse manualmente con exportación/importación.

## Stack

- HTML, CSS y JavaScript vanilla.
- Lucide Icons para la interfaz.
- Service Worker y Web App Manifest para instalación como PWA.
- Supabase Auth y PostgreSQL con Row Level Security para sincronización por usuario.
- Netlify como despliegue estático.

## Ejecutar En Local

Desde la carpeta del proyecto:

```powershell
python -m http.server 5178
```

Después abre:

```text
http://localhost:5178
```

No hace falta build ni bundler: es una app estática.

## Usarla En iPhone

Para instalarla en iPhone necesitas abrirla desde una URL HTTPS, por ejemplo la versión publicada en Netlify.

1. Abre `https://hugosproductivity.netlify.app` en Safari.
2. Pulsa compartir.
3. Elige `Añadir a pantalla de inicio`.

Desde ahí se comporta como una app instalada.

## Sincronización Con Supabase

La app funciona en local sin cuenta. Si quieres sincronización:

1. Crea un proyecto en Supabase.
2. Ejecuta `supabase/schema.sql` en el SQL Editor.
3. Copia la `Project URL` y la clave `publishable` o `anon`.
4. Pega esos valores en `supabase-config.js`.
5. En `Authentication > URL Configuration`, configura la URL de la app:

```text
https://hugosproductivity.netlify.app
```

Y añade estos redirects:

```text
https://hugosproductivity.netlify.app/**
http://localhost:5178/**
```

Cada usuario solo puede leer y escribir sus propias tareas gracias a las políticas de Row Level Security incluidas en `supabase/schema.sql`.

## Avisos En Segundo Plano

Los avisos dentro de la app funcionan con las notificaciones del navegador. En movil, si la PWA esta cerrada, el navegador puede suspender la pagina y no ejecuta temporizadores locales. Para que los avisos lleguen con la app cerrada hay que usar Web Push:

1. Ejecuta de nuevo `supabase/schema.sql` para crear `pulso_push_subscriptions` y `pulso_notification_log`.
2. Genera claves VAPID:

```powershell
node -e "const { webcrypto } = require('crypto'); const b64 = (v) => Buffer.from(v).toString('base64url'); webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']).then(async (keys) => { const pub = await webcrypto.subtle.exportKey('raw', keys.publicKey); const priv = await webcrypto.subtle.exportKey('jwk', keys.privateKey); console.log('VAPID_PUBLIC_KEY=' + b64(new Uint8Array(pub))); console.log('VAPID_PRIVATE_KEY=' + priv.d); });"
```

3. Copia `VAPID_PUBLIC_KEY` en `supabase-config.js` como `vapidPublicKey`.
4. Guarda los secretos de la Edge Function:

```powershell
supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:tu-email@example.com" REMINDER_CRON_SECRET="un-secreto-largo"
```

5. Despliega la funcion:

```powershell
supabase functions deploy send-reminders --no-verify-jwt
```

6. Programa `send-reminders` cada minuto desde Supabase Dashboard o con el Scheduler, enviando la cabecera:

```text
Authorization: Bearer un-secreto-largo
```

Los avisos en segundo plano necesitan que el usuario haya iniciado sesion, porque la Edge Function lee las tareas sincronizadas en Supabase. Sin sesion, los avisos siguen funcionando mientras la app esta abierta.

## Privacidad

Por defecto, las tareas se guardan en el navegador. Cuando hay sesión iniciada, el almacenamiento local se separa por cuenta y la sincronización con Supabase mantiene los datos asociados al usuario autenticado.

También puedes exportar e importar tus datos manualmente cuando quieras mover una copia o hacer respaldo.

## Estructura

```text
.
├── assets/
│   └── icon.svg
├── supabase/
│   └── schema.sql
├── app.js
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── styles.css
└── supabase-config.js
```

## Estado Del Proyecto

Proyecto personal en evolución. La prioridad es que siga siendo útil, rápida y cómoda para el uso diario: menos ruido, más claridad, y una forma de productividad que no obligue a adaptarse a una herramienta ajena.
