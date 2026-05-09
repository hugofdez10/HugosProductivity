# Hugo's Productivity

![PWA](https://img.shields.io/badge/PWA-instalable-111827?style=for-the-badge&logo=pwa)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?style=for-the-badge&logo=javascript&logoColor=111827)
![Supabase](https://img.shields.io/badge/Supabase-sync-3FCF8E?style=for-the-badge&logo=supabase&logoColor=0f172a)
![Netlify](https://img.shields.io/badge/Netlify-deploy-00C7B7?style=for-the-badge&logo=netlify&logoColor=white)

Una PWA personal para organizar tareas, rutinas, calendario y recordatorios desde el ordenador o el iPhone.

La idea nació de una sensación bastante simple: probé aplicaciones de productividad, pero ninguna encajaba del todo con mi forma de organizarme. Unas eran demasiado rígidas, otras demasiado cargadas, y casi todas me obligaban a trabajar como quería la herramienta. Así que decidí desarrollar la mía: una app hecha a mi medida, con los flujos, prioridades y pequeños detalles que yo quería usar cada día.

URL publicada: [hugosproductivity.netlify.app](https://hugosproductivity.netlify.app)

## Qué Puedes Hacer

- Capturar tareas rápido con fecha, hora, duración, importancia, energía, lugar, área y notas.
- Ver el plan del día, los pendientes, un calendario mensual y una vista de radar.
- Pedirle a la app que recomiende el siguiente paso según el tiempo disponible y el contexto.
- Crear rutinas diarias, semanales, mensuales, por días concretos o por objetivo semanal.
- Activar avisos con fecha y hora usando notificaciones del navegador.
- Buscar tareas por título, notas o etiquetas.
- Exportar e importar una copia de tus datos en JSON.
- Usarla como app instalada gracias al manifest y al service worker.
- Sincronizar tareas con Supabase al iniciar sesión.

## Por Qué Es Diferente

Hugo's Productivity no intenta ser un gestor universal para equipos enormes. Está pensada para una persona que quiere decidir mejor qué hacer ahora, mantener rutinas vivas y tener un sistema claro sin pelearse con veinte pantallas.

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
