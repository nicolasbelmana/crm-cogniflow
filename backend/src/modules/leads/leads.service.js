import { ValidationError, NotFoundError, AppError } from '../../shared/errors/AppError.js';
import { validateLeadInput } from './leads.validator.js';
import { parseLeadsCsv } from './csv/csvParser.js';

/**
 * Lead use cases. Depends only on a leads repository injected by the
 * composition root (app.js) — no SQL and no HTTP concerns live here, which
 * makes every one of these methods trivially unit-testable with a fake
 * repository.
 */
export function createLeadsService({ leadsRepository }) {
  return {
    async listLeads(userId, { company } = {}) {
      const normalizedCompany =
        typeof company === 'string' && company.trim() ? company.trim() : undefined;
      const leads = await leadsRepository.findAllForUser(userId, { company: normalizedCompany });

      return { leads, total: leads.length };
    },

    async getLead(userId, leadId) {
      const lead = await leadsRepository.findByIdForUser(leadId, userId);

      if (!lead) {
        throw new NotFoundError('Lead not found');
      }

      return lead;
    },

    async createLead(userId, input) {
      const { errors, data } = validateLeadInput({ ...input, source: 'manual' });

      if (errors.length > 0) {
        throw new ValidationError(errors);
      }

      return leadsRepository.create(userId, data);
    },

    async importLeads(userId, { csv, leads: leadsPayload } = {}) {
      let leadsToInsert = [];
      let parseErrors = [];

      if (typeof csv === 'string' && csv.trim()) {
        const parsed = parseLeadsCsv(csv);
        leadsToInsert = parsed.leads;
        parseErrors = parsed.errors;
      } else if (Array.isArray(leadsPayload) && leadsPayload.length > 0) {
        leadsPayload.forEach((item, index) => {
          const { errors, data } = validateLeadInput({ ...item, source: 'csv' });

          if (errors.length > 0) {
            parseErrors.push({ row: index + 1, errors, data: item });
          } else {
            leadsToInsert.push(data);
          }
        });
      } else {
        throw new AppError('CSV content or leads array is required', 400);
      }

      if (leadsToInsert.length === 0) {
        throw new AppError('No valid leads to import', 400, { parseErrors });
      }

      const inserted = await leadsRepository.createMany(userId, leadsToInsert);

      return {
        leads: inserted,
        imported: inserted.length,
        skipped: parseErrors.length,
        parseErrors,
      };
    },

    async updateLead(userId, leadId, input) {
      const existing = await leadsRepository.findByIdForUser(leadId, userId);

      if (!existing) {
        throw new NotFoundError('Lead not found');
      }

      const { errors, data } = validateLeadInput(input, { partial: true });

      if (errors.length > 0) {
        throw new ValidationError(errors);
      }

      return leadsRepository.updateForUser(leadId, userId, data);
    },

    async deleteLead(userId, leadId) {
      const deletedId = await leadsRepository.deleteForUser(leadId, userId);

      if (!deletedId) {
        throw new NotFoundError('Lead not found');
      }

      return deletedId;
    },
  };
}
