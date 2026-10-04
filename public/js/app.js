// ============================================================
//  Saathi — main application logic
//  Features: auth, profiles, friend requests, private chat
//  (friends only), posts with privacy, likes, comments.
// ============================================================
import { auth, db } from './firebase-config.js';

// PWA: installable + offline shell. Network-first strategy in sw.js means
// every website update reaches users automatically — no reinstall needed.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
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

function renderLeftbar() {
  const el = $('#leftbar');
  if (!el || !me || !myDoc) return;
  el.innerHTML = `
    <div class="side-card" style="text-align:center">
      <a href="#/profile" title="My profile">${avatarHTML(myDoc, 'profile-avatar')}</a>
      <div style="font-weight:800;font-size:18px;margin-top:10px">${esc(myDoc.name || '')}</div>
      ${myDoc.bio ? `<div class="user-row-sub" style="margin-top:4px">🎓 ${esc(myDoc.bio)}</div>` : ''}
      ${myDoc.location ? `<div class="user-row-sub">📍 ${esc(myDoc.location)}</div>` : ''}
      <div style="margin-top:10px;font-size:14px"><b>${friendIds.size}</b> Friends · <b>${incomingReqs.length}</b> Requests</div>
    </div>
    <div class="side-card side-menu" style="padding:8px">
      <button data-action="nav" data-target="#/home">🏠 <span>Home</span></button>
      <button data-action="nav" data-target="#/search">🔍 <span>Search</span></button>
      <button data-action="nav" data-target="#/friends">👥 <span>Friends</span>${incomingReqs.length ? `<span class="badge" style="position:static;margin-left:auto">${incomingReqs.length}</span>` : ''}</button>
      <button data-action="nav" data-target="#/chats">💬 <span>Chats</span>${unreadTotal ? `<span class="badge" style="position:static;margin-left:auto">${unreadTotal}</span>` : ''}</button>
      <button data-action="nav" data-target="#/profile">👤 <span>My Profile</span></button>
      <button data-action="logout">🚪 <span>Logout</span></button>
    </div>
    <div class="side-card" style="padding:10px">
      <div style="font-weight:800;padding:4px 6px 8px">🌍 Public News</div>
      <div id="newsList"><div class="user-row-sub">Loading...</div></div>
    </div>`;
  markSideMenuActive();
  renderNews();
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
  const page = (location.hash || '#/home').slice(2).split('/')[0] || 'home';
  document.querySelectorAll('.side-menu button[data-target]').forEach(b =>
    b.classList.toggle('active', b.dataset.target === '#/' + page));
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

  document.querySelectorAll('.nav-item[data-target]').forEach(b => {
    const t = b.dataset.target;
    b.classList.toggle('active',
      t === '#/' + page || (t === '#/profile' && page === 'profile' && (!parts[1] || parts[1] === me.uid)));
  });
  markSideMenuActive();

  switch (page) {
    case 'home':    renderHome(); break;
    case 'search':  renderSearch(); break;
    case 'friends':
      currentFriendsTab = parts[1] || (incomingReqs.length ? 'requests' : 'friends');
      friendsTabChosen = false;
      renderFriends(currentFriendsTab); break;
    case 'chats':   renderChats(); break;
    case 'chat':    renderChat(parts[1]); break;
    case 'profile': renderProfile(parts[1] || me.uid, parts[2] || 'activity'); break;
    default:        renderHome();
  }
  window.scrollTo(0, 0);
}

// ============================================================
//  POSTS — shared rendering
// ============================================================
function visibleToMe(p) {
  if (p.authorId === me.uid) return true;
  if (p.privacy === 'public') return true;
  return (p.audience || []).includes(me.uid);
}

function postCard(p) {
  const privacy = PRIVACY[p.privacy] || PRIVACY.public;
  const liked = p._liked ? 'liked' : '';
  return `
  <div class="post" data-post="${p.id}">
    <div class="post-head">
      ${avatarHTML({ name: p.authorName, photoURL: p.authorPhoto })}
      <div class="post-head-info">
        <a class="post-author" href="#/profile/${p.authorId}">${esc(p.authorName)}</a>
        <span class="post-meta">${timeAgo(p.createdAt)} · ${privacy.icon} ${privacy.label}</span>
      </div>
      ${p.authorId === me.uid ? `<button class="icon-btn post-menu" data-action="delete-post" data-id="${p.id}" title="Delete">⋮</button>` : ''}
    </div>
    ${p.text ? `<div class="post-text">${esc(p.text)}</div>` : ''}
    ${p.imageURL ? `<img class="post-image" src="${esc(p.imageURL)}" loading="lazy" alt="post image">` : ''}
    <div class="post-actions">
      <button class="post-action ${liked}" data-action="like" data-id="${p.id}">👍 <span>${p.likeCount || 0}</span></button>
      <button class="post-action" data-action="toggle-comments" data-id="${p.id}">💬 <span>${p.commentCount || 0}</span></button>
      <button class="post-action" data-action="share" data-id="${p.id}">↗ Share</button>
    </div>
    <div class="comments-area hidden" id="comments-${p.id}">
      <div class="comments-list"></div>
      <div class="comment-box">
        ${avatarHTML(myDoc || { name: '?' })}
        <input class="comment-input" placeholder="Write a comment..." maxlength="500">
        <button class="comment-send" data-action="send-comment" data-id="${p.id}">Post</button>
      </div>
    </div>
  </div>`;
}

async function markLiked(posts) {
  await Promise.all(posts.map(async p => {
    try { p._liked = (await getDoc(doc(db, 'posts', p.id, 'likes', me.uid))).exists(); }
    catch (e) { p._liked = false; }
  }));
}

function emptyState(icon, text) {
  return `<div class="empty-state"><span class="big">${icon}</span>${esc(text)}</div>`;
}

// ---------------- home feed ----------------
function renderHome() {
  view.innerHTML = `
    <div class="composer-box" data-action="open-compose">
      ${avatarHTML(myDoc || { name: '?' })}
      <span class="composer-placeholder">What's on your mind?</span>
    </div>
    <div id="feed">${emptyState('⏳', 'Loading posts...')}</div>`;

  const postsMap = new Map();
  const draw = async () => {
    const posts = [...postsMap.values()]
      .filter(visibleToMe)
      .sort((a, b) => (b.createdAt?.toMillis?.() || Date.now()) - (a.createdAt?.toMillis?.() || Date.now()));
    const feedEl = $('#feed');
    if (!feedEl) return;
    if (!posts.length) {
      feedEl.innerHTML = emptyState('📭', 'No posts yet. Add friends or write the first post!');
      return;
    }
    await markLiked(posts);
    const el = $('#feed');
    if (!el) return;
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

// ---------------- compose ----------------
let composePrivacy = 'public';
let composeImageFile = null;

function openCompose() {
  $('#composeUser').innerHTML = `${avatarHTML(myDoc || { name: '?' })}<span>${esc(myDoc?.name || '')}</span>`;
  $('#composeText').value = '';
  composeImageFile = null;
  $('#composeImage').value = '';
  $('#composePreview').classList.add('hidden');
  setPrivacyChips('public');
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
  if (!text && !composeImageFile) return toast('Write something or add a photo.');

  // audience = people allowed to see this post (besides public posts)
  let audience = [me.uid];
  if (composePrivacy === 'friends') audience = [me.uid, ...friendIds];
  else if (composePrivacy === 'close') audience = [me.uid, ...(myDoc?.closeFriendIds || [])];

  const btn = $('#postBtn');
  btn.disabled = true; btn.textContent = 'Posting...';
  try {
    let imageURL = '';
    if (composeImageFile) {
      imageURL = await imageToDataURL(composeImageFile);
    }
    await addDoc(collection(db, 'posts'), {
      authorId: me.uid,
      authorName: myDoc?.name || 'User',
      authorPhoto: myDoc?.photoURL || '',
      text,
      imageURL,
      privacy: composePrivacy,
      audience,
      likeCount: 0,
      commentCount: 0,
      createdAt: serverTimestamp()
    });
    closeCompose();
    toast('Posted! 🎉');
    if (location.hash !== '#/home') location.hash = '#/home';
  } catch (err) {
    handleDbError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Post';
  }
}

// ---------------- likes / comments / share ----------------
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
  const unsub = onSnapshot(q, (snap) => {
    listEl.innerHTML = snap.docs.map(d => {
      const c = d.data();
      return `<div class="comment">
        ${avatarHTML({ name: c.authorName, photoURL: c.authorPhoto })}
        <div class="comment-body">
          <span class="comment-author">${esc(c.authorName)}</span><span class="comment-time">${timeAgo(c.createdAt)}</span>
          <div>${esc(c.text)}</div>
        </div>
      </div>`;
    }).join('') || `<div class="empty-state" style="padding:12px">No comments yet.</div>`;
  }, handleDbError);
  openCommentThreads.set(postId, unsub);
  viewUnsubs.push(unsub);
}

async function sendComment(postId, inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  try {
    await addDoc(collection(db, 'posts', postId, 'comments'), {
      authorId: me.uid,
      authorName: myDoc?.name || 'User',
      authorPhoto: myDoc?.photoURL || '',
      text,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'posts', postId), { commentCount: increment(1) });
  } catch (err) { handleDbError(err); }
}

async function sharePost(postId) {
  try {
    const snap = await getDoc(doc(db, 'posts', postId));
    const p = snap.data();
    const text = `${p.authorName} on Saathi: ${p.text || '📷 photo'}`;
    if (navigator.share) {
      await navigator.share({ title: 'Saathi post', text, url: location.origin });
    } else {
      await navigator.clipboard.writeText(text + ' — ' + location.origin);
      toast('Post copied to clipboard!');
    }
  } catch (e) { /* user cancelled */ }
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

// ============================================================
//  SEARCH
// ============================================================
function renderSearch() {
  view.innerHTML = `
    <h2 class="page-title">Find People</h2>
    <div class="search-bar">
      <input id="searchInput" placeholder="Search by name..." autocomplete="off">
    </div>
    <div id="searchResults">${emptyState('🔍', 'Type a name to search.')}</div>`;

  let timer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(timer);
    const term = e.target.value.trim().toLowerCase();
    timer = setTimeout(() => doSearch(term), 400);
  });
}

async function doSearch(term) {
  const res = $('#searchResults');
  if (!term) { res.innerHTML = emptyState('🔍', 'Type a name to search.'); return; }
  try {
    const q = query(collection(db, 'users'),
      where('nameLower', '>=', term), where('nameLower', '<=', term + '\uf8ff'), limit(20));
    const snap = await getDocs(q);
    const users = snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.uid !== me.uid);
    if (!users.length) { res.innerHTML = emptyState('😕', 'No users found.'); return; }
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
      <button class="btn btn-light btn-sm" data-action="open-edit">✏️ Edit Profile</button>
      <button class="btn btn-danger btn-sm" data-action="logout">Logout</button>`;
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
      <div class="profile-cover">
        ${!isMe ? `<button class="profile-back" data-action="back">←</button>` : ''}
      </div>
      <div class="profile-head">
        ${isMe
          ? `<div class="profile-avatar-wrap" data-action="change-avatar" title="Change profile photo">
               ${avatarHTML(u, 'profile-avatar')}
               <span class="cam-badge">📷</span>
             </div>
             <div class="tap-photo-hint">Tap photo to change</div>`
          : avatarHTML(u, 'profile-avatar')}
        <div class="profile-name">${esc(u.name)}</div>
        <div class="profile-actions">${actionBtns}</div>
      </div>
      <div class="profile-info">
        ${u.bio ? `<div class="row">🎓 ${esc(u.bio)}</div>` : ''}
        ${u.location ? `<div class="row">📍 ${esc(u.location)}</div>` : ''}
        <div class="row">📅 Joined ${joinDate(u.createdAt)}</div>
      </div>
      <div class="profile-counts">
        <span><b>${counts.friends}</b> Friends</span>
        <span id="postCount"></span>
      </div>
      <div class="profile-tabs">
        <button class="profile-tab ${tab === 'activity' ? 'active' : ''}" data-action="profile-tab" data-id="${uid}" data-tab="activity">ACTIVITY</button>
        <button class="profile-tab ${tab === 'likes' ? 'active' : ''}" data-action="profile-tab" data-id="${uid}" data-tab="likes">LIKES</button>
      </div>
    </div>
    <div id="profilePosts">${emptyState('⏳', 'Loading...')}</div>`;

  if (tab === 'activity') loadProfilePosts(uid);
  else loadLikedPosts(uid);
}

function loadProfilePosts(uid) {
  const postsMap = new Map();
  const draw = async () => {
    const posts = [...postsMap.values()]
      .filter(visibleToMe)
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    const countEl = $('#postCount');
    if (countEl) countEl.innerHTML = `<b>${posts.length}</b> Posts`;
    const pp = $('#profilePosts');
    if (!pp) return;
    if (!posts.length) {
      pp.innerHTML = emptyState('📝', 'No posts to show.');
      return;
    }
    await markLiked(posts);
    const pp2 = $('#profilePosts');
    if (!pp2) return;
    pp2.innerHTML = posts.map(postCard).join('');
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
    $('#profilePosts').innerHTML = posts.map(postCard).join('');
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

// ============================================================
//  CHATS (friends only — also enforced by Firestore rules)
// ============================================================
async function renderChats() {
  view.innerHTML = `
    <h2 class="page-title">Chats</h2>
    <div id="chatList">${emptyState('⏳', 'Loading...')}</div>
    <div id="friendStart"></div>`;
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
      return `<div class="chat-row ${un ? 'unread' : ''}" data-action="message" data-id="${otherUid}">
        ${avatarHTML(u)}
        <div class="chat-row-info">
          <div class="chat-row-name">${esc(u.name)}</div>
          <div class="chat-row-last">${esc(c.lastMessage || 'Say hi 👋')}</div>
        </div>
        ${un ? '<span class="unread-dot"></span>' : ''}
        <span class="chat-row-time">${timeAgo(c.lastAt)}</span>
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
  el.innerHTML = `<h3 style="font-size:15px;font-weight:800;margin:16px 4px 10px">Start a chat</h3>` + users.map(u => {
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
    <div class="chat-input-bar">
      <button class="chat-photo-btn" data-action="chat-photo" data-id="${otherUid}" title="Send photo">📷</button>
      <input id="chatInput" placeholder="Type a message..." autocomplete="off" maxlength="1000">
      <button data-action="send-chat" data-id="${otherUid}">➤</button>
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
      const mode = s.data()?.mode === 'girly' ? 'girly' : 'normal';
      currentChatMode = mode;
      document.querySelectorAll('.mode-chip').forEach(c =>
        c.classList.toggle('active', c.dataset.mode === mode));
      $('#girlyBanner')?.classList.toggle('hidden', mode !== 'girly');
    }, () => {}));

    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'), limit(300));
    viewUnsubs.push(onSnapshot(q, (snap) => {
      const box = $('#messages');
      if (!box) return;
      box.innerHTML = snap.docs.map(d => {
        const m = d.data();
        const mine = m.senderId === me.uid;
        const girly = m.mode === 'girly';
        const girlyAttr = (girly && !mine) ? `data-girly-id="${d.id}"` : '';
        const body = m.imageURL
          ? `<img class="msg-img" src="${m.imageURL}" draggable="false" alt="photo">`
          : esc(m.text || '');
        return `<div class="msg ${mine ? 'mine' : 'theirs'} ${girly ? 'girly' : ''}" ${girlyAttr}>${body}<span class="msg-time">${timeAgo(m.createdAt)}${girly ? ' 🔥' : ''}</span></div>`;
      }).join('');
      window.scrollTo(0, document.body.scrollHeight);
      markRead();

      // 🌸 girly messages from the other side: destroy 3 sec after being seen
      box.querySelectorAll('[data-girly-id]').forEach(el => {
        const mid = el.dataset.girlyId;
        if (girlyTimers.has(mid)) return;
        girlyTimers.set(mid, setTimeout(() => {
          girlyTimers.delete(mid);
          deleteDoc(doc(db, 'chats', chatId, 'messages', mid)).catch(() => {});
        }, 3000));
      });
    }, handleDbError));

    const input = $('#chatInput');
    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(otherUid); });
  } catch (err) { handleDbError(err); }
}

async function sendChat(otherUid) {
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const chatId = chatIdFor(me.uid, otherUid);
  try {
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId: me.uid, text, mode: currentChatMode, createdAt: serverTimestamp()
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
    case 'open-compose':    openCompose(); break;
    case 'close-compose':   closeCompose(); break;
    case 'set-privacy':     setPrivacyChips(el.dataset.privacy); break;
    case 'remove-compose-image':
      composeImageFile = null; $('#composeImage').value = '';
      $('#composePreview').classList.add('hidden'); break;
    case 'submit-post':     submitPost(); break;
    case 'like':            toggleLike(id); break;
    case 'toggle-comments': toggleComments(id); break;
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
