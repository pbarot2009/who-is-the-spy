// Who is the Spy? — fixed + polished multiplayer
// Host-authoritative, no location leak, dedup chat, working dev mode.

const LOCATIONS = [
  "Beach", "School", "Hospital", "Airport", "Restaurant", "Movie Theater",
  "Zoo", "Park", "Library", "Shopping Mall", "Museum", "Train Station",
  "Amusement Park", "Space Station", "Pirate Ship", "Castle", "Farm",
  "Circus", "Hotel", "Gym", "Police Station", "Fire Station", "Submarine",
  "Jungle", "Desert", "Cruise Ship", "Bank", "Stadium", "Theater", "Cafe"
];

const COLORS = ["#7c5cfc", "#ef4444", "#22c55e", "#f59e0b", "#0ea5e9", "#ec4899", "#8b5cf6", "#14b8a6"];
const PEER_PREFIX = "whos-spy-v1-";
const MIN_PLAYERS = 3;
const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

class Game {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // host: peerId -> conn | guest: "host" -> conn
    this.isHost = false;
    this.myId = null;
    this.myName = (localStorage.getItem("spy_name") || "").slice(0, 16);
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
    this.votes = {};
    this.spyGuess = null;
    this.chatHistory = [];
    this.seenMsgIds = new Set();
    this.soundEnabled = localStorage.getItem("spy_sound") !== "false";
    this.discussTime = this.clampInt(localStorage.getItem("spy_discuss"), 120, 30, 300);
    this.voteTime = this.clampInt(localStorage.getItem("spy_vote"), 45, 15, 120);
    this.devMode = false;
    this.devInterval = null;
    this.audioCtx = null;
    this.longPressMs = 700;

    this.loadSettings();
    this.initUI();
    this.applyTheme(localStorage.getItem("spy_theme") || "dark");
    this.checkDevMode();
    this.setStatus("Offline", false);
  }

  clampInt(v, fallback, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

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

  playSound(type = "click") {
    if (!this.soundEnabled) return;
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === "suspended") this.audioCtx.resume();
      const o = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      o.connect(g); g.connect(this.audioCtx.destination);
      o.frequency.value = type === "success" ? 880 : type === "error" ? 220 : type === "tick" ? 660 : 520;
      o.type = type === "error" ? "sawtooth" : "sine";
      g.gain.setValueAtTime(0.07, this.audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.16);
      o.start(); o.stop(this.audioCtx.currentTime + 0.16);
    } catch (e) { /* audio not available */ }
  }

  peerIdFor(code) { return PEER_PREFIX + code.toUpperCase(); }

  generateCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  // ---------- settings / theme ----------
  loadSettings() {
    if (this.myName) this.$("player-name").value = this.myName;
    const lastCode = localStorage.getItem("spy_lastcode");
    if (lastCode) this.$("room-code").value = lastCode;
    this.$("sound-toggle").checked = this.soundEnabled;
    this.$("discuss-time").value = this.discussTime;
    this.$("vote-time").value = this.voteTime;
    this.$("theme-select").value = localStorage.getItem("spy_theme") || "dark";
    this.syncSoundBtn();
  }

  applyTheme(theme) {
    const ok = ["dark", "light", "spy", "ocean", "forest"];
    const t = ok.includes(theme) ? theme : "dark";
    document.body.className = t === "dark" ? "" : `theme-${t}`;
    localStorage.setItem("spy_theme", t);
    const sel = this.$("theme-select");
    if (sel) sel.value = t;
  }

  openSettings() { this.$("settings-modal").classList.remove("hidden"); }
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
    this.$("guess-now-btn").onclick = () => { if (this.isSpy) this.openGuessModal(); };
    this.$("sound-btn").onclick = () => {
      this.soundEnabled = !this.soundEnabled;
      localStorage.setItem("spy_sound", String(this.soundEnabled));
      this.$("sound-toggle").checked = this.soundEnabled;
      this.syncSoundBtn();
      this.toast(this.soundEnabled ? "Sound on" : "Sound off");
    };

    this.$("settings-btn").onclick = () => this.openSettings();
    this.$("close-settings").onclick = () => this.closeSettings();
    this.$("theme-select").onchange = e => this.applyTheme(e.target.value);
    this.$("sound-toggle").onchange = e => {
      this.soundEnabled = e.target.checked;
      localStorage.setItem("spy_sound", String(this.soundEnabled));
      this.syncSoundBtn();
    };
    this.$("discuss-time").onchange = e => {
      this.discussTime = this.clampInt(e.target.value, 120, 30, 300);
      e.target.value = this.discussTime;
      localStorage.setItem("spy_discuss", String(this.discussTime));
    };
    this.$("vote-time").onchange = e => {
      this.voteTime = this.clampInt(e.target.value, 45, 15, 120);
      e.target.value = this.voteTime;
      localStorage.setItem("spy_vote", String(this.voteTime));
    };

    document.querySelectorAll("[data-close]").forEach(btn => {
      btn.onclick = () => this.$(btn.dataset.close).classList.add("hidden");
    });
    document.querySelectorAll(".modal, .overlay").forEach(m => {
      m.addEventListener("click", e => { if (e.target === m && m.id !== "results") m.classList.add("hidden"); });
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        this.$("settings-modal").classList.add("hidden");
        this.$("vote-modal").classList.add("hidden");
        this.$("guess-modal").classList.add("hidden");
        if (this.devMode) this.toggleDevPanel(false);
      }
    });

    // Dev entry: long-press title (touch + mouse) + triple-click + keyboard
    const title = this.$("game-title");
    let pressTimer = null, clicks = 0, clickTimer = null;
    const startPress = () => { pressTimer = setTimeout(() => this.toggleDev(), this.longPressMs); };
    const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
    title.addEventListener("pointerdown", startPress);
    title.addEventListener("pointerup", cancelPress);
    title.addEventListener("pointerleave", cancelPress);
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

    // unlock audio on first touch
    window.addEventListener("pointerdown", () => {
      try {
        if (!this.audioCtx && this.soundEnabled) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioCtx && this.audioCtx.state === "suspended") this.audioCtx.resume();
      } catch (e) {}
    }, { passive: true });
  }

  syncSoundBtn() {
    const btn = this.$("sound-btn");
    if (!btn) return;
    btn.innerHTML = this.soundEnabled
      ? `<i class="fa-solid fa-volume-high"></i><span>Sound</span>`
      : `<i class="fa-solid fa-volume-xmark"></i><span>Muted</span>`;
  }

  // ---------- dev mode (fixed) ----------
  checkDevMode() {
    const q = new URLSearchParams(location.search);
    if (q.has("dev") || q.has("debug") || localStorage.getItem("spy_dev") === "1") this.enableDev(true);
  }

  enableDev(silent = false) {
    this.devMode = true;
    this.$("dev-toggle").classList.remove("hidden");
    this.$("dev-spacer").style.display = "none";
    localStorage.setItem("spy_dev", "1");
    this.updateDevPanel();
    this.startDevRefresh();
    if (!silent) this.toast("Dev mode on. Tap the bug icon.", "success");
  }

  disableDev() {
    this.devMode = false;
    this.$("dev-toggle").classList.add("hidden");
    this.$("dev-spacer").style.display = "";
    this.$("dev-panel").classList.add("hidden");
    localStorage.removeItem("spy_dev");
    this.stopDevRefresh();
    this.toast("Dev mode off");
  }

  toggleDev() {
    if (this.devMode) this.disableDev();
    else this.enableDev();
  }

  toggleDevPanel(show) {
    const panel = this.$("dev-panel");
    const willShow = show === undefined ? panel.classList.contains("hidden") : !!show;
    panel.classList.toggle("hidden", !willShow);
    if (willShow) this.updateDevPanel();
  }

  startDevRefresh() {
    this.stopDevRefresh();
    this.devInterval = setInterval(() => { if (this.devMode) this.updateDevPanel(); }, 1000);
  }
  stopDevRefresh() { if (this.devInterval) clearInterval(this.devInterval); this.devInterval = null; }

  updateDevPanel() {
    if (!this.devMode) return;
    const spy = this.isHost
      ? (this.players.find(p => p.id === this.spyId)?.name || "—")
      : (this.isSpy ? `${this.myName} (you)` : "hidden — you are not host");
    const loc = this.isHost ? (this.location || "—") : (this.isSpy ? "(hidden from spy)" : (this.location || "—"));
    this.$("dev-state").innerHTML = `
      <div>Phase: <strong>${this.escapeHtml(this.phase)}</strong></div>
      <div>Round: <strong>${this.round}</strong></div>
      <div>Players: <strong>${this.players.length}</strong></div>
      <div>Role: <strong>${this.isHost ? "HOST" : "GUEST"}${this.isSpy ? " + SPY" : ""}</strong></div>
      <div class="wide">Spy: <strong>${this.escapeHtml(spy)}</strong></div>
      <div class="wide">Location: <strong>${this.escapeHtml(loc)}</strong></div>
      <div>Conns: <strong>${this.connections.size}</strong></div>
      <div>Votes: <strong>${Object.keys(this.votes).length}/${this.realPlayers().length}</strong></div>
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
      const name = this.players.find(p => p.id === this.spyId)?.name || "unknown";
      this.devLog(`Spy: ${name} | Location: ${this.location}`);
      this.toast(`Spy: ${name}`, "success");
    } else if (this.isSpy) {
      this.devLog("You ARE the spy. Location hidden from you by design.");
    } else {
      this.devLog("Only the host can reveal. (Anti-cheat: guests never receive spy/location.)");
    }
  }

  devAddBot() {
    if (!this.isHost) return this.devLog("Add-bot needs host.");
    if (this.phase !== "lobby") return this.devLog("Bots can only join in the lobby.");
    const n = this.players.length + 1;
    const id = `bot-${Math.random().toString(36).slice(2, 8)}`;
    this.addPlayer({ id, name: `Bot ${n}`, isHost: false, score: 0, color: COLORS[this.players.length % COLORS.length], bot: true });
    this.broadcast({ type: "players", players: this.players });
    this.devLog(`Added ${id}. Bots never vote — they are skipped in tally.`);
  }

  devRemoveBots() {
    if (!this.isHost) return this.devLog("Remove-bots needs host.");
    this.players = this.players.filter(p => !p.bot);
    this.broadcast({ type: "players", players: this.players });
    this.renderPlayers();
    this.devLog("Bots removed.");
  }

  devCopyState() {
    const s = JSON.stringify(this.getDebugState(), null, 2);
    this.copyText(s, "Debug state copied");
    this.devLog("State copied to clipboard.");
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
    localStorage.setItem("spy_name", name);
    this.roomCode = this.generateCode();
    this.isHost = true;
    this.setStatus("Creating…");
    this.$("create-btn").disabled = true;

    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.connections.clear();
    this.peer = new Peer(this.peerIdFor(this.roomCode), { debug: 0, config: ICE });

    this.peer.on("open", id => {
      this.myId = id;
      this.players = [];
      this.addPlayer({ id, name: this.myName, isHost: true, score: 0, color: COLORS[0] });
      this.showHostLobby();
      this.setStatus(`Hosting · ${this.roomCode}`, true);
      this.playSound("success");
      this.toast(`Room ${this.roomCode} created — share the code!`, "success");
      this.$("create-btn").disabled = false;
    });

    this.peer.on("connection", conn => this.handleConnection(conn));
    this.peer.on("disconnected", () => { try { this.peer.reconnect(); } catch (e) {} });
    this.peer.on("error", err => {
      console.error(err);
      this.$("create-btn").disabled = false;
      if (err && err.type === "unavailable-id") {
        // code taken on the public cloud — retry with a fresh one
        this.roomCode = this.generateCode();
        this.toast("Code taken, trying a new one…");
        setTimeout(() => this.createRoom(), 400);
      } else {
        this.setStatus("Error", false);
        this.toast("Could not create room. Check connection and retry.", "error");
      }
    });
  }

  joinRoom() {
    const name = this.$("player-name").value.trim().slice(0, 16);
    const code = this.$("room-code").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    if (!name) return this.toast("Enter your name first", "error");
    if (code.length !== 5) return this.toast("Room code is 5 letters", "error");
    this.myName = name;
    localStorage.setItem("spy_name", name);
    localStorage.setItem("spy_lastcode", code);
    this.roomCode = code;
    this.isHost = false;
    this.setStatus("Joining…");
    this.$("join-btn").disabled = true;

    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.connections.clear();
    this.peer = new Peer({ debug: 0, config: ICE });

    let done = false;
    const failTimer = setTimeout(() => {
      if (!done) { this.$("join-btn").disabled = false; this.setStatus("Failed", false); this.toast("Host not responding. Check the code.", "error"); }
    }, 12000);

    this.peer.on("open", id => {
      this.myId = id;
      const conn = this.peer.connect(this.peerIdFor(code), { reliable: true });
      if (!conn) { clearTimeout(failTimer); this.$("join-btn").disabled = false; return this.toast("Could not connect", "error"); }
      this.handleConnection(conn, () => { done = true; clearTimeout(failTimer); this.$("join-btn").disabled = false; });
    });

    this.peer.on("error", err => {
      console.error(err);
      clearTimeout(failTimer);
      this.$("join-btn").disabled = false;
      this.setStatus("Failed", false);
      this.toast(err && err.type === "peer-unavailable" ? "Room not found. Check the code." : "Join failed. Retry.", "error");
    });
  }

  handleConnection(conn, onOpen) {
    conn.on("open", () => {
      if (this.isHost) {
        this.connections.set(conn.peer, conn);
        conn.send({ type: "welcome", players: this.players, roomCode: this.roomCode, chat: this.chatHistory.slice(-40) });
        this.setStatus(`Hosting · ${this.players.length}`, true);
      } else {
        this.connections.set("host", conn);
        conn.send({ type: "join", id: this.myId, name: this.myName });
        this.setStatus("Connected", true);
      }
      if (onOpen) onOpen();
      if (this.devMode) this.updateDevPanel();
    });

    conn.on("data", data => this.onMessage(data, conn));
    conn.on("close", () => this.onDisconnect(conn));
    conn.on("error", e => console.warn("Conn error", e));
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
        if (this.phase !== "lobby") { try { conn.send({ type: "joinDenied", reason: "Game already started" }); } catch (e) {} break; }
        const color = COLORS[this.players.length % COLORS.length];
        this.addPlayer({ id: data.id, name: String(data.name || "Player").slice(0, 16), isHost: false, score: 0, color });
        this.sendTo(conn, { type: "welcome", players: this.players, roomCode: this.roomCode, chat: this.chatHistory.slice(-40) });
        this.broadcast({ type: "players", players: this.players });
        this.playSound();
        break;
      }
      case "joinDenied":
        this.toast(data.reason || "Could not join", "error");
        this.setStatus("Denied", false);
        break;
      case "welcome":
        this.players = Array.isArray(data.players) ? data.players : [];
        this.roomCode = data.roomCode || this.roomCode;
        this.chatHistory = Array.isArray(data.chat) ? data.chat : [];
        this.renderPlayers();
        this.renderChat();
        this.showHostLobby();
        if (!this.isHost) {
          this.$("start-btn").style.display = "none";
          this.$("guest-wait").classList.remove("hidden");
          this.$("display-code").textContent = this.roomCode;
        }
        this.setStatus("In room", true);
        this.toast("Joined room!", "success");
        break;
      case "players":
        this.players = Array.isArray(data.players) ? data.players : [];
        this.renderPlayers();
        break;
      case "gameStart":
        // personalized: { isSpy, location (null for spy), round, players }
        this.isSpy = !!data.isSpy;
        this.location = data.location || "";
        this.spyId = null; // guests never learn it
        this.round = data.round || 1;
        this.phase = "role";
        this.votes = {}; this.myVote = null; this.spyGuess = null;
        this.chatHistory = [];
        if (Array.isArray(data.players)) this.players = data.players;
        this.showGame();
        this.showRole();
        this.updatePhaseUI();
        this.renderPlayers();
        this.playSound("success");
        // guests wait — only the host advances the phase
        break;
      case "chat":
        this.addChatMessage(data.name, data.message, data.id === this.myId, data.time, data.id === "system");
        if (this.isHost && conn && data.id !== "system") this.broadcastExcept({ type: "chat", id: data.id, name: data.name, message: data.message, time: data.time, msgId: data.msgId }, conn);
        break;
      case "phase":
        this.phase = data.phase;
        if (typeof data.time === "number") { this.timeLeft = data.time; this.updateTimer(); }
        this.updatePhaseUI();
        if (data.phase === "vote") { this.myVote = null; this.openVoteModal(); }
        if (data.phase === "spyguess" && this.isSpy) this.openGuessModal();
        if (data.phase === "discuss") this.addSystemMessage("Discussion started! Ask questions to find the spy.");
        if (data.phase === "vote") this.addSystemMessage("Voting time! Pick who you think the spy is.");
        break;
      case "timer":
        this.timeLeft = data.time;
        this.updateTimer();
        break;
      case "voteCount":
        this.renderVoteProgress(data.count, data.total);
        break;
      case "vote":
        if (this.isHost) this.recordVote(data);
        break;
      case "guess":
        if (this.isHost) this.resolveGuess(data.guess, conn);
        break;
      case "results":
        this.hideVoteModal();
        this.applyScores(data.scores);
        this.showResults(data);
        break;
      case "nextRound":
        this.isSpy = !!data.isSpy;
        this.location = data.location || "";
        this.spyId = null;
        this.round = data.round;
        this.phase = "role";
        this.votes = {}; this.myVote = null; this.spyGuess = null;
        if (Array.isArray(data.players)) this.players = data.players;
        this.hideResults();
        this.showRole();
        this.updatePhaseUI();
        this.renderPlayers();
        break;
      case "endGame":
        this.hideVoteModal();
        this.showFinalScores(data);
        break;
    }
    if (this.devMode) this.updateDevPanel();
  }

  onDisconnect(conn) {
    if (this.isHost) {
      const pid = conn.peer;
      this.connections.delete(pid);
      const left = this.players.find(p => p.id === pid);
      this.players = this.players.filter(p => p.id !== pid);
      delete this.votes[pid];
      this.broadcast({ type: "players", players: this.players });
      this.renderPlayers();
      this.setStatus(`Hosting · ${this.players.length}`, true);
      if (left) this.addSystemMessage(`${left.name} left the room.`);
      // if everyone voted already (minus leaver), close the vote
      if (this.phase === "vote") this.maybeCloseVoting();
    } else {
      this.setStatus("Disconnected", false);
      this.toast("Lost connection to host", "error");
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
    if (host && host.open) { try { host.send(data); } catch (e) {} }
  }

  // ---------- lobby ----------
  addPlayer(player) {
    if (!this.players.find(p => p.id === player.id)) this.players.push(player);
    this.renderPlayers();
    this.updateStartButton();
  }

  showHostLobby() {
    this.$("join-section").classList.add("hidden");
    this.$("host-lobby").classList.remove("hidden");
    this.$("display-code").textContent = this.roomCode;
    this.renderPlayers();
    this.updateStartButton();
  }

  updateStartButton() {
    const btn = this.$("start-btn");
    const n = this.players.length;
    this.$("lobby-count").innerHTML = `<i class="fa-solid fa-users"></i> ${n} player${n === 1 ? "" : "s"}`;
    this.$("lobby-min").textContent = n < MIN_PLAYERS ? `Need ${MIN_PLAYERS - n} more to start` : "Ready to start!";
    if (this.isHost) {
      btn.disabled = n < MIN_PLAYERS;
      btn.innerHTML = n < MIN_PLAYERS
        ? `<i class="fa-solid fa-play"></i> Start Game (need ${MIN_PLAYERS - n} more)`
        : `<i class="fa-solid fa-play"></i> Start Game`;
    }
  }

  renderPlayers() {
    const list = this.$("player-list");
    if (list) {
      list.innerHTML = this.players.map(p => `
        <div class="player-item ${p.id === this.myId ? "you" : ""}">
          <div class="avatar" style="background:${this.escapeHtml(p.color || "#7c5cfc")}">${this.escapeHtml((p.name || "?")[0].toUpperCase())}</div>
          <div style="min-width:0"><div class="pname">${this.escapeHtml(p.name)}${p.bot ? ' <span class="ptag">BOT</span>' : ""}</div>
          <div class="ptag">${p.isHost ? '<i class="fa-solid fa-crown crown"></i> host · ' : ""}${p.id === this.myId ? "you" : "player"}</div></div>
          <span class="pscore">${p.score || 0} pts</span>
        </div>`).join("");
    }
    const panel = this.$("players-panel");
    if (panel) {
      panel.innerHTML = this.players.map(p => `
        <div class="player-chip ${p.id === this.myId ? "you" : ""}">
          <span class="cdot" style="background:${this.escapeHtml(p.color || "#7c5cfc")}"></span>
          <span>${this.escapeHtml(p.name)}${p.id === this.myId ? " (you)" : ""}</span>
        </div>`).join("");
    }
    this.updateStartButton();
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
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    location.reload();
  }

  // ---------- game flow (host-authoritative) ----------
  pickNewRound() {
    this.location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
    const pool = this.players;
    this.spyId = pool[Math.floor(Math.random() * pool.length)].id;
    this.round = this.round || 1;
  }

  sendPersonalized(type) {
    // host tells each connection only what they may know (anti-cheat)
    this.connections.forEach((conn, pid) => {
      const p = this.players.find(pl => pl.id === pid);
      if (!p) return;
      const isSpy = pid === this.spyId;
      this.sendTo(conn, {
        type,
        isSpy,
        location: isSpy ? null : this.location,
        round: this.round,
        players: this.players.map(pl => ({ id: pl.id, name: pl.name, isHost: pl.isHost, score: pl.score || 0, color: pl.color, bot: !!pl.bot }))
      });
    });
  }

  startGame() {
    if (!this.isHost || this.players.length < MIN_PLAYERS) return;
    this.round = 1;
    this.pickNewRound();
    // host's own view
    this.isSpy = this.myId === this.spyId;
    this.phase = "role";
    this.votes = {}; this.myVote = null; this.spyGuess = null;
    this.chatHistory = [];
    this.sendPersonalized("gameStart");
    this.showGame();
    this.showRole();
    this.updatePhaseUI();
    this.renderPlayers();
    this.playSound("success");
    clearTimeout(this.roleTimeout);
    this.roleTimeout = setTimeout(() => this.startDiscussion(), 3500);
  }

  showGame() {
    this.$("lobby").classList.remove("active");
    this.$("game").classList.add("active");
    this.renderChat();
    this.updatePhaseUI();
  }

  showRole() {
    const banner = this.$("role-banner");
    if (this.isSpy) {
      this.$("role-title").innerHTML = `<i class="fa-solid fa-user-secret"></i> You are the <strong>Spy!</strong>`;
      this.$("location-display").textContent = "???";
      this.$("role-sub").textContent = "Listen, blend in, then guess the location.";
      banner.classList.add("spy");
    } else {
      this.$("role-title").innerHTML = `<i class="fa-solid fa-user-shield"></i> You are a Citizen`;
      this.$("location-display").textContent = this.location || "???";
      this.$("role-sub").textContent = "Blend in. Find the spy.";
      banner.classList.remove("spy");
    }
    this.$("guess-now-btn").classList.toggle("hidden", !this.isSpy);
  }

  startDiscussion() {
    if (!this.isHost || (this.phase !== "role" && this.phase !== "lobby")) return;
    this.phase = "discuss";
    this.broadcast({ type: "phase", phase: "discuss" });
    this.updatePhaseUI();
    this.startTimer(this.discussTime, () => this.startVoting());
    this.addSystemMessage("Discussion started! Ask questions to find the spy.");
  }

  startVoting() {
    if (!this.isHost || this.phase === "vote") return;
    clearTimeout(this.roleTimeout);
    this.phase = "vote";
    this.votes = {};
    this.myVote = null;
    this.broadcast({ type: "phase", phase: "vote" });
    this.updatePhaseUI();
    this.broadcastVoteCount();
    this.startTimer(this.voteTime, () => this.endVoting());
    this.openVoteModal();
    this.addSystemMessage("Voting time! Pick who you think the spy is.");
  }

  openVoteModal() {
    const modal = this.$("vote-modal");
    const options = this.$("vote-options");
    const others = this.players.filter(p => p.id !== this.myId);
    if (!others.length) return this.toast("Nobody to vote for", "error");
    options.innerHTML = others.map(p => `
      <div class="vote-option" data-id="${this.escapeHtml(p.id)}">
        <span class="avatar" style="background:${this.escapeHtml(p.color || "#7c5cfc")}">${this.escapeHtml((p.name || "?")[0].toUpperCase())}</span>
        <span>${this.escapeHtml(p.name)}${p.bot ? " (bot)" : ""}</span>
      </div>`).join("");
    this.myVote = null;
    this.$("confirm-vote").disabled = true;
    options.querySelectorAll(".vote-option").forEach(el => {
      el.onclick = () => {
        options.querySelectorAll(".vote-option").forEach(o => o.classList.remove("selected"));
        el.classList.add("selected");
        this.myVote = el.dataset.id;
        this.$("confirm-vote").disabled = false;
      };
    });
    modal.classList.remove("hidden");
  }

  hideVoteModal() { this.$("vote-modal").classList.add("hidden"); }

  submitVote() {
    if (!this.myVote) return;
    this.hideVoteModal();
    const payload = { type: "vote", id: this.myId, vote: this.myVote };
    if (this.isHost) this.recordVote(payload);
    else this.sendToHost(payload);
    this.playSound();
    this.toast("Vote locked in", "success");
  }

  recordVote(data) {
    if (!data || !data.id || !data.vote) return;
    if (!this.players.find(p => p.id === data.id)) return;
    if (!this.players.find(p => p.id === data.vote)) return;
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

    const tally = {};
    Object.values(this.votes).forEach(v => { if (v) tally[v] = (tally[v] || 0) + 1; });
    const maxVotes = Math.max(0, ...Object.values(tally));
    const eliminated = maxVotes > 0 ? Object.keys(tally).filter(id => tally[id] === maxVotes) : [];
    const spyCaught = eliminated.length === 1 && eliminated[0] === this.spyId;

    this.players.forEach(p => {
      if (p.id === this.spyId) { if (!spyCaught) p.score = (p.score || 0) + 2; }
      else if (this.votes[p.id] === this.spyId) p.score = (p.score || 0) + 1;
    });

    const results = {
      type: "results",
      spyId: this.spyId,
      spyName: this.players.find(p => p.id === this.spyId)?.name || "???",
      location: this.location,
      eliminated,
      eliminatedNames: eliminated.map(id => this.players.find(p => p.id === id)?.name || "?"),
      spyCaught,
      scores: this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0, color: p.color })),
      allowGuess: !spyCaught
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

    let html = `
      <div class="reveal-line"><i class="fa-solid fa-user-secret"></i><span>The spy was <strong>${this.escapeHtml(data.spyName || "?")}</strong></span></div>
      <div class="reveal-line"><i class="fa-solid fa-location-dot"></i><span>Location: <strong>${this.escapeHtml(data.location || "?")}</strong></span></div>`;
    if (data.eliminatedNames && data.eliminatedNames.length) {
      html += `<div class="reveal-line"><i class="fa-solid fa-check-to-slot"></i><span>Voted out: <strong>${this.escapeHtml(data.eliminatedNames.join(", "))}</strong>${data.eliminatedNames.length > 1 ? " (tie — spy survives)" : ""}</span></div>`;
    } else if (!data.guessCorrect) {
      html += `<div class="reveal-line"><i class="fa-solid fa-circle-info"></i><span>No majority — nobody eliminated.</span></div>`;
    }
    html += `<div style="margin-top:12px;font-weight:700">Scores</div>`;
    const sorted = [...(data.scores || [])].sort((a, b) => b.score - a.score);
    html += sorted.map((s, i) => `
      <div class="score-row ${i === 0 ? "winner" : ""}">
        <span class="avatar" style="background:${this.escapeHtml(s.color || "#7c5cfc")}">${this.escapeHtml((s.name || "?")[0].toUpperCase())}</span>
        <span>${i === 0 ? '<i class="fa-solid fa-trophy" style="color:var(--warning)"></i> ' : ""}${this.escapeHtml(s.name)}</span>
        <span class="pts">${s.score} pts</span>
      </div>`).join("");
    if (data.guessCorrect) html += `<p class="bonus"><i class="fa-solid fa-star"></i> Spy guessed the location (+3)!</p>`;
    if (data.allowGuess && this.isSpy) html += `<p class="bonus warn"><i class="fa-solid fa-lightbulb"></i> You escaped! Guess the location for +3.</p>`;

    content.innerHTML = html;
    this.$("results").classList.remove("hidden");
    const hostOnly = this.isHost;
    this.$("next-round-btn").style.display = hostOnly ? "flex" : "none";
    this.$("wait-host").classList.toggle("hidden", hostOnly);
    this.playSound(data.spyCaught ? "success" : "error");

    if (data.allowGuess && this.isSpy) setTimeout(() => this.openGuessModal(), 900);
  }

  openGuessModal() {
    const modal = this.$("guess-modal");
    const options = this.$("guess-options");
    this.spyGuess = null;
    this.$("confirm-guess").disabled = true;
    this.$("guess-search").value = "";
    options.innerHTML = LOCATIONS.map(loc => `<div class="vote-option" data-loc="${this.escapeHtml(loc)}"><i class="fa-solid fa-location-dot" style="color:var(--primary)"></i> ${this.escapeHtml(loc)}</div>`).join("");
    options.querySelectorAll(".vote-option").forEach(el => {
      el.onclick = () => {
        options.querySelectorAll(".vote-option").forEach(o => o.classList.remove("selected"));
        el.classList.add("selected");
        this.spyGuess = el.dataset.loc;
        this.$("confirm-guess").disabled = false;
      };
    });
    modal.classList.remove("hidden");
  }

  filterGuess(q) {
    const needle = q.trim().toLowerCase();
    this.$("guess-options").querySelectorAll(".vote-option").forEach(el => {
      el.style.display = !needle || el.dataset.loc.toLowerCase().includes(needle) ? "" : "none";
    });
  }

  submitGuess() {
    if (!this.spyGuess || !this.isSpy) return;
    this.$("guess-modal").classList.add("hidden");
    const guess = this.spyGuess;
    this.spyGuess = null;
    if (this.isHost) this.resolveGuess(guess, null);
    else this.sendToHost({ type: "guess", id: this.myId, guess });
    this.playSound();
  }

  resolveGuess(guess, conn) {
    // host-authoritative: only the real spy's guess counts
    const spyConnId = conn ? conn.peer : this.myId;
    if (spyConnId !== this.spyId) return;
    const correct = guess === this.location;
    if (correct) {
      const spy = this.players.find(p => p.id === this.spyId);
      if (spy) spy.score = (spy.score || 0) + 3;
    }
    const results = {
      type: "results",
      spyId: this.spyId,
      spyName: this.players.find(p => p.id === this.spyId)?.name || "???",
      location: this.location,
      eliminated: [],
      eliminatedNames: [],
      spyCaught: false,
      scores: this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0, color: p.color })),
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
    if (this.players.length < MIN_PLAYERS) return this.toast(`Need ${MIN_PLAYERS} players`, "error");
    this.hideResults();
    this.round++;
    this.pickNewRound();
    this.isSpy = this.myId === this.spyId;
    this.phase = "role";
    this.votes = {}; this.myVote = null; this.spyGuess = null;
    this.sendPersonalized("nextRound");
    this.showRole();
    this.updatePhaseUI();
    this.renderPlayers();
    clearTimeout(this.roleTimeout);
    this.roleTimeout = setTimeout(() => this.startDiscussion(), 3500);
  }

  endGame() {
    const scores = this.players.map(p => ({ id: p.id, name: p.name, score: p.score || 0, color: p.color }))
      .sort((a, b) => b.score - a.score);
    if (this.isHost) this.broadcast({ type: "endGame", scores });
    this.showFinalScores({ scores });
  }

  showFinalScores(data) {
    this.hideResults();
    this.hideVoteModal();
    this.phase = "reveal";
    const content = this.$("results-content");
    this.$("results-title").textContent = "Final Scores";
    this.$("results-icon").innerHTML = `<i class="fa-solid fa-trophy"></i>`;
    this.$("results-icon").style.background = "var(--warning)";
    content.innerHTML = (data.scores || []).map((s, i) => `
      <div class="score-row ${i === 0 ? "winner" : ""}">
        <span class="avatar" style="background:${this.escapeHtml(s.color || "#7c5cfc")}">${this.escapeHtml((s.name || "?")[0].toUpperCase())}</span>
        <span>${i === 0 ? '<i class="fa-solid fa-trophy" style="color:var(--warning)"></i> ' : `#${i + 1} `}${this.escapeHtml(s.name)}</span>
        <span class="pts">${s.score} pts</span>
      </div>`).join("");
    this.$("next-round-btn").style.display = "none";
    this.$("wait-host").classList.add("hidden");
    const endBtn = this.$("end-game-btn");
    endBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Back to Lobby`;
    endBtn.onclick = () => location.reload();
    this.$("results").classList.remove("hidden");
    this.playSound("success");
  }

  hideResults() { this.$("results").classList.add("hidden"); }

  // ---------- timer ----------
  startTimer(seconds, onEnd) {
    if (!this.isHost) return;
    clearInterval(this.timerInterval);
    this.timeLeft = seconds;
    this.updateTimer();
    this.timerInterval = setInterval(() => {
      this.timeLeft--;
      this.updateTimer();
      this.broadcast({ type: "timer", time: this.timeLeft });
      if (this.timeLeft === 10) this.playSound("tick");
      if (this.timeLeft <= 0) {
        clearInterval(this.timerInterval);
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
    const labels = {
      lobby: ["fa-ticket", "Lobby"], role: ["fa-eye", "Role Reveal"],
      discuss: ["fa-comments", "Discussion"], vote: ["fa-check-to-slot", "Voting"],
      reveal: ["fa-flag", "Results"], spyguess: ["fa-map-location-dot", "Spy Guessing"]
    };
    const [icon, label] = labels[this.phase] || ["fa-gamepad", this.phase];
    this.$("phase-label").innerHTML = `<i class="fa-solid ${icon}"></i> <span id="phase-text">${this.escapeHtml(label)}</span>`;
    this.$("round-label").innerHTML = `<i class="fa-solid fa-rotate"></i> R${this.round}`;
    this.updateTimer();
  }

  // ---------- chat (dedup + host relay) ----------
  sendChat() {
    const input = this.$("chat-input");
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
    this.playSound();
  }

  addChatMessage(name, message, isOwn, time, isSys = false) {
    const entry = { name: String(name || "?").slice(0, 16), message: String(message || "").slice(0, 180), isOwn: !!isOwn, time: time || "", sys: !!isSys };
    this.chatHistory.push(entry);
    if (this.chatHistory.length > 120) this.chatHistory.shift();
    this.renderChat();
  }

  addSystemMessage(text) {
    this.addChatMessage("System", text, false, "", true);
  }

  renderChat() {
    const container = this.$("chat-messages");
    container.innerHTML = this.chatHistory.map(m => {
      if (m.sys) return `<div class="chat-msg sys"><i class="fa-solid fa-circle-info"></i> ${this.escapeHtml(m.message)}</div>`;
      return `<div class="chat-msg ${m.isOwn ? "own" : "other"}">
        <div class="sender">${this.escapeHtml(m.name)}</div>
        ${this.escapeHtml(m.message)}
        ${m.time ? `<div class="time">${this.escapeHtml(m.time)}</div>` : ""}
      </div>`;
    }).join("");
    container.scrollTop = container.scrollHeight;
  }

  clearChat() {
    this.chatHistory = [];
    this.renderChat();
  }
}

window.addEventListener("load", () => { window.game = new Game(); });
