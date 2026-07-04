import { AppError } from '../../shared/errors/AppError.js';

const LEAD_COLUMNS = `
  id, user_id, name, email, phone, company,
  chat_history, raw_data, source, created_at, updated_at
`;

const JSON_FIELDS = new Set(['chat_history', 'raw_data']);
const UPDATABLE_FIELDS = ['name', 'email', 'phone', 'company', 'chat_history', 'raw_data'];

/**
 * Only place in the codebase that knows the `leads` table's SQL. Receives
 * the `pool` as a parameter (instead of importing a singleton) so it can be
 * swapped for a fake/in-memory implementation in tests.
 */
export function createLeadsRepository(pool) {
  return {
    async findAllForUser(userId, { company } = {}) {
      const params = [userId];
      let query = `SELECT ${LEAD_COLUMNS} FROM leads WHERE user_id = $1`;

      if (company) {
        params.push(`%${company}%`);
        query += ` AND company ILIKE $${params.length}`;
      }

      query += ' ORDER BY created_at DESC';

      const result = await pool.query(query, params);
      return result.rows;
    },

    async findByIdForUser(id, userId) {
      const result = await pool.query(
        `SELECT ${LEAD_COLUMNS} FROM leads WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );

      return result.rows[0] ?? null;
    },

    async create(userId, lead) {
      const result = await pool.query(
        `INSERT INTO leads (user_id, name, email, phone, company, chat_history, raw_data, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${LEAD_COLUMNS}`,
        [
          userId,
          lead.name,
          lead.email,
          lead.phone ?? null,
          lead.company,
          JSON.stringify(lead.chat_history),
          JSON.stringify(lead.raw_data ?? {}),
          lead.source,
        ]
      );

      return result.rows[0];
    },

    async createMany(userId, leads) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const inserted = [];

        for (const lead of leads) {
          const result = await client.query(
            `INSERT INTO leads (user_id, name, email, phone, company, chat_history, raw_data, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING ${LEAD_COLUMNS}`,
            [
              userId,
              lead.name,
              lead.email,
              lead.phone ?? null,
              lead.company,
              JSON.stringify(lead.chat_history),
              JSON.stringify(lead.raw_data ?? {}),
              lead.source,
            ]
          );

          inserted.push(result.rows[0]);
        }

        await client.query('COMMIT');
        return inserted;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async updateForUser(id, userId, data) {
      const fields = [];
      const values = [];
      let paramIndex = 1;

      for (const key of UPDATABLE_FIELDS) {
        if (data[key] !== undefined) {
          fields.push(`${key} = $${paramIndex}`);
          values.push(JSON_FIELDS.has(key) ? JSON.stringify(data[key]) : data[key]);
          paramIndex += 1;
        }
      }

      if (fields.length === 0) {
        throw new AppError('No fields to update', 400);
      }

      fields.push('updated_at = NOW()');
      values.push(id, userId);

      const result = await pool.query(
        `UPDATE leads SET ${fields.join(', ')}
         WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
         RETURNING ${LEAD_COLUMNS}`,
        values
      );

      return result.rows[0] ?? null;
    },

    async deleteForUser(id, userId) {
      const result = await pool.query(
        'DELETE FROM leads WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );

      return result.rows[0]?.id ?? null;
    },
  };
}
