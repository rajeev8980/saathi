import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const projectId = 'saathi-2407f';
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
  console.log(`${method} ${url}\n  body=${JSON.stringify(body)}\n  -> ${r.status}: ${t.slice(0, 250).replace(/\s+/g, ' ')}\n`);
}

const B1 = `${projectId}.firebasestorage.app`;

// variant 1: bucket as full resource name
await probe('POST', `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`,
  { bucket: `projects/${projectId}/buckets/${B1}` });

// variant 2: bucket object with name
await probe('POST', `https://firebasestorage.googleapis.com/v1alpha/projects/${projectId}/defaultBucket`,
  { bucket: { name: B1 } });

// variant 3: v1beta endpoint
await probe('POST', `https://firebasestorage.googleapis.com/v1beta/projects/${projectId}/defaultBucket`,
  { bucket: B1 });

// variant 4: GCS direct bucket creation (may need billing)
await probe('POST', `https://storage.googleapis.com/storage/v1/b?project=${projectId}`,
  { name: B1, location: 'ASIA-SOUTH1' });
