# Hugo's Productivity

![PWA](https://img.shields.io/badge/PWA-instalable-111827?style=for-the-badge&logo=pwa)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?style=for-the-badge&logo=javascript&logoColor=111827)
![Supabase](https://img.shields.io/badge/Supabase-sync-3FCF8E?style=for-the-badge&logo=supabase&logoColor=0f172a)
![Vercel](https://img.shields.io/badge/Vercel-deploy-000000?style=for-the-badge&logo=vercel&logoColor=white)

Una PWA personal para organizar tareas, rutinas, calendario y recordatorios desde el ordenador o el iPhone.

La idea nació de una sensación bastante simple: probé aplicaciones de productividad, pero ninguna encajaba del todo con mi forma de organizarme. Unas eran demasiado rígidas, otras demasiado cargadas, y casi todas me obligaban a trabajar como quería la herramienta. Así que decidí desarrollar la mía: una app hecha a mi medida, con los flujos, prioridades y pequeños detalles que yo quería usar cada día.

URL publicada: despliegue de produccion en Vercel conectado al repositorio de GitHub.

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
- Vercel como despliegue estático del frontend.
- Supabase Edge Functions para avisos push en segundo plano.

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

## Despliegue

El frontend se despliega en Vercel desde el repositorio de GitHub. Al hacer `git push` a la rama de produccion, Vercel publica la nueva version de la PWA.

La Edge Function se despliega aparte en Supabase:

```powershell
npx supabase functions deploy send-reminders --project-ref <project-ref> --no-verify-jwt
```

Cuando se cambian `app.js`, `index.html` o `service-worker.js`, conviene subir la version de cache/querystring para que iPhone descargue el codigo nuevo.

## Usarla En iPhone

Para instalarla en iPhone necesitas abrirla desde una URL HTTPS, por ejemplo la versión publicada en Vercel.

1. Abre la URL de producción de Vercel en Safari.
2. Pulsa compartir.
3. Elige `Añadir a pantalla de inicio`.

Desde ahí se comporta como una app instalada.

## Sincronización Con Supabase

La app funciona en local sin cuenta. Si quieres sincronización:

1. Crea un proyecto en Supabase.
2. Ejecuta `supabase/schema.sql` en el SQL Editor.
3. Copia la `Project URL` y la clave `publishable` o `anon`.
4. Copia `supabase-config.example.js` a `supabase-config.js` y pega esos valores publicos.
5. En `Authentication > URL Configuration`, configura la URL de la app:

```text
https://<tu-dominio-de-vercel>
```

Y añade estos redirects:

```text
https://<tu-dominio-de-vercel>/**
http://localhost:5178/**
```

Cada usuario solo puede leer y escribir sus propias tareas gracias a las políticas de Row Level Security incluidas en `supabase/schema.sql`.

## Seguridad

- No subas archivos `.env` ni claves privadas al repositorio. Usa `.env.example` solo como lista de variables necesarias.
- `supabase-config.js` se carga en el navegador y solo debe contener valores publicos: `Project URL`, clave `publishable`/`anon` y `VAPID_PUBLIC_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY` y `REMINDER_CRON_SECRET` deben configurarse como secrets en Supabase Edge Functions, Vercel o GitHub Actions segun donde se usen.
- La Edge Function `send-reminders` se despliega con `--no-verify-jwt`, pero exige `REMINDER_CRON_SECRET` en cada llamada que no sea `OPTIONS`.
- El cron debe enviar esta cabecera:

```text
Authorization: Bearer <REMINDER_CRON_SECRET>
```

## Avisos En Segundo Plano

Los avisos dentro de la app funcionan con las notificaciones del navegador. En movil, si la PWA esta cerrada, el navegador puede suspender la pagina y no ejecuta temporizadores locales. Para que los avisos lleguen con la app cerrada se usa Web Push:

- La app guarda la suscripcion push del dispositivo en `pulso_push_subscriptions`.
- Las tareas sincronizadas viven en `pulso_tasks`.
- La Edge Function `send-reminders` corre cada minuto desde Supabase Scheduler/cron.
- La funcion busca tareas debidas, cifra el payload Web Push y lo envia al push service.
- Los envios quedan registrados en `pulso_notification_log` para evitar duplicados.
- Cada tarea guarda su `timezone`, y la funcion lo usa para calcular correctamente los avisos aunque el cron corra en UTC.
- Estado actual: los avisos push en segundo plano ya funcionan con la PWA cerrada en iPhone.

Para configurar desde cero:

1. Ejecuta `supabase/schema.sql` para crear `pulso_push_subscriptions` y `pulso_notification_log`.
2. Genera claves VAPID:

```powershell
node -e "const { webcrypto } = require('crypto'); const b64 = (v) => Buffer.from(v).toString('base64url'); webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']).then(async (keys) => { const pub = await webcrypto.subtle.exportKey('raw', keys.publicKey); const priv = await webcrypto.subtle.exportKey('jwk', keys.privateKey); console.log('VAPID_PUBLIC_KEY=' + b64(new Uint8Array(pub))); console.log('VAPID_PRIVATE_KEY=' + priv.d); });"
```

3. Copia `VAPID_PUBLIC_KEY` en `supabase-config.js` como `vapidPublicKey`.
4. Guarda los secretos de la Edge Function:

```powershell
npx supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:tu-email@example.com" REMINDER_CRON_SECRET="..." --project-ref <project-ref>
```

5. Despliega la funcion sin verificacion JWT:

```powershell
npx supabase functions deploy send-reminders --project-ref <project-ref> --no-verify-jwt
```

6. Programa `send-reminders` cada minuto desde Supabase Dashboard, `pg_cron` o Scheduler. La verificacion JWT esta desactivada para esta funcion, asi que el cron debe enviar `Authorization: Bearer <REMINDER_CRON_SECRET>`.

Logs esperados cuando un recordatorio esta cerca:

```text
candidate task=... kind=reminder ... timezone=Europe/Madrid ... deltaMinutes=...
sending push task=...
push result=sent
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
│   ├── functions/
│   │   └── send-reminders/
│   │       └── index.ts
│   ├── migrations/
│   └── schema.sql
├── app.js
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── styles.css
└── supabase-config.js
```

## Estado Del Proyecto

Proyecto personal en evolucion y ya usable como PWA de productividad con sincronizacion en Supabase. El frontend esta alojado en Vercel y conectado al repositorio de GitHub.

Estado actual:

- Gestion de tareas, rutinas, calendario, busqueda, exportacion/importacion y sincronizacion cloud funcionando.
- Notificaciones in-app funcionando cuando la PWA esta abierta.
- Notificaciones push en segundo plano funcionando con la PWA cerrada en iPhone mediante `send-reminders`, Web Push y Service Worker.
- La Edge Function esta desplegada en Supabase con JWT verification desactivada y cron cada minuto.
- La sincronizacion fuerza el guardado de tareas con aviso antes de cerrar/ocultar la app para que el cron pueda procesarlas a tiempo.

La prioridad sigue siendo mantenerla rapida, clara y comoda para el uso diario: menos ruido, mas control personal y avisos fiables cuando la app no esta abierta.
