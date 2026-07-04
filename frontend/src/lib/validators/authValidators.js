/**
 * Pure validation rules for auth forms (Login/Register). No React, no
 * fetch, no side effects — just functions that take plain values and
 * return either `null` (valid) or a user-facing error string.
 *
 * Kept separate from the hooks (hooks/auth/*) so the rules can be unit
 * tested without rendering anything, and reused across Login and Register
 * without duplicating the regex/logic.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_REGEX.test(value.trim());
}

/**
 * @returns {string|null} error message, or null when valid.
 */
export function validateLoginInput({ email, password }) {
  if (!isValidEmail(email)) {
    return 'Ingresá un email válido.';
  }

  if (!password) {
    return 'La contraseña es obligatoria.';
  }

  return null;
}
