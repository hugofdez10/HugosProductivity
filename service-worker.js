const CACHE_NAME = "pulso-cache-v22";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=22",
  "./app.js?v=22",
  "./supabase-config.js",
  "./manifest.webmanifest",
  "./assets/logo-mark.png",
  "./assets/logo-full.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];
const NETWORK_FIRST_PATHS = new Set(["/", "/index.html", "/styles.css", "/app.js", "/service-worker.js"]);
const REMINDER_FUNCTION_URL = "https://oigvjljneyrkjfqsvucq.supabase.co/functions/v1/send-reminders";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const url = new URL(event.request.url);
  const pathname = url.pathname.replace(/\/+$/, "/");
  const filePath = pathname.slice(pathname.lastIndexOf("/"));
  if (NETWORK_FIRST_PATHS.has(filePath) || pathname.endsWith("/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }
  if (url.pathname.endsWith("/supabase-config.js")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url.includes(targetUrl));
      if (existingClient) {
        return existingClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(showPushNotification(event));
});

async function showPushNotification(event) {
  const payload = await resolvePushPayload(event);
  const title = payload.title || "Hugo's Productivity";
  const options = {
    body: payload.body || "Tienes un aviso pendiente.",
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    tag: payload.tag || `task-reminder-${Date.now()}`,
    renotify: true,
    data: {
      taskId: payload.taskId || "",
      url: payload.url || "./index.html",
    },
    vibrate: [80, 40, 80],
  };

  return self.registration.showNotification(title, options);
}

async function resolvePushPayload(event) {
  try {
    if (event.data) {
      return event.data.json();
    }
  } catch {
    // Empty pushes are resolved through the function below.
  }

  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription?.endpoint) {
      return {};
    }
    const response = await fetch(REMINDER_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "resolve-push",
        endpoint: subscription.endpoint,
      }),
    });
    if (!response.ok) {
      return {};
    }
    return await response.json();
  } catch {
    return {};
  }
}
