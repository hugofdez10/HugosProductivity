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
const DIAGNOSTIC_WINDOW_MS = 3 * 60 * 60 * 1000;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const expectedSecret = Deno.env.get("REMINDER_CRON_SECRET") || "";
  const authHeader = request.headers.get("Authorization") || "";

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
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

  const body = await readJsonBody(request);
  if (body.mode === "resolve-push") {
    return resolvePushPayload(supabase, asString(body.endpoint));
  }

  const [{ data: taskRows, error: taskError }, { data: subscriptionRows, error: subscriptionError }] =
    await Promise.all([
      supabase.from("pulso_tasks").select("user_id,task_id,payload").is("deleted_at", null),
      supabase.from("pulso_push_subscriptions").select("id,user_id,endpoint,p256dh,auth,timezone"),
    ]);

  if (taskError || subscriptionError) {
    console.error("DB error:", taskError?.message || subscriptionError?.message);
    return json({ error: taskError?.message || subscriptionError?.message }, 500);
  }

  console.log(`tasks=${taskRows?.length ?? 0} subscriptions=${subscriptionRows?.length ?? 0}`);

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

    logNotificationCandidate(row.task_id, row.payload, subscriptions[0]?.timezone || "UTC", now);
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
        const pushPayload = buildPushPayload(group.notification, row.payload, row.task_id);
        console.log(`sending push task=${row.task_id} kind=${group.notification.kind} endpoint=${subscription.endpoint.slice(-20)}`);
        const result = await sendPush(subscription, {
          publicKey: vapidPublicKey,
          privateKey: vapidPrivateKey,
          subject: vapidSubject,
        }, pushPayload);
        console.log(`push result=${result} task=${row.task_id}`);
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

  console.log(`done sent=${sent} skipped=${skipped} failed=${failed} expired=${expired}`);
  return json({ sent, skipped, failed, expired });
});

async function resolvePushPayload(supabase: ReturnType<typeof createClient>, endpoint: string) {
  if (!endpoint) {
    return json({});
  }

  const { data: subscription } = await supabase
    .from("pulso_push_subscriptions")
    .select("user_id")
    .eq("endpoint", endpoint)
    .maybeSingle();

  if (!subscription?.user_id) {
    return json({});
  }

  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: log } = await supabase
    .from("pulso_notification_log")
    .select("task_id,kind,created_at")
    .eq("user_id", subscription.user_id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!log?.task_id) {
    return json({});
  }

  const { data: taskRow } = await supabase
    .from("pulso_tasks")
    .select("payload")
    .eq("user_id", subscription.user_id)
    .eq("task_id", log.task_id)
    .maybeSingle();

  const task = (taskRow?.payload || {}) as Record<string, unknown>;
  const title = asString(task.title) || "Hugo's Productivity";
  const duration = Number(task.duration) || 30;
  const body =
    log.kind === "reminder"
      ? `Aviso ${formatDateLabel(asString(task.reminderDate))}, ${asString(task.reminderTime)} · ${duration} min`
      : `${formatDateLabel(asString(task.dueDate))}, ${asString(task.dueTime)} · ${duration} min`;

  return json({
    title,
    body,
    taskId: log.task_id,
    tag: `task-${log.task_id}-${log.kind}`,
    url: "./index.html",
  });
}

async function readJsonBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

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
    const timezone = getNotificationTimezone(task, subscription.timezone || "UTC");
    for (const notification of getDueNotifications(task, timezone, now)) {
      const key = `${notification.kind}:${notification.fireAt.toISOString()}`;
      const group = groups.get(key) || { notification, subscriptions: [] };
      group.subscriptions.push(subscription);
      groups.set(key, group);
    }
  }

  return [...groups.values()];
}

function logNotificationCandidate(taskId: string, task: Record<string, unknown>, subscriptionTimezone: string, now: Date) {
  const timezone = getNotificationTimezone(task, subscriptionTimezone);
  const notification = getNextNotification(task, timezone);
  if (!notification) {
    return;
  }
  const deltaMs = notification.fireAt.getTime() - now.getTime();
  if (Math.abs(deltaMs) > DIAGNOSTIC_WINDOW_MS) {
    return;
  }
  const deltaMinutes = Math.round(deltaMs / 60000);
  console.log(
    `candidate task=${taskId} kind=${notification.kind} fireAt=${notification.fireAt.toISOString()} now=${now.toISOString()} timezone=${timezone} subscriptionTimezone=${subscriptionTimezone} deltaMinutes=${deltaMinutes}`,
  );
}

function getNotificationTimezone(task: Record<string, unknown>, fallbackTimezone: string) {
  const candidates = [asString(task.timezone), fallbackTimezone, "UTC"];
  return candidates.find(isValidTimeZone) || "UTC";
}

function isValidTimeZone(timezone: string) {
  if (!timezone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function getNextNotification(task: Record<string, unknown>, timezone: string): DueNotification | null {
  const reminderDate = asString(task.reminderDate);
  const reminderTime = asString(task.reminderTime);
  if (reminderDate && reminderTime) {
    return { kind: "reminder", fireAt: zonedDateTimeToUtc(reminderDate, reminderTime, timezone) };
  }

  const dueDate = asString(task.dueDate);
  const dueTime = asString(task.dueTime);
  const repeat = asString(task.repeat) || "none";
  if (repeat === "none" && dueDate && dueTime) {
    const fireAt = new Date(zonedDateTimeToUtc(dueDate, dueTime, timezone).getTime() - DUE_LEAD_MS);
    return { kind: "due", fireAt };
  }

  return null;
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

function buildPushPayload(
  notification: DueNotification,
  task: Record<string, unknown>,
  taskId: string,
): string {
  const title = asString(task.title) || "Hugo's Productivity";
  const duration = Number(task.duration) || 30;
  const body =
    notification.kind === "reminder"
      ? `Recordatorio · ${asString(task.reminderTime)} · ${duration} min`
      : `Vence · ${asString(task.dueTime)} · ${duration} min`;
  return JSON.stringify({
    title,
    body,
    taskId,
    tag: `task-${taskId}-${notification.kind}`,
    url: "./index.html",
  });
}

async function sendPush(
  subscription: PushSubscriptionRow,
  vapid: { publicKey: string; privateKey: string; subject: string },
  payload: string,
) {
  try {
    const encrypted = await encryptPayload(payload, subscription.p256dh, subscription.auth);
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        TTL: "3600",
        Urgency: "normal",
        Authorization: await createVapidAuthorization(subscription.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(encrypted.length),
      },
      body: encrypted,
    });
    if (response.status === 404 || response.status === 410) {
      return "expired";
    }
    return response.ok ? "sent" : "failed";
  } catch (err) {
    console.error("sendPush error:", err);
    return "failed";
  }
}

async function encryptPayload(payload: string, p256dhBase64: string, authBase64: string): Promise<Uint8Array> {
  const receiverPublicKeyBytes = base64UrlDecode(p256dhBase64);
  const authSecret = base64UrlDecode(authBase64);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const senderKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const senderPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", senderKeyPair.publicKey));

  const receiverPublicKey = await crypto.subtle.importKey(
    "raw",
    receiverPublicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverPublicKey }, senderKeyPair.privateKey, 256),
  );

  const prkKey = await hkdfExtract(authSecret, ecdhSecret);
  const keyInfo = concatBytes(
    new TextEncoder().encode("WebPush: info\x00"),
    receiverPublicKeyBytes,
    senderPublicKeyBytes,
  );
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\x00"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\x00"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const paddedPlaintext = concatBytes(new TextEncoder().encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, paddedPlaintext),
  );

  const header = new Uint8Array(21 + senderPublicKeyBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = senderPublicKeyBytes.length;
  header.set(senderPublicKeyBytes, 21);

  return concatBytes(header, ciphertext);
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<CryptoKey> {
  const saltKey = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = await crypto.subtle.sign("HMAC", saltKey, ikm);
  return crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function hkdfExpand(prk: CryptoKey, info: Uint8Array, length: number): Promise<Uint8Array> {
  const result = new Uint8Array(length);
  let t = new Uint8Array(0);
  let written = 0;
  for (let i = 1; written < length; i++) {
    t = new Uint8Array(await crypto.subtle.sign("HMAC", prk, concatBytes(t, info, new Uint8Array([i]))));
    const toCopy = Math.min(t.length, length - written);
    result.set(t.slice(0, toCopy), written);
    written += toCopy;
  }
  return result;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
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

function formatDateLabel(dateKey: string) {
  if (!dateKey) {
    return "";
  }
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
