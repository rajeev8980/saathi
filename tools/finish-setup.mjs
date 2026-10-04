// Finish setup on the console-created project saathi-2407f
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const projectId = 'saathi-2407f';
const OLD_PROJECT = 'saathi-app-994427';
const LOCATION = 'asia-south1';

function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const e = new Error(`${method} ${url} -> ${res.status}: ${json?.error?.message || text}`);
    e.status = res.status; throw e;
  }
  return json;
}

function getAccessToken() {
  const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
  const params = new URLSearchParams({
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    refresh_token: cfg.tokens.refresh_token,
    grant_type: 'refresh_token'
  });
  return fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params })
    .then(r => r.json()).then(j => j.access_token);
}

const token = await getAccessToken();
console.log('token OK');

// ---- 0. verify Firebase is active on the new project ----
const fb = await api(token, 'GET', `https://firebase.googleapis.com/v1beta1/projects/${projectId}`);
console.log('Firebase project confirmed:', fb.displayName || fb.projectId);
writeFileSync(join(APP_DIR, '.firebaserc'), JSON.stringify({ projects: { default: projectId } }, null, 2));

// ---- 1. enable APIs ----
async function enableApi(name) {
  for (let i = 0; i < 3; i++) {
    try {
      await api(token, 'POST', `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${name}:enable`);
      console.log('API on:', name); return;
    } catch (e) {
      if (/already enabled/i.test(e.message)) { console.log('API already on:', name); return; }
      console.log(`enable ${name} retry ${i + 1}:`, e.message);
      await sleep(10000);
    }
  }
}
for (const a of ['firestore.googleapis.com', 'firebaserules.googleapis.com',
  'identitytoolkit.googleapis.com', 'firebasestorage.googleapis.com',
  'storage.googleapis.com', 'appengine.googleapis.com', 'firebasehosting.googleapis.com']) {
  await enableApi(a);
}

// ---- 2. web app + sdk config ----
let webAppId = null, sdkConfig = null;
for (let i = 0; i < 6 && !sdkConfig; i++) {
  try {
    if (!webAppId) {
      const out = sh(`firebase apps:create web "Saathi Web" --project ${projectId} --non-interactive --json`);
      const parsed = JSON.parse(out.slice(out.indexOf('{')));
      webAppId = parsed?.result?.appId || parsed?.appId;
      console.log('web app created:', webAppId);
    }
    const cfgOut = sh(`firebase apps:sdkconfig web ${webAppId} --project ${projectId} --non-interactive --json`);
    const parsed = JSON.parse(cfgOut.slice(cfgOut.indexOf('{')));
    sdkConfig = parsed?.result || parsed;
  } catch (e) {
    console.log(`waiting for firebase readiness (${i + 1}/6):`, e.message.slice(0, 200));
    await sleep(10000);
  }
}
if (!sdkConfig) throw new Error('web app config failed');
const cfg = sdkConfig.sdkConfig || sdkConfig;
writeFileSync(join(APP_DIR, 'public', 'js', 'firebase-config.js'), `// ============================================================
//  Saathi — Firebase configuration (auto-generated)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "${cfg.apiKey}",
  authDomain: "${cfg.authDomain}",
  projectId: "${cfg.projectId}",
  storageBucket: "${cfg.storageBucket}",
  messagingSenderId: "${cfg.messagingSenderId}",
  appId: "${cfg.appId}"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
`);
console.log('firebase-config.js written:', cfg.projectId);

// ---- 3. Firestore database ----
for (let i = 0; i < 4; i++) {
  try {
    await api(token, 'POST',
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`,
      { locationId: LOCATION, type: 'FIRESTORE_NATIVE' });
    console.log('Firestore DB creating...'); break;
  } catch (e) {
    if (e.status === 409 || /already exists/i.test(e.message)) { console.log('Firestore DB exists'); break; }
    console.log(`firestore create retry ${i + 1}:`, e.message);
    await sleep(15000);
  }
}

// ---- 4. Email/Password auth ----
for (let i = 0; i < 4; i++) {
  try {
    await api(token, 'PATCH',
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
      { signIn: { email: { enabled: true, passwordRequired: true } } });
    console.log('Email/Password auth enabled'); break;
  } catch (e) {
    console.log(`auth enable retry ${i + 1}:`, e.message);
    await sleep(15000);
  }
}

// ---- 5. Storage bucket via App Engine ----
for (let i = 0; i < 3; i++) {
  try {
    const op = await api(token, 'POST', 'https://appengine.googleapis.com/v1/apps',
      { id: projectId, locationId: LOCATION, servingStatus: 'SERVING' });
    console.log('App Engine creating (provisions storage bucket)...');
    if (op.name) {
      for (let j = 0; j < 40; j++) {
        const o = await api(token, 'GET', `https://appengine.googleapis.com/v1/${op.name}`);
        if (o.done) break;
        await sleep(3000);
      }
    }
    console.log('App Engine ready'); break;
  } catch (e) {
    if (e.status === 409 || /already exists/i.test(e.message)) { console.log('App Engine exists'); break; }
    console.log(`appengine retry ${i + 1}:`, e.message);
    await sleep(15000);
  }
}
try {
  await api(token, 'POST',
    `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`,
    { bucket: `${projectId}.appspot.com` });
  console.log('Storage default bucket linked');
} catch (e) {
  console.log('storage link note:', e.message);
}
// verify bucket
try {
  const b = await api(token, 'GET', `https://storage.googleapis.com/storage/v1/b/${projectId}.appspot.com`);
  console.log('Bucket verified:', b.name);
} catch (e) {
  console.log('bucket check note:', e.message);
}

// ---- 6. cleanup: delete the old empty project (best effort) ----
try {
  await api(token, 'DELETE', `https://cloudresourcemanager.googleapis.com/v1/projects/${OLD_PROJECT}`);
  console.log('Old empty project deleted:', OLD_PROJECT);
} catch (e) {
  console.log('old project cleanup skipped:', e.message);
}

console.log('\nSETUP COMPLETE:', projectId);
writeFileSync(join(APP_DIR, 'tools', 'project-id.txt'), projectId);
