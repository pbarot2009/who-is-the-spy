// Who is the Spy? — host-authoritative P2P party game.
// Best practice notes: PeerJS mesh for data; PeerJS media calls for voice (one call
// per peer, max ~7 peers — fine per PeerJS FAQ). Web Audio synth SFX (no assets,
// resume on gesture per autoplay policy). Full CSS-var theming per M3 dark-theme
// guidance (light tones on dark surfaces, full token set per theme).

const CATEGORIES = {
  classic: { name: "Classic Mix", locs: [
    "Beach", "School", "Hospital", "Airport", "Restaurant", "Movie Theater",
    "Zoo", "Park", "Library", "Shopping Mall", "Museum", "Train Station",
    "Amusement Park", "Space Station", "Pirate Ship", "Castle", "Farm",
    "Circus", "Hotel", "Gym", "Police Station", "Fire Station", "Submarine",
    "Jungle", "Desert", "Cruise Ship", "Bank", "Stadium", "Theater", "Cafe"
  ]},
  city: { name: "City Life", locs: [
    "Coffee Shop", "Subway", "Office", "Gym", "Nightclub", "Bookstore",
    "Laundromat", "Barbershop", "Taxi", "Rooftop Bar", "Parking Garage", "Bus Stop",
    "Skyscraper", "Market", "Pharmacy", "Bakery"
  ]},
  mystery: { name: "Mystery & Crime", locs: [
    "Abandoned Mansion", "Police Station", "Bank Vault", "Dark Alley", "Courtroom",
    "Detective Office", "Haunted Hotel", "Secret Lab", "Prison", "Casino",
    "Morgue", "Jewelry Store", "Lighthouse", "Cemetery"
  ]},
  scifi: { name: "Sci-Fi & Fantasy", locs: [
    "Space Station", "Mars Colony", "Dragon Cave", "Wizard Tower", "Time Machine",
    "Alien Planet", "Underwater City", "Robot Factory", "Magic School", "Portal Gate",
    "Moon Base", "Enchanted Forest", "Cyborg Arena", "Starship Bridge"
  ]},
  food: { name: "Food & Drink", locs: [
    "Pizzeria", "Sushi Bar", "Food Truck", "Vineyard", "Chocolate Factory",
    "Street Market", "Wine Cellar", "BBQ Joint", "Ice Cream Parlor", "Tea House",
    "Brewery", "Farmers Market", "Noodle Shop", "Candy Store"
  ]},
  world: { name: "Around the World", locs: [
    "Eiffel Tower", "Pyramids", "Great Wall", "Safari", "Venice Canal",
    "Tokyo Crossing", "Niagara Falls", "Taj Mahal", "Santorini", "Northern Lights",
    "Desert Oasis", "Amazon River", "Swiss Alps", "Sydney Harbor"
  ]}
};
const LOCATIONS = CATEGORIES.classic.locs; // fallback for guess list before room starts

const MODES = {
  classic: { name: "Classic (1 spy)", spies: 1, discuss: null, guess: true },
  double: { name: "Double Spy (6+ players)", spies: 2, discuss: null, guess: true },
  lightning: { name: "Lightning (fast)", spies: 1, discuss: 60, guess: true },
  hardcore: { name: "Hardcore (no spy guess)", spies: 1, discuss: null, guess: false }
};

const SHOP_ITEMS = [
  { id: "frame-gold", name: "Gold Frame", price: 100, kind: "frame" },
  { id: "frame-silver", name: "Silver Frame", price: 120, kind: "frame" },
  { id: "frame-neon", name: "Neon Frame", price: 150, kind: "frame" },
  { id: "frame-frost", name: "Frost Frame", price: 200, kind: "frame" },
  { id: "frame-rainbow", name: "Rainbow Frame", price: 250, kind: "frame" },
  { id: "frame-royal", name: "Royal Frame", price: 300, kind: "frame" },
  { id: "theme-spy", name: "Spy Red Theme", price: 50, kind: "theme", theme: "spy", color: "#ef4444" },
  { id: "theme-ocean", name: "Ocean Theme", price: 50, kind: "theme", theme: "ocean", color: "#0ea5e9" },
  { id: "theme-forest", name: "Forest Theme", price: 50, kind: "theme", theme: "forest", color: "#22c55e" }
];
// Dark + Light are free. Spy/Ocean/Forest are shop-unlocked — buying them
// means something because the settings picker enforces it (themeIsOwned).
const THEME_SHOP = { spy: "theme-spy", ocean: "theme-ocean", forest: "theme-forest" };

const AVATAR_ICONS = ["fa-user-secret", "fa-ghost", "fa-robot", "fa-cat", "fa-dragon", "fa-rocket", "fa-crown", "fa-bolt"];
const PROMPTS = [
  "Describe your location in 3 words without naming it.",
  "What sound would you hear right now where you are?",
  "What would you never find at your location?",
  "Who here is acting the most suspicious, and why?",
  "What time of day is busiest at your location?"
];
const DEFAULT_DEV_PIN = "2468";

const COLORS = ["#7c5cfc", "#ef4444", "#22c55e", "#f59e0b", "#0ea5e9", "#ec4899", "#8b5cf6", "#14b8a6"];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PEER_PREFIX = "whos-spy-v1-";
const MIN_PLAYERS = 3;

function safeParseJSON(raw, fallback) {
  try {
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v === undefined ? fallback : v;
  } catch (e) { return fallback; }
}

// Device storage with schema keys. Private-mode / quota throws never break boot.
// Sync wrapper over localStorage with in-memory fallback so reads/writes
// keep working when storage is blocked, and data lasts across reloads.
// NOTE: this block must stay above buildICE()/Game — both read store at load.
const store = {
  _mem: Object.create(null),
  // keys whose last set() failed to reach disk (quota/private mode) —
  // memory holds the newer value, so get() must prefer it for these
  _dirty: Object.create(null),
  _lsOk: null,
  lsOk() {
    if (this._lsOk !== null) return this._lsOk;
    try {
      const k = "__spy_probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      this._lsOk = true;
    } catch (e) { this._lsOk = false; }
    return this._lsOk;
  },
  get(k, f) {
    try {
      if (Object.prototype.hasOwnProperty.call(this._dirty, k)
        && Object.prototype.hasOwnProperty.call(this._mem, k)) return this._mem[k];
    } catch (e) {}
    try {
      const v = window.localStorage.getItem(k);
      if (v != null) return v;
    } catch (e) { /* blocked storage — fall through to memory */ }
    try {
      if (Object.prototype.hasOwnProperty.call(this._mem, k)) return this._mem[k];
    } catch (e) {}
    return f;
  },
  set(k, v) {
    const s = String(v);
    try { this._mem[k] = s; } catch (e) {}
    try { window.localStorage.setItem(k, s); try { delete this._dirty[k]; } catch (e2) {} }
    catch (e) { try { this._dirty[k] = 1; } catch (e2) {} }
  },
  del(k) {
    try { delete this._mem[k]; } catch (e) {}
    try { delete this._dirty[k]; } catch (e) {}
    try { window.localStorage.removeItem(k); } catch (e) {}
  },
  getJSON(k, fallback) {
    return safeParseJSON(this.get(k, undefined), fallback);
  },
  setJSON(k, obj) {
    try { this.set(k, JSON.stringify(obj)); } catch (e) {}
  }
};

// Session-scoped flag (dev auth). Same throw-safe pattern.
const sess = {
  _mem: Object.create(null),
  get(k) {
    try {
      const v = window.sessionStorage.getItem(k);
      if (v != null) return v;
    } catch (e) {}
    try {
      if (Object.prototype.hasOwnProperty.call(this._mem, k)) return this._mem[k];
    } catch (e) {}
    return null;
  },
  set(k, v) {
    const s = String(v);
    try { this._mem[k] = s; } catch (e) {}
    try { window.sessionStorage.setItem(k, s); } catch (e) {}
  },
  del(k) {
    try { delete this._mem[k]; } catch (e) {}
    try { window.sessionStorage.removeItem(k); } catch (e) {}
  }
};

const BASE_STUN = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" }
];

function buildICE() {
  const servers = [...BASE_STUN];
  try {
    const raw = store.get("spy_turn");
    if (raw) {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      list.forEach(t => { if (t && t.urls) servers.push(t); });
    }
  } catch (e) {}
  return { iceServers: servers };
}
const ICE = buildICE();
const AVATAR_KEY = "spy_avatar_v2"; // {v:2, skin,bg,eyes,brows,mouth,hair,extra,frame}
const AVATAR_LEGACY_KEY = "spy_avatar";

// Seeded PRNG (Mulberry32 over FNV-1a) — same seed, same face, everywhere.
function hashSeed(s) {
  let h = 2166136261;
  const str = String(s || "?");
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded SVG faces v1 (legacy) — kept so old svgSeed avatars still render.
const SVG_SKINS = ["#ffd9b3", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
function svgFace(seed) {
  const h = hashSeed(seed);
  const bg = COLORS[h % COLORS.length];
  const skin = SVG_SKINS[(h >> 3) % SVG_SKINS.length];
  const eyes = (h >> 6) % 3, mouth = (h >> 8) % 4, extra = (h >> 10) % 4;
  const eyeSvg = eyes === 0
    ? `<circle cx="25" cy="34" r="2.6" fill="#20202a"/><circle cx="39" cy="34" r="2.6" fill="#20202a"/>`
    : eyes === 1
    ? `<path d="M22 35q3-3.4 6 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M36 35q3-3.4 6 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : `<circle cx="25" cy="34" r="2.6" fill="#20202a"/><path d="M36 34q3-2.6 6 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const mouthSvg = mouth === 0
    ? `<path d="M25 44q7 6 14 0" stroke="#20202a" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    : mouth === 1
    ? `<path d="M26 44q8 5 13-1" stroke="#20202a" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    : mouth === 2
    ? `<rect x="25" y="42" width="14" height="6" rx="3" fill="#fff" stroke="#20202a" stroke-width="1.6"/><line x1="29" y1="42" x2="29" y2="48" stroke="#20202a" stroke-width="1.2"/><line x1="35" y1="42" x2="35" y2="48" stroke="#20202a" stroke-width="1.2"/>`
    : `<line x1="27" y1="45" x2="37" y2="45" stroke="#20202a" stroke-width="2.6" stroke-linecap="round"/>`;
  const extraSvg = extra === 0 ? ""
    : extra === 1 ? `<circle cx="20" cy="40" r="3" fill="#ff8fa3" opacity="0.7"/><circle cx="44" cy="40" r="3" fill="#ff8fa3" opacity="0.7"/>`
    : extra === 2 ? `<g stroke="#20202a" stroke-width="2" fill="none"><circle cx="25" cy="34" r="5.5"/><circle cx="39" cy="34" r="5.5"/><line x1="30.5" y1="34" x2="33.5" y2="34"/></g>`
    : `<path d="M14 26q18-12 36 0l-2-8q-16-9-32 0z" fill="#20202a"/>`;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">`
    + `<circle cx="32" cy="32" r="32" fill="${bg}"/>`
    + `<circle cx="32" cy="37" r="20" fill="${skin}"/>${eyeSvg}${mouthSvg}${extraSvg}</svg>`;
}
function randomSeed() { return Math.random().toString(36).slice(2, 10); }

// ---------- Avatar v2: layered components, DiceBear-style ----------
const AV2_SKIN = ["#ffd9b3", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
const AV2_BG = [...COLORS];
const AV2_EYES = [
  { name: "Dots", svg: `<circle cx="25" cy="34" r="2.6" fill="#20202a"/><circle cx="39" cy="34" r="2.6" fill="#20202a"/>` },
  { name: "Happy", svg: `<path d="M22 35q3-3.4 6 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M36 35q3-3.4 6 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/>` },
  { name: "Wink", svg: `<circle cx="25" cy="34" r="2.6" fill="#20202a"/><path d="M36 34q3-2.6 6 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/>` },
  { name: "Sleepy", svg: `<path d="M22 34q3 2.6 6 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M36 34q3 2.6 6 0" stroke="#20202a" stroke-width="2.4" fill="none" stroke-linecap="round"/>` },
  { name: "Sparkle", svg: `<path d="M25 30l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2z" fill="#20202a"/><circle cx="39" cy="34" r="2.6" fill="#20202a"/>` },
  { name: "Wow", svg: `<circle cx="25" cy="34" r="3.4" fill="#fff" stroke="#20202a" stroke-width="1.6"/><circle cx="39" cy="34" r="3.4" fill="#fff" stroke="#20202a" stroke-width="1.6"/><circle cx="25" cy="34" r="1.4" fill="#20202a"/><circle cx="39" cy="34" r="1.4" fill="#20202a"/>` }
];
const AV2_BROWS = [
  { name: "None", svg: "" },
  { name: "Soft", svg: `<path d="M21 27q4-2.6 8-1" stroke="#20202a" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M35 26q4-1.6 8 1" stroke="#20202a" stroke-width="2" fill="none" stroke-linecap="round"/>` },
  { name: "Bold", svg: `<line x1="21" y1="27" x2="29" y2="26" stroke="#20202a" stroke-width="2.6" stroke-linecap="round"/><line x1="35" y1="26" x2="43" y2="27" stroke="#20202a" stroke-width="2.6" stroke-linecap="round"/>` },
  { name: "Sly", svg: `<line x1="21" y1="29" x2="29" y2="25" stroke="#20202a" stroke-width="2.4" stroke-linecap="round"/><line x1="35" y1="25" x2="43" y2="29" stroke="#20202a" stroke-width="2.4" stroke-linecap="round"/>` }
];
const AV2_MOUTH = [
  { name: "Smile", svg: `<path d="M25 44q7 6 14 0" stroke="#20202a" stroke-width="2.6" fill="none" stroke-linecap="round"/>` },
  { name: "Smirk", svg: `<path d="M26 44q8 5 13-1" stroke="#20202a" stroke-width="2.6" fill="none" stroke-linecap="round"/>` },
  { name: "Grin", svg: `<rect x="25" y="42" width="14" height="6" rx="3" fill="#fff" stroke="#20202a" stroke-width="1.6"/><line x1="29" y1="42" x2="29" y2="48" stroke="#20202a" stroke-width="1.2"/><line x1="35" y1="42" x2="35" y2="48" stroke="#20202a" stroke-width="1.2"/>` },
  { name: "Flat", svg: `<line x1="27" y1="45" x2="37" y2="45" stroke="#20202a" stroke-width="2.6" stroke-linecap="round"/>` },
  { name: "Open", svg: `<ellipse cx="32" cy="45" rx="4.5" ry="5.5" fill="#20202a"/><ellipse cx="32" cy="47" rx="2.2" ry="2.4" fill="#ff8fa3"/>` },
  { name: "Fangs", svg: `<path d="M25 43q7 5 14 0v3q-7 4-14 0z" fill="#fff" stroke="#20202a" stroke-width="1.6"/><path d="M27 45l2 3 2-3zM35 45l2 3 2-3z" fill="#20202a"/>` }
];
const AV2_HAIR = [
  { name: "Bald", svg: "" },
  { name: "Spiky", svg: `<path d="M14 30L18 16l6 7 4-10 5 9 5-8 4 9 6-6 2 12q-18-10-36 1z" fill="#20202a"/>` },
  { name: "Bob", svg: `<path d="M12 34q0-20 20-20t20 20v4q-4 2-6-2v-4q-14 4-28 0v4q-2 4-6 2z" fill="#20202a"/>` },
  { name: "Mohawk", svg: `<path d="M27 8q1 8 0 12h10q-1-6 0-12q-5-3-10 0z" fill="#e11d48"/><rect x="28" y="18" width="8" height="6" fill="#20202a"/>` },
  { name: "Bun", svg: `<circle cx="32" cy="12" r="7" fill="#20202a"/><path d="M14 32q2-16 18-16t18 16q-18-6-36 0z" fill="#20202a"/>` },
  { name: "Curls", svg: `<g fill="#20202a"><circle cx="18" cy="26" r="6"/><circle cx="26" cy="17" r="6"/><circle cx="38" cy="17" r="6"/><circle cx="46" cy="26" r="6"/></g>` },
  { name: "Sweep", svg: `<path d="M12 30q4-16 22-16 14 0 18 10-10-4-22-2-10 2-18 8z" fill="#20202a"/>` },
  { name: "Pony", svg: `<path d="M14 32q2-16 18-16t18 14l8 8q2 6-3 7l-9-7q-14 3-32-6z" fill="#20202a"/>` }
];
const AV2_EXTRA = [
  { name: "None", svg: "" },
  { name: "Blush", svg: `<circle cx="20" cy="40" r="3" fill="#ff8fa3" opacity="0.7"/><circle cx="44" cy="40" r="3" fill="#ff8fa3" opacity="0.7"/>` },
  { name: "Glasses", svg: `<g stroke="#20202a" stroke-width="2" fill="none"><circle cx="25" cy="34" r="5.5"/><circle cx="39" cy="34" r="5.5"/><line x1="30.5" y1="34" x2="33.5" y2="34"/></g>` },
  { name: "Shades", svg: `<g fill="#20202a"><rect x="19" y="30" width="12" height="7" rx="3.5"/><rect x="33" y="30" width="12" height="7" rx="3.5"/><rect x="30" y="32" width="4" height="2.4"/></g>` },
  { name: "Band", svg: `<path d="M13 27q19-11 38 0l-1.5-6q-17.5-9-35 0z" fill="#e11d48"/>` },
  { name: "Star", svg: `<path d="M46 42l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" fill="#fbbf24" stroke="#20202a" stroke-width="0.8"/>` }
];
const AV2_TABS = [
  { key: "skin", name: "Skin", opts: AV2_SKIN },
  { key: "hair", name: "Hair", opts: AV2_HAIR },
  { key: "eyes", name: "Eyes", opts: AV2_EYES },
  { key: "brows", name: "Brows", opts: AV2_BROWS },
  { key: "mouth", name: "Mouth", opts: AV2_MOUTH },
  { key: "extra", name: "Gear", opts: AV2_EXTRA },
  { key: "bg", name: "Back", opts: AV2_BG }
];

function av2Default() {
  return { v: 2, skin: 1, bg: 0, eyes: 0, brows: 1, mouth: 0, hair: 1, extra: 0, frame: "frame-none" };
}
function av2Shuffle() {
  const r = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  const pick = n => Math.floor(r() * n);
  return { v: 2, skin: pick(6), bg: pick(8), eyes: pick(6), brows: pick(4), mouth: pick(6), hair: pick(8), extra: pick(6), frame: "frame-none" };
}
function av2FromSeed(seed) {
  const r = mulberry32(hashSeed(seed));
  const pick = n => Math.floor(r() * n);
  return { v: 2, skin: pick(6), bg: pick(8), eyes: pick(6), brows: pick(4), mouth: pick(6), hair: pick(8), extra: pick(6), frame: "frame-none" };
}
function svgAvatarV2(a) {
  const skin = AV2_SKIN[a.skin] || AV2_SKIN[0];
  const bg = AV2_BG[a.bg] || AV2_BG[0];
  const eyes = (AV2_EYES[a.eyes] || AV2_EYES[0]).svg;
  const brows = (AV2_BROWS[a.brows] || AV2_BROWS[0]).svg;
  const mouth = (AV2_MOUTH[a.mouth] || AV2_MOUTH[0]).svg;
  const hair = (AV2_HAIR[a.hair] || AV2_HAIR[0]).svg;
  const extra = (AV2_EXTRA[a.extra] || AV2_EXTRA[0]).svg;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">`
    + `<circle cx="32" cy="32" r="32" fill="${bg}"/>`
    + `<circle cx="32" cy="37" r="20" fill="${skin}"/>`
    + brows + eyes + mouth + hair + extra + `</svg>`;
}

class Game {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // host: peerId -> conn | guest: "host" -> conn
    this.pendingPlayers = new Map(); // host: mid-game joiners queued for next round
    this.isHost = false;
    this.myId = null;
    this.myName = (store.get("spy_name", "") || "").slice(0, 16);
    this.roomCode = "";
    this.players = [];
    this.location = "";
    this.spyId = null;   // only the host ever holds the real one
    this.isSpy = false;  // what this client believes
    this.phase = "lobby";
    this.round = 1;
    this.timerInterval = null;
    this.roleTimeout = null;
    this.timeLeft = 0;
    this.myVote = null;
    this.pendingVote = null;
    this.votes = {};
    this.spyGuess = null;
    this.guessSubmitted = false;
    this.guessedSpies = new Set();
    this._rewardedRound = 0;
    this._guessRewardedRound = 0;
    this.chatHistory = [];
    this.seenMsgIds = new Set();
    this.soundEnabled = store.get("spy_sound", "true") !== "false";
    this.volume = this.clampInt(store.get("spy_vol", "70"), 70, 0, 100) / 100;
    this.musicOn = store.get("spy_music", "true") !== "false";
    this.music = null;
    this.discussTime = this.clampInt(store.get("spy_discuss", "120"), 120, 30, 300);
    this.voteTime = this.clampInt(store.get("spy_vote", "45"), 45, 15, 120);
    this.devMode = false;
    this.devInterval = null;
    this._fpsRAF = null;
    this.syncInterval = null;
    this.audioCtx = null;
    this.masterGain = null;
    this.longPressMs = 700;
    // economy / avatar / engagement
    this.coins = this.clampInt(store.get("spy_coins", "100"), 100, 0, 99999);
    const ownedRaw = safeParseJSON(store.get("spy_owned", null), ["frame-none"]);
    this.owned = Array.isArray(ownedRaw) ? ownedRaw.filter(x => typeof x === "string").slice(0, 40) : ["frame-none"];
    if (!this.owned.includes("frame-none")) this.owned.unshift("frame-none");
    this.avatar = this.loadAvatar();
    this.streak = this.clampInt(store.get("spy_streak", "0"), 0, 0, 999);
    this.bestStreak = this.clampInt(store.get("spy_best", "0"), 0, 0, 999);
    this.category = store.get("spy_cat", "classic") || "classic";
    this.mode = store.get("spy_mode", "classic") || "classic";
    this.spyIds = [];
    // voice chat (PeerJS media calls, mesh)
    this.voiceOn = false;
    this.localStream = null;
    this.voiceCalls = new Map();
    this.tmpAvatar = null;

    this.loadSettings();
    this.initUI();
    this.applyTheme(store.get("spy_theme", "dark") || "dark", { silent: true });
    this.checkDevMode();
    this.setStatus("Offline", false);
  }

  clampInt(v, fallback, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  validColor(c) { return typeof c === "string" && COLOR_RE.test(c) ? c : "#7c5cfc"; }

  sanitizeAvatar(a) {
    const fallback = { icon: "fa-user-secret", color: "#7c5cfc", frame: "frame-none" };
    if (!a || typeof a !== "object") return { ...fallback };
    const frame = typeof a.frame === "string" && /^[a-z0-9-]+$/.test(a.frame) ? a.frame : "frame-none";
    if (a.v === 2) {
      const clamp = (v, n) => (Number.isInteger(v) && v >= 0 && v < n) ? v : 0;
      return {
        v: 2,
        skin: clamp(a.skin, 6), bg: clamp(a.bg, 8), eyes: clamp(a.eyes, 6),
        brows: clamp(a.brows, 4), mouth: clamp(a.mouth, 6),
        hair: clamp(a.hair, 8), extra: clamp(a.extra, 6), frame
      };
    }
    const icon = typeof a.icon === "string" && /^fa-[a-z0-9-]+$/.test(a.icon) ? a.icon : fallback.icon;
    const svgSeed = typeof a.svgSeed === "string" && /^[A-Za-z0-9-]{1,24}$/.test(a.svgSeed) ? a.svgSeed : null;
    return { icon, color: this.validColor(a.color), frame, svgSeed };
  }

  loadAvatar() {
    const v2 = safeParseJSON(store.get(AVATAR_KEY, null), null);
    if (v2 && v2.v === 2) return this.sanitizeAvatar(v2);
    const legacyRaw = store.get(AVATAR_LEGACY_KEY, null);
    const legacy = this.sanitizeAvatar(safeParseJSON(legacyRaw, null));
    let next;
    if (legacy.svgSeed) next = { ...av2FromSeed(legacy.svgSeed), frame: legacy.frame };
    else if (legacyRaw) next = { ...av2Shuffle(), frame: legacy.frame };
    else next = { ...av2Shuffle() };
    store.set(AVATAR_KEY, JSON.stringify(next));
    if (legacyRaw) store.del(AVATAR_LEGACY_KEY);
    return next;
  }

  iceConfig() { return buildICE(); }

  // ---------- small helpers ----------
  $(id) { return document.getElementById(id); }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str == null ? "" : str);
    return div.innerHTML;
  }

  toast(msg, kind = "") {
    const box = this.$("toasts");
    const el = document.createElement("div");
    const icon = kind === "success" ? "fa-circle-check" : kind === "error" ? "fa-triangle-exclamation" : "fa-circle-info";
    el.className = `toast ${kind}`;
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${this.escapeHtml(msg)}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 2600);
  }

  setStatus(text, online = false) {
    this.$("status-text").textContent = text;
    this.$("connection-status").className = `status ${online ? "online" : "offline"}`;
  }

  ensureAudio() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.connect(this.audioCtx.destination);
      }
      this.applyDuck();
      if (this.audioCtx.state === "suspended") {
        try {
          const pr = this.audioCtx.resume();
          if (pr && pr.then) pr.then(() => {
            if (this.musicOn && this.phase === "lobby" && !this.music && !this._lobbyFile) this.startLobbyMusic();
          }).catch(() => {});
        } catch (e) {}
      }
      return true;
    } catch (e) { return false; }
  }

  applyDuck() {
    try {
      if (this.masterGain) this.masterGain.gain.value = 0.8 * this.volume * (this.voiceOn ? 0.5 : 1);
      if (this._lobbyFile) this._lobbyFile.volume = (this.musicOn ? 0.55 : 0) * this.volume * (this.voiceOn ? 0.5 : 1);
    } catch (e) {}
  }

  tone(freq, dur = 0.12, type = "sine", vol = 0.16, when = 0) {
    if (!this.soundEnabled || !this.ensureAudio()) return;
    try {
      const t = this.audioCtx.currentTime + when;
      const o = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      o.connect(g); g.connect(this.masterGain);
      o.frequency.setValueAtTime(freq, t);
      o.type = type;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) {} };
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }

  buzz(dur = 25) { try { if (navigator.vibrate) navigator.vibrate(dur); } catch (e) {} }

  playSound(type = "click") {
    if (!this.soundEnabled) return;
    try {
      const now = performance.now();
      if (type === this._lastS && now - this._lastST < 70) return;
      this._lastS = type; this._lastST = now;
    } catch (e) {}
    switch (type) {
      case "click": this.tone(520, 0.07); break;
      case "join": this.tone(523, 0.1); this.tone(784, 0.14, "sine", 0.16, 0.09); break;
      case "leave": this.tone(500, 0.1); this.tone(300, 0.14, "sine", 0.14, 0.09); break;
      case "chat-pop": this.tone(740, 0.05, "sine", 0.1); this.tone(980, 0.07, "sine", 0.1, 0.05); break;
      case "vote": this.tone(660, 0.09, "triangle"); break;
      case "vote-each": this.tone(720, 0.05, "triangle", 0.08); break;
      case "vote-done": this.tone(660, 0.09, "triangle"); this.tone(880, 0.12, "triangle", 0.14, 0.08); break;
      case "tick": this.tone(880, 0.06, "square", 0.08); break;
      case "go": this.tone(880, 0.1, "triangle", 0.16); this.tone(1175, 0.16, "triangle", 0.16, 0.09); break;
      case "coin": this.tone(988, 0.08); this.tone(1319, 0.16, "sine", 0.16, 0.07); break;
      case "gift-send": this.tone(988, 0.08); this.tone(1319, 0.12, "sine", 0.14, 0.07); break;
      case "gift-receive": [784, 988, 1319].forEach((f, i) => this.tone(f, 0.12, "sine", 0.14, i * 0.08)); break;
      case "guess-open": this.tone(620, 0.09, "triangle"); break;
      case "guess-right": [659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.15, i * 0.09)); this.buzz([20, 40, 20]); break;
      case "guess-wrong": this.tone(330, 0.14, "sine", 0.1); this.tone(262, 0.16, "sine", 0.1, 0.1); break;
      case "reveal": this.tone(392, 0.14, "triangle"); this.tone(523, 0.18, "triangle", 0.16, 0.12); break;
      case "success": [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, "sine", 0.16, i * 0.1)); this.buzz([20, 40, 20]); break;
      case "win": [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.2, "triangle", 0.16, i * 0.11)); this.buzz([30, 50, 30, 50, 60]); break;
      case "lose": [400, 340, 280, 200].forEach((f, i) => this.tone(f, 0.2, "sawtooth", 0.08, i * 0.12)); this.buzz(60); break;
      case "error": this.tone(220, 0.16, "sine", 0.1); break;
      case "round": this.tone(440, 0.1); this.tone(660, 0.12, "sine", 0.16, 0.1); break;
      default: this.tone(520, 0.07);
    }
  }

  // ---------- music: zero-asset sequencer, lookahead scheduler ----------
  musicBus() {
    if (!this._musicGain && this.audioCtx) {
      this._musicGain = this.audioCtx.createGain();
      this._musicGain.gain.value = 0.4;
      this._musicGain.connect(this.masterGain);
    }
    return this._musicGain;
  }

  mtone(freq, dur, type, vol, when, lpf) {
    try {
      const o = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      const f = this.audioCtx.createBiquadFilter();
      o.connect(f); f.connect(g); g.connect(this.musicBus());
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, when);
      f.type = "lowpass";
      f.frequency.setValueAtTime(lpf || 2400, when);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.onended = () => { try { o.disconnect(); g.disconnect(); f.disconnect(); } catch (e) {} };
      o.start(when); o.stop(when + dur + 0.03);
    } catch (e) {}
  }

  lobbyFileEl() {
    if (!this._lobbyFile) {
      const a = new Audio();
      a.loop = true;
      a.preload = "none";
      a.src = "assets/lobby-loop.wav?v=17";
      a.addEventListener("error", () => {
        if (this.phase === "lobby" && this.music && (this.music.mode === "file-wait" || this.music.mode === "file")) this.startLobbySynth();
      });
      this._lobbyFile = a;
    }
    return this._lobbyFile;
  }

  startLobbyMusic() {
    if (!this.musicOn || !this.soundEnabled) return;
    if (this.phase !== "lobby") return;
    if (this.music) return;
    if (!this.ensureAudio()) return;
    this.stopMusic(true);
    try {
      const a = this.lobbyFileEl();
      a.volume = 0.55 * this.volume * (this.voiceOn ? 0.5 : 1);
      this.music = { mode: "file-wait" };
      const p = a.play();
      const onOk = () => { if (this.music && this.music.mode === "file-wait") this.music = { mode: "file" }; };
      const onFail = () => { if (this.music && this.music.mode === "file-wait") this.startLobbySynth(); };
      if (p && p.then) p.then(onOk, onFail);
      else onOk();
      setTimeout(() => { if (this.music && this.music.mode === "file-wait" && a.paused) this.startLobbySynth(); }, 1500);
      return;
    } catch (e) { /* fall through to synth */ }
    this.startLobbySynth();
  }

  startLobbySynth() {
    if (!this.ensureAudio()) return;
    if (this.audioCtx.state !== "running") return;
    this.stopMusic(true);
    const N = { C3: 130.81, G2: 98.0, A2: 110.0, F2: 87.31, C4: 261.63, D4: 293.66, E4: 329.63, G3: 196.0, B3: 246.94, A3: 220.0, F3: 174.61, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5 };
    const roots = [N.C3, N.G2, N.A2, N.F2];
    const pads = [[N.C4, N.E4, N.G3], [N.G3, N.B3, N.D4], [N.A3, N.C4, N.E4], [N.F3, N.A3, N.C4]];
    const bassPat = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
    const pluckA = [N.C5, 0, N.E5, 0, N.G5, 0, N.E5, 0, N.A5, 0, N.G5, 0, N.E5, 0, N.D5, 0, N.C5, 0, N.D5, 0, N.E5, 0, N.G5, 0, N.E5, 0, N.D5, 0, N.C5, 0, 0, 0];
    const pluckB = [N.E5, 0, N.G5, 0, N.A5, 0, N.G5, 0, N.C6, 0, N.A5, 0, N.G5, 0, N.E5, 0, N.D5, 0, N.E5, 0, N.G5, 0, N.A5, 0, N.G5, 0, N.E5, 0, 0, 0, 0, 0];
    this.music = { mode: "lobby", step: 0, bpm: 96, spb: 2, len: 32, nextT: this.audioCtx.currentTime + 0.08, timer: null, N, roots, pads, bassPat, plucks: [pluckA, pluckB], phrase: 0 };
    this.music.timer = setInterval(() => this.musicTick(), 60);
  }

  musicTick() {
    const m = this.music;
    if (!m || m.mode !== "lobby" || !this.audioCtx) return;
    const stepDur = 60 / m.bpm / m.spb;
    let guard = 0;
    while (m.nextT < this.audioCtx.currentTime + 0.25 && guard++ < 16) {
      this.musicStep(m, m.step, m.nextT, stepDur);
      m.step++;
      if (m.step >= m.len) { m.step = 0; m.phrase = (m.phrase + 1) % m.plucks.length; }
      m.nextT += stepDur;
    }
  }

  musicStep(m, step, when, stepDur) {
    const block = Math.floor(step / 8) % 4;
    if (step % 8 === 0) {
      m.pads[block].forEach(f => this.mtone(f, stepDur * 8, "triangle", 0.035, when, 1200));
    }
    if (m.bassPat[step % m.bassPat.length]) {
      this.mtone(m.roots[block], stepDur * 1.8, "triangle", 0.075, when, 600);
    }
    const pl = m.plucks[m.phrase][step];
    if (pl && Math.random() > 0.12) this.mtone(pl, stepDur * 1.4, "sine", 0.04, when, 3200);
  }

  stopMusic(silent) {
    if (this.music && this.music.timer) { try { clearInterval(this.music.timer); } catch (e) {} }
    this.music = null;
    try { if (this._lobbyFile && !this._lobbyFile.paused) this._lobbyFile.pause(); } catch (e) {}
    if (!silent) return;
  }

  playPhrase(notes) {
    if (!this.soundEnabled) return;
    if (!this.ensureAudio()) return;
    const t0 = this.audioCtx.currentTime + 0.05;
    const beat = 60 / 132;
    notes.forEach(n => {
      (Array.isArray(n.f) ? n.f : [n.f]).forEach(f => this.mtone(f, (n.d || 1) * beat, n.type || "triangle", n.g || 0.14, t0 + (n.t || 0) * beat, n.lpf || 3200));
    });
  }

  playWinPhrase() {
    const N = { C4: 261.63, E4: 329.63, G4: 392.0, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };
    this.playPhrase([
      { f: N.C4, t: 0, d: 1 }, { f: N.E4, t: 1, d: 1 }, { f: N.G4, t: 2, d: 1 }, { f: N.C5, t: 3, d: 1.5 },
      { f: N.E5, t: 4.5, d: 1 }, { f: N.G5, t: 5.5, d: 1 }, { f: N.C6, t: 6.5, d: 3 },
      { f: [N.C5, N.E5, N.G5], t: 6.5, d: 3, g: 0.07 }
    ]);
  }

  playLosePhrase() {
    this.playPhrase([
      { f: 440.0, t: 0, d: 2 }, { f: 349.23, t: 2, d: 2 }, { f: 293.66, t: 4, d: 2 }, { f: 261.63, t: 6, d: 4, g: 0.12 },
      { f: 110.0, t: 6, d: 4, g: 0.06 }
    ]);
  }

  peerIdFor(code) { return PEER_PREFIX + code.toUpperCase(); }

  generateCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  // ---------- TURN relay (device-local, applied on next create/join) ----------
  fillTurnForm() {
    try {
      const t = safeParseJSON(store.get("spy_turn"), null) || {};
      this.$("turn-url").value = t.urls || "";
      this.$("turn-user").value = t.username || "";
      this.$("turn-pass").value = t.credential || "";
    } catch (e) {}
  }

  saveTurnForm() {
    const urls = this.$("turn-url").value.trim().slice(0, 120);
    const username = this.$("turn-user").value.trim().slice(0, 64);
    const credential = this.$("turn-pass").value.slice(0, 128);
    if (!urls) {
      try { store.del("spy_turn"); } catch (e) {}
      this.toast("TURN relay cleared");
      return;
    }
    if (!/^turns?:/.test(urls)) { this.toast("TURN URL must start with turn: or turns:", "error"); return; }
    try { store.set("spy_turn", JSON.stringify({ urls, username, credential })); } catch (e) {}
    this.$("turn-pass").value = "";
    this.toast("TURN relay saved — applies on next create/join", "success");
  }

  // ---------- settings / theme ----------
  loadSettings() {
    if (this.myName) this.$("player-name").value = this.myName;
    const lastCode = store.get("spy_lastcode", "");
    if (lastCode) this.$("room-code").value = lastCode;
    try {
      const h = (location.hash || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5);
      if (h.length === 5) this.$("room-code").value = h;
      else {
        const q = new URLSearchParams(location.search).get("room") || "";
        const c = q.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5);
        if (c.length === 5) this.$("room-code").value = c;
      }
    } catch (e) {}
    this.$("sound-toggle").checked = this.soundEnabled;
    this.$("discuss-time").value = this.discussTime;
    this.$("vote-time").value = this.voteTime;
    this.buildThemeOptions();
    this.syncSoundBtn();
    this.syncVoiceBtn();
  }

  themeLabel(t) {
    const names = { dark: "Dark (Default)", light: "Light", spy: "Spy Red", ocean: "Ocean", forest: "Forest" };
    const locked = !this.themeIsOwned(t);
    return `${names[t] || t}${locked ? " 🔒" : ""}`;
  }

  buildThemeOptions() {
    const sel = this.$("theme-select");
    if (!sel) return;
    const cur = store.get("spy_theme", "dark") || "dark";
    sel.innerHTML = ["dark", "light", "spy", "ocean", "forest"]
      .map(t => `<option value="${t}">${this.escapeHtml(this.themeLabel(t))}</option>`).join("");
    this.setSelect(sel, ["dark", "light", "spy", "ocean", "forest"].includes(cur) ? cur : "dark");
  }

  applyTheme(theme, opts) {
    const ok = ["dark", "light", "spy", "ocean", "forest"];
    const t = ok.includes(theme) ? theme : "dark";
    if (!this.themeIsOwned(t) && !(opts && opts.allowLocked)) {
      const sel = this.$("theme-select");
      const cur = store.get("spy_theme", "dark") || "dark";
      const silent = !!(opts && opts.silent);
      const fallback = this.themeIsOwned(cur) ? cur : "dark";
      document.body.className = fallback === "dark" ? "" : `theme-${fallback}`;
      store.set("spy_theme", fallback);
      this.setSelect(sel, fallback);
      if (!silent) {
        this.toast(`${this.themeLabel(t).replace(" 🔒", "")} is locked — unlock it in the Shop`, "error");
        this.playSound("error");
      }
      return fallback;
    }
    document.body.className = t === "dark" ? "" : `theme-${t}`;
    store.set("spy_theme", t);
    const sel = this.$("theme-select");
    this.setSelect(sel, t);
    const meta = this.$("meta-theme");
    if (meta) meta.content = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#0f0f13";
    return t;
  }

  focusModal(id) {
    const m = this.$(id);
    if (!m) return;
    try { this._lastFocus = document.activeElement; } catch (e) {}
    const target = m.querySelector("input:not([type=hidden]), button:not(.modal-x)") || m.querySelector(".modal-x");
    setTimeout(() => { try { target && target.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }

  restoreFocus() {
    try {
      if (this._lastFocus && document.contains(this._lastFocus)) this._lastFocus.focus({ preventScroll: true });
      this._lastFocus = null;
    } catch (e) {}
  }

  trapTab(e) {
    if (e.key !== "Tab") return;
    const open = [...document.querySelectorAll(".modal:not(.hidden)")].filter(m => m.offsetParent !== null);
    if (!open.length) return;
    const m = open[open.length - 1];
    const items = [...m.querySelectorAll("button, input, select, [tabindex]")].filter(el => !el.disabled && el.tabIndex >= 0 && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  openSettings() { this.closeAllDropdowns(); this.$("settings-modal").classList.remove("hidden"); this.focusModal("settings-modal"); }
  closeSettings() { this.$("settings-modal").classList.add("hidden"); }

  // ---------- UI wiring ----------
  initUI() {
    this.$("create-btn").onclick = () => this.createRoom();
    this.$("join-btn").onclick = () => this.joinRoom();
    this.$("room-code").onkeydown = e => { if (e.key === "Enter") this.joinRoom(); };
    this.$("player-name").onkeydown = e => { if (e.key === "Enter") this.$("room-code").focus(); };
    this.$("start-btn").onclick = () => this.startGame();
    this.$("copy-code").onclick = () => this.copyCode();
    this.$("share-code").onclick = () => this.shareCode();
    this.$("leave-btn").onclick = () => this.leaveRoom();
    this.$("quit-btn").onclick = () => this.leaveRoom();
    this.$("send-btn").onclick = () => this.sendChat();
    this.$("chat-input").onkeydown = e => { if (e.key === "Enter") this.sendChat(); };
    this.$("lobby-send-btn").onclick = () => this.sendLobbyChat();
    this.$("lobby-chat-input").onkeydown = e => { if (e.key === "Enter") this.sendLobbyChat(); };

    this.$("confirm-vote").onclick = () => this.submitVote();
    this.$("confirm-guess").onclick = () => this.submitGuess();
    this.$("guess-search").oninput = e => this.filterGuess(e.target.value);
    this.$("next-round-btn").onclick = () => this.nextRound();
    this.$("end-game-btn").onclick = () => this.endGame();

    this.$("vote-now-btn").onclick = () => {
      if (this.phase === "vote") this.openVoteModal();
      else if (this.isHost && (this.phase === "discuss" || this.phase === "role")) this.startVoting();
      else this.toast(this.phase === "lobby" ? "Start the game first" : "Voting is not open yet");
    };
    this.$("guess-now-btn").onclick = () => {
      if (this.guessSubmitted) return this.toast("You already submitted a guess this round");
      if (!this.isSpy) return this.toast("Only the spy can guess the location");
      if (MODES[this.mode] && MODES[this.mode].guess === false) return this.toast("Guessing is off in Hardcore mode", "error");
      if (this.phase !== "reveal") return this.toast("Guess opens after the vote — survive it first");
      this.openGuessModal();
    };
    this.$("sound-btn").onclick = () => {
      this.soundEnabled = !this.soundEnabled;
      store.set("spy_sound", String(this.soundEnabled));
      this.$("sound-toggle").checked = this.soundEnabled;
      this.syncSoundBtn();
      if (!this.soundEnabled) this.stopMusic(true);
      else this.startLobbyMusic();
      this.toast(this.soundEnabled ? "Sound on" : "Sound off");
    };

    this.$("settings-btn").onclick = () => this.openSettings();
    this.$("close-settings").onclick = () => this.closeSettings();
    this.$("theme-select").onchange = e => this.applyTheme(e.target.value);
    this.$("sound-toggle").onchange = e => {
      this.soundEnabled = e.target.checked;
      store.set("spy_sound", String(this.soundEnabled));
      this.syncSoundBtn();
      if (!this.soundEnabled) this.stopMusic(true);
      else this.startLobbyMusic();
    };
    this.$("vol-range").value = Math.round(this.volume * 100);
    this.$("vol-range").oninput = e => {
      this.volume = this.clampInt(e.target.value, 70, 0, 100) / 100;
      store.set("spy_vol", String(Math.round(this.volume * 100)));
      this.ensureAudio();
      this.applyDuck();
    };
    this.$("music-toggle").checked = this.musicOn;
    this.$("music-toggle").onchange = e => {
      this.musicOn = e.target.checked;
      store.set("spy_music", String(this.musicOn));
      if (!this.musicOn) this.stopMusic(true);
      else this.startLobbyMusic();
    };
    this.$("discuss-time").onchange = e => {
      this.discussTime = this.clampInt(e.target.value, 120, 30, 300);
      e.target.value = this.discussTime;
      store.set("spy_discuss", String(this.discussTime));
    };
    this.$("vote-time").onchange = e => {
      this.voteTime = this.clampInt(e.target.value, 45, 15, 120);
      e.target.value = this.voteTime;
      store.set("spy_vote", String(this.voteTime));
    };
    this.$("dev-pin").onchange = e => {
      const v = e.target.value.trim();
      if (v.length >= 4) { store.set("spy_devpin_hash", this.pinHash(v)); try { store.del("spy_devpin"); } catch (e2) {} e.target.value = ""; this.toast("Dev PIN updated", "success"); }
      else if (v) this.toast("PIN needs 4+ characters", "error");
    };
    this.fillTurnForm();
    ["turn-url", "turn-user", "turn-pass"].forEach(id => {
      this.$(id).onchange = () => this.saveTurnForm();
    });

    document.querySelectorAll("[data-close]").forEach(btn => {
      btn.onclick = () => {
        this.closeAllDropdowns();
        this.$(btn.dataset.close).classList.add("hidden");
        this.restoreFocus();
        if (btn.dataset.close === "vote-modal" && this.phase === "vote") this.toast("Vote closed — tap Vote to reopen");
      };
    });
    document.querySelectorAll(".modal, .overlay").forEach(m => {
      m.addEventListener("click", e => { if (e.target === m && m.id !== "results") { this.closeAllDropdowns(); m.classList.add("hidden"); this.restoreFocus(); } });
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        this.closeAllDropdowns();
        ["settings-modal", "vote-modal", "guess-modal", "shop-modal", "avatar-modal", "gift-modal", "dev-lock-modal"].forEach(id => this.$(id).classList.add("hidden"));
        if (this.devMode) this.toggleDevPanel(false);
        this.restoreFocus();
        return;
      }
      this.trapTab(e);
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
      if (!typing && e.altKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        this.requestDev();
      }
    });

    // Dev entry: long-press title (touch + mouse) + triple-click + Alt+D
    const title = this.$("game-title");
    let pressTimer = null, clicks = 0, clickTimer = null;
    const startPress = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { pressTimer = null; this.toggleDev(); }, this.longPressMs);
    };
    const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
    title.addEventListener("pointerdown", startPress);
    title.addEventListener("pointerup", cancelPress);
    title.addEventListener("pointerleave", cancelPress);
    title.addEventListener("pointercancel", cancelPress);
    title.addEventListener("contextmenu", e => e.preventDefault());
    title.addEventListener("click", () => {
      clicks++;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { clicks = 0; }, 600);
      if (clicks >= 3) { clicks = 0; this.toggleDev(); }
    });

    this.$("dev-toggle").onclick = () => this.toggleDevPanel();
    this.$("close-dev").onclick = () => this.toggleDevPanel(false);
    this.$("dev-force-vote").onclick = () => this.devForceVote();
    this.$("dev-end-vote").onclick = () => { if (this.isHost && this.phase === "vote") this.endVoting(); else this.devLog("End-vote needs host + vote phase."); };
    this.$("dev-reveal-spy").onclick = () => this.devRevealSpy();
    this.$("dev-add-bot").onclick = () => this.devAddBot();
    this.$("dev-remove-bots").onclick = () => this.devRemoveBots();
    this.$("dev-clear-chat").onclick = () => { this.clearChat(); this.devLog("Chat cleared."); };
    this.$("dev-copy-state").onclick = () => this.devCopyState();
    this.$("dev-log-state").onclick = () => { const s = this.getDebugState(); console.log("[spy-debug]", s); this.devLog(JSON.stringify(s, null, 1)); };
    this.$("dev-become-spy").onclick = () => this.devBecomeSpy();
    this.$("dev-become-citizen").onclick = () => this.devBecomeCitizen();
    this.$("dev-set-location").onclick = () => this.devSetLocation();
    this.$("dev-spoof-spy").onclick = () => this.devSpoofSpy();
    this.$("dev-unspoof").onclick = () => this.devUnspoof();
    this.$("dev-add-coins").onclick = () => this.devAddCoins();
    this.$("dev-set-coins").onclick = () => this.devSetCoins();
    this.$("dev-unlock-all").onclick = () => this.devUnlockAll();
    this.$("dev-bump-score").onclick = () => this.devBumpScore();
    this.$("dev-set-score").onclick = () => this.devSetScore();
    this.$("dev-set-streak").onclick = () => this.devSetStreak();
    this.$("dev-rig-spy").onclick = () => this.devRigSpy();
    this.$("dev-skip-timer").onclick = () => this.devSkipTimer();
    this.$("dev-force-results").onclick = () => this.devForceResults();
    this.$("dev-send-system").onclick = () => this.devSendSystem();
    this.$("dev-kick").onclick = () => this.devKick();
    this.$("dev-end-game").onclick = () => this.endGame();

    window.addEventListener("pointerdown", () => {
      this.ensureAudio();
      try {
        document.querySelectorAll("#voice-audio audio").forEach(a => {
          if (a.paused) { const p = a.play && a.play(); if (p && p.catch) p.catch(() => {}); }
        });
      } catch (e) {}
      this.startLobbyMusic();
    }, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden !== false || !this.peer || !this.roomCode) return;
      if (this.phase === "lobby") this.startLobbyMusic();
      if (this.isHost) {
        if (this.peer.disconnected) { try { this.peer.reconnect(); } catch (e) {} }
        if (this.phase === "role" && this.roleEndsAt && Date.now() >= this.roleEndsAt) this.startDiscussion();
      } else {
        const host = this.connections.get("host");
        if (!host || !host.open) {
          if (!this.joining) {
            this.toast("Reconnecting…");
            this.joinRoom();
          }
        } else this.sendToHost({ type: "syncReq" });
      }
    });

    window.addEventListener("pagehide", () => {
      try {
        if (this.isHost && this.roomCode && this.connections.size) {
          this.broadcast({ type: "hostLeft", scores: this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0 })) });
        }
      } catch (e) {}
    });

    this.$("voice-btn").onclick = () => this.toggleVoice();
    this.$("wallet-pill").onclick = () => this.openShop();
    this.$("avatar-btn").onclick = () => this.openAvatar();
    this.$("avatar-save").onclick = () => this.saveAvatar();
    this.$("gift-send").onclick = () => this.sendGift();
    this.$("prompt-btn").onclick = () => this.sendPrompt();
    this.$("dev-pin-submit").onclick = () => this.submitDevPin();
    this.$("dev-pin-input").onkeydown = e => { if (e.key === "Enter") this.submitDevPin(); };
    document.querySelectorAll("#emote-bar [data-emote]").forEach(b => {
      b.onclick = () => this.sendChat(b.dataset.emote);
    });
    this.buildLobbyPicks();
    ["theme-select", "category-select", "mode-select", "gift-to"].forEach(id => this.enhanceSelect(this.$(id)));
    document.addEventListener("click", e => {
      const t = e.target && e.target.closest ? e.target.closest(".btn,.icon-btn,.action-btn,.dd-btn,.dd-opt,.vote-option,.modal-x,.pick-grid button,.tab-row button,.emote-bar button,.shop-item button,.chat-input button,.dev-buttons button,.gift-btn,.kick-btn,.duo-check,.wallet-pill,details.how-card summary") : null;
      if (t && !t.disabled) this.playSound("click");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden === true) this.stopMusic(true);
    });
    document.addEventListener("pointerdown", e => {
      if (!e.target || !e.target.closest || !e.target.closest(".dd")) this.closeAllDropdowns();
    });
    document.addEventListener("scroll", e => {
      if (!this._openDD) return;
      if (e.target && e.target.closest && e.target.closest(".dd")) return;
      this.closeAllDropdowns();
    }, { passive: true, capture: true });
    window.addEventListener("resize", () => this.closeAllDropdowns());
    window.addEventListener("orientationchange", () => this.closeAllDropdowns());
    this.updateWallet();
    this.renderStreak();
  }
syncSoundBtn() {
    const btn = this.$("sound-btn");
    if (!btn) return;
    btn.innerHTML = this.soundEnabled
      ? `<i class="fa-solid fa-volume-high"></i><span>Sound</span>`
      : `<i class="fa-solid fa-volume-xmark"></i><span>Muted</span>`;
  }

  syncVoiceBtn() {
    const btn = this.$("voice-btn");
    if (!btn) return;
    btn.classList.toggle("live", this.voiceOn);
    btn.innerHTML = this.voiceOn
      ? `<i class="fa-solid fa-microphone"></i><span>Live</span>`
      : `<i class="fa-solid fa-microphone-slash"></i><span>Voice</span>`;
  }

  // ---------- custom dropdowns (themed replacement for native <select>) ----------
  closeAllDropdowns(except) {
    if (!this._openDD && !except) return;
    this._openDD = 0;
    document.querySelectorAll(".dd.open").forEach(d => {
      if (d === except) return;
      d.classList.remove("open");
      const b = d.querySelector(".dd-btn");
      if (b) b.setAttribute("aria-expanded", "false");
      const l = d.querySelector(".dd-list");
      if (l) l.remove();
    });
  }

  setSelect(sel, val) {
    if (!sel) return;
    sel.value = val;
    if (sel._syncDD) sel._syncDD();
  }

  enhanceSelect(sel) {
    if (!sel || sel._ddDone) return;
    sel._ddDone = true;
    sel.classList.add("native-hidden");
    const wrap = document.createElement("div");
    wrap.className = "dd";
    sel.parentNode.insertBefore(wrap, sel.nextSibling);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dd-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    try {
      const lab = sel.parentNode && sel.parentNode.querySelector ? sel.parentNode.querySelector("label") : null;
      btn.setAttribute("aria-label", (lab ? lab.textContent.trim() : sel.getAttribute("aria-label") || sel.id) || "Choose");
    } catch (e) {}
    wrap.appendChild(btn);
    const syncLabel = () => {
      const opts = sel.options ? [...sel.options] : [];
      const opt = opts[sel.selectedIndex] || opts.find(o => o.selected);
      btn.innerHTML = `<span class="dd-label">${this.escapeHtml(opt ? opt.textContent : "")}</span><i class="fa-solid fa-chevron-down"></i>`;
    };
    sel._syncDD = syncLabel;
    sel.addEventListener("change", syncLabel);
    syncLabel();
    btn.addEventListener("click", e => {
      e.stopPropagation();
      if (sel.disabled || wrap.closest(".guest-locked")) return;
      const wasOpen = wrap.classList.contains("open");
      this.closeAllDropdowns();
      if (wasOpen) return;
      const list = document.createElement("ul");
      list.className = "dd-list";
      list.setAttribute("role", "listbox");
      (sel.options ? [...sel.options] : []).forEach(o => {
        const li = document.createElement("li");
        li.className = "dd-opt" + (o.selected ? " sel" : "");
        li.setAttribute("role", "option");
        li.setAttribute("tabindex", "0");
        if (o.selected) li.setAttribute("aria-selected", "true");
        li.innerHTML = `<span>${this.escapeHtml(o.textContent)}</span>${o.selected ? '<i class="fa-solid fa-check check"></i>' : ""}`;
        const choose = () => {
          sel.value = o.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          syncLabel();
          this.closeAllDropdowns();
          this.playSound("click");
        };
        li.addEventListener("click", ev => { ev.stopPropagation(); choose(); });
        li.addEventListener("keydown", ev => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); choose(); }
          else if (ev.key === "Escape") { this.closeAllDropdowns(); btn.focus(); }
          else if (ev.key === "ArrowDown") { ev.preventDefault(); (li.nextElementSibling || li).focus(); }
          else if (ev.key === "ArrowUp") { ev.preventDefault(); (li.previousElementSibling || li).focus(); }
          else if (ev.key === "Home") { ev.preventDefault(); list.firstElementChild?.focus(); }
          else if (ev.key === "End") { ev.preventDefault(); list.lastElementChild?.focus(); }
          else if (ev.key.length === 1) {
            const ch = ev.key.toLowerCase();
            const items = [...list.children];
            const from = (items.indexOf(li) + 1) % items.length;
            for (let i = 0; i < items.length; i++) {
              const cand = items[(from + i) % items.length];
              if ((cand.textContent || "").trim().toLowerCase().startsWith(ch)) { cand.focus(); break; }
            }
          }
        });
        list.appendChild(li);
      });
      wrap.appendChild(list);
      if (wrap.closest(".modal-content")) {
        const r = btn.getBoundingClientRect();
        list.classList.add("fixed");
        list.style.left = `${Math.max(8, r.left)}px`;
        list.style.width = `${r.width}px`;
        const maxH = 220;
        const below = innerHeight - r.bottom - 8;
        if (below < maxH && r.top > below) {
          list.style.top = "auto";
          list.style.bottom = `${Math.max(8, innerHeight - r.top + 6)}px`;
          list.style.maxHeight = `${Math.min(maxH, r.top - 16)}px`;
        } else {
          list.style.top = `${r.bottom + 6}px`;
          list.style.maxHeight = `${Math.min(maxH, Math.max(120, below))}px`;
        }
      }
      wrap.classList.add("open");
      this._openDD = (this._openDD || 0) + 1;
      btn.setAttribute("aria-expanded", "true");
      const first = list.querySelector(".dd-opt.sel") || list.querySelector(".dd-opt");
      if (first && document.activeElement === btn) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (e) {} }, 30);
    });
    btn.addEventListener("keydown", e => {
      if (sel.disabled || wrap.closest(".guest-locked")) return;
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); btn.click(); }
      else if (e.key === "Escape") this.closeAllDropdowns();
    });
    wrap.addEventListener("pointerdown", e => e.stopPropagation());
  }

  // ---------- categories + modes (host picks, guests follow) ----------
  buildLobbyPicks() {
    const cat = this.$("category-select"), mode = this.$("mode-select");
    cat.innerHTML = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${this.escapeHtml(v.name)}</option>`).join("");
    mode.innerHTML = Object.entries(MODES).map(([k, v]) => `<option value="${k}">${this.escapeHtml(v.name)}</option>`).join("");
    this.setSelect(cat, this.category);
    this.setSelect(mode, this.mode);
    cat.onchange = e => {
      if (!this.isHost && this.roomCode) { this.setSelect(cat, this.category); return; }
      this.category = e.target.value;
      store.set("spy_cat", this.category);
      if (this.isHost) this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
    };
    mode.onchange = e => {
      if (!this.isHost && this.roomCode) { this.setSelect(mode, this.mode); return; }
      this.mode = e.target.value;
      store.set("spy_mode", this.mode);
      if (this.isHost) this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
    };
  }

  poolFor(category) { return (CATEGORIES[category] || CATEGORIES.classic).locs; }

  // ---------- coins / shop / avatar / gifts ----------
  updateWallet() {
    this.$("coin-balance").textContent = this.coins;
    this.$("shop-balance").textContent = this.coins;
    this.$("gift-balance").textContent = this.coins;
    store.set("spy_coins", String(this.coins));
  }

  earnCoins(n) {
    if (!n) return;
    this.coins = Math.min(99999, Math.max(0, this.coins + n));
    this.updateWallet();
    if (n > 0) this.playSound("coin");
  }

  themeIsOwned(theme) {
    if (theme === "dark" || theme === "light") return true;
    const item = THEME_SHOP[theme];
    return !!item && this.owned.includes(item);
  }

  openShop() {
    this.closeAllDropdowns();
    this.updateWallet();
    const grid = this.$("shop-items");
    const curTheme = store.get("spy_theme", "dark") || "dark";
    const card = (it) => {
      const owned = this.owned.includes(it.id);
      const equipped = (it.kind === "frame" && this.avatar.frame === it.id)
        || (it.kind === "theme" && curTheme === it.theme);
      const demoCls = it.kind === "frame" ? it.id : "";
      const demoStyle = it.kind === "theme" && it.color
        ? `background:${it.color}`
        : `background:var(--primary)`;
      let btn;
      if (!owned) {
        btn = `<button type="button" data-buy="${it.id}">Buy · ${it.price} <i class="fa-solid fa-coins"></i></button>`;
      } else if (it.kind === "frame") {
        btn = equipped
          ? `<button type="button" class="equipped" data-unequip="frame-none"><i class="fa-solid fa-check"></i> Equipped · Remove</button>`
          : `<button type="button" data-equip="${it.id}">Equip</button>`;
      } else {
        btn = equipped
          ? `<button type="button" class="equipped" data-apply-theme="dark"><i class="fa-solid fa-check"></i> Active · Default</button>`
          : `<button type="button" data-apply-theme="${it.theme}">Apply</button>`;
      }
      return `<div class="shop-item ${owned ? "owned" : ""} ${equipped ? "equipped-now" : ""}">
        <div class="demo ${demoCls}" style="${demoStyle}"><i class="fa-solid ${it.kind === "frame" ? "fa-award" : "fa-palette"}"></i></div>
        <strong>${this.escapeHtml(it.name)}</strong><span class="price"><i class="fa-solid fa-coins"></i> ${it.price}${owned ? " · owned" : ""}${equipped ? " · active" : ""}</span>
        ${btn}
      </div>`;
    };
    const frames = SHOP_ITEMS.filter(i => i.kind === "frame").map(card).join("");
    const themes = SHOP_ITEMS.filter(i => i.kind === "theme").map(card).join("");
    grid.innerHTML = `<div class="shop-group-label"><i class="fa-solid fa-award"></i> Avatar frames</div>`
      + `<div class="shop-grid">${frames}</div>`
      + `<div class="shop-group-label"><i class="fa-solid fa-palette"></i> Themes</div>`
      + `<div class="shop-grid">${themes}</div>`;
    grid.querySelectorAll("[data-buy]").forEach(b => { b.onclick = () => this.buyItem(b.dataset.buy); });
    grid.querySelectorAll("[data-equip]").forEach(b => { b.onclick = () => this.equipFrame(b.dataset.equip); });
    grid.querySelectorAll("[data-unequip]").forEach(b => { b.onclick = () => this.equipFrame("frame-none"); });
    grid.querySelectorAll("[data-apply-theme]").forEach(b => {
      b.onclick = () => {
        this.applyTheme(b.dataset.applyTheme, { allowLocked: true });
        this.openShop();
      };
    });
    this.$("shop-modal").classList.remove("hidden");
    this.focusModal("shop-modal");
  }

  buyItem(id) {
    const it = SHOP_ITEMS.find(x => x.id === id);
    if (!it || this.owned.includes(id)) return;
    if (this.coins < it.price) { this.toast("Not enough coins — score points to earn", "error"); this.playSound("error"); return; }
    this.coins -= it.price;
    this.owned.push(id);
    store.set("spy_owned", JSON.stringify(this.owned));
    if (it.kind === "frame") this.equipFrame(it.id, true);
    if (it.kind === "theme" && it.theme) this.applyTheme(it.theme, { allowLocked: true });
    this.buildThemeOptions();
    this.updateWallet();
    this.playSound("success");
    this.toast(`${it.name} unlocked!`, "success");
    this.openShop();
  }

  equipFrame(id, silent) {
    if (!this.owned.includes(id) && id !== "frame-none") return;
    this.avatar = this.sanitizeAvatar({ ...this.avatar, frame: id });
    store.set(AVATAR_KEY, JSON.stringify(this.avatar));
    const me = this.players.find(p => p.id === this.myId);
    if (me) me.avatar = this.avatar;
    this.renderPlayers();
    this.broadcastAvatar();
    if (!silent) {
      this.playSound("success");
      this.toast(id === "frame-none" ? "Frame removed" : "Frame equipped", "success");
      this.openShop();
    }
  }

  avatarHtml(p, size = 36) {
    const raw = (p && p.avatar) || { icon: "fa-user-secret", color: (p && p.color) || "#7c5cfc", frame: "frame-none" };
    const a = this.sanitizeAvatar(raw);
    if (a.v === 2) {
      return `<div class="avatar av-svg ${a.frame && a.frame !== "frame-none" ? a.frame : ""}" style="width:${size}px;height:${size}px">${svgAvatarV2(a)}</div>`;
    }
    if (a.svgSeed) {
      return `<div class="avatar av-svg ${a.frame && a.frame !== "frame-none" ? a.frame : ""}" style="width:${size}px;height:${size}px">${svgFace(a.svgSeed)}</div>`;
    }
    const initial = this.escapeHtml(((p && p.name) || "?")[0].toUpperCase());
    const icon = a.icon && a.icon.startsWith("fa-") ? `<i class="fa-solid ${a.icon}"></i>` : initial;
    return `<div class="avatar ${a.frame && a.frame !== "frame-none" ? a.frame : ""}" style="background:${this.escapeHtml(a.color)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${icon}</div>`;
  }

  openAvatar() {
    this.closeAllDropdowns();
    this.tmpAvatar = { ...this.avatar };
    this.renderAvatarBuilder();
    this.$("avatar-modal").classList.remove("hidden");
    this.focusModal("avatar-modal");
  }

  renderAvatarBuilder() {
    let t = this.sanitizeAvatar(this.tmpAvatar);
    if (t.v !== 2 && !t.svgSeed) t = { ...av2Shuffle(), frame: t.frame || "frame-none" };
    if (t.v !== 2 && t.svgSeed) t = { ...av2FromSeed(t.svgSeed), frame: t.frame || "frame-none" };
    this.tmpAvatar = { ...t };
    if (!this.avTab || !AV2_TABS.some(x => x.key === this.avTab)) this.avTab = "hair";
    this.$("avatar-preview").innerHTML = `<div class="big av-svg ${t.frame !== "frame-none" ? t.frame : ""}">${svgAvatarV2(t)}</div>`;
    this.$("avatar-shuffle").onclick = () => {
      const keepFrame = this.tmpAvatar.frame;
      this.tmpAvatar = { ...av2Shuffle(), frame: keepFrame };
      this.renderAvatarBuilder(); this.playSound("click");
    };
    this.$("avatar-reset").onclick = () => {
      const keepFrame = this.tmpAvatar.frame;
      this.tmpAvatar = { ...av2Default(), frame: keepFrame };
      this.renderAvatarBuilder(); this.playSound("click");
    };
    this.$("avatar-tabs").innerHTML = AV2_TABS.map(tab =>
      `<button type="button" data-tab="${tab.key}" class="${this.avTab === tab.key ? "sel" : ""}">${tab.name}</button>`
    ).join("");
    this.$("avatar-tabs").querySelectorAll("button").forEach(b => {
      b.onclick = () => { this.avTab = b.dataset.tab; this.renderAvatarBuilder(); this.playSound("click"); };
    });
    const tab = AV2_TABS.find(x => x.key === this.avTab);
    const box = this.$("avatar-options");
    if (tab.key === "skin" || tab.key === "bg") {
      const pal = tab.key === "skin" ? AV2_SKIN : AV2_BG;
      box.innerHTML = pal.map((c, i) =>
        `<button type="button" data-i="${i}" class="swatch ${t[tab.key] === i ? "sel" : ""}" style="background:${c}" aria-label="${tab.name} ${i + 1}">·</button>`
      ).join("");
    } else {
      box.innerHTML = tab.opts.map((o, i) => {
        const trial = { ...t, [tab.key]: i };
        return `<button type="button" data-i="${i}" class="opt ${t[tab.key] === i ? "sel" : ""}" title="${this.escapeHtml(o.name)}">${svgAvatarV2(trial)}</button>`;
      }).join("");
    }
    box.querySelectorAll("button").forEach(b => {
      b.onclick = () => { this.tmpAvatar[tab.key] = parseInt(b.dataset.i, 10); this.renderAvatarBuilder(); this.playSound("click"); };
    });
    const frames = ["frame-none", ...new Set(this.owned.filter(o => o.startsWith("frame-") && o !== "frame-none"))];
    this.$("avatar-frames").innerHTML = frames.map(f => {
      const label = f === "frame-none" ? "No Frame" : (SHOP_ITEMS.find(x => x.id === f)?.name || f);
      return `<button type="button" data-f="${f}" class="${t.frame === f ? "sel" : ""}" title="${this.escapeHtml(label)}" aria-label="${this.escapeHtml(label)}">
        <span class="frame-dot ${f !== "frame-none" ? f : ""}"><i class="fa-solid ${f === "frame-none" ? "fa-ban" : "fa-award"}"></i></span>
      </button>`;
    }).join("");
    this.$("avatar-frames").querySelectorAll("button").forEach(b => {
      b.onclick = () => { this.tmpAvatar.frame = b.dataset.f; this.renderAvatarBuilder(); };
    });
  }

  saveAvatar() {
    this.avatar = this.sanitizeAvatar(this.tmpAvatar);
    if (this.avatar.v !== 2 && !this.avatar.svgSeed) this.avatar = { ...av2Shuffle(), frame: this.avatar.frame || "frame-none" };
    store.set(AVATAR_KEY, JSON.stringify(this.avatar));
    const me = this.players.find(p => p.id === this.myId);
    if (me) me.avatar = this.avatar;
    this.playSound("success");
    this.toast("Avatar saved", "success");
    this.$("avatar-modal").classList.add("hidden");
    this.renderPlayers();
    this.broadcastAvatar();
  }

  broadcastAvatar() {
    if (!this.myId) return;
    const payload = { type: "avatar", id: this.myId, avatar: this.avatar, name: this.myName };
    if (this.isHost) this.broadcast(payload);
    else this.sendToHost(payload);
  }

  openGift(targetId) {
    this.closeAllDropdowns();
    const others = this.players.filter(p => p.id !== this.myId && !p.bot);
    const gt = this.$("gift-to");
    gt.innerHTML = others.map(p => `<option value="${this.escapeHtml(p.id)}">${this.escapeHtml(p.name)}</option>`).join("") || `<option value="">No one to gift</option>`;
    if (targetId && others.some(p => p.id === targetId)) {
      this.setSelect(gt, targetId);
    } else if (gt._syncDD) {
      gt._syncDD();
    }
    this.updateWallet();
    this.$("gift-modal").classList.remove("hidden");
    this.focusModal("gift-modal");
  }

  sendGift() {
    const to = this.$("gift-to").value;
    const amount = this.clampInt(this.$("gift-amount").value, 0, 5, 500);
    if (!to || !this.players.some(p => p.id === to && !p.bot)) return this.toast("Nobody to gift", "error");
    if (amount < 5) return this.toast("Minimum gift is 5 coins", "error");
    if (amount > this.coins) return this.toast("Not enough coins", "error");
    const now = Date.now();
    if (now - (this._lastMyGiftAt || 0) < 2000) {
      return this.toast("Wait a moment before sending another gift", "error");
    }
    if (!this.isHost) {
      const host = this.connections.get("host");
      if (!host || !host.open) return this.toast("Not connected to host", "error");
    } else {
      const targetConn = this.connections.get(to);
      if (!targetConn || !targetConn.open) return this.toast("Player is not connected", "error");
    }
    this._lastMyGiftAt = now;
    this.coins -= amount;
    this.updateWallet();
    const payload = { type: "gift", from: this.myId, fromName: this.myName, to, amount, msgId: `${this.myId}-${now}-gift` };
    if (this.isHost) this.routeGift(payload);
    else this.sendToHost(payload);
    this.$("gift-modal").classList.add("hidden");
    this.playSound("gift-send");
    this.toast(`Sent ${amount} coins`, "success");
  }

  routeGift(d, conn) {
    const senderId = (conn && conn.peer) || d.from;
    const amount = Number(d.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 5 || amount > 500) return;
    if (typeof d.to !== "string" || !this.players.some(p => p.id === d.to)) return;
    if (typeof senderId !== "string" || !this.players.some(p => p.id === senderId)) return;
    const now = Date.now();
    this._giftAt = this._giftAt || {};
    if (conn && now - (this._giftAt[senderId] || 0) < 1900) return;
    this._giftAt[senderId] = now;
    const sender = this.players.find(p => p.id === senderId);
    const fromName = sender ? sender.name : String(d.fromName || "Someone").slice(0, 16);
    const clean = { type: "gift", from: senderId, fromName, to: d.to, amount, msgId: String(d.msgId || `${senderId}-${now}-gift`).slice(0, 64) };
    if (clean.to === this.myId) {
      this.earnCoins(clean.amount);
      this.playSound("gift-receive");
      this.addSystemMessage(`${fromName} sent you ${clean.amount} coins!`);
      this.toast(`+${clean.amount} coins from ${fromName}!`, "success");
      return;
    }
    const target = this.connections.get(clean.to);
    if (target) this.sendTo(target, clean);
    this.addSystemMessage(`${fromName} gifted ${clean.amount} coins.`);
  }

  sendPrompt() {
    const q = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    this.$("chat-input").value = q;
    this.sendChat();
  }

  renderStreak() {
    const line = this.$("streak-line");
    if (this.streak >= 2) {
      line.classList.remove("hidden");
      this.$("streak-text").textContent = `${this.streak}-round win streak! Best: ${this.bestStreak}`;
    } else {
      line.classList.add("hidden");
    }
    const chip = this.$("streak-chip");
    if (chip) {
      chip.classList.toggle("hidden", this.streak < 2);
      this.$("streak-count").textContent = this.streak;
      chip.title = `${this.streak}-round win streak (best ${this.bestStreak})`;
    }
  }

  // ---------- voice chat (PeerJS media calls, mesh of audio-only) ----------
  async toggleVoice() {
    if (this.voiceOn) { this.stopVoice(); return; }
    if (!this.peer || !this.myId) return this.toast("Join a room first", "error");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!window.isSecureContext) return this.toast("Voice needs HTTPS — open the https site, not a plain-IP link", "error");
      return this.toast("Voice not supported in this browser", "error");
    }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) {
      if (!window.isSecureContext) return this.toast("Voice needs HTTPS — open the https site, not a plain-IP link", "error");
      const n = (e && e.name) || "";
      if (n === "NotFoundError" || n === "OverconstrainedError") return this.toast("No microphone found on this device", "error");
      if (n === "NotReadableError") return this.toast("Mic is busy — close other apps using it", "error");
      return this.toast("Mic blocked — allow microphone access", "error");
    }
    this.voiceOn = true;
    const me = this.players.find(p => p.id === this.myId);
    if (me) me.voice = true;
    this.syncVoiceBtn();
    this.ensureAudio();
    this.applyDuck();
    this.toast("Voice live — talk to the room", "success");
    this.playSound("join");
    this.voiceCalls.forEach(c => { try { c.close(); } catch (e) {} });
    this.voiceCalls.clear();
    this.$("voice-audio").innerHTML = "";
    this._lastCallAll = 0;
    this.callAllPeers();
    if (this.isHost) this.broadcast({ type: "voice-state", id: this.myId, on: true });
    else this.sendToHost({ type: "voice-state", id: this.myId, on: true });
    this.renderPlayers();
  }

  stopVoice() {
    this.voiceOn = false;
    clearTimeout(this._callAllTimer);
    const me = this.players.find(p => p.id === this.myId);
    if (me) me.voice = false;
    try { if (this.localStream) this.localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    this.localStream = null;
    this.voiceCalls.forEach(c => { try { c.close(); } catch (e) {} });
    this.voiceCalls.clear();
    this.$("voice-audio").innerHTML = "";
    this.applyDuck();
    this.syncVoiceBtn();
    if (this.isHost) this.broadcast({ type: "voice-state", id: this.myId, on: false });
    else this.sendToHost({ type: "voice-state", id: this.myId, on: false });
    this.renderPlayers();
  }

  callAllPeers() {
    if (!this.voiceOn || !this.localStream || !this.peer) return;
    const now = Date.now();
    const elapsed = now - (this._lastCallAll || 0);
    if (elapsed < 1200) {
      clearTimeout(this._callAllTimer);
      this._callAllTimer = setTimeout(() => this.callAllPeers(), 1250 - elapsed);
      return;
    }
    this._lastCallAll = now;
    const targets = this.players.map(p => p.id).filter(id => id && id !== this.myId && !id.startsWith("bot-"));
    targets.forEach(pid => {
      if (this.voiceCalls.has(pid)) return;
      try {
        const call = this.peer.call(pid, this.localStream);
        if (!call) return;
        this.voiceCalls.set(pid, call);
        call.on("stream", s => this.attachVoice(pid, s));
        call.on("close", () => { if (this.voiceCalls.get(pid) === call) this.voiceCalls.delete(pid); this.detachVoice(pid); });
        call.on("error", () => { if (this.voiceCalls.get(pid) === call) this.voiceCalls.delete(pid); this.detachVoice(pid); });
      } catch (e) {}
    });
  }

  attachVoice(pid, stream) {
    let el = document.getElementById(`voice-${pid}`);
    if (!el) {
      el = document.createElement("audio");
      el.id = `voice-${pid}`;
      el.autoplay = true;
      el.playsInline = true;
      this.$("voice-audio").appendChild(el);
    }
    el.srcObject = stream;
    el.muted = false;
    try {
      const p = el.play && el.play();
      if (p && p.catch) p.catch(() => {
        if (!this._voiceToastShown) {
          this._voiceToastShown = true;
          this.toast("Tap anywhere to hear voice");
        }
      });
    } catch (e) {}
  }

  detachVoice(pid) { const el = document.getElementById(`voice-${pid}`); if (el) el.remove(); }

  handleIncomingCall(call) {
    const old = this.voiceCalls.get(call.peer);
    if (old && old !== call) { try { old.close(); } catch (e) {} }
    this.voiceCalls.set(call.peer, call);
    try {
      if (this.voiceOn && this.localStream) call.answer(this.localStream);
      else call.answer();
    } catch (e) { try { call.answer(); } catch (e2) {} }
    call.on("stream", s => this.attachVoice(call.peer, s));
    call.on("close", () => { if (this.voiceCalls.get(call.peer) === call) this.voiceCalls.delete(call.peer); this.detachVoice(call.peer); });
    call.on("error", () => { if (this.voiceCalls.get(call.peer) === call) this.voiceCalls.delete(call.peer); this.detachVoice(call.peer); });
  }

  // ---------- confetti celebration ----------
  launchConfetti(n = 130) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (innerWidth < 480 || matchMedia("(update: slow)").matches) n = Math.ceil(n / 2);
    } catch (e) {}
    try { if (this.confettiRAF) cancelAnimationFrame(this.confettiRAF); } catch (e) {}
    if (this._confettiResize) { try { window.removeEventListener("resize", this._confettiResize); } catch (e) {} }
    const cv = this.$("confetti");
    cv.classList.remove("hidden");
    const ctx = cv.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const sizeCanvas = () => {
      cv.width = Math.floor(innerWidth * dpr);
      cv.height = Math.floor(innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();
    this._confettiResize = sizeCanvas;
    window.addEventListener("resize", this._confettiResize);
    const colors = [getComputedStyle(document.body).getPropertyValue("--primary").trim() || "#7c5cfc", "#22c55e", "#f59e0b", "#ec4899", "#0ea5e9"];
    const parts = Array.from({ length: n }, () => ({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.3,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vy: 2 + Math.random() * 3,
      vx: -1.5 + Math.random() * 3,
      r: Math.random() * Math.PI,
      vr: -0.1 + Math.random() * 0.2,
      c: colors[Math.floor(Math.random() * colors.length)]
    }));
    const t0 = Date.now();
    const tick = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (Date.now() - t0 < 2600) this.confettiRAF = requestAnimationFrame(tick);
      else {
        cv.classList.add("hidden"); ctx.clearRect(0, 0, innerWidth, innerHeight);
        this.confettiRAF = null;
        if (this._confettiResize) { try { window.removeEventListener("resize", this._confettiResize); } catch (e) {} this._confettiResize = null; }
      }
    };
    tick();
  }

  // ---------- dev mode (PIN-locked, hashed, URL stripped) ----------
  pinHash(pin) {
    let h = 5381;
    const s = `spy|${pin}`;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return `h${h.toString(36)}`;
  }

  devPinOk(pin) {
    try {
      const legacy = store.get("spy_devpin");
      if (legacy) {
        store.set("spy_devpin_hash", this.pinHash(legacy));
        store.del("spy_devpin");
      }
    } catch (e) {}
    const want = store.get("spy_devpin_hash") || this.pinHash(DEFAULT_DEV_PIN);
    return this.pinHash(pin) === want;
  }

  checkDevMode() {
    const q = new URLSearchParams(location.search);
    const pin = q.get("dev") || q.get("debug");
    if (pin && this.devPinOk(pin)) {
      sess.set("spy_dev_auth", "1");
      this.enableDev(true);
    }
    if (pin) {
      try {
        q.delete("dev"); q.delete("debug");
        const qs = q.toString();
        history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
      } catch (e) {}
    }
  }

  requestDev() {
    if (sess.get("spy_dev_auth") === "1") {
      if (this.devMode) this.disableDev();
      else this.enableDev();
      return;
    }
    this.$("dev-pin-error").classList.add("hidden");
    this.$("dev-pin-input").value = "";
    this.$("dev-lock-modal").classList.remove("hidden");
    setTimeout(() => this.$("dev-pin-input").focus(), 80);
  }

  submitDevPin() {
    const v = this.$("dev-pin-input").value.trim();
    if (v && this.devPinOk(v)) {
      sess.set("spy_dev_auth", "1");
      this.$("dev-lock-modal").classList.add("hidden");
      this.enableDev();
    } else {
      this.$("dev-pin-error").classList.remove("hidden");
      this.playSound("error");
    }
  }

  enableDev(silent = false) {
    if (sess.get("spy_dev_auth") !== "1") { this.requestDev(); return; }
    this.devMode = true;
    this.$("dev-toggle").classList.remove("hidden");
    this.updateDevPanel();
    this.startDevRefresh();
    if (!silent) this.toast("Dev mode on. Tap the bug icon.", "success");
  }

  disableDev() {
    this.devMode = false;
    this.$("dev-toggle").classList.add("hidden");
    this.$("dev-panel").classList.add("hidden");
    sess.del("spy_dev_auth");
    this.stopDevRefresh();
    this.toast("Dev mode off");
  }

  toggleDev() {
    this.requestDev();
  }

  toggleDevPanel(show) {
    const panel = this.$("dev-panel");
    const willShow = show === undefined ? panel.classList.contains("hidden") : !!show;
    panel.classList.toggle("hidden", !willShow);
    if (willShow) {
      this.updateDevPanel();
      this.startFpsMeter();
    } else {
      this.stopFpsMeter();
    }
  }

  startFpsMeter() {
    this.stopFpsMeter();
    let frames = 0;
    let last = performance.now();
    const loop = (now) => {
      if (!this.devMode || this.$("dev-panel").classList.contains("hidden")) {
        this._fpsRAF = null;
        return;
      }
      frames++;
      if (now - last >= 500) {
        const fps = Math.min(144, Math.round((frames * 1000) / (now - last)));
        const el = this.$("dev-fps");
        if (el) el.textContent = `${fps} fps`;
        frames = 0;
        last = now;
      }
      this._fpsRAF = requestAnimationFrame(loop);
    };
    this._fpsRAF = requestAnimationFrame(loop);
  }

  stopFpsMeter() {
    if (this._fpsRAF) { try { cancelAnimationFrame(this._fpsRAF); } catch (e) {} }
    this._fpsRAF = null;
  }

  startDevRefresh() {
    this.stopDevRefresh();
    this.devInterval = setInterval(() => { if (this.devMode) this.updateDevPanel(); }, 1000);
  }

  stopDevRefresh() {
    if (this.devInterval) clearInterval(this.devInterval);
    this.devInterval = null;
    this.stopFpsMeter();
  }

  updateDevPanel() {
    if (!this.devMode) return;
    const panel = this.$("dev-panel");
    if (panel && panel.classList.contains("hidden")) return;
    const spyNames = this.isHost
      ? (this.spyIds.map(id => this.players.find(p => p.id === id)?.name || id.slice(0, 6)).join(", ") || "—")
      : (this.isSpy ? `${this.myName} (you)` : "hidden — you are not host");
    const loc = this.isHost ? (this.location || "—") : (this.isSpy ? "(hidden from spy)" : (this.location || "—"));
    this.$("dev-state").innerHTML = `
      <div>Phase: <strong>${this.escapeHtml(this.phase)}</strong></div>
      <div>Round: <strong>${this.round}</strong></div>
      <div>Players: <strong>${this.players.length}</strong></div>
      <div>Role: <strong>${this.isHost ? "HOST" : "GUEST"}${this.isSpy ? " + SPY" : ""}</strong></div>
      <div class="wide">Spies: <strong>${this.escapeHtml(spyNames)}</strong></div>
      <div class="wide">Location: <strong>${this.escapeHtml(loc)}</strong></div>
      <div>Conns: <strong>${this.connections.size}</strong></div>
      <div>Votes: <strong>${Object.keys(this.votes).length}/${this.realPlayers().length}</strong></div>
      <div>Sync: <strong>${typeof this._lastSyncSeq === "number" ? `#${this._lastSyncSeq}` : (this.isHost ? `out #${this._syncSeq || 0}` : "—")}</strong></div>
      <div>Coins: <strong>${this.coins}</strong></div>
      <div class="wide">Room: <strong>${this.escapeHtml(this.roomCode || "—")}</strong> · Me: <strong>${this.escapeHtml(this.myName || "—")}</strong></div>
    `;
  }

  devLog(text) {
    const el = this.$("dev-log");
    el.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    this.updateDevPanel();
  }

  devForceVote() {
    if (!this.isHost) return this.devLog("Force-vote needs host. Only the host drives phases.");
    if (this.phase === "lobby") return this.devLog("Start the game first.");
    this.startVoting();
    this.devLog("Forced vote phase.");
  }

  devRevealSpy() {
    if (this.isHost) {
      const name = this.spyIds.map(id => this.players.find(p => p.id === id)?.name || "unknown").join(", ") || "none";
      this.devLog(`Spy: ${name} | Location: ${this.location}`);
      this.toast(`Spy: ${name}`, "success");
    } else if (this.isSpy) {
      this.devLog("You ARE the spy. Location hidden from you by design.");
    } else {
      this.devLog("Guests never receive spy/location (anti-cheat). Use Become spy (local spoof) or Spoof spy UI to test spy flows.");
    }
  }

  devAddBot() {
    if (!this.isHost) return this.devLog("Add-bot needs host.");
    if (this.phase !== "lobby") return this.devLog("Bots can only join in the lobby.");
    const n = this.players.length + 1;
    const id = `bot-${Math.random().toString(36).slice(2, 8)}`;
    this.addPlayer({ id, name: `Bot ${n}`, isHost: false, score: 0, color: COLORS[this.players.length % COLORS.length], bot: true, avatar: av2FromSeed(id) });
    this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
    this.devLog(`Added ${id}. Bots never vote — they are skipped in tally.`);
  }

  devRemoveBots() {
    if (!this.isHost) return this.devLog("Remove-bots needs host.");
    this.players = this.players.filter(p => !p.bot);
    this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
    this.renderPlayers();
    this.devLog("Bots removed.");
  }

  devCopyState() {
    const s = JSON.stringify(this.getDebugState(), null, 2);
    this.copyText(s, "Debug state copied");
    this.devLog("State copied to clipboard.");
  }

  devCheatTag() { return this.isHost ? "CHEAT" : "CHEAT (local only)"; }

  devBroadcastSpy(note) {
    this.broadcast({ type: "devSpy", spyIds: this.spyIds, location: this.location, round: this.round });
    this.devLog(`${note} [${this.devCheatTag()}] spy=${this.spyIds.join(",")} loc=${this.location}`);
  }

  devBecomeSpy() {
    if (this.phase === "lobby") return this.devLog("Start the game first.");
    if (this.isHost) {
      if (this.spyIds.includes(this.myId)) return this.devLog("You are already a spy.");
      const want = Math.max(1, this.spyIds.length);
      this.spyIds = [this.myId, ...this.spyIds.filter(id => id !== this.myId)].slice(0, want);
      this.spyId = this.spyIds[0];
      this.isSpy = true;
      this.showRole(); this.updatePhaseUI(); this.renderPlayers();
      this.playSound("reveal");
      this.toast("CHEAT: you are now the spy", "success");
      this.devBroadcastSpy("Become spy.");
    } else {
      this.devSpoofSpy("local cheat — host truth unchanged, votes/scores still use the real spy");
    }
  }

  devBecomeCitizen() {
    if (this.phase === "lobby") return this.devLog("Start the game first.");
    if (this.isHost) {
      if (!this.spyIds.includes(this.myId)) return this.devLog("You are already a citizen.");
      const repl = this.realPlayers().map(p => p.id).find(id => id !== this.myId && !this.spyIds.includes(id));
      if (!repl) return this.devLog("Nobody to pass the spy role to.");
      this.spyIds = this.spyIds.map(id => id === this.myId ? repl : id);
      this.spyId = this.spyIds[0];
      this.isSpy = false;
      this.showRole(); this.updatePhaseUI(); this.renderPlayers();
      this.toast("CHEAT: you are now a citizen", "success");
      this.devBroadcastSpy("Become citizen.");
    } else {
      if (!this.location) return this.devLog("You never learned the location — nothing to restore locally.");
      this.isSpy = false;
      this.showRole(); this.updatePhaseUI();
      this.toast("CHEAT (local only): citizen view", "success");
      this.devLog("Spoofed citizen view locally.");
    }
  }

  devSetLocation() {
    const v = (prompt("Set location (host: real for everyone, guest: local view only)", this.location || "") || "").trim().slice(0, 40);
    if (!v) return;
    this.location = v;
    if (this.isHost) {
      this.showRole(); this.renderPlayers();
      this.devBroadcastSpy("Set location.");
      this.toast(`CHEAT: location is now ${v}`, "success");
    } else {
      if (this.isSpy) return this.devLog("Spies can't see the location — spoof a citizen view is impossible without it.");
      this.showRole();
      this.toast("CHEAT (local only): location view set", "success");
      this.devLog(`Local location view set to ${v}.`);
    }
  }

  devSpoofSpy(note) {
    if (this.phase === "lobby") return this.devLog("Start the game first.");
    if (this._spoofPrev === undefined) this._spoofPrev = this.isSpy;
    this.isSpy = true;
    this.showRole(); this.updatePhaseUI();
    this.playSound("guess-open");
    this.toast("CHEAT (local only): spy view", "success");
    this.devLog(note || "Spoofed spy view locally — host truth unchanged. Guess submits still need a real spy role on host.");
  }

  devUnspoof() {
    if (this._spoofPrev === undefined) return this.devLog("No spoof active.");
    if (!this.isHost) {
      this.isSpy = !!this._spoofPrev;
      this.showRole(); this.updatePhaseUI();
      this.devLog("Local spoof reverted.");
    } else {
      this.isSpy = this.spyIds.includes(this.myId);
      this.showRole(); this.updatePhaseUI(); this.renderPlayers();
    }
    this._spoofPrev = undefined;
    this.toast("Spoof cleared");
  }

  devAddCoins() {
    this.earnCoins(500);
    this.toast("CHEAT: +500 coins (local)", "success");
    this.devLog("+500 coins locally.");
  }

  devSetCoins() {
    const v = (prompt("Set your coin balance (0–99999)", String(this.coins)) || "").trim();
    if (v === "") return;
    const n = Math.min(99999, Math.max(0, parseInt(v, 10)));
    if (!Number.isFinite(n)) return this.devLog("Not a number.");
    this.coins = n;
    this.updateWallet();
    this.toast(`CHEAT: coins = ${n} (local)`, "success");
    this.devLog(`Coins set to ${n} locally.`);
  }

  devSetScore() {
    const v = (prompt("Set your score (host: broadcasts, guest: local until next tally)", "10") || "").trim();
    if (v === "") return;
    const n = Math.min(999, Math.max(0, parseInt(v, 10)));
    if (!Number.isFinite(n)) return this.devLog("Not a number.");
    const me = this.players.find(p => p.id === this.myId);
    if (!me) return this.devLog("Not in a room.");
    me.score = n;
    if (this.isHost) this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
    this.renderPlayers();
    this.toast(`CHEAT: score = ${n}${this.isHost ? "" : " (local)"}`, "success");
    this.devLog(`Score set to ${n}.`);
  }

  devSetStreak() {
    const v = (prompt("Set your win streak (0–999)", String(this.streak)) || "").trim();
    if (v === "") return;
    const n = Math.min(999, Math.max(0, parseInt(v, 10)));
    if (!Number.isFinite(n)) return this.devLog("Not a number.");
    this.streak = n;
    this.bestStreak = Math.max(this.bestStreak, n);
    store.set("spy_streak", String(this.streak));
    store.set("spy_best", String(this.bestStreak));
    this.renderStreak();
    this.toast(`CHEAT: streak = ${n}`, "success");
    this.devLog(`Streak set to ${n}.`);
  }

  devRigSpy() {
    if (this.phase === "lobby") return this.devLog("Start the game first.");
    const names = this.realPlayers().map(p => p.name).join(", ") || "nobody";
    const v = (prompt(`Make who the spy? (${names})`, "") || "").trim().toLowerCase();
    if (!v) return;
    const target = this.realPlayers().find(p => p.name.toLowerCase() === v || p.id.toLowerCase() === v);
    if (!target) return this.devLog("No match among humans (bots can't be spies).");
    if (this.isHost) {
      const want = this.mode === "double" && this.realPlayers().length >= 6 ? 2 : 1;
      this.spyIds = [target.id, ...this.spyIds.filter(id => id !== target.id)].slice(0, want);
      this.spyId = this.spyIds[0];
      this.isSpy = this.spyIds.includes(this.myId);
      this.showRole(); this.updatePhaseUI(); this.renderPlayers();
      this.playSound("reveal");
      this.toast(`CHEAT: ${target.name} is now the spy`, "success");
      this.devBroadcastSpy("Rig spy.");
    } else {
      this.devLog(`${target.name} marked locally — host truth unchanged. Guests can't rig the room; use Spoof spy UI to preview spy flows.`);
      this.toast("CHEAT (local only): rigging needs host", "error");
    }
  }

  devUnlockAll() {
    SHOP_ITEMS.forEach(it => { if (!this.owned.includes(it.id)) this.owned.push(it.id); });
    store.set("spy_owned", JSON.stringify(this.owned));
    this.buildThemeOptions();
    this.playSound("success");
    this.toast("CHEAT: all shop items unlocked (local)", "success");
    this.devLog(`Owned: ${this.owned.join(",")}`);
  }

  devBumpScore() {
    const me = this.players.find(p => p.id === this.myId);
    if (!me) return this.devLog("Not in a room.");
    me.score = (me.score || 0) + 3;
    if (this.isHost) this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
    this.renderPlayers();
    this.toast(`CHEAT: +3 score${this.isHost ? "" : " (local, host overwrites on next tally)"}`, "success");
    this.devLog("+3 score.");
  }

  devSkipTimer() {
    if (!this.isHost) return this.devLog("Skip-timer needs host. Timer truth lives on host.");
    if (this.phase !== "discuss" && this.phase !== "vote") return this.devLog("No timer running.");
    this.timeLeft = Math.min(this.timeLeft, 3);
    this.endsAt = Date.now() + this.timeLeft * 1000;
    this.broadcast({ type: "timer", time: this.timeLeft, endsAt: this.endsAt });
    this.updateTimer();
    this.devLog("Timer skipped to 3s.");
  }

  devForceResults() {
    if (!this.isHost) return this.devLog("Force-results needs host.");
    if (this.phase === "vote") { this.endVoting(); this.devLog("Forced results now."); }
    else if (this.phase === "discuss" || this.phase === "role") { this.startVoting(); this.devLog("Jumped to vote."); }
    else this.devLog("Start the game first.");
  }

  devSendSystem() {
    const v = (prompt("System message to show in chat", "") || "").trim().slice(0, 180);
    if (!v) return;
    if (this.isHost) {
      const msgId = `host-${Date.now()}-devsys`;
      this.seenMsgIds.add(msgId);
      this.addSystemMessage(v);
      this.broadcast({ type: "chat", id: "system", name: "System", message: v, time: "", msgId });
    } else {
      this.addSystemMessage(`${v} (local only)`);
    }
    this.devLog("System message sent.");
  }

  devKick() {
    if (!this.isHost) return this.devLog("Kick needs host.");
    const v = (prompt(`Kick who? (${this.players.map(p => p.name).join(", ") || "nobody"})`, "") || "").trim().toLowerCase();
    if (!v) return;
    const target = this.players.find(p => p.name.toLowerCase() === v || p.id.toLowerCase() === v);
    if (!target) return this.devLog("No match.");
    this.kickPlayer(target.id);
    this.devLog(`Kicked ${target.name}.`);
  }

  getDebugState() {
    return {
      phase: this.phase, round: this.round, roomCode: this.roomCode,
      isHost: this.isHost, myId: this.myId, myName: this.myName,
      isSpy: this.isSpy, location: this.isHost ? this.location : (this.isSpy ? "[hidden]" : this.location),
      spyId: this.isHost ? this.spyId : "[hidden from guests]",
      players: this.players, votes: this.votes,
      connections: [...this.connections.keys()], chat: this.chatHistory.length
    };
  }

  realPlayers() { return this.players.filter(p => !p.bot); }

// ---------- networking ----------
  createRoom() {
    const name = this.$("player-name").value.trim().slice(0, 16);
    if (!name) return this.toast("Enter your name first", "error");
    this.myName = name;
    store.set("spy_name", name);
    this.roomCode = this.generateCode();
    this.isHost = true;
    this.setStatus("Creating…");
    this.$("create-btn").disabled = true;

    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.connections.clear();
    this.pendingPlayers.clear();
    try {
      this.peer = new Peer(this.peerIdFor(this.roomCode), { debug: 0, config: this.iceConfig() });
    } catch (e) {
      this.$("create-btn").disabled = false;
      this.setStatus("Error", false);
      this.toast("Could not start — PeerJS blocked. Check connection/adblock and retry.", "error");
      return;
    }

    this.peer.on("open", id => {
      this.myId = id;
      this._createTries = 0;
      this.players = [];
      this.addPlayer({ id, name: this.myName, isHost: true, score: 0, color: COLORS[0], avatar: this.avatar, voice: this.voiceOn });
      this.showHostLobby();
      this.setStatus(`Hosting · ${this.roomCode} · 1`, true);
      this.startSync();
      this.playSound("success");
      this.toast(`Room ${this.roomCode} created — share the code!`, "success");
      this.$("create-btn").disabled = false;
    });

    this.peer.on("connection", conn => this.handleConnection(conn));
    this.peer.on("call", call => this.handleIncomingCall(call));
    this.peer.on("disconnected", () => { try { this.peer.reconnect(); } catch (e) {} });
    this.peer.on("error", err => {
      console.error(err);
      this.$("create-btn").disabled = false;
      if (err && err.type === "unavailable-id") {
        this._createTries = (this._createTries || 0) + 1;
        if (this._createTries > 3) {
          this._createTries = 0;
          this.setStatus("Error", false);
          this.toast("Cloud busy — wait a beat, then Create again.", "error");
          return;
        }
        try { if (this.peer) this.peer.destroy(); } catch (e) {}
        this.peer = null;
        this.roomCode = this.generateCode();
        this.toast("Code taken, trying a new one…");
        setTimeout(() => this.createRoom(), 400);
      } else {
        this.setStatus("Error", false);
        this.toast("Could not create room. Check connection and retry.", "error");
      }
    });
  }

  joinRoom(attempt = 1) {
    const MAX_ATTEMPTS = 3;
    const BACKOFF = [0, 1000, 2000, 4000];
    const name = this.$("player-name").value.trim().slice(0, 16);
    const code = this.$("room-code").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (!name) return this.toast("Enter your name first", "error");
    if (code.length !== 5) return this.toast("Room code is 5 letters", "error");
    if (this.joining) {
      this.joinAttempt = (this.joinAttempt || 0) + 1000;
      this.joining = false;
      this.$("join-btn").disabled = false;
      this.setStatus("Offline", false);
      this.toast("Join cancelled");
      return;
    }
    this.joining = true;
    this.myName = name;
    store.set("spy_name", name);
    store.set("spy_lastcode", code);
    this.roomCode = code;
    this.isHost = false;
    this.joinAttempt = attempt;
    this.setStatus(attempt > 1 ? `Retrying… (${attempt}/${MAX_ATTEMPTS})` : "Joining…");
    this.$("join-btn").disabled = true;

    const retry = (msg) => {
      if (this.joinAttempt !== attempt) return;
      if (attempt < MAX_ATTEMPTS) {
        this.joining = false;
        this.toast(`${msg} — retrying (${attempt + 1}/${MAX_ATTEMPTS})…`);
        setTimeout(() => { if (this.joinAttempt === attempt) this.joinRoom(attempt + 1); }, BACKOFF[attempt + 1] || 2000);
      } else {
        this.joining = false;
        this.$("join-btn").disabled = false;
        this.setStatus("Failed", false);
        this.toast("Could not reach the room. Check the code, host tab open, or TURN settings.", "error");
      }
    };

    let peer = this.peer;
    const peerUsable = peer && !peer.destroyed;
    if (!peerUsable) {
      try { if (peer) peer.destroy(); } catch (e) {}
      this.connections.clear();
      try {
        peer = new Peer({ debug: 0, config: this.iceConfig() });
      } catch (e) {
        this.joining = false;
        this.$("join-btn").disabled = false;
        this.setStatus("Failed", false);
        this.toast("Could not start — PeerJS blocked. Check connection/adblock and retry.", "error");
        return;
      }
      this.peer = peer;
      this.peer.on("call", call => this.handleIncomingCall(call));
      this.peer.on("disconnected", () => { try { if (!this.peer.destroyed) this.peer.reconnect(); } catch (e) {} });
      this.peer.on("error", err => {
        if (this.joinAttempt !== attempt) return;
        console.error(err);
        clearTimeout(failTimer);
        const t = err && err.type;
        if (t === "peer-unavailable" || t === "network" || t === "socket-error" || t === "socket-closed" || t === "webrtc") {
          retry(t === "peer-unavailable" ? "Room not found yet" : "Network hiccup");
        } else {
          this.joining = false;
          this.$("join-btn").disabled = false;
          this.setStatus("Failed", false);
          this.toast("Join failed. Check connection or configure TURN relay in Settings.", "error");
        }
      });
    }

    let done = false;
    let joinTimerFired = false;
    const oneRetry = (msg) => {
      if (joinTimerFired) return;
      joinTimerFired = true;
      retry(msg);
    };
    const failTimer = setTimeout(() => { if (!done && this.joinAttempt === attempt) oneRetry("Host not responding"); }, 12000);

    const doConnect = () => {
      if (this.joinAttempt !== attempt) { clearTimeout(failTimer); return; }
      this.myId = this.peer.id;
      if (!this.myId) { setTimeout(doConnect, 300); return; }
      try { const old = this.connections.get("host"); if (old) { try { old.close(); } catch (e) {} } } catch (e) {}
      try { if (this._pendingConn) { try { this._pendingConn.close(); } catch (e) {} } } catch (e) {}
      this._pendingConn = null;
      this.connections.delete("host");
      let conn;
      try { conn = this.peer.connect(this.peerIdFor(code), { reliable: true }); } catch (e) { conn = null; }
      if (!conn) { clearTimeout(failTimer); this.joining = false; this.$("join-btn").disabled = false; return this.toast("Could not connect", "error"); }
      this._pendingConn = conn;
      this.handleConnection(conn, () => { done = true; this._pendingConn = null; clearTimeout(failTimer); this.joining = false; this.$("join-btn").disabled = false; });
    };

    if (peer.open) doConnect();
    else {
      const onOpen = () => { try { peer.off("open", onOpen); } catch (e) {} doConnect(); };
      peer.once("open", onOpen);
      setTimeout(() => { try { peer.off("open", onOpen); } catch (e) {} if (!done && this.joinAttempt === attempt && !peer.open) oneRetry("Signaling slow"); }, 12000);
    }
  }

  handleConnection(conn, onOpen) {
    conn.on("open", () => {
      if (this.isHost) {
        this.connections.set(conn.peer, conn);
        this.sendTo(conn, { type: "welcome", players: this.players, roomCode: this.roomCode, chat: this.chatHistory.slice(-40), category: this.category, mode: this.mode });
        this.setStatus(`Hosting · ${this.roomCode} · ${this.players.length}`, true);
      } else {
        this.connections.set("host", conn);
        this.sendTo(conn, { type: "join", id: this.myId, name: this.myName, avatar: this.avatar });
        this.setStatus(`Connected · ${this.roomCode}`, true);
        this._lastSyncAt = Date.now();
        this.startSyncWatch();
        this.flushOutbox();
      }
      if (onOpen) onOpen();
      if (this.devMode) this.updateDevPanel();
    });

    conn.on("data", data => this.onMessage(data, conn));
    conn.on("close", () => this.onDisconnect(conn));
    conn.on("error", e => console.warn("Conn error", e));
  }

  uniquePlayerName(rawName) {
    let pname = String(rawName || "Player").trim().slice(0, 16) || "Player";
    if (this.players.some(p => p.name.toLowerCase() === pname.toLowerCase())) {
      let i = 2;
      while (this.players.some(p => p.name.toLowerCase() === `${pname} ${i}`.toLowerCase())) i++;
      pname = `${pname} ${i}`.slice(0, 16);
    }
    return pname;
  }

  flushPendingPlayers() {
    if (!this.isHost || !this.pendingPlayers.size) return;
    let added = false;
    this.pendingPlayers.forEach((info, pid) => {
      const conn = this.connections.get(pid);
      if (!conn || !conn.open) return;
      if (this.players.some(p => p.id === pid)) return;
      const color = COLORS[this.players.length % COLORS.length];
      const pname = this.uniquePlayerName(info.name);
      this.addPlayer({ id: pid, name: pname, isHost: false, score: 0, color, avatar: this.sanitizeAvatar(info.avatar) });
      added = true;
    });
    this.pendingPlayers.clear();
    if (added) {
      this.setStatus(`Hosting · ${this.roomCode} · ${this.players.length}`, true);
      this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
    }
  }

  onMessage(data, conn) {
    if (!data || !data.type) return;
    if (data.msgId) {
      if (this.seenMsgIds.has(data.msgId)) return;
      this.seenMsgIds.add(data.msgId);
      if (this.seenMsgIds.size > 400) this.seenMsgIds.delete(this.seenMsgIds.values().next().value);
    }
    switch (data.type) {
      case "join": {
        if (!this.isHost) break;
        const pid = (conn && conn.peer) || data.id;
        if (!pid) break;
        if (this.phase !== "lobby") {
          this.pendingPlayers.set(pid, { id: pid, name: String(data.name || "Player").slice(0, 16), avatar: this.sanitizeAvatar(data.avatar) });
          this.sendTo(conn, { type: "joinDenied", reason: "Round in progress — queued for next round", players: this.players, roomCode: this.roomCode, category: this.category, mode: this.mode });
          break;
        }
        if (this.players.find(p => p.id === pid)) break;
        const color = COLORS[this.players.length % COLORS.length];
        const pname = this.uniquePlayerName(data.name);
        this.addPlayer({ id: pid, name: pname, isHost: false, score: 0, color, avatar: this.sanitizeAvatar(data.avatar) });
        this.setStatus(`Hosting · ${this.roomCode} · ${this.players.length}`, true);
        this.sendTo(conn, { type: "welcome", players: this.players, roomCode: this.roomCode, chat: this.chatHistory.slice(-40), category: this.category, mode: this.mode });
        this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
        this.playSound("join");
        if (this.voiceOn) this.callAllPeers();
        break;
      }
      case "leave": {
        if (!this.isHost) break;
        const pid = (conn && conn.peer) || data.id;
        if (!pid || pid === this.myId) break;
        this.connections.delete(pid);
        this.pendingPlayers.delete(pid);
        const lvc = this.voiceCalls.get(pid);
        if (lvc) { try { lvc.close(); } catch (e) {} this.voiceCalls.delete(pid); }
        this.detachVoice(pid);
        const left = this.players.find(p => p.id === pid);
        this.players = this.players.filter(p => p.id !== pid);
        delete this.votes[pid];
        Object.keys(this.votes).forEach(voter => { if (this.votes[voter] === pid) delete this.votes[voter]; });
        const spyLeft = this.spyIds.includes(pid);
        if (spyLeft) {
          this.spyIds = this.spyIds.filter(id => id !== pid);
          this.spyId = this.spyIds[0] || null;
        }
        try { if (conn) conn.close(); } catch (e) {}
        this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
        this.renderPlayers();
        this.setStatus(`Hosting · ${this.roomCode} · ${this.players.length}`, true);
        if (left) { this.addSystemMessage(`${left.name} left the room.`); this.playSound("leave"); }
        if (spyLeft && this.spyIds.length === 0 && (this.phase === "role" || this.phase === "discuss" || this.phase === "vote")) {
          this.handleAllSpiesLeft(left ? left.name : "Spy");
          break;
        }
        if (this.phase === "vote") { this.broadcastVoteCount(); this.maybeCloseVoting(); }
        break;
      }
      case "joinDenied":
        this.toast(data.reason || "Round in progress — waiting for next round", "info");
        this.setStatus(`Queued · ${this.roomCode}`, true);
        this.waitingForNext = true;
        if (Array.isArray(data.players)) this.players = data.players;
        if (data.category) { this.category = data.category; this.setSelect(this.$("category-select"), data.category); }
        if (data.mode) { this.mode = data.mode; this.setSelect(this.$("mode-select"), data.mode); }
        this.$("join-btn").disabled = false;
        this.showHostLobby();
        this.$("start-btn").style.display = "none";
        this.$("guest-wait").classList.remove("hidden");
        this.$("guest-wait").innerHTML = `<i class="fa-solid fa-hourglass-half"></i> Game in progress — you will join next round automatiquement.`;
        this.$("display-code").textContent = this.roomCode;
        this.updateStartButton();
        break;
      case "hostLeft":
        this.hideVoteModal();
        this.hideResults();
        this.phase = "lobby";
        this.joining = false;
        this.$("join-btn").disabled = false;
        this.setStatus("Host left", false);
        this.playSound("leave");
        this.toast("Host left — room closed. Scores kept below.", "error");
        this.showFinalScores({ scores: data.scores || [], title: "Room Closed — Host Left" });
        this.$("next-round-btn").style.display = "none";
        this.$("end-game-btn").innerHTML = `<i class="fa-solid fa-rotate-left"></i> New Room`;
        this.$("end-game-btn").onclick = () => location.reload();
        break;
      case "kicked":
        this.toast(data.reason || "Removed from the room", "error");
        this.setStatus("Removed", false);
        this.playSound("leave");
        try { if (this.peer) this.peer.destroy(); } catch (e) {}
        setTimeout(() => location.reload(), 1500);
        break;
      case "welcome":
        this.players = Array.isArray(data.players) ? data.players : [];
        this.roomCode = data.roomCode || this.roomCode;
        this.waitingForNext = false;
        this.joining = false;
        if (data.category) { this.category = data.category; this.setSelect(this.$("category-select"), data.category); }
        if (data.mode) { this.mode = data.mode; this.setSelect(this.$("mode-select"), data.mode); }
        this.chatHistory = Array.isArray(data.chat) ? data.chat : [];
        this.renderPlayers();
        this.renderChat();
        this.showHostLobby();
        if (!this.isHost) {
          this.$("start-btn").style.display = "none";
          this.$("guest-wait").classList.remove("hidden");
          this.$("display-code").textContent = this.roomCode;
        }
        this.setStatus(`In room · ${this.roomCode}`, true);
        this.toast("Joined room!", "success");
        if (this.voiceOn) this.callAllPeers();
        break;
      case "players":
        this.players = Array.isArray(data.players) ? data.players : [];
        if (data.category && !this.isHost) { this.category = data.category; this.setSelect(this.$("category-select"), data.category); }
        if (data.mode && !this.isHost) { this.mode = data.mode; this.setSelect(this.$("mode-select"), data.mode); }
        this.renderPlayers();
        if (this.voiceOn) this.callAllPeers();
        break;
      case "gameStart":
        this.isSpy = !!data.isSpy;
        this.spyIds = data.spyIds || (data.isSpy ? [this.myId] : []);
        if (data.category && CATEGORIES[data.category]) { this.category = data.category; this.setSelect(this.$("category-select"), data.category); }
        if (data.mode && MODES[data.mode]) { this.mode = data.mode; this.setSelect(this.$("mode-select"), data.mode); }
        this.location = data.location || "";
        this.spyId = null;
        this.round = data.round || 1;
        this.phase = "role";
        this.waitingForNext = false;
        this.votes = {};
        this.myVote = null;
        this.pendingVote = null;
        this.spyGuess = null;
        this.guessSubmitted = false;
        this.guessedSpies = new Set();
        this.chatHistory = [];
        if (Array.isArray(data.players)) this.players = data.players;
        this.hideResults();
        this.hideVoteModal();
        this.showGame();
        this.showRole();
        this.updatePhaseUI();
        this.renderPlayers();
        this.playSound("round");
        clearTimeout(this._roleFallback);
        this._roleFallback = setTimeout(() => {
          if (this.phase === "role" && !this.isHost) {
            this.sendToHost({ type: "syncReq" });
            this.toast("Waiting for host…", "error");
          }
        }, 9000);
        break;
      case "chat":
        this.addChatMessage(data.name, data.message, data.id === this.myId, data.time, data.id === "system");
        if (data.id !== this.myId && data.id !== "system") this.playSound("chat-pop");
        if (this.isHost && conn && data.id !== "system") this.broadcastExcept({ type: "chat", id: data.id, name: data.name, message: data.message, time: data.time, msgId: data.msgId }, conn);
        break;
      case "phase":
        this.phase = data.phase;
        clearTimeout(this._roleFallback);
        if (typeof data.endsAt === "number" && data.endsAt > 0) {
          this.endsAt = data.endsAt;
          this.timeLeft = Math.max(0, Math.ceil((data.endsAt - Date.now()) / 1000));
          this.updateTimer();
        } else if (typeof data.time === "number") { this.timeLeft = data.time; this.updateTimer(); }
        this.updatePhaseUI();
        if (data.phase === "vote") { this.myVote = null; this.pendingVote = null; this.openVoteModal(); }
        if (data.phase === "spyguess" && this.isSpy) this.openGuessModal();
        if (data.phase === "discuss") this.addSystemMessage("Discussion started! Ask questions to find the spy.");
        if (data.phase === "vote") this.addSystemMessage("Voting time! Pick who you think the spy is.");
        break;
      case "timer":
        if (typeof data.endsAt === "number" && data.endsAt > 0) {
          this.endsAt = data.endsAt;
          this.timeLeft = Math.max(0, Math.ceil((data.endsAt - Date.now()) / 1000));
        } else {
          this.timeLeft = data.time;
        }
        this.updateTimer();
        break;
      case "voteCount":
        this.renderVoteProgress(data.count, data.total);
        break;
      case "vote":
        if (this.isHost) this.recordVote(data, conn);
        break;
      case "guess":
        if (this.isHost) this.resolveGuess(data.guess, conn, data.id);
        break;
      case "results":
        this.hideVoteModal();
        this.applyScores(data.scores);
        this.showResults(data);
        break;
      case "devSpy": {
        if (this.isHost) break;
        this._spoofPrev = undefined;
        this.spyIds = Array.isArray(data.spyIds) ? data.spyIds : [];
        this.isSpy = this.spyIds.includes(this.myId);
        if (!this.isSpy && typeof data.location === "string") this.location = data.location;
        if (typeof data.round === "number" && data.round > 0) this.round = data.round;
        this.showRole(); this.updatePhaseUI(); this.renderPlayers();
        this.playSound("reveal");
        this.toast(this.isSpy ? "Host made YOU the spy (dev cheat)" : "Host changed roles (dev cheat)");
        break;
      }
      case "nextRound":
        this.isSpy = !!data.isSpy;
        this.spyIds = data.spyIds || [];
        if (data.category && CATEGORIES[data.category]) { this.category = data.category; this.setSelect(this.$("category-select"), data.category); }
        if (data.mode && MODES[data.mode]) { this.mode = data.mode; this.setSelect(this.$("mode-select"), data.mode); }
        this.location = data.location || "";
        this.spyId = null;
        this.round = data.round;
        this.phase = "role";
        this.waitingForNext = false;
        this.votes = {};
        this.myVote = null;
        this.pendingVote = null;
        this.spyGuess = null;
        this.guessSubmitted = false;
        this.guessedSpies = new Set();
        if (Array.isArray(data.players)) this.players = data.players;
        this.hideResults();
        this.hideVoteModal();
        this.showGame();
        this.showRole();
        this.updatePhaseUI();
        this.renderPlayers();
        this.playSound("round");
        clearTimeout(this._roleFallback);
        this._roleFallback = setTimeout(() => {
          if (this.phase === "role" && !this.isHost) {
            this.sendToHost({ type: "syncReq" });
            this.toast("Waiting for host…", "error");
          }
        }, 9000);
        break;
      case "avatar": {
        const senderId = (conn && this.isHost) ? conn.peer : data.id;
        const p = this.players.find(x => x.id === senderId);
        if (p) {
          p.avatar = this.sanitizeAvatar(data.avatar);
          if (data.name) p.name = String(data.name).trim().slice(0, 16) || p.name;
          this.renderPlayers();
        }
        if (this.isHost && conn) {
          this.broadcastExcept({ type: "avatar", id: senderId, avatar: p ? p.avatar : this.sanitizeAvatar(data.avatar), name: p ? p.name : "" }, conn);
        }
        break;
      }
      case "gift":
        if (this.isHost) this.routeGift(data, conn);
        else if (data.to === this.myId) {
          const amt = Number(data.amount);
          if (!Number.isInteger(amt) || amt < 5 || amt > 500) break;
          const sender = String(data.fromName || "Someone").slice(0, 16);
          this.earnCoins(amt);
          this.playSound("gift-receive");
          this.addSystemMessage(`${sender} sent you ${amt} coins!`);
          this.toast(`+${amt} coins from ${sender}!`, "success");
        }
        break;
      case "voice-state": {
        const senderId = (conn && this.isHost) ? conn.peer : data.id;
        const p = this.players.find(x => x.id === senderId);
        if (p) { p.voice = !!data.on; this.renderPlayers(); }
        if (this.isHost && conn) this.broadcastExcept({ type: "voice-state", id: senderId, on: !!data.on }, conn);
        break;
      }
      case "sync":
        this.applySync(data);
        break;
      case "syncReq":
        if (this.isHost && conn) this.sendTo(conn, this.syncPayload());
        break;
      case "endGame":
        this.hideVoteModal();
        this.showFinalScores(data);
        break;
      case "toLobby":
        clearInterval(this.timerInterval);
        clearTimeout(this.roleTimeout);
        this.phase = "lobby";
        this.round = 1;
        this.votes = {};
        this.myVote = null;
        this.pendingVote = null;
        this.spyGuess = null;
        this.guessSubmitted = false;
        this.guessedSpies = new Set();
        this.chatHistory = [];
        this.waitingForNext = false;
        if (Array.isArray(data.players)) this.players = data.players;
        if (data.roomCode) this.roomCode = data.roomCode;
        this.hideResults();
        this.hideVoteModal();
        this.showLobbyScreen();
        this.renderChat();
        this.addSystemMessage("Back in the lobby — ready for a new match.");
        this.playSound("round");
        this.toast("Back in the lobby", "success");
        break;
      case "wantLobby":
        if (this.isHost) {
          this.toast(`${data.name || "A guest"} asked to return to lobby`);
          if (this.phase === "reveal") this.toLobby();
          else this.addSystemMessage(`${data.name || "A guest"} wants to return to lobby.`);
        }
        break;
    }
    if (this.devMode) this.updateDevPanel();
  }

  handleAllSpiesLeft(leftName) {
    if (!this.isHost) return;
    clearInterval(this.timerInterval);
    clearTimeout(this.roleTimeout);
    this.phase = "reveal";
    this.players.forEach(p => {
      if (!p.bot) p.score = (p.score || 0) + 1;
    });
    const results = {
      type: "results",
      round: this.round,
      isGuessUpdate: false,
      spyIds: [],
      spyId: null,
      spyName: `${leftName || "Spy"} (disconnected)`,
      location: this.location,
      eliminated: [],
      eliminatedNames: [`${leftName || "Spy"} (left)`],
      spyCaught: true,
      scores: this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0, color: p.color, avatar: p.avatar || null })),
      allowGuess: false
    };
    this.broadcast(results);
    this.hideVoteModal();
    this.applyScores(results.scores);
    this.showResults(results);
  }

  onDisconnect(conn) {
    if (this.isHost) {
      const pid = conn.peer;
      this.connections.delete(pid);
      this.pendingPlayers.delete(pid);
      const vc = this.voiceCalls.get(pid);
      if (vc) { try { vc.close(); } catch (e) {} this.voiceCalls.delete(pid); }
      this.detachVoice(pid);
      const left = this.players.find(p => p.id === pid);
      this.players = this.players.filter(p => p.id !== pid);
      delete this.votes[pid];
      Object.keys(this.votes).forEach(voter => { if (this.votes[voter] === pid) delete this.votes[voter]; });
      const wasSpy = this.spyIds.includes(pid);
      if (wasSpy) {
        this.spyIds = this.spyIds.filter(id => id !== pid);
        this.spyId = this.spyIds[0] || null;
      }
      this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
      this.renderPlayers();
      this.setStatus(`Hosting · ${this.roomCode} · ${this.players.length}`, true);
      if (left) { this.addSystemMessage(`${left.name} left the room.`); this.playSound("leave"); }
      if (wasSpy && this.spyIds.length === 0 && (this.phase === "role" || this.phase === "discuss" || this.phase === "vote")) {
        this.handleAllSpiesLeft(left ? left.name : "Spy");
        return;
      }
      if (this.phase === "vote") { this.broadcastVoteCount(); this.maybeCloseVoting(); }
    } else {
      this.setStatus("Disconnected — tap Join Room to retry", false);
      this.joining = false;
      this.$("join-btn").disabled = false;
      this.$("join-btn").innerHTML = `<i class="fa-solid fa-rotate-right"></i> Reconnect`;
      this.toast("Lost connection to host — tap Reconnect", "error");
    }
    if (this.devMode) this.updateDevPanel();
  }

  sendTo(conn, data) { try { if (conn && conn.open) conn.send(data); } catch (e) {} }

  broadcast(data) {
    this.connections.forEach(conn => { if (conn.open) { try { conn.send(data); } catch (e) {} } });
  }

  broadcastExcept(data, except) {
    this.connections.forEach(conn => { if (conn !== except && conn.open) { try { conn.send(data); } catch (e) {} } });
  }

  sendToHost(data) {
    const host = this.connections.get("host");
    if (host && host.open) { try { host.send(data); return; } catch (e) {} }
    try {
      this._outbox = this._outbox || [];
      if (this._outbox.length < 20) this._outbox.push(data);
    } catch (e) {}
  }

  flushOutbox() {
    try {
      const host = this.connections.get("host");
      if (!host || !host.open || !this._outbox || !this._outbox.length) return;
      const q = this._outbox;
      this._outbox = [];
      q.forEach(d => { try { host.send(d); } catch (e) {} });
    } catch (e) {}
  }

  startSyncWatch() {
    try {
      if (this._syncWatch) return;
      this._syncWatch = setInterval(() => {
        try {
          if (this.isHost || !this.roomCode || this.phase === "lobby") return;
          if (!this._lastSyncAt || this._syncSilentWarned) return;
          if (Date.now() - this._lastSyncAt > 9000) {
            this._syncSilentWarned = true;
            this.toast("Host silent — they may have closed the tab", "error");
          }
        } catch (e) {}
      }, 4000);
    } catch (e) {}
  }

  stopSyncWatch() {
    try { if (this._syncWatch) clearInterval(this._syncWatch); } catch (e) {}
    this._syncWatch = null;
  }

  // ---------- realtime sync (host heartbeat, public state only — never secrets) ----------
  syncPayload() {
    this._syncSeq = (this._syncSeq || 0) + 1;
    return {
      type: "sync",
      seq: this._syncSeq,
      phase: this.phase,
      time: this.timeLeft,
      endsAt: this.endsAt || 0,
      round: this.round,
      category: this.category,
      mode: this.mode,
      players: this.players,
      count: Object.keys(this.votes).filter(id => !id.startsWith("bot-")).length,
      total: this.realPlayers().length
    };
  }

  startSync() {
    this.stopSync();
    this.syncInterval = setInterval(() => {
      if (this.isHost && this.peer && !this.peer.destroyed) this.broadcast(this.syncPayload());
    }, 3000);
  }

  stopSync() { if (this.syncInterval) clearInterval(this.syncInterval); this.syncInterval = null; }

  applyEndsAt(endsAt) {
    if (typeof endsAt !== "number" || !(endsAt > 0)) return false;
    this.endsAt = endsAt;
    this.timeLeft = Math.min(600, Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    this.updateTimer();
    return true;
  }

  applySync(data) {
    if (this.isHost || !data) return;
    if (typeof data.seq === "number") {
      if (typeof this._lastSyncSeq === "number" && data.seq <= this._lastSyncSeq) return;
      this._lastSyncSeq = data.seq;
    }
    this._lastSyncAt = Date.now();
    this._syncSilentWarned = false;
    if (typeof data.round === "number" && data.round > 0) this.round = data.round;
    if (data.category && CATEGORIES[data.category]) { this.category = data.category; this.setSelect(this.$("category-select"), data.category); }
    if (data.mode && MODES[data.mode]) { this.mode = data.mode; this.setSelect(this.$("mode-select"), data.mode); }
    if (Array.isArray(data.players)) this.players = data.players;
    if (this.phase === "lobby" && data.phase && data.phase !== "lobby") {
      this.renderPlayers();
      return;
    }
    if (data.phase && data.phase !== this.phase && data.phase !== "lobby") {
      const prev = this.phase;
      this.phase = data.phase;
      if (!this.applyEndsAt(data.endsAt) && typeof data.time === "number") { this.timeLeft = Math.min(600, Math.max(0, data.time)); this.updateTimer(); }
      this.updatePhaseUI();
      this.renderPlayers();
      if (data.phase === "vote" && prev !== "vote") { this.myVote = null; this.pendingVote = null; this.openVoteModal(); }
    } else if (this.phase !== "lobby") {
      this.applyEndsAt(data.endsAt);
      if (typeof data.endsAt !== "number" && typeof data.time === "number") {
        this.timeLeft = Math.min(600, Math.max(0, data.time));
        this.updateTimer();
      }
      if (data.phase === "vote" && this.myVote == null && !this.waitingForNext
        && document.hidden === false && this.$("vote-modal").classList.contains("hidden")) {
        this.openVoteModal();
      }
    }
    if (typeof data.count === "number") this.renderVoteProgress(data.count, data.total || 0);
    this.renderPlayers();
  }

  // ---------- lobby ----------
  addPlayer(player) {
    if (!this.players.find(p => p.id === player.id)) this.players.push(player);
    this.renderPlayers();
    this.updateStartButton();
  }

  syncLobbyPickLocks() {
    const picks = this.$("lobby-picks");
    if (picks) picks.classList.toggle("guest-locked", !this.isHost);
    const cat = this.$("category-select"), mode = this.$("mode-select");
    if (cat) cat.disabled = !this.isHost;
    if (mode) mode.disabled = !this.isHost;
  }

  showHostLobby() {
    this.$("join-section").classList.add("hidden");
    this.$("host-lobby").classList.remove("hidden");
    this.$("display-code").textContent = this.roomCode;
    this.syncLobbyPickLocks();
    this.renderPlayers();
    this.updateStartButton();
  }

  updateStartButton() {
    const btn = this.$("start-btn");
    const n = this.realPlayers().length;
    this.$("lobby-count").innerHTML = `<i class="fa-solid fa-users"></i> ${n} player${n === 1 ? "" : "s"}`;
    if (this.waitingForNext && !this.isHost) {
      this.$("lobby-min").textContent = "Game in progress — you join next round";
      return;
    }
    this.$("lobby-min").textContent = n < MIN_PLAYERS ? `Need ${MIN_PLAYERS - n} more to start` : "Ready to start!";
    if (this.isHost) {
      btn.disabled = n < MIN_PLAYERS;
      btn.innerHTML = n < MIN_PLAYERS
        ? `<i class="fa-solid fa-play"></i> Start Game (need ${MIN_PLAYERS - n} more)`
        : `<i class="fa-solid fa-play"></i> Start Game`;
    }
  }

  renderPlayers() {
    const sig = JSON.stringify([this.players, this.myId, this.isHost]);
    if (sig === this._playersSig) { this.updateStartButton(); return; }
    this._playersSig = sig;
    const list = this.$("player-list");
    if (list) {
      list.innerHTML = this.players.map(p => `
        <div class="player-item ${p.id === this.myId ? "you" : ""}">
          ${this.avatarHtml(p, 36)}
          <div style="min-width:0"><div class="pname">${this.escapeHtml(p.name)}${p.bot ? ' <span class="ptag">BOT</span>' : ""}${p.voice ? ' <i class="fa-solid fa-microphone" style="color:var(--success);font-size:0.7rem"></i>' : ""}</div>
          <div class="ptag">${p.isHost ? '<i class="fa-solid fa-crown crown"></i> host · ' : ""}${p.id === this.myId ? "you" : "player"}</div></div>
          <span class="pscore">${p.score || 0} pts</span>
          ${p.id !== this.myId && !p.bot ? `<button type="button" class="gift-btn" data-gift="${this.escapeHtml(p.id)}" title="Send coins to ${this.escapeHtml(p.name)}" aria-label="Send coins to ${this.escapeHtml(p.name)}"><i class="fa-solid fa-gift"></i></button>` : ""}
          ${this.isHost && p.id !== this.myId ? `<button type="button" class="kick-btn" data-kick="${this.escapeHtml(p.id)}" title="Remove ${this.escapeHtml(p.name)}" aria-label="Remove ${this.escapeHtml(p.name)}"><i class="fa-solid fa-user-xmark"></i></button>` : ""}
        </div>`).join("");
      list.querySelectorAll("[data-gift]").forEach(b => { b.onclick = () => this.openGift(b.dataset.gift); });
      list.querySelectorAll("[data-kick]").forEach(b => { b.onclick = () => this.kickPlayer(b.dataset.kick); });
    }
    const panel = this.$("players-panel");
    if (panel) {
      panel.innerHTML = this.players.map(p => `
        <div class="player-chip ${p.id === this.myId ? "you" : ""}">
          <span class="cdot" style="background:${this.validColor(p.color || "#7c5cfc")}"></span>
          <span>${this.escapeHtml(p.name)}${p.id === this.myId ? " (you)" : ""}</span>
          ${p.voice ? `<span class="mic"><i class="fa-solid fa-microphone"></i></span>` : ""}
        </div>`).join("");
    }
    this.updateStartButton();
  }

  kickPlayer(pid) {
    if (!this.isHost) return;
    const target = this.players.find(p => p.id === pid);
    if (!target || pid === this.myId) return;
    const conn = this.connections.get(pid);
    if (conn) { try { conn.send({ type: "kicked", reason: "Host removed you from the room" }); } catch (e) {} }
    setTimeout(() => { try { conn && conn.close(); } catch (e) {} }, 400);
    this.connections.delete(pid);
    this.pendingPlayers.delete(pid);
    const kvc = this.voiceCalls.get(pid);
    if (kvc) { try { kvc.close(); } catch (e) {} this.voiceCalls.delete(pid); }
    this.detachVoice(pid);
    this.players = this.players.filter(p => p.id !== pid);
    delete this.votes[pid];
    Object.keys(this.votes).forEach(voter => { if (this.votes[voter] === pid) delete this.votes[voter]; });
    const wasSpy = this.spyIds.includes(pid);
    if (wasSpy) {
      this.spyIds = this.spyIds.filter(id => id !== pid);
      this.spyId = this.spyIds[0] || null;
      if (this.isHost && this.spyIds.includes(this.myId)) this.isSpy = true;
      else if (pid === this.myId) this.isSpy = false;
    }
    this.broadcast({ type: "players", players: this.players, category: this.category, mode: this.mode });
    this.renderPlayers();
    this.setStatus(`Hosting · ${this.roomCode} · ${this.players.length}`, true);
    this.addSystemMessage(`${target.name} was removed by the host.`);
    if (wasSpy && this.spyIds.length === 0 && (this.phase === "role" || this.phase === "discuss" || this.phase === "vote")) {
      this.handleAllSpiesLeft(target.name);
      return;
    }
    if (this.phase === "vote") { this.broadcastVoteCount(); this.maybeCloseVoting(); }
  }

  copyText(text, okMsg) {
    const done = () => this.toast(okMsg || "Copied!", "success");
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => this.legacyCopy(text, done));
    } else this.legacyCopy(text, done);
  }

  legacyCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
      const btn = this.$("copy-code");
      if (btn) { btn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`; setTimeout(() => btn.innerHTML = `<i class="fa-solid fa-copy"></i> Copy`, 1400); }
    } catch (e) { this.toast("Copy failed — long-press the code", "error"); }
  }

  copyCode() {
    this.copyText(this.roomCode, `Code ${this.roomCode} copied`);
    const btn = this.$("copy-code");
    if (btn) { const old = btn.innerHTML; btn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`; setTimeout(() => btn.innerHTML = old, 1400); }
  }

  shareCode() {
    const url = `${location.origin}${location.pathname}#${this.roomCode}`;
    const text = `Join my Spy room! Code: ${this.roomCode} ${url}`;
    if (navigator.share) navigator.share({ title: "Who is the Spy?", text, url }).catch(() => {});
    else this.copyText(text, "Invite copied — send it to friends!");
  }

  leaveRoom() {
    if (this.isHost) {
      // Leaving as host closes the room for everyone — confirm so a stray
      // tap doesn't kill a live game.
      if (this.connections.size > 0 && this.phase !== "lobby") {
        try {
          if (!confirm("Leave? This closes the room for everyone.")) return;
        } catch (e) {}
      }
      try { this.broadcast({ type: "hostLeft", scores: this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0 })) }); } catch (e) {}
      setTimeout(() => { try { if (this.peer) this.peer.destroy(); } catch (e) {} location.reload(); }, 350);
      try { if (this.localStream) this.localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      return;
    }
    try { if (this.localStream) this.localStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    // Best-effort heads-up so the host drops the roster row at once
    // instead of waiting on the connection-close event.
    try { this.sendToHost({ type: "leave", id: this.myId, name: this.myName }); } catch (e) {}
    setTimeout(() => { try { if (this.peer) this.peer.destroy(); } catch (e) {} location.reload(); }, 150);
  }

  // ---------- game flow (host-authoritative) ----------
  pickNewRound() {
    const pool = this.poolFor(this.category);
    this.location = pool[Math.floor(Math.random() * pool.length)];
    const ids = this.players.filter(p => !p.bot).map(p => p.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const want = MODES[this.mode] && MODES[this.mode].spies === 2 && ids.length >= 6 ? 2 : 1;
    this.spyIds = ids.slice(0, want);
    this.spyId = this.spyIds[0];
    this.round = this.round || 1;
  }

  sendPersonalized(type) {
    this.connections.forEach((conn, pid) => {
      const p = this.players.find(pl => pl.id === pid);
      if (!p) return;
      const isSpy = this.spyIds.includes(pid);
      this.sendTo(conn, {
        type,
        isSpy,
        spyIds: isSpy ? [...this.spyIds] : [],
        location: isSpy ? null : this.location,
        round: this.round,
        category: this.category,
        mode: this.mode,
        players: this.players.map(pl => ({ id: pl.id, name: pl.name, isHost: pl.isHost, score: pl.score || 0, color: pl.color, bot: !!pl.bot, avatar: pl.avatar || null, voice: !!pl.voice }))
      });
    });
  }

  startGame() {
    if (!this.isHost) return;
    this.flushPendingPlayers();
    if (this.realPlayers().length < MIN_PLAYERS) return;
    if (this.mode === "double" && this.realPlayers().length < 6) return this.toast("Double Spy needs 6+ players", "error");
    this.round = 1;
    this._rewardedRound = 0;
    this._guessRewardedRound = 0;
    this.pickNewRound();
    this.isSpy = this.spyIds.includes(this.myId);
    this.phase = "role";
    this.votes = {};
    this.myVote = null;
    this.pendingVote = null;
    this.spyGuess = null;
    this.guessSubmitted = false;
    this.guessedSpies = new Set();
    this.chatHistory = [];
    this.sendPersonalized("gameStart");
    this.showGame();
    this.showRole();
    this.updatePhaseUI();
    this.renderPlayers();
    this.playSound("round");
    this.roleEndsAt = Date.now() + 3500;
    clearTimeout(this.roleTimeout);
    this.roleTimeout = setTimeout(() => this.startDiscussion(), 3500);
  }

  showGame() {
    this.stopMusic(true);
    this.$("lobby").classList.remove("active");
    this.$("game").classList.add("active");
    this.renderChat();
    this.updatePhaseUI();
  }

  showRole() {
    const banner = this.$("role-banner");
    const allyEl = this.$("role-ally");
    banner.classList.remove("deal");
    try { void banner.offsetWidth; } catch (e) {}
    banner.classList.add("deal");
    const pack = (CATEGORIES[this.category] || CATEGORIES.classic).name;
    const modeName = (MODES[this.mode] || MODES.classic).name;
    if (this.isSpy) {
      this.$("role-title").innerHTML = `<i class="fa-solid fa-user-secret"></i> You are the <strong>Spy!</strong>`;
      this.$("location-display").textContent = "???";
      this.$("role-sub").textContent = `${pack} · ${modeName} — listen, blend in, then guess.`;
      banner.classList.add("spy");
      const coSpies = (this.spyIds || [])
        .filter(id => id !== this.myId)
        .map(id => this.players.find(p => p.id === id)?.name)
        .filter(Boolean);
      if (allyEl) {
        if (coSpies.length) {
          allyEl.classList.remove("hidden");
          allyEl.innerHTML = `<i class="fa-solid fa-user-ninja"></i> Co-Spy: <strong>${this.escapeHtml(coSpies.join(", "))}</strong>`;
        } else {
          allyEl.classList.add("hidden");
          allyEl.innerHTML = "";
        }
      }
    } else {
      this.$("role-title").innerHTML = `<i class="fa-solid fa-user-shield"></i> You are a Citizen`;
      this.$("location-display").textContent = this.location || "???";
      this.$("role-sub").textContent = `${pack} · ${modeName} — blend in. Find the spy.`;
      banner.classList.remove("spy");
      if (allyEl) {
        allyEl.classList.add("hidden");
        allyEl.innerHTML = "";
      }
    }
    const allowGuess = !MODES[this.mode] || MODES[this.mode].guess !== false;
    const gb = this.$("guess-now-btn");
    gb.classList.toggle("ghost-hide", !(this.isSpy && allowGuess));
  }

  startDiscussion() {
    if (!this.isHost || this.phase !== "role") return;
    if (!this.spyIds.length || !this.location) return;
    this.phase = "discuss";
    const secs = (MODES[this.mode] && MODES[this.mode].discuss) || this.discussTime;
    this.endsAt = Date.now() + secs * 1000;
    this.broadcast({ type: "phase", phase: "discuss", endsAt: this.endsAt });
    this.updatePhaseUI();
    this.startTimer(secs, () => this.startVoting());
    this.addSystemMessage("Discussion started! Ask questions to find the spy.");
  }

  startVoting() {
    if (!this.isHost || this.phase === "vote") return;
    clearTimeout(this.roleTimeout);
    this.phase = "vote";
    this.votes = {};
    this.myVote = null;
    this.pendingVote = null;
    this.endsAt = Date.now() + this.voteTime * 1000;
    this.broadcast({ type: "phase", phase: "vote", endsAt: this.endsAt });
    this.updatePhaseUI();
    this.broadcastVoteCount();
    this.startTimer(this.voteTime, () => this.endVoting());
    this.openVoteModal();
    this.addSystemMessage("Voting time! Pick who you think the spy is.");
  }

  openVoteModal() {
    this.closeAllDropdowns();
    const modal = this.$("vote-modal");
    const options = this.$("vote-options");
    const others = this.players.filter(p => p.id !== this.myId && !p.bot);
    if (!others.length) return this.toast("Nobody to vote for", "error");
    this.pendingVote = this.myVote;
    options.innerHTML = others.map(p => `
      <div class="vote-option ${this.pendingVote === p.id ? "selected" : ""}" data-id="${this.escapeHtml(p.id)}" tabindex="0" role="option" aria-selected="${this.pendingVote === p.id ? "true" : "false"}" aria-label="Vote ${this.escapeHtml(p.name)}">
        ${this.avatarHtml(p, 30)}
        <span>${this.escapeHtml(p.name)}${p.bot ? " (bot)" : ""}</span>
      </div>`).join("") + `
      <div class="vote-option skip ${this.pendingVote === "__skip" ? "selected" : ""}" data-id="__skip" tabindex="0" role="option" aria-selected="${this.pendingVote === "__skip" ? "true" : "false"}" aria-label="Skip vote">
        <i class="fa-solid fa-forward" style="color:var(--text-muted)"></i>
        <span>Skip — no vote</span>
      </div>`;
    this.$("confirm-vote").disabled = !this.pendingVote;
    const pick = (el) => {
      options.querySelectorAll(".vote-option").forEach(o => { o.classList.remove("selected"); o.setAttribute("aria-selected", "false"); });
      el.classList.add("selected");
      el.setAttribute("aria-selected", "true");
      this.pendingVote = el.dataset.id;
      this.$("confirm-vote").disabled = false;
    };
    options.querySelectorAll(".vote-option").forEach(el => {
      el.onclick = () => pick(el);
      el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(el); } };
    });
    modal.classList.remove("hidden");
    this.focusModal("vote-modal");
  }

  hideVoteModal() { this.$("vote-modal").classList.add("hidden"); }

  submitVote() {
    if (!this.pendingVote) return;
    this.myVote = this.pendingVote;
    this.hideVoteModal();
    const skipped = this.myVote === "__skip";
    const payload = { type: "vote", id: this.myId, vote: this.myVote };
    if (this.isHost) this.recordVote(payload);
    else this.sendToHost(payload);
    this.playSound("vote");
    this.toast(skipped ? "Vote skipped" : "Vote locked in — tap Vote to change", "success");
  }

  recordVote(data, conn) {
    if (this.phase !== "vote") return;
    if (!data || !data.id || !data.vote) return;
    if (conn && conn.peer !== data.id) return;
    if (data.id === data.vote) return;
    const voter = this.players.find(p => p.id === data.id);
    if (!voter || voter.bot) return;
    if (data.vote !== "__skip") {
      const target = this.players.find(p => p.id === data.vote);
      if (!target || target.bot) return;
    }
    this.votes[data.id] = data.vote;
    this.broadcastVoteCount();
    this.maybeCloseVoting();
  }

  broadcastVoteCount() {
    if (!this.isHost) return;
    const total = this.realPlayers().length;
    const count = Object.keys(this.votes).filter(id => !id.startsWith("bot-")).length;
    this.broadcast({ type: "voteCount", count, total });
    this.renderVoteProgress(count, total);
    if (count > 0) this.playSound("vote-each");
  }

  renderVoteProgress(count, total) {
    const el = this.$("vote-progress");
    if (this.phase !== "vote") { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    el.innerHTML = `<i class="fa-solid fa-check-to-slot"></i> ${count}/${total} voted`;
  }

  maybeCloseVoting() {
    if (this.phase !== "vote") return;
    const need = this.realPlayers().map(p => p.id);
    const done = need.every(id => this.votes[id]);
    if (done) this.endVoting();
  }

  endVoting() {
    if (!this.isHost || this.phase !== "vote") return;
    clearInterval(this.timerInterval);
    this.phase = "reveal";
    this.guessSubmitted = false;
    this.guessedSpies = new Set();

    const tally = {};
    Object.values(this.votes).forEach(v => {
      if (!v || v === "__skip") return;
      if (!this.players.find(p => p.id === v)) return;
      tally[v] = (tally[v] || 0) + 1;
    });
    const maxVotes = Math.max(0, ...Object.values(tally));
    const eliminated = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : [];
    const spyCaught = eliminated.length > 0 && eliminated.every(id => this.spyIds.includes(id));
    this.playSound("vote-done");

    this.players.forEach(p => {
      const isSpy = this.spyIds.includes(p.id);
      if (isSpy) { if (!spyCaught) p.score = (p.score || 0) + 2; }
      else if (this.spyIds.includes(this.votes[p.id])) p.score = (p.score || 0) + 1;
    });

    const results = {
      type: "results",
      round: this.round,
      isGuessUpdate: false,
      spyIds: this.spyIds,
      spyId: this.spyId,
      spyName: this.spyIds.map(id => this.players.find(p => p.id === id)?.name || "???").join(", "),
      location: this.location,
      eliminated,
      eliminatedNames: eliminated.map(id => this.players.find(p => p.id === id)?.name || "?"),
      spyCaught,
      scores: this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0, color: p.color, avatar: p.avatar || null })),
      allowGuess: !spyCaught && (!MODES[this.mode] || MODES[this.mode].guess !== false)
    };
    this.broadcast(results);
    this.hideVoteModal();
    this.applyScores(results.scores);
    this.showResults(results);
  }

  applyScores(scores) {
    if (!Array.isArray(scores)) return;
    scores.forEach(s => {
      const p = this.players.find(pl => pl.id === s.id);
      if (p) p.score = s.score;
    });
    this.renderPlayers();
  }

  showResults(data) {
    this.phase = "reveal";
    this.updatePhaseUI();
    this.$("vote-progress").classList.add("hidden");
    const content = this.$("results-content");
    const title = this.$("results-title");
    const icon = this.$("results-icon");

    title.textContent = data.spyCaught ? "Spy Caught!" : (data.guessCorrect ? "Spy Nailed It!" : "Spy Escaped!");
    icon.innerHTML = data.spyCaught
      ? `<i class="fa-solid fa-handcuffs"></i>`
      : (data.guessCorrect ? `<i class="fa-solid fa-map-location-dot"></i>` : `<i class="fa-solid fa-user-secret"></i>`);
    icon.style.background = data.spyCaught ? "var(--success)" : (data.guessCorrect ? "var(--warning)" : "var(--danger)");

    // The location broadcasts to the whole room — but an escaped spy who
    // hasn't guessed yet must not see it, or the +3 guess is free points.
    // (UI-level fairness only: a determined spy could read the packet.)
    const spyBlind = !data.isGuessUpdate && data.allowGuess && this.isSpy && !this.guessSubmitted
      && (!MODES[this.mode] || MODES[this.mode].guess !== false);
    let html = `
      <div class="reveal-line"><i class="fa-solid fa-user-secret"></i><span>The spy was <strong>${this.escapeHtml(data.spyName || "?")}</strong></span></div>
      <div class="reveal-line"><i class="fa-solid fa-location-dot"></i><span>Location: <strong>${spyBlind ? "???" : this.escapeHtml(data.location || "?")}</strong>${spyBlind ? " (hidden until you guess)" : ""}</span></div>`;
    if (data.eliminatedNames && data.eliminatedNames.length) {
      html += `<div class="reveal-line"><i class="fa-solid fa-check-to-slot"></i><span>Voted out: <strong>${this.escapeHtml(data.eliminatedNames.join(", "))}</strong>${data.eliminatedNames.length > 1 ? " (tie — spy survives)" : ""}</span></div>`;
    } else if (!data.isGuessUpdate) {
      html += `<div class="reveal-line"><i class="fa-solid fa-circle-info"></i><span>No majority — nobody eliminated.</span></div>`;
    }
    if (data.isGuessUpdate && data.guess) {
      html += `<div class="reveal-line"><i class="fa-solid fa-compass"></i><span>Spy guessed: <strong>${this.escapeHtml(data.guess)}</strong> (${data.guessCorrect ? "Correct!" : "Wrong"})</span></div>`;
    }
    html += `<div style="margin-top:12px;font-weight:700">Scores</div>`;
    const sorted = [...(data.scores || [])].sort((a, b) => b.score - a.score);
    const top = Math.max(1, ...sorted.map(s => s.score || 0));
    html += sorted.map((s, i) => {
      const pl = this.players.find(x => x.id === s.id);
      const av = pl ? this.avatarHtml(pl, 30) : this.avatarHtml({ avatar: s.avatar, name: s.name, color: s.color }, 30);
      const pct = Math.max(4, Math.round(((s.score || 0) / top) * 100));
      return `
      <div class="score-row ${i === 0 ? "winner" : ""}">
        ${av}
        <span class="sname">${i === 0 ? '<i class="fa-solid fa-trophy" style="color:var(--warning)"></i> ' : ""}${this.escapeHtml(s.name)}
          <span class="xp-track"><span class="xp-fill" style="width:${pct}%"></span></span>
        </span>
        <span class="pts">${s.score} pts</span>
      </div>`;
    }).join("");
    if (data.guessCorrect) html += `<p class="bonus"><i class="fa-solid fa-star"></i> Spy guessed the location (+3)!</p>`;
    if (data.allowGuess && this.isSpy && !this.guessSubmitted) html += `<p class="bonus warn"><i class="fa-solid fa-lightbulb"></i> You escaped! Guess the location for +3.</p>`;

    content.innerHTML = html;
    this.$("results").classList.remove("hidden");
    const canGuessNow = spyBlind;
    const oldGuessBtn = this.$("results-guess-btn");
    if (oldGuessBtn) oldGuessBtn.remove();
    if (canGuessNow) {
      const gb = document.createElement("button");
      gb.type = "button";
      gb.id = "results-guess-btn";
      gb.className = "btn primary";
      gb.innerHTML = `<i class="fa-solid fa-map-location-dot"></i> Guess the location (+3)`;
      gb.onclick = () => this.openGuessModal();
      this.$("results-content").appendChild(gb);
    }
    const card = this.$("results").querySelector(".results-card");
    const won = !!(data.spyCaught || data.guessCorrect);
    card.classList.toggle("win", won);
    card.classList.toggle("lose", !won);
    const hostOnly = this.isHost;
    this.$("next-round-btn").style.display = hostOnly ? "flex" : "none";
    this.$("wait-host").classList.toggle("hidden", hostOnly);
    const egb = this.$("end-game-btn");
    if (hostOnly) {
      egb.innerHTML = `<i class="fa-solid fa-flag-checkered"></i> End Game`;
      egb.onclick = () => this.endGame();
    } else {
      // Guests have no host controls here — they still need a way out.
      egb.innerHTML = `<i class="fa-solid fa-door-open"></i> Leave Room`;
      egb.onclick = () => this.leaveRoom();
    }

    const r = data.round || this.round;
    const myVoteHit = this.myVote && this.myVote !== "__skip" && (data.spyIds || []).includes(this.myVote);
    const votedCitizen = this.myVote && this.myVote !== "__skip" && !(data.spyIds || []).includes(this.myVote);

    // Base round rewards & win streak: evaluated ONCE per round (never repeated on guess update)
    if (!data.isGuessUpdate && this._rewardedRound !== r) {
      this._rewardedRound = r;
      if (data.spyCaught) {
        if (!this.isSpy && myVoteHit && !votedCitizen) this.earnCoins(20);
      } else if (this.isSpy) {
        this.earnCoins(20);
      }
      const wonRound = this.isSpy ? !data.spyCaught : (!!data.spyCaught && !!myVoteHit && !votedCitizen);
      if (wonRound) {
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        store.set("spy_streak", String(this.streak));
        store.set("spy_best", String(this.bestStreak));
      } else {
        this.streak = 0;
        store.set("spy_streak", "0");
      }
      this.renderStreak();
    } else if (data.isGuessUpdate && this._guessRewardedRound !== r) {
      // Bonus spy location guess reward: evaluated at most ONCE per round
      this._guessRewardedRound = r;
      if (data.guessCorrect && this.isSpy && (!data.guesserId || data.guesserId === this.myId)) {
        this.earnCoins(30);
      }
    }

    this.stopMusic(true);
    if (data.isGuessUpdate) {
      if (data.guessCorrect) { this.playSound("guess-right"); this.playWinPhrase(); this.launchConfetti(90); }
      else { this.playSound("guess-wrong"); }
    } else if (data.spyCaught) {
      this.playSound("win"); this.playWinPhrase(); this.launchConfetti();
    } else {
      this.playSound("lose"); this.playLosePhrase();
    }

    // Guess modal sits above the results overlay and the results card
    // carries its own Guess button, so no auto-open timer here.
  }

  openGuessModal() {
    if (this.guessSubmitted) return;
    if (!this.isSpy) return;
    if (MODES[this.mode] && MODES[this.mode].guess === false) return this.toast("Guessing is off in Hardcore mode", "error");
    if (this.phase !== "reveal") return this.toast("Guess opens after the vote — survive it first");
    this.closeAllDropdowns();
    const modal = this.$("guess-modal");
    const options = this.$("guess-options");
    this.spyGuess = null;
    this.$("confirm-guess").disabled = true;
    this.$("guess-search").value = "";
    this.playSound("guess-open");
    const pool = this.poolFor(this.category);
    options.innerHTML = pool.map(loc => `<div class="vote-option" data-loc="${this.escapeHtml(loc)}" tabindex="0" role="option" aria-selected="false" aria-label="Guess ${this.escapeHtml(loc)}"><i class="fa-solid fa-location-dot" style="color:var(--primary)"></i> ${this.escapeHtml(loc)}</div>`).join("");
    const pickG = (el) => {
      options.querySelectorAll(".vote-option").forEach(o => { o.classList.remove("selected"); o.setAttribute("aria-selected", "false"); });
      el.classList.add("selected");
      el.setAttribute("aria-selected", "true");
      this.spyGuess = el.dataset.loc;
      this.$("confirm-guess").disabled = false;
    };
    options.querySelectorAll(".vote-option").forEach(el => {
      el.onclick = () => pickG(el);
      el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickG(el); } };
    });
    modal.classList.remove("hidden");
    this.focusModal("guess-modal");
  }

  filterGuess(q) {
    const needle = q.trim().toLowerCase();
    let shown = 0, total = 0;
    this.$("guess-options").querySelectorAll(".vote-option").forEach(el => {
      total++;
      const hit = !needle || el.dataset.loc.toLowerCase().includes(needle);
      el.style.display = hit ? "" : "none";
      if (hit) shown++;
    });
    const box = this.$("guess-options");
    if (box) box.setAttribute("aria-label", `Guess the location (${shown} of ${total} shown)`);
    const search = this.$("guess-search");
    if (search) search.setAttribute("aria-expanded", needle ? "true" : "false");
  }

  submitGuess() {
    if (!this.spyGuess || !this.isSpy || this.guessSubmitted) return;
    if (MODES[this.mode] && MODES[this.mode].guess === false) return this.toast("Guessing is off in Hardcore mode", "error");
    if (this.phase !== "reveal") return this.toast("Guess opens after the vote", "error");
    this.guessSubmitted = true;
    this.$("guess-modal").classList.add("hidden");
    const guess = this.spyGuess;
    this.spyGuess = null;
    if (this.isHost) this.resolveGuess(guess, null);
    else this.sendToHost({ type: "guess", id: this.myId, guess });
    this.playSound();
  }

  resolveGuess(guess, conn, senderId) {
    if (this.phase !== "reveal") return;
    if (MODES[this.mode] && MODES[this.mode].guess === false) return;
    const spyConnId = conn ? conn.peer : this.myId;
    if (conn && senderId && senderId !== conn.peer) return;
    if (!guess || typeof guess !== "string") return;
    if (!this.spyIds.includes(spyConnId)) return;
    try {
      if (this.guessedSpies.has(spyConnId)) return;
      this.guessedSpies.add(spyConnId);
    } catch (e) { return; }
    this.guessSubmitted = true;
    const correct = guess === this.location;
    if (correct) {
      const guesser = this.players.find(p => p.id === spyConnId);
      if (guesser) guesser.score = (guesser.score || 0) + 3;
    }
    const results = {
      type: "results",
      round: this.round,
      isGuessUpdate: true,
      guesserId: spyConnId,
      spyIds: this.spyIds,
      spyId: this.spyId,
      spyName: this.spyIds.map(id => this.players.find(p => p.id === id)?.name || "???").join(", "),
      location: this.location,
      eliminated: [],
      eliminatedNames: [],
      spyCaught: false,
      scores: this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0, color: p.color, avatar: p.avatar || null })),
      guessCorrect: correct,
      guess,
      allowGuess: false
    };
    this.broadcast(results);
    this.hideVoteModal();
    this.applyScores(results.scores);
    this.showResults(results);
  }

  nextRound() {
    if (!this.isHost) return;
    this.flushPendingPlayers();
    if (this.realPlayers().length < MIN_PLAYERS) return this.toast(`Need ${MIN_PLAYERS} players`, "error");
    if (this.mode === "double" && this.realPlayers().length < 6) return this.toast("Double Spy needs 6+ players — switch mode or wait for more", "error");
    this.hideResults();
    this.round++;
    this.pickNewRound();
    this.isSpy = this.spyIds.includes(this.myId);
    this.phase = "role";
    this.votes = {};
    this.myVote = null;
    this.pendingVote = null;
    this.spyGuess = null;
    this.guessSubmitted = false;
    this.guessedSpies = new Set();
    this.sendPersonalized("nextRound");
    this.showGame();
    this.showRole();
    this.updatePhaseUI();
    this.renderPlayers();
    this.roleEndsAt = Date.now() + 3500;
    clearTimeout(this.roleTimeout);
    this.roleTimeout = setTimeout(() => this.startDiscussion(), 3500);
  }

  endGame() {
    if (!this.isHost) return this.toast("Only the host can end the game", "error");
    clearInterval(this.timerInterval);
    clearTimeout(this.roleTimeout);
    const scores = this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0, color: p.color, avatar: p.avatar || null }))
      .sort((a, b) => b.score - a.score);
    this.broadcast({ type: "endGame", scores });
    this.showFinalScores({ scores });
  }

  toLobby() {
    if (!this.isHost) return;
    clearInterval(this.timerInterval);
    clearTimeout(this.roleTimeout);
    this.flushPendingPlayers();
    this.phase = "lobby";
    this.round = 1;
    this._rewardedRound = 0;
    this._guessRewardedRound = 0;
    this.votes = {};
    this.myVote = null;
    this.pendingVote = null;
    this.spyGuess = null;
    this.guessSubmitted = false;
    this.guessedSpies = new Set();
    this.chatHistory = [];
    this.spyIds = []; this.spyId = null; this.isSpy = false; this.location = "";
    this.endsAt = 0; this.timeLeft = 0; this.roleEndsAt = 0;
    this.players.forEach(p => { p.score = 0; });
    this.waitingForNext = false;
    this.broadcast({ type: "toLobby", players: this.players, roomCode: this.roomCode });
    this.hideResults();
    this.hideVoteModal();
    this.showLobbyScreen();
    this.renderChat();
    this.addSystemMessage("Back in the lobby — ready for a new match.");
    this.playSound("round");
  }

  showLobbyScreen() {
    if (window._swUpdatePending) { try { window.location.reload(); return; } catch (e) {} }
    this.$("game").classList.remove("active");
    this.$("lobby").classList.add("active");
    this.$("join-section").classList.add("hidden");
    this.$("host-lobby").classList.remove("hidden");
    this.$("display-code").textContent = this.roomCode || "-----";
    this.syncLobbyPickLocks();
    if (this.isHost) {
      this.$("start-btn").style.display = "";
      this.$("guest-wait").classList.add("hidden");
    } else {
      this.$("start-btn").style.display = "none";
      this.$("guest-wait").classList.remove("hidden");
      this.$("guest-wait").innerHTML = `<i class="fa-solid fa-hourglass-half"></i> Waiting for the host to start…`;
    }
    this.renderPlayers();
    this.startLobbyMusic();
  }

  showFinalScores(data) {
    this.stopMusic(true);
    this.hideResults();
    this.hideVoteModal();
    this.phase = "reveal";
    const content = this.$("results-content");
    this.$("results-title").textContent = data.title || "Final Scores";
    this.$("results-icon").innerHTML = `<i class="fa-solid fa-trophy"></i>`;
    this.$("results-icon").style.background = "var(--warning)";
    const finalTop = Math.max(1, ...(data.scores || []).map(s => s.score || 0));
    content.innerHTML = (data.scores || []).map((s, i) => `
      <div class="score-row ${i === 0 ? "winner" : ""}">
        ${this.avatarHtml({ avatar: s.avatar, name: s.name, color: s.color }, 30)}
        <span class="sname">${i === 0 ? '<i class="fa-solid fa-trophy" style="color:var(--warning)"></i> ' : `#${i + 1} `}${this.escapeHtml(s.name)}
          <span class="xp-track"><span class="xp-fill" style="width:${Math.max(4, Math.round(((s.score || 0) / finalTop) * 100))}%"></span></span>
        </span>
        <span class="pts">${s.score} pts</span>
      </div>`).join("");
    const endBtn = this.$("end-game-btn");
    const nextBtn = this.$("next-round-btn");
    if (this.isHost) {
      nextBtn.style.display = "none";
      this.$("wait-host").classList.add("hidden");
      endBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Back to Lobby`;
      endBtn.onclick = () => this.toLobby();
    } else {
      // Finals leave guests with no host buttons — offer Leave plus a lobby ask.
      this.$("wait-host").classList.add("hidden");
      nextBtn.style.display = "flex";
      nextBtn.innerHTML = `<i class="fa-solid fa-door-open"></i> Leave Room`;
      nextBtn.onclick = () => this.leaveRoom();
      endBtn.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> Ask Host: Lobby`;
      endBtn.onclick = () => {
        this.sendToHost({ type: "wantLobby", id: this.myId, name: this.myName });
        this.toast("Asked the host to return to lobby");
      };
    }
    this.$("results").classList.remove("hidden");
    this.$("results").querySelector(".results-card").classList.add("win");
    this.launchConfetti(90);
    this.playSound("win");
  }

  hideResults() {
    this.$("results").classList.add("hidden");
    this.$("guess-modal").classList.add("hidden");
  }

  // ---------- timer (host drives from endsAt — no drift in background tabs) ----------
  startTimer(seconds, onEnd) {
    if (!this.isHost) return;
    clearInterval(this.timerInterval);
    this.timeLeft = seconds;
    this.endsAt = Date.now() + seconds * 1000;
    this.updateTimer();
    this.timerInterval = setInterval(() => {
      this.timeLeft = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
      this.updateTimer();
      if (this.timeLeft <= 0 || this.timeLeft % 5 === 0) {
        this.broadcast({ type: "timer", time: this.timeLeft, endsAt: this.endsAt });
      }
      if (this.timeLeft <= 5 && this.timeLeft > 0) this.playSound("tick");
      if (this.timeLeft <= 0) {
        clearInterval(this.timerInterval);
        this.playSound("go");
        onEnd();
      }
    }, 1000);
  }

  updateTimer() {
    const t = Math.max(0, this.timeLeft || 0);
    const m = Math.floor(t / 60);
    const s = t % 60;
    this.$("timer-text").textContent = `${m}:${String(s).padStart(2, "0")}`;
    this.$("timer").classList.toggle("low", t <= 10 && t > 0 && this.phase !== "lobby");
    const sub = this.$("vote-timer-sub");
    if (sub && this.phase === "vote") sub.textContent = `(${m}:${String(s).padStart(2, "0")} left)`;
  }

  updatePhaseUI() {
    const sig = `${this.phase}|${this.round}`;
    if (sig !== this._phaseSig) {
      this._phaseSig = sig;
      this._phaseNodes = this._phaseNodes || {};
      const labels = {
        lobby: ["fa-ticket", "Lobby"], role: ["fa-eye", "Role Reveal"],
        discuss: ["fa-comments", "Discussion"], vote: ["fa-check-to-slot", "Voting"],
        reveal: ["fa-flag", "Results"], spyguess: ["fa-map-location-dot", "Spy Guessing"]
      };
      const [icon, label] = labels[this.phase] || ["fa-gamepad", this.phase];
      const pl = this._phaseNodes.label || (this._phaseNodes.label = this.$("phase-label"));
      if (pl) pl.innerHTML = `<i class="fa-solid ${icon}"></i> <span id="phase-text">${this.escapeHtml(label)}</span>`;
      const rl = this._phaseNodes.round || (this._phaseNodes.round = this.$("round-label"));
      if (rl) rl.innerHTML = `<i class="fa-solid fa-rotate"></i> R${this.round}`;
      const order = ["role", "discuss", "vote", "reveal"];
      const idx = order.indexOf(this.phase === "spyguess" ? "vote" : this.phase);
      const fill = this._phaseNodes.fill || (this._phaseNodes.fill = this.$("quest-fill"));
      if (fill) fill.style.width = idx < 0 ? "0%" : `${(idx / (order.length - 1)) * 100}%`;
      const nodes = this._phaseNodes.q || (this._phaseNodes.q = [...document.querySelectorAll("#quest-nodes .qnode")]);
      nodes.forEach(n => {
        const ni = order.indexOf(n.dataset.ph);
        n.classList.toggle("done", idx >= 0 && ni < idx);
        n.classList.toggle("now", idx >= 0 && ni === idx);
      });
    }
    this.updateTimer();
  }

  // ---------- chat (dedup + host relay; lobby box mirrors the same history) ----------
  sendLobbyChat() {
    const input = this.$("lobby-chat-input");
    const msg = input.value.trim().slice(0, 180);
    if (!msg) return;
    if (!this.myId && !this.isHost) return this.toast("Not connected yet", "error");
    input.value = "";
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msgId = `${this.myId || "host"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const payload = { type: "chat", id: this.myId, name: this.myName, message: msg, time, msgId };
    this.seenMsgIds.add(msgId);
    this.addChatMessage(this.myName, msg, true, time, false);
    if (this.isHost) this.broadcast(payload);
    else this.sendToHost(payload);
    this.playSound("click");
  }

  renderLobbyChat() {
    const box = this.$("lobby-chat-messages");
    if (!box) return;
    const nearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 80;
    box.innerHTML = this.chatHistory.slice(-30).map(m => {
      if (m.sys) return `<div class="chat-msg sys"><i class="fa-solid fa-circle-info"></i> ${this.escapeHtml(m.message)}</div>`;
      return `<div class="chat-msg ${m.isOwn ? "own" : "other"}">
        <div class="sender">${this.escapeHtml(m.name)}</div>
        ${this.escapeHtml(m.message)}
      </div>`;
    }).join("");
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  sendChat(text) {
    const input = this.$("chat-input");
    const msg = (typeof text === "string" ? text : input.value).trim().slice(0, 180);
    if (!msg) return;
    if (!this.myId && !this.isHost) return this.toast("Not connected yet", "error");
    if (typeof text !== "string") input.value = "";
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msgId = `${this.myId || "host"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const payload = { type: "chat", id: this.myId, name: this.myName, message: msg, time, msgId };
    this.seenMsgIds.add(msgId);
    this.addChatMessage(this.myName, msg, true, time, false);
    if (this.isHost) this.broadcast(payload);
    else this.sendToHost(payload);
    this.playSound("click");
  }

  chatNode(m) {
    if (m.sys) return `<div class="chat-msg sys"><i class="fa-solid fa-circle-info"></i> ${this.escapeHtml(m.message)}</div>`;
    return `<div class="chat-msg ${m.isOwn ? "own" : "other"}">
      <div class="sender">${this.escapeHtml(m.name)}</div>
      ${this.escapeHtml(m.message)}
      ${m.time ? `<div class="time">${this.escapeHtml(m.time)}</div>` : ""}
    </div>`;
  }

  addChatMessage(name, message, isOwn, time, isSys = false) {
    const entry = { name: String(name || "?").slice(0, 16), message: String(message || "").slice(0, 180), isOwn: !!isOwn, time: time || "", sys: !!isSys };
    this.chatHistory.push(entry);
    if (this.chatHistory.length > 120) this.chatHistory.shift();
    const container = this.$("chat-messages");
    if (container && container.children.length) {
      const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
      if (container.children.length >= 120) container.firstChild?.remove();
      container.insertAdjacentHTML("beforeend", this.chatNode(entry));
      if (nearBottom) container.scrollTop = container.scrollHeight;
      this.renderLobbyChat();
    } else {
      this.renderChat();
    }
  }

  addSystemMessage(text) {
    this.addChatMessage("System", text, false, "", true);
  }

  renderChat() {
    const container = this.$("chat-messages");
    const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
    container.innerHTML = this.chatHistory.map(m => this.chatNode(m)).join("");
    if (nearBottom) container.scrollTop = container.scrollHeight;
    this.renderLobbyChat();
  }

  clearChat() {
    this.chatHistory = [];
    this.renderChat();
  }
}

window.addEventListener("load", () => {
  window.game = new Game();
  try {
    const qs = new URLSearchParams(location.search);
    const host = location.hostname || "";
    const isLocalDev = host === "localhost" || host === "127.0.0.1" || host === "::1"
      || host === "0.0.0.0" || host === "[::1]"
      || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".test")
      || host === "test" || host.indexOf(".") === -1
      || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (isLocalDev || qs.has("nosw")) {
      try {
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.getRegistrations().then(rs => {
            rs.forEach(r => { try { r.unregister(); } catch (e) {} });
          }).catch(() => {});
        }
      } catch (e) {}
      try {
        if ("caches" in window) {
          caches.keys().then(ks => {
            ks.filter(k => k.indexOf("spy-") === 0).forEach(k => { caches.delete(k).catch(() => {}); });
          }).catch(() => {});
        }
      } catch (e) {}
      return;
    }
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").then(reg => {
        try {
          if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
          reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
              if (nw.state === "installed" && navigator.serviceWorker.controller) {
                try { reg.waiting && reg.waiting.postMessage({ type: "SKIP_WAITING" }); } catch (e) {}
              }
            });
          });
        } catch (e) {}
      }).catch(() => {});
      try {
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return;
          reloaded = true;
          try {
            const g = window.game;
            const inRoom = g && g.roomCode && g.phase && g.phase !== "lobby";
            if (inRoom) {
              window._swUpdatePending = true;
              if (g.toast) g.toast("Update ready — applies when you return to lobby", "success");
            } else {
              window.location.reload();
            }
          } catch (e) { try { window.location.reload(); } catch (e2) {} }
        });
      } catch (e) {}
    }
  } catch (e) {}
});
