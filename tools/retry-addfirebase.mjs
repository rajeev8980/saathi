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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function tryAdd(extraHeaders = {}) {
  const r = await fetch(`https://firebase.googleapis.com/v1beta1/projects/${projectId}:addFirebase`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: '{}'
  });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 400) };
}

// attempt 1: with quota project header
let res = await tryAdd({ 'X-Goog-User-Project': projectId });
console.log('with quota header ->', res.status, res.body);

// attempts 2-6: plain, 45s apart
for (let i = 2; i <= 6 && res.status === 403; i++) {
  console.log(`waiting 45s before attempt ${i}...`);
  await sleep(45000);
  res = await tryAdd();
  console.log(`attempt ${i} ->`, res.status, res.body);
}

if (res.status === 200) {
  console.log('SUCCESS - Firebase added!');
} else {
  console.log('STILL_BLOCKED');
}
