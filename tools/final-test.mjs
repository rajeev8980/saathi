const projectId = 'saathi-2407f';
const API_KEY = 'AIzaSyCekpogL0U8nKpT6k9yZxmJxMdO8isJ_3s';
const FS = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

// tiny valid JPEG as data URL (like the app now produces, just smaller)
const DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAd//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAv//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Av//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z';

async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t }; } }
let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
}

// 1. sign up two test users
async function signup(email) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
  });
  return j(r);
}
const ts = Date.now();
const A = await signup(`testa${ts}@saathi-test.com`);
const B = await signup(`testb${ts}@saathi-test.com`);
check('User A signup', !!A.idToken);
check('User B signup', !!B.idToken);

async function fsWrite(path, fields, token, method = 'POST') {
  const r = await fetch(`${FS}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return r;
}
const sv = (s) => ({ stringValue: s });
const av = (arr) => ({ arrayValue: { values: arr.map(sv) } });
const iv = (n) => ({ integerValue: n });

// 2. create user docs
let r = await fsWrite(`users?documentId=${A.localId}`, { name: sv('Test A'), nameLower: sv('test a'), bio: sv(''), location: sv(''), photoURL: sv(''), closeFriendIds: av([]) }, A.idToken);
check('User A profile doc', r.status === 200);

// 3. A creates a PUBLIC photo post (data-URL image)
r = await fsWrite('posts', {
  authorId: sv(A.localId), authorName: sv('Test A'), authorPhoto: sv(''),
  text: sv('Test photo post'), imageURL: sv(DATA_URL),
  privacy: sv('public'), audience: av([A.localId]),
  likeCount: iv(0), commentCount: iv(0)
}, A.idToken);
check('A creates public PHOTO post', r.status === 200);
const postA = r.status === 200 ? (await j(r)).name.split('/').pop() : null;

// 4. A creates a FRIENDS-only post
r = await fsWrite('posts', {
  authorId: sv(A.localId), authorName: sv('Test A'), authorPhoto: sv(''),
  text: sv('Friends only post'), imageURL: sv(''),
  privacy: sv('friends'), audience: av([A.localId]),
  likeCount: iv(0), commentCount: iv(0)
}, A.idToken);
const postFriends = r.status === 200 ? (await j(r)).name.split('/').pop() : null;
check('A creates friends-only post', r.status === 200);

// 5. B (not a friend) can read the public post but NOT the friends post
r = await fetch(`${FS}/posts/${postA}`, { headers: { Authorization: `Bearer ${B.idToken}` } });
check('B reads public post', r.status === 200);
r = await fetch(`${FS}/posts/${postFriends}`, { headers: { Authorization: `Bearer ${B.idToken}` } });
check('B BLOCKED from friends-only post', r.status === 403);

// 6. B tries to open a chat with A (not friends) → must be blocked
r = await fsWrite('chats?documentId=' + [A.localId, B.localId].sort().join('_'),
  { members: av([A.localId, B.localId]), lastMessage: sv('') }, B.idToken);
check('B BLOCKED from chatting with stranger', r.status === 403);

// 7. friend request flow: B -> A, A accepts, chat opens
r = await fsWrite(`friendRequests?documentId=${B.localId}_${A.localId}`,
  { from: sv(B.localId), to: sv(A.localId), status: sv('pending') }, B.idToken);
check('B sends friend request to A', r.status === 200);
r = await fetch(`${FS}/friendRequests/${B.localId}_${A.localId}?updateMask.fieldPaths=status`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${A.idToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { status: sv('accepted') } })
});
check('A accepts request', r.status === 200);
const frData = { since: { timestampValue: new Date().toISOString() }, rid: sv(`${B.localId}_${A.localId}`) };
r = await fsWrite(`users/${A.localId}/friends?documentId=${B.localId}`, frData, A.idToken);
const ok1 = r.status === 200;
r = await fsWrite(`users/${B.localId}/friends?documentId=${A.localId}`, frData, A.idToken);
check('Friendship docs created (both sides)', ok1 && r.status === 200);

// 8. now B CAN open the chat and send a message
r = await fsWrite('chats?documentId=' + [A.localId, B.localId].sort().join('_'),
  { members: av([A.localId, B.localId]), lastMessage: sv('') }, B.idToken);
check('B opens chat after friendship', r.status === 200);
r = await fsWrite(`chats/${[A.localId, B.localId].sort().join('_')}/messages`,
  { senderId: sv(B.localId), text: sv('hello A!') }, B.idToken);
check('B sends message', r.status === 200);

// 9. cleanup everything
async function del(path, token) {
  await fetch(`${FS}/${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}
await del(`posts/${postA}`, A.idToken);
await del(`posts/${postFriends}`, A.idToken);
await del(`users/${A.localId}/friends/${B.localId}`, A.idToken);
await del(`users/${B.localId}/friends/${A.localId}`, A.idToken);
await del(`friendRequests/${B.localId}_${A.localId}`, A.idToken);
await del(`users/${A.localId}`, A.idToken);
await del(`users/${B.localId}`, B.idToken);
for (const u of [A, B]) {
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: u.idToken })
  });
}
console.log(`\n${fail === 0 ? '🎉 ALL ' + pass + ' TESTS PASSED' : '⚠️ ' + fail + ' tests FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
