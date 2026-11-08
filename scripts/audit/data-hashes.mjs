// Fingerprints every existing data file, to prove the question-bank work leaves them unchanged.
//
//   node scripts/audit/data-hashes.mjs --write    record the baseline
//   node scripts/audit/data-hashes.mjs            compare against it (exit 1 on any difference)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASELINE = path.join(HERE, 'baseline', 'data-hashes.json');
const FOLDERS = ['data', 'data-v2', 'data-tuned'];
const isNew = (name) => name.startsWith('side_');

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

const current = {};
for (const folder of FOLDERS) {
  const dir = path.join(ROOT, 'public', folder);
  for (const name of fs.readdirSync(dir).sort()) {
    if (!isNew(name)) current[`${folder}/${name}`] = await sha256(path.join(dir, name));
  }
}

if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`Recorded ${Object.keys(current).length} files.`);
} else {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
  const changed = [...keys].filter((k) => base[k] !== current[k]);
  if (changed.length) {
    console.error(`CHANGED: ${changed.join(', ')}`);
    process.exit(1);
  }
  console.log(`All ${keys.size} existing data files are unchanged.`);
}
