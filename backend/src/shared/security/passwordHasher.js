import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

/**
 * Thin abstraction over the hashing library in use. Business logic (auth
 * service/strategies) depends on this contract (`hash`/`compare`) instead of
 * importing `bcryptjs` directly, so swapping algorithms later (e.g. argon2)
 * only touches this one file (Dependency Inversion + Open/Closed).
 */
export const passwordHasher = {
  hash(plainText) {
    return bcrypt.hash(plainText, SALT_ROUNDS);
  },
  compare(plainText, hash) {
    return bcrypt.compare(plainText, hash);
  },
};
