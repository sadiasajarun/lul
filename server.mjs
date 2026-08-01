// Authenticated static server for Render (Web Service).
//
// WHY THIS EXISTS: a plain static host serves /data/*.csv (real PII) to anyone with the URL.
// This wraps the built app in HTTP Basic Auth so NOTHING — not the app, not the CSVs — loads
// without a valid login. That makes the deployment genuinely team-only.
//
// Credentials come from env vars (set them in the Render dashboard, never commit them):
//   ADMIN_EMAIL     e.g. admin@admin.com
//   ADMIN_PASSWORD  e.g. admin@123#
import express from 'express';
import compression from 'compression';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = process.env.PORT || 10000;
const USER = process.env.ADMIN_EMAIL || 'admin@admin.com';
const PASS = process.env.ADMIN_PASSWORD || 'admin@123#';

// Constant-time string compare (avoids leaking length/short-circuit timing).
function safeEqual(a, b) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const app = express();

// Gate EVERY request (assets, index.html, and /data/*.csv alike) before anything is served.
app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const i = decoded.indexOf(':');            // password may contain ':'? split on the FIRST colon only
    const user = decoded.slice(0, i);
    const pass = decoded.slice(i + 1);
    if (safeEqual(user, USER) && safeEqual(pass, PASS)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="LMS-learn (team only)"');
  return res.status(401).send('Authentication required.');
});

// Gzip responses AFTER auth. Data CSVs are highly compressible (~5-8x), so large files like the
// 79MB preview assessments.csv transfer as ~10MB — this prevents the download stream from being
// interrupted on slow/free-tier connections (the "Failed to read from a ReadableStream" crash).
// Also compresses the DuckDB .wasm modules and JS bundles.
app.use(compression({
  filter: (req, res) => /application\/wasm/.test(String(res.getHeader('Content-Type') || '')) || compression.filter(req, res),
}));

// Authenticated users get the built SPA; unknown routes fall back to index.html.
// (Plain middleware fallback — Express 5 rejects the old app.get('*') wildcard path.)
app.use(express.static(DIST));
app.use((req, res) => {
  // A missing file WITH an extension (e.g. a data CSV, JS, wasm) must 404 — never serve index.html
  // in its place, or the client would try to parse HTML as CSV ("<!DOCTYPE html>" binder errors).
  if (path.extname(req.path)) return res.status(404).type('text/plain').send('Not found');
  // Extensionless paths are SPA navigation routes → serve the app shell.
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, () => console.log(`LMS-learn (auth-gated) listening on :${PORT}`));
