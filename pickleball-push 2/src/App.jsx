import { useState, useEffect, useMemo, useRef } from "react";
import {
  CalendarDays, Users, Bot, Plus, Check, X, Clock, MapPin, Phone, Send,
  ChevronLeft, Settings, Trash2, MessageSquare, PartyPopper, AlertCircle,
  Copy, UserPlus, Info, Home, RefreshCw, Star, CalendarPlus, Bell,
} from "lucide-react";
import { loadState, saveState, loadMe, saveMe, enablePush, notifyFriend, pushPermission } from "./api.js";

/* ----------------------------- helpers ----------------------------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const CAP = 4;

const dObj = (iso) => new Date(iso + "T12:00:00");
const fmtDay = (iso) => dObj(iso).toLocaleDateString(undefined, { weekday: "long" });
const fmtDate = (iso) => dObj(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtFull = (iso) => dObj(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
const fmtShort = (iso) => dObj(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const todayISO = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
const isMondayToday = () => new Date().getDay() === 1;
const weekKey = () => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return d.toLocaleDateString("en-CA");
};
const hoursSince = (ts) => (Date.now() - ts) / 36e5;
const initialOf = (name) => (name || "?").trim().charAt(0).toUpperCase();

function buildTimes() {
  const out = [];
  for (let h = 7; h <= 20; h++) {
    for (const m of [0, 30]) {
      const ap = h < 12 ? "AM" : "PM";
      const hh = h % 12 === 0 ? 12 : h % 12;
      out.push(`${hh}:${m === 0 ? "00" : "30"} ${ap}`);
    }
  }
  return out;
}

/* ----------------------------- message drafts ----------------------------- */
const hostLabel = (host) => (host?.isOwner ? "Kristin" : host?.name || "Your host");

function draftInvite(game, friend, host) {
  return `Hi ${friend.name}! 🏓 This is Kristin's Pickleball Agent. ${hostLabel(host)} is hosting pickleball on ${fmtFull(game.date)} at ${game.time}, at ${game.location}. Open our pickleball app and tap "Yes, I'm in" to grab a spot (or just reply YES/NO here and we'll add you). Hope to see you on the court!`;
}
function draftFull(game, friend) {
  return `Hi ${friend.name}, thanks so much for getting back to us! 🏓 We've already got all 4 players lined up for ${fmtFull(game.date)} at ${game.time}, so we're set this time around. Kristin will keep you in mind for the next game — thanks for being up for it!`;
}
function draftDeclined(game, friend) {
  return `Heads up, Kristin — ${friend.name} can't make ${fmtFull(game.date)} at ${game.time}. Who else would you like me to ask? Open the app, pick a backup, and I'll text them.`;
}
function draftOverdue(game, friend) {
  return `Heads up, Kristin — ${friend.name} hasn't replied about ${fmtFull(game.date)} at ${game.time} (it's been over 48 hours). Want me to ask someone else? Open the app to pick a backup.`;
}
function draftConfirmed(game, names) {
  return `🎉 You're all set, Kristin! Four players are locked in for ${fmtFull(game.date)} at ${game.time} at ${game.location}: ${names.join(", ")}. Have a great game!`;
}
function draftMonday(games, byId) {
  const upcoming = games
    .filter((g) => g.date >= todayISO())
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (upcoming.length === 0)
    return `Good morning, Kristin! 🏓 It's Monday and there are no games on the calendar yet. Open the app to schedule one and I'll start lining up your crew.`;
  const lines = upcoming
    .map((g) => {
      const c = confirmedPlayers(g, byId).length;
      return `• ${fmtShort(g.date)} at ${g.time} — ${c} of ${CAP} confirmed`;
    })
    .join("\n");
  return `Good morning, Kristin! 🏓 It's Monday — here's the pickleball lineup to confirm this week:\n${lines}\nOpen the app to see who's in and who could use a nudge.`;
}

/* ----------------------------- roster logic ----------------------------- */
function confirmedPlayers(game, byId) {
  const host = byId[game.hostId];
  const list = host ? [{ id: host.id, name: host.name, isHost: true }] : [];
  for (const inv of game.invites) {
    if (inv.status === "yes") {
      const f = byId[inv.friendId];
      if (f) list.push({ id: f.id, name: f.name, isHost: false });
    }
  }
  return list.slice(0, CAP);
}
const spotsLeft = (game, byId) => CAP - confirmedPlayers(game, byId).length;
const isFull = (game, byId) => confirmedPlayers(game, byId).length >= CAP;

function statusLine(game, byId) {
  const confirmed = confirmedPlayers(game, byId).length;
  const left = CAP - confirmed;
  const pending = game.invites.filter((i) => i.status === "pending").length;
  if (confirmed >= CAP) return { text: "All set — 4 players locked in", tone: "full" };
  if (pending > 0)
    return { text: `Waiting on ${pending} ${pending === 1 ? "reply" : "replies"} · needs ${left} more`, tone: "wait" };
  return { text: `Needs ${left} more — invite friends or pick backups`, tone: "need" };
}

/* ----------------------------- persistence ----------------------------- */
// loadState/saveState (shared games + crew, via the backend) and
// loadMe/saveMe (who's on this device, kept locally) are imported from api.js.

const OWNER = { id: "owner", name: "Kristin", phone: "", regular: false, canHost: true, isOwner: true };
const SAMPLE = [
  { id: uid(), name: "Linda", phone: "555-0142", regular: true, canHost: true, isOwner: false },
  { id: uid(), name: "Marcia", phone: "555-0188", regular: true, canHost: false, isOwner: false },
  { id: uid(), name: "Sue", phone: "555-0199", regular: true, canHost: false, isOwner: false },
  { id: uid(), name: "Patty", phone: "555-0123", regular: false, canHost: false, isOwner: false },
  { id: uid(), name: "Gail", phone: "555-0177", regular: false, canHost: false, isOwner: false },
];

/* ============================================================ */

export default function App() {
  const [friends, setFriends] = useState([OWNER]);
  const [games, setGames] = useState([]);
  const [log, setLog] = useState([]);
  const [settings, setSettings] = useState({ defaultLocation: "Sharon", ownerPhone: "" });
  const [demoOverdue, setDemoOverdue] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState(null); // friend id of whoever is using THIS device

  const [tab, setTab] = useState("games");
  const [selectedGame, setSelectedGame] = useState(null);
  const [sheet, setSheet] = useState(null); // 'schedule' | 'friend' | 'settings' | {invite: gameId} | {signup: gameId}
  const [toast, setToast] = useState("");

  const byId = useMemo(() => Object.fromEntries(friends.map((f) => [f.id, f])), [friends]);
  const owner = byId.owner || OWNER;
  const viewer = (me && byId[me]) || null; // the person using this device
  const TIMES = useMemo(buildTimes, []);

  const chooseMe = (id) => { setMe(id); saveMe(id); };
  const [pushPerm, setPushPerm] = useState(pushPermission());
  const enableNotifications = async () => {
    if (!me) return;
    const res = await enablePush(me);
    setPushPerm(pushPermission());
    if (res === "granted") showToast("Notifications on — you'll get a ping for new invites 🔔");
    else if (res === "denied") showToast("Notifications are blocked in your phone/browser settings");
    else if (res === "unsupported") showToast("This phone/browser doesn't support notifications");
    else showToast("Couldn't turn on notifications — try again");
  };

  const lastSync = useRef("");
  const DEFAULT_SETTINGS = { defaultLocation: "Sharon", ownerPhone: "" };
  const snapshot = (f, g, l, st) => JSON.stringify({ friends: f, games: g, log: l, settings: st });
  const normalize = (s) => ({
    friends: s?.friends?.length ? s.friends : [OWNER],
    games: s?.games || [],
    log: s?.log || [],
    settings: s?.settings || DEFAULT_SETTINGS,
  });

  /* load + save (shared: everyone on the link works off the same data) */
  useEffect(() => {
    (async () => {
      const o = normalize(await loadState());
      setFriends(o.friends);
      setGames(o.games);
      setLog(o.log);
      setSettings(o.settings);
      lastSync.current = snapshot(o.friends, o.games, o.log, o.settings);
      setMe(await loadMe());
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const payload = snapshot(friends, games, log, settings);
    if (payload === lastSync.current) return; // nothing actually changed
    const t = setTimeout(() => {
      lastSync.current = payload;
      saveState({ friends, games, log, settings });
    }, 350);
    return () => clearTimeout(t);
  }, [friends, games, log, settings, loaded]);
  // Poll the shared store so a sign-up or reply on one phone appears on the others.
  useEffect(() => {
    if (!loaded) return;
    const iv = setInterval(async () => {
      const o = normalize(await loadState());
      const remote = snapshot(o.friends, o.games, o.log, o.settings);
      if (remote !== lastSync.current) {
        lastSync.current = remote;
        setFriends(o.friends);
        setGames(o.games);
        setLog(o.log);
        setSettings(o.settings);
      }
    }, 12000);
    return () => clearInterval(iv);
  }, [loaded]);

  const showToast = (m) => {
    setToast(m);
    setTimeout(() => setToast(""), 1800);
  };
  const pushLog = (entry) =>
    setLog((l) => [{ id: uid(), at: Date.now(), sent: false, ...entry }, ...l]);

  /* ----- friend actions ----- */
  const addFriend = (f) => setFriends((arr) => [...arr, { id: uid(), isOwner: false, ...f }]);
  const updateFriend = (id, patch) =>
    setFriends((arr) => arr.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFriend = (id) => {
    if (id === "owner") return;
    if (games.some((g) => g.hostId === id)) {
      showToast("That friend is hosting a game — reassign first");
      return;
    }
    setFriends((arr) => arr.filter((f) => f.id !== id));
    setGames((gs) => gs.map((g) => ({ ...g, invites: g.invites.filter((i) => i.friendId !== id) })));
  };
  const loadSample = () => {
    setFriends([OWNER, ...SAMPLE]);
    showToast("Sample crew added");
  };

  /* ----- schedule a game ----- */
  const scheduleGame = ({ date, time, hostId, location, invitedIds }) => {
    const g = {
      id: uid(),
      date,
      time,
      hostId,
      location: location || settings.defaultLocation,
      createdAt: Date.now(),
      invites: invitedIds.map((fid) => ({ friendId: fid, status: "pending", invitedAt: Date.now(), flagged: false })),
    };
    setGames((gs) => [...gs, g]);
    const host = byId[hostId];
    invitedIds.forEach((fid) => {
      const f = byId[fid];
      if (f) {
        pushLog({ kind: "invite", to: f.name, phone: f.phone, channel: "friend", gameId: g.id, text: draftInvite(g, f, host) });
        notifyFriend(fid, "🏓 You're invited to pickleball", `${hostLabel(host)} — ${fmtFull(g.date)} at ${g.time}. Open the app to say yes.`);
      }
    });
    showToast(`Game scheduled · ${invitedIds.length} invite${invitedIds.length === 1 ? "" : "s"} sent`);
  };

  /* ----- respond (reply to agent OR sign up in app) ----- */
  const respond = (gameId, friendId, answer, viaApp = false) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const f = byId[friendId];
    if (!f) return;
    const full = isFull(game, byId);

    if (answer === "yes" && full) {
      setGames((gs) =>
        gs.map((g) =>
          g.id !== gameId ? g : { ...g, invites: setInvite(g.invites, friendId, { status: "full" }) }
        )
      );
      pushLog({ kind: "full", to: f.name, phone: f.phone, channel: "friend", gameId, text: draftFull(game, f) });
      return;
    }

    setGames((gs) =>
      gs.map((g) =>
        g.id !== gameId ? g : { ...g, invites: setInvite(g.invites, friendId, { status: answer, flagged: false }) }
      )
    );

    if (answer === "yes") {
      // recompute roster after this yes
      const after = { ...game, invites: setInvite(game.invites, friendId, { status: "yes" }) };
      const players = confirmedPlayers(after, byId);
      pushLog({
        kind: "info",
        channel: "system",
        gameId,
        text: `${f.name} is in for ${fmtShort(game.date)} at ${game.time}${viaApp ? " (signed up in the app)" : ""}. ${CAP - players.length} spot${CAP - players.length === 1 ? "" : "s"} left.`,
      });
      if (players.length >= CAP) {
        pushLog({ kind: "confirmed", to: "Kristin", channel: "owner", gameId, text: draftConfirmed(game, players.map((p) => p.name)) });
      }
    } else if (answer === "no") {
      pushLog({ kind: "declined", to: "Kristin", channel: "owner", gameId, text: draftDeclined(game, f) });
    }
  };
  const setInvite = (invites, friendId, patch) => {
    const has = invites.some((i) => i.friendId === friendId);
    return has
      ? invites.map((i) => (i.friendId === friendId ? { ...i, ...patch } : i))
      : [...invites, { friendId, invitedAt: Date.now(), status: "pending", flagged: false, ...patch }];
  };

  /* ----- invite more friends to an existing game ----- */
  const inviteMore = (gameId, ids) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const host = byId[game.hostId];
    setGames((gs) =>
      gs.map((g) =>
        g.id !== gameId
          ? g
          : { ...g, invites: [...g.invites, ...ids.filter((id) => !g.invites.some((i) => i.friendId === id)).map((id) => ({ friendId: id, status: "pending", invitedAt: Date.now(), flagged: false }))] }
      )
    );
    ids.forEach((id) => {
      const f = byId[id];
      if (f) {
        pushLog({ kind: "invite", to: f.name, phone: f.phone, channel: "friend", gameId, text: draftInvite(game, f, host) });
        notifyFriend(id, "🏓 You're invited to pickleball", `${hostLabel(host)} — ${fmtFull(game.date)} at ${game.time}. Open the app to say yes.`);
      }
    });
    showToast(`${ids.length} more invite${ids.length === 1 ? "" : "s"} sent`);
  };

  const deleteGame = (id) => {
    setGames((gs) => gs.filter((g) => g.id !== id));
    setSelectedGame(null);
  };

  /* ----- the agent monitoring pass ----- */
  const runAgentCheck = () => {
    // Compute new games + new log entries purely, then commit both once.
    // (No setState calls inside the setGames updater — that would double-fire
    // under React StrictMode and risk duplicate "needs a backup" messages.)
    const newEntries = [];
    const mkEntry = (entry) => ({ id: uid(), at: Date.now(), sent: false, ...entry });
    let flaggedCount = 0;
    const newGames = games.map((g) => {
      if (g.date < todayISO()) return g;
      const invites = g.invites.map((inv) => {
        if (inv.status === "pending" && !inv.flagged && (demoOverdue || hoursSince(inv.invitedAt) >= 48)) {
          const f = byId[inv.friendId];
          if (f) {
            newEntries.push(mkEntry({ kind: "overdue", to: "Kristin", channel: "owner", gameId: g.id, text: draftOverdue(g, f) }));
            flaggedCount++;
          }
          return { ...inv, flagged: true };
        }
        return inv;
      });
      return { ...g, invites };
    });
    // Monday reminder (once per week)
    if (isMondayToday() && !log.some((e) => e.kind === "monday" && e.week === weekKey())) {
      newEntries.push(mkEntry({ kind: "monday", to: "Kristin", channel: "owner", week: weekKey(), text: draftMonday(games, byId) }));
    }
    setGames(newGames);
    // newEntries is in chronological push order; reverse so newest sits in front
    // to match pushLog's one-at-a-time prepend semantics.
    if (newEntries.length) setLog((l) => [...newEntries.slice().reverse(), ...l]);
    setTimeout(() => showToast(flaggedCount ? `Agent flagged ${flaggedCount} for a backup` : "Agent checked — nothing needs you"), 50);
  };
  const previewMonday = () => {
    pushLog({ kind: "monday", to: "Kristin", channel: "owner", week: weekKey(), text: draftMonday(games, byId) });
    setTab("agent");
    showToast("Monday text drafted");
  };

  const detailGame = selectedGame ? games.find((g) => g.id === selectedGame) : null;

  // First open on a device: ask who's using it, so we can show them their invites.
  if (loaded && !me) {
    return (
      <div className="kpa-root">
        <Style />
        <WhoSheet
          friends={friends}
          onPick={chooseMe}
          onAddMe={() => setSheet("addme")}
        />
        {sheet === "addme" && (
          <FriendSheet
            onClose={() => setSheet(null)}
            onSubmit={(f) => {
              const id = uid();
              setFriends((arr) => [...arr, { id, isOwner: false, ...f }]);
              chooseMe(id);
              setSheet(null);
            }}
          />
        )}
        {toast && <div className="kpa-toast">{toast}</div>}
      </div>
    );
  }

  const myInvites = me
    ? [...games]
        .filter((g) => g.date >= todayISO() && g.invites.some((i) => i.friendId === me && i.status === "pending"))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    : [];
  const respondAndToast = (gid, fid, ans, via) => {
    respond(gid, fid, ans, via);
    showToast(ans === "yes" ? "You're in! 🎉" : "Okay — thanks for letting them know");
  };

  return (
    <div className="kpa-root">
      <Style />
      <div className="kpa-app">
        <Header
          onSettings={() => setSheet("settings")}
          showBack={!!detailGame}
          onBack={() => setSelectedGame(null)}
          title={detailGame ? "Game details" : null}
        />

        <main className="kpa-main">
          {detailGame ? (
            <GameDetail
              game={detailGame}
              byId={byId}
              owner={owner}
              me={me}
              onRespond={respondAndToast}
              onInviteMore={() => setSheet({ invite: detailGame.id })}
              onSignup={() => setSheet({ signup: detailGame.id })}
              onDelete={() => deleteGame(detailGame.id)}
            />
          ) : tab === "games" ? (
            <GamesTab
              games={games}
              byId={byId}
              me={me}
              viewer={viewer}
              myInvites={myInvites}
              pushPerm={pushPerm}
              onEnableNotifications={enableNotifications}
              onRespond={respondAndToast}
              onOpen={(id) => setSelectedGame(id)}
              onSchedule={() => setSheet("schedule")}
            />
          ) : tab === "crew" ? (
            <CrewTab
              friends={friends}
              games={games}
              onAdd={() => setSheet("friend")}
              onUpdate={updateFriend}
              onRemove={removeFriend}
              onSample={loadSample}
            />
          ) : (
            <AgentTab
              log={log}
              byId={byId}
              demoOverdue={demoOverdue}
              setDemoOverdue={setDemoOverdue}
              onRun={runAgentCheck}
              onMonday={previewMonday}
              onSent={(id) => setLog((l) => l.map((e) => (e.id === id ? { ...e, sent: !e.sent } : e)))}
              onCopy={(text) => copyText(text, showToast)}
              onOpenGame={(id) => { setSelectedGame(id); setTab("games"); }}
            />
          )}
        </main>

        {!detailGame && (
          <nav className="kpa-tabs">
            <TabBtn active={tab === "games"} onClick={() => setTab("games")} icon={<Home size={20} />} label="Games" />
            <TabBtn active={tab === "crew"} onClick={() => setTab("crew")} icon={<Users size={20} />} label="Crew" />
            <TabBtn
              active={tab === "agent"}
              onClick={() => setTab("agent")}
              icon={<Bot size={20} />}
              label="Agent"
              badge={log.filter((e) => e.channel === "owner" && !e.sent).length}
            />
          </nav>
        )}
      </div>

      {/* sheets */}
      {sheet === "schedule" && (
        <ScheduleSheet
          friends={friends}
          owner={owner}
          times={TIMES}
          defaultLocation={settings.defaultLocation}
          onClose={() => setSheet(null)}
          onSubmit={(data) => { scheduleGame(data); setSheet(null); setTab("games"); }}
        />
      )}
      {sheet === "friend" && (
        <FriendSheet onClose={() => setSheet(null)} onSubmit={(f) => { addFriend(f); setSheet(null); }} />
      )}
      {sheet === "settings" && (
        <SettingsSheet
          settings={settings}
          viewer={viewer || owner}
          isOwner={!viewer || viewer.isOwner}
          pushPerm={pushPerm}
          onEnableNotifications={enableNotifications}
          onClose={() => setSheet(null)}
          onSave={(s, patch) => { setSettings(s); updateFriend(viewer ? viewer.id : "owner", patch); setSheet(null); }}
          onSwitchUser={() => { setSheet(null); chooseMe(null); }}
          onReset={() => { setFriends([OWNER]); setGames([]); setLog([]); setSettings({ defaultLocation: "Sharon", ownerPhone: "" }); setSheet(null); showToast("Everything cleared"); }}
        />
      )}
      {sheet && sheet.invite && (
        <PickerSheet
          title="Invite more friends"
          subtitle="Regulars are listed first — the agent texts whoever you pick."
          friends={eligible(friends, games.find((g) => g.id === sheet.invite))}
          onClose={() => setSheet(null)}
          onSubmit={(ids) => { inviteMore(sheet.invite, ids); setSheet(null); }}
          cta="Text these friends"
        />
      )}
      {sheet && sheet.signup && (
        <PickerSheet
          title="Add a player"
          subtitle="Pick a friend who said yes (or signed up in the app)."
          friends={eligible(friends, games.find((g) => g.id === sheet.signup))}
          single
          onClose={() => setSheet(null)}
          onSubmit={(ids) => { ids.forEach((id) => respond(sheet.signup, id, "yes", true)); setSheet(null); }}
          cta="Add to the court"
        />
      )}

      {toast && <div className="kpa-toast">{toast}</div>}
    </div>
  );
}

/* friends who can still be added: not you, not the host, not already invited */
function eligible(friends, game) {
  if (!game) return friends.filter((f) => !f.isOwner);
  const invited = new Set(game.invites.map((i) => i.friendId));
  return friends.filter((f) => !f.isOwner && f.id !== game.hostId && !invited.has(f.id));
}

async function copyText(text, showToast) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied");
    return;
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Copied");
  } catch (e) {
    showToast("Select the text to copy");
  }
}

/* ============================== components ============================== */

function Header({ onSettings, showBack, onBack, title }) {
  return (
    <header className="kpa-header">
      {showBack ? (
        <button className="hbtn" onClick={onBack} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
      ) : (
        <div className="brand">
          <BallMark />
          <div className="brand-txt">
            <span className="brand-name">Kristin's</span>
            <span className="brand-sub">Pickleball Agent</span>
          </div>
        </div>
      )}
      {title && <h1 className="header-title">{title}</h1>}
      <button className="hbtn" onClick={onSettings} aria-label="Settings">
        <Settings size={20} />
      </button>
    </header>
  );
}

function BallMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="15" fill="var(--ball)" stroke="var(--ink)" strokeWidth="2" />
      {[[12, 11], [22, 11], [12, 22], [22, 22], [17, 16]].map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.7" fill="var(--ink)" opacity="0.85" />
      ))}
    </svg>
  );
}

function TabBtn({ active, onClick, icon, label, badge }) {
  return (
    <button className={`tab ${active ? "tab-on" : ""}`} onClick={onClick}>
      <span className="tab-ic">
        {icon}
        {badge > 0 && <span className="tab-badge">{badge}</span>}
      </span>
      <span className="tab-lbl">{label}</span>
    </button>
  );
}

/* ---- the signature: a doubles court that fills with players ---- */
function Court({ players }) {
  const cells = [
    { cx: 60, cy: 34 },
    { cx: 160, cy: 34 },
    { cx: 60, cy: 82 },
    { cx: 160, cy: 82 },
  ];
  return (
    <svg viewBox="0 0 220 116" className="court" role="img" aria-label={`${players.length} of 4 players confirmed`}>
      <rect x="4" y="4" width="212" height="108" rx="10" className="court-bg" />
      <rect x="10" y="10" width="200" height="96" rx="4" className="court-line" />
      <line x1="110" y1="6" x2="110" y2="110" className="court-net" />
      <line x1="74" y1="10" x2="74" y2="106" className="court-kitchen" />
      <line x1="146" y1="10" x2="146" y2="106" className="court-kitchen" />
      {cells.map((c, i) => {
        const p = players[i];
        if (p) {
          return (
            <g key={i}>
              <rect x={c.cx - 35} y={c.cy - 17} width="70" height="34" rx="9" className="slot-filled" />
              <text x={c.cx} y={c.cy + 6} textAnchor="middle" className="slot-initial" fontSize="20">
                {initialOf(p.name)}
              </text>
              {p.isHost && (
                <text x={c.cx + 26} y={c.cy - 8} textAnchor="middle" className="slot-star" fontSize="11">
                  ★
                </text>
              )}
            </g>
          );
        }
        return (
          <g key={i}>
            <rect x={c.cx - 35} y={c.cy - 17} width="70" height="34" rx="9" className="slot-empty" />
            <text x={c.cx} y={c.cy + 5} textAnchor="middle" className="slot-plus" fontSize="16">
              +
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------ Games tab ------------------------------ */
function GamesTab({ games, byId, me, viewer, myInvites, pushPerm, onEnableNotifications, onRespond, onOpen, onSchedule }) {
  const upcoming = [...games]
    .filter((g) => g.date >= todayISO())
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const past = [...games].filter((g) => g.date < todayISO()).sort((a, b) => (b.date).localeCompare(a.date));
  const next = upcoming[0];

  return (
    <div className="pad">
      {viewer && (
        <p className="viewer-line">Hi {viewer.name.split(" ")[0]} 👋</p>
      )}

      {viewer && pushPerm !== "granted" && pushPerm !== "unsupported" && (
        <button className="notif-banner" onClick={onEnableNotifications}>
          <Bell size={18} />
          <span>
            <strong>Turn on notifications</strong>
            <em>Get a ping the moment you're invited to a game.</em>
          </span>
        </button>
      )}

      {myInvites && myInvites.length > 0 && (
        <section className="invites">
          {myInvites.map((g) => {
            const host = byId[g.hostId];
            const players = confirmedPlayers(g, byId);
            const left = CAP - players.length;
            return (
              <div className="invite-card" key={g.id}>
                <span className="invite-eyebrow">🏓 You're invited{host ? ` by ${hostLabel(host)}` : ""}</span>
                <h2 className="invite-when">{fmtFull(g.date)}</h2>
                <p className="invite-meta">
                  <Clock size={14} /> {g.time}
                  <span className="dot" />
                  <MapPin size={14} /> {g.location}
                </p>
                <p className="invite-sub">{left > 0 ? `${left} spot${left === 1 ? "" : "s"} still open` : "Court's full — you'd be on the waitlist"}</p>
                <div className="invite-actions">
                  <button className="btn btn-primary btn-lg" onClick={() => onRespond(g.id, me, "yes", true)}>
                    <Check size={16} /> Yes, I'm in
                  </button>
                  <button className="btn btn-ghost btn-lg" onClick={() => onRespond(g.id, me, "no", true)}>
                    Can't this time
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {next ? (
        <section className="hero">
          <div className="hero-top">
            <span className="eyebrow">Next on the court</span>
            <button className="link" onClick={() => onOpen(next.id)}>Open</button>
          </div>
          <Court players={confirmedPlayers(next, byId)} />
          <h2 className="hero-when">{fmtFull(next.date)}</h2>
          <p className="hero-meta">
            <Clock size={14} /> {next.time}
            <span className="dot" />
            <MapPin size={14} /> {next.location}
          </p>
          <StatusPill {...statusLine(next, byId)} big />
        </section>
      ) : (
        <EmptyState
          icon={<CalendarPlus size={30} />}
          title="No games on the calendar yet"
          body="Pick a day and time, choose who's playing, and the agent will line up your crew."
        />
      )}

      <button className="btn btn-primary btn-block btn-lg" onClick={onSchedule}>
        <Plus size={18} /> Schedule a game
      </button>

      {upcoming.length > 1 && (
        <>
          <h3 className="sec-h">Also coming up</h3>
          {upcoming.slice(1).map((g) => (
            <GameRow key={g.id} game={g} byId={byId} onOpen={onOpen} />
          ))}
        </>
      )}

      {past.length > 0 && (
        <>
          <h3 className="sec-h muted">Past games</h3>
          {past.map((g) => (
            <GameRow key={g.id} game={g} byId={byId} onOpen={onOpen} past />
          ))}
        </>
      )}
    </div>
  );
}

function GameRow({ game, byId, onOpen, past }) {
  const players = confirmedPlayers(game, byId);
  const s = statusLine(game, byId);
  return (
    <button className={`grow ${past ? "grow-past" : ""}`} onClick={() => onOpen(game.id)}>
      <div className="grow-court">
        <Court players={players} />
      </div>
      <div className="grow-body">
        <strong className="grow-when">{fmtShort(game.date)}</strong>
        <span className="grow-meta">{game.time} · {game.location}</span>
        {!past && <StatusPill {...s} />}
        {past && <span className="pill pill-muted">{players.length} of 4 played</span>}
      </div>
    </button>
  );
}

function StatusPill({ text, tone, big }) {
  const map = { full: "pill-full", wait: "pill-wait", need: "pill-need" };
  return <span className={`pill ${map[tone] || ""} ${big ? "pill-big" : ""}`}>{text}</span>;
}

/* ------------------------------ Game detail ------------------------------ */
function GameDetail({ game, byId, owner, me, onRespond, onInviteMore, onSignup, onDelete }) {
  const players = confirmedPlayers(game, byId);
  const host = byId[game.hostId];
  const left = CAP - players.length;
  const full = left <= 0;
  const pending = game.invites.filter((i) => i.status === "pending");
  const declined = game.invites.filter((i) => i.status === "no");
  const tooLate = game.invites.filter((i) => i.status === "full");
  const [confirmDel, setConfirmDel] = useState(false);
  const myInvite = me ? game.invites.find((i) => i.friendId === me && i.status === "pending") : null;

  return (
    <div className="pad">
      {myInvite && (
        <section className="invite-card" style={{ marginBottom: 14 }}>
          <span className="invite-eyebrow">🏓 You're invited{host ? ` by ${hostLabel(host)}` : ""}</span>
          <p className="invite-sub" style={{ marginTop: 2 }}>{left > 0 ? `${left} spot${left === 1 ? "" : "s"} open` : "Court's full — you'd be on the waitlist"}</p>
          <div className="invite-actions">
            <button className="btn btn-primary btn-lg" onClick={() => onRespond(game.id, me, "yes", true)}>
              <Check size={16} /> Yes, I'm in
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => onRespond(game.id, me, "no", true)}>
              Can't this time
            </button>
          </div>
        </section>
      )}
      <section className="detail-hero">
        <Court players={players} />
        <h2 className="hero-when">{fmtFull(game.date)}</h2>
        <p className="hero-meta">
          <Clock size={14} /> {game.time}
          <span className="dot" />
          <MapPin size={14} /> {game.location}
        </p>
        <p className="hero-host">
          <Star size={13} /> Host: {hostLabel(host)} {host?.isOwner ? "(you)" : ""}
        </p>
        <StatusPill {...statusLine(game, byId)} big />
      </section>

      <h3 className="sec-h">On the court ({players.length}/4)</h3>
      <div className="players">
        {players.map((p) => (
          <div key={p.id} className="player-chip">
            <span className="avatar">{initialOf(p.name)}</span>
            {p.name}
            {p.isHost && <span className="host-tag"><Star size={11} /> host</span>}
          </div>
        ))}
        {Array.from({ length: left }).map((_, i) => (
          <div key={i} className="player-chip player-open">
            <span className="avatar avatar-open">+</span>
            Open spot
          </div>
        ))}
      </div>

      {!full && (
        <div className="detail-actions">
          <button className="btn btn-primary btn-block" onClick={onInviteMore}>
            <UserPlus size={16} /> Invite more friends
          </button>
          <button className="btn btn-ghost btn-block" onClick={onSignup}>
            <Check size={16} /> Add someone who said yes
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h3 className="sec-h">Waiting on a reply</h3>
          {pending.map((inv) => {
            const f = byId[inv.friendId];
            if (!f) return null;
            const overdue = inv.flagged || hoursSince(inv.invitedAt) >= 48;
            return (
              <div key={inv.friendId} className="invite-row">
                <div className="ir-left">
                  <span className="avatar avatar-wait">{initialOf(f.name)}</span>
                  <div>
                    <strong>{f.name}</strong>
                    <span className="ir-sub">
                      {overdue ? <span className="overdue"><AlertCircle size={12} /> No reply in 48h</span> : "Invite sent"}
                    </span>
                  </div>
                </div>
                <div className="ir-actions">
                  <button className="mini mini-yes" onClick={() => onRespond(game.id, f.id, "yes")} disabled={full} title={full ? "Court is full" : "Mark as yes"}>
                    <Check size={15} /> Yes
                  </button>
                  <button className="mini mini-no" onClick={() => onRespond(game.id, f.id, "no")}>
                    <X size={15} /> No
                  </button>
                </div>
              </div>
            );
          })}
          <p className="hint"><Info size={12} /> Tap Yes/No as replies come in, or let friends confirm in the app.</p>
        </>
      )}

      {declined.length > 0 && (
        <>
          <h3 className="sec-h muted">Can't make it</h3>
          {declined.map((inv) => {
            const f = byId[inv.friendId];
            return f ? (
              <div key={inv.friendId} className="mini-row">
                <span className="avatar avatar-no">{initialOf(f.name)}</span>
                {f.name} <span className="ir-sub">declined</span>
              </div>
            ) : null;
          })}
        </>
      )}

      {tooLate.length > 0 && (
        <>
          <h3 className="sec-h muted">Replied after it filled</h3>
          {tooLate.map((inv) => {
            const f = byId[inv.friendId];
            return f ? (
              <div key={inv.friendId} className="mini-row">
                <span className="avatar avatar-late">{initialOf(f.name)}</span>
                {f.name} <span className="ir-sub">got the "we're full" note</span>
              </div>
            ) : null;
          })}
        </>
      )}

      <div className="danger-zone">
        {confirmDel ? (
          <div className="confirm-row">
            <span>Delete this game?</span>
            <button className="btn btn-coral btn-sm" onClick={onDelete}>Delete</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(false)}>Keep</button>
          </div>
        ) : (
          <button className="text-danger" onClick={() => setConfirmDel(true)}>
            <Trash2 size={14} /> Delete game
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Crew tab ------------------------------ */
function CrewTab({ friends, games, onAdd, onUpdate, onRemove, onSample }) {
  const owner = friends.find((f) => f.isOwner);
  const regulars = friends.filter((f) => !f.isOwner && f.regular);
  const others = friends.filter((f) => !f.isOwner && !f.regular);

  return (
    <div className="pad">
      <h3 className="sec-h">You</h3>
      <div className="friend-row friend-owner">
        <span className="avatar avatar-owner">{initialOf(owner.name)}</span>
        <div className="fr-body">
          <strong>{owner.name}</strong>
          <span className="ir-sub">Host · always playing</span>
        </div>
      </div>

      <div className="crew-head">
        <h3 className="sec-h">Your crew</h3>
        <button className="btn btn-primary btn-sm" onClick={onAdd}><Plus size={15} /> Add</button>
      </div>

      {friends.length === 1 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="Add your pickleball friends"
          body="Save names and cell numbers. Mark your regulars so the agent always asks them first."
          action={<button className="btn btn-ghost btn-sm" onClick={onSample}>Add a sample crew to try it</button>}
        />
      ) : (
        <>
          {regulars.length > 0 && <p className="group-lbl">Regulars · asked first</p>}
          {regulars.map((f) => <FriendCard key={f.id} f={f} games={games} onUpdate={onUpdate} onRemove={onRemove} />)}
          {others.length > 0 && <p className="group-lbl">Other friends · backups</p>}
          {others.map((f) => <FriendCard key={f.id} f={f} games={games} onUpdate={onUpdate} onRemove={onRemove} />)}
        </>
      )}
      <p className="hint" style={{ marginTop: 14 }}>
        <Info size={12} /> "Can host" lets a friend run a game (they're player #1). You can pick them as host when scheduling.
      </p>
    </div>
  );
}

function FriendCard({ f, games, onUpdate, onRemove }) {
  const [open, setOpen] = useState(false);
  const hosting = games.some((g) => g.hostId === f.id);
  return (
    <div className="friend-row">
      <span className="avatar">{initialOf(f.name)}</span>
      <div className="fr-body">
        <strong>{f.name}</strong>
        <span className="ir-sub"><Phone size={11} /> {f.phone || "no number"}</span>
        <div className="toggles">
          <Toggle on={f.regular} onClick={() => onUpdate(f.id, { regular: !f.regular })} label="Regular" />
          <Toggle on={f.canHost} onClick={() => onUpdate(f.id, { canHost: !f.canHost })} label="Can host" />
        </div>
      </div>
      <div className="fr-side">
        {open ? (
          <button className="mini mini-no" disabled={hosting} title={hosting ? "Hosting a game" : "Remove"} onClick={() => onRemove(f.id)}>
            <Trash2 size={14} />
          </button>
        ) : (
          <button className="icon-ghost" onClick={() => setOpen(true)} aria-label="Edit"><Settings size={16} /></button>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label }) {
  return (
    <button className={`toggle ${on ? "toggle-on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span className="toggle-knob" />
      {label}
    </button>
  );
}

/* ------------------------------ Agent tab ------------------------------ */
function AgentTab({ log, byId, demoOverdue, setDemoOverdue, onRun, onMonday, onSent, onCopy, onOpenGame }) {
  return (
    <div className="pad">
      <div className="agent-banner">
        <div className="ab-icon"><Bot size={22} /></div>
        <div>
          <strong>The agent's desk</strong>
          <p>It drafts every text and tracks every reply. Send a draft from your phone, or mark replies as they come in.</p>
        </div>
      </div>

      <div className="agent-controls">
        <button className="btn btn-primary btn-block" onClick={onRun}>
          <RefreshCw size={16} /> Run agent check now
        </button>
        <button className="btn btn-ghost btn-block" onClick={onMonday}>
          <CalendarDays size={16} /> Preview the Monday text
        </button>
        <label className="demo-toggle">
          <input type="checkbox" checked={demoOverdue} onChange={(e) => setDemoOverdue(e.target.checked)} />
          <span>Pretend 48 hours have passed (for testing the nudge)</span>
        </label>
      </div>

      <h3 className="sec-h">Activity</h3>
      {log.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={26} />}
          title="The agent is quiet for now"
          body="Schedule a game and invite friends — the texts the agent sends and the replies it tracks will show up here."
        />
      ) : (
        <div className="feed">
          {log.map((e) => (
            <FeedItem key={e.id} e={e} onSent={onSent} onCopy={onCopy} onOpenGame={onOpenGame} />
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_META = {
  invite: { ic: <Send size={15} />, cls: "fi-friend", label: "Invite" },
  full: { ic: <PartyPopper size={15} />, cls: "fi-friend", label: "Court full reply" },
  declined: { ic: <AlertCircle size={15} />, cls: "fi-owner", label: "Needs you" },
  overdue: { ic: <Clock size={15} />, cls: "fi-owner", label: "Needs you" },
  confirmed: { ic: <PartyPopper size={15} />, cls: "fi-good", label: "All set" },
  monday: { ic: <CalendarDays size={15} />, cls: "fi-owner", label: "Monday check-in" },
  info: { ic: <Check size={15} />, cls: "fi-info", label: "Update" },
};

function FeedItem({ e, onSent, onCopy, onOpenGame }) {
  const m = KIND_META[e.kind] || KIND_META.info;
  const sendable = e.channel === "friend";
  const smsHref = e.phone ? `sms:${e.phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(e.text)}` : null;
  return (
    <div className={`fi ${m.cls}`}>
      <div className="fi-head">
        <span className="fi-ic">{m.ic}</span>
        <span className="fi-to">
          {e.channel === "friend" ? `To ${e.to}` : e.channel === "owner" ? "To you" : m.label}
        </span>
        <span className="fi-tag">{m.label}</span>
        <span className="fi-time">{new Date(e.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <p className="fi-text">{e.text}</p>
      <div className="fi-actions">
        {sendable && smsHref && (
          <a className="mini mini-send" href={smsHref}>
            <Send size={13} /> Text now
          </a>
        )}
        {sendable && (
          <button className={`mini ${e.sent ? "mini-sent" : "mini-ghost"}`} onClick={() => onSent(e.id)}>
            <Check size={13} /> {e.sent ? "Sent" : "Mark sent"}
          </button>
        )}
        {e.channel === "owner" && (
          <button className={`mini ${e.sent ? "mini-sent" : "mini-ghost"}`} onClick={() => onSent(e.id)}>
            <Check size={13} /> {e.sent ? "Done" : "Got it"}
          </button>
        )}
        <button className="mini mini-ghost" onClick={() => onCopy(e.text)}>
          <Copy size={13} /> Copy
        </button>
        {e.gameId && (
          <button className="mini mini-ghost" onClick={() => onOpenGame(e.gameId)}>
            Open game
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Empty state ------------------------------ */
function EmptyState({ icon, title, body, action }) {
  return (
    <div className="empty">
      <div className="empty-ic">{icon}</div>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

/* ============================== Sheets ============================== */
function Sheet({ title, subtitle, onClose, children, footer }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="sheet-sub">{subtitle}</p>}
          </div>
          <button className="hbtn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

function ScheduleSheet({ friends, owner, times, defaultLocation, onClose, onSubmit }) {
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("9:00 AM");
  const [hostId, setHostId] = useState(owner.id);
  const [location, setLocation] = useState(defaultLocation);
  const [picked, setPicked] = useState([]);

  const hosts = friends.filter((f) => f.isOwner || f.canHost);
  const host = friends.find((f) => f.id === hostId);
  const invitable = friends.filter((f) => !f.isOwner && f.id !== hostId);
  const regulars = invitable.filter((f) => f.regular);
  const others = invitable.filter((f) => !f.regular);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const previewFriend = friends.find((f) => f.id === picked[0]);

  return (
    <Sheet
      title="Schedule a game"
      subtitle="Pick a day and time, set the host, and choose who to ask."
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary btn-block btn-lg"
          disabled={picked.length === 0}
          onClick={() => onSubmit({ date, time, hostId, location, invitedIds: picked })}
        >
          <Send size={16} /> Schedule & draft {picked.length || ""} invite{picked.length === 1 ? "" : "s"}
        </button>
      }
    >
      <label className="field">
        <span>Day</span>
        <input type="date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </label>

      <label className="field">
        <span>Time</span>
        <select value={time} onChange={(e) => setTime(e.target.value)}>
          {times.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Host · plays as player #1</span>
        <select value={hostId} onChange={(e) => setHostId(e.target.value)}>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>{h.isOwner ? `${h.name} (you)` : h.name}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Location</span>
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sharon" />
      </label>

      <div className="field">
        <span>Who should the agent ask? <em className="count">{picked.length} picked · need 3</em></span>
        {invitable.length === 0 ? (
          <p className="hint">Add friends in the Crew tab first.</p>
        ) : (
          <>
            {regulars.length > 0 && <p className="group-lbl">Regulars · asked first</p>}
            <div className="pick-grid">
              {regulars.map((f) => (
                <PickChip key={f.id} f={f} on={picked.includes(f.id)} onClick={() => toggle(f.id)} />
              ))}
            </div>
            {others.length > 0 && <p className="group-lbl">Other friends</p>}
            <div className="pick-grid">
              {others.map((f) => (
                <PickChip key={f.id} f={f} on={picked.includes(f.id)} onClick={() => toggle(f.id)} />
              ))}
            </div>
          </>
        )}
      </div>

      {previewFriend && (
        <div className="preview">
          <span className="preview-lbl"><MessageSquare size={12} /> The agent will text {previewFriend.name}:</span>
          <p>{draftInvite({ date, time, location }, previewFriend, host)}</p>
        </div>
      )}
    </Sheet>
  );
}

function PickChip({ f, on, onClick }) {
  return (
    <button className={`pick ${on ? "pick-on" : ""}`} onClick={onClick}>
      <span className="avatar avatar-sm">{initialOf(f.name)}</span>
      {f.name}
      {on && <Check size={14} />}
    </button>
  );
}

function FriendSheet({ onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [regular, setRegular] = useState(true);
  const [canHost, setCanHost] = useState(false);
  return (
    <Sheet
      title="Add a friend"
      subtitle="Save their name and cell so the agent can text them."
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block btn-lg" disabled={!name.trim()} onClick={() => onSubmit({ name: name.trim(), phone: phone.trim(), regular, canHost })}>
          <Plus size={16} /> Add to crew
        </button>
      }
    >
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Linda" autoFocus />
      </label>
      <label className="field">
        <span>Cell number</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0142" inputMode="tel" />
      </label>
      <div className="field">
        <span>Settings</span>
        <div className="toggles">
          <Toggle on={regular} onClick={() => setRegular(!regular)} label="Regular (asked first)" />
          <Toggle on={canHost} onClick={() => setCanHost(!canHost)} label="Can host games" />
        </div>
      </div>
    </Sheet>
  );
}

function SettingsSheet({ settings, viewer, isOwner, pushPerm, onEnableNotifications, onClose, onSave, onSwitchUser, onReset }) {
  const [loc, setLoc] = useState(settings.defaultLocation);
  const [phone, setPhone] = useState(viewer.phone || "");
  const [name, setName] = useState(viewer.name);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <Sheet
      title="Settings"
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block btn-lg" onClick={() => onSave({ ...settings, defaultLocation: loc }, { name: name.trim() || viewer.name, phone: phone.trim() })}>
          <Check size={16} /> Save
        </button>
      }
    >
      <div className="field">
        <span>You're using this as</span>
        <div className="confirm-row" style={{ justifyContent: "space-between" }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="avatar avatar-sm">{initialOf(viewer.name)}</span> {viewer.name}
          </strong>
          <button className="btn btn-ghost btn-sm" onClick={onSwitchUser}>Not you? Switch</button>
        </div>
      </div>
      <div className="field">
        <span>Notifications</span>
        {pushPerm === "granted" ? (
          <div className="confirm-row"><Check size={14} /> On — you'll get a ping for new invites.</div>
        ) : pushPerm === "unsupported" ? (
          <div className="confirm-row">Not supported on this phone/browser.</div>
        ) : pushPerm === "denied" ? (
          <div className="confirm-row">Blocked. Turn them on for this site in your phone/browser settings.</div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={onEnableNotifications}><Bell size={14} /> Turn on notifications</button>
        )}
      </div>
      <label className="field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Your cell {isOwner ? "(for the agent's check-ins)" : "(so the host can reach you)"}</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-0100" inputMode="tel" />
      </label>
      <label className="field">
        <span>Default location</span>
        <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Sharon" />
      </label>
      <p className="hint" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>This is one shared list for the group — everyone with the app link sees the same games, crew, and phone numbers.</span>
      </p>
      {isOwner && (
        <div className="field">
          <span>Start over</span>
          {confirmReset ? (
            <div className="confirm-row">
              <span>Erase everything for the whole group?</span>
              <button className="btn btn-coral btn-sm" onClick={onReset}>Erase</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          ) : (
            <button className="text-danger" onClick={() => setConfirmReset(true)}><Trash2 size={14} /> Clear everything</button>
          )}
        </div>
      )}
    </Sheet>
  );
}

function WhoSheet({ friends, onPick, onAddMe }) {
  const owner = friends.find((f) => f.isOwner);
  const rest = friends.filter((f) => !f.isOwner);
  return (
    <div className="who-wrap">
      <div className="who-card">
        <div className="who-brand">
          <BallMark />
          <div className="brand-txt">
            <span className="brand-name">Kristin's</span>
            <span className="brand-sub">Pickleball Agent</span>
          </div>
        </div>
        <h2 className="who-title">Who's using this phone?</h2>
        <p className="who-sub">Tap your name so the app can show you your own game invites.</p>
        <div className="who-list">
          {owner && (
            <button className="who-row" onClick={() => onPick(owner.id)}>
              <span className="avatar avatar-owner">{initialOf(owner.name)}</span>
              <span className="who-name">{owner.name}</span>
            </button>
          )}
          {rest.map((f) => (
            <button className="who-row" key={f.id} onClick={() => onPick(f.id)}>
              <span className="avatar">{initialOf(f.name)}</span>
              <span className="who-name">{f.name}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-block" onClick={onAddMe}>
          <Plus size={16} /> I'm not on the list
        </button>
      </div>
    </div>
  );
}

function PickerSheet({ title, subtitle, friends, onClose, onSubmit, cta, single }) {
  const [picked, setPicked] = useState([]);
  const regulars = friends.filter((f) => f.regular);
  const others = friends.filter((f) => !f.regular);
  const toggle = (id) =>
    setPicked((p) => (single ? [id] : p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Sheet
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block btn-lg" disabled={picked.length === 0} onClick={() => onSubmit(picked)}>
          {cta}
        </button>
      }
    >
      {friends.length === 0 ? (
        <p className="hint">No eligible friends. Add some in the Crew tab.</p>
      ) : (
        <>
          {regulars.length > 0 && <p className="group-lbl">Regulars · asked first</p>}
          <div className="pick-grid">
            {regulars.map((f) => <PickChip key={f.id} f={f} on={picked.includes(f.id)} onClick={() => toggle(f.id)} />)}
          </div>
          {others.length > 0 && <p className="group-lbl">Other friends</p>}
          <div className="pick-grid">
            {others.map((f) => <PickChip key={f.id} f={f} on={picked.includes(f.id)} onClick={() => toggle(f.id)} />)}
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ============================== styles ============================== */
function Style() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

:root{
  --court-deep:#0E3B4A; --court:#176B7C; --court-line:#F1FBFB;
  --ball:#CDE84B; --ball-deep:#A9C82E;
  --coral:#E76F51; --green:#2FA36B;
  --bg:#FBF8F1; --surface:#FFFFFF;
  --ink:#122A33; --ink-soft:#5A737C; --line:#E9E3D6;
  --font-d:'Bricolage Grotesque',system-ui,sans-serif;
  --font-b:'Plus Jakarta Sans',system-ui,sans-serif;
}
*{box-sizing:border-box}
.kpa-root{
  font-family:var(--font-b); color:var(--ink);
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(205,232,75,.16), transparent 60%),
    var(--bg);
  min-height:100vh; display:flex; justify-content:center; -webkit-font-smoothing:antialiased;
}
.kpa-app{
  width:100%; max-width:460px; min-height:100vh; display:flex; flex-direction:column;
  background:var(--bg); position:relative;
}
@media(min-width:520px){ .kpa-app{ box-shadow:0 0 60px rgba(14,59,74,.08); } }

/* header */
.kpa-header{
  position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:10px;
  padding:14px 16px; background:rgba(251,248,241,.86); backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line);
}
.brand{ display:flex; align-items:center; gap:10px; flex:1; }
.brand-txt{ display:flex; flex-direction:column; line-height:1; }
.brand-name{ font-family:var(--font-d); font-weight:800; font-size:13px; color:var(--ink-soft); letter-spacing:.3px; }
.brand-sub{ font-family:var(--font-d); font-weight:800; font-size:18px; color:var(--ink); letter-spacing:-.3px; }
.header-title{ flex:1; font-family:var(--font-d); font-weight:800; font-size:18px; margin:0; }
.hbtn{ width:38px; height:38px; border-radius:11px; border:1px solid var(--line);
  background:var(--surface); color:var(--ink); display:grid; place-items:center; cursor:pointer; }
.hbtn:hover{ border-color:var(--ink-soft); }

.kpa-main{ flex:1; overflow-y:auto; padding-bottom:84px; }
.pad{ padding:18px 16px 28px; }

/* tabs */
.kpa-tabs{
  position:fixed; bottom:0; left:50%; transform:translateX(-50%);
  width:100%; max-width:460px; display:flex; background:rgba(255,255,255,.92);
  backdrop-filter:blur(12px); border-top:1px solid var(--line); padding:8px 8px calc(8px + env(safe-area-inset-bottom));
  z-index:20;
}
.tab{ flex:1; border:0; background:none; padding:6px 0; display:flex; flex-direction:column;
  align-items:center; gap:3px; color:var(--ink-soft); cursor:pointer; border-radius:12px; font-family:var(--font-b); }
.tab-lbl{ font-size:11px; font-weight:600; }
.tab-on{ color:var(--court-deep); }
.tab-on .tab-ic{ background:var(--ball); border-radius:10px; }
.tab-ic{ position:relative; padding:5px 14px; border-radius:10px; transition:background .15s; }
.tab-badge{ position:absolute; top:-3px; right:4px; min-width:16px; height:16px; padding:0 4px;
  background:var(--coral); color:#fff; font-size:10px; font-weight:700; border-radius:8px;
  display:grid; place-items:center; }

/* hero */
.hero{ background:var(--surface); border:1px solid var(--line); border-radius:22px; padding:16px; margin-bottom:14px;
  box-shadow:0 8px 24px rgba(14,59,74,.06); }
.hero-top{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.eyebrow{ font-family:var(--font-d); font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:1.2px; color:var(--court); }
.link{ border:0; background:none; color:var(--court-deep); font-weight:700; font-size:13px; cursor:pointer; font-family:var(--font-b); }
.hero-when{ font-family:var(--font-d); font-weight:800; font-size:22px; margin:14px 0 4px; letter-spacing:-.5px; }
.hero-meta{ display:flex; align-items:center; gap:6px; color:var(--ink-soft); font-size:14px; margin:0 0 12px; font-weight:500; }
.hero-host{ display:flex; align-items:center; gap:5px; color:var(--ink-soft); font-size:13px; margin:-6px 0 12px; font-weight:600; }
.hero-host svg{ color:var(--ball-deep); }
.dot{ width:4px; height:4px; border-radius:50%; background:var(--line); margin:0 3px; }

/* viewer + invites */
.viewer-line{ font-family:var(--font-d); font-weight:700; font-size:15px; color:var(--ink); margin:2px 2px 12px; }
.notif-banner{ display:flex; align-items:center; gap:12px; width:100%; text-align:left; cursor:pointer;
  background:var(--ball); color:var(--ink); border:1px solid var(--ball-deep); border-radius:16px; padding:12px 14px;
  margin-bottom:14px; font-family:var(--font-b); }
.notif-banner svg{ flex-shrink:0; }
.notif-banner span{ display:flex; flex-direction:column; line-height:1.3; }
.notif-banner strong{ font-size:14.5px; }
.notif-banner em{ font-style:normal; font-size:12.5px; color:var(--court-deep); opacity:.85; }
.invites{ display:flex; flex-direction:column; gap:12px; margin-bottom:14px; }
.invite-card{ background:linear-gradient(160deg, var(--court-deep), var(--court)); color:#fff; border-radius:22px; padding:18px;
  box-shadow:0 10px 28px rgba(14,59,74,.22); }
.invite-eyebrow{ font-family:var(--font-d); font-weight:800; font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--ball); }
.invite-when{ font-family:var(--font-d); font-weight:800; font-size:21px; margin:8px 0 4px; letter-spacing:-.5px; color:#fff; }
.invite-meta{ display:flex; align-items:center; gap:6px; color:rgba(255,255,255,.92); font-size:14px; margin:0 0 4px; font-weight:600; }
.invite-meta .dot{ background:rgba(255,255,255,.5); }
.invite-sub{ color:var(--ball); font-size:13px; font-weight:700; margin:0 0 14px; }
.invite-actions{ display:flex; gap:8px; }
.invite-actions .btn{ flex:1; }
.invite-actions .btn-ghost{ background:rgba(255,255,255,.14); color:#fff; border-color:rgba(255,255,255,.28); }

/* who-are-you gate */
.who-wrap{ min-height:100vh; display:grid; place-items:center; padding:22px; background:var(--bg); }
.who-card{ width:100%; max-width:420px; background:var(--surface); border:1px solid var(--line); border-radius:26px;
  padding:24px 20px; box-shadow:0 12px 36px rgba(14,59,74,.10); }
.who-brand{ display:flex; align-items:center; gap:10px; margin-bottom:18px; }
.who-title{ font-family:var(--font-d); font-weight:800; font-size:22px; letter-spacing:-.5px; margin:0 0 6px; }
.who-sub{ color:var(--ink-soft); font-size:14px; margin:0 0 16px; line-height:1.4; }
.who-list{ display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
.who-row{ display:flex; align-items:center; gap:12px; width:100%; text-align:left; cursor:pointer;
  background:var(--bg); border:1px solid var(--line); border-radius:16px; padding:12px 14px; font-family:var(--font-b); }
.who-row:hover{ border-color:var(--court); }
.who-name{ font-weight:700; font-size:16px; color:var(--ink); }
.avatar-sm{ width:26px; height:26px; font-size:12px; }

/* court */
.court{ width:100%; height:auto; display:block; }
.court-bg{ fill:var(--court-deep); }
.court-line{ fill:none; stroke:var(--court-line); stroke-width:2; }
.court-net{ stroke:var(--court-line); stroke-width:2.4; stroke-dasharray:3 3; opacity:.85; }
.court-kitchen{ stroke:var(--court-line); stroke-width:1.1; opacity:.45; }
.slot-filled{ fill:var(--ball); }
.slot-empty{ fill:rgba(241,251,251,.05); stroke:var(--court-line); stroke-width:1.5; stroke-dasharray:4 4; opacity:.45; }
.slot-initial{ fill:var(--court-deep); font-family:var(--font-d); font-weight:800; }
.slot-plus{ fill:var(--court-line); opacity:.5; font-family:var(--font-d); }
.slot-star{ fill:var(--court-deep); }

/* pills */
.pill{ display:inline-flex; align-items:center; padding:5px 11px; border-radius:999px; font-size:12px; font-weight:700;
  background:var(--line); color:var(--ink); }
.pill-big{ font-size:13.5px; padding:8px 14px; }
.pill-wait{ background:#FFF1D6; color:#9A6A12; }
.pill-need{ background:#FDE3DC; color:#B24A30; }
.pill-full{ background:#D9F2E5; color:#1B7A4F; }
.pill-muted{ background:var(--line); color:var(--ink-soft); }

/* buttons */
.btn{ display:inline-flex; align-items:center; justify-content:center; gap:7px; border:0; cursor:pointer;
  font-family:var(--font-b); font-weight:700; font-size:14px; border-radius:14px; padding:11px 16px; transition:transform .08s, filter .15s; }
.btn:active{ transform:scale(.98); }
.btn:disabled{ opacity:.45; cursor:default; }
.btn-block{ width:100%; }
.btn-lg{ padding:14px 18px; font-size:15px; border-radius:16px; }
.btn-sm{ padding:8px 12px; font-size:13px; border-radius:11px; }
.btn-primary{ background:var(--ball); color:var(--court-deep); box-shadow:0 6px 16px rgba(169,200,46,.4); }
.btn-primary:hover:not(:disabled){ filter:brightness(1.04); }
.btn-ghost{ background:var(--surface); color:var(--ink); border:1px solid var(--line); }
.btn-ghost:hover{ border-color:var(--ink-soft); }
.btn-coral{ background:var(--coral); color:#fff; }

.sec-h{ font-family:var(--font-d); font-weight:800; font-size:15px; margin:22px 0 10px; letter-spacing:-.2px; }
.sec-h.muted{ color:var(--ink-soft); }
.group-lbl{ font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; color:var(--ink-soft); margin:14px 0 8px; }

/* game rows */
.grow{ width:100%; display:flex; gap:12px; align-items:center; text-align:left; background:var(--surface);
  border:1px solid var(--line); border-radius:18px; padding:12px; margin-bottom:10px; cursor:pointer; transition:border-color .15s,transform .08s; font-family:var(--font-b); }
.grow:hover{ border-color:var(--court); }
.grow:active{ transform:scale(.99); }
.grow-court{ width:96px; flex-shrink:0; }
.grow-body{ display:flex; flex-direction:column; gap:5px; min-width:0; }
.grow-when{ font-family:var(--font-d); font-weight:800; font-size:16px; color:var(--ink); }
.grow-meta{ font-size:13px; color:var(--ink-soft); font-weight:500; }
.grow-past{ opacity:.72; }

/* detail */
.detail-hero{ background:var(--court-deep); border-radius:22px; padding:16px; margin-bottom:8px; }
.detail-hero .hero-when{ color:#fff; margin-top:12px; }
.detail-hero .hero-meta{ color:rgba(241,251,251,.8); }
.detail-hero .hero-host{ color:rgba(241,251,251,.75); }
.detail-hero .court{ filter:drop-shadow(0 6px 14px rgba(0,0,0,.25)); }
.players{ display:flex; flex-wrap:wrap; gap:8px; }
.player-chip{ display:inline-flex; align-items:center; gap:8px; background:var(--surface); border:1px solid var(--line);
  padding:7px 12px 7px 7px; border-radius:999px; font-weight:600; font-size:13.5px; }
.player-open{ color:var(--ink-soft); border-style:dashed; }
.host-tag{ display:inline-flex; align-items:center; gap:3px; font-size:11px; color:var(--ball-deep); font-weight:700; }
.avatar{ width:30px; height:30px; border-radius:50%; background:var(--ball); color:var(--court-deep);
  display:grid; place-items:center; font-family:var(--font-d); font-weight:800; font-size:14px; flex-shrink:0; }
.avatar-sm{ width:26px; height:26px; font-size:12px; }
.avatar-open{ background:var(--line); color:var(--ink-soft); }
.avatar-wait{ background:#FFE2AE; color:#92670F; }
.avatar-no{ background:#F4CFC5; color:#A8412A; }
.avatar-late{ background:var(--line); color:var(--ink-soft); }
.avatar-owner{ background:var(--court-deep); color:var(--ball); }

.detail-actions{ display:flex; flex-direction:column; gap:8px; margin-top:16px; }

/* invite rows */
.invite-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--surface);
  border:1px solid var(--line); border-radius:14px; padding:10px 12px; margin-bottom:8px; }
.ir-left{ display:flex; align-items:center; gap:10px; min-width:0; }
.ir-left strong{ display:block; font-size:14px; }
.ir-sub{ display:flex; align-items:center; gap:4px; font-size:12px; color:var(--ink-soft); font-weight:500; }
.overdue{ display:inline-flex; align-items:center; gap:3px; color:var(--coral); font-weight:700; }
.ir-actions{ display:flex; gap:6px; flex-shrink:0; }
.mini{ display:inline-flex; align-items:center; gap:4px; border:1px solid var(--line); background:var(--surface);
  border-radius:10px; padding:7px 10px; font-size:12.5px; font-weight:700; cursor:pointer; font-family:var(--font-b); color:var(--ink); text-decoration:none; transition:filter .12s; }
.mini:disabled{ opacity:.4; cursor:default; }
.mini-yes{ background:var(--green); color:#fff; border-color:var(--green); }
.mini-no{ background:#fff; color:var(--coral); border-color:#F1C9BE; }
.mini-send{ background:var(--court-deep); color:#fff; border-color:var(--court-deep); }
.mini-sent{ background:var(--green); color:#fff; border-color:var(--green); }
.mini-ghost{ background:var(--surface); color:var(--ink-soft); }
.mini:hover:not(:disabled){ filter:brightness(.97); }
.mini-row{ display:flex; align-items:center; gap:9px; padding:8px 2px; font-size:13.5px; font-weight:600; color:var(--ink-soft); }
.hint{ display:flex; align-items:flex-start; gap:5px; font-size:12px; color:var(--ink-soft); margin:8px 2px 0; line-height:1.4; }
.hint svg{ flex-shrink:0; margin-top:1px; }

.danger-zone{ margin-top:26px; padding-top:14px; border-top:1px solid var(--line); }
.text-danger{ display:inline-flex; align-items:center; gap:6px; border:0; background:none; color:var(--coral); font-weight:600; font-size:13px; cursor:pointer; font-family:var(--font-b); }
.confirm-row{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13.5px; font-weight:600; }

/* crew */
.crew-head{ display:flex; align-items:center; justify-content:space-between; }
.friend-row{ display:flex; align-items:flex-start; gap:12px; background:var(--surface); border:1px solid var(--line);
  border-radius:16px; padding:12px; margin-bottom:9px; }
.friend-owner{ background:linear-gradient(180deg,#fff, #FCFEF2); border-color:#E6EFBE; align-items:center; }
.fr-body{ flex:1; min-width:0; }
.fr-body strong{ font-size:15px; }
.toggles{ display:flex; gap:7px; flex-wrap:wrap; margin-top:8px; }
.toggle{ display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); background:var(--surface);
  border-radius:999px; padding:5px 11px 5px 6px; font-size:12px; font-weight:600; color:var(--ink-soft); cursor:pointer; font-family:var(--font-b); }
.toggle-knob{ width:24px; height:14px; border-radius:999px; background:var(--line); position:relative; transition:background .15s; flex-shrink:0; }
.toggle-knob::after{ content:""; position:absolute; top:2px; left:2px; width:10px; height:10px; border-radius:50%; background:#fff; transition:transform .15s; box-shadow:0 1px 2px rgba(0,0,0,.2); }
.toggle-on{ color:var(--court-deep); border-color:var(--ball-deep); }
.toggle-on .toggle-knob{ background:var(--ball-deep); }
.toggle-on .toggle-knob::after{ transform:translateX(10px); }
.fr-side{ flex-shrink:0; }
.icon-ghost{ width:34px; height:34px; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); display:grid; place-items:center; cursor:pointer; }

/* agent */
.agent-banner{ display:flex; gap:12px; background:var(--court-deep); color:#fff; border-radius:18px; padding:14px; }
.ab-icon{ width:40px; height:40px; border-radius:12px; background:var(--ball); color:var(--court-deep); display:grid; place-items:center; flex-shrink:0; }
.agent-banner strong{ font-family:var(--font-d); font-size:15px; }
.agent-banner p{ margin:3px 0 0; font-size:12.5px; color:rgba(241,251,251,.82); line-height:1.45; }
.agent-controls{ display:flex; flex-direction:column; gap:8px; margin-top:14px; }
.demo-toggle{ display:flex; align-items:center; gap:9px; font-size:12.5px; color:var(--ink-soft); background:var(--surface);
  border:1px dashed var(--line); border-radius:12px; padding:10px 12px; cursor:pointer; font-weight:500; }
.demo-toggle input{ width:17px; height:17px; accent-color:var(--court); }

.feed{ display:flex; flex-direction:column; gap:10px; }
.fi{ background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:12px; border-left:4px solid var(--line); }
.fi-friend{ border-left-color:var(--court); }
.fi-owner{ border-left-color:var(--coral); }
.fi-good{ border-left-color:var(--green); }
.fi-info{ border-left-color:var(--ball-deep); }
.fi-head{ display:flex; align-items:center; gap:7px; margin-bottom:7px; }
.fi-ic{ color:var(--court); display:grid; place-items:center; }
.fi-owner .fi-ic{ color:var(--coral); }
.fi-good .fi-ic{ color:var(--green); }
.fi-to{ font-weight:800; font-size:13px; font-family:var(--font-d); }
.fi-tag{ font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--ink-soft); background:var(--bg); padding:2px 7px; border-radius:6px; }
.fi-time{ margin-left:auto; font-size:11px; color:var(--ink-soft); }
.fi-text{ margin:0 0 10px; font-size:13.5px; line-height:1.5; white-space:pre-wrap; color:var(--ink); }
.fi-actions{ display:flex; gap:6px; flex-wrap:wrap; }

/* empty */
.empty{ text-align:center; padding:34px 20px; background:var(--surface); border:1px dashed var(--line); border-radius:20px; margin-bottom:14px; }
.empty-ic{ width:60px; height:60px; border-radius:18px; background:var(--bg); color:var(--court); display:grid; place-items:center; margin:0 auto 14px; }
.empty strong{ font-family:var(--font-d); font-size:16px; display:block; margin-bottom:6px; }
.empty p{ font-size:13.5px; color:var(--ink-soft); line-height:1.5; margin:0 0 14px; max-width:280px; margin-left:auto; margin-right:auto; }

/* sheets */
.overlay{ position:fixed; inset:0; background:rgba(18,42,51,.45); backdrop-filter:blur(3px); z-index:50; display:flex; align-items:flex-end; justify-content:center; animation:fade .15s ease; }
@media(min-width:520px){ .overlay{ align-items:center; } }
.sheet{ width:100%; max-width:460px; background:var(--bg); border-radius:26px 26px 0 0; max-height:92vh; display:flex; flex-direction:column; animation:slide .22s cubic-bezier(.2,.8,.2,1); }
@media(min-width:520px){ .sheet{ border-radius:24px; max-height:88vh; } }
.sheet-grip{ width:38px; height:4px; border-radius:999px; background:var(--line); margin:10px auto 2px; }
.sheet-head{ display:flex; align-items:flex-start; justify-content:space-between; padding:8px 18px 6px; }
.sheet-head h2{ font-family:var(--font-d); font-weight:800; font-size:20px; margin:0; letter-spacing:-.4px; }
.sheet-sub{ margin:4px 0 0; font-size:13px; color:var(--ink-soft); line-height:1.4; }
.sheet-body{ overflow-y:auto; padding:8px 18px 18px; }
.sheet-foot{ padding:14px 18px calc(16px + env(safe-area-inset-bottom)); border-top:1px solid var(--line); background:var(--bg); }

.field{ display:block; margin-bottom:16px; }
.field>span{ display:block; font-size:13px; font-weight:700; margin-bottom:7px; color:var(--ink); }
.field>span em{ font-style:normal; font-weight:500; color:var(--ink-soft); }
.count{ float:right; font-size:12px; }
.field input, .field select{ width:100%; border:1.5px solid var(--line); background:var(--surface); border-radius:13px; padding:12px 13px; font-size:15px; font-family:var(--font-b); color:var(--ink); }
.field input:focus, .field select:focus{ outline:none; border-color:var(--court); }

.pick-grid{ display:flex; flex-wrap:wrap; gap:8px; }
.pick{ display:inline-flex; align-items:center; gap:8px; background:var(--surface); border:1.5px solid var(--line);
  border-radius:999px; padding:7px 13px 7px 7px; font-size:13.5px; font-weight:600; cursor:pointer; font-family:var(--font-b); color:var(--ink); transition:all .12s; }
.pick-on{ border-color:var(--ball-deep); background:#FBFEE9; color:var(--court-deep); }
.pick-on svg{ color:var(--ball-deep); }

.preview{ background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:12px; margin-top:6px; }
.preview-lbl{ display:flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; color:var(--court); text-transform:uppercase; letter-spacing:.4px; }
.preview p{ margin:8px 0 0; font-size:13px; line-height:1.5; color:var(--ink-soft); }

.kpa-toast{ position:fixed; bottom:96px; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff;
  padding:11px 18px; border-radius:13px; font-size:13.5px; font-weight:600; z-index:80; animation:fade .15s ease; box-shadow:0 8px 24px rgba(0,0,0,.25); }

@keyframes fade{ from{opacity:0} to{opacity:1} }
@keyframes slide{ from{transform:translateY(20px); opacity:.6} to{transform:translateY(0); opacity:1} }

*:focus-visible{ outline:3px solid var(--court); outline-offset:2px; border-radius:6px; }
@media(prefers-reduced-motion:reduce){ *{ animation:none !important; transition:none !important; } }
`}</style>
  );
}
