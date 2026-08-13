# CogniFlow Enterprise

Plataforma de automatización de ventas inteligente — Semanas 1-2: autenticación y leads.

## Stack

- **Frontend:** React + Vite + Tailwind + componentes estilo Shadcn/UI
- **Backend:** Node.js 20 + Express + Passport.js + JWT
- **DB:** PostgreSQL 15

## Requisitos

- Node.js 20+
- PostgreSQL 15+ corriendo localmente

## Setup

### 1. Base de datos

```sql
CREATE DATABASE cogniflow;
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

API en `http://localhost:3001`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App en `http://localhost:5173`

## Endpoints de auth

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/register` | Crear usuario |
| POST | `/auth/login` | Login con JWT |
| POST | `/auth/logout` | Logout (requiere Bearer token) |
| GET | `/auth/me` | Usuario autenticado |

### Ejemplo register

```json
{
  "email": "demo@cogniflow.com",
  "password": "password123",
  "name": "Demo User",
  "company_name": "CogniFlow"
}
```

### Ejemplo login

```json
{
  "email": "demo@cogniflow.com",
  "password": "password123"
}
```

Respuesta:

```json
{
  "user": { "id": "...", "email": "...", "name": "...", "company_name": "..." },
  "token": "eyJ..."
}
```

## Pantallas

- `/login` — Email + contraseña, validación básica
- `/register` — Registro con nombre, empresa, email y contraseña
- `/dashboard` — Resumen con total de leads y accesos rápidos
- `/leads` — Tabla de leads con filtro por empresa, editar y eliminar
- `/leads/load` — Carga manual o importación CSV con preview

## Endpoints de leads

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/leads?company=` | Listar leads del usuario (filtro opcional por empresa) |
| GET | `/leads/:id` | Obtener un lead |
| POST | `/leads` | Crear lead manual |
| POST | `/leads/bulk` | Importar CSV (`{ "csv": "..." }`) o array de leads |
| PUT | `/leads/:id` | Editar lead |
| DELETE | `/leads/:id` | Eliminar lead |

Todos requieren header `Authorization: Bearer <token>`.

### CSV de ejemplo

Ver `docs/sample-leads.csv`. Columnas soportadas: `name`, `email`, `company`, `phone`, `chat_history` (también aliases en español).

## Variables de entorno (backend)

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto del API (default: 3001) |
| `DATABASE_URL` | Connection string PostgreSQL |
| `JWT_SECRET` | Secreto para firmar tokens |
| `JWT_EXPIRES_IN` | Expiración del token (default: 7d) |
| `FRONTEND_URL` | Origen permitido por CORS |
| `AI_PROVIDER` | Provider por defecto (`anthropic`, `gemini` o `ollama`) |
| `ANTHROPIC_API_KEY` | API key de Anthropic para clasificaciones IA |
| `ANTHROPIC_MODEL` | Modelo Claude a usar (default: `claude-haiku-4-5`) |
| `GEMINI_API_KEY` | API key de Google Gemini (AI Studio) |
| `GEMINI_MODEL` | Modelo Gemini a usar (default: `gemini-2.5-flash`) |
| `GEMINI_TIMEOUT_MS` | Timeout de requests a Gemini en ms (default: `30000`) |
| `OLLAMA_BASE_URL` | URL base de Ollama local (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | Modelo local de Ollama (default: `llama3.2:1b`) |
| `OLLAMA_TIMEOUT_MS` | Timeout de requests a Ollama en ms (default: `30000`) |
| `ENABLE_CACHE` | Habilita/deshabilita cache de respuestas IA (`true`/`false`) |
| `CACHE_TTL` | TTL del cache en segundos (default: `86400`) |
| `MONTHLY_TOKEN_QUOTA` | Cuota mensual simulada de tokens por usuario (default: `10000`) |
| `ENABLE_PROMPT_CACHE` | Flag para control funcional de prompt cache (`true`/`false`) |

### Fallback automático de proveedor

- Si **no** se envía `provider` explícito en la request y el default es un provider cloud (`anthropic` o `gemini`), el backend intenta `ollama` automáticamente cuando el cloud falla por indisponibilidad/autenticación (`502/503/504`).
- Si se envía `provider` explícito (`anthropic`, `gemini` u `ollama`), **no** hay fallback: se respeta el proveedor pedido.
- Errores de rate limit (`429`) de providers cloud no hacen fallback automático.
