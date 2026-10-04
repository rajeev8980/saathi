import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const projectId = 'saathi-2407f';
const BUCKET = `${projectId}.firebasestorage.app`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const params = new URLSearchParams({
  client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  refresh_token: cfg.tokens.refresh_token,
  grant_type: 'refresh_token'
});
const token = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params })
  .then(r => r.json()).then(j => j.access_token);

async function api(method, url, body, swallow) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok && !swallow) console.log(`${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  return { status: res.status, text };
}

// ---- A. Firestore DB: wait until ACTIVE ----
for (let i = 0; i < 20; i++) {
  const r = await api('GET', `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`, null, true);
  if (r.status === 200) {
    const state = JSON.parse(r.text).state || JSON.parse(r.text).type;
    console.log('Firestore DB state:', state);
    if (String(state).includes('ACTIVE') || String(state).includes('NATIVE')) break;
  } else {
    console.log(`waiting for Firestore DB (${i + 1}/20)...`);
  }
  await sleep(10000);
}

// ---- B. Email/Password auth ----
const get1 = await api('GET', `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`, null, true);
console.log('auth config GET ->', get1.status, get1.text.slice(0, 200));

let authDone = false;
for (let i = 0; i < 8 && !authDone; i++) {
  const r = await api('PATCH',
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    { signIn: { email: { enabled: true, passwordRequired: true } } }, true);
  if (r.status === 200) { console.log('Email/Password auth ENABLED'); authDone = true; break; }
  console.log(`auth retry ${i + 1}/8:`, r.status, r.text.slice(0, 150));
  await sleep(15000);
}
if (!authDone) {
  // last resort: try creating the config resource via POST initialize
  const r = await api('POST', `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config:initialize`, {}, true);
  console.log('config:initialize ->', r.status, r.text.slice(0, 200));
  const r2 = await api('PATCH',
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    { signIn: { email: { enabled: true, passwordRequired: true } } }, true);
  console.log('auth final ->', r2.status === 200 ? 'ENABLED' : r2.text.slice(0, 200));
}

// ---- C. Storage default bucket (new firebasestorage.app format) ----
for (let i = 0; i < 4; i++) {
  const r = await api('POST',
    `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`,
    { bucket: BUCKET }, true);
  console.log(`storage link try ${i + 1} ->`, r.status, r.text.slice(0, 250));
  if (r.status === 200) break;
  await sleep(10000);
}
const b = await api('GET', `https://storage.googleapis.com/storage/v1/b/${BUCKET}`, null, true);
console.log('bucket check ->', b.status, b.status === 200 ? 'BUCKET READY: ' + BUCKET : b.text.slice(0, 200));

console.log('FIXUPS DONE');
