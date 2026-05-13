import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.4";

type TaskRow = {
  user_id: string;
  task_id: string;
  payload: Record<string, unknown>;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone: string;
};

type DueNotification = {
  kind: "reminder" | "due";
  fireAt: Date;
};

const STALE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DUE_LEAD_MS = 10 * 60 * 1000;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET") || "";
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@example.com";

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "Missing Supabase or VAPID configuration" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const [{ data: taskRows, error: taskError }, { data: subscriptionRows, error: subscriptionError }] =
    await Promise.all([
      supabase.from("pulso_tasks").select("user_id,task_id,payload").is("deleted_at", null),
      supabase.from("pulso_push_subscriptions").select("id,user_id,endpoint,p256dh,auth,timezone"),
    ]);

  if (taskError || subscriptionError) {
    return json({ error: taskError?.message || subscriptionError?.message }, 500);
  }

  const subscriptionsByUser = new Map<string, PushSubscriptionRow[]>();
  for (const subscription of (subscriptionRows || []) as PushSubscriptionRow[]) {
    const subscriptions = subscriptionsByUser.get(subscription.user_id) || [];
    subscriptions.push(subscription);
    subscriptionsByUser.set(subscription.user_id, subscriptions);
  }

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let expired = 0;

  for (const row of (taskRows || []) as TaskRow[]) {
    const subscriptions = subscriptionsByUser.get(row.user_id) || [];
    if (!subscriptions.length || isCompleted(row.payload)) {
      continue;
    }

    const groups = getDueGroups(row.payload, subscriptions, now);
    for (const group of groups) {
      const { error: logError } = await supabase.from("pulso_notification_log").insert({
        user_id: row.user_id,
        task_id: row.task_id,
        kind: group.notification.kind,
        fire_at: group.notification.fireAt.toISOString(),
      });

      if (logError) {
        if (logError.code === "23505") {
          skipped += group.subscriptions.length;
          continue;
        }
        failed += group.subscriptions.length;
        continue;
      }

      let delivered = false;
      for (const subscription of group.subscriptions) {
        const result = await sendEmptyPush(subscription, {
          publicKey: vapidPublicKey,
          privateKey: vapidPrivateKey,
          subject: vapidSubject,
        });
        if (result === "sent") {
          sent += 1;
          delivered = true;
        } else if (result === "expired") {
          expired += 1;
          await supabase.from("pulso_push_subscriptions").delete().eq("id", subscription.id);
        } else {
          failed += 1;
        }
      }

      if (delivered) {
        await markTaskNotified(supabase, row, group.notification.kind);
      }
    }
  }

  return json({ sent, skipped, failed, expired });
});

async function markTaskNotified(supabase: ReturnType<typeof createClient>, row: TaskRow, kind: DueNotification["kind"]) {
  const nowIso = new Date().toISOString();
  const payload = {
    ...row.payload,
    updatedAt: nowIso,
    ...(kind === "reminder" ? { reminderNotified: true } : { notified: true }),
  };
  row.payload = payload;
  await supabase
    .from("pulso_tasks")
    .update({ payload, updated_at: nowIso })
    .eq("user_id", row.user_id)
    .eq("task_id", row.task_id);
}

function getDueGroups(task: Record<string, unknown>, subscriptions: PushSubscriptionRow[], now: Date) {
  const groups = new Map<string, { notification: DueNotification; subscriptions: PushSubscriptionRow[] }>();

  for (const subscription of subscriptions) {
    for (const notification of getDueNotifications(task, subscription.timezone || "UTC", now)) {
      const key = `${notification.kind}:${notification.fireAt.toISOString()}`;
      const group = groups.get(key) || { notification, subscriptions: [] };
      group.subscriptions.push(subscription);
      groups.set(key, group);
    }
  }

  return [...groups.values()];
}

function getDueNotifications(task: Record<string, unknown>, timezone: string, now: Date): DueNotification[] {
  const notifications: DueNotification[] = [];
  const reminderDate = asString(task.reminderDate);
  const reminderTime = asString(task.reminderTime);
  if (reminderDate && reminderTime) {
    const fireAt = zonedDateTimeToUtc(reminderDate, reminderTime, timezone);
    if (isDueWindow(fireAt, now)) {
      notifications.push({ kind: "reminder", fireAt });
    }
    return notifications;
  }

  const dueDate = asString(task.dueDate);
  const dueTime = asString(task.dueTime);
  const repeat = asString(task.repeat) || "none";
  if (repeat === "none" && dueDate && dueTime) {
    const fireAt = new Date(zonedDateTimeToUtc(dueDate, dueTime, timezone).getTime() - DUE_LEAD_MS);
    if (isDueWindow(fireAt, now)) {
      notifications.push({ kind: "due", fireAt });
    }
  }
  return notifications;
}

function isCompleted(task: Record<string, unknown>) {
  return Boolean(task.completed);
}

function isDueWindow(fireAt: Date, now: Date) {
  const delta = now.getTime() - fireAt.getTime();
  return delta >= 0 && delta <= STALE_WINDOW_MS;
}

function zonedDateTimeToUtc(dateKey: string, timeKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeKey.split(":").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0);
  let utc = targetUtc;

  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    utc += targetUtc - representedUtc;
  }

  return new Date(utc);
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

async function sendEmptyPush(
  subscription: PushSubscriptionRow,
  vapid: { publicKey: string; privateKey: string; subject: string },
) {
  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        TTL: "3600",
        Urgency: "normal",
        Authorization: await createVapidAuthorization(subscription.endpoint, vapid),
      },
    });

    if (response.status === 404 || response.status === 410) {
      return "expired";
    }
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

async function createVapidAuthorization(
  endpoint: string,
  vapid: { publicKey: string; privateKey: string; subject: string },
) {
  const token = await createVapidJwt(new URL(endpoint).origin, vapid);
  return `vapid t=${token}, k=${vapid.publicKey}`;
}

async function createVapidJwt(audience: string, vapid: { publicKey: string; privateKey: string; subject: string }) {
  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: vapid.subject,
    }),
  );
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("jwk", vapidJwk(vapid.publicKey, vapid.privateKey), {
    name: "ECDSA",
    namedCurve: "P-256",
  }, false, ["sign"]);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function vapidJwk(publicKey: string, privateKey: string) {
  const rawPublicKey = base64UrlDecode(publicKey);
  if (rawPublicKey.length !== 65 || rawPublicKey[0] !== 4) {
    throw new Error("Invalid VAPID public key");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(rawPublicKey.slice(1, 33)),
    y: base64UrlEncode(rawPublicKey.slice(33, 65)),
    d: privateKey,
    ext: true,
  };
}

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from([...binary].map((char) => char.charCodeAt(0)));
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
