/**
 * Admin account seeder & sync
 *
 * Ensures the admin account always matches the ADMIN_EMAIL and
 * ADMIN_PASSWORD environment variables.
 *
 * - First boot (no users): creates the admin account.
 * - Subsequent boots: syncs email/password if the env vars changed.
 *
 * This replaces open registration — the application is designed for
 * single-user (self-hosted) deployments where the operator provides
 * credentials via environment variables.
 */

import { prisma } from './client.js';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from '@/shared/utils/auth/password.js';

/**
 * Validates ADMIN_EMAIL and ADMIN_PASSWORD env vars and returns them.
 *
 * @throws Error if env vars are missing or invalid
 * @returns Validated email and password
 */
function getValidatedAdminCredentials(): { email: string; password: string } {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required. ' +
        'Set these so the admin account can be created (or updated) on startup.'
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error(`ADMIN_EMAIL "${email}" is not a valid email address.`);
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    throw new Error(
      'ADMIN_PASSWORD does not meet strength requirements: ' +
        strength.errors.join('; ')
    );
  }

  return { email, password };
}

/**
 * Seeds or syncs the admin account on every startup.
 *
 * 1. If a user with the ADMIN_EMAIL already exists — sync the password.
 * 2. If a different user exists (email changed) — update that user.
 * 3. If no users exist at all — create the admin account.
 *
 * @throws Error if env vars are missing/invalid
 */
export async function seedAdminAccount(): Promise<void> {
  const { email, password } = getValidatedAdminCredentials();

  // ── Case 1: A user with this email already exists ──────────────────
  const existingByEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  if (existingByEmail) {
    const passwordMatch = existingByEmail.passwordHash
      ? await verifyPassword(password, existingByEmail.passwordHash)
      : false;

    if (!passwordMatch) {
      await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { passwordHash: await hashPassword(password) },
      });
      console.log('✅ Admin account password updated');
    }

    return;
  }

  // ── Case 2: A user exists but with a different email (email changed) ──
  const firstUser = await prisma.user.findFirst({
    select: { id: true },
  });

  if (firstUser) {
    await prisma.user.update({
      where: { id: firstUser.id },
      data: {
        email,
        passwordHash: await hashPassword(password),
      },
    });
    console.log(`✅ Admin account updated to ${email}`);
    return;
  }

  // ── Case 3: No users at all — first boot ──────────────────────────
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
    },
  });

  console.log(`✅ Admin account created for ${email}`);
}
