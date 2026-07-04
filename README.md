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
