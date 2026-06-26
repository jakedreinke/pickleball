# Kristin's Pickleball Agent — with real push notifications 🏓🔔

This is the same app as before, but now it lives on a normal website instead of
inside the Claude link, and it can send a **real pop-up notification** to a
friend's phone the moment they're invited to a game — even when the app is closed.

You do **not** have to write or build any code. It's already built (the `dist`
folder). You'll create two free accounts, upload these files, and paste a few
settings. Take it one numbered step at a time. If you get stuck on any step,
tell me the step number and what you see.

It's three short stages: **A)** put the code online, **B)** make a free database,
**C)** turn it on. Budget ~30 minutes the first time.

---

## What you'll end up with
- A web link (like `https://pickleball-xyz.onrender.com`) you send to the crew.
- Everyone adds it to their home screen, taps their name, and taps **Turn on notifications**.
- When your mom schedules a game and invites them, their phone buzzes with a
  "You're invited" pop-up. They open it and tap **Yes, I'm in**.

---

## Stage A — Put the code on GitHub (free)

GitHub is just a place to store the files so the website host can read them.

1. Go to **github.com** and sign up (free). Verify your email.
2. Click the **+** in the top-right → **New repository**.
3. Name it `pickleball` (anything is fine). Leave it **Public**. Click **Create repository**.
4. On the next page, click the link **"uploading an existing file"**.
5. Open the folder of files I gave you on your computer. Select **everything
   except the `node_modules` folder** (you won't have one if you're using the
   files as delivered) and **drag it all into the upload box**. Make sure the
   `dist`, `src`, and `public` folders come along.
6. Wait for the files to finish uploading, then click **Commit changes**.

✅ Your code is now on GitHub.

---

## Stage B — Make a free database (Upstash)

This is where the shared games and crew are saved.

1. Go to **upstash.com** → **Sign Up** (you can use your Google account).
2. Click **Create Database** (choose the **Redis** type).
3. Give it a name like `pickleball`, pick the region closest to you, and create it
   on the **Free** plan.
4. On the database page, find the section called **REST API**.
5. Copy these two values somewhere safe — you'll need them in Stage C:
   - **UPSTASH_REDIS_REST_URL** (a web address)
   - **UPSTASH_REDIS_REST_TOKEN** (a long secret code)

✅ Your database is ready.

---

## Stage C — Put it online (Render) and turn it on

Render is the free website host that runs the app.

1. Go to **render.com** → **Get Started** → sign up **with GitHub** (this lets
   Render see the repo you made). Approve the access it asks for.
2. Click **New +** → **Web Service**.
3. Find your `pickleball` repository in the list and click **Connect**.
4. Fill in the settings:
   - **Name:** `pickleball` (this becomes part of your web link)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Click **Advanced** (or scroll to **Environment Variables**) and **add these
   variables** one by one. Copy the names exactly:

   | Key | Value |
   |-----|-------|
   | `VAPID_PUBLIC_KEY` | (copy from the `.env.example` file) |
   | `VAPID_PRIVATE_KEY` | (copy from the `.env.example` file) |
   | `VAPID_CONTACT` | `mailto:youremail@example.com` (your email) |
   | `UPSTASH_REDIS_REST_URL` | (the URL you copied in Stage B) |
   | `UPSTASH_REDIS_REST_TOKEN` | (the token you copied in Stage B) |

6. Click **Create Web Service** and wait a few minutes while it deploys. When
   it's done you'll see a link at the top like `https://pickleball-xxxx.onrender.com`.
   That's your app. 🎉

---

## Turn on notifications and test it

1. Open your new link **on your phone** (text it to yourself).
2. Add it to your home screen:
   - **iPhone:** Share button → **Add to Home Screen**. (On iPhone, notifications
     only work when it's opened from the home-screen icon — so always open it that way.)
   - **Android:** menu (⋮) → **Add to Home screen**.
3. Open it from the new home-screen icon. Tap your name, then tap the yellow
   **Turn on notifications** banner and tap **Allow**.
4. Have your mom (or you, as Kristin) schedule a game and invite you. Your phone
   should buzz with the invite within a few seconds. Open it and tap **Yes, I'm in**.
5. Send the link to the rest of the crew so they each do steps 1–3.

---

## Good to know
- **First open of the day can be slow.** On Render's free plan the app "sleeps"
  when no one's used it for a while and takes ~30–60 seconds to wake up on the
  next visit. After that it's quick. (A paid plan removes the sleep if you ever want.)
- **iPhone notifications** require the home-screen install (step 2) and a fairly
  recent iOS. If a friend opens the plain link in Safari without installing, they
  won't get pop-ups until they add it to the home screen.
- **The data is shared** with everyone who has the link, same as before — including
  phone numbers. Keep the link within the group.
- **Want to change the app later?** Tell me what to change; I'll send updated
  files, and you re-upload them to GitHub. Render redeploys automatically.

## If something doesn't work
Tell me the stage/step and what you see on screen. Common ones:
- *Render page shows an error:* usually a missing or mistyped environment variable —
  double-check Stage C step 5.
- *No notification arrives:* make sure you opened the app from the home-screen icon
  and tapped **Allow**, and that you invited the same name you signed in as.
