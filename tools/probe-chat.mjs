const PROJECT = 'saathi-2407f';
const API_KEY = 'AIzaSyCekpogL0U8nKpT6k9yZxmJxMdO8isJ_3s';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const PASS = 'Test1234!';
const ts = Date.now();

async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t }; } }
async function signup(email) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS, returnSecureToken: true })
  });
  return j(r);
}
const sv = (s) => ({ stringValue: s });
const av = (a) => ({ arrayValue: { values: a.map(sv) } });

const A = await signup(`probea${ts}@t.com`);
const B = await signup(`probeb${ts}@t.com`);
console.log('users ready');

async function call(label, method, path, token, body) {
  const r = await fetch(`${FS}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  console.log(`${label}: ${r.status} ${r.status !== 200 ? t.slice(0, 220) : 'OK'}`);
  return r.status;
}

// build friendship properly (request + accept + both docs)
await call('request B->A', 'POST', `friendRequests?documentId=${B.localId}_${A.localId}`, B.idToken,
  { fields: { from: sv(B.localId), to: sv(A.localId), status: sv('pending') } });
await call('A accepts', 'PATCH', `friendRequests/${B.localId}_${A.localId}?updateMask.fieldPaths=status`, A.idToken,
  { fields: { status: sv('accepted') } });
const fd = { fields: { rid: sv(`${B.localId}_${A.localId}`), since: { timestampValue: new Date().toISOString() } } };
await call('friend doc A side', 'POST', `users/${A.localId}/friends?documentId=${B.localId}`, A.idToken, fd);
await call('friend doc B side', 'POST', `users/${B.localId}/friends?documentId=${A.localId}`, A.idToken, fd);

const chatId = [A.localId, B.localId].sort().join('_');
await call('B creates chat', 'POST', `chats?documentId=${chatId}`, B.idToken,
  { fields: { members: av([B.localId, A.localId]), lastMessage: sv('') } });
await call('B adds message', 'POST', `chats/${chatId}/messages`, B.idToken,
  { fields: { senderId: sv(B.localId), text: sv('hi') } });
await call('B LISTS messages (read rule)', 'GET', `chats/${chatId}/messages`, B.idToken);
await call('B updates chat lastMessage', 'PATCH', `chats/${chatId}?updateMask.fieldPaths=lastMessage&updateMask.fieldPaths=lastAt`, B.idToken,
  { fields: { lastMessage: sv('hi'), lastAt: { timestampValue: new Date().toISOString() } } });
await call('A LISTS messages too', 'GET', `chats/${chatId}/messages`, A.idToken);

// cleanup
for (const u of [A, B]) {
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: u.idToken })
  });
}
console.log('done');
