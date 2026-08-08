import { suspended } from './site-status.js';

export const config = {
  matcher: ['/((?!api/|css/|js/|img/|scripts/|suspended\\.html|favicon\\.ico).*)'],
};

export default function middleware(request) {
  if (!suspended) return;
  const url = new URL(request.url);
  if (url.pathname === '/suspended.html') return;
  url.pathname = '/suspended.html';
  return Response.redirect(url, 302);
}
