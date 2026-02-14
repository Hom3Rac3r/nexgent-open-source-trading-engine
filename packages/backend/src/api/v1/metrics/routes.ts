/**
 * Metrics API routes
 *
 * Provides Prometheus metrics endpoint.
 * Protected behind JWT authentication to prevent leaking
 * agent IDs, token addresses, and trading activity patterns.
 */

import { Router } from 'express';
import { authenticate } from '@/middleware/auth.js';
import { getMetricsHandler } from './handlers/get.js';

const router = Router();

// Metrics endpoint (authentication required to prevent information leakage)
router.get('/', authenticate, getMetricsHandler);

export default router;

