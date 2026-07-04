import { parse } from 'csv-parse/sync';
import { validateLeadInput } from '../leads.validator.js';
import { AppError } from '../../../shared/errors/AppError.js';

const COLUMN_ALIASES = {
  name: ['name', 'nombre', 'lead_name', 'lead name'],
  email: ['email', 'correo', 'mail'],
  company: ['company', 'empresa', 'organization', 'organizacion'],
  phone: ['phone', 'telefono', 'tel', 'mobile', 'celular'],
  chat_history: ['chat_history', 'historial', 'chat', 'messages', 'mensajes'],
};

function normalizeHeader(header) {
  return header.trim().toLowerCase();
}

function mapRecordColumns(record) {
  const normalized = {};

  for (const [key, value] of Object.entries(record)) {
    normalized[normalizeHeader(key)] = value?.trim?.() ?? value;
  }

  const mapped = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      if (normalized[alias] !== undefined && normalized[alias] !== '') {
        mapped[field] = normalized[alias];
        break;
      }
    }
  }

  return mapped;
}

export function parseLeadsCsv(csvText) {
  if (!csvText || typeof csvText !== 'string' || !csvText.trim()) {
    throw new AppError('CSV content is required', 400);
  }

  let records;

  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch {
    throw new AppError('Invalid CSV format', 400);
  }

  if (records.length === 0) {
    throw new AppError('CSV file is empty', 400);
  }

  const validLeads = [];
  const errors = [];

  records.forEach((record, index) => {
    const mapped = mapRecordColumns(record);
    const { errors: rowErrors, data } = validateLeadInput(
      { ...mapped, source: 'csv' },
      { partial: false }
    );

    if (rowErrors.length > 0) {
      errors.push({ row: index + 2, errors: rowErrors, data: mapped });
      return;
    }

    validLeads.push(data);
  });

  return { leads: validLeads, errors };
}
