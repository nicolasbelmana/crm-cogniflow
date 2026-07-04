const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseChatHistory(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.slice(-5);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.slice(-5);
      }
    } catch {
      // Fall through to line-based parsing.
    }

    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-5)
      .map((text) => ({ role: 'client', text }));
  }

  return [];
}

/**
 * Pure validator: returns `{ errors, data }` instead of throwing, because it
 * is reused in two contexts that need different failure handling:
 *  - single create/update -> caller throws a ValidationError immediately.
 *  - CSV/bulk import -> caller collects per-row errors and keeps importing
 *    the rows that ARE valid instead of failing the whole batch.
 * See auth.validator.js for the contrasting "throw immediately" style.
 */
export function validateLeadInput(input, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || input.name !== undefined) {
    if (!input.name || typeof input.name !== 'string' || input.name.trim().length < 2) {
      errors.push('Name must be at least 2 characters');
    } else {
      data.name = input.name.trim();
    }
  }

  if (!partial || input.email !== undefined) {
    if (!input.email || typeof input.email !== 'string' || !EMAIL_REGEX.test(input.email.trim())) {
      errors.push('A valid email is required');
    } else {
      data.email = input.email.trim().toLowerCase();
    }
  }

  if (!partial || input.company !== undefined) {
    if (!input.company || typeof input.company !== 'string' || input.company.trim().length < 2) {
      errors.push('Company must be at least 2 characters');
    } else {
      data.company = input.company.trim();
    }
  }

  if (!partial || input.phone !== undefined) {
    if (input.phone === null || input.phone === '') {
      data.phone = null;
    } else if (typeof input.phone === 'string') {
      data.phone = input.phone.trim() || null;
    } else if (input.phone !== undefined) {
      errors.push('Phone must be a string');
    }
  }

  if (!partial || input.chat_history !== undefined) {
    data.chat_history = parseChatHistory(input.chat_history);
  }

  if (!partial || input.raw_data !== undefined) {
    data.raw_data =
      input.raw_data && typeof input.raw_data === 'object' && !Array.isArray(input.raw_data)
        ? input.raw_data
        : {};
  }

  if (!partial || input.source !== undefined) {
    const allowedSources = ['manual', 'csv', 'api'];
    if (input.source && allowedSources.includes(input.source)) {
      data.source = input.source;
    } else if (!partial) {
      data.source = 'manual';
    }
  }

  return { errors, data };
}
