// Talks to the small backend (server.js): shared game/crew data, per-device
// identity, and web-push subscriptions. Replaces Claude's window.storage.

async function api(path, opts) {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.status === 204 ? null : r.json();
}

/* -------- shared state (games / crew / log / settings) -------- */
export async function loadState() {
  try {
    const r = await api("/api/state");
    return r && r.state ? r.state : null;
  } catch (e) {
    return null;
  }
}
export async function saveState(state) {
  try {
    await api("/api/state", { method: "PUT", body: JSON.stringify({ state }) });
  } catch (e) {}
}

/* -------- who is using THIS device (stays local) -------- */
export function loadMe() {
  try {
    return localStorage.getItem("kpa:me") || null;
  } catch (e) {
    return null;
  }
}
export function saveMe(id) {
  try {
    if (id) localStorage.setItem("kpa:me", id);
    else localStorage.removeItem("kpa:me");
  } catch (e) {}
}

/* -------- web push -------- */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Returns "granted" | "denied" | "unsupported" | "error".
export async function enablePush(friendId) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return perm; // "denied" or "default"
    const { key } = await api("/api/vapidPublicKey");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await api("/api/subscribe", {
      method: "POST",
      body: JSON.stringify({ friendId, subscription: sub }),
    });
    return "granted";
  } catch (e) {
    console.log("enablePush error", e);
    return "error";
  }
}

// Ask the server to push a notification to one friend.
export async function notifyFriend(friendId, title, body) {
  try {
    await api("/api/notify", {
      method: "POST",
      body: JSON.stringify({ friendId, title, body }),
    });
  } catch (e) {}
}

export function pushPermission() {
  try {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission; // "default" | "granted" | "denied"
  } catch (e) {
    return "unsupported";
  }
}
