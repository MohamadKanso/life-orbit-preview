// Life Orbit service worker — push notifications only.
// There is deliberately no fetch handler and no cache: every request goes to the network as if this
// file didn't exist, so a new deploy is never stuck behind an old copy of the app.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const appWindows = () => self.clients.matchAll({ type: "window", includeUncontrolled: true });

self.addEventListener("push", (event) => {
  event.waitUntil(onPush(event));
});

async function onPush(event) {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const kind = data.kind || "notification";
  const windows = await appWindows();
  // Open Life Orbit windows hear about every push (Settings uses it to confirm a test arrived).
  const tell = (extra) => windows.forEach((w) => w.postMessage({ type: "lo-push", kind, tag: data.tag || null, ...extra }));

  // Someone is looking at the app right now: it has already shown its own card and sound.
  if (kind !== "test" && kind !== "call" && windows.some((w) => w.focused && w.visibilityState === "visible")) return tell({ shown: false });

  let title = data.title || "Life Orbit";
  const tag = data.tag || undefined;
  let renotify = Boolean(tag && data.renotify);
  let buzzedAt = Date.now();
  if (kind === "message" && tag) {
    // Messages in one chat share a notification: newest text, a count, and a buzz only for the
    // first message of a burst (or after a minute of quiet).
    const [open] = await self.registration.getNotifications({ tag });
    // The server sends the unread count; it's right even if some were read on another device.
    const count = Number(data.count) || (open?.data?.count || 0) + 1;
    if (count > 1) title = `${title} · ${count} new messages`;
    renotify = !open || Date.now() - (open.data?.at || 0) > 60000;
    if (open && !renotify) buzzedAt = open.data.at;
    data.count = count;
  }
  const shown = self.registration.showNotification(title, {
    body: data.body || "",
    tag,
    renotify,
    icon: "icon-192.png",
    badge: "badge-96.png",
    timestamp: data.ts || Date.now(),
    requireInteraction: Boolean(data.requireInteraction),
    silent: Boolean(data.silent),
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    data: { url: data.url || "./#/", kind, count: data.count || 1, at: buzzedAt },
  });
  return shown.then(
    () => tell({ shown: true }),
    (error) => {
      tell({ shown: false, error: String(error?.message || error) });
      throw error;
    }
  );
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./#/", self.registration.scope).href;
  event.waitUntil(openApp(url));
});

// Focus an open Life Orbit window and take it to the right place, or open one.
async function openApp(url) {
  const windows = await appWindows();
  const existing = windows.find((w) => w.url.startsWith(self.registration.scope)) || windows[0];
  if (existing) {
    // Only the hash changes, so the page navigates itself (src/lib/push.js) — no reload, and a call
    // in progress keeps going.
    existing.postMessage({ type: "lo-open", url });
    try {
      return await existing.focus();
    } catch {
      return existing;
    }
  }
  // A fresh window skips the intro animation (src/lib/push-links.js) — a ringing call can't wait.
  const fresh = new URL(url);
  fresh.hash += fresh.hash.includes("?") ? "&via=push" : "?via=push";
  return self.clients.openWindow(fresh.href);
}
