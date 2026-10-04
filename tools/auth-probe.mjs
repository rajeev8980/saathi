import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const projectId = 'saathi-2407f';
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

async function probe(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  console.log(`${method} ${url}\n -> ${r.status}: ${t.slice(0, 220)}\n`);
  return r.status;
}

// enable Token Service API too (Auth needs it)
await probe('POST', `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/securetoken.googleapis.com:enable`);
await sleep(5000);

// variant 1: enable firebaseauth API if it exists
await probe('POST', `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/firebaseauth.googleapis.com:enable`);
await sleep(5000);

// variant 2: retry v2 PATCH after enabling extra APIs
await probe('PATCH', `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
  { signIn: { email: { enabled: true, passwordRequired: true } } });

// variant 3: PUT instead of PATCH
await probe('PUT', `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email.enabled`,
  { signIn: { email: { enabled: true, passwordRequired: true } } });

// variant 4: v2 (non-admin) PATCH
await probe('PATCH', `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/config?updateMask=signIn.email.enabled`,
  { signIn: { email: { enabled: true, passwordRequired: true } } });

// variant 5: old relyingparty setProjectConfig
await probe('POST', `https://identitytoolkit.googleapis.com/v1/relyingparty/setProjectConfig?key=AIzaSyCekpogL0U8nKpT6k9yZxmJxMdO8isJ_3s`,
  { allowPasswordUser: true });

// variant 6: GET v1 config to see if anything exists
await probe('GET', `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/config`);
