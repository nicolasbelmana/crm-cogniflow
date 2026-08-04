# Carpeta de Campo — 2026-08-02

Proyecto: `crm-cogniflow`

## 1) Objetivo del día

Implementar y estabilizar optimizaciones de clasificación IA (costos/cache/uso), habilitar arquitectura multi-proveedor (Anthropic + Ollama), incorporar switch de proveedor en app, mejorar DX de errores y robustecer persistencia de resultados en frontend.

---

## 2) Resumen ejecutivo

Durante la jornada se avanzó desde optimizaciones del flujo existente hacia una arquitectura desacoplada por proveedor. Se incorporó cache-aside con métricas, control de cuota mensual, reporte de uso/costos, dashboard financiero, selector de proveedor en UI, manejo robusto de errores de sesión/proveedor y normalización de salidas de Ollama.

Resultado: backend y frontend quedan en estado funcional con validaciones automáticas en verde (tests/lint/build), y con trazabilidad de errores significativamente mejorada.

---

## 3) Cambios backend realizados

### 3.1 Configuración y entorno

- `backend/src/shared/config/index.js`
  - Se agregaron flags/config para IA y costos:
    - `AI_PROVIDER`
    - `ENABLE_CACHE`
    - `CACHE_TTL`
    - `MONTHLY_TOKEN_QUOTA`
    - `ENABLE_PROMPT_CACHE`
    - `OLLAMA_*` via módulo dedicado.

- `backend/src/shared/config/ollama.js` (nuevo)
  - Config central de Ollama.
  - `OLLAMA_MODEL` por defecto: `llama3.2:1b`.

- `backend/.env.example`
  - Nuevas variables de provider, cache y cuota.

### 3.2 Arquitectura IA (desacople por proveedor)

- `backend/src/shared/ai/providerClassifier.contract.js` (nuevo)
  - Firma común documental para clasificación compartida.

- `backend/src/shared/ai/providerFactory.js` (nuevo)
  - Registro de proveedores (`anthropic`, `ollama`).
  - Resolución de proveedor por nombre y default (`AI_PROVIDER`).
  - Gateway unificado (`createProviderClassifierGateway`) con interfaz común:
    - `classify(...)`
    - `classifyMany(...)`

- `backend/src/app.js`
  - Wiring actualizado para usar registry + gateway en lugar de cliente cloud directo.

### 3.3 Cliente Anthropic

- `backend/src/shared/ai/anthropicClassifierClient.js`
  - Prompt cache opcional (`ENABLE_PROMPT_CACHE`).
  - Logs de cache/time solo en dev.
  - Mensajes de error más explícitos:
    - auth inválida
    - rate limit
    - unavailable genérico como fallback.

### 3.4 Cliente Ollama

- `backend/src/shared/ai/ollamaClassifierClient.js` (nuevo)
  - Llamadas a `/api/chat` con timeout configurable.
  - Mensaje de error 404 con modelo/host explícitos.
  - Robustez de parseo:
    - extracción de JSON embebido
    - normalización de campos/sinónimos
    - normalización de `confidence` (0..100 → 0..1)
  - Uso de JSON schema para single/batch output.

### 3.5 Servicio de clasificaciones

- `backend/src/modules/classifications/classifications.controller.js`
  - Soporte de `provider` por request (body/query) para single/batch.

- `backend/src/modules/classifications/classifications.prompt.js`
  - Resumen de chat con `slice(-3)`.
  - Clave de cache SHA256 por modelo/prompt/lead.

- `backend/src/modules/classifications/classifications.service.js`
  - Integración con gateway provider-agnóstico.
  - Cache-aside con `responseCache`.
  - Reutilización por `prompt_hash`.
  - Límites de reclasificación diaria.
  - Costeo por input/output tokens.
  - Reporte de uso enriquecido (totales, cuota, cache, estadísticas).

- `backend/src/modules/classifications/classifications.repository.js`
  - Persistencia y agregaciones extendidas:
    - `input_tokens`
    - `output_tokens`
    - `estimated_cost_usd`
    - métricas por día/modelo y mes actual.

### 3.6 Migraciones y utilidades

- `backend/migrations/005_add_cost_and_token_breakdown.sql` (nuevo)
  - Alta de columnas de costos/tokens desglosados.

- `backend/src/shared/cache/responseCache.js` (nuevo)
  - Cache in-memory con TTL + estadísticas (`hit/miss/saved_*`).

- `backend/src/shared/config/modelPrices.js` (nuevo)
  - Tabla centralizada de pricing de modelos + cálculo de costos.

---

## 4) Cambios frontend realizados

### 4.1 Sesión y manejo de errores

- `frontend/src/lib/api.js`
  - Manejo robusto de errores HTTP (JSON y texto crudo).
  - Evento central de auth expirada y limpieza de sesión.
  - Se evita fallback opaco “Something went wrong…” cuando hay detalle útil.

- `frontend/src/hooks/useAuth.js`
  - Escucha evento de auth expirada.
  - Limpieza de token/user al expirar JWT.

- `frontend/src/App.jsx`, `frontend/src/components/layout/AppLayout.jsx`, `frontend/src/context/AuthContext.jsx`
  - Ajustes de imports/provider para consistencia y compatibilidad.

### 4.2 Clasificación en Leads

- `frontend/src/pages/Leads.jsx`
  - Selector de proveedor IA (`Anthropic` / `Ollama`).
  - Provider enviado a classify single/batch.
  - Persistencia de clasificaciones en `localStorage`.
  - Persistencia de provider seleccionado en `localStorage`.
  - Limpieza de clasificación local al eliminar lead.

### 4.3 Dashboard financiero

- `frontend/src/pages/Dashboard.jsx`
  - Visualización de uso de IA:
    - tokens/costos diarios y totales
    - cuota mensual
    - métricas de cache
    - tabla de consumo diario.

---

## 5) Testing, calidad y verificación

### Backend

- `backend/package.json`
  - Script `test` agregado (`node --test tests/**/*.test.js`).

- Tests agregados:
  - `backend/tests/classifications.service.test.js`
  - `backend/tests/modelPrices.test.js`
  - `backend/tests/responseCache.test.js`

- Resultado validado:
  - `PASS` tests backend (6/6).

### Frontend

- Resultado validado:
  - `PASS` lint (`oxlint`).
  - `PASS` build (`vite build`).

---

## 6) Incidencias reales encontradas y tratamiento

1. `jwt expired`
- Se corrigió limpieza de sesión y manejo de expiración en cliente.

2. Error DB por columna faltante (`input_tokens`)
- Se aplicó migración `005`.

3. `Ollama model not found`
- Diagnóstico por `ollama list`.
- Ajuste de modelo default a `llama3.2:1b`.
- Mensaje de error ahora informa modelo/host exactos.

4. `AI provider returned an invalid classification`
- Se robusteció parseo/normalización de salida Ollama y schema.

5. `Classification provider unavailable`
- Se mejoró especificidad para casos Anthropic (auth/rate-limit).

---

## 7) Estado al cierre

### Completado

- Capa de proveedores IA y gateway común.
- Configuración de Ollama por entorno.
- Selector de proveedor en frontend con persistencia.
- Cache-aside + métricas + costos + cuota + dashboard.
- Manejo de errores más claro para usuario final.
- Quality gates en verde.

### Pendiente técnico (continuidad)

- Consolidar documentación principal (`README`) con tabla final completa de provider-switch y uso operativo.
- Extender cobertura de tests para casos de selección explícita de provider/fallback y errores por proveedor.
- Opcional: sincronización de última clasificación desde backend al entrar a `Leads` (multi-dispositivo).

---

## 8) Archivos clave tocados (referencia rápida)

Backend:
- `backend/.env.example`
- `backend/src/app.js`
- `backend/src/shared/config/index.js`
- `backend/src/shared/config/ollama.js`
- `backend/src/shared/config/modelPrices.js`
- `backend/src/shared/ai/providerClassifier.contract.js`
- `backend/src/shared/ai/providerFactory.js`
- `backend/src/shared/ai/anthropicClassifierClient.js`
- `backend/src/shared/ai/ollamaClassifierClient.js`
- `backend/src/shared/cache/responseCache.js`
- `backend/src/modules/classifications/classifications.controller.js`
- `backend/src/modules/classifications/classifications.prompt.js`
- `backend/src/modules/classifications/classifications.repository.js`
- `backend/src/modules/classifications/classifications.service.js`
- `backend/migrations/005_add_cost_and_token_breakdown.sql`
- `backend/tests/*.test.js`

Frontend:
- `frontend/src/lib/api.js`
- `frontend/src/hooks/useAuth.js`
- `frontend/src/pages/Leads.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/App.jsx`
- `frontend/src/components/layout/AppLayout.jsx`
- `frontend/src/context/AuthContext.jsx`

Docs:
- `docs/SECURITY_CHECKLIST.md`
- `docs/CARPETA_DE_CAMPO_2026-08-02.md`

---

## 9) Cierre

Se completa una jornada de implementación y estabilización de alto impacto sobre el módulo IA de CogniFlow, dejando una base multi-proveedor operativa, trazable y con mejores garantías de costo/observabilidad para la siguiente iteración.
