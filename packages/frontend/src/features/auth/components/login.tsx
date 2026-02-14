'use client';

/**
 * Login component
 * 
 * Main login page component with email/password authentication.
 * Registration is disabled — the admin account is seeded from env vars.
 * 
 * @example
 * ```tsx
 * <Login />
 * ```
 */

import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { LoginForm } from './login-form';
import { config } from '@/shared/config/app.config';
import { theme } from '@/shared/config/theme.config';

/**
 * Login component
 * 
 * Displays the login page with:
 * - Brand logo
 * - Email/password login form
 * 
 * All styling uses theme variables for easy customization.
 * 
 * @returns Login page JSX
 */
export function Login() {
  return (
    <div
      className="flex min-h-[calc(100vh-2rem)] flex-col items-center justify-center py-12"
      style={{ backgroundColor: theme.colors.background.page }}
    >
      <Card
        className="w-full max-w-md py-8 text-white"
        style={{
          backgroundColor: theme.colors.background.card,
          color: theme.colors.text.primary,
        }}
      >
        <CardHeader className="space-y-4">
          <div className="flex justify-center mb-8">
            <Link
              href={config.urls.home}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity"
              aria-label="Visit Nexgent homepage"
            >
              <Image
                src="/Nexgent-Transparent-logo.png"
                alt="Nexgent Logo"
                width={200}
                height={200}
                className="h-14 w-auto"
                priority
              />
            </Link>
          </div>
          <CardTitle
            className="text-center"
            style={{ color: theme.colors.text.primary }}
          >
            Login to your account
          </CardTitle>
          <CardDescription
            className="text-center"
            style={{ color: theme.colors.text.secondary }}
          >
            Use the admin credentials you configured in your{' '}
            <code
              className="text-xs px-1 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
            >
              ADMIN_EMAIL
            </code>{' '}
            and{' '}
            <code
              className="text-xs px-1 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
            >
              ADMIN_PASSWORD
            </code>{' '}
            environment variables.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}

