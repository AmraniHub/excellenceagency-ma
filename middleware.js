import { suspended } from "./site-status.js";

/**
 * HOSTING GATE — Vercel Edge Middleware.
 *
 * Reads one boolean from site-status.js, which Servolia rewrites when a
 * hosting payment clears or a grace period runs out. Nothing is fetched at
 * request time, so a live site costs one cheap edge check and never depends on
 * Servolia being up.
 *
 * WHY 503 AND NOT A REDIRECT TO A PAGE
 *
 * The previous gate 302-redirected every visitor to /suspended.html, which
 * answered 200. A 200 "unavailable" page is a page Google will index AS the
 * homepage, and a business that comes back a week later finds its rankings
 * gone. 503 with Retry-After is the documented "temporarily down, come back"
 * signal: crawlers keep the existing index entry and simply return later.
 *
 * WHY THE NOTICE SAYS NOTHING ABOUT MONEY
 *
 * Every visitor sees this page — customers, partners, competitors. The old
 * page told all of them the owner had not paid. The owner learns the real
 * reason by email and through the link at the bottom, which is discreet on
 * purpose.
 */

export const config = {
  // Static assets are skipped so a gated site does not burn an edge invocation
  // per image, and so an un-gated site pays nothing for this file existing.
  matcher: "/((?!api/|css/|js/|img/|scripts/|assets/|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
};

const NOTICE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Excellence Agency — site temporairement indisponible</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: grid; place-items: center;
    padding: 24px;
    background: #0f172a;
    color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    text-align: center;
  }
  .card { max-width: 480px; }
  .mark {
    font-size: 13px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase;
    color: #f59e0b; margin: 0 0 22px;
  }
  h1 { font-size: 26px; line-height: 1.25; font-weight: 800; margin: 0 0 14px; color: #fff; }
  p { font-size: 16px; line-height: 1.65; color: #cbd5e1; margin: 0 0 12px; }
  .en { font-size: 15px; color: #94a3b8; margin-top: 22px; padding-top: 22px; border-top: 1px solid rgba(203,213,225,.18); }
  .owner { margin-top: 30px; font-size: 12.5px; color: #64748b; }
  .owner a { color: #94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <p class="mark">Excellence Agency</p>
    <h1>Site temporairement indisponible</h1>
    <p>Nous procédons à une mise à jour. Merci de réessayer dans un moment — vos demandes et vos échanges en cours ne sont pas affectés.</p>
    <div class="en">
      <p>This site is temporarily unavailable while we carry out an update. Please check back shortly.</p>
    </div>
    <p class="owner">Propriétaire du site ? <a href="https://servolia.com/hosting?ref=excellenceagency">Gérer l'hébergement</a></p>
  </div>
</body>
</html>`;

export default function middleware() {
  if (!suspended) return;

  return new Response(NOTICE, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // A day, so a crawler backs off without treating the site as gone.
      "retry-after": "86400",
      // Never let a CDN or browser cache the notice: the moment payment
      // clears, the very next request must get the real site back.
      "cache-control": "no-store, must-revalidate",
    },
  });
}
