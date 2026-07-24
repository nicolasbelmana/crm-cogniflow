# Plan de implementación — Sistema de clasificación de leads (Semana 3)

> **Estado:** Plan aprobado, pendiente de ejecución. Bloqueado en Fase 1 hasta
> tener el valor real de `ANTHROPIC_API_KEY` en `backend/.env` (scaffolding
> de config y `.env.example` ya está listo, ver abajo).
>
> Sigue el mismo patrón arquitectónico documentado en `backend/ARCHITECTURE.md`
> (Controller → Service → Repository, composition root en `app.js`,
> `AppError` para errores). Si no leíste ese documento antes, hacelo primero.

## 0. Qué ya está hecho

| Archivo | Cambio |
|---|---|
| `backend/src/shared/config/index.js` | Agregado `config.ai.anthropicApiKey` y `config.ai.anthropicModel` (default `claude-3-5-haiku-latest`) |
| `backend/.env.example` | Agregado `ANTHROPIC_API_KEY=` y `ANTHROPIC_MODEL=claude-3-5-haiku-latest` |
| `backend/.env` | Mismas variables agregadas, **`ANTHROPIC_API_KEY` vacía** — completar con la key real |

## 1. Alcance de esta primera entrega ("sistema funcional")

Del spec técnico (`docs/cogniflow_spec_tecnico.md`, secciones 3, 4 y 7), lo
mínimo para un sistema de clasificación **funcional** es:

1. Poder clasificar **un lead puntual** por su `id` (`POST /classifications`).
2. Poder clasificar **varios leads de una vez** — todos los que aún no
   tengan clasificación, o una lista explícita de ids (`POST /classifications/batch`).
3. Guardar el resultado en una tabla `classifications` (persistente, con
   histórico — un lead puede reclasificarse más de una vez).
4. Poder consultar el historial de clasificaciones de un lead
   (`GET /classifications/:leadId`).
5. El prompt debe seguir la estrategia de **optimización de tokens** del
   spec (sección 5): resumir `chat_history` en vez de mandarlo completo.

**Fuera de alcance de esta primera entrega** (quedan para después, no
bloquean "funcional"):
- Elegir automáticamente entre OpenAI/Anthropic/Ollama según el escenario
  (spec sección 5) — por ahora **solo Anthropic**, como pediste.
- Tabla `api_logs` con costo agregado en USD y dashboard de gasto — se
  guarda `tokens_used`/`model_used` en `classifications` (ya cubre
  trazabilidad básica), el agregado de costos queda para una iteración
  posterior.
- Generación de mensajes personalizados (`message_templates`,
  `sent_messages`) — es el siguiente sistema de la Semana 3, no este.
- Feedback humano sobre la clasificación (`human_notes`) — posterior.

## 2. Modelo de datos — migración `003_create_classifications.sql`

```sql
CREATE TABLE IF NOT EXISTS classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  temperature VARCHAR(10) NOT NULL CHECK (temperature IN ('cold', 'warm', 'hot')),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasoning VARCHAR(300) NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  model_used VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classifications_lead_id ON classifications (lead_id);
CREATE INDEX IF NOT EXISTS idx_classifications_user_id ON classifications (user_id);
-- Acelera "traer la clasificación más reciente por lead" (usado en el
-- listado de leads / dashboard más adelante).
CREATE INDEX IF NOT EXISTS idx_classifications_lead_created
  ON classifications (lead_id, created_at DESC);
```

Notas de diseño:
- `temperature` como `VARCHAR` + `CHECK` en vez de un `ENUM` de Postgres:
  más fácil de migrar/extender después (agregar un valor no requiere
  `ALTER TYPE`), consistente con cómo ya se maneja `source` en `leads`.
- `user_id` está duplicado respecto a `leads.user_id` (denormalizado)
  a propósito: permite filtrar `WHERE user_id = $1` sin JOIN en queries
  de dashboard/listado, igual que hace `leads` con sus propios índices.
- No hay `UNIQUE(lead_id)`: **se permite reclasificar** un lead más de una
  vez (el historial es parte del valor del producto — ver notas de
  feedback del spec). "La clasificación vigente" de un lead es siempre la
  de `created_at` más reciente.

## 3. Nueva dependencia

```
backend/
  npm install @anthropic-ai/sdk
```

Es el único paquete nuevo. No se necesita nada más (ni siquiera para el
resumen de `chat_history`: es lógica simple de JS).

## 4. Arquitectura del módulo (mismo patrón que `auth`/`leads`)

```
backend/src/
  shared/
    ai/
      aiClassifierClient.js         (contrato/abstracción — nuevo)
      anthropicClassifierClient.js  (implementación concreta con Anthropic — nuevo)
  modules/
    classifications/
      classifications.repository.js  (SQL de la tabla classifications — nuevo)
      classifications.validator.js   (valida la respuesta parseada de la IA — nuevo)
      classifications.prompt.js      (arma system+user prompt optimizado — nuevo)
      classifications.service.js     (orquesta: lead -> prompt -> IA -> guardar — nuevo)
      classifications.controller.js  (HTTP <-> service — nuevo)
      classifications.routes.js      (Router — nuevo)
  app.js                              (wiring del nuevo módulo — editar)
```

### 4.1 `shared/ai/aiClassifierClient.js` (la abstracción)

Mismo principio que `passwordHasher`/`tokenService`: el **service** de
classifications depende de esta interfaz, no del SDK de Anthropic
directamente (Dependency Inversion — mañana se puede agregar un
`openAiClassifierClient.js` o un `ollamaClassifierClient.js` sin tocar el
service).

Contrato:
```js
/**
 * @typedef {Object} ClassifierResult
 * @property {string} rawText     - texto crudo devuelto por el modelo (para logging/debug)
 * @property {number} inputTokens
 * @property {number} outputTokens
 */

/**
 * @param {{ systemPrompt: string, userPrompt: string }} params
 * @returns {Promise<ClassifierResult>}
 */
async function classify({ systemPrompt, userPrompt }) { /* ... */ }
```

### 4.2 `shared/ai/anthropicClassifierClient.js` (implementación)

Usa el SDK oficial `@anthropic-ai/sdk`. Punto clave: en vez de simplemente
pedirle "respondé en JSON" en el prompt (frágil, Claude a veces agrega texto
alrededor), se usa **tool use forzado** (`tool_choice: { type: 'tool', name: 'classify_lead' }`),
que es el equivalente de Anthropic a los "Structured Outputs" que el spec
muestra para OpenAI (sección 7) — garantiza que la respuesta sea el JSON
exacto del schema, sin parseo frágil de texto libre.

Sketch:
```js
import Anthropic from '@anthropic-ai/sdk';

const CLASSIFY_TOOL = {
  name: 'classify_lead',
  description: 'Registra la clasificación de temperatura de venta de un lead.',
  input_schema: {
    type: 'object',
    properties: {
      temperature: { type: 'string', enum: ['cold', 'warm', 'hot'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string', maxLength: 200 },
    },
    required: ['temperature', 'confidence', 'reasoning'],
  },
};

export function createAnthropicClassifierClient({ apiKey, model }) {
  const client = new Anthropic({ apiKey });

  return {
    async classify({ systemPrompt, userPrompt }) {
      const response = await client.messages.create({
        model,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: 'classify_lead' },
      });

      const toolUse = response.content.find((block) => block.type === 'tool_use');

      return {
        rawText: JSON.stringify(toolUse?.input ?? {}),
        parsedInput: toolUse?.input ?? null, // ya viene como objeto, no como string
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
```

### 4.3 `modules/classifications/classifications.prompt.js`

Implementa la optimización de tokens del spec (sección 5): resume
`chat_history` (ya viene acotado a los últimos 5 mensajes por
`leads.validator.js`) a una sola línea compacta, en vez de mandar el JSON
completo.

```js
const SYSTEM_PROMPT = `Eres un experto en ventas. Clasificás leads por temperatura:
- cold: sin interés, primer contacto.
- warm: mostró interés, posible cliente.
- hot: listo para comprar, urgencia alta.
Sé breve y preciso.`;

function summarizeChatHistory(chatHistory) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
    return 'sin mensajes previos';
  }

  return chatHistory
    .slice(-3)
    .map((entry) => (typeof entry === 'string' ? entry : entry.text))
    .filter(Boolean)
    .join(' / ');
}

export function buildClassificationPrompt(lead) {
  const chatSummary = summarizeChatHistory(lead.chat_history);

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Lead: ${lead.name} | ${lead.company} | últimos mensajes: ${chatSummary}`,
  };
}
```

### 4.4 `modules/classifications/classifications.validator.js`

Defensa extra: aunque el tool use de Anthropic fuerza el schema, este
validador re-chequea el resultado parseado antes de guardarlo (nunca confiar
ciegamente en un proveedor externo — coherente con cómo ya validamos inputs
de HTTP en el resto del backend).

```js
import { AppError } from '../../shared/errors/AppError.js';

const VALID_TEMPERATURES = new Set(['cold', 'warm', 'hot']);

export function parseClassifierOutput(parsedInput) {
  if (!parsedInput || !VALID_TEMPERATURES.has(parsedInput.temperature)) {
    throw new AppError('AI provider returned an invalid classification', 502);
  }

  const confidence = Number(parsedInput.confidence);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    throw new AppError('AI provider returned an invalid confidence score', 502);
  }

  return {
    temperature: parsedInput.temperature,
    confidence,
    reasoning: String(parsedInput.reasoning ?? '').slice(0, 300),
  };
}
```

### 4.5 `modules/classifications/classifications.repository.js`

Mismo patrón que `leads.repository.js`: recibe `pool` por parámetro.

```js
export function createClassificationsRepository(pool) {
  return {
    async create({ leadId, userId, temperature, confidence, reasoning, tokensUsed, modelUsed }) {
      const result = await pool.query(
        `INSERT INTO classifications (lead_id, user_id, temperature, confidence, reasoning, tokens_used, model_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [leadId, userId, temperature, confidence, reasoning, tokensUsed, modelUsed]
      );
      return result.rows[0];
    },

    async findAllByLeadId(leadId, userId) {
      const result = await pool.query(
        `SELECT * FROM classifications WHERE lead_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
        [leadId, userId]
      );
      return result.rows;
    },
  };
}
```

### 4.6 `modules/classifications/classifications.service.js`

Orquesta todo. Depende de `leadsRepository` (ya existe, para leer el lead a
clasificar), `classificationsRepository` y `aiClassifierClient` — los tres
inyectados.

```js
import { NotFoundError } from '../../shared/errors/AppError.js';
import { buildClassificationPrompt } from './classifications.prompt.js';
import { parseClassifierOutput } from './classifications.validator.js';

export function createClassificationsService({
  leadsRepository,
  classificationsRepository,
  aiClassifierClient,
  model,
}) {
  async function classifyOne(userId, leadId) {
    const lead = await leadsRepository.findByIdForUser(leadId, userId);
    if (!lead) {
      throw new NotFoundError('Lead not found');
    }

    const { systemPrompt, userPrompt } = buildClassificationPrompt(lead);
    const result = await aiClassifierClient.classify({ systemPrompt, userPrompt });
    const parsed = parseClassifierOutput(result.parsedInput);

    return classificationsRepository.create({
      leadId,
      userId,
      ...parsed,
      tokensUsed: result.inputTokens + result.outputTokens,
      modelUsed: model,
    });
  }

  return {
    classifyOne,

    async classifyBatch(userId, leadIds) {
      const results = [];
      const errors = [];

      for (const leadId of leadIds) {
        try {
          results.push(await classifyOne(userId, leadId));
        } catch (error) {
          errors.push({ leadId, error: error.message });
        }
      }

      return { classified: results.length, failed: errors.length, results, errors };
    },

    async getHistory(userId, leadId) {
      return classificationsRepository.findAllByLeadId(leadId, userId);
    },
  };
}
```

*Nota:* `classifyBatch` procesa **secuencialmente** (no `Promise.all`) a
propósito: evita saturar el rate limit de la API de Anthropic si el usuario
manda 50+ leads de una. Se puede optimizar con un límite de concurrencia
(ej. 3 en paralelo) en una iteración futura si el volumen lo justifica.

### 4.7 `modules/classifications/classifications.controller.js`

```js
export function createClassificationsController({ classificationsService }) {
  return {
    async classifySingle(req, res) {
      const classification = await classificationsService.classifyOne(req.user.id, req.body.leadId);
      res.status(201).json({ classification });
    },

    async classifyBatch(req, res) {
      const result = await classificationsService.classifyBatch(req.user.id, req.body.leadIds);
      res.status(201).json(result);
    },

    async history(req, res) {
      const classifications = await classificationsService.getHistory(req.user.id, req.params.leadId);
      res.json({ classifications });
    },
  };
}
```

### 4.8 `modules/classifications/classifications.routes.js`

```js
import { Router } from 'express';
import { asyncHandler } from '../../shared/http/asyncHandler.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';

export function createClassificationsRouter(classificationsController) {
  const router = Router();
  router.use(requireAuth);

  router.post('/', asyncHandler(classificationsController.classifySingle));
  router.post('/batch', asyncHandler(classificationsController.classifyBatch));
  router.get('/:leadId', asyncHandler(classificationsController.history));

  return router;
}
```

### 4.9 Wiring en `app.js`

```js
import { createAnthropicClassifierClient } from './shared/ai/anthropicClassifierClient.js';
import { createClassificationsRepository } from './modules/classifications/classifications.repository.js';
import { createClassificationsService } from './modules/classifications/classifications.service.js';
import { createClassificationsController } from './modules/classifications/classifications.controller.js';
import { createClassificationsRouter } from './modules/classifications/classifications.routes.js';

// ...dentro de createApp():
const aiClassifierClient = createAnthropicClassifierClient({
  apiKey: config.ai.anthropicApiKey,
  model: config.ai.anthropicModel,
});
const classificationsRepository = createClassificationsRepository(pool);
const classificationsService = createClassificationsService({
  leadsRepository,
  classificationsRepository,
  aiClassifierClient,
  model: config.ai.anthropicModel,
});
const classificationsController = createClassificationsController({ classificationsService });

// ...junto a los otros app.use():
app.use('/classifications', createClassificationsRouter(classificationsController));
```

Si `config.ai.anthropicApiKey` no está seteada, se recomienda que
`createApp()` haga un chequeo temprano (similar al `if (!config.databaseUrl) throw` de `pool.js`) para fallar rápido y claro en vez de romper recién
cuando alguien intente clasificar.

## 5. Endpoints resultantes

| Método | Ruta | Body / Params | Descripción |
|---|---|---|---|
| `POST` | `/classifications` | `{ "leadId": "uuid" }` | Clasifica un lead puntual con Claude, guarda y devuelve el resultado |
| `POST` | `/classifications/batch` | `{ "leadIds": ["uuid", ...] }` | Clasifica varios leads en secuencia; devuelve resumen `{ classified, failed, results, errors }` |
| `GET` | `/classifications/:leadId` | — | Historial completo de clasificaciones de ese lead, más reciente primero |

Todos requieren `Authorization: Bearer <token>` (igual que `/leads`).

## 6. Manejo de errores (coherente con `AppError` existente)

| Situación | Status | Body |
|---|---|---|
| `leadId` no existe o no pertenece al usuario | 404 | `{ error: "Lead not found" }` |
| Anthropic devuelve algo fuera del schema esperado | 502 | `{ error: "AI provider returned an invalid classification" }` |
| Falla de red / rate limit / auth con Anthropic | 502 | `{ error: "Classification provider unavailable" }` (nunca se expone el error crudo del SDK al cliente; se loguea server-side vía el `errorHandler` existente) |
| `leadIds` vacío o no es array en batch | 400 | `{ error: "leadIds must be a non-empty array" }` |

## 7. Cómo probarlo una vez implementado (checklist manual)

1. `npm run db:migrate` (aplica la migración 003).
2. Reiniciar backend (recoge `ANTHROPIC_API_KEY`).
3. Crear o reusar un lead con `chat_history` (ej. desde `/leads/load`).
4. `POST /classifications` con ese `leadId` → verificar `temperature`,
   `confidence`, `reasoning` coherentes con el contenido del chat.
5. Repetir sobre el mismo lead → confirmar que **no** pisa el registro
   anterior sino que agrega una fila nueva (historial).
6. `GET /classifications/:leadId` → debe listar ambas clasificaciones,
   la más nueva primero.
7. `POST /classifications/batch` con una mezcla de `leadIds` válidos e
   inválidos → confirmar que los válidos se clasifican y los inválidos
   aparecen en `errors` sin frenar el resto del batch.
8. Probar con `ANTHROPIC_API_KEY` vacía/incorrecta → confirmar 502
   controlado, no un 500 crudo con stack trace de Anthropic.

## 8. Fuera de este documento (siguiente entrega de la Semana 3)

- `message_templates` + `sent_messages`: generación y envío de mensajes
  según la temperatura clasificada.
- Exponer en `GET /leads` la clasificación vigente de cada lead (columna
  `temperature` calculada) para pintarla en la tabla del frontend
  (`pages/Leads.jsx`) — requiere un `LEFT JOIN LATERAL` a la clasificación
  más reciente por lead, o un endpoint de resumen dedicado.
- Dashboard con conteo `X hot, Y warm, Z cold` y costo acumulado
  (requeriría la tabla `api_logs` del spec o agregar sobre `classifications.tokens_used`).
- Frontend: pantalla/acciones para disparar clasificación desde `Leads.jsx`
  (un botón "Clasificar" por fila + badge de temperatura), siguiendo el
  patrón de hooks ya establecido en `frontend/REFACTOR_PLAN.md`
  (ej. `hooks/leads/useClassifyLead.js`).
