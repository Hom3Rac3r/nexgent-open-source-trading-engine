/**
 * Authentication API routes
 * 
 * Main router that mounts all authentication endpoints.
 * Registration is disabled — the admin account is seeded from
 * ADMIN_EMAIL / ADMIN_PASSWORD environment variables on first boot.
 */

import { Router } from 'express';
import { authenticate } from '@/middleware/auth.js';
import { validate } from '@/middleware/validation.js';
import { rateLimiter } from '@/middleware/rate-limiter.js';
import { LoginSchema, RefreshTokenSchema } from '@nexgent/shared';
import { login } from './handlers/login.js';
import { refresh, logout } from './handlers/tokens.js';
import { me } from './handlers/me.js';

const router = Router();

// Rate limiters for auth endpoints (per IP)
const loginRateLimiter = rateLimiter(5, 60 * 1000, 'Too many login attempts. Please try again later.');
const refreshRateLimiter = rateLimiter(10, 60 * 1000, 'Too many token refresh attempts. Please try again later.');

// Public endpoints (rate limited)
// Note: Registration is disabled. Account is created via ADMIN_EMAIL/ADMIN_PASSWORD env vars on startup.
router.post('/login', loginRateLimiter, validate(LoginSchema), login);
router.post('/refresh', refreshRateLimiter, validate(RefreshTokenSchema), refresh);

// Protected endpoints (require authentication)
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);

export default router;
