/**
 * Opción 7 (docs/OPTIMIZACION_API_CLAUDE.md): "Validar y medir impacto".
 *
 * Compara `tokens_used` promedio por clasificación antes/después de una
 * fecha de corte (por defecto, la fecha en la que se aplicaron las
 * optimizaciones de prompt/batching/cache, ver frontmatter del doc:
 * 2026-07-18), usando exclusivamente los datos ya guardados en la tabla
 * `classifications`. No requiere una columna nueva: el corte se hace por
 * `created_at`.
 *
 * Uso:
 *   node src/shared/database/measureTokenImpact.js [--since=YYYY-MM-DD] [--user=<userId>]
 *
 * --since  Fecha de corte (ISO). Todo lo anterior se cuenta como "antes",
 *          todo lo posterior (inclusive) como "después". Default: hoy.
 * --user   Si se pasa, filtra por un `user_id` puntual. Default: todos.
 */
import { pool } from './pool.js';

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(raw);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'N/A';
}

async function fetchPeriodStats({ userId, from, to }) {
  const conditions = [];
  const params = [];

  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`created_at < $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT COUNT(*)::int AS classifications_count,
            COALESCE(SUM(tokens_used), 0)::int AS tokens_used_total,
            COALESCE(AVG(tokens_used), 0)::float AS tokens_used_avg,
            COUNT(*) FILTER (WHERE prompt_hash IS NOT NULL)::int AS with_prompt_hash_count
     FROM classifications
     ${whereClause}`,
    params
  );

  return result.rows[0];
}

async function measureImpact({ since, userId }) {
  const before = await fetchPeriodStats({ userId, from: null, to: since });
  const after = await fetchPeriodStats({ userId, from: since, to: null });

  const beforeAvg = before.tokens_used_avg;
  const afterAvg = after.tokens_used_avg;
  const reductionPct =
    beforeAvg > 0 ? ((beforeAvg - afterAvg) / beforeAvg) * 100 : null;

  return { since, userId: userId ?? 'ALL', before, after, reductionPct };
}

function printReport(report) {
  console.log('--- Reporte de impacto en tokens (opción 7) ---');
  console.log(`Fecha de corte (--since): ${report.since}`);
  console.log(`Usuario: ${report.userId}`);
  console.log('');
  console.log('ANTES:');
  console.log(`  Clasificaciones: ${report.before.classifications_count}`);
  console.log(`  Tokens totales:  ${report.before.tokens_used_total}`);
  console.log(`  Tokens promedio: ${formatNumber(report.before.tokens_used_avg)}`);
  console.log(`  Con prompt_hash: ${report.before.with_prompt_hash_count}`);
  console.log('');
  console.log('DESPUÉS:');
  console.log(`  Clasificaciones: ${report.after.classifications_count}`);
  console.log(`  Tokens totales:  ${report.after.tokens_used_total}`);
  console.log(`  Tokens promedio: ${formatNumber(report.after.tokens_used_avg)}`);
  console.log(`  Con prompt_hash: ${report.after.with_prompt_hash_count}`);
  console.log('');
  console.log(
    report.reductionPct === null
      ? 'Reducción de tokens promedio: N/A (sin datos "antes" para comparar)'
      : `Reducción de tokens promedio: ${formatNumber(report.reductionPct)}%`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = args.since ? new Date(args.since) : new Date();
  const userId = args.user ?? null;

  if (Number.isNaN(since.getTime())) {
    throw new Error(`--since inválido: ${args.since}`);
  }

  const report = await measureImpact({ since, userId });
  printReport(report);

  await pool.end();
}

main().catch((error) => {
  console.error('Error midiendo impacto de tokens:', error);
  process.exit(1);
});
