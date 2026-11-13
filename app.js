/* Sta. Rita Accounting Office — Christmas Online Manito & Manita (frontend)
   Talks to the Google Apps Script backend set in config.js. */
"use strict";

const CFG = window.SRAO_CONFIG || {};
const API = CFG.API_URL || "";
const TZ = "Asia/Manila";
const MAX_WISHES = 5, MAX_PHOTOS = 3, AVATARS = 20;
const MARK = "assets/mark.png", POSTER = "assets/poster.jpg", SLIDE_MS = 3000;
const SUGGESTIONS = ["Something Sweet", "Something Soft", "Something Red", "Something Hot", "Something Green", "Something Long",
  "Something Round", "Something Useful", "Something Handmade", "Something Personal", "Something to Read", "Something Pinoy"];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
};

const S = {
  token: store.get("srao_token"), adminToken: store.get("srao_admin"),
  loaded: false, fatal: null,
  settings: {}, weeks: [], participants: {}, order: [], me: null, myPick: null, wheelIds: [], canSpin: false, joined: 0, spunCount: 0,
  admin: null, view: "home", authMode: "new",
  draft: null, dirtyProfile: false, weeksDraft: null, weeksDirty: false, setDraft: null, setDirty: false,
  showPairs: false, uploading: 0, spinning: false, rolling: false, wheelRot: 0, busy: 0
};

/* ---------- helpers ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled") el[k] = !!v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(4)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
function fmtDate(d) {
  if (!d) return "";
  try { return new Date(d + "T12:00:00+08:00").toLocaleDateString("en-PH", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }); } catch (e) { return d; }
}
function daysUntil(d) { if (!d) return null; return Math.round((new Date(d + "T00:00:00+08:00") - new Date(todayStr() + "T00:00:00+08:00")) / 86400000); }
const roleOf = g => g === "F" ? "Manita" : "Manito";
/* Animated avatar: each sprite holds 3 frames (eyes open, blinking, happy smiling eyes). */
function avatarEl(n, size, label) {
  const k = Math.floor(Number(n));
  if (!(k >= 1 && k <= AVATARS)) return h("span", { class: "av av-empty", style: "--s:" + size + "px", "aria-hidden": "true" });
  const delay = -((k * 1.37) % 7).toFixed(2);
  return h("span", { class: "av", role: label ? "img" : null, "aria-label": label || null, "aria-hidden": label ? null : "true",
    style: "--s:" + size + "px;--d:" + delay + "s;--img:url('assets/avatars/avatar-" + String(k).padStart(2, "0") + ".jpg')" }, h("span", { class: "av-face" }));
}
const photoUrl = id => "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w1200";
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function rid() { return Math.random().toString(36).slice(2, 10); }
function toast(msg, ms) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms || 3500); }
function busy(d) { S.busy += d; document.getElementById("busy").classList.toggle("on", S.busy > 0); }
function sortedWeeks(list) { return (list || []).slice().sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")); }
function weekStatus(weeks) {
  const t = todayStr(); let nextId = null;
  for (const w of weeks) if (w.date && w.date >= t) { nextId = w.id; break; }
  return w => (w.date && w.date < t) ? "past" : (w.id === nextId ? "next" : "soon");
}
function wheelLabel(id) { const p = S.participants[id]; const s = p ? p.alias : "?"; return s.length > 16 ? s.slice(0, 15) + "…" : s; }

/* ---------- API ---------- */
async function api(action, payload, quiet) {
  if (!API || /PASTE_YOUR/.test(API)) throw new Error("The app isn't connected yet. Put your Apps Script web app URL in config.js.");
  if (!quiet) busy(1);
  try {
    const body = JSON.stringify(Object.assign({ action, token: S.token || "", adminToken: S.adminToken || "" }, payload || {}));
    let res;
    try { res = await fetch(API, { method: "POST", body, headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow" }); }
    catch (e) { throw new Error("Can't reach the server. Check your internet connection and try again."); }
    let j; try { j = await res.json(); } catch (e) { throw new Error("The server sent an unexpected reply. Check that the web app is deployed for Anyone."); }
    if (!j.ok) {
      if (j.signedOut) { S.token = null; store.set("srao_token", null); S.me = null; S.draft = null; }
      if (j.adminSignedOut) { S.adminToken = null; store.set("srao_admin", null); S.admin = null; }
      throw new Error(j.error || "Something went wrong.");
    }
    if (j.state) applyState(j.state);
    if (j.admin) S.admin = j.admin;
    return j;
  } finally { if (!quiet) busy(-1); }
}
function applyState(st) {
  S.settings = st.settings || {}; S.weeks = st.weeks || []; S.joined = st.joined || 0; S.spunCount = st.spunCount || 0;
  S.participants = {}; S.order = [];
  (st.participants || []).forEach(p => { S.participants[p.id] = p; S.order.push(p.id); });
  S.me = st.me || null; S.myPick = st.myPick || null; S.wheelIds = st.wheel || []; S.canSpin = !!st.canSpin;
  S.revealed = !!st.revealed; S.reveal = st.reveal || []; S.carousel = st.carousel || [];
  if (S.me && !S.dirtyProfile) S.draft = null;
  S.loaded = true;
}
async function act(action, payload, okMsg) {
  try { const j = await api(action, payload); if (okMsg) toast(okMsg); render(); return j; }
  catch (e) { toast(e.message, 5500); render(); return null; }
}

/* ---------- dialogs ---------- */
function modal(title, body, okLabel, danger, input) {
  return new Promise(res => {
    let field = null;
    const close = v => { ov.remove(); res(v); };
    if (input) field = h("input", { type: "text", id: "dlgInput", inputmode: input.inputmode || null, maxlength: input.maxlength || null, placeholder: input.placeholder || "", "aria-label": input.label });
    const ov = h("div", { class: "overlay", onclick: e => { if (e.target === ov) close(false); } },
      h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("h3", { text: title }), h("div", { class: "sub" }, body), field,
        h("div", { class: "row" }, h("span", { class: "spacer" }),
          h("button", { class: "btn", onclick: () => close(false) }, "Cancel"),
          h("button", { class: "btn " + (danger ? "danger" : "primary"), id: "dlgOk", onclick: () => close(field ? field.value : true) }, okLabel))));
    document.body.append(ov); (field || ov.querySelector("#dlgOk")).focus();
    ov.addEventListener("keydown", e => { if (e.key === "Escape") close(false); if (e.key === "Enter" && field) close(field.value); });
  });
}
function lightbox(src) {
  const ov = h("div", { class: "overlay lightbox", onclick: () => ov.remove(), tabindex: "-1" }, h("img", { src, alt: "Wish list sample photo", referrerpolicy: "no-referrer" }));
  ov.addEventListener("keydown", e => { if (e.key === "Escape") ov.remove(); });
  document.body.append(ov); ov.focus();
}
function photoStrip(ids) {
  if (!ids || !ids.length) return null;
  return h("div", { class: "photos" }, ids.map(id => h("div", { class: "ph" },
    h("img", { src: photoUrl(id), alt: "Wish list sample", loading: "lazy", referrerpolicy: "no-referrer", onclick: () => lightbox(photoUrl(id)), onerror: e => { e.target.replaceWith(h("span", { class: "hint", text: "Photo unavailable" })); } }))));
}
function wishList(p) {
  const items = (p.wishes || []).filter(w => w && w.text);
  if (!items.length) return h("p", { class: "hint", text: "No wishes listed yet." });
  return h("ol", { class: "wishes" }, items.map(w => h("li", null, w.text,
    w.link && /^https?:\/\//i.test(w.link) ? [" · ", h("a", { href: w.link, target: "_blank", rel: "noopener" }, "see item")] : null)));
}

/* ---------- rendering (never rebuild while someone is typing) ---------- */
let renderPending = false;
const typing = () => { const a = document.activeElement; return a && a.closest && a.closest("#main, .dialog") && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== "checkbox" && a.type !== "radio" && a.type !== "file"; };
function scheduleRender() { if (S.rolling || typing()) { renderPending = true; return; } render(); }
document.addEventListener("focusout", () => { if (!renderPending) return; setTimeout(() => { if (renderPending && !typing() && !S.rolling) render(); }, 300); });

const VIEWS = [["big-reveal", "Big Reveal"], ["home", "Home"], ["my-profile", "My Profile & Wish List"], ["spin-wheel", "Spin the Wheel"], ["weekly-gifts", "Weekly Gifts"], ["wish-wall", "Wish Wall"], ["admin", "Organizer"]];
function renderTabs() {
  const box = document.getElementById("tabs"); box.replaceChildren();
  for (const [id, label] of VIEWS) {
    if (id === "admin" && !S.adminToken && S.view !== "admin") continue;
    if (id === "big-reveal" && !S.revealed) continue;
    box.append(h("button", { class: "tab", "aria-current": S.view === id ? "page" : null, onclick: () => { location.hash = id; } }, label));
  }
}
function renderHeader() {
  const st = S.settings || {};
  document.getElementById("evtTitle").textContent = st.eventName || "Online Manito & Manita";
  const chips = document.getElementById("headChips"); chips.replaceChildren();
  if (!S.loaded) return;
  chips.append(h("span", { class: "chip" }, S.joined + " staff joined"));
  if (st.budget) chips.append(h("span", { class: "chip" }, "Budget ₱" + Number(st.budget).toLocaleString("en-PH") + " per gift"));
  const d = daysUntil(st.partyDate);
  if (d != null) chips.append(h("span", { class: "chip gold" }, d > 1 ? d + " days to the reveal party" : d === 1 ? "Reveal party is tomorrow" : d === 0 ? "Reveal party is today!" : "Reveal party: " + fmtDate(st.partyDate)));
  if (S.revealed) chips.append(h("span", { class: "chip gold" }, "Reveal day: names unsealed"));
  else chips.append(h("span", { class: "chip" }, st.wheelOpen ? "Wheel is open: " + S.spunCount + " of " + S.joined + " spun" : (st.registrationOpen === false ? "Registration closed" : "Registration open")));
}
function render() {
  renderPending = false;
  renderTabs(); renderHeader();
  const main = document.getElementById("main"); const y = window.scrollY;
  main.replaceChildren(...[viewBody()].flat(4).filter(Boolean));
  window.scrollTo(0, y);
}
function viewBody() {
  if (S.view === "admin") return viewAdmin();
  if (S.fatal) return h("div", { class: "panel" }, h("div", { class: "notice warn", text: S.fatal }));
  if (!S.loaded) return h("div", { class: "panel" }, h("p", { class: "sub", text: "Loading the exchange…" }));
  switch (S.view) {
    case "my-profile": return viewProfile();
    case "spin-wheel": return viewWheel();
    case "weekly-gifts": return viewWeeks();
    case "wish-wall": return viewWall();
    case "big-reveal": return viewReveal();
    default: return viewHome();
  }
}

/* ---- Landing ---- */
/* Landing carousel: pictures from the "Carousel" sheet, one every 3 seconds. Built once and kept
   across re-renders so the slideshow doesn't restart every time data refreshes. */
function heroCarousel() {
  const urls = (S.carousel && S.carousel.length) ? S.carousel : [POSTER];
  const key = urls.join("|");
  if (S.hero && S.hero.key === key) return S.hero.el;
  if (S.hero) clearInterval(S.hero.timer);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const slides = urls.map((u, i) => h("img", { class: "slide" + (i === 0 ? " on" : ""), src: u, alt: "Sta. Rita Accounting Office photo " + (i + 1) + " of " + urls.length,
    loading: i < 2 ? "eager" : "lazy", referrerpolicy: "no-referrer", onerror: e => { e.target.classList.add("broken"); } }));
  const dots = urls.length > 1 ? h("div", { class: "dots", role: "tablist", "aria-label": "Choose a picture" },
    urls.map((u, i) => h("button", { class: "dot", role: "tab", "aria-label": "Picture " + (i + 1), "aria-selected": i === 0 ? "true" : "false", onclick: () => { go(i); restart(); } }))) : null;
  const el = h("div", { class: "hero carousel", "aria-roledescription": "carousel", "aria-label": "SRAO through the Years" }, slides, dots);
  const state = { key, el, i: 0, timer: null };
  const go = i => {
    const n = slides.length; if (!n) return;
    let k = ((i % n) + n) % n, guard = 0;
    while (slides[k].classList.contains("broken") && guard++ < n) k = (k + 1) % n;
    slides.forEach((s, j) => s.classList.toggle("on", j === k));
    if (dots) dots.querySelectorAll(".dot").forEach((d, j) => d.setAttribute("aria-selected", j === k ? "true" : "false"));
    state.i = k;
  };
  const restart = () => { clearInterval(state.timer); if (!reduce && slides.length > 1) state.timer = setInterval(() => { if (!document.hidden && S.view === "home") go(state.i + 1); }, SLIDE_MS); };
  el.addEventListener("mouseenter", () => clearInterval(state.timer));
  el.addEventListener("mouseleave", restart);
  restart();
  S.hero = state;
  return el;
}
function viewHome() {
  const st = S.settings, mine = S.me, pick = S.myPick;
  const go = v => () => { location.hash = v; };
  let lead, cta;
  if (S.revealed) { lead = "It\u2019s the Christmas party! Real names are unsealed. See who gave to whom."; cta = h("button", { class: "btn gold", onclick: go("big-reveal") }, "See the big reveal"); }
  else if (!mine) { lead = "Join with your alias and wish list, then spin the wheel to find out who you'll surprise every week until the reveal party."; cta = h("button", { class: "btn gold", onclick: go("my-profile") }, "Join or sign in"); }
  else if (pick) { lead = "You've spun the wheel. Check your Manito or Manita's wish list and this week's theme."; cta = h("button", { class: "btn gold", onclick: go("spin-wheel") }, "See who you picked"); }
  else if (st.wheelOpen) { lead = "The wheel is open! Everyone who joined is on it except you. One spin each."; cta = h("button", { class: "btn gold", onclick: go("spin-wheel") }, "Spin the wheel"); }
  else { lead = "You're in. The organizer will open the wheel once everyone has joined. Keep your wish list up to date meanwhile."; cta = h("button", { class: "btn gold", onclick: go("my-profile") }, "Update my wish list"); }
  const hero = h("section", { class: "years" }, h("h2", { class: "years-title", text: "SRAO through the Years" }), heroCarousel());
  const bar = h("section", { class: "panel cta-bar" }, h("p", { class: "sub", text: lead }),
    h("div", { class: "row" }, cta, h("button", { class: "btn", onclick: go("weekly-gifts") }, "Weekly gift themes")));
  const weeks = sortedWeeks(S.weeks); const stOf = weekStatus(weeks); const nx = weeks.find(w => stOf(w) === "next");
  const d = daysUntil(st.partyDate);
  const stats = h("div", { class: "stats" },
    h("div", { class: "stat" }, h("b", { text: String(S.joined) }), h("span", { text: "staff joined" })),
    h("div", { class: "stat" }, h("b", { text: st.wheelOpen ? S.spunCount + "/" + S.joined : "Soon" }), h("span", { text: st.wheelOpen ? "have spun the wheel" : "wheel opens" })),
    h("div", { class: "stat" }, h("b", { text: d == null ? "TBA" : d < 0 ? "Done" : String(d) }), h("span", { text: d == null ? "reveal party date" : "days to the reveal party" })),
    h("div", { class: "stat" }, h("b", { style: "font-size:1.25rem;line-height:1.3;padding:6px 0", text: nx ? nx.theme : "TBA" }), h("span", { text: nx && nx.date ? "next gift · " + fmtDate(nx.date) : "next gift theme" })));
  const how = h("section", { class: "panel" }, h("h2", { text: "How it works" }), h("div", { class: "steps" },
    h("div", { class: "step" }, h("span", { class: "num" }, "1"), h("div", null, h("b", { text: "Join" }), h("span", { text: "Create a username and PIN, then enter your name, a secret alias, gender, a clue about yourself and your wish list." }))),
    h("div", { class: "step" }, h("span", { class: "num" }, "2"), h("div", null, h("b", { text: "Spin the wheel" }), h("span", { text: "Everyone who joined is on the wheel by alias, except you. Where it stops is your Manito or Manita: you get their alias and a clue." }))),
    h("div", { class: "step" }, h("span", { class: "num" }, "3"), h("div", null, h("b", { text: "Give every week" }), h("span", { text: "Follow each week's “Something…” theme, sign gifts with your alias, and reveal yourself at the party." })))));
  return [hero, bar, stats, how];
}

/* ---- Profile, join and sign-in ---- */
function ensureDraft() {
  if (S.draft) return;
  const m = S.me;
  S.draft = m ? { name: m.name, alias: m.alias, gender: m.gender, avatar: m.avatar || 0, clue: m.clue || "", wishes: clone(m.wishes || []), notes: m.notes || "" }
    : { username: "", pin: "", name: "", alias: "", gender: "", avatar: 0, clue: "", wishes: [], notes: "" };
  while (S.draft.wishes.length < 3) S.draft.wishes.push({ text: "", link: "" });
}
function viewProfile() {
  const panel = h("section", { class: "panel" });
  const mine = S.me, st = S.settings;
  if (!mine && S.authMode === "login") return viewLogin(panel);
  ensureDraft();
  const d = S.draft;
  panel.append(h("div", { class: "panel-head" },
    h("div", null, h("h2", { text: mine ? "Your profile & wish list" : "Join the exchange" }),
      h("p", { class: "sub", text: "Your alias is your codename: sign your weekly gifts with it so your Manito or Manita never finds out who you are until the party." })),
    mine ? h("div", { class: "row" }, avatarEl(mine.avatar, 44), h("span", { class: "tag " + (mine.gender === "F" ? "f" : "") }, "Signed in as " + mine.username), h("button", { class: "btn", onclick: signOut }, "Sign out"))
      : h("div", { class: "seg", role: "group", "aria-label": "Join or sign in" },
        h("button", { "aria-pressed": "true" }, "I'm new"), h("button", { "aria-pressed": "false", onclick: () => { S.authMode = "login"; render(); } }, "I already joined"))));
  if (!mine && st.registrationOpen === false) { panel.append(h("div", { class: "notice warn", text: "Registration is closed. Ask the organizer if you still want to join." })); return panel; }
  if (mine && S.myPick) panel.append(h("div", { class: "notice", text: "You've spun the wheel. You can still update your wish list; your Manito or Manita sees the changes." }));
  const mark = () => { S.dirtyProfile = true; };
  if (!mine) panel.append(h("div", { class: "grid2" },
    h("div", { class: "field" }, h("label", { for: "fUser" }, "Username"),
      h("input", { type: "text", id: "fUser", value: d.username, maxlength: "30", autocomplete: "username", placeholder: "e.g. maria.santos", oninput: e => { d.username = e.target.value; } }),
      h("span", { class: "hint", text: "3 to 30 letters, numbers, dots or dashes. You'll use it to sign in." })),
    h("div", { class: "field" }, h("label", { for: "fPin" }, "PIN (4 to 6 digits)"),
      h("input", { type: "password", id: "fPin", value: d.pin, inputmode: "numeric", maxlength: "6", autocomplete: "new-password", oninput: e => { d.pin = e.target.value.replace(/\D/g, ""); e.target.value = d.pin; } }),
      h("span", { class: "hint", text: "Keep it secret. The organizer can reset it if you forget." }))));
  panel.append(h("div", { class: "grid2" },
    h("div", { class: "field" }, h("label", { for: "fName" }, "Your full name"),
      h("input", { type: "text", id: "fName", value: d.name, maxlength: "60", placeholder: "e.g. Maria Santos", autocomplete: "name", oninput: e => { d.name = e.target.value; mark(); } }),
      h("span", { class: "hint", text: "Sealed: nobody, not even the organizer, can see it until the Christmas party." })),
    h("div", { class: "field" }, h("label", { for: "fAlias" }, "Alias / codename"),
      h("input", { type: "text", id: "fAlias", value: d.alias, maxlength: "30", placeholder: "e.g. Ledger Elf", oninput: e => { d.alias = e.target.value; mark(); } }),
      h("span", { class: "hint", text: "Shown on the Wish Wall. Keep it fun and secret." }))));
  const opts = h("div", { class: "gender", role: "radiogroup", "aria-labelledby": "gLbl" });
  [["M", "Male", "You'll be called a Manito", "m"], ["F", "Female", "You'll be called a Manita", "f"]].forEach(([v, lab, sub, cls]) => {
    opts.append(h("label", { class: cls + (d.gender === v ? " on" : ""), for: "g" + v },
      h("input", { type: "radio", name: "gender", id: "g" + v, value: v, checked: d.gender === v, onchange: () => { d.gender = v; mark(); opts.querySelectorAll("label").forEach(l => l.classList.toggle("on", l.htmlFor === "g" + v)); } }),
      h("span", null, h("b", { text: lab }), h("small", { text: sub }))));
  });
  panel.append(h("div", { class: "field" }, h("span", { class: "legend", id: "gLbl" }, "Gender"), opts));
  const pick = h("div", { class: "av-pick", role: "radiogroup", "aria-labelledby": "avLbl" });
  for (let k = 1; k <= AVATARS; k++) {
    pick.append(h("button", { type: "button", class: "av-opt", role: "radio", "aria-checked": d.avatar === k ? "true" : "false", "aria-label": "Avatar " + k,
      onclick: e => { d.avatar = k; mark(); pick.querySelectorAll(".av-opt").forEach(b => b.setAttribute("aria-checked", b === e.currentTarget ? "true" : "false")); } }, avatarEl(k, 64)));
  }
  panel.append(h("div", { class: "field" }, h("span", { class: "legend", id: "avLbl" }, "Choose your avatar"),
    h("span", { class: "hint", text: "This is how you appear on the Wish Wall and to whoever spins you." }), pick));

  const rows = h("div", { style: "display:grid;gap:8px" });
  const drawRows = () => rows.replaceChildren(...d.wishes.map((w, i) => h("div", { class: "wish-row" },
    h("span", { class: "n", text: String(i + 1) }),
    h("input", { type: "text", id: "w" + i, "aria-label": "Wish " + (i + 1), value: w.text, maxlength: "120", placeholder: i === 0 ? "e.g. Tumbler (any pastel color)" : "Another wish", oninput: e => { w.text = e.target.value; mark(); } }),
    h("input", { type: "url", class: "link", id: "wl" + i, "aria-label": "Link for wish " + (i + 1), value: w.link || "", maxlength: "300", placeholder: "Link (optional)", oninput: e => { w.link = e.target.value.trim(); mark(); } }),
    h("button", { class: "btn icon danger", title: "Remove wish", "aria-label": "Remove wish " + (i + 1), onclick: () => { d.wishes.splice(i, 1); mark(); drawRows(); } }, "✕"))));
  drawRows();
  panel.append(h("div", { class: "field" }, h("span", { class: "legend" }, "Wish list"),
    h("span", { class: "hint", text: "Up to " + MAX_WISHES + " gift ideas. Add a shop link if you have one." }), rows,
    h("div", null, h("button", { class: "btn", onclick: () => { if (d.wishes.length >= MAX_WISHES) return toast("You can list up to " + MAX_WISHES + " wishes."); d.wishes.push({ text: "", link: "" }); drawRows(); rows.querySelector("#w" + (d.wishes.length - 1)).focus(); } }, "+ Add a wish"))));
  panel.append(h("div", { class: "field" }, h("label", { for: "fClue" }, "Your clue: who are you?"),
    h("textarea", { id: "fClue", maxlength: "200", placeholder: "e.g. I'm always the first one in the office and I never skip my 3 pm coffee.", oninput: e => { d.clue = e.target.value; mark(); } }, d.clue || ""),
    h("span", { class: "hint", text: "Whoever spins you sees only your alias and this clue. Make it fun to guess, but not too easy!" })));
  panel.append(h("div", { class: "field" }, h("label", { for: "fNotes" }, "Sizes, favorite colors, and things to avoid"),
    h("textarea", { id: "fNotes", maxlength: "500", placeholder: "e.g. Shirt size M, loves blue, allergic to peanuts", oninput: e => { d.notes = e.target.value; mark(); } }, d.notes || "")));

  const pf = h("div", { class: "field" }, h("span", { class: "legend" }, "Wish list sample photos"),
    h("span", { class: "hint", text: "Up to " + MAX_PHOTOS + " pictures of items you'd like, so your Manito or Manita knows exactly what to look for." }));
  if (mine) {
    const strip = h("div", { class: "photos" });
    (mine.photos || []).forEach((id, i) => strip.append(h("div", { class: "ph" },
      h("img", { src: photoUrl(id), alt: "Your wish sample " + (i + 1), referrerpolicy: "no-referrer", onclick: () => lightbox(photoUrl(id)) }),
      h("button", { class: "x", "aria-label": "Remove photo " + (i + 1), onclick: () => removePhoto(id) }, "✕"))));
    for (let i = 0; i < S.uploading; i++) strip.append(h("div", { class: "ph busy" }, "Uploading…"));
    if ((mine.photos || []).length + S.uploading < MAX_PHOTOS)
      strip.append(h("label", { class: "ph add", for: "fPhoto" }, "+ Add photo"), h("input", { type: "file", id: "fPhoto", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, hidden: true, onchange: e => uploadPhotos(e.target.files) }));
    pf.append(strip);
  } else pf.append(h("p", { class: "hint", text: "You can add photos right after you join." }));
  panel.append(pf);
  panel.append(h("div", { class: "row" }, h("button", { class: "btn primary", id: "saveProfile", onclick: saveProfile }, mine ? "Save changes" : "Join the exchange")));
  return panel;
}
function viewLogin(panel) {
  const f = S.loginDraft || (S.loginDraft = { username: "", pin: "" });
  panel.append(h("div", { class: "panel-head" }, h("div", null, h("h2", { text: "Sign in" }), h("p", { class: "sub", text: "Use the username and PIN you chose when you joined." })),
    h("div", { class: "seg", role: "group", "aria-label": "Join or sign in" },
      h("button", { "aria-pressed": "false", onclick: () => { S.authMode = "new"; render(); } }, "I'm new"), h("button", { "aria-pressed": "true" }, "I already joined"))));
  const submit = async e => {
    e.preventDefault();
    try { const j = await api("login", { username: f.username, pin: f.pin }); S.token = j.token; store.set("srao_token", j.token); S.loginDraft = null; S.draft = null; toast("Welcome back, " + (S.me ? S.me.alias : "") + "!"); render(); }
    catch (err) { toast(err.message, 5000); }
  };
  panel.append(h("form", { class: "grid2", onsubmit: submit },
    h("div", { class: "field" }, h("label", { for: "lUser" }, "Username"), h("input", { type: "text", id: "lUser", value: f.username, autocomplete: "username", oninput: e => { f.username = e.target.value; } })),
    h("div", { class: "field" }, h("label", { for: "lPin" }, "PIN"), h("input", { type: "password", id: "lPin", value: f.pin, inputmode: "numeric", maxlength: "6", autocomplete: "current-password", oninput: e => { f.pin = e.target.value; } })),
    h("div", null, h("button", { class: "btn primary", type: "submit" }, "Sign in"))));
  panel.append(h("p", { class: "hint", text: "Forgot your PIN? Ask the organizer to reset it." }));
  return panel;
}
async function saveProfile() {
  const d = S.draft;
  const payload = { name: (d.name || "").trim(), alias: (d.alias || "").trim(), gender: d.gender, avatar: d.avatar, clue: (d.clue || "").trim(), notes: (d.notes || "").trim(),
    wishes: d.wishes.map(w => ({ text: (w.text || "").trim(), link: (w.link || "").trim() })).filter(w => w.text) };
  if (!payload.name) return toast("Please enter your full name.");
  if (!payload.alias) return toast("Please choose an alias.");
  if (!payload.gender) return toast("Please select your gender.");
  if (!payload.avatar) return toast("Pick an avatar for your profile.");
  if (!payload.clue) return toast("Give a clue about who you are, so your Manito or Manita can guess.");
  if (!payload.wishes.length) return toast("Add at least one wish to your list.");
  const btn = document.getElementById("saveProfile"); if (btn) btn.disabled = true;
  try {
    if (S.me) { await api("saveProfile", payload); toast("Saved. Your wish list is up to date."); }
    else {
      const j = await api("register", Object.assign({ username: (d.username || "").trim(), pin: d.pin }, payload));
      S.token = j.token; store.set("srao_token", j.token);
      toast("You're in! Add sample photos below, then spin the wheel once it opens.", 5000);
    }
    S.dirtyProfile = false; S.draft = null;
  } catch (e) { toast(e.message, 5500); }
  render();
}
async function compress(file, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, (maxSide || 1280) / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}
async function uploadPhotos(files) {
  const room = MAX_PHOTOS - (S.me.photos || []).length - S.uploading;
  const list = Array.from(files || []).slice(0, room);
  if (!list.length) return toast("You can upload up to " + MAX_PHOTOS + " photos.");
  S.uploading += list.length; scheduleRender();
  for (const f of list) {
    try { const dataUrl = await compress(f); await api("uploadPhoto", { dataUrl }); toast("Photo added."); }
    catch (e) { toast(e.message && e.message !== "[object Event]" ? e.message : "Couldn't read that image. Try a JPG or PNG.", 5000); }
    S.uploading--; scheduleRender();
  }
}
async function removePhoto(id) { await act("deletePhoto", { photoId: id }, "Photo removed."); }
async function signOut() {
  try { await api("logout"); } catch (e) {}
  S.token = null; store.set("srao_token", null); S.me = null; S.myPick = null; S.draft = null; S.authMode = "login";
  toast("Signed out."); render();
}

/* ---- Spin the wheel ---- */
const WHEEL_COLORS = ["#17345f", "#2386d0", "#f4b21b", "#ec7421", "#1d7a4c", "#d9548a"];
function drawWheel(cv, labels, rot) {
  const dpr = window.devicePixelRatio || 1, size = cv.clientWidth || 380;
  if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
  const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, size, size);
  const c = size / 2, R = c - 8;
  x.beginPath(); x.arc(c, c, R + 6, 0, 2 * Math.PI); x.fillStyle = "#0f2442"; x.fill();
  if (!labels.length) { x.beginPath(); x.arc(c, c, R, 0, 2 * Math.PI); x.fillStyle = "#dce4ee"; x.fill(); return; }
  const n = labels.length, a = 2 * Math.PI / n;
  for (let i = 0; i < n; i++) {
    const s = -Math.PI / 2 + rot + i * a;
    let col = WHEEL_COLORS[i % WHEEL_COLORS.length]; if (n > 1 && i === n - 1 && i % WHEEL_COLORS.length === 0) col = WHEEL_COLORS[3];
    x.beginPath(); x.moveTo(c, c); x.arc(c, c, R, s, s + a); x.closePath(); x.fillStyle = col; x.fill();
    x.strokeStyle = "rgba(255,255,255,.85)"; x.lineWidth = 2; x.stroke();
    x.save(); x.translate(c, c); x.rotate(s + a / 2);
    const fs = Math.max(11, Math.min(19, R * a * 0.42, 260 / Math.max(6, labels[i].length)));
    x.font = "700 " + fs + "px Figtree, system-ui, sans-serif"; x.textAlign = "right"; x.textBaseline = "middle";
    x.fillStyle = col === "#f4b21b" ? "#3a2800" : "#ffffff"; x.fillText(labels[i], R - 14, 0); x.restore();
  }
}
function animateWheel(cv, labels, idx, done) {
  const n = labels.length, a = 2 * Math.PI / n, TAU = 2 * Math.PI;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = S.wheelRot || 0;
  const target = -(idx + 0.5) * a + (Math.random() - 0.5) * a * 0.6;
  const end = target + TAU * Math.ceil((start - target) / TAU) + (reduce ? 1 : 6) * TAU;
  const dur = reduce ? 700 : 5600, t0 = performance.now();
  const frame = now => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
    drawWheel(cv, labels, start + (end - start) * e);
    if (p < 1) requestAnimationFrame(frame); else { S.wheelRot = end % TAU; done(); }
  };
  requestAnimationFrame(frame);
}
function viewWheel() {
  const mine = S.me, st = S.settings;
  const panel = h("section", { class: "panel" });
  if (!mine) {
    panel.append(h("h2", { text: "Spin the Wheel" }), h("div", { class: "notice", text: "Join or sign in first, then come back to spin." }),
      h("div", null, h("button", { class: "btn primary", onclick: () => { location.hash = "my-profile"; } }, "Join or sign in")));
    return panel;
  }
  if (S.myPick && !S.rolling) return revealCard(panel, mine, S.myPick);
  const cands = S.wheelIds.filter(id => S.participants[id] && id !== mine.id);
  const labels = cands.map(wheelLabel);
  panel.append(h("div", { class: "panel-head" }, h("div", null, h("h2", { text: "Spin the Wheel" }),
    h("p", { class: "sub", text: "Everyone who joined is on the wheel except you, so you can never land on your own name. Names stay on the wheel even after someone picks them, but the wheel never lands on a name that's already taken. You get one spin." }))));
  if (!st.wheelOpen) panel.append(h("div", { class: "notice", text: "The wheel isn't open yet. The organizer opens it once everyone has joined. Here's a preview of who's on your wheel so far." }));
  else if (!S.canSpin) panel.append(h("div", { class: "notice warn", text: "There's no name left for you to land on. The organizer will add you to the exchange." }));
  const cv = h("canvas", { role: "img", "aria-label": "Wheel with " + cands.length + " names" });
  const btn = h("button", { class: "btn gold spin-btn", disabled: !st.wheelOpen || !S.canSpin || S.spinning, onclick: () => spin(cv, btn) }, S.spinning ? "Spinning…" : "Spin the wheel");
  const roller = h("div", { class: "roller", "aria-live": "polite" });
  panel.append(h("div", { class: "wheel-wrap" },
    h("div", { class: "wheel-box" }, h("span", { class: "pointer", "aria-hidden": "true" }), cv, h("div", { class: "hub" }, h("img", { src: MARK, alt: "" }))),
    btn, roller,
    h("p", { class: "hint", text: cands.length + (cands.length === 1 ? " name" : " names") + " on your wheel" })));
  requestAnimationFrame(() => drawWheel(cv, labels, S.wheelRot || 0));
  S._wheel = { cv, labels, cands, roller };
  return panel;
}
async function spin(cv, btn) {
  if (S.spinning) return;
  S.spinning = true; btn.disabled = true; btn.textContent = "Spinning…";
  const w = S._wheel;
  // Start turning right away so the wait for the server feels like part of the spin.
  let idle = true, rot = S.wheelRot || 0, last = performance.now();
  const idleSpin = now => { if (!idle) return; rot += (now - last) / 1000 * 7; last = now; drawWheel(cv, w.labels, rot); requestAnimationFrame(idleSpin); };
  S.rolling = true; requestAnimationFrame(idleSpin);
  let res;
  try { res = await api("spin", null, true); }
  catch (e) { idle = false; S.wheelRot = rot % (2 * Math.PI); S.rolling = false; S.spinning = false; toast(e.message, 5500); render(); return; }
  idle = false; S.wheelRot = rot % (2 * Math.PI);
  // Same wheel the person sees: every name except their own. It slows down on the name the server picked.
  let cands = w.cands.slice();
  if (!cands.includes(res.receiverId)) cands = cands.concat(res.receiverId);
  const labels = cands.map(wheelLabel);
  animateWheel(cv, labels, cands.indexOf(res.receiverId), () => {
    const rec = S.participants[res.receiverId];
    w.roller.textContent = rec ? rec.alias : "";
    setTimeout(() => { S.rolling = false; S.spinning = false; render(); toast("Your " + roleOf(rec && rec.gender) + " is " + (rec ? rec.alias : "ready") + "!", 5000); }, 1600);
  });
}
function revealCard(panel, mine, pick) {
  const rec = S.participants[pick];
  if (!rec) { panel.append(h("h2", { text: "Your Manito / Manita" }), h("div", { class: "notice warn", text: "The person you picked has left the exchange. The organizer will sort out your pick shortly." })); return panel; }
  panel.append(h("div", { class: "panel-head" },
    h("div", null, h("span", { class: "tag " + (rec.gender === "F" ? "f" : "") }, "Your " + roleOf(rec.gender)),
      h("div", { class: "big-name", style: "margin-top:8px", text: rec.alias }),
      rec.name ? h("p", { class: "sub" }, "Revealed: ", h("b", { text: rec.name })) : h("p", { class: "sub", text: "Their real name stays sealed until the Christmas party." })),
    avatarEl(rec.avatar, 120, rec.alias + "'s avatar")));
  panel.append(h("div", { class: "clue" }, h("span", { class: "clue-k", text: "Clue: who " + (rec.gender === "F" ? "she" : "he") + " is" }), h("p", { text: rec.clue || "No clue given yet." })));
  panel.append(h("div", { class: "notice" }, "Keep it secret! Sign your gifts as ", h("b", { text: "“" + mine.alias + "”" }), " and address them to ", h("b", { text: "“" + rec.alias + "”" }), "."));
  const weeks = sortedWeeks(S.weeks); const stOf = weekStatus(weeks); const nx = weeks.find(w => stOf(w) === "next");
  if (nx) panel.append(h("div", { class: "notice good" }, "Next gift: ", h("b", { text: nx.theme }), nx.date ? " · due " + fmtDate(nx.date) : "", nx.note ? " · " + nx.note : ""));
  panel.append(h("div", { class: "grid2" },
    h("div", { class: "field" }, h("h3", { text: rec.alias + "’s wish list" }), wishList(rec)),
    h("div", { class: "field" }, h("h3", { text: "Sizes & preferences" }), h("p", { class: "note", text: rec.notes || "Nothing noted yet." }))));
  if (rec.photos && rec.photos.length) panel.append(h("div", { class: "field" }, h("h3", { text: "Sample photos" }), photoStrip(rec.photos)));
  return panel;
}

/* ---- Big Reveal (party day) ---- */
function personCard(p, label) {
  if (!p) return h("div", { class: "rv-person" }, h("span", { class: "hint", text: "Left the exchange" }));
  return h("div", { class: "rv-person" }, avatarEl(p.avatar, 64, p.alias + "\u2019s avatar"),
    h("div", null, h("span", { class: "hint", text: label }), h("div", { class: "rv-name", text: p.name || p.alias }), h("div", { class: "hint", text: "\u201c" + p.alias + "\u201d" })));
}
function viewReveal() {
  const P = S.participants;
  const panel = h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("div", null, h("h2", { text: "The Big Reveal" }),
    h("p", { class: "sub", text: "Merry Christmas, Sta. Rita! Here\u2019s who was behind every alias." }))));
  if (!S.revealed) { panel.append(h("div", { class: "notice", text: "Names unseal on the Christmas party date." })); return panel; }
  if (S.me) {
    const myGiver = (S.reveal.find(k => k.receiverId === S.me.id) || {}).giverId;
    if (myGiver && P[myGiver]) panel.append(h("div", { class: "clue" }, h("span", { class: "clue-k", text: "Your secret " + roleOf(P[myGiver].gender) + " was" }),
      h("div", { class: "row" }, avatarEl(P[myGiver].avatar, 72), h("p", { text: (P[myGiver].name || P[myGiver].alias) + " \u00b7 \u201c" + P[myGiver].alias + "\u201d" }))));
  }
  const pairs = S.reveal.filter(k => P[k.giverId]).sort((a, b) => (P[a.giverId].name || "").localeCompare(P[b.giverId].name || ""));
  panel.append(pairs.length ? h("div", { class: "rv-list" }, pairs.map(k => h("div", { class: "rv-pair" },
    personCard(P[k.giverId], "Gave to"), h("span", { class: "rv-arrow", "aria-hidden": "true", text: "\u2192" }), personCard(P[k.receiverId], roleOf(P[k.receiverId] && P[k.receiverId].gender)))))
    : h("p", { class: "empty", text: "No pairs were drawn this year." }));
  return panel;
}

/* ---- Weekly gifts ---- */
function viewWeeks() {
  const weeks = sortedWeeks(S.weeks); const stOf = weekStatus(weeks);
  const panel = h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("div", null, h("h2", { text: "Weekly gift themes" }),
    h("p", { class: "sub", text: "Each week has a “Something…” theme set by the organizer. Leave your gift for your Manito or Manita by the due date, signed with your alias." }))));
  if (!weeks.length) { panel.append(h("p", { class: "empty", text: "The organizer hasn't posted the weekly themes yet." })); return panel; }
  const given = (S.me && S.me.given) || {};
  panel.append(h("div", { class: "weeks" }, weeks.map((w, i) => { const s = stOf(w);
    return h("div", { class: "week " + s },
      h("div", { class: "wk" }, "Week " + (i + 1), h("small", { text: w.date ? fmtDate(w.date) : "Date to follow" })),
      h("div", null, h("div", { class: "theme", text: w.theme || "Theme to follow" }), w.note ? h("div", { class: "hint", text: w.note }) : null),
      h("div", { class: "row" },
        h("span", { class: "tag " + (s === "past" ? "done" : s), text: s === "past" ? "Done" : s === "next" ? (w.date === todayStr() ? "Today" : "Up next") : "Upcoming" }),
        S.myPick ? h("label", { class: "switch", title: "Only the organizer sees this count" },
          h("input", { type: "checkbox", id: "gv-" + w.id, checked: !!given[w.id], onchange: e => act("markGiven", { weekId: w.id, value: e.target.checked }, e.target.checked ? "Marked as given. Nice one!" : "Unmarked.") }), "Gift given") : null)); })));
  return panel;
}

/* ---- Wish wall ---- */
function viewWall() {
  const ids = S.order.slice().sort((a, b) => (S.participants[a].alias || "").localeCompare(S.participants[b].alias || ""));
  const panel = h("section", { class: "panel" }, h("div", { class: "panel-head" },
    h("div", null, h("h2", { text: "Wish Wall" }), h("p", { class: "sub", text: "Everyone's wish lists, by codename only. Real names stay hidden so the fun lasts until the party." }))));
  if (!ids.length) { panel.append(h("p", { class: "empty", text: "No one has joined yet. Be the first!" })); return panel; }
  panel.append(h("div", { class: "cards" }, ids.map(id => { const p = S.participants[id];
    return h("article", { class: "person " + (p.gender === "F" ? "f" : "") },
      h("div", { class: "row" }, avatarEl(p.avatar, 56, p.alias + "'s avatar"), h("span", { class: "alias", text: p.alias }), h("span", { class: "spacer" }), h("span", { class: "tag " + (p.gender === "F" ? "f" : ""), text: roleOf(p.gender) })),
      S.me && id === S.me.id ? h("span", { class: "hint", text: "This is you" }) : null,
      wishList(p), p.notes ? h("div", { class: "note", text: p.notes }) : null, photoStrip(p.photos)); })));
  return panel;
}

/* ---- Organizer ---- */
function viewAdmin() {
  if (!S.adminToken) {
    const f = S.adminDraft || (S.adminDraft = { pw: "" });
    const submit = async e => {
      e.preventDefault();
      try { const j = await api("adminLogin", { pin: f.pw }); S.adminToken = j.adminToken; store.set("srao_admin", j.adminToken); S.adminDraft = null; toast("Signed in as organizer."); render(); }
      catch (err) { toast(err.message, 5000); }
    };
    return h("section", { class: "panel" }, h("h2", { text: "Organizer sign-in" }),
      h("p", { class: "sub", text: "Enter the organizer PIN to manage the wheel, weekly themes and staff." }),
      h("form", { class: "row", onsubmit: submit },
        h("input", { type: "password", id: "aPw", inputmode: "numeric", maxlength: "12", placeholder: "Organizer PIN", "aria-label": "Organizer PIN", style: "max-width:240px;letter-spacing:.2em", autocomplete: "current-password", oninput: e => { f.pw = e.target.value.replace(/\D/g, ""); e.target.value = f.pw; } }),
        h("button", { class: "btn primary", type: "submit" }, "Sign in")));
  }
  const A = S.admin;
  const sealed = !A.revealed;
  const lockNote = A.settings.partyDate ? "Sealed until " + fmtDate(A.settings.partyDate) : "Sealed until the party date";
  const who = p => p ? (p.name ? p.name + " (" + p.alias + ")" : p.alias) : "?";
  if (!A) { if (!S.adminLoading) { S.adminLoading = true; api("adminState").catch(e => toast(e.message, 5000)).finally(() => { S.adminLoading = false; render(); }); } return h("div", { class: "panel" }, h("p", { class: "sub", text: "Loading the organizer dashboard…" })); }
  const P = {}; A.participants.forEach(p => { P[p.id] = p; });
  const ids = A.participants.map(p => p.id);
  const st = A.settings; const out = [];
  const males = A.participants.filter(p => p.gender === "M").length;
  const weeks = sortedWeeks(A.weeks);
  const spunN = A.picks.length;

  out.push(h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("div", null, h("h2", { text: "Organizer dashboard" }), h("p", { class: "sub", text: sealed ? "Real names and usernames are sealed, even from you, until the Christmas party on " + (A.settings.partyDate ? fmtDate(A.settings.partyDate) : "the party date") + ". Until then you manage everyone by alias." : "Reveal day is here! Real names are now unsealed for everyone." })),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => act("adminState") }, "Refresh"), h("button", { class: "btn", onclick: () => { S.adminToken = null; S.admin = null; store.set("srao_admin", null); render(); } }, "Sign out"))),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("b", { text: String(ids.length) }), h("span", { text: "staff joined" })),
      h("div", { class: "stat" }, h("b", { text: String(males) }), h("span", { text: "Manito (male)" })),
      h("div", { class: "stat" }, h("b", { text: String(ids.length - males) }), h("span", { text: "Manita (female)" })),
      h("div", { class: "stat" }, h("b", { text: spunN + "/" + ids.length }), h("span", { text: "have a pick" })))));

  const draw = h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("div", null, h("h2", { text: "Spin the Wheel" }),
    h("p", { class: "sub", text: "When you open the wheel, each staff member spins once. Their own name is never on their wheel, and names already picked drop off." }))));
  if (!st.wheelOpen) {
    draw.append(ids.length < 3 ? h("div", { class: "notice warn", text: "At least 3 staff must join before you open the wheel. " + ids.length + " so far." })
      : h("div", { class: "notice", text: st.round ? "The wheel is paused. " + spunN + " of " + ids.length + " have spun." : ids.length + " staff are ready. Opening the wheel closes registration." }));
    draw.append(h("div", { class: "row" }, h("button", { class: "btn gold", disabled: ids.length < 3, onclick: async () => { if (await modal(st.round ? "Reopen the wheel?" : "Open the wheel?", st.round ? "Staff who haven't spun yet can spin." : "All " + ids.length + " staff can then spin once. Registration closes; you can reopen it in Event settings.", st.round ? "Reopen" : "Open the wheel")) act("openWheel", null, "The wheel is open! Tell everyone to go spin."); } }, st.round ? "Reopen the wheel" : "Open the wheel")));
  } else {
    draw.append(h("div", { class: "notice good", text: "The wheel is open. " + spunN + " of " + ids.length + " staff have spun." }));
    if (A.pending.length) draw.append(h("p", { class: "hint" }, "Still to spin: ", A.pending.map(id => who(P[id])).join(", ")));
    draw.append(h("div", { class: "row" },
      A.pending.length ? h("button", { class: "btn", onclick: async () => { if (await modal("Assign the rest?", "The wheel picks for the " + A.pending.length + " staff who haven't spun yet. Nobody gets their own name.", "Assign")) act("assignRest", null, "Done. Everyone now has a Manito or Manita."); } }, "Assign the rest automatically") : null,
      h("button", { class: "btn", onclick: () => act("pauseWheel", null, "Wheel paused. Picks so far are kept.") }, "Pause the wheel")));
  }
  if (st.round && A.stuck.length) draw.append(h("div", { class: "notice warn" }, A.stuck.map(id => who(P[id])).join(", "), " can't spin because no names are left for them. ",
    h("button", { class: "btn", style: "margin-left:6px", onclick: async () => { if (await modal("Add to an existing pair?", "For each person, one existing giver is switched to them, and they take over that giver's old pick. That giver will see a new name.", "Add")) act("addLate", { ids: A.stuck }, "Added. Let the switched giver know to check their wheel tab."); } }, "Add them to an existing pair")));
  if (st.round) {
    draw.append(h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => { S.showPairs = !S.showPairs; render(); } }, S.showPairs ? "Hide pairings" : "Show pairings"),
      h("span", { class: "spacer" }),
      h("button", { class: "btn danger", onclick: async () => { if (await modal("Reset the wheel?", "Every pick is erased and everyone spins again. Anyone who already saw their Manito or Manita will get a new one.", "Reset", true)) act("resetWheel", null, "The wheel is reset. Everyone can spin again."); } }, "Reset the wheel")));
    if (S.showPairs) {
      const rows = A.picks.filter(k => P[k.giverId]).sort((a, b) => P[a.giverId].alias.localeCompare(P[b.giverId].alias));
      draw.append(rows.length ? h("div", { class: "tablewrap" }, h("table", null, h("thead", null, h("tr", null, h("th", { text: "Giver" }), h("th", { text: "Gives to" }))),
        h("tbody", null, rows.map(k => { const g = P[k.giverId], r = P[k.receiverId]; return h("tr", null, h("td", { text: who(g) }), h("td", { text: r ? who(r) : "Left the exchange" })); }))))
        : h("p", { class: "hint", text: "No one has spun yet." }));
    }
  }
  out.push(draw);

  if (!S.weeksDraft || !S.weeksDirty) S.weeksDraft = clone(weeks);
  const wd = S.weeksDraft; const markW = () => { S.weeksDirty = true; };
  const rows = h("div", { style: "display:grid;gap:10px" });
  wd.forEach((w, i) => rows.append(h("div", { class: "week-edit" },
    h("span", { class: "wk", text: "Week " + (i + 1) }),
    h("input", { type: "text", id: "wt-" + w.id, "aria-label": "Week " + (i + 1) + " theme", value: w.theme || "", maxlength: "60", placeholder: "Something…", oninput: e => { w.theme = e.target.value; markW(); } }),
    h("input", { type: "date", id: "wd-" + w.id, "aria-label": "Week " + (i + 1) + " due date", value: w.date || "", oninput: e => { w.date = e.target.value; markW(); } }),
    h("input", { type: "text", id: "wn-" + w.id, "aria-label": "Week " + (i + 1) + " note", value: w.note || "", maxlength: "120", placeholder: "Note (optional)", oninput: e => { w.note = e.target.value; markW(); } }),
    h("button", { class: "btn icon danger", "aria-label": "Delete week " + (i + 1), title: "Delete week", onclick: () => { wd.splice(i, 1); markW(); render(); } }, "✕"))));
  if (!wd.length) rows.append(h("p", { class: "hint", text: "No weeks yet. Add the first one below or tap a suggestion." }));
  const addWeek = theme => {
    const last = wd.length ? wd[wd.length - 1].date : null; let date = "";
    if (last) { const dt = new Date(last + "T12:00:00+08:00"); dt.setDate(dt.getDate() + 7); date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(dt); }
    wd.push({ id: rid(), theme: theme || "", date, note: "" }); markW(); render();
  };
  const used = new Set(wd.map(w => (w.theme || "").toLowerCase()));
  out.push(h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("div", null, h("h2", { text: "Weekly gift themes" }),
    h("p", { class: "sub", text: "Set the “Something…” theme and due date for each week. Staff see them in Weekly Gifts after you save." }))),
    rows,
    h("div", { class: "field" }, h("span", { class: "legend" }, "Quick add"), h("div", { class: "sugg" }, SUGGESTIONS.filter(s => !used.has(s.toLowerCase())).map(s => h("button", { onclick: () => addWeek(s) }, "+ " + s)))),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: () => addWeek("") }, "+ Add blank week"), h("span", { class: "spacer" }),
      S.weeksDirty ? h("button", { class: "btn", onclick: () => { S.weeksDirty = false; S.weeksDraft = null; render(); } }, "Discard") : null,
      h("button", { class: "btn primary", disabled: !S.weeksDirty, onclick: async () => {
        if (wd.some(w => !(w.theme || "").trim())) return toast("Give every week a theme, or delete the empty one.");
        const j = await act("saveWeeks", { weeks: wd }, "Weekly themes saved. Staff can see them now."); if (j) { S.weeksDirty = false; S.weeksDraft = null; render(); }
      } }, S.weeksDirty ? "Save weekly themes" : "Saved"))));

  if (st.round && weeks.length) out.push(h("section", { class: "panel" }, h("h2", { text: "Gift progress" }), h("p", { class: "sub", text: "How many staff marked each week's gift as given." }),
    h("div", { class: "tablewrap" }, h("table", null, h("thead", null, h("tr", null, h("th", { text: "Week" }), h("th", { text: "Theme" }), h("th", { text: "Given" }))),
      h("tbody", null, weeks.map((w, i) => { const n = A.participants.filter(p => p.given && p.given[w.id]).length;
        return h("tr", null, h("td", { text: "Week " + (i + 1) }), h("td", { text: w.theme }), h("td", { class: "num", text: n + " of " + ids.length })); }))))));

  if (!S.setDraft || !S.setDirty) S.setDraft = { eventName: st.eventName || "Online Manito & Manita", partyDate: st.partyDate || "", budget: st.budget === "" || st.budget == null ? "" : String(st.budget), registrationOpen: st.registrationOpen !== false };
  const sd = S.setDraft; const markS = () => { S.setDirty = true; };
  out.push(viewSlidesAdmin(A));

  out.push(h("section", { class: "panel" }, h("h2", { text: "Event settings" }),
    h("div", { class: "grid2" },
      h("div", { class: "field" }, h("label", { for: "sName" }, "Event title"), h("input", { type: "text", id: "sName", value: sd.eventName, maxlength: "60", oninput: e => { sd.eventName = e.target.value; markS(); } })),
      h("div", { class: "field" }, h("label", { for: "sDate" }, "Christmas party date (real names unseal)"), h("input", { type: "date", id: "sDate", value: sd.partyDate, min: st.round && st.partyDate ? st.partyDate : null, oninput: e => { sd.partyDate = e.target.value; markS(); } }),
        h("span", { class: "hint", text: st.round ? "Locked: it can only move later, so no one can unseal names early." : "Required before you open the wheel. Locks once the wheel opens." })),
      h("div", { class: "field" }, h("label", { for: "sBudget" }, "Budget per gift (₱)"), h("input", { type: "number", id: "sBudget", min: "0", step: "50", value: sd.budget, oninput: e => { sd.budget = e.target.value; markS(); } }))),
    h("label", { class: "switch", for: "sOpen" }, h("input", { type: "checkbox", id: "sOpen", checked: sd.registrationOpen, onchange: e => { sd.registrationOpen = e.target.checked; markS(); } }), "Registration open (new staff can join)"),
    h("div", null, h("button", { class: "btn primary", onclick: async () => { const j = await act("saveSettings", { settings: sd }, "Settings saved."); if (j) { S.setDirty = false; refresh(true); } } }, "Save settings"))));

  out.push(h("section", { class: "panel" }, h("h2", { text: "Participants" }),
    ids.length ? h("div", { class: "tablewrap" }, h("table", null, h("thead", null, h("tr", null, h("th", { text: "Alias" }), h("th", { text: "Real name" }), h("th", { text: "Username" }), h("th", { text: "Role" }), h("th", { text: "Wishes" }), h("th", { text: "" }))),
      h("tbody", null, A.participants.slice().sort((a, b) => a.alias.localeCompare(b.alias)).map(p => h("tr", null,
        h("td", null, h("div", { class: "row", style: "flex-wrap:nowrap;gap:8px;white-space:nowrap" }, avatarEl(p.avatar, 32), p.alias)),
        h("td", null, p.name ? p.name : h("span", { class: "sealed", text: "🔒 " + lockNote })),
        h("td", null, p.username ? p.username : h("span", { class: "sealed", text: "🔒 Sealed" })), h("td", null, h("span", { class: "tag " + (p.gender === "F" ? "f" : ""), text: roleOf(p.gender) })),
        h("td", { class: "num", text: String((p.wishes || []).length) + (p.photos && p.photos.length ? " · " + p.photos.length + " photo" + (p.photos.length > 1 ? "s" : "") : "") }),
        h("td", null, h("div", { class: "row actions" },
          h("button", { class: "btn sm", onclick: async () => { const pin = await modal("Reset " + p.alias + "'s PIN", "Enter a new 4 to 6 digit PIN and give it to them privately.", "Reset PIN", false, { label: "New PIN", inputmode: "numeric", maxlength: "6", placeholder: "e.g. 2468" }); if (pin) act("resetPin", { id: p.id, pin: String(pin).trim() }, "PIN reset for " + p.alias + "."); } }, "Reset PIN"),
          h("button", { class: "btn sm", onclick: async () => { const u = await modal("Change " + p.alias + "'s username", "Enter a new username (3 to 30 letters, numbers, dots or dashes) and give it to them privately. Their old username stops working and they'll need to sign in again.", "Change username", false, { label: "New username", maxlength: "30", placeholder: "e.g. maria.santos" }); if (u) act("resetUsername", { id: p.id, username: String(u).trim().toLowerCase() }, "Username changed for " + p.alias + "."); } }, "Change username"),
          h("button", { class: "btn sm danger", onclick: async () => { if (await modal("Remove " + p.alias + "?", "Their profile, wish list and photos are deleted." + (st.round ? " Picks are adjusted so the exchange still works." : ""), "Remove", true)) act("removeParticipant", { id: p.id }, p.alias + " removed."); } }, "Remove"))))))))
      : h("p", { class: "hint", text: "No one has joined yet." })));
  return out;
}

/* ---- Organizer: home-page carousel ---- */
function viewSlidesAdmin(A) {
  const slides = A.carousel || [];
  const panel = h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("div", null, h("h2", { text: "Home page carousel: SRAO through the Years" }),
    h("p", { class: "sub", text: "Pictures on the home page change every 3 seconds, in this order. Uploads are saved to your Google Drive; you can also paste links in the Carousel tab of the Google Sheet." })),
    h("span", { class: "tag", text: slides.length + (slides.length === 1 ? " picture" : " pictures") + " · up to 30" })));
  const grid = h("div", { class: "slide-grid" });
  slides.forEach((s, i) => grid.append(h("figure", { class: "slide-card" },
    h("div", { class: "slide-thumb" }, s.src && /^(https:|\/)/.test(s.src) ? h("img", { src: s.src, alt: "Carousel picture " + (i + 1), loading: "lazy", referrerpolicy: "no-referrer", onclick: () => lightbox(s.src), onerror: e => { e.target.replaceWith(h("span", { class: "hint", text: "Can't load this picture. Check that it's shared “Anyone with the link”." })); } })
      : h("span", { class: "hint", text: "Not a picture link: " + String(s.url || "").slice(0, 60) })),
    h("figcaption", { class: "row" }, h("b", { text: String(i + 1) }), h("span", { class: "spacer" }),
      h("button", { class: "btn icon", "aria-label": "Move picture " + (i + 1) + " earlier", title: "Move earlier", disabled: i === 0, onclick: () => act("moveSlide", { index: i, url: s.url, dir: -1 }) }, "←"),
      h("button", { class: "btn icon", "aria-label": "Move picture " + (i + 1) + " later", title: "Move later", disabled: i === slides.length - 1, onclick: () => act("moveSlide", { index: i, url: s.url, dir: 1 }) }, "→"),
      h("button", { class: "btn icon danger", "aria-label": "Remove picture " + (i + 1), title: "Remove", onclick: async () => { if (await modal("Remove picture " + (i + 1) + "?", "It disappears from the home page. Pictures uploaded here also go to your Google Drive trash.", "Remove", true)) act("deleteSlide", { index: i, url: s.url }, "Picture removed."); } }, "✕")))));
  for (let k = 0; k < (S.slideUploading || 0); k++) grid.append(h("figure", { class: "slide-card" }, h("div", { class: "slide-thumb" }, h("span", { class: "hint", text: "Uploading…" }))));
  if (slides.length + (S.slideUploading || 0) < 30)
    grid.append(h("label", { class: "slide-card slide-add", for: "slideFile" }, h("span", null, h("b", { text: "+ Upload pictures" }), h("br"), h("span", { class: "hint", text: "JPG, PNG or WebP · wide photos look best" }))),
      h("input", { type: "file", id: "slideFile", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true, onchange: e => uploadSlides(e.target.files) }));
  panel.append(grid);
  if (!slides.length) panel.append(h("p", { class: "hint", text: "No pictures yet, so the home page shows the team photo." }));
  return panel;
}
async function uploadSlides(files) {
  const room = 30 - ((S.admin && S.admin.carousel) || []).length - (S.slideUploading || 0);
  const list = Array.from(files || []).slice(0, Math.max(0, room));
  if (!list.length) return toast("The carousel holds up to 30 pictures.");
  S.slideUploading = (S.slideUploading || 0) + list.length; scheduleRender();
  let ok = 0;
  for (const f of list) {
    try { const dataUrl = await compress(f, 1920); await api("uploadSlide", { dataUrl }); ok++; }
    catch (e) { toast(e.message && e.message !== "[object Event]" ? e.message : "Couldn't read " + f.name + ". Try a JPG or PNG.", 5000); }
    S.slideUploading--; scheduleRender();
  }
  if (ok) { toast(ok + (ok === 1 ? " picture" : " pictures") + " added to the carousel."); refresh(true); }
}

/* ---------- routing, polling, boot ---------- */
function route() {
  const v = (location.hash || "").replace("#", "");
  S.view = VIEWS.some(([id]) => id === v) ? v : "home";
  render();
  if (S.view === "admin" && S.adminToken) api("adminState", null, true).then(() => scheduleRender()).catch(() => {});
}
window.addEventListener("hashchange", route);

async function refresh(quiet) {
  try { await api("state", null, quiet); S.fatal = null; }
  catch (e) { if (!S.loaded) S.fatal = e.message; else if (!quiet) toast(e.message); }
  scheduleRender();
}
setInterval(() => {
  if (document.hidden || S.spinning) return;
  refresh(true);
  if (S.view === "admin" && S.adminToken) api("adminState", null, true).then(scheduleRender).catch(() => {});
}, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.loaded) refresh(true); });

(function boot() {
  S.view = (location.hash || "#home").slice(1);
  if (!VIEWS.some(([id]) => id === S.view)) S.view = "home";
  render();
  refresh(false).then(() => { if (S.view === "admin" && S.adminToken) route(); });
})();

/* ---------- snowfall ---------- */
(function snow() {
  const c = document.getElementById("snow"); const x = c.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W, H, flakes = [];
  const size = () => { const r = c.getBoundingClientRect(); W = c.width = r.width * devicePixelRatio; H = c.height = r.height * devicePixelRatio;
    flakes = Array.from({ length: Math.round(r.width / 9) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: (Math.random() * 1.8 + .6) * devicePixelRatio, s: Math.random() * .5 + .25, d: Math.random() * 6.28 })); };
  const draw = () => { x.clearRect(0, 0, W, H); x.fillStyle = "rgba(255,255,255,.75)";
    for (const f of flakes) { x.beginPath(); x.arc(f.x, f.y, f.r, 0, 6.283); x.fill();
      if (!reduce) { f.y += f.s * devicePixelRatio; f.d += .01; f.x += Math.sin(f.d) * .3; if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; } } }
    if (!reduce) requestAnimationFrame(draw); };
  size(); addEventListener("resize", () => { size(); if (reduce) draw(); }); draw();
})();
