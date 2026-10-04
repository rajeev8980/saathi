// Remove orphan TEST posts (by author name) using owner token.
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const PROJECT = 'saathi-2407f';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const TEST_NAMES = new Set(['Rani Sharma', 'Vikram Kumar', 'Test A', 'Test B', 'Test User']);

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

const r = await fetch(`${FS}/posts?pageSize=300`, { headers: H });
const j = await r.json();
const posts = j.documents || [];
console.log('total posts:', posts.length);
for (const p of posts) {
  const author = p.fields?.authorName?.stringValue || '';
  if (TEST_NAMES.has(author)) {
    const name = p.name;
    for (const sub of ['likes', 'comments']) {
      const s = await fetch(`https://firestore.googleapis.com/v1/${name}/${sub}?pageSize=300`, { headers: H });
      const sj = await s.json();
      for (const d of (sj.documents || [])) {
        await fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: 'DELETE', headers: H });
      }
    }
    const del = await fetch(`https://firestore.googleapis.com/v1/${name}`, { method: 'DELETE', headers: H });
    console.log('deleted test post by', author, '->', del.status);
  } else {
    console.log('KEEP:', author, '-', (p.fields?.text?.stringValue || '').slice(0, 30));
  }
}
console.log('DONE');
