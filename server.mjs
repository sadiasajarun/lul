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

// Authenticated users get the built SPA; unknown routes fall back to index.html.
// (Plain middleware fallback — Express 5 rejects the old app.get('*') wildcard path.)
app.use(express.static(DIST));
app.use((_req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, () => console.log(`LMS-learn (auth-gated) listening on :${PORT}`));
