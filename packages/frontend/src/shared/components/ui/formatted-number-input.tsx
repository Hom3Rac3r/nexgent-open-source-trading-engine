'use client';

import { useState, useEffect } from 'react';
import type React from 'react';
import { Input } from './input';

/** Format a number with comma thousands separators (e.g. 100000 → "100,000"). */
function formatWithCommas(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Strip non-digits and parse; empty string returns undefined. */
function parseFormattedNumber(input: string): number | undefined {
  const digits = input.replace(/\D/g, '');
  if (digits === '') return undefined;
  const n = Number(digits);
  return Number.isNaN(n) ? undefined : n;
}

export interface FormattedNumberInputProps {
  /** Current numeric value (undefined = empty). */
  value: number | undefined;
  /** Called with the parsed number, or undefined when cleared. */
  onChange: (n: number | undefined) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Number input that shows comma-formatted value when blurred and raw digits
 * when focused.  Form state holds the actual number; display is derived.
 *
 * Designed for large positive integers (e.g. market cap, liquidity).
 * For general decimal inputs use `NumericInput`.
 */
export function FormattedNumberInput({
  value,
  onChange,
  placeholder,
  className,
}: FormattedNumberInputProps) {
  const [focused, setFocused] = useState(false);
  const [rawDisplay, setRawDisplay] = useState(() =>
    value != null ? String(value) : '',
  );

  useEffect(() => {
    if (!focused) {
      setRawDisplay(value != null ? String(value) : '');
    }
  }, [focused, value]);

  const displayValue = focused
    ? rawDisplay
    : value != null
      ? formatWithCommas(value)
      : '';

  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      className={className}
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        setRawDisplay(value != null ? String(value) : '');
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const nextStr = e.target.value.replace(/\D/g, '');
        setRawDisplay(nextStr);
        onChange(parseFormattedNumber(e.target.value));
      }}
    />
  );
}

export interface NumericInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'value' | 'type'
  > {
  /** Current numeric value (undefined/null = empty). */
  value: number | undefined | null;
  /**
   * Called with the parsed number on every valid keystroke, or `undefined`
   * when the field is cleared or contains only an intermediate state (e.g. `-`).
   */
  onChange: (value: number | undefined) => void;
  /**
   * When set, if the field is left empty on blur, this value is emitted instead
   * of `undefined` so the field cannot be left blank.
   */
  fallbackValue?: number;
}

/**
 * Decimal number input that works correctly on mobile and avoids the
 * intermediate-state issues of `<input type="number">`.
 *
 * Uses `type="text"` with `inputMode="decimal"` so mobile browsers show a
 * numeric keypad while still allowing the minus sign and decimal point.
 * Raw string state is kept locally while the user is typing; only a parsed
 * number (or `undefined`) is propagated to the form.
 *
 * On blur the value is normalised: trailing punctuation is stripped. If the
 * field is empty or invalid, `undefined` is emitted (or `fallbackValue` when provided).
 */
export function NumericInput({
  value,
  onChange,
  fallbackValue,
  onFocus,
  onBlur,
  ...rest
}: NumericInputProps) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState(() => (value != null ? String(value) : ''));

  // Sync the display string when the external value changes (e.g. form reset or
  // agent switch) but NOT in response to a blur — that would race against our own
  // setRaw('') call in handleBlur and restore the old value before RHF has
  // committed the new one.
  useEffect(() => {
    if (!focused) {
      setRaw(value != null ? String(value) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(true);
    setRaw(value != null ? String(value) : '');
    onFocus?.(e);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const str = e.target.value;
    setRaw(str);

    // Allow mid-type intermediates ('-', '0.', '-0.') without clobbering the form.
    if (str === '' || str === '-') {
      onChange(undefined);
      return;
    }

    const n = parseFloat(str);
    if (!isNaN(n)) {
      onChange(n);
    }
    // Ignore anything else (e.g. stray letters) — leave form value unchanged.
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(false);
    const n = parseFloat(raw);

    if (!isNaN(n)) {
      // Normalise: remove trailing dot, collapse '-0' → '0', etc.
      onChange(n);
      setRaw(String(n));
    } else if (fallbackValue != null) {
      // Empty or invalid but fallback provided — restore default so field can't be left blank.
      onChange(fallbackValue);
      setRaw(String(fallbackValue));
    } else {
      // Empty or invalid — emit undefined and leave the field blank.
      onChange(undefined);
      setRaw('');
    }

    onBlur?.(e);
  }

  // Always render `raw` — never branch on the external `value` prop here.
  // If we used `value` when not focused, a delayed RHF commit would briefly
  // restore the old value and trigger the useEffect to re-overwrite `raw`.
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={raw}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
