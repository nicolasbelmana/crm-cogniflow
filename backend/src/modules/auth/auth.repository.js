import { ConflictError } from '../../shared/errors/AppError.js';

const UNIQUE_VIOLATION = '23505';

/**
 * Only place in the codebase that knows the `users` table's SQL. Everything
 * above this layer (service, strategies) talks in terms of plain user
 * objects and never sees a query or a Postgres error code.
 *
 * Receives the `pool` as a parameter (instead of importing a singleton)
 * so it can be swapped for a fake/in-memory implementation in tests.
 */
export function createUserRepository(pool) {
  return {
    async create({ email, passwordHash, name, companyName }) {
      try {
        const result = await pool.query(
          `INSERT INTO users (email, password_hash, name, company_name)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, name, company_name, avatar_url, created_at, updated_at`,
          [email, passwordHash, name, companyName]
        );

        return result.rows[0];
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new ConflictError('Email already registered');
        }

        throw error;
      }
    },

    async findByEmail(email) {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      return result.rows[0] ?? null;
    },

    async findById(id) {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return result.rows[0] ?? null;
    },
  };
}
