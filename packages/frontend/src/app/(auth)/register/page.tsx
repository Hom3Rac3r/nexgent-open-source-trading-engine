/**
 * Register page (disabled)
 *
 * Registration is disabled — the admin account is created from
 * ADMIN_EMAIL / ADMIN_PASSWORD environment variables on first boot.
 * Visiting /register redirects to /login.
 */

import { redirect } from 'next/navigation';

export default function RegisterPage() {
  redirect('/login');
}
