// ============================================================
//  Saathi — main application logic
//  Features: auth, profiles, friend requests, private chat
//  (friends only), posts with privacy, likes, comments.
// ============================================================
import { auth, db } from './firebase-config.js';

// Website updates apply on the next open. No app install is required.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
}
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp,
  increment, arrayUnion, arrayRemove, collectionGroup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// NOTE: photos are stored as compressed base64 data-URLs directly in
// Firestore documents, so no Cloud Storage bucket is required.

// ---------------- helpers ----------------
const $ = (s) => document.querySelector(s);
const view = $('#view');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 1–3 emoji and nothing else → Telegram-style jumbo message
function emojiGraphemes(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  try {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].map(s => s.segment);
  } catch (e) {
    return Array.from(t);
  }
}

function emojiOnlyCount(text) {
  const parts = emojiGraphemes(text);
  if (!parts.length || parts.length > 3) return 0;
  return parts.every(g => /\p{Extended_Pictographic}/u.test(g)) ? parts.length : 0;
}

// Each emoji family gets its own particles and motion. Unlisted emoji still
// animate as copies of themselves, with a motion picked from the glyph.
const EMOJI_FX = [
  { re: /😂|🤣/, particles: ['💧', '💦', '😂'], motion: 'spray', self: 'shake' },
  { re: /😭/, particles: ['💧', '💦', '😭'], motion: 'rain', self: 'wobble' },
  { re: /😢|😥|😓|😿|😅/, particles: ['💧', '💦'], motion: 'rain', self: 'wobble' },
  { re: /😡|🤬|😠|👿|💢/, particles: ['💢', '💥', '🔥'], motion: 'burst', self: 'shake' },
  { re: /😱|🤯/, particles: ['💥', '✨', '💫'], motion: 'explode', self: 'shake' },
  { re: /😴|😪|💤/, particles: ['💤', '💤', '✨'], motion: 'notes', self: 'bob' },
  { re: /🔥|🥵/, particles: ['🔥', '✨'], motion: 'rise', self: 'pulse' },
  { re: /💩/, particles: ['💨', '✨'], motion: 'puff', self: 'bounce' },
  { re: /👍|👎|👏|🙏|👋|✌|🤞|🤟|🤘|👊|✊|👌|☝|🤝|💪/, particles: ['✨'], motion: 'sparkle', self: 'bounce' },
  { re: /🎉|🎊|🥳/, particles: ['🎉', '🎊', '✨', '🎈', '⭐'], motion: 'confetti', self: 'pop' },
  { re: /🎂|🎁|🍾/, particles: ['🎉', '✨', '🎊', '🎁'], motion: 'confetti', self: 'bounce' },
  { re: /🎈/, particles: ['🎈', '❤️', '💛', '💙', '💜'], motion: 'float', self: 'bob' },
  { re: /❤|💖|💗|💓|💕|💞|💘|💝|💟|♥|😍|🥰|😘|😻|💋/, particles: ['❤️', '💖', '💕', '💗', '💘', '💝'], motion: 'float', self: 'pulse' },
  { re: /⭐|✨|🌟|💫/, particles: ['✨', '⭐', '🌟', '💫'], motion: 'sparkle', self: 'spin' },
  { re: /⚡/, particles: ['⚡', '✨'], motion: 'burst', self: 'shake' },
  { re: /💯/, particles: ['💯', '🔥', '✨'], motion: 'slam', self: 'slam' },
  { re: /🌹|🌸|🌺|🌻|🌼|🌷|💐|🍀/, particles: ['🌸', '🌺', '🌼', '🌷', '🍃'], motion: 'sway', self: 'sway' },
  { re: /❄|☃|⛄/, particles: ['❄️', '❄️', '✨'], motion: 'snow', self: 'bob' },
  { re: /🌧|☔|⛈|💧/, particles: ['💧', '💧', '💦'], motion: 'rain', self: 'wobble' },
  { re: /☀|🌞/, particles: ['✨', '🌟', '☀️'], motion: 'rays', self: 'pulse' },
  { re: /😎/, particles: ['✨', '⭐'], motion: 'sparkle', self: 'slide' },
  { re: /🎵|🎶|🎤|🎧|🎸|🎹/, particles: ['🎵', '🎶', '♪', '♫'], motion: 'notes', self: 'bob' },
  { re: /💰|💸|💵|💎|🤑/, particles: ['💵', '💰', '💸', '✨'], motion: 'rain', self: 'spin' },
  { re: /🚀/, particles: ['🔥', '✨', '💨'], motion: 'fly', self: 'fly' },
  { re: /✈|🛫|🛩/, particles: ['☁️', '✨'], motion: 'fly', self: 'fly' },
  { re: /👻/, particles: ['👻', '✨'], motion: 'ghost', self: 'fade' },
  { re: /💣|💥/, particles: ['💥', '🔥', '✨', '💨'], motion: 'explode', self: 'shake' },
  { re: /🦋/, particles: ['🦋', '✨'], motion: 'flutter', self: 'flutter' },
  { re: /🐝/, particles: ['🐝'], motion: 'flutter', self: 'shake' },
  { re: /🍺|🍻|🥂|🍷/, particles: ['🍻', '✨', '🫧'], motion: 'burst', self: 'bounce' },
  { re: /🌈/, particles: ['💛', '💙', '💜', '💚', '✨'], motion: 'sway', self: 'sway' },
  { re: /🤡/, particles: ['🎈', '⭐', '🤡'], motion: 'confetti', self: 'spin' },
  { re: /💀|☠/, particles: ['💀', '✨'], motion: 'ghost', self: 'shake' },
  { re: /🤔|🧐/, particles: ['💭', '✨'], motion: 'notes', self: 'wobble' },
  { re: /🙄/, particles: ['👀'], motion: 'sway', self: 'spin' },
  { re: /😀|😃|😄|😁|😆|😊|🙂|😉|😋|😜|😝|😛|🤗|😇|😗|😙|😚|😌|😏|🤩|😺|😸|😹/, particles: ['❤️', '💖', '🎈', '💛', '💜', '💕'], motion: 'float', self: 'pop' },
];

const FALLBACK_MOTIONS = ['float', 'confetti', 'sparkle', 'sway', 'burst', 'notes', 'flutter', 'snow', 'rise'];
const FALLBACK_SELF = ['pop', 'bounce', 'spin', 'sway', 'pulse', 'wobble', 'bob', 'slide'];

function emojiHash(s) {
  let h = 0;
  for (const ch of s) h = Math.imul(h, 31) + ch.codePointAt(0);
  return Math.abs(h);
}

function lookupEmojiFx(grapheme) {
  for (const fx of EMOJI_FX) {
    if (fx.re.test(grapheme)) return fx;
  }
  const h = emojiHash(grapheme);
  return {
    particles: [grapheme, grapheme, '✨'],
    motion: FALLBACK_MOTIONS[h % FALLBACK_MOTIONS.length],
    self: FALLBACK_SELF[h % FALLBACK_SELF.length],
  };
}

function emojiEffect(text) {
  const parts = emojiGraphemes(text).filter(g => /\p{Extended_Pictographic}/u.test(g));
  const base = parts[0] ? lookupEmojiFx(parts[0]) : { particles: ['✨'], motion: 'sparkle', self: 'pop' };
  const particles = [];
  parts.forEach(p => particles.push(...lookupEmojiFx(p).particles));
  return {
    particles: (particles.length ? particles : base.particles).slice(0, 14),
    motion: base.motion,
    self: base.self,
  };
}

const emojiPlayed = new Set();
function playEmojiBurst(el) {
  if (!el) return;
  el.querySelector('.emoji-burst')?.remove();
  const jumbo = el.querySelector('.emoji-jumbo');
  const fx = emojiEffect(jumbo?.textContent || '');
  if (jumbo) {
    [...jumbo.classList].forEach(c => { if (c.startsWith('fx-self-')) jumbo.classList.remove(c); });
    void jumbo.offsetWidth;
    jumbo.classList.add('fx-self-' + fx.self);
  }
  const burst = document.createElement('div');
  burst.className = 'emoji-burst fx-' + fx.motion;
  const icons = fx.particles;
  const count = Math.min(12, Math.max(icons.length, 8));
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.textContent = icons[i % icons.length];
    const angle = (i / count) * Math.PI * 2;
    const dist = 70 + (i % 4) * 24;
    const side = i % 2 ? 1 : -1;
    s.style.left = (4 + (i * 13) % 90) + '%';
    s.style.setProperty('--drift', (side * (16 + (i % 5) * 16)) + 'px');
    s.style.setProperty('--dx', Math.round(Math.cos(angle) * dist) + 'px');
    s.style.setProperty('--dy', Math.round(Math.sin(angle) * dist * 0.85) + 'px');
    s.style.setProperty('--spin', (side * (40 + i * 30)) + 'deg');
    s.style.animationDelay = (i * 0.05) + 's';
    s.style.fontSize = (16 + (i % 5) * 6) + 'px';
    burst.appendChild(s);
  }
  el.appendChild(burst);
  setTimeout(() => burst.remove(), 2300);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function joinDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

const AVATAR_COLORS = ['#2e63f6', '#8e44ad', '#16a085', '#d35400', '#c0392b', '#2c3e50', '#0097a7'];
function avatarHTML(user, cls = '') {
  const name = user?.name || '?';
  if (user?.photoURL) return `<span class="avatar ${cls}"><img src="${esc(user.photoURL)}" alt=""></span>`;
  const color = AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
  return `<span class="avatar ${cls}" style="background:${color}1a;color:${color}">${esc(name[0].toUpperCase())}</span>`;
}

const PRIVACY = {
  public:  { icon: '🌍', label: 'Public' },
  friends: { icon: '👥', label: 'Friends' },
  close:   { icon: '⭐', label: 'Close Friends' },
  private: { icon: '🔒', label: 'Only Me' }
};

// ---------------- global state ----------------
let me = null;              // firebase auth user
let myDoc = null;           // my users/{uid} document
let friendIds = new Set();  // uids of accepted friends
let incomingReqs = [];      // pending requests TO me
let outgoingReqs = new Map(); // pending requests FROM me: toUid -> requestId
const userCache = new Map(); // uid -> user doc data

let globalUnsubs = [];      // listeners for the whole session
let viewUnsubs = [];        // listeners for the current view only
let currentPage = 'home';
let currentFriendsTab = null;
let friendsTabChosen = false;
let unreadTotal = 0;
let currentChatUid = null;

// is this chat unread for me? (last message from the other side, after my lastRead)
function isUnreadChat(c) {
  if (!c.lastSender || c.lastSender === me.uid || !c.lastAt) return false;
  const t = c.lastAt.toMillis ? c.lastAt.toMillis() : 0;
  const r = c.lastRead?.[me.uid]?.toMillis ? c.lastRead[me.uid].toMillis() : 0;
  return t > r;
}

function updateChatBadges() {
  const b = $('#chatBadge');
  if (!b) return;
  if (unreadTotal) { b.textContent = unreadTotal; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}

// hide the bottom nav on wide screens (inline style = cannot be overridden)
function syncBottomnav() {
  const n = $('#bottomnav');
  if (n) n.style.display = window.innerWidth >= 1024 ? 'none' : '';
}
window.addEventListener('resize', syncBottomnav);

// re-render the friends page when its data changes underneath it
function refreshFriendsView() {
  if (currentPage !== 'friends') return;
  renderFriends(friendsTabChosen ? currentFriendsTab : (incomingReqs.length ? 'requests' : 'friends'));
}
function clearViewListeners() {
  viewUnsubs.forEach(u => { try { u(); } catch (e) {} });
  viewUnsubs = [];
  for (const t of girlyTimers.values()) clearTimeout(t);
  girlyTimers.clear();
}

async function getUser(uid) {
  if (userCache.has(uid)) return userCache.get(uid);
  const snap = await getDoc(doc(db, 'users', uid));
  const data = snap.exists() ? snap.data() : { name: 'Unknown', photoURL: '' };
  userCache.set(uid, data);
  return data;
}

function handleDbError(err) {
  console.error(err);
  if (err?.code === 'failed-precondition') {
    toast('Database index needed — open browser console & click the Firebase link once.');
  } else if (err?.code === 'permission-denied') {
    toast('Permission denied — publish the Firestore rules (see README).');
  }
}

// ============================================================
//  PRESENCE (🟢 online status) + DESKTOP SIDEBARS
// ============================================================
const presenceUnsubs = new Map(); // friendUid -> unsubscribe

// "online" = active within the last 3 minutes (heartbeat below)
function presenceOf(u) {
  const t = u?.lastActive;
  if (!t) return { online: false, label: 'Offline' };
  const d = t.toDate ? t.toDate() : new Date(t);
  const ms = Date.now() - d.getTime();
  if (ms < 3 * 60 * 1000) return { online: true, label: 'Online' };
  return { online: false, label: 'Active ' + timeAgo(t) };
}

function syncPresenceListeners() {
  for (const [uid, unsub] of presenceUnsubs) {
    if (!friendIds.has(uid)) { unsub(); presenceUnsubs.delete(uid); }
  }
  for (const uid of friendIds) {
    if (!presenceUnsubs.has(uid)) {
      presenceUnsubs.set(uid, onSnapshot(doc(db, 'users', uid), (s) => {
        if (s.exists()) userCache.set(uid, s.data());
        renderRightbar();
      }, () => {}));
    }
  }
}

function railIcon(path) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">${path}</svg>`;
}

function renderLeftbar() {
  const el = $('#leftbar');
  if (!el || !me || !myDoc) return;
  const badge = unreadTotal ? `<span class="badge">${unreadTotal}</span>` : '';
  el.innerHTML = `
    <button class="rail-logo" data-action="nav" data-target="#/home" title="Saathi">${railIcon('<rect x="3" y="6" width="18" height="14" rx="4"/><circle cx="12" cy="13" r="3.2"/>')}</button>
    <nav class="side-menu rail">
      <button class="rail-item" data-action="nav" data-target="#/home" title="Home">${railIcon('<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>')}</button>
      <button class="rail-item" data-action="nav" data-target="#/reels" title="Reels">${railIcon('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m10 9 6 3-6 3z"/>')}</button>
      <button class="rail-item" data-action="nav" data-target="#/chats" title="Messages">${railIcon('<path d="m22 3-9 9M22 3l-6 18-3-7-7-3z"/>')}${badge}</button>
      <button class="rail-item" data-action="nav" data-target="#/search" title="Search">${railIcon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}</button>
      <button class="rail-item" data-action="open-notifs" title="Notifications">${railIcon('<path d="M16.5 3.5a5.5 5.5 0 0 0-4.5 2.3A5.5 5.5 0 0 0 7.5 3.5 5.5 5.5 0 0 0 2 9c0 6 10 11 10 11s10-5 10-11a5.5 5.5 0 0 0-5.5-5.5z"/>')}</button>
      <button class="rail-item" data-action="open-create" title="Create">${railIcon('<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>')}</button>
      <button class="rail-item" data-action="nav" data-target="#/profile" title="Profile">${avatarHTML(myDoc, 'rail-avatar')}</button>
      <span class="rail-spacer"></span>
      <button class="rail-item" data-action="nav" data-target="#/settings" title="Settings">${railIcon('<path d="M4 7h16M4 12h16M4 17h16"/>')}</button>
    </nav>`;
  markSideMenuActive();
}

let lastNewsFetch = 0;
async function renderNews() {
  const el = $('#newsList');
  if (!el) return;
  if (Date.now() - lastNewsFetch < 60000 && el.dataset.loaded) return; // throttle 60 s
  lastNewsFetch = Date.now();
  try {
    const snap = await getDocs(query(collection(db, 'posts'),
      where('privacy', '==', 'public'), orderBy('createdAt', 'desc'), limit(5)));
    if (!el.isConnected) return;
    el.dataset.loaded = '1';
    el.innerHTML = snap.docs.length ? snap.docs.map(d => {
      const p = d.data();
      const text = (p.text || '📷 photo');
      return `<a class="news-item" href="#/profile/${p.authorId}">
        <b>${esc(p.authorName)}</b>: ${esc(text.slice(0, 60))}${text.length > 60 ? '…' : ''}</a>`;
    }).join('') : '<div class="user-row-sub">No public posts yet.</div>';
  } catch (e) { /* index still building etc. */ }
}

async function renderRightbar() {
  const el = $('#rightbar');
  if (!el || !me) return;
  const chatsCard = `<div class="side-card" style="padding:10px">
    <div style="font-weight:800;padding:4px 6px 10px">💬 Chats <span style="font-size:11px;font-weight:400;color:var(--muted)">🌸 girly · 🎩 gentleman</span></div>
    <div id="sideChats"><div class="user-row-sub" style="padding:4px 6px">No chats yet.</div></div>
  </div>`;
  if (!friendIds.size) {
    el.innerHTML = `<div class="side-card"><strong>🟢 Friends</strong>
      <div class="user-row-sub" style="margin-top:8px">Add friends to see who is online.</div></div>` + chatsCard;
    renderSideChatsList();
    return;
  }
  const users = await Promise.all([...friendIds].map(async uid => ({ uid, ...(await getUser(uid)) })));
  if (!el.isConnected) return;
  users.sort((a, b) => {
    const pa = presenceOf(a), pb = presenceOf(b);
    if (pa.online !== pb.online) return pa.online ? -1 : 1;
    return (b.lastActive?.toMillis?.() || 0) - (a.lastActive?.toMillis?.() || 0);
  });
  const rows = users.map(u => {
    const p = presenceOf(u);
    return `<div class="chat-row" data-action="message" data-id="${u.uid}" style="box-shadow:none;margin-bottom:2px;padding:8px 6px">
      <span style="position:relative;display:inline-block">${avatarHTML(u)}${p.online ? '<span class="online-dot"></span>' : ''}</span>
      <div class="chat-row-info">
        <div class="chat-row-name">${esc(u.name)}</div>
        <span class="presence ${p.online ? '' : 'off'}">${p.online ? '🟢 Online' : esc(p.label)}</span>
      </div>
    </div>`;
  }).join('');
  const onlineCount = users.filter(u => presenceOf(u).online).length;
  el.innerHTML = `<div class="side-card" style="padding:10px">
    <div style="font-weight:800;padding:4px 6px 10px">Friends <span class="presence">· ${onlineCount} online</span></div>
    ${rows}</div>` + chatsCard;
  renderSideChatsList();
}

// right-sidebar chats list (mode icon + unread), fed by the global chats listener
let sideChatsCache = [];
async function renderSideChatsList() {
  const el = $('#sideChats');
  if (!el) return;
  const docs = [...sideChatsCache].sort((a, b) => (b.lastAt?.toMillis?.() || 0) - (a.lastAt?.toMillis?.() || 0));
  if (!docs.length) { el.innerHTML = '<div class="user-row-sub" style="padding:4px 6px">No chats yet.</div>'; return; }
  const rows = await Promise.all(docs.map(async c => {
    const otherUid = c.members.find(m => m !== me.uid);
    const u = await getUser(otherUid);
    const un = isUnreadChat(c);
    const modeIco = c.mode === 'girly' ? '🌸' : '🎩';
    return `<div class="chat-row ${un ? 'unread' : ''}" data-action="message" data-id="${otherUid}" style="box-shadow:none;margin-bottom:2px;padding:8px 6px">
      ${avatarHTML(u)}
      <div class="chat-row-info">
        <div class="chat-row-name">${esc(u.name)} <span style="font-size:11px">${modeIco}</span></div>
        <div class="chat-row-last">${esc(c.lastMessage || 'Say hi 👋')}</div>
      </div>
      ${un ? '<span class="unread-dot"></span>' : ''}
    </div>`;
  }));
  if (el.isConnected) el.innerHTML = rows.join('');
}

function markSideMenuActive() {
  const parts = (location.hash || '#/home').slice(2).split('/');
  const page = parts[0] || 'home';
  document.querySelectorAll('.side-menu button[data-target]').forEach(b => {
    const t = b.dataset.target;
    b.classList.toggle('active',
      t === '#/' + page || (t === '#/profile' && page === 'profile' && (!parts[1] || parts[1] === me.uid)));
  });
}

// ============================================================
//  AUTH
// ============================================================
function showAuth() {
  $('#appScreen').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
}
function showApp() {
  $('#authScreen').classList.add('hidden');
  $('#appScreen').classList.remove('hidden');
}

$('#tabLogin').onclick = () => {
  $('#tabLogin').classList.add('active'); $('#tabSignup').classList.remove('active');
  $('#loginForm').classList.remove('hidden'); $('#signupForm').classList.add('hidden');
};
$('#tabSignup').onclick = () => {
  $('#tabSignup').classList.add('active'); $('#tabLogin').classList.remove('active');
  $('#signupForm').classList.remove('hidden'); $('#loginForm').classList.add('hidden');
};

$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
  } catch (err) {
    toast(err.code === 'auth/invalid-credential' ? 'Wrong email or password.' : err.message);
  }
};

$('#signupForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('#signupName').value.trim();
  if (!name) return toast('Please enter your name.');
  try {
    const cred = await createUserWithEmailAndPassword(auth, $('#signupEmail').value.trim(), $('#signupPassword').value);
    await setDoc(doc(db, 'users', cred.user.uid), {
      name,
      nameLower: name.toLowerCase(),
      bio: '',
      location: '',
      photoURL: '',
      closeFriendIds: [],
      lastActive: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    toast('Welcome to Saathi, ' + name + '! 🎉');
  } catch (err) {
    toast(err.code === 'auth/email-already-in-use' ? 'Email already registered — please login.' : err.message);
  }
};

onAuthStateChanged(auth, (user) => {
  globalUnsubs.forEach(u => { try { u(); } catch (e) {} });
  globalUnsubs = [];
  clearViewListeners();
  if (user) {
    me = user;
    startSession();
  } else {
    me = null; myDoc = null;
    friendIds = new Set(); incomingReqs = []; outgoingReqs = new Map();
    showAuth();
  }
});

function startSession() {
  showApp();
  syncBottomnav();

  // my profile doc
  globalUnsubs.push(onSnapshot(doc(db, 'users', me.uid), (snap) => {
    myDoc = snap.exists() ? snap.data() : { name: me.email, closeFriendIds: [] };
    userCache.set(me.uid, myDoc);
    renderLeftbar();
  }, handleDbError));

  // my friends
  globalUnsubs.push(onSnapshot(collection(db, 'users', me.uid, 'friends'), (snap) => {
    friendIds = new Set(snap.docs.map(d => d.id));
    syncPresenceListeners();
    renderLeftbar();
    renderRightbar();
    refreshFriendsView();
  }, handleDbError));

  // incoming friend requests
  globalUnsubs.push(onSnapshot(
    query(collection(db, 'friendRequests'), where('to', '==', me.uid), where('status', '==', 'pending')),
    (snap) => {
      incomingReqs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const badge = $('#notifBadge');
      if (incomingReqs.length) { badge.textContent = incomingReqs.length; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
      renderLeftbar();
      refreshFriendsView();
    }, handleDbError));

  // presence heartbeat — every 60 s while the app is open
  const beat = () => updateDoc(doc(db, 'users', me.uid), { lastActive: serverTimestamp() }).catch(() => {});
  beat();
  const beatTimer = setInterval(beat, 60000);
  const onVis = () => { if (!document.hidden) beat(); };
  document.addEventListener('visibilitychange', onVis);
  globalUnsubs.push(() => { clearInterval(beatTimer); document.removeEventListener('visibilitychange', onVis); });

  // unread message badges + "new message" toast notifications
  let firstChatSnap = true;
  const lastSeenAt = new Map();
  globalUnsubs.push(onSnapshot(
    query(collection(db, 'chats'), where('members', 'array-contains', me.uid)),
    async (snap) => {
      let total = 0;
      for (const d of snap.docs) {
        const c = d.data();
        if (isUnreadChat(c)) total++;
        const prev = lastSeenAt.get(d.id) || 0;
        const cur = c.lastAt?.toMillis?.() || 0;
        if (!firstChatSnap && cur > prev && c.lastSender && c.lastSender !== me.uid
            && currentChatUid !== c.lastSender) {
          const u = await getUser(c.lastSender);
          toast(`💬 ${u.name}: ${(c.lastMessage || '').slice(0, 60)}`);
        }
        lastSeenAt.set(d.id, cur);
      }
      firstChatSnap = false;
      unreadTotal = total;
      sideChatsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateChatBadges();
      renderLeftbar();
      renderSideChatsList();
    }, () => {}));

  // outgoing friend requests
  globalUnsubs.push(onSnapshot(
    query(collection(db, 'friendRequests'), where('from', '==', me.uid), where('status', '==', 'pending')),
    (snap) => {
      outgoingReqs = new Map(snap.docs.map(d => [d.data().to, d.id]));
      refreshFriendsView();
    }, handleDbError));

  if (!location.hash || location.hash === '#/') location.hash = '#/home';
  route();
}

// ============================================================
//  ROUTER
// ============================================================
window.addEventListener('hashchange', route);

function route() {
  if (!me) return;
  clearViewListeners();
  const parts = (location.hash || '#/home').slice(2).split('/');
  const page = parts[0] || 'home';
  currentPage = page;
  currentChatUid = page === 'chat' ? (parts[1] || null) : null;
  document.body.classList.toggle('in-chat', page === 'chat');
  document.body.classList.toggle('in-reels', page === 'reels');
  document.body.dataset.page = page;
  if (page !== 'reels') stopReelSound();
  closeSheet();
  closeStory();

  document.querySelectorAll('.nav-item[data-target]').forEach(b => {
    const t = b.dataset.target;
    b.classList.toggle('active',
      t === '#/' + page || (t === '#/profile' && page === 'profile' && (!parts[1] || parts[1] === me.uid)));
  });
  markSideMenuActive();

  switch (page) {
    case 'home':    renderHome(); break;
    case 'reels':   renderReels(parts[1] || '', parts[2] || ''); break;
    case 'search':  renderSearch(); break;
    case 'friends':
      currentFriendsTab = parts[1] || (incomingReqs.length ? 'requests' : 'friends');
      friendsTabChosen = false;
      renderFriends(currentFriendsTab); break;
    case 'chats':   renderChats(); break;
    case 'chat':    renderChat(parts[1]); break;
    case 'profile': renderProfile(parts[1] || me.uid, parts[2] || 'posts'); break;
    case 'post':    renderSinglePost(parts[1]); break;
    case 'settings': renderSettings(); break;
    case 'archive': renderArchive(); break;
    default:        renderHome();
  }
  window.scrollTo(0, 0);
}

// ============================================================
//  POSTS — shared rendering
// ============================================================
function visibleToMe(p) {
  if (p.archived) return false;
  if (p.authorId === me.uid) return true;
  if (p.privacy === 'public') return true;
  return (p.audience || []).includes(me.uid);
}

function liveAuthor(id, fallbackName, fallbackPhoto) {
  const live = id && userCache.get(id);
  if (live) return { name: live.name || fallbackName || 'User', photoURL: live.photoURL || '' };
  return { name: fallbackName || 'User', photoURL: fallbackPhoto || '' };
}

async function hydrateAuthors(ids) {
  await Promise.all([...new Set(ids.filter(Boolean))].map(id => getUser(id).catch(() => null)));
}

const IG_HEART = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 3.5a5.5 5.5 0 0 0-4.5 2.3A5.5 5.5 0 0 0 7.5 3.5 5.5 5.5 0 0 0 2 9c0 6 10 11 10 11s10-5 10-11a5.5 5.5 0 0 0-5.5-5.5z"/></svg>`;
const IG_COMMENT = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-1.1 4.2 8.5 8.5 0 0 1-7.4 4.3 8.4 8.4 0 0 1-4.2-1.1L3 21l1.9-4.3A8.4 8.4 0 0 1 3.8 12 8.5 8.5 0 0 1 8.1 4.6 8.4 8.4 0 0 1 12 3.5h.5a8.5 8.5 0 0 1 8 8z"/></svg>`;
const IG_PLANE = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 3-9 9M22 3l-6 18-3-7-7-3z"/></svg>`;
const IG_BOOK = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>`;

function isSaved(postId) {
  return (myDoc?.savedPostIds || []).includes(postId);
}

function storySeenMap() {
  try { return JSON.parse(localStorage.getItem('saathi-story-seen') || '{}'); }
  catch (e) { return {}; }
}
function markStorySeen(uid) {
  const map = storySeenMap();
  map[uid] = Date.now();
  localStorage.setItem('saathi-story-seen', JSON.stringify(map));
}

let homeFeedPosts = [];
const photoTapAt = new Map();

function postCard(p) {
  const privacy = PRIVACY[p.privacy] || PRIVACY.public;
  const author = liveAuthor(p.authorId, p.authorName, p.authorPhoto);
  const likers = p._likers || [];
  const n = p.likeCount || 0;
  const likeLine = !n ? ''
    : likers.length
      ? `Liked by <b>${esc(likers[0])}</b>${n > 1 ? ` and <b>${n - 1} other${n - 1 === 1 ? '' : 's'}</b>` : ''}`
      : `<b>${n}</b> like${n === 1 ? '' : 's'}`;
  return `
  <article class="post" data-post="${p.id}">
    <div class="post-head">
      <a href="#/profile/${p.authorId}">${avatarHTML(author)}</a>
      <div class="post-head-info">
        <a class="post-author" href="#/profile/${p.authorId}">${esc(author.name)}</a>
        <span class="post-meta">${timeAgo(p.createdAt)} · ${privacy.label}</span>
      </div>
      <button class="icon-btn post-menu" data-action="open-more" data-id="${p.id}" title="More">⋯</button>
    </div>
    ${p.imageURL ? `<div class="post-photo" data-action="tap-photo" data-id="${p.id}"><img class="post-image" src="${esc(p.imageURL)}" loading="lazy" alt=""></div>` : ''}
    <div class="ig-actions">
      <button class="${p._liked ? 'liked' : ''}" data-action="like" data-id="${p.id}" title="Like">${IG_HEART}</button>
      <button data-action="toggle-comments" data-id="${p.id}" title="Comment">${IG_COMMENT}</button>
      <button data-action="share" data-id="${p.id}" title="Share">${IG_PLANE}</button>
      <button class="spacer ${isSaved(p.id) ? 'saved' : ''}" data-action="save" data-id="${p.id}" title="Save">${IG_BOOK}</button>
    </div>
    ${likeLine ? `<button class="ig-likes" data-action="open-likes" data-id="${p.id}">${likeLine}</button>` : ''}
    ${p.text ? `<div class="post-text"><b>${esc(author.name)}</b> ${esc(p.text)}</div>` : ''}
    ${isReelPost(p) ? `<div class="post-song">♪ ${esc(p.songName || REEL_SONG_NAMES[p.songId] || 'Song')}</div>` : ''}
    ${(p.commentCount || 0) > 0 ? `<button class="post-meta" style="background:none;border:none;padding:0 4px 6px" data-action="toggle-comments" data-id="${p.id}">View all ${p.commentCount} comments</button>` : ''}
    <div class="comments-area hidden" id="comments-${p.id}">
      <div class="comments-list"></div>
      <div class="comment-box">
        ${avatarHTML(myDoc || { name: '?' })}
        <input class="comment-input" placeholder="Add a comment..." maxlength="500">
        <button class="comment-send" data-action="send-comment" data-id="${p.id}">Post</button>
      </div>
    </div>
  </article>`;
}

function isReelPost(p) {
  return p.kind === 'reel' || !!(p.songURL) || !!(p.songId && p.songId !== 'none');
}

function igTile(p, asReel) {
  const inner = p.imageURL
    ? `<img src="${esc(p.imageURL)}" alt="">`
    : `<span>${esc((p.text || '').slice(0, 80))}</span>`;
  const song = isReelPost(p) ? '<i class="tile-song">♪</i>' : '';
  const href = asReel ? `#/reels/${p.authorId}/${p.id}` : `#/post/${p.id}`;
  return `<a class="ig-tile" href="${href}">${inner}${song}</a>`;
}

async function markLiked(posts) {
  await Promise.all(posts.slice(0, 15).map(async p => {
    try { p._liked = (await getDoc(doc(db, 'posts', p.id, 'likes', me.uid))).exists(); }
    catch (e) { p._liked = false; }
    if (!p.likeCount) { p._likers = []; return; }
    try {
      const likes = await getDocs(query(collection(db, 'posts', p.id, 'likes'), limit(1)));
      const ids = likes.docs.map(d => d.id);
      await hydrateAuthors(ids);
      p._likers = ids.map(id => liveAuthor(id, '', '').name);
    } catch (e) { p._likers = []; }
  }));
  posts.slice(15).forEach(p => { if (p._liked == null) p._liked = false; });
}

function emptyState(icon, text) {
  return `<div class="empty-state"><span class="big">${icon}</span>${esc(text)}</div>`;
}

// ---------------- home feed ----------------
function paintStories(posts) {
  const el = $('#stories');
  if (!el) return;
  const latest = new Map();
  for (const p of posts) {
    if (!p.imageURL) continue;
    const t = p.createdAt?.toMillis?.() || 0;
    if (!t || Date.now() - t > 86400000) continue;
    const prev = latest.get(p.authorId);
    if (!prev || t > prev.t) latest.set(p.authorId, { p, t });
  }
  const mine = latest.get(me.uid);
  const mineAuthor = myDoc || { name: '?' };
  let html = mine
    ? `<button class="story" data-action="open-story" data-id="${me.uid}"><span class="story-ring unseen">${avatarHTML(mineAuthor)}</span><span class="story-name">Your story</span></button>`
    : `<button class="story" data-action="start-compose" data-kind="story"><span class="story-ring">${avatarHTML(mineAuthor)}</span><span class="story-name">Your story</span></button>`;
  for (const [uid, item] of latest) {
    if (uid === me.uid) continue;
    const author = liveAuthor(uid, item.p.authorName, item.p.authorPhoto);
    const unseen = item.t > (storySeenMap()[uid] || 0);
    const close = (myDoc?.closeFriendIds || []).includes(uid);
    html += `<button class="story" data-action="open-story" data-id="${uid}"><span class="story-ring ${close ? 'close' : ''} ${unseen ? 'unseen' : ''}">${avatarHTML(author)}</span><span class="story-name">${esc((author.name || '').split(' ')[0])}</span></button>`;
  }
  el.innerHTML = html;
}

function paintSuggest(posts) {
  const el = $('#suggest');
  if (!el) return;
  const seen = new Set();
  const people = [];
  for (const p of posts) {
    if (!p.authorId || p.authorId === me.uid || friendIds.has(p.authorId) || seen.has(p.authorId)) continue;
    seen.add(p.authorId);
    people.push(p);
    if (people.length >= 8) break;
  }
  if (!people.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="suggest"><h3>Suggested for you</h3><div class="suggest-row">${people.map(p => {
    const a = liveAuthor(p.authorId, p.authorName, p.authorPhoto);
    return `<div class="suggest-card">${avatarHTML(a)}<a class="user-row-name" href="#/profile/${p.authorId}">${esc(a.name)}</a><div style="margin-top:8px">${friendButtonHTML(p.authorId)}</div></div>`;
  }).join('')}</div></div>`;
}

let storyTimer = null;
let storyUid = null;
let storyIndex = 0;

function storyAuthors() {
  const latest = new Map();
  for (const p of homeFeedPosts) {
    if (!p.imageURL) continue;
    const t = p.createdAt?.toMillis?.() || 0;
    if (!t || Date.now() - t > 86400000) continue;
    const prev = latest.get(p.authorId) || 0;
    if (t > prev) latest.set(p.authorId, t);
  }
  const ids = [...latest.keys()].filter(id => id !== me.uid);
  if (latest.has(me.uid)) ids.unshift(me.uid);
  return ids;
}

function storySlides(uid) {
  return homeFeedPosts
    .filter(p => p.authorId === uid && p.imageURL && (Date.now() - (p.createdAt?.toMillis?.() || 0) < 86400000))
    .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
}

function closeStory() {
  clearTimeout(storyTimer);
  storyTimer = null;
  $('#storyViewer')?.classList.add('hidden');
}

function showStory(uid, index) {
  const slides = storySlides(uid);
  if (!slides.length) { closeStory(); return; }
  if (index >= slides.length) {
    const authors = storyAuthors();
    const next = authors[authors.indexOf(uid) + 1];
    if (!next) { closeStory(); paintStories(homeFeedPosts); return; }
    showStory(next, 0);
    return;
  }
  if (index < 0) {
    const authors = storyAuthors();
    const prev = authors[authors.indexOf(uid) - 1];
    if (!prev) return;
    showStory(prev, Math.max(0, storySlides(prev).length - 1));
    return;
  }
  storyUid = uid;
  storyIndex = index;
  markStorySeen(uid);
  const p = slides[index];
  const author = uid === me.uid ? (myDoc || { name: 'You' }) : liveAuthor(p.authorId, p.authorName, p.authorPhoto);
  const bars = slides.map((_, i) => `<i class="${i < index ? 'done' : ''} ${i === index ? 'on' : ''}"><b></b></i>`).join('');
  const canReply = uid !== me.uid && friendIds.has(uid);
  const first = (author.name || 'them').split(' ')[0];
  $('#storyBody').innerHTML = `
    <div class="story-stage">
      <div class="story-bars">${bars}</div>
      <div class="story-top">${avatarHTML(author)}<b>${esc(author.name)}</b><span>${timeAgo(p.createdAt)}</span></div>
      <img src="${esc(p.imageURL)}" alt="">
      ${p.text ? `<div class="story-cap">${esc(p.text)}</div>` : ''}
      <button type="button" class="story-hit left" data-action="story-prev" aria-label="Previous story"></button>
      <button type="button" class="story-hit right" data-action="story-next" aria-label="Next story"></button>
      ${canReply ? `<div class="story-react">${['❤️','😂','🔥','👏'].map(em => `<button type="button" data-action="story-react" data-id="${uid}" data-emoji="${em}">${em}</button>`).join('')}</div><div class="story-reply"><input id="storyReply" placeholder="Reply to ${esc(first)}..." maxlength="300"><button type="button" data-action="story-send" data-id="${uid}">Send</button></div>` : ''}
    </div>`;
  clearTimeout(storyTimer);
  storyTimer = setTimeout(() => showStory(uid, index + 1), 5000);
  $('#storyViewer').classList.remove('hidden');
  paintStories(homeFeedPosts);
}

function openStory(uid) { showStory(uid, 0); }

async function sendStoryReply(uid, preset) {
  const input = $('#storyReply');
  const text = (preset || input?.value || '').trim();
  if (!text) return;
  if (!friendIds.has(uid)) return toast('You can reply to friends.');
  if (!preset && input) input.value = '';
  try {
    await sendDirect(uid, preset ? text : `Story reply: ${text}`, preset ? 'Reacted to your story' : 'Replied to your story');
    toast(preset ? 'Reaction sent' : 'Reply sent');
  } catch (err) { handleDbError(err); }
}

let notifRows = [];
let notifFilter = 'all';

function paintNotifs() {
  const list = $('#notifList');
  if (!list) return;
  document.querySelectorAll('#notifFilters .chip').forEach(c => c.classList.toggle('active', c.dataset.tab === notifFilter));
  const shown = notifFilter === 'all' ? notifRows : notifRows.filter(r => r.type === notifFilter);
  list.innerHTML = shown.map(r => r.html).join('') || `<div class="empty-state">No notifications yet.</div>`;
}

async function openNotifs() {
  const panel = $('#notifPanel');
  const list = $('#notifList');
  panel.classList.remove('hidden');
  list.innerHTML = `<div class="user-row-sub">Loading...</div>`;
  await hydrateAuthors(incomingReqs.map(r => r.from));
  notifRows = [];
  incomingReqs.forEach(r => {
    const who = liveAuthor(r.from);
    notifRows.push({ type: 'request', html: `<div class="notif-row">${avatarHTML(who)}<div style="flex:1"><b>${esc(who.name)}</b><div class="user-row-sub">Wants to be friends</div></div><button class="btn btn-primary btn-sm" data-action="accept-request" data-id="${r.from}" data-rid="${r.id}">Accept</button></div>` });
  });
  try {
    const snap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', me.uid), orderBy('createdAt', 'desc'), limit(8)));
    for (const post of snap.docs) {
      const likes = await getDocs(query(collection(db, 'posts', post.id, 'likes'), limit(3)));
      const ids = likes.docs.map(d => d.id).filter(id => id !== me.uid);
      await hydrateAuthors(ids);
      if (ids.length) {
        const name = liveAuthor(ids[0]).name;
        const extra = ids.length > 1 ? ` and ${ids.length - 1} others` : '';
        notifRows.push({ type: 'like', html: `<div class="notif-row">${avatarHTML(liveAuthor(ids[0]))}<div style="flex:1"><b>${esc(name)}</b>${esc(extra)} liked your post</div>${post.data().imageURL ? `<img src="${esc(post.data().imageURL)}" alt="" style="width:44px;height:44px;object-fit:cover">` : ''}</div>` });
      }
      const comments = await getDocs(query(collection(db, 'posts', post.id, 'comments'), orderBy('createdAt', 'desc'), limit(2)));
      for (const c of comments.docs) {
        const data = c.data();
        if (data.authorId === me.uid) continue;
        await hydrateAuthors([data.authorId]);
        const who = liveAuthor(data.authorId, data.authorName, data.authorPhoto);
        notifRows.push({ type: 'comment', html: `<a class="notif-row" href="#/post/${post.id}">${avatarHTML(who)}<div style="flex:1"><b>${esc(who.name)}</b> commented: ${esc((data.text || '').slice(0, 80))}</div>${post.data().imageURL ? `<img src="${esc(post.data().imageURL)}" alt="" style="width:44px;height:44px;object-fit:cover">` : ''}</a>` });
      }
    }
  } catch (e) { /* index may be missing; requests still show */ }
  paintNotifs();
}
function closeNotifs() { $('#notifPanel')?.classList.add('hidden'); }

let homeFeedMode = 'foryou';

function renderHome() {
  view.innerHTML = `<div id="stories" class="stories"></div>
    <div class="seg-tabs">
      <button class="chip ${homeFeedMode === 'foryou' ? 'active' : ''}" data-action="home-feed" data-tab="foryou">For you</button>
      <button class="chip ${homeFeedMode === 'friends' ? 'active' : ''}" data-action="home-feed" data-tab="friends">Friends</button>
    </div>
    <div id="suggest"></div><div id="feed">${emptyState('⏳', 'Loading posts...')}</div>`;

  const postsMap = new Map();
  const draw = async () => {
    const all = [...postsMap.values()]
      .filter(visibleToMe)
      .sort((a, b) => (b.createdAt?.toMillis?.() || Date.now()) - (a.createdAt?.toMillis?.() || Date.now()));
    const posts = homeFeedMode === 'friends'
      ? all.filter(p => p.authorId === me.uid || friendIds.has(p.authorId))
      : all;
    const feedEl = $('#feed');
    if (!feedEl) return;
    homeFeedPosts = all;
    paintStories(all);
    if (!posts.length) {
      feedEl.innerHTML = emptyState('📭', homeFeedMode === 'friends' ? 'No posts from friends yet.' : 'No posts yet. Add friends or share the first photo.');
      return;
    }
    await markLiked(posts);
    await hydrateAuthors(posts.map(p => p.authorId));
    const el = $('#feed');
    if (!el) return;
    paintSuggest(homeFeedMode === 'friends' ? [] : all);
    el.innerHTML = posts.map(postCard).join('');
  };

  // public posts
  const qPublic = query(collection(db, 'posts'),
    where('privacy', '==', 'public'), orderBy('createdAt', 'desc'), limit(60));
  viewUnsubs.push(onSnapshot(qPublic, (snap) => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') postsMap.delete(ch.doc.id);
      else postsMap.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
    });
    draw();
  }, handleDbError));

  // posts where I'm in the audience (friends / close / own / private)
  const qAudience = query(collection(db, 'posts'),
    where('audience', 'array-contains', me.uid), orderBy('createdAt', 'desc'), limit(60));
  viewUnsubs.push(onSnapshot(qAudience, (snap) => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') postsMap.delete(ch.doc.id);
      else postsMap.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
    });
    draw();
  }, handleDbError));
}

const REEL_SONG_NAMES = { none: '', raat: 'Raat', dholak: 'Dholak', mehfil: 'Mehfil', breeze: 'Breeze' };
let composeSongId = 'none';
let composeSongURL = '';
let composeSongName = '';
let reelMuted = true;
let reelSoundKey = '';
let reelAudioEl = null;
let reelCtx = null;
let reelStopSynth = null;
const reelById = new Map();

function stopReelSound() {
  reelSoundKey = '';
  if (reelAudioEl) { reelAudioEl.pause(); reelAudioEl.src = ''; reelAudioEl = null; }
  if (reelStopSynth) { reelStopSynth(); reelStopSynth = null; }
}

function startBuiltInSong(id) {
  const ctx = reelCtx || (reelCtx = new AudioContext());
  if (ctx.state === 'suspended') ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.2;
  master.connect(ctx.destination);
  let stopped = false;
  const tone = (freq, t, dur, type, gain) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  };
  const library = {
    raat:   { step: 0.42, notes: [262, 294, 330, 392, 349, 330, 294, 262], wave: 'triangle', bass: 98 },
    dholak: { step: 0.28, notes: [196, 0, 247, 0, 196, 220, 0, 165], wave: 'square', bass: 82 },
    mehfil: { step: 0.36, notes: [330, 392, 440, 494, 440, 392, 349, 330], wave: 'sine', bass: 110 },
    breeze: { step: 0.33, notes: [392, 440, 494, 523, 494, 440, 392, 349], wave: 'triangle', bass: 131 }
  };
  const song = library[id];
  if (!song) { master.disconnect(); return () => {}; }
  const loop = () => {
    if (stopped) return;
    const t0 = ctx.currentTime + 0.05;
    song.notes.forEach((f, i) => {
      if (!f) return;
      tone(f, t0 + i * song.step, song.step * 0.85, song.wave, id === 'dholak' ? 0.08 : 0.12);
    });
    tone(song.bass, t0, song.notes.length * song.step * 0.95, 'sine', 0.08);
  };
  loop();
  const timer = setInterval(loop, song.notes.length * song.step * 1000);
  return () => { stopped = true; clearInterval(timer); try { master.disconnect(); } catch (e) {} };
}

function fallbackSongId(p) {
  const keys = ['raat', 'dholak', 'mehfil', 'breeze'];
  let n = 0;
  for (const ch of String(p?.id || '')) n += ch.charCodeAt(0);
  return keys[n % keys.length];
}

function resolvedSong(p) {
  if (!p) return null;
  if (p.songURL) return { url: p.songURL, id: 'custom', name: p.songName || 'Song' };
  if (p.songId && p.songId !== 'none' && REEL_SONG_NAMES[p.songId]) {
    return { url: '', id: p.songId, name: p.songName || REEL_SONG_NAMES[p.songId] };
  }
  if (p.kind === 'reel' || p.imageURL) {
    const id = fallbackSongId(p);
    return { url: '', id, name: REEL_SONG_NAMES[id] };
  }
  return null;
}

function playReelPost(p) {
  if (!p) { stopReelSound(); return; }
  const song = resolvedSong(p);
  const key = p.id + '|' + (song ? song.url || song.id : '');
  if (key === reelSoundKey) return;
  stopReelSound();
  reelSoundKey = key;
  if (reelMuted || !song) return;
  if (reelCtx && reelCtx.state === 'suspended') reelCtx.resume();
  if (song.url) {
    reelAudioEl = new Audio(song.url);
    reelAudioEl.loop = true;
    reelAudioEl.play().catch(() => {});
    return;
  }
  reelStopSynth = startBuiltInSong(song.id);
}

function paintReelMute() {
  const icon = reelMuted ? '🔇' : '🔊';
  document.querySelectorAll('.reel-audio-icon').forEach(el => { el.textContent = icon; });
  const arrow = document.querySelector('.reel-arrows [data-action="reel-mute"]');
  if (arrow) arrow.textContent = icon;
}

function syncReelAudio() {
  const box = $('#reels');
  if (!box || currentPage !== 'reels') return;
  const mid = box.scrollTop + box.clientHeight / 2;
  let best = null;
  let bestDist = Infinity;
  box.querySelectorAll('.reel').forEach(section => {
    const center = section.offsetTop + section.offsetHeight / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) { bestDist = dist; best = section; }
  });
  if (!best) return;
  playReelPost(reelById.get(best.dataset.post));
  box.querySelectorAll('.reel-audio').forEach(el => el.classList.toggle('spin', el.closest('.reel') === best && !reelMuted));
}

function scrollReel(dir) {
  const box = $('#reels');
  if (!box) return;
  box.scrollBy({ top: dir * box.clientHeight, behavior: 'smooth' });
}

function reelCard(p) {
  const author = liveAuthor(p.authorId, p.authorName, p.authorPhoto);
  const rel = p.authorId === me.uid ? '' : friendButtonHTML(p.authorId);
  return `<section class="reel" data-post="${p.id}">
    ${p.imageURL
      ? `<img src="${esc(p.imageURL)}" alt="" data-action="tap-photo" data-id="${p.id}">`
      : `<div class="reel-text">${esc(p.text || '')}</div>`}
    <div class="reel-side">
      <button class="${p._liked ? 'liked' : ''}" data-action="like" data-id="${p.id}" title="Like">${IG_HEART}<span>${p.likeCount || 0}</span></button>
      <button data-action="reel-comments" data-id="${p.id}" title="Comment">${IG_COMMENT}<span>${p.commentCount || 0}</span></button>
      <button data-action="share" data-id="${p.id}" title="Share">${IG_PLANE}</button>
      <button class="${isSaved(p.id) ? 'saved' : ''}" data-action="save" data-id="${p.id}" title="Save">${IG_BOOK}</button>
      <button data-action="open-more" data-id="${p.id}" title="More">⋯</button>
    </div>
    <div class="reel-meta">
      <a href="#/profile/${p.authorId}">${avatarHTML(author)} <b>${esc(author.name)}</b></a>
      ${rel}
      ${p.text && p.imageURL ? `<p>${esc(p.text)}</p>` : ''}
      <button type="button" class="reel-audio" data-action="reel-mute" title="${reelMuted ? 'Unmute' : 'Mute'}"><span class="reel-audio-icon">${reelMuted ? '🔇' : '🔊'}</span> ${esc((resolvedSong(p) || {}).name || 'Song')}</button>
    </div>
  </section>`;
}

function renderReels(authorId, startId) {
  view.innerHTML = `<div id="reels" class="reels">${emptyState('⏳', 'Loading reels...')}</div>
    <div class="reel-arrows">
      <button type="button" data-action="reel-prev" title="Previous reel">↑</button>
      <button type="button" data-action="reel-next" title="Next reel">↓</button>
      <button type="button" data-action="reel-mute" title="Sound">${reelMuted ? '🔇' : '🔊'}</button>
    </div>`;
  const postsMap = new Map();
  const draw = async () => {
    const posts = [...postsMap.values()]
      .filter(visibleToMe)
      .filter(p => !authorId || p.authorId === authorId)
      .filter(p => p.imageURL)
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    const list = authorId ? posts.filter(isReelPost) : posts;
    const box = $('#reels');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = emptyState('🎬', 'No reels yet. Post a photo and it shows up here.');
      return;
    }
    await markLiked(list);
    await hydrateAuthors(list.map(p => p.authorId));
    const el = $('#reels');
    if (!el) return;
    reelById.clear();
    list.forEach(p => reelById.set(p.id, p));
    const at = el.scrollTop;
    const jump = startId && !el.dataset.ready;
    el.innerHTML = list.map(reelCard).join('');
    if (jump) {
      el.dataset.ready = '1';
      requestAnimationFrame(() => {
        el.querySelector(`.reel[data-post="${CSS.escape(startId)}"]`)?.scrollIntoView({ block: 'start' });
        syncReelAudio();
      });
    } else {
      el.scrollTop = at;
      syncReelAudio();
    }
  };
  const scroller = $('#reels');
  scroller.addEventListener('scroll', () => syncReelAudio(), { passive: true });
  scroller.addEventListener('pointerdown', () => {
    if (reelCtx && reelCtx.state === 'suspended') reelCtx.resume();
    reelSoundKey = '';
    syncReelAudio();
  }, { once: true });
  const qPublic = authorId
    ? query(collection(db, 'posts'), where('authorId', '==', authorId), where('privacy', '==', 'public'), orderBy('createdAt', 'desc'), limit(30))
    : query(collection(db, 'posts'), where('privacy', '==', 'public'), orderBy('createdAt', 'desc'), limit(40));
  const qAudience = authorId
    ? query(collection(db, 'posts'), where('authorId', '==', authorId), where('audience', 'array-contains', me.uid), orderBy('createdAt', 'desc'), limit(30))
    : query(collection(db, 'posts'), where('audience', 'array-contains', me.uid), orderBy('createdAt', 'desc'), limit(40));
  [qPublic, qAudience].forEach(q => viewUnsubs.push(onSnapshot(q, (snap) => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') postsMap.delete(ch.doc.id);
      else postsMap.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
    });
    draw();
  }, handleDbError)));
}

document.addEventListener('keydown', (e) => {
  if (currentPage !== 'reels') return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); scrollReel(1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); scrollReel(-1); }
});

// ---------------- compose ----------------
let composePrivacy = 'public';
let composeImageFile = null;
let composeKind = 'post';

function openCreateMenu() {
  openSheet(`
    <div class="modal-head"><strong>Create</strong><button class="icon-btn" data-action="close-sheet">✕</button></div>
    <div class="create-choices">
      <button type="button" data-action="start-compose" data-kind="post">▣ Post</button>
      <button type="button" data-action="start-compose" data-kind="story">◎ Story</button>
      <button type="button" data-action="start-compose" data-kind="reel">▶ Reel</button>
    </div>`);
}

function openCompose(kind) {
  composeKind = kind || 'post';
  closeSheet();
  const titles = { post: 'New post', story: 'New story', reel: 'New reel' };
  $('#composeTitle').textContent = titles[composeKind] || 'New post';
  $('#composeSongBlock')?.classList.toggle('hidden', composeKind === 'story');
  $('#composeText').placeholder = composeKind === 'story' ? 'Add a caption...' : composeKind === 'reel' ? 'Write a caption...' : "What's on your mind?";
  $('#composeUser').innerHTML = `${avatarHTML(myDoc || { name: '?' })}<span>${esc(myDoc?.name || '')}</span>`;
  $('#composeText').value = '';
  composeImageFile = null;
  composeSongId = 'none';
  composeSongURL = '';
  composeSongName = '';
  $('#composeImage').value = '';
  $('#composeSong').value = '';
  $('#composeSongName').textContent = '';
  document.querySelectorAll('#songChips .chip').forEach(c => c.classList.toggle('active', c.dataset.song === 'none'));
  $('#composePreview').classList.add('hidden');
  setPrivacyChips(composeKind === 'story' ? 'friends' : 'public');
  $('#composeModal').classList.remove('hidden');
  setTimeout(() => $('#composeText').focus(), 100);
}
function closeCompose() { $('#composeModal').classList.add('hidden'); }

function setPrivacyChips(p) {
  composePrivacy = p;
  document.querySelectorAll('#privacyChips .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.privacy === p));
}

$('#composeImage').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  composeImageFile = f;
  $('#composePreviewImg').src = URL.createObjectURL(f);
  $('#composePreview').classList.remove('hidden');
});

$('#composeSong').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 160000) {
    toast('Use a short song clip under 160 KB.');
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    composeSongURL = String(reader.result || '');
    composeSongName = f.name.replace(/\.[^.]+$/, '').slice(0, 40);
    composeSongId = 'custom';
    $('#composeSongName').textContent = composeSongName;
    document.querySelectorAll('#songChips .chip').forEach(c => c.classList.remove('active'));
  };
  reader.readAsDataURL(f);
});

// Compress a photo and return it as a base64 data-URL that fits
// comfortably inside a 1 MiB Firestore document.
async function imageToDataURL(file, maxChars = 880000, startMaxSide = 1280) {
  const bmp = await createImageBitmap(file);
  let maxSide = startMaxSide;
  let quality = 0.82;
  for (let attempt = 0; attempt < 7; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
    const dataURL = await new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
    if (dataURL.length <= maxChars) return dataURL;
    maxSide = Math.round(maxSide * 0.7);
    quality = Math.max(0.45, quality - 0.1);
  }
  throw new Error('Image is too large even after compression.');
}

async function submitPost() {
  const text = $('#composeText').value.trim();
  if (composeKind !== 'post' && !composeImageFile) return toast('Add a photo.');
  if (composeKind === 'reel' && composeSongId === 'none') return toast('Pick a song for the reel.');
  if (!text && !composeImageFile) return toast('Write something or add a photo.');

  // audience = people allowed to see this post (besides public posts)
  let audience = [me.uid];
  if (composePrivacy === 'friends') audience = [me.uid, ...friendIds];
  else if (composePrivacy === 'close') audience = [me.uid, ...(myDoc?.closeFriendIds || [])];

  const btn = $('#postBtn');
  btn.disabled = true; btn.textContent = 'Posting...';
  try {
    let imageURL = '';
    const songURL = composeSongId === 'custom' ? composeSongURL : '';
    if (composeImageFile) {
      const room = Math.max(180000, 820000 - songURL.length);
      imageURL = await imageToDataURL(composeImageFile, room);
    }
    const songName = composeSongId === 'custom' ? composeSongName : (REEL_SONG_NAMES[composeSongId] || '');
    await addDoc(collection(db, 'posts'), {
      authorId: me.uid,
      authorName: myDoc?.name || 'User',
      authorPhoto: myDoc?.photoURL || '',
      text,
      imageURL,
      songId: composeKind === 'story' ? 'none' : composeSongId,
      songName: composeKind === 'story' ? '' : songName,
      songURL: composeKind === 'story' ? '' : songURL,
      kind: composeKind,
      privacy: composePrivacy,
      audience,
      likeCount: 0,
      commentCount: 0,
      createdAt: serverTimestamp()
    });
    closeCompose();
    toast(composeKind === 'story' ? 'Story added' : composeKind === 'reel' ? 'Reel posted' : 'Posted');
    const next = composeKind === 'reel' ? '#/reels' : '#/home';
    if (location.hash !== next) location.hash = next;
    else route();
  } catch (err) {
    handleDbError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Post';
  }
}

// ---------------- likes / comments / share ----------------
async function toggleSave(postId) {
  const ref = doc(db, 'users', me.uid);
  const saved = isSaved(postId);
  try {
    await updateDoc(ref, { savedPostIds: saved ? arrayRemove(postId) : arrayUnion(postId) });
    const set = new Set(myDoc.savedPostIds || []);
    if (saved) set.delete(postId); else set.add(postId);
    myDoc.savedPostIds = [...set];
    document.querySelector(`[data-action="save"][data-id="${postId}"]`)?.classList.toggle('saved', !saved);
    toast(saved ? 'Removed from saved' : 'Saved');
  } catch (err) { handleDbError(err); }
}

async function renderSinglePost(id) {
  view.innerHTML = `<button class="icon-btn" data-action="back" style="color:#fff;font-size:22px">←</button><div id="feed">${emptyState('⏳', 'Loading...')}</div>`;
  try {
    const snap = await getDoc(doc(db, 'posts', id));
    if (!snap.exists()) { $('#feed').innerHTML = emptyState('📭', 'Post not found.'); return; }
    const p = { id: snap.id, ...snap.data() };
    if (!visibleToMe(p)) { $('#feed').innerHTML = emptyState('🔒', 'This post is private.'); return; }
    await markLiked([p]);
    await hydrateAuthors([p.authorId]);
    const el = $('#feed');
    if (el) el.innerHTML = postCard(p);
  } catch (err) { handleDbError(err); }
}

async function toggleLike(postId) {
  const likeRef = doc(db, 'posts', postId, 'likes', me.uid);
  const postRef = doc(db, 'posts', postId);
  const btn = document.querySelector(`[data-action="like"][data-id="${postId}"]`);
  try {
    const snap = await getDoc(likeRef);
    if (snap.exists()) {
      await deleteDoc(likeRef);
      await updateDoc(postRef, { likeCount: increment(-1) });
      btn?.classList.remove('liked');
    } else {
      await setDoc(likeRef, { uid: me.uid, at: serverTimestamp() });
      await updateDoc(postRef, { likeCount: increment(1) });
      btn?.classList.add('liked');
    }
  } catch (err) { handleDbError(err); }
}

const openCommentThreads = new Map(); // postId -> unsubscribe

async function toggleComments(postId) {
  const area = $('#comments-' + CSS.escape(postId));
  if (!area) return;
  if (!area.classList.contains('hidden')) {
    area.classList.add('hidden');
    openCommentThreads.get(postId)?.();
    openCommentThreads.delete(postId);
    return;
  }
  area.classList.remove('hidden');
  const listEl = area.querySelector('.comments-list');
  const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(100));
  const unsub = onSnapshot(q, async (snap) => {
    const comments = snap.docs.map(d => d.data());
    await hydrateAuthors(comments.map(c => c.authorId));
    if (!listEl.isConnected) return;
    listEl.innerHTML = comments.map(c => {
      const author = liveAuthor(c.authorId, c.authorName, c.authorPhoto);
      return `<div class="comment">
        ${avatarHTML(author)}
        <div class="comment-body">
          <span class="comment-author">${esc(author.name)}</span><span class="comment-time">${timeAgo(c.createdAt)}</span>
          <div>${esc(c.text)}</div>
        </div>
      </div>`;
    }).join('') || `<div class="empty-state" style="padding:12px">No comments yet.</div>`;
  }, handleDbError);
  openCommentThreads.set(postId, unsub);
  viewUnsubs.push(unsub);
}

let commentReply = null;

function commentHTML(c, postId) {
  const author = liveAuthor(c.authorId, c.authorName, c.authorPhoto);
  const reply = c.replyText ? `<div class="comment-reply">Reply to ${esc(c.replyName || '')}: ${esc(c.replyText)}</div>` : '';
  return `<div class="comment">${avatarHTML(author)}<div class="comment-body"><span class="comment-author">${esc(author.name)}</span><span class="comment-time">${timeAgo(c.createdAt)}</span>${reply}<div>${esc(c.text)}</div><div class="comment-actions"><button type="button" data-action="reply-comment" data-id="${postId}" data-name="${esc(author.name)}" data-preview="${esc((c.text || '').slice(0, 60))}">Reply</button><button type="button" data-action="like-comment" data-id="${postId}" data-cid="${c.id}">${c._liked ? '❤️' : '♡'}</button></div></div></div>`;
}

async function sendComment(postId, inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  const reply = commentReply && commentReply.postId === postId ? commentReply : null;
  commentReply = null;
  const box = $('#sheetCommentInput');
  if (box) box.placeholder = 'Add a comment...';
  try {
    await addDoc(collection(db, 'posts', postId, 'comments'), {
      authorId: me.uid,
      authorName: myDoc?.name || 'User',
      authorPhoto: myDoc?.photoURL || '',
      text,
      createdAt: serverTimestamp(),
      ...(reply ? { replyName: reply.name, replyText: reply.text } : {})
    });
    await updateDoc(doc(db, 'posts', postId), { commentCount: increment(1) });
  } catch (err) { handleDbError(err); }
}

let sheetUnsub = null;

function closeSheet() {
  sheetUnsub?.();
  sheetUnsub = null;
  $('#igSheet')?.classList.add('hidden');
}

function openSheet(html) {
  sheetUnsub?.();
  sheetUnsub = null;
  $('#igSheetCard').innerHTML = html;
  $('#igSheet').classList.remove('hidden');
}

async function sendDirect(otherUid, text, preview) {
  const chatId = chatIdFor(me.uid, otherUid);
  await setDoc(doc(db, 'chats', chatId), { members: [me.uid, otherUid].sort() }, { merge: true });
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    senderId: me.uid,
    text,
    mode: 'normal',
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, 'chats', chatId), {
    lastMessage: preview || text,
    lastAt: serverTimestamp(),
    lastSender: me.uid
  });
}

function openComments(postId) {
  openSheet(`
    <div class="modal-head"><strong>Comments</strong><button class="icon-btn" data-action="close-sheet">✕</button></div>
    <div class="comments-list" id="sheetComments"></div>
    <div class="comment-box">
      <input class="comment-input" id="sheetCommentInput" placeholder="Add a comment..." maxlength="500">
      <button class="comment-send" data-action="send-sheet-comment" data-id="${postId}">Post</button>
    </div>`);
  const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(100));
  sheetUnsub = onSnapshot(q, async (snap) => {
    const listEl = $('#sheetComments');
    if (!listEl) return;
    const comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await hydrateAuthors(comments.map(c => c.authorId));
    await Promise.all(comments.slice(0, 20).map(async c => {
      try { c._liked = (await getDoc(doc(db, 'posts', postId, 'comments', c.id, 'likes', me.uid))).exists(); }
      catch (e) { c._liked = false; }
    }));
    if (!listEl.isConnected) return;
    listEl.innerHTML = comments.map(c => commentHTML(c, postId)).join('') || `<div class="empty-state" style="padding:12px">No comments yet.</div>`;
  }, handleDbError);
  $('#sheetCommentInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendComment(postId, e.target);
  });
}

async function openLikes(postId) {
  openSheet(`<div class="modal-head"><strong>Likes</strong><button class="icon-btn" data-action="close-sheet">✕</button></div><div class="user-row-sub">Loading...</div>`);
  try {
    const likes = await getDocs(query(collection(db, 'posts', postId, 'likes'), limit(40)));
    const ids = likes.docs.map(d => d.id);
    await hydrateAuthors(ids);
    const rows = ids.map(uid => {
      const who = liveAuthor(uid);
      return `<a class="sheet-row" href="#/profile/${uid}">${avatarHTML(who)}<span>${esc(who.name)}</span></a>`;
    }).join('');
    openSheet(`<div class="modal-head"><strong>Likes</strong><button class="icon-btn" data-action="close-sheet">✕</button></div>${rows || `<div class="empty-state">No likes yet.</div>`}`);
  } catch (err) { handleDbError(err); }
}

async function openShare(postId) {
  const ids = [...friendIds];
  if (!ids.length) {
    openSheet(`<div class="modal-head"><strong>Share</strong><button class="icon-btn" data-action="close-sheet">✕</button></div><div class="empty-state">Add a friend to share this.</div><button class="sheet-row" data-action="copy-link" data-id="${postId}">Copy link</button>`);
    return;
  }
  await Promise.all(ids.map(uid => getUser(uid).catch(() => null)));
  const rows = ids.map(uid => {
    const who = liveAuthor(uid);
    return `<button class="sheet-row" data-action="send-share" data-id="${uid}" data-post="${postId}">${avatarHTML(who)}<span>${esc(who.name)}</span></button>`;
  }).join('');
  openSheet(`<div class="modal-head"><strong>Share</strong><button class="icon-btn" data-action="close-sheet">✕</button></div>${rows}<button class="sheet-row" data-action="copy-link" data-id="${postId}">Copy link</button>`);
}

async function sendShare(uid, postId) {
  if (!friendIds.has(uid)) return toast('You can share with friends.');
  try {
    const snap = await getDoc(doc(db, 'posts', postId));
    const p = snap.data() || {};
    const caption = (p.text || 'a photo').slice(0, 80);
    const chatId = chatIdFor(me.uid, uid);
    await setDoc(doc(db, 'chats', chatId), { members: [me.uid, uid].sort() }, { merge: true });
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId: me.uid,
      text: `Shared a post: ${caption}`,
      postId,
      mode: 'normal',
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: 'Shared a post',
      lastAt: serverTimestamp(),
      lastSender: me.uid
    });
    closeSheet();
    toast('Sent');
  } catch (err) { handleDbError(err); }
}

function findLoadedPost(postId) {
  return reelById.get(postId) || homeFeedPosts.find(p => p.id === postId) || null;
}

async function openMore(postId) {
  let p = findLoadedPost(postId);
  if (!p) {
    try {
      const snap = await getDoc(doc(db, 'posts', postId));
      if (snap.exists()) p = { id: snap.id, ...snap.data() };
    } catch (e) { /* menu still opens */ }
  }
  const mine = p ? p.authorId === me.uid : false;
  openSheet(`
    <div class="modal-head"><strong>More</strong><button class="icon-btn" data-action="close-sheet">✕</button></div>
    <button class="sheet-row" data-action="share" data-id="${postId}">Share</button>
    <button class="sheet-row" data-action="copy-link" data-id="${postId}">Copy link</button>
    <button class="sheet-row" data-action="open-comments" data-id="${postId}">Comments</button>
    ${mine && p?.imageURL ? `<button class="sheet-row" data-action="add-highlight" data-id="${postId}">Add to highlights</button>` : ''}
    ${mine ? `<button class="sheet-row" data-action="${p?.archived ? 'unarchive-post' : 'archive-post'}" data-id="${postId}">${p?.archived ? 'Show on profile' : 'Archive'}</button>` : ''}
    ${mine ? `<button class="sheet-row" data-action="delete-post" data-id="${postId}">Delete</button>` : ''}`);
}

async function copyPostLink(postId) {
  const url = `${location.origin}${location.pathname}#/post/${postId}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch (e) {
    toast(url);
  }
  closeSheet();
}

async function sharePost(postId) {
  openShare(postId);
}

async function deletePost(postId) {
  if (!confirm('Delete this post permanently?')) return;
  try {
    await deleteDoc(doc(db, 'posts', postId));
    toast('Post deleted.');
  } catch (err) { handleDbError(err); }
}

// ============================================================
//  FRIEND SYSTEM
// ============================================================
function relationshipWith(uid) {
  if (uid === me.uid) return 'me';
  if (friendIds.has(uid)) return 'friends';
  if (outgoingReqs.has(uid)) return 'requested';
  const incoming = incomingReqs.find(r => r.from === uid);
  if (incoming) return 'incoming';
  return 'none';
}

function friendButtonHTML(uid) {
  const rel = relationshipWith(uid);
  switch (rel) {
    case 'friends':   return `<button class="btn btn-light btn-sm" data-action="unfriend" data-id="${uid}">✓ Friends</button>`;
    case 'requested': return `<button class="btn btn-light btn-sm" data-action="cancel-request" data-id="${uid}">Requested ✕</button>`;
    case 'incoming':  return `<button class="btn btn-primary btn-sm" data-action="accept-request" data-id="${uid}">Accept</button>`;
    default:          return `<button class="btn btn-primary btn-sm" data-action="add-friend" data-id="${uid}">＋ Add Friend</button>`;
  }
}

async function sendRequest(toUid) {
  // if they already requested me → accept instead
  const incoming = incomingReqs.find(r => r.from === toUid);
  if (incoming) return acceptRequest(incoming.id, toUid);
  try {
    await setDoc(doc(db, 'friendRequests', `${me.uid}_${toUid}`), {
      from: me.uid, to: toUid, status: 'pending', createdAt: serverTimestamp()
    });
    toast('Friend request sent ✅');
  } catch (err) { handleDbError(err); }
}

async function acceptRequest(rid, fromUid) {
  try {
    await updateDoc(doc(db, 'friendRequests', rid), { status: 'accepted' });
    const data = { since: serverTimestamp(), rid };
    await setDoc(doc(db, 'users', me.uid, 'friends', fromUid), data);
    await setDoc(doc(db, 'users', fromUid, 'friends', me.uid), data);
    toast('You are now friends! 🎉');
  } catch (err) { handleDbError(err); }
}

async function rejectRequest(rid) {
  try { await deleteDoc(doc(db, 'friendRequests', rid)); toast('Request removed.'); }
  catch (err) { handleDbError(err); }
}

async function cancelRequest(toUid) {
  const rid = outgoingReqs.get(toUid);
  if (!rid) return;
  try { await deleteDoc(doc(db, 'friendRequests', rid)); toast('Request cancelled.'); }
  catch (err) { handleDbError(err); }
}

async function unfriend(uid) {
  if (!confirm('Remove from friends?')) return;
  try {
    await deleteDoc(doc(db, 'users', me.uid, 'friends', uid));
    await deleteDoc(doc(db, 'users', uid, 'friends', me.uid));
    if ((myDoc?.closeFriendIds || []).includes(uid)) {
      await updateDoc(doc(db, 'users', me.uid), { closeFriendIds: arrayRemove(uid) });
    }
    toast('Removed from friends.');
  } catch (err) { handleDbError(err); }
}

async function toggleCloseFriend(uid) {
  const isClose = (myDoc?.closeFriendIds || []).includes(uid);
  try {
    await updateDoc(doc(db, 'users', me.uid), {
      closeFriendIds: isClose ? arrayRemove(uid) : arrayUnion(uid)
    });
    toast(isClose ? 'Removed from Close Friends' : 'Added to Close Friends ⭐');
  } catch (err) { handleDbError(err); }
}

// ============================================================
//  FRIENDS PAGE
// ============================================================
async function renderFriends(tab) {
  view.innerHTML = `
    <h2 class="page-title">Friends</h2>
    <div class="seg-tabs">
      <button class="chip ${tab === 'requests' ? 'active' : ''}" data-action="friends-tab" data-tab="requests">Requests ${incomingReqs.length ? '(' + incomingReqs.length + ')' : ''}</button>
      <button class="chip ${tab === 'friends' ? 'active' : ''}" data-action="friends-tab" data-tab="friends">My Friends</button>
      <button class="chip ${tab === 'sent' ? 'active' : ''}" data-action="friends-tab" data-tab="sent">Sent</button>
    </div>
    <div id="friendsList">${emptyState('⏳', 'Loading...')}</div>`;

  const listEl = $('#friendsList');

  if (tab === 'requests') {
    if (!incomingReqs.length) { listEl.innerHTML = emptyState('📨', 'No pending requests.'); return; }
    const rows = await Promise.all(incomingReqs.map(async r => {
      const u = await getUser(r.from);
      return `<div class="user-row">
        ${avatarHTML(u)}
        <div class="user-row-info">
          <a class="user-row-name" href="#/profile/${r.from}">${esc(u.name)}</a>
          <span class="user-row-sub">${timeAgo(r.createdAt)}</span>
        </div>
        <div class="user-row-btns">
          <button class="btn btn-primary btn-sm" data-action="accept-request" data-id="${r.from}" data-rid="${r.id}">Accept</button>
          <button class="btn btn-light btn-sm" data-action="reject-request" data-rid="${r.id}">Reject</button>
        </div>
      </div>`;
    }));
    listEl.innerHTML = rows.join('');
    return;
  }

  if (tab === 'friends') {
    if (!friendIds.size) { listEl.innerHTML = emptyState('🤝', 'No friends yet. Search people and send a request!'); return; }
    const ids = [...friendIds];
    const rows = await Promise.all(ids.map(async uid => {
      const u = await getUser(uid);
      const isClose = (myDoc?.closeFriendIds || []).includes(uid);
      return `<div class="user-row">
        ${avatarHTML(u)}
        <div class="user-row-info">
          <a class="user-row-name" href="#/profile/${uid}">${esc(u.name)}</a>
          <span class="user-row-sub">${esc(u.bio || '')}</span>
        </div>
        <div class="user-row-btns">
          <button class="star-btn" data-action="toggle-close" data-id="${uid}" title="Close friend">${isClose ? '⭐' : '☆'}</button>
          <button class="btn btn-primary btn-sm" data-action="message" data-id="${uid}">💬</button>
          <button class="btn btn-danger btn-sm" data-action="unfriend" data-id="${uid}">✕</button>
        </div>
      </div>`;
    }));
    listEl.innerHTML = rows.join('');
    return;
  }

  // sent
  if (!outgoingReqs.size) { listEl.innerHTML = emptyState('📤', 'No sent requests.'); return; }
  const rows = await Promise.all([...outgoingReqs.keys()].map(async uid => {
    const u = await getUser(uid);
    return `<div class="user-row">
      ${avatarHTML(u)}
      <div class="user-row-info"><a class="user-row-name" href="#/profile/${uid}">${esc(u.name)}</a></div>
      <div class="user-row-btns">
        <button class="btn btn-light btn-sm" data-action="cancel-request" data-id="${uid}">Cancel</button>
      </div>
    </div>`;
  }));
  listEl.innerHTML = rows.join('');
}

function recentSearches() {
  try { return JSON.parse(localStorage.getItem('saathi-recent') || '[]'); }
  catch (e) { return []; }
}
function rememberSearch(u) {
  const list = recentSearches().filter(x => x.uid !== u.uid);
  list.unshift({ uid: u.uid, name: u.name || 'User' });
  localStorage.setItem('saathi-recent', JSON.stringify(list.slice(0, 8)));
}
async function copyText(text, ok) {
  try { await navigator.clipboard.writeText(text); toast(ok || 'Copied'); }
  catch (e) { toast(text); }
}
async function toggleCommentLike(postId, cid, btn) {
  if (!postId || !cid) return;
  try {
    const ref = doc(db, 'posts', postId, 'comments', cid, 'likes', me.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) { await deleteDoc(ref); if (btn) btn.textContent = '♡'; }
    else { await setDoc(ref, { uid: me.uid, at: serverTimestamp() }); if (btn) btn.textContent = '❤️'; }
  } catch (err) { handleDbError(err); }
}

// ============================================================
//  SEARCH
// ============================================================
function renderSearch() {
  view.innerHTML = `
    <div class="search-bar">
      <input id="searchInput" placeholder="Search" autocomplete="off">
    </div>
    <div id="searchResults"></div>
    <div id="explore" class="ig-grid"></div>`;

  let timer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(timer);
    const term = e.target.value.trim().toLowerCase();
    timer = setTimeout(() => doSearch(term), 400);
  });
  loadExplore();
}

async function loadExplore() {
  const grid = $('#explore');
  if (!grid) return;
  try {
    const snap = await getDocs(query(collection(db, 'posts'),
      where('privacy', '==', 'public'), orderBy('createdAt', 'desc'), limit(36)));
    if (!grid.isConnected) return;
    const posts = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.imageURL && visibleToMe(p));
    grid.innerHTML = posts.length ? posts.map(igTile).join('') : '';
    if (!posts.length) $('#searchResults').innerHTML = emptyState('🔍', 'No photos to explore yet.');
  } catch (err) { handleDbError(err); }
}

async function doSearch(term) {
  const res = $('#searchResults');
  const grid = $('#explore');
  if (!term) {
    const recent = recentSearches();
    res.innerHTML = recent.length
      ? `<div class="user-row-sub" style="padding:4px 8px 8px">Recent</div>${recent.map(u => `<a class="sheet-row" href="#/profile/${u.uid}">${esc(u.name)}</a>`).join('')}`
      : '';
    grid?.classList.remove('hidden');
    return;
  }
  grid?.classList.add('hidden');
  try {
    const q = query(collection(db, 'users'),
      where('nameLower', '>=', term), where('nameLower', '<=', term + '\uf8ff'), limit(20));
    const snap = await getDocs(q);
    const users = snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.uid !== me.uid);
    if (!users.length) { res.innerHTML = emptyState('😕', 'No users found.'); return; }
    users.forEach(rememberSearch);
    res.innerHTML = users.map(u => `
      <div class="user-row">
        ${avatarHTML(u)}
        <div class="user-row-info">
          <a class="user-row-name" href="#/profile/${u.uid}">${esc(u.name)}</a>
          <span class="user-row-sub">${esc(u.bio || u.location || '')}</span>
        </div>
        <div class="user-row-btns">${friendButtonHTML(u.uid)}</div>
      </div>`).join('');
  } catch (err) { handleDbError(err); }
}

// ============================================================
//  PROFILE
// ============================================================
async function renderProfile(uid, tab = 'activity') {
  const isMe = uid === me.uid;
  const u = isMe ? (myDoc || await getUser(uid)) : await getUser(uid);
  const rel = relationshipWith(uid);
  const isClose = (myDoc?.closeFriendIds || []).includes(uid);

  let counts = { friends: 0 };
  try { counts.friends = (await getDocs(collection(db, 'users', uid, 'friends'))).size; } catch (e) {}

  let actionBtns = '';
  if (isMe) {
    actionBtns = `
      <button class="btn btn-light btn-sm" data-action="open-edit">Edit profile</button>
      <button class="btn btn-light btn-sm" data-action="share-profile">Share profile</button>`;
  } else {
    actionBtns = friendButtonHTML(uid);
    if (rel === 'friends') {
      actionBtns += `
        <button class="btn btn-primary btn-sm" data-action="message" data-id="${uid}">💬 Message</button>
        <button class="star-btn" data-action="toggle-close" data-id="${uid}" title="Close friend">${isClose ? '⭐' : '☆'}</button>`;
    }
  }

  view.innerHTML = `
    <div class="profile-card">
      <div style="display:flex;justify-content:${isMe ? 'flex-end' : 'flex-start'}">
        ${isMe
          ? `<button class="icon-btn" data-action="nav" data-target="#/settings" title="Settings" style="color:#fff">⚙</button>`
          : `<button class="icon-btn" data-action="back" style="color:#fff">←</button>`}
      </div>
      <div class="ig-profile">
        ${isMe
          ? `<div class="profile-avatar-wrap" data-action="change-avatar" title="Change profile photo">${avatarHTML(u, 'profile-avatar')}</div>`
          : avatarHTML(u, 'profile-avatar')}
        <div class="ig-stats">
          <span id="postCount"><b>0</b>posts</span>
          <span><b>${counts.friends}</b>friends</span>
          <span><b>${isMe ? incomingReqs.length : ''}</b>${isMe ? 'requests' : ''}</span>
        </div>
      </div>
      <div class="ig-name">${esc(u.name)}</div>
      ${u.bio ? `<div class="ig-bio">${esc(u.bio)}</div>` : ''}
      ${u.location ? `<div class="ig-bio" style="color:var(--muted)">${esc(u.location)}</div>` : ''}
      <div class="stories" id="highlights"></div>
      <div class="profile-btns">${actionBtns}</div>
      <div class="profile-tabs">
        <button class="profile-tab ${tab === 'posts' ? 'active' : ''}" data-action="profile-tab" data-id="${uid}" data-tab="posts" title="Posts">▦</button>
        <button class="profile-tab ${tab === 'reels' ? 'active' : ''}" data-action="profile-tab" data-id="${uid}" data-tab="reels" title="Reels">▶</button>
        ${isMe ? `<button class="profile-tab ${tab === 'saved' ? 'active' : ''}" data-action="profile-tab" data-id="${uid}" data-tab="saved" title="Saved">♡</button>` : ''}
        ${isMe ? `<button class="profile-tab ${tab === 'likes' ? 'active' : ''}" data-action="profile-tab" data-id="${uid}" data-tab="likes" title="Likes">♥</button>` : ''}
      </div>
    </div>
    <div id="profilePosts">${emptyState('⏳', 'Loading...')}</div>`;

  if (tab === 'saved') loadSavedPosts();
  else if (tab === 'likes') loadLikedPosts(uid);
  else loadProfilePosts(uid, tab === 'reels');
  paintHighlights(u.highlights || []);
}

async function paintHighlights(list) {
  const el = $('#highlights');
  if (!el) return;
  if (!list.length) { el.innerHTML = ''; return; }
  const bits = [];
  for (const h of list.slice(0, 10)) {
    try {
      const snap = await getDoc(doc(db, 'posts', h.postId));
      const image = snap.data()?.imageURL;
      if (!image) continue;
      bits.push(`<button class="story" data-action="nav" data-target="#/post/${esc(h.postId)}"><span class="story-ring"><span class="avatar"><img src="${esc(image)}" alt=""></span></span><span class="story-name">${esc(h.title || 'Highlight')}</span></button>`);
    } catch (e) { /* skip a missing highlight */ }
  }
  if (el.isConnected) el.innerHTML = bits.join('');
}

async function addHighlight(postId) {
  const title = (prompt('Highlight name', 'Favorites') || '').trim().slice(0, 20);
  if (!title) return;
  const highlights = [...(myDoc?.highlights || [])];
  if (highlights.some(h => h.postId === postId)) return toast('Already in highlights');
  highlights.push({ postId, title });
  try {
    await updateDoc(doc(db, 'users', me.uid), { highlights });
    myDoc.highlights = highlights;
    closeSheet();
    toast('Added to highlights');
    if (currentPage === 'profile') route();
  } catch (err) { handleDbError(err); }
}

async function setArchived(postId, archived) {
  try {
    await updateDoc(doc(db, 'posts', postId), { archived });
    closeSheet();
    toast(archived ? 'Archived' : 'Back on your profile');
    route();
  } catch (err) { handleDbError(err); }
}

function renderArchive() {
  view.innerHTML = `<h2 class="page-title">Archive</h2><div id="profilePosts">${emptyState('⏳', 'Loading...')}</div>`;
  const postsMap = new Map();
  const draw = () => {
    const posts = [...postsMap.values()].filter(p => p.authorId === me.uid && p.archived);
    const pp = $('#profilePosts');
    if (!pp) return;
    pp.innerHTML = posts.length
      ? `<div class="ig-grid">${posts.map(igTile).join('')}</div>`
      : emptyState('🗄', 'Nothing archived.');
  };
  const q1 = query(collection(db, 'posts'), where('authorId', '==', me.uid), where('privacy', '==', 'public'), orderBy('createdAt', 'desc'), limit(40));
  const q2 = query(collection(db, 'posts'), where('authorId', '==', me.uid), where('audience', 'array-contains', me.uid), orderBy('createdAt', 'desc'), limit(40));
  [q1, q2].forEach(q => viewUnsubs.push(onSnapshot(q, (snap) => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') postsMap.delete(ch.doc.id);
      else postsMap.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
    });
    draw();
  }, handleDbError)));
}

function loadProfilePosts(uid, reelsOnly) {
  const postsMap = new Map();
  const draw = async () => {
    let posts = [...postsMap.values()]
      .filter(visibleToMe)
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    const allCount = posts.length;
    if (reelsOnly) posts = posts.filter(isReelPost);
    const countEl = $('#postCount');
    if (countEl) countEl.innerHTML = `<b>${reelsOnly ? allCount : posts.length}</b>posts`;
    const pp = $('#profilePosts');
    if (!pp) return;
    if (!posts.length) {
      pp.innerHTML = emptyState(reelsOnly ? '▶' : '📷', reelsOnly ? 'No reels yet.' : 'No posts yet.');
      return;
    }
    const pp2 = $('#profilePosts');
    if (!pp2) return;
    pp2.innerHTML = `<div class="ig-grid">${posts.map(p => igTile(p, reelsOnly)).join('')}</div>`;
  };

  const q1 = query(collection(db, 'posts'),
    where('authorId', '==', uid), where('privacy', '==', 'public'),
    orderBy('createdAt', 'desc'), limit(60));
  const q2 = query(collection(db, 'posts'),
    where('authorId', '==', uid), where('audience', 'array-contains', me.uid),
    orderBy('createdAt', 'desc'), limit(60));

  [q1, q2].forEach(q => viewUnsubs.push(onSnapshot(q, (snap) => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') postsMap.delete(ch.doc.id);
      else postsMap.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
    });
    draw();
  }, handleDbError)));
}

async function loadSavedPosts() {
  const ids = myDoc?.savedPostIds || [];
  const pp = $('#profilePosts');
  if (!ids.length) { pp.innerHTML = emptyState('♡', 'No saved posts yet.'); return; }
  try {
    const posts = [];
    for (const id of ids.slice(0, 60)) {
      const snap = await getDoc(doc(db, 'posts', id));
      if (snap.exists()) {
        const p = { id: snap.id, ...snap.data() };
        if (visibleToMe(p)) posts.push(p);
      }
    }
    if (!pp.isConnected) return;
    pp.innerHTML = posts.length
      ? `<div class="ig-grid">${posts.map(igTile).join('')}</div>`
      : emptyState('♡', 'No saved posts yet.');
  } catch (err) { handleDbError(err); }
}

async function loadLikedPosts(uid) {
  try {
    const snap = await getDocs(query(collectionGroup(db, 'likes'), where('uid', '==', uid), limit(60)));
    const posts = [];
    for (const likeDoc of snap.docs) {
      const postSnap = await getDoc(likeDoc.ref.parent.parent);
      if (postSnap.exists()) {
        const p = { id: postSnap.id, ...postSnap.data() };
        if (visibleToMe(p)) posts.push(p);
      }
    }
    posts.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (!posts.length) {
      $('#profilePosts').innerHTML = emptyState('❤️', 'No liked posts yet.');
      return;
    }
    await markLiked(posts);
    await hydrateAuthors(posts.map(p => p.authorId));
    $('#profilePosts').innerHTML = `<div class="ig-grid">${posts.map(igTile).join('')}</div>`;
  } catch (err) { handleDbError(err); }
}

// ---------------- edit profile ----------------
let editAvatarFile = null;

function openEdit() {
  $('#editName').value = myDoc?.name || '';
  $('#editBio').value = myDoc?.bio || '';
  $('#editLocation').value = myDoc?.location || '';
  editAvatarFile = null;
  $('#editAvatarInput').value = '';
  $('#editAvatarPreview').outerHTML = avatarHTML(myDoc, 'avatar-lg').replace('class="avatar avatar-lg"', 'id="editAvatarPreview" class="avatar avatar-lg"');
  $('#editModal').classList.remove('hidden');
}

$('#editAvatarInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  editAvatarFile = f;
  $('#editAvatarPreview').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
});

// one-tap profile photo change (tap the avatar on your own profile)
$('#avatarQuickInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !me) return;
  try {
    toast('Uploading photo...');
    const photoURL = await imageToDataURL(f, 120000, 512);
    await updateDoc(doc(db, 'users', me.uid), { photoURL });
    userCache.delete(me.uid);
    toast('Profile photo updated ✅');
    route();
  } catch (err) { handleDbError(err); }
});

async function saveProfile() {
  const name = $('#editName').value.trim();
  if (!name) return toast('Name cannot be empty.');
  try {
    let photoURL = myDoc?.photoURL || '';
    if (editAvatarFile) {
      photoURL = await imageToDataURL(editAvatarFile, 120000, 512);
    }
    await updateDoc(doc(db, 'users', me.uid), {
      name,
      nameLower: name.toLowerCase(),
      bio: $('#editBio').value.trim(),
      location: $('#editLocation').value.trim(),
      photoURL
    });
    userCache.delete(me.uid);
    $('#editModal').classList.add('hidden');
    toast('Profile updated ✅');
    route();
  } catch (err) { handleDbError(err); }
}

function renderSettings() {
  view.innerHTML = `
    <h2 class="page-title">Settings</h2>
    <div class="settings-list">
      <button class="sheet-row" data-action="open-edit">Edit profile</button>
      <button class="sheet-row" data-action="nav" data-target="#/profile/${me.uid}/saved">Saved</button>
      <button class="sheet-row" data-action="nav" data-target="#/archive">Archive</button>
      <button class="sheet-row" data-action="nav" data-target="#/friends">Friends and close friends</button>
      <button class="sheet-row" data-action="nav" data-target="#/chats">Messages</button>
      <button class="sheet-row" data-action="logout">Log out</button>
    </div>`;
}

// ============================================================
//  CHATS (friends only — also enforced by Firestore rules)
// ============================================================
let replyDraft = null;
const msgTapAt = new Map();
let otherLastReadMs = 0;

async function renderChats() {
  view.innerHTML = `
    <div class="inbox-head"><h2>Messages</h2><button class="inbox-new" data-action="new-chat" title="New message">✎</button></div>
    <input id="chatSearch" class="inbox-search" placeholder="Search" autocomplete="off">
    <div id="noteStrip" class="note-strip"></div>
    <a class="inbox-requests" href="#/friends">Requests <span>${incomingReqs.length ? incomingReqs.length : ''}</span></a>
    <div id="chatList">${emptyState('⏳', 'Loading...')}</div>
    <div id="friendStart"></div>`;
  const search = $('#chatSearch');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('#chatList .chat-row, #friendStart .user-row').forEach(row => {
      row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  const note = document.createElement('label');
  note.className = 'note-item';
  note.innerHTML = `${avatarHTML(myDoc || { name: '?' })}<input id="myNote" maxlength="60" placeholder="Your note" value="${esc(myDoc?.note || '')}">`;
  $('#noteStrip').appendChild(note);
  $('#myNote').addEventListener('change', async (e) => {
    const text = e.target.value.trim().slice(0, 60);
    try {
      await updateDoc(doc(db, 'users', me.uid), { note: text });
      myDoc.note = text;
    } catch (err) { handleDbError(err); }
  });
  renderFriendStarters();

  const q = query(collection(db, 'chats'),
    where('members', 'array-contains', me.uid), orderBy('lastAt', 'desc'), limit(50));

  viewUnsubs.push(onSnapshot(q, async (snap) => {
    const cl = $('#chatList');
    if (!cl) return;
    if (snap.empty) {
      cl.innerHTML = emptyState('💬', 'No conversations yet.<br>Pick a friend below to start chatting.');
      return;
    }
    const rows = await Promise.all(snap.docs.map(async d => {
      const c = d.data();
      const otherUid = c.members.find(m => m !== me.uid);
      const u = await getUser(otherUid);
      const un = isUnreadChat(c);
      const p = presenceOf(u);
      let preview = c.lastMessage || 'Say hi';
      if (c.lastSender === me.uid && preview !== 'Liked a message') preview = 'You: ' + preview;
      return `<div class="chat-row ${un ? 'unread' : ''}" data-action="message" data-id="${otherUid}">
        <span style="position:relative;display:inline-block">${avatarHTML(u)}${p.online ? '<span class="online-dot"></span>' : ''}</span>
        <div class="chat-row-info">
          <div class="chat-row-name">${esc(u.name)}</div>
          <div class="chat-row-last">${esc(preview)}</div>
        </div>
        <span class="chat-row-time">${timeAgo(c.lastAt)}</span>
        ${un ? '<span class="unread-dot"></span>' : ''}
      </div>`;
    }));
    const cl2 = $('#chatList');
    if (!cl2) return;
    cl2.innerHTML = rows.join('');
  }, handleDbError));
}

async function renderFriendStarters() {
  const el = $('#friendStart');
  if (!el) return;
  if (!friendIds.size) { el.innerHTML = ''; return; }
  const users = await Promise.all([...friendIds].map(async uid => ({ uid, ...(await getUser(uid)) })));
  if (!el.isConnected) return;
  const strip = $('#noteStrip');
  users.filter(u => u.note).forEach(u => {
    if (strip && !strip.querySelector(`[data-note="${u.uid}"]`)) {
      const b = document.createElement('button');
      b.className = 'note-item';
      b.dataset.note = u.uid;
      b.dataset.action = 'message';
      b.dataset.id = u.uid;
      b.innerHTML = `${avatarHTML(u)}<span class="story-name">${esc(u.note)}</span>`;
      strip.appendChild(b);
    }
  });
  el.innerHTML = `<h3 style="font-size:15px;font-weight:800;margin:16px 4px 10px">Send message</h3>` + users.map(u => {
    const p = presenceOf(u);
    return `<div class="user-row">
      <span style="position:relative;display:inline-block">${avatarHTML(u)}${p.online ? '<span class="online-dot"></span>' : ''}</span>
      <div class="user-row-info">
        <a class="user-row-name" href="#/profile/${u.uid}">${esc(u.name)}</a>
        <span class="presence ${p.online ? '' : 'off'}">${p.online ? '🟢 Online' : esc(p.label)}</span>
      </div>
      <div class="user-row-btns"><button class="btn btn-primary btn-sm" data-action="message" data-id="${u.uid}">💬 Message</button></div>
    </div>`;
  }).join('');
}

function chatIdFor(a, b) { return [a, b].sort().join('_'); }

// girly-mode self-destruct timers (messageId -> timeout)
const girlyTimers = new Map();
let currentChatMode = 'normal';
let currentChatOther = null;

async function renderChat(otherUid) {
  if (!otherUid) { location.hash = '#/chats'; return; }
  const u = await getUser(otherUid);

  if (!friendIds.has(otherUid)) {
    view.innerHTML = `
      <div class="chat-header">
        <button class="chat-back" data-action="back">←</button>
        ${avatarHTML(u)}
        <span class="chat-header-name">${esc(u.name)}</span>
      </div>
      ${emptyState('🔒', 'You can only message accepted friends.<br>Send a friend request first.')}
      <div style="text-align:center">${friendButtonHTML(otherUid)}</div>`;
    return;
  }

  currentChatMode = 'normal';
  currentChatOther = otherUid;
  const chatId = chatIdFor(me.uid, otherUid);

  view.innerHTML = `
    <div class="chat-header">
      <button class="chat-back" data-action="back">←</button>
      ${avatarHTML(u)}
      <a class="chat-header-name" style="color:#fff;text-decoration:none" href="#/profile/${otherUid}">${esc(u.name)}</a>
      <div class="mode-chips">
        <button class="mode-chip active" data-action="set-chat-mode" data-mode="normal" data-id="${chatId}" title="Gentleman mode — normal chat">🎩</button>
        <button class="mode-chip" data-action="set-chat-mode" data-mode="girly" data-id="${chatId}" title="Girly mode — messages disappear in 3 sec">🌸</button>
      </div>
    </div>
    <div id="girlyBanner" class="girly-banner hidden">🌸 <b>Girly mode</b> — messages & photos disappear <b>3 sec</b> after viewing · download/copy disabled</div>
    <div class="messages" id="messages"></div>
    <div class="chat-dock">
      <div id="replyBar" class="reply-bar hidden"></div>
      <div class="emoji-quick">
        ${['❤️','😂','🔥','👍','😢','😍','🙏','🎉'].map(em => `<button type="button" data-action="insert-emoji" data-id="${em}">${em}</button>`).join('')}
      </div>
      <div class="chat-input-bar">
        <button class="chat-photo-btn" data-action="chat-photo" data-id="${otherUid}" title="Send photo">📷</button>
        <input id="chatInput" placeholder="Message..." autocomplete="off" maxlength="1000">
        <button id="chatSend" data-action="send-heart" data-id="${otherUid}" title="Like">❤️</button>
      </div>
    </div>`;

  try {
    const chatRef = doc(db, 'chats', chatId);
    // NOTE: do NOT getDoc() the chat first — reading a chat that does not
    // exist yet is denied by the security rules (they check resource.data),
    // which would block creation. A merge-write is idempotent instead:
    // it creates the chat when missing and is a harmless no-op when present.
    await setDoc(chatRef, { members: [me.uid, otherUid].sort() }, { merge: true });

    // mark incoming messages as read (badge clears)
    const markRead = () => updateDoc(chatRef, { [`lastRead.${me.uid}`]: serverTimestamp() }).catch(() => {});
    markRead();

    // live chat-mode (🎩/🌸) — synced between both friends
    viewUnsubs.push(onSnapshot(chatRef, (s) => {
      const data = s.data() || {};
      const mode = data.mode === 'girly' ? 'girly' : 'normal';
      currentChatMode = mode;
      const read = data.lastRead?.[otherUid];
      otherLastReadMs = read?.toMillis ? read.toMillis() : 0;
      document.querySelectorAll('.mode-chip').forEach(c =>
        c.classList.toggle('active', c.dataset.mode === mode));
      $('#girlyBanner')?.classList.toggle('hidden', mode !== 'girly');
    }, () => {}));

    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'), limit(300));
    viewUnsubs.push(onSnapshot(q, (snap) => {
      const box = $('#messages');
      if (!box) return;
      const lastMine = [...snap.docs].reverse().find(d => d.data().senderId === me.uid);
      box.innerHTML = snap.docs.map(d => {
        const m = d.data();
        const mine = m.senderId === me.uid;
        const girly = m.mode === 'girly';
        const girlyAttr = girly ? `data-girly-id="${d.id}"` : '';
        const emojiN = m.imageURL ? 0 : emojiOnlyCount(m.text);
        const age = m.createdAt?.toDate ? Math.max(0, Date.now() - m.createdAt.toDate().getTime()) : 0;
        const body = m.imageURL
          ? `<img class="msg-img" src="${m.imageURL}" draggable="false" alt="photo">`
          : emojiN
            ? `<span class="emoji-jumbo" data-action="replay-emoji">${esc(m.text.trim())}</span>`
            : esc(m.text || '');
        const shared = m.postId ? `<a class="msg-shared" href="#/post/${esc(m.postId)}">View post</a>` : '';
        const reply = m.replyText ? `<div class="msg-reply">${esc(m.replyName || '')}<div>${esc(m.replyText)}</div></div>` : '';
        const hearts = m.hearts || {};
        const liked = !!hearts[me.uid];
        const heartN = Object.keys(hearts).length;
        const sent = m.createdAt?.toMillis ? m.createdAt.toMillis() : 0;
        const seen = mine && lastMine && d.id === lastMine.id && otherLastReadMs && sent && otherLastReadMs >= sent
          ? `<span class="msg-seen">Seen</span>` : '';
        return `<div class="msg ${mine ? 'mine' : 'theirs'} ${girly ? 'girly' : ''} ${emojiN ? `emoji-only e${emojiN}` : ''}" data-mid="${d.id}" data-age="${age}" data-action="tap-msg" data-id="${d.id}" data-chat="${chatId}" ${girlyAttr}>${reply}${body}${shared}<span class="msg-time">${timeAgo(m.createdAt)}${girly ? ' 🔥' : ''}${heartN ? ` · ${liked ? '❤️' : '♡'}${heartN}` : ''}</span>
          <div class="msg-tools"><button type="button" data-action="reply-msg" data-id="${d.id}" data-who="${mine ? 'You' : esc(u.name)}" data-preview="${esc((m.imageURL ? 'Photo' : (m.text || '')).replace(/\s+/g, ' ').slice(0, 80))}">Reply</button>${mine ? `<button type="button" data-action="unsend" data-id="${d.id}" data-chat="${chatId}">Unsend</button>` : ''}</div>${seen}</div>`;
      }).join('');
      box.querySelectorAll('.msg.emoji-only').forEach(el => {
        const id = el.dataset.mid;
        const age = Number(el.dataset.age || 0);
        if (emojiPlayed.has(id)) return;
        emojiPlayed.add(id);
        if (age < 8000) playEmojiBurst(el);
      });
      window.scrollTo(0, document.body.scrollHeight);
      markRead();

      // 🌸 girly messages disappear 3 sec after they show on screen
      box.querySelectorAll('[data-girly-id]').forEach(el => {
        const mid = el.dataset.girlyId;
        if (girlyTimers.has(mid)) return;
        girlyTimers.set(mid, setTimeout(() => {
          girlyTimers.delete(mid);
          deleteDoc(doc(db, 'chats', chatId, 'messages', mid)).catch((err) => {
            console.error(err);
            toast('Girly message could not be removed.');
          });
        }, 3000));
      });
    }, handleDbError));

    const input = $('#chatInput');
    const syncSend = () => {
      const btn = $('#chatSend');
      if (!btn) return;
      const has = input.value.trim();
      btn.dataset.action = has ? 'send-chat' : 'send-heart';
      btn.textContent = has ? 'Send' : '❤️';
    };
    input.addEventListener('input', syncSend);
    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(otherUid); });
  } catch (err) { handleDbError(err); }
}

function showReplyBar() {
  const bar = $('#replyBar');
  if (!bar) return;
  if (!replyDraft) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `<span>Replying to <b>${esc(replyDraft.name)}</b>: ${esc(replyDraft.text)}</span><button type="button" data-action="cancel-reply">✕</button>`;
}

async function sendChat(otherUid, preset) {
  const input = $('#chatInput');
  const text = (preset || input?.value || '').trim();
  if (!text) return;
  if (!preset && input) input.value = '';
  const chatId = chatIdFor(me.uid, otherUid);
  const reply = replyDraft;
  replyDraft = null;
  showReplyBar();
  $('#chatSend') && ($('#chatSend').dataset.action = 'send-heart', $('#chatSend').textContent = '❤️');
  try {
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId: me.uid,
      text,
      mode: currentChatMode,
      createdAt: serverTimestamp(),
      ...(reply ? { replyText: reply.text, replyName: reply.name } : {})
    });
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: currentChatMode === 'girly' ? '🌸 message' : text,
      lastAt: serverTimestamp(), lastSender: me.uid
    });
  } catch (err) {
    handleDbError(err);
    toast('Message not sent — are you still friends?');
  }
}

async function heartMessage(chatId, mid) {
  const ref = doc(db, 'chats', chatId, 'messages', mid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const hearts = { ...(snap.data().hearts || {}) };
  if (hearts[me.uid]) delete hearts[me.uid];
  else hearts[me.uid] = true;
  await updateDoc(ref, { hearts });
  if (hearts[me.uid]) {
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: 'Liked a message', lastAt: serverTimestamp(), lastSender: me.uid
    });
  }
}

async function sendChatPhoto(otherUid, file) {
  const chatId = chatIdFor(me.uid, otherUid);
  try {
    toast('Sending photo...');
    const imageURL = await imageToDataURL(file, 600000, 1024);
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId: me.uid, text: '', imageURL, mode: currentChatMode, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: currentChatMode === 'girly' ? '🌸 photo' : '📷 photo',
      lastAt: serverTimestamp(), lastSender: me.uid
    });
  } catch (err) {
    handleDbError(err);
    toast('Photo not sent.');
  }
}

// ============================================================
//  GLOBAL EVENT DELEGATION
// ============================================================
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const id = el.dataset.id;

  switch (a) {
    case 'nav':             location.hash = el.dataset.target; break;
    case 'back':            history.back(); break;
    case 'open-compose':    openCompose('post'); break;
    case 'open-create':     openCreateMenu(); break;
    case 'start-compose':   openCompose(el.dataset.kind || 'post'); break;
    case 'close-sheet':     closeSheet(); break;
    case 'open-comments':   openComments(id); break;
    case 'open-likes':      openLikes(id); break;
    case 'open-more':       openMore(id); break;
    case 'copy-link':       copyPostLink(id); break;
    case 'send-share':      sendShare(id, el.dataset.post); break;
    case 'send-sheet-comment': sendComment(id, $('#sheetCommentInput')); break;
    case 'story-next':      showStory(storyUid, storyIndex + 1); break;
    case 'story-prev':      showStory(storyUid, storyIndex - 1); break;
    case 'story-send':      sendStoryReply(id); break;
    case 'story-react':     sendStoryReply(id, el.dataset.emoji); break;
    case 'notif-filter':    notifFilter = el.dataset.tab || 'all'; paintNotifs(); break;
    case 'home-feed':
      homeFeedMode = el.dataset.tab || 'foryou';
      if (currentPage === 'home') route();
      break;
    case 'share-profile':   copyText(`${location.origin}${location.pathname}#/profile/${me.uid}`, 'Profile link copied'); break;
    case 'add-highlight':   addHighlight(id); break;
    case 'archive-post':    setArchived(id, true); break;
    case 'unarchive-post':  setArchived(id, false); break;
    case 'reply-comment':
      commentReply = { postId: id, name: el.dataset.name || '', text: el.dataset.preview || '' };
      if ($('#sheetCommentInput')) {
        $('#sheetCommentInput').placeholder = `Reply to ${commentReply.name}...`;
        $('#sheetCommentInput').focus();
      }
      break;
    case 'like-comment':    toggleCommentLike(id, el.dataset.cid, el); break;
    case 'close-compose':   closeCompose(); break;
    case 'set-privacy':     setPrivacyChips(el.dataset.privacy); break;
    case 'remove-compose-image':
      composeImageFile = null; $('#composeImage').value = '';
      $('#composePreview').classList.add('hidden'); break;
    case 'submit-post':     submitPost(); break;
    case 'like':            toggleLike(id); break;
    case 'save':            toggleSave(id); break;
    case 'tap-photo': {
      const now = Date.now();
      const prev = photoTapAt.get(id) || 0;
      photoTapAt.set(id, now);
      if (now - prev < 320) {
        const photo = el.classList.contains('post-photo') ? el : el.closest('.post-photo');
        if (photo && !photo.querySelector('.like-pop')) {
          const pop = document.createElement('div');
          pop.className = 'like-pop';
          pop.innerHTML = IG_HEART.replace('fill="none"', 'fill="#fff"').replace('stroke="currentColor"', 'stroke="#fff"');
          photo.appendChild(pop);
          setTimeout(() => pop.remove(), 700);
        }
        const btn = document.querySelector(`[data-action="like"][data-id="${id}"]`);
        if (btn && !btn.classList.contains('liked')) toggleLike(id);
      }
      break;
    }
    case 'reel-next':       scrollReel(1); break;
    case 'reel-prev':       scrollReel(-1); break;
    case 'reel-comments':   openComments(id); break;
    case 'reel-mute':
      reelMuted = !reelMuted;
      paintReelMute();
      reelSoundKey = '';
      if (reelMuted) { stopReelSound(); break; }
      if (!reelCtx) reelCtx = new AudioContext();
      reelCtx.resume();
      syncReelAudio();
      break;
    case 'pick-song':
      composeSongId = el.dataset.song || 'none';
      composeSongURL = '';
      composeSongName = '';
      $('#composeSongName').textContent = '';
      $('#composeSong').value = '';
      document.querySelectorAll('#songChips .chip').forEach(c => c.classList.toggle('active', c === el));
      break;
    case 'open-story':      openStory(id); break;
    case 'close-story':     closeStory(); break;
    case 'open-notifs':     openNotifs(); break;
    case 'close-notifs':    closeNotifs(); break;
    case 'toggle-comments': openComments(id); break;
    case 'send-comment':    sendComment(id, el.parentElement.querySelector('.comment-input')); break;
    case 'share':           sharePost(id); break;
    case 'delete-post':     deletePost(id); break;
    case 'add-friend':      sendRequest(id).then(() => route()); break;
    case 'accept-request':  acceptRequest(el.dataset.rid || `${id}_${me.uid}`, id).then(() => route()); break;
    case 'reject-request':  rejectRequest(el.dataset.rid).then(() => route()); break;
    case 'cancel-request':  cancelRequest(id).then(() => route()); break;
    case 'unfriend':        unfriend(id).then(() => route()); break;
    case 'toggle-close':    toggleCloseFriend(id).then(() => route()); break;
    case 'message':         location.hash = '#/chat/' + id; break;
    case 'send-chat':       sendChat(id); break;
    case 'send-heart':      sendChat(id, '❤️'); break;
    case 'insert-emoji': {
      const input = $('#chatInput');
      if (input) { input.value += id; input.dispatchEvent(new Event('input')); input.focus(); }
      break;
    }
    case 'reply-msg':
      replyDraft = { text: el.dataset.preview || 'Message', name: el.dataset.who || 'message' };
      showReplyBar();
      $('#chatInput')?.focus();
      break;
    case 'cancel-reply':    replyDraft = null; showReplyBar(); break;
    case 'tap-msg': {
      const now = Date.now();
      const prev = msgTapAt.get(id) || 0;
      msgTapAt.set(id, now);
      if (now - prev < 320) heartMessage(el.dataset.chat, id).catch(handleDbError);
      break;
    }
    case 'unsend':
      deleteDoc(doc(db, 'chats', el.dataset.chat, 'messages', id))
        .then(() => updateDoc(doc(db, 'chats', el.dataset.chat), {
          lastMessage: 'You unsent a message', lastAt: serverTimestamp(), lastSender: me.uid
        }))
        .catch(handleDbError);
      break;
    case 'new-chat':        $('#friendStart')?.scrollIntoView({ behavior: 'smooth' }); break;
    case 'replay-emoji':    playEmojiBurst(el.closest('.msg')); break;
    case 'set-chat-mode':   setChatMode(id, el.dataset.mode); break;
    case 'chat-photo':      currentChatOther = id; $('#chatImageInput').click(); break;
    case 'friends-tab':
      currentFriendsTab = el.dataset.tab;
      friendsTabChosen = true;
      renderFriends(el.dataset.tab); break;
    case 'profile-tab':     renderProfile(id, el.dataset.tab); break;
    case 'open-edit':       openEdit(); break;
    case 'change-avatar':   $('#avatarQuickInput').click(); break;
    case 'close-edit':      $('#editModal').classList.add('hidden'); break;
    case 'save-profile':    saveProfile(); break;
    case 'logout':          signOut(auth); break;
  }
});

// close modals when tapping the dark background
document.querySelectorAll('.modal-overlay').forEach(m =>
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));

// girly mode: chat mode switch
async function setChatMode(chatId, mode) {
  try {
    await updateDoc(doc(db, 'chats', chatId), { mode });
    toast(mode === 'girly' ? '🌸 Girly mode ON — messages disappear in 3 sec' : '🎩 Gentleman mode — normal chat');
  } catch (err) { handleDbError(err); }
}

// girly mode: photo picker for chat
$('#chatImageInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f && currentChatOther) sendChatPhoto(currentChatOther, f);
});

// girly mode: block right-click / long-press save inside girly messages
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.msg.girly')) e.preventDefault();
});
