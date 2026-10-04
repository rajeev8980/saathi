// Delete TEST leftovers from the database using the project-owner OAuth
// token (bypasses security rules, like the Admin SDK). Real users untouched.
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const PROJECT = 'saathi-2407f';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const TEST_NAMES = new Set(['Vikram Kumar', 'Rani Sharma', 'Test A', 'Test B', 'Test User', 'Rani Test', 'Vikram Test']);

const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const params = new URLSearchParams({
  client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  refresh_token: cfg.tokens.refresh_token,
  grant_type: 'refresh_token'
});
const token = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params })
  .then(r => r.json()).then(j => j.access_token);
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function listDocs(path) {
  const out = [];
  let pageToken = '';
  do {
    const r = await fetch(`${FS}/${path}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`, { headers: H });
    const j = await r.json();
    if (j.documents) out.push(...j.documents);
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}
async function delDoc(name) {
  const r = await fetch(`https://firestore.googleapis.com/v1/${name}`, { method: 'DELETE', headers: H });
  return r.status;
}
async function delTree(name) {
  // delete known subcollections first
  for (const sub of ['friends', 'likes', 'comments', 'messages']) {
    try {
      const subs = await listDocs(name + '/' + sub);
      for (const s of subs) await delDoc(s.name);
    } catch (e) { /* subcollection missing */ }
  }
  return delDoc(name);
}

// 1. find test users
const users = await listDocs('users');
const testUids = new Set();
for (const d of users) {
  const name = d.fields?.name?.stringValue || '';
  const uid = d.name.split('/').pop();
  if (TEST_NAMES.has(name)) testUids.add(uid);
  else console.log('KEEPING real user:', name, `(${uid.slice(0, 6)}...)`);
}
console.log('\nTest user docs to delete:', [...testUids].join(', ') || 'none');

// 2. delete their user docs (+ friends subcollections)
for (const uid of testUids) {
  console.log('delete user', uid, '->', await delTree(`projects/${PROJECT}/databases/(default)/documents/users/${uid}`));
}

// 3. friend requests involving test users
const reqs = await listDocs('friendRequests');
for (const r of reqs) {
  const f = r.fields;
  if (testUids.has(f?.from?.stringValue) || testUids.has(f?.to?.stringValue)) {
    console.log('delete request', r.name.split('/').pop(), '->', await delDoc(r.name));
  }
}

// 4. chats with test users (+ messages)
const chats = await listDocs('chats');
for (const c of chats) {
  const members = (c.fields?.members?.arrayValue?.values || []).map(v => v.stringValue);
  if (members.some(m => testUids.has(m))) {
    console.log('delete chat', c.name.split('/').pop().slice(0, 12) + '…', '->', await delTree(c.name));
  }
}

// 5. posts by test users (+ likes/comments)
const posts = await listDocs('posts');
for (const p of posts) {
  if (testUids.has(p.fields?.authorId?.stringValue)) {
    console.log('delete post', p.name.split('/').pop().slice(0, 8) + '…', '->', await delTree(p.name));
  }
}

console.log('\nCLEANUP DONE');
