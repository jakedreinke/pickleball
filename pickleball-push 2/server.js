import express from "express";
import webpush from "web-push";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

/* ----------------------------------------------------------------------
   VAPID keys identify your server to the browser push services.
   They MUST stay the same across restarts, so they come from env vars.
   Generate a pair once with:  npx web-push generate-vapid-keys
   (a ready-made pair is in .env.example to get you started).
---------------------------------------------------------------------- */
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const CONTACT = process.env.VAPID_CONTACT || "mailto:example@example.com";
let pushReady = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
  pushReady = true;
} else {
  console.warn("⚠  No VAPID keys set — push notifications are OFF until you add them.");
}

/* ----------------------------------------------------------------------
   Storage. Uses Upstash Redis (free) if its two env vars are present;
   otherwise falls back to in-memory (fine for local testing, but it
   forgets everything when the server restarts).
---------------------------------------------------------------------- */
const UP_URL = process.env.UPSTASH_REDIS_REST_URL;
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = !!(UP_URL && UP_TOKEN);
const mem = new Map();

/* ----------------------------------------------------------------------
   Email (optional). If a Brevo API key + sender are set, the app will
   EMAIL anyone who hasn't installed the app, as a fallback for push.
   Free, no domain needed — just verify your sender address in Brevo.
---------------------------------------------------------------------- */
const BREVO_KEY = process.env.BREVO_API_KEY || "";
const SENDER_EMAIL = process.env.SENDER_EMAIL || "";
const SENDER_NAME = process.env.SENDER_NAME || "Kristin's Pickleball Agent";
const emailReady = !!(BREVO_KEY && SENDER_EMAIL);

async function sendEmail(to, name, subject, text) {
  if (!emailReady) return false;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: SENDER_EMAIL, name: SENDER_NAME },
        to: [{ email: to, name: name || to }],
        subject,
        textContent: text,
        htmlContent: `<p>${text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>')}</p>`,
      }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function upstash(cmd) {
  const r = await fetch(UP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  return j.result;
}
async function kvGet(key) {
  if (useUpstash) {
    const v = await upstash(["GET", key]);
    return v ? JSON.parse(v) : null;
  }
  return mem.has(key) ? mem.get(key) : null;
}
async function kvSet(key, val) {
  if (useUpstash) {
    await upstash(["SET", key, JSON.stringify(val)]);
  } else {
    mem.set(key, val);
  }
}

const STATE_KEY = "kpa:state";
const SUBS_KEY = "kpa:subs"; // { friendId: [subscription, ...] }

/* --------------------------- API --------------------------- */
app.get("/api/vapidPublicKey", (req, res) => res.json({ key: VAPID_PUBLIC }));

app.get("/api/state", async (req, res) => {
  const state = (await kvGet(STATE_KEY)) || null;
  res.json({ state });
});

app.put("/api/state", async (req, res) => {
  if (!req.body || typeof req.body.state !== "object") return res.status(400).json({ error: "bad state" });
  await kvSet(STATE_KEY, req.body.state);
  res.status(204).end();
});

app.post("/api/subscribe", async (req, res) => {
  const { friendId, subscription } = req.body || {};
  if (!friendId || !subscription) return res.status(400).json({ error: "missing fields" });
  const subs = (await kvGet(SUBS_KEY)) || {};
  const list = subs[friendId] || [];
  // de-dupe by endpoint
  if (!list.some((s) => s.endpoint === subscription.endpoint)) list.push(subscription);
  subs[friendId] = list;
  await kvSet(SUBS_KEY, subs);
  res.status(204).end();
});

app.post("/api/notify", async (req, res) => {
  const { friendId, title, body, email, emailText, name } = req.body || {};
  if (!friendId) return res.status(400).json({ error: "missing friendId" });
  const subs = (await kvGet(SUBS_KEY)) || {};
  const list = subs[friendId] || [];

  // 1) If they've installed the app, send a push notification.
  if (list.length && pushReady) {
    const payload = JSON.stringify({ title: title || "Pickleball 🏓", body: body || "", url: "/" });
    let sent = 0;
    const keep = [];
    for (const sub of list) {
      try {
        await webpush.sendNotification(sub, payload);
        keep.push(sub);
        sent++;
      } catch (err) {
        if (err.statusCode !== 404 && err.statusCode !== 410) keep.push(sub);
      }
    }
    subs[friendId] = keep;
    await kvSet(SUBS_KEY, subs);
    if (sent > 0) return res.json({ sent, channel: "push" });
  }

  // 2) Otherwise, fall back to email if we have an address.
  if (email && emailText && emailReady) {
    const ok = await sendEmail(email, name, title || "You're invited to pickleball 🏓", emailText);
    return res.json({ sent: ok ? 1 : 0, channel: ok ? "email" : "none" });
  }

  res.json({ sent: 0, channel: "none" });
});

/* ------------------- serve the built app ------------------- */
const dist = path.join(__dirname, "dist");
app.use(express.static(dist));
app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Pickleball app running on port ${PORT}`);
  console.log(`  push: ${pushReady ? "ON" : "OFF (set VAPID keys)"} · storage: ${useUpstash ? "Upstash" : "in-memory (not saved)"} · email: ${emailReady ? "ON" : "OFF (set Brevo key)"}`);
});
