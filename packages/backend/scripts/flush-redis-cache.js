#!/usr/bin/env node
/**
 * Standalone Redis cache flush script.
 * Connects directly to Redis (no compiled backend needed) and clears all nexgent: keys.
 *
 * Usage:
 *   node scripts/flush-redis-cache.js
 */

import 'dotenv/config';
import Redis from 'ioredis';

const host = process.env.REDIS_HOST || process.env.REDISHOST || '127.0.0.1';
const port = parseInt(process.env.REDIS_PORT || process.env.REDISPORT || '6379', 10);
const password = process.env.REDIS_PASSWORD || process.env.REDISPASSWORD || undefined;
const prefix = process.env.REDIS_KEY_PREFIX || 'nexgent:';

async function main() {
  console.log(`Connecting to Redis at ${host}:${port} ...`);

  const client = new Redis({ host, port, password, lazyConnect: true });
  await client.connect();
  console.log('Connected.\n');

  // Find all keys with the prefix
  const keys = await client.keys(`${prefix}*`);
  console.log(`Found ${keys.length} key(s) with prefix "${prefix}"`);

  if (keys.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      await client.del(...batch);
    }
    console.log(`Deleted ${keys.length} key(s).`);
  }

  // Also clear non-prefixed keys used by the app
  const extras = ['active_agents'];
  for (const key of extras) {
    const existed = await client.del(key);
    if (existed) console.log(`Deleted key: ${key}`);
  }

  console.log('\nCache cleared. Restart the app and it will re-warm from the database.');

  await client.quit();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
