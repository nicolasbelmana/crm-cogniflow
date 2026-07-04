const COLUMN_ALIASES = {
  name: ['name', 'nombre'],
  email: ['email', 'correo'],
  company: ['company', 'empresa'],
  phone: ['phone', 'telefono'],
  chat_history: ['chat_history', 'historial', 'chat'],
};

function normalizeHeader(header) {
  return header.trim().toLowerCase();
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

export function previewCsv(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('El CSV debe tener encabezados y al menos una fila de datos.');
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const record = {};

    headers.forEach((header, index) => {
      record[header] = values[index]?.trim() ?? '';
    });

    const mapped = {};

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      for (const alias of aliases) {
        if (record[alias]) {
          mapped[field] = record[alias];
          break;
        }
      }
    }

    rows.push(mapped);
  }

  return rows;
}
