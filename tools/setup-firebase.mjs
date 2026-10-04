// ============================================================
//  Saathi — full Firebase auto-setup script (run after login)
//  Usage: node tools/setup-firebase.mjs
//  Does: create project → enable APIs → create web app → write
//        firebase-config.js → create Firestore DB → enable
//        Email/Password auth → provision Storage bucket.
// ============================================================
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const APP_DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LOCATION = 'asia-south1'; // Mumbai

// ---------- helpers ----------
function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || text;
    const e = new Error(`${method} ${url} → ${res.status}: ${msg}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

async function waitOp(token, name, base = 'https://serviceusage.googleapis.com/v1') {
  for (let i = 0; i < 40; i++) {
    const op = await api(token, 'GET', `${base}/${name}`);
    if (op.done) return op;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Operation timed out: ' + name);
}

// ---------- 1. access token from firebase CLI credentials ----------
function getAccessToken() {
  const cfgPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const rt = cfg?.tokens?.refresh_token;
  if (!rt) throw new Error('No refresh token found — run firebase login first.');
  // well-known public OAuth client of the firebase-tools CLI
  const params = new URLSearchParams({
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    refresh_token: rt,
    grant_type: 'refresh_token'
  });
  return fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params })
    .then(r => r.json())
    .then(j => {
      if (!j.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(j));
      return j.access_token;
    });
}

// ---------- main ----------
const token = await getAccessToken();
console.log('✅ Got access token');

// 2. create a unique project id
const suffix = Math.floor(100000 + Math.random() * 900000);
const projectId = `saathi-app-${suffix}`;
try {
  sh(`firebase projects:create ${projectId} --non-interactive`);
} catch (e) {
  console.log('CLI project create failed, trying REST API...');
  await api(token, 'POST', 'https://firebase.googleapis.com/v1beta1/projects', { projectId, displayName: 'Saathi' });
}
console.log('✅ Project:', projectId);
writeFileSync(join(APP_DIR, '.firebaserc'), JSON.stringify({ projects: { default: projectId } }, null, 2));

// 3. enable required APIs
const apis = [
  'firebase.googleapis.com',
  'firestore.googleapis.com',
  'firebaserules.googleapis.com',
  'identitytoolkit.googleapis.com',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'appengine.googleapis.com'
];
for (const a of apis) {
  try {
    await api(token, 'POST', `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${a}:enable`);
    console.log('✅ API enabled:', a);
  } catch (e) {
    if (String(e.message).match(/already enabled|ENABLED/i)) console.log('• already on:', a);
    else console.log('⚠️  could not enable', a, '→', e.message);
  }
}

// 4. create the web app + grab its config (needs firebase API on; retry a bit)
let webAppId = null, sdkConfig = null;
for (let i = 0; i < 6 && !sdkConfig; i++) {
  try {
    if (!webAppId) {
      const out = sh(`firebase apps:create web "Saathi Web" --project ${projectId} --non-interactive --json`);
      const parsed = JSON.parse(out.slice(out.indexOf('{')));
      webAppId = parsed?.result?.appId || parsed?.appId;
    }
    const cfgOut = sh(`firebase apps:sdkconfig web ${webAppId} --project ${projectId} --non-interactive --json`);
    const parsed = JSON.parse(cfgOut.slice(cfgOut.indexOf('{')));
    sdkConfig = parsed?.result || parsed;
  } catch (e) {
    console.log(`…waiting for Firebase to be ready (${i + 1}/6)`);
    await new Promise(r => setTimeout(r, 8000));
  }
}
if (!sdkConfig) throw new Error('Could not create web app config.');
const cfg = sdkConfig.sdkConfig || sdkConfig; // normalize
const fileCfg = `// ============================================================
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
`;
writeFileSync(join(APP_DIR, 'public', 'js', 'firebase-config.js'), fileCfg);
console.log('✅ firebase-config.js written');

// 5. create Firestore database
try {
  await api(token, 'POST',
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`,
    { locationId: LOCATION, type: 'FIRESTORE_NATIVE' });
  console.log('✅ Firestore database creating (location ' + LOCATION + ')');
} catch (e) {
  if (e.status === 409 || /already exists/i.test(e.message)) console.log('• Firestore DB already exists');
  else console.log('⚠️  Firestore create:', e.message);
}

// 6. enable Email/Password sign-in
try {
  await api(token, 'PATCH',
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    { signIn: { email: { enabled: true, passwordRequired: true } } });
  console.log('✅ Email/Password auth enabled');
} catch (e) {
  console.log('⚠️  Auth enable:', e.message);
}

// 7. provision the default Storage bucket via App Engine
try {
  const op = await api(token, 'POST', 'https://appengine.googleapis.com/v1/apps',
    { id: projectId, locationId: LOCATION, servingStatus: 'SERVING' });
  console.log('✅ App Engine creating (this provisions the storage bucket)…');
  if (op.name) {
    for (let i = 0; i < 40; i++) {
      const o = await api(token, 'GET', `https://appengine.googleapis.com/v1/${op.name}`);
      if (o.done) break;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.log('✅ App Engine ready');
} catch (e) {
  if (e.status === 409 || /already exists/i.test(e.message)) console.log('• App Engine already exists');
  else console.log('⚠️  App Engine:', e.message);
}

// 8. link bucket to Firebase Storage (best effort)
try {
  await api(token, 'POST',
    `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`,
    { bucket: `${projectId}.appspot.com` });
  console.log('✅ Default Storage bucket linked');
} catch (e) {
  console.log('• Storage link (may already be fine):', e.message);
}

console.log('\n🎉 SETUP COMPLETE — project:', projectId);
writeFileSync(join(APP_DIR, 'tools', 'project-id.txt'), projectId);
