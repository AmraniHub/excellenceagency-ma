import { suspended } from './site-status.js';

// Redirect every visitor-facing request to the payment notice while the site is
// suspended. Static assets and API routes are excluded so the notice page can
// still load its own styling and any existing integrations keep working.
// billing.json must stay reachable while suspended — suspended.html fetches it
// to render the amount owed. Redirecting it would leave the page with no figure.
export const config = {
  matcher: [
    '/((?!api/|css/|js/|img/|scripts/|assets/|suspended\\.html|billing\\.json|promo-config\\.json|favicon\\.ico).*)'
  ],
};

export default function middleware(request) {
  if (!suspended) return;
  const url = new URL(request.url);
  if (url.pathname === '/suspended.html') return;
  url.pathname = '/suspended.html';
  return Response.redirect(url, 302);
}
