import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const projectId = 'saathi-app-994427';
const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const params = new URLSearchParams({
  client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  refresh_token: cfg.tokens.refresh_token,
  grant_type: 'refresh_token'
});
const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params }).then(r => r.json());
console.log('token scopes:', tok.scope);

async function get(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  console.log(`\n${method} ${url}\n -> ${r.status}: ${t.slice(0, 600)}`);
}

await get(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`);
await get(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/firebase.googleapis.com`);
await get(`https://firebase.googleapis.com/v1beta1/projects/${projectId}`);
await get(`https://firebase.googleapis.com/v1beta1/projects/${projectId}:addFirebase`, 'POST', {});
await get(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`, 'POST', {});
