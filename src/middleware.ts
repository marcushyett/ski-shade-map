import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Patterns for common bot probing paths that we want to block immediately
// These are typically WordPress, PHP, or other CMS-related paths that don't exist
const BLOCKED_PATHS = [
  // WordPress paths
  '/wp-admin',
  '/wp-content',
  '/wp-includes',
  '/wp-login.php',
  '/wp-config.php',
  '/xmlrpc.php',
  '/wordpress',
  // PHP probing
  '/admin.php',
  '/administrator',
  '/phpmyadmin',
  '/pma',
  // Other common probing
  '/.env',
  '/.git',
  '/config.php',
  '/install.php',
  '/setup.php',
  '/backup',
  '/db',
  '/sql',
];

// File extensions that indicate probing for vulnerable files
const BLOCKED_EXTENSIONS = ['.php', '.asp', '.aspx', '.jsp', '.cgi'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const lowerPath = pathname.toLowerCase();

  // Quick check for blocked paths (returns 404 immediately without hitting database)
  for (const blocked of BLOCKED_PATHS) {
    if (lowerPath.startsWith(blocked)) {
      return new NextResponse(null, { status: 404 });
    }
  }

  // Block requests for vulnerable file extensions (except legitimate API routes)
  if (!lowerPath.startsWith('/api/')) {
    for (const ext of BLOCKED_EXTENSIONS) {
      if (lowerPath.endsWith(ext)) {
        return new NextResponse(null, { status: 404 });
      }
    }
  }

  return NextResponse.next();
}

// Only run middleware on paths that might be probed
// This avoids running middleware on static assets and legitimate app routes
export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)',
  ],
};
