import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const projectId = 'saathi-2407f';
const API_KEY = 'AIzaSyCekpogL0U8nKpT6k9yZxmJxMdO8isJ_3s';

const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const params = new URLSearchParams({
  client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  refresh_token: cfg.tokens.refresh_token,
  grant_type: 'refresh_token'
});
const token = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params })
  .then(r => r.json()).then(j => j.access_token);

async function probe(label, url, method = 'GET', body, useKey = false) {
  const r = await fetch(url + (useKey ? '?key=' + API_KEY : ''), {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  console.log(`${label}: ${r.status} ${t.slice(0, 300).replace(/\s+/g, ' ')}\n`);
  return { status: r.status, text: t };
}

// 1. is Email/Password auth on?
await probe('AUTH CONFIG', `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`);

// 2. does the storage bucket exist? (both naming schemes)
await probe('BUCKET (firebasestorage.app)', `https://storage.googleapis.com/storage/v1/b/${projectId}.firebasestorage.app`);
await probe('BUCKET (appspot.com)', `https://storage.googleapis.com/storage/v1/b/${projectId}.appspot.com`);

// 3. try a real signup with the web API key (proves auth end-to-end)
const email = `test${Date.now()}@saathi-test.com`;
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
});
const signup = await r.json();
if (signup.idToken) {
  console.log('SIGNUP TEST: ✅ SUCCESS — auth is working! (test user created)');

  // 4. write the user profile doc via Firestore REST (proves rules)
  const uid = signup.localId;
  const w = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?documentId=${uid}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signup.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { name: { stringValue: 'Test User' }, nameLower: { stringValue: 'test user' }, bio: { stringValue: '' }, location: { stringValue: '' }, photoURL: { stringValue: '' } } })
  });
  console.log('FIRESTORE WRITE TEST:', w.status, w.status === 200 ? '✅ rules OK' : (await w.text()).slice(0, 200));

  // cleanup: delete the test account + doc
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: signup.idToken })
  });
  await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${signup.idToken}` }
  });
  console.log('test user cleaned up');
} else {
  console.log('SIGNUP TEST: ❌ FAILED —', JSON.stringify(signup).slice(0, 300));
}
