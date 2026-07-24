# Plan de Optimización de Costos — API de Claude (Anthropic)

**Fecha:** 18 de julio de 2026
**Contexto:** Optimizar el consumo/costo de la API de Claude usada en el módulo `classifications` del backend, sin cambiar el modelo actual.

Archivos principales involucrados:
- `backend/src/shared/ai/anthropicClassifierClient.js`
- `backend/src/modules/classifications/classifications.prompt.js`
- `backend/src/modules/classifications/classifications.service.js`
- `backend/src/modules/classifications/classifications.validator.js`
- `backend/src/modules/classifications/classifications.repository.js`
- `backend/src/modules/classifications/classifications.controller.js`
- `backend/src/modules/classifications/classifications.routes.js`
- `backend/migrations/`

---

## 1. Prompt caching (system + tool)

En `anthropicClassifierClient.js`, convertir el `system` de string plano a un array de bloques con `cache_control: { type: 'ephemeral' }`, y agregar `cache_control` al `CLASSIFY_TOOL` (o al último tool si hay varios).

- Verificar que la versión del SDK `@anthropic-ai/sdk` soporta `cache_control` y que el header/beta necesario esté activo si aplica.
- Validar en logs (`response.usage.cache_creation_input_tokens` / `cache_read_input_tokens`) que el cache se está usando en llamadas subsecuentes dentro de la ventana de 5 minutos, especialmente durante `classifyBatch`.

**Estado:** Hecho

---

## 2. Reducir `max_tokens` y campo `reasoning`

Bajar `max_tokens` de 300 a un valor ajustado (ej. 150-180) acorde al `maxLength: 200` de `reasoning`.

- Evaluar en `classifications.validator.js` / `classifications.prompt.js` si `reasoning` puede acortarse (ej. `maxLength: 120`) o hacerse opcional para casos donde no se muestra en el frontend.
- Confirmar que `classifications.controller.js` / frontend (`ClassificationBadge.jsx`) no dependan de un `reasoning` largo.

**Estado:** Hecho

---

## 3. Comprimir más el `userPrompt`

En `classifications.prompt.js`, reducir `summarizeChatHistory` de 3 a 2 mensajes y truncar cada `entry` a ~80 caracteres (`entry.slice(0, 80)`).

- Revisar abreviar palabras del template (ej. "msjs" en vez de "mensajes") sin perder claridad para el modelo.
- Medir longitud promedio de `userPrompt` antes/después.

**Estado:** Hecho

---

## 4. Batching real de leads por request

Diseñar variante de `classifyBatch` en `classifications.service.js` que agrupe N leads (ej. 5-10) en un solo prompt/tool call, definiendo un nuevo tool schema tipo `classify_leads` que reciba un array de resultados.

- Actualizar `aiClassifierClient.classify` (o crear `classifyMany`) para aceptar múltiples leads y parsear un array de outputs.
- Ajustar `classifications.validator.js` para validar cada item del array.
- Mantener el modo 1-a-1 como fallback si el batch falla parcialmente.

**Implementación:**
- `leads.repository.js`: nuevo `findByIdsForUser(ids, userId)` para traer todos los leads de un grupo en una sola query.
- `classifications.prompt.js`: nuevo `buildBatchClassificationPrompt(leads)` que arma un único `userPrompt` listando cada lead con su `id`.
- `anthropicClassifierClient.js`: nuevo tool `classify_leads` (array de `{ leadId, temperature, confidence, reasoning }`, con `cache_control`) y nuevo método `classifyMany({ systemPrompt, userPrompt, batchSize })` con `max_tokens` escalado por tamaño de grupo.
- `classifications.validator.js`: nuevo `parseClassifierBatchOutput(parsedInput, expectedLeadIds)` que valida que la respuesta tenga exactamente un item por `leadId` esperado (sin duplicados ni ids inventados).
- `classifications.service.js`: `classifyBatch` ahora agrupa `leadIds` en chunks de `BATCH_GROUP_SIZE = 5` y resuelve cada chunk con una sola llamada (`classifyGroup`); si el batch falla (error del proveedor u output inválido), cae automáticamente al modo 1-a-1 (`classifyOne`) solo para ese chunk. El costo total en tokens del request se reparte en partes iguales entre los leads del grupo al persistir (`tokensUsed`).

**Estado:** Hecho

---

## 5. Evitar reclasificaciones redundantes

Agregar columna `prompt_hash` (o similar) en la tabla `classifications` (nueva migración `004_*.sql`).

- En `classifications.service.js`, antes de llamar a la IA, calcular un hash (ej. `sha256`) del `userPrompt` generado y compararlo contra el último registro guardado para ese `leadId` en `classifications.repository.js`; si coincide, devolver la clasificación existente sin llamar a la API.
- Exponer opción para forzar reclasificación (ej. query param `force=true`) en `classifications.controller.js` / `classifications.routes.js`.

**Implementación:**
- `backend/migrations/004_add_prompt_hash_to_classifications.sql`: agrega `prompt_hash VARCHAR(64)` a `classifications` + índice `(lead_id, created_at DESC, prompt_hash)`.
- `classifications.prompt.js`: nuevo `hashClassificationPrompt(userPrompt)` (sha256 hex) usado como fingerprint determinístico del prompt de un lead.
- `classifications.repository.js`: `create` ahora persiste `promptHash`; nuevo `findLatestByLeadId(leadId, userId)` para traer la clasificación más reciente de un lead.
- `classifications.service.js`: `classifyOne(userId, leadId, { force })` calcula el hash del `userPrompt`, y si no es `force` y coincide con el `prompt_hash` de la última clasificación guardada, devuelve esa fila sin llamar a Anthropic. `classifyGroup` aplica la misma lógica por lead antes de armar el batch (separando leads "reusables" de los que sí necesitan clasificarse) y `classifyBatch(userId, leadIds, { force })` propaga la opción `force` a ambos.
- `classifications.controller.js`: `classifySingle` y `classifyBatch` leen `force=true` desde `req.query` y lo pasan al service.

**Estado:** Hecho

---

## 6. Monitoreo de costos por uso de tokens

Usando los campos ya guardados (`tokensUsed`, `modelUsed`) en `classifications.repository.js`, agregar una consulta/reporte (ej. endpoint o script) que agregue tokens por usuario/lead/día.

- Definir umbral simple (ej. alerta si un lead se reclasifica más de X veces/día) y aplicar límite en `classifications.service.js` antes de llamar a la IA.

**Implementación:**
- `classifications.repository.js`: nuevos `getUsageTotals(userId, since)`, `getUsageByDay(userId, since)` y `getUsageByLead(userId, since)` (agregan `tokens_used`/cantidad de clasificaciones agrupando por día o por `lead_id`); nuevo `countByLeadIdSince(leadId, userId, since)` para el chequeo de límite.
- `classifications.service.js`: `MAX_RECLASSIFICATIONS_PER_DAY = 5` — `assertReclassificationLimit` corta con `AppError(429)` antes de llamar a la IA (tanto en `classifyOne` como por cada lead en `classifyGroup`) si un lead ya superó el umbral en las últimas 24h; `force=true` no lo saltea (solo evita el corto-circuito por `prompt_hash`), por lo que el límite sigue aplicando incluso forzando reclasificación. Nuevo `getUsageReport(userId, { days = 30 })` que devuelve `totals`, `byDay` y `byLead`.
- `classifications.controller.js`: nuevo `usageReport` que lee `days` de `req.query` (default 30) y expone el reporte.
- `classifications.routes.js`: nuevo `GET /classifications/usage` (declarado antes de `/:leadId` para no ser interceptado por esa ruta).

**Estado:** Hecho

---

## 7. Validar y medir impacto

Después de aplicar los cambios anteriores, comparar `tokensUsed` promedio por clasificación antes/después (usando los datos guardados en la tabla `classifications`) para confirmar la reducción de costo real, y ajustar parámetros (tamaño de batch, longitud de truncado, etc.) según resultados.

**Implementación:**
- `backend/src/shared/database/measureTokenImpact.js`: script standalone (no depende del servidor HTTP) que consulta directamente la tabla `classifications` y compara `tokens_used` promedio/total antes y después de una fecha de corte (`--since=YYYY-MM-DD`, default: hoy), opcionalmente filtrado por `--user=<userId>`. No requiere columnas nuevas: el corte se hace por `created_at`, comparando contra la fecha en que se desplegaron las optimizaciones 1-6.
- `backend/package.json`: nuevo script `npm run measure:token-impact -- --since=2026-07-18` para ejecutarlo desde CLI.
- Próximo paso manual: correr el script contra los datos reales una vez haya suficiente volumen "después" del corte, y con ese resultado decidir si ajustar `BATCH_GROUP_SIZE`, el truncado del `userPrompt` (opción 3) u otros parámetros.

**Estado:** Hecho

---

## Prioridad sugerida

1. Prompt caching (system + tool)
2. Reducir `max_tokens` y campo `reasoning`
3. Comprimir más el `userPrompt`
4. Batching real de leads por request
5. Evitar reclasificaciones redundantes
6. Monitoreo de costos por uso de tokens
7. Validar y medir impacto

> Nota: se descarta explícitamente el cambio de modelo como opción de optimización, ya que se decidió mantener el modelo actual.
