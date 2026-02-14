/**
 * Auth Feature Module
 * 
 * This module exports all authentication-related components, hooks, and types.
 * Registration is disabled — the admin account is seeded from env vars on first boot.
 * 
 * @module features/auth
 */

// Components
export { Login } from './components/login';
export { LoginForm } from './components/login-form';
export { FormError } from './components/form-error';

// Hooks
export { useLogin } from './hooks/use-login';

// Types
export type {
  AuthFormProps,
  FormErrorProps,
  UseLoginReturn,
} from './types/auth.types';

// Re-export form value types from components
export type { LoginFormValues } from './components/login-form';
