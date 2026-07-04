import { ValidationError } from '../../shared/errors/AppError.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Unlike the leads validator, this one throws directly instead of returning
 * `{ errors, data }`. Registration only has a single caller and a single
 * failure mode (reject the whole request), so throwing keeps the
 * controller a one-liner. See leads.validator.js for the contrasting case
 * (bulk import needs to collect per-row errors instead of failing fast).
 */
export function validateRegisterInput({ email, password, name, company_name } = {}) {
  const errors = [];

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.push('A valid email is required');
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('Name must be at least 2 characters');
  }

  if (!company_name || typeof company_name !== 'string' || company_name.trim().length < 2) {
    errors.push('Company name must be at least 2 characters');
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return {
    email: email.trim().toLowerCase(),
    password,
    name: name.trim(),
    companyName: company_name.trim(),
  };
}
