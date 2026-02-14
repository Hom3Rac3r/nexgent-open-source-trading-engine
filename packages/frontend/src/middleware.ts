/**
 * Next.js Middleware
 *
 * Handles route protection, authentication checks, and security headers.
 * Redirects unauthenticated users to login page without callbackUrl.
 * Registration is disabled — /register redirects to /login at the page level.
 */

import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Security headers applied to every response. */
const securityHeaders: Record<string, string> = {
  // Prevent the page from being embedded in iframes (clickjacking protection)
  'X-Frame-Options': 'DENY',
  // Block MIME-type sniffing
  'X-Content-Type-Options': 'nosniff',
  // Enforce HTTPS for 1 year including subdomains
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  // Control what information is sent in the Referer header
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Restrict browser features the app doesn't need
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  // Prevent XSS in older browsers (modern browsers use CSP instead)
  'X-XSS-Protection': '1; mode=block',
  // Basic CSP — tighten further once you audit third-party scripts
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' wss: ws: https:; frame-ancestors 'none';",
};

/**
 * Applies security headers to a NextResponse.
 *
 * @param response - The NextResponse to augment
 * @returns The same response with security headers set
 */
function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes to pass through (with security headers)
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname === '/'
  ) {
    return applySecurityHeaders(NextResponse.next());
  }

  // Check for authentication token
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // If no token, redirect to login without callbackUrl
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.delete('callbackUrl');
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  // User is authenticated, allow request to proceed
  return applySecurityHeaders(NextResponse.next());
}

/**
 * Protected routes — routes that require authentication.
 *
 * Root path (/) is excluded so the page can handle its own redirect logic
 * without NextAuth appending callbackUrl.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/auth (NextAuth.js routes)
     * - api/health (healthcheck for Railway)
     * - login (login page)
     * - register (redirects to login)
     * - _next/static, _next/image (static assets)
     * - favicon.ico, public images
     */
    '/((?!api/auth|api/health|login|register|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

