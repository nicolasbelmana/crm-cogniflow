# Arquitectura del backend

Este documento explica **qué arquitectura usamos, por qué la elegimos, y cómo
se aplican los principios SOLID** en el código de `backend/src`. Es el
documento de referencia para cualquier feature nueva: si tenés dudas sobre
"¿esto dónde va?", la respuesta está acá.

## 1. Arquitectura elegida: Layered Architecture por módulos de dominio

Con Node.js + Express + PostgreSQL (sin framework tipo NestJS) la opción más
razonable — ni sub-diseñada (todo en el route handler, como estaba antes) ni
sobre-diseñada (Clean Architecture "pura" con entidades de dominio ricas,
casos de uso separados de DTOs, mappers everywhere) — es una
**arquitectura en capas (Controller → Service → Repository) organizada por
carpetas de feature/dominio** en vez de por tipo técnico.

```
backend/src/
  app.js                      # Composition root: arma express + inyecta dependencias
  server.js                   # Entry point: crea la app y hace listen()
  modules/
    auth/                     # Todo lo relacionado a autenticación vive junto
      auth.routes.js          # Express Router: verbo + path -> controller
      auth.controller.js      # HTTP <-> service (sin SQL, sin reglas de negocio)
      auth.service.js         # Casos de uso (register, issueToken)
      auth.repository.js      # Único lugar que conoce el SQL de `users`
      auth.strategies.js      # Configuración de passport (local + jwt)
      auth.validator.js       # Reglas de validación de entrada
      auth.mapper.js          # user (DB row) -> user público (sin password_hash)
    leads/                    # Todo lo relacionado a leads vive junto
      leads.routes.js
      leads.controller.js
      leads.service.js
      leads.repository.js     # Único lugar que conoce el SQL de `leads`
      leads.validator.js
      csv/
        csvParser.js          # Parsing + mapeo de columnas CSV -> lead
  shared/                     # Cross-cutting concerns, sin lógica de negocio
    config/index.js           # Lectura de variables de entorno
    database/
      pool.js                 # Pool de conexión pg (única instancia)
      migrate.js               # Runner de migraciones SQL
    errors/
      AppError.js              # Familia de errores de dominio (4xx/409/etc)
      errorHandler.js          # Middleware central que traduce error -> HTTP
    http/
      asyncHandler.js          # Evita try/catch repetido en controllers
    middleware/
      requireAuth.js           # Middleware de autenticación JWT
    security/
      passwordHasher.js        # Abstracción sobre bcrypt
      tokenService.js          # Abstracción sobre jsonwebtoken
```

### ¿Por qué por módulo de dominio y no por tipo técnico?

La estructura anterior (`routes/`, `middleware/`, `utils/`) es **"screaming
architecture" al revés**: al abrir el proyecto lo primero que ves son
detalles técnicos (Express, utils genéricos), no qué hace el negocio. Con
`modules/auth/` y `modules/leads/` pasa lo contrario: el folder grita
"leads" y "auth", que es lo que a un desarrollador nuevo le importa. Además,
cuando agreguemos `modules/deals/`, `modules/campaigns/`, etc. (roadmap del
CRM), cada feature nueva es una carpeta autocontenida — nada obliga a tocar
carpetas compartidas por todas las features (`routes/`, `utils/`) y generar
archivos gigantes con responsabilidades mezcladas, que es exactamente el
problema que tenías.

### El flujo de una request

```
HTTP request
   │
   ▼
routes.js        (¿qué verbo/path? nada más)
   │
   ▼
controller.js    (req/res <-> service; sin SQL, sin reglas de negocio)
   │
   ▼
service.js       (casos de uso, reglas de negocio, orquesta repos)
   │
   ▼
repository.js    (única capa que sabe SQL; recibe `pool` inyectado)
   │
   ▼
PostgreSQL
```

Los errores viajan al revés con un simple `throw`: cualquier capa lanza un
`AppError` (o subclase) y `shared/errors/errorHandler.js` —el único lugar
que arma la respuesta HTTP de error— decide el `status` y el JSON. Los
controllers nunca hacen `res.status(400).json(...)` para casos de error;
solo `throw`.

## 2. Cómo se aplica SOLID

| Principio | Antes | Ahora |
|---|---|---|
| **S — Single Responsibility** | `routes/leads.js` mezclaba HTTP, SQL, validación, CSV y transacciones en un solo archivo de 250 líneas. | Cada archivo tiene un solo motivo de cambio: `leads.controller.js` cambia si cambia la forma de responder HTTP; `leads.repository.js` cambia si cambia el modelo de datos; `leads.service.js` cambia si cambia una regla de negocio. |
| **O — Open/Closed** | Agregar un nuevo tipo de error significaba tocar cada route a mano (`res.status(...).json(...)` repetido). | Nuevos errores = nueva subclase de `AppError` (o `new AppError(msg, status, payload)`). `errorHandler.js` no se toca nunca. |
| **L — Liskov Substitution** | El route importaba `pool` (pg) directamente; imposible sustituirlo. | `createUserRepository(pool)` / `createLeadsRepository(pool)` reciben la conexión como parámetro. Cualquier objeto con `.query()`/`.connect()` compatible (por ejemplo un mock en un test) es sustituible sin tocar el service. |
| **I — Interface Segregation** | N/A (todo mezclado). | `passwordHasher` solo expone `hash`/`compare`; `tokenService` solo `sign`/`verify`. Nadie depende de más de lo que necesita. |
| **D — Dependency Inversion** | `passport.js` y las rutas importaban `bcrypt`, `jsonwebtoken` y `pool` como singletons globales dentro de la lógica de negocio. | `auth.service.js` / `auth.strategies.js` reciben `userRepository`, `passwordHasher` y `tokenService` **por parámetro**. Las implementaciones concretas (Postgres, bcryptjs, jsonwebtoken) solo se instancian una vez, en `app.js` (el *composition root*). |

### El "composition root" (`app.js`)

`app.js` es el **único** archivo que sabe que la base de datos es Postgres,
que el hashing es bcrypt y que los tokens son JWT firmados con
`jsonwebtoken`. Arma todas las piezas (`pool`, `passwordHasher`,
`tokenService`, repositorios, servicios, controllers, routers) y las
inyecta. Ningún otro archivo hace `import { pool } from ...` directamente
dentro de un service — reciben lo que necesitan como argumento de una
función factory (`createAuthService({ userRepository, passwordHasher,
tokenService })`).

Ventaja concreta: **testear un service ya no requiere Postgres real**. Por
ejemplo:

```js
const fakeRepo = {
  findByEmail: async () => ({ id: '1', email: 'a@a.com', password_hash: '...' }),
};
const authService = createAuthService({
  userRepository: fakeRepo,
  passwordHasher: { hash: async (p) => p, compare: async () => true },
  tokenService: { sign: () => 'fake-token' },
});
```

## 3. Convención de errores

Todo lo que no sea un bug de programación se modela como `AppError`
(`backend/src/shared/errors/AppError.js`):

| Clase | status | Uso |
|---|---|---|
| `ValidationError(details)` | 400 | Entrada inválida. Responde `{ error: 'Validation failed', details: [...] }`. |
| `UnauthorizedError(msg)` | 401 | Token ausente/inválido o credenciales incorrectas. |
| `NotFoundError(msg)` | 404 | Recurso no encontrado (o no pertenece al usuario). |
| `ConflictError(msg)` | 409 | Violación de unicidad (ej. email duplicado). |
| `AppError(msg, status, payload)` | el que definas | Casos puntuales (ej. `{ error: 'No valid leads to import', parseErrors }`). |

**Regla de oro:** un controller o service nunca arma la respuesta de error a
mano. Siempre `throw`. El único lugar que convierte una excepción en JSON +
status code es `shared/errors/errorHandler.js`.

## 4. Por qué el validador de `leads` no lanza excepción pero el de `auth` sí

Es una diferencia **intencional**, no una inconsistencia:

- `auth.validator.js` → `validateRegisterInput()` **lanza** `ValidationError`
  directamente. Solo hay un consumidor (registro) y una sola forma de
  fallar: rechazar toda la request.
- `leads.validator.js` → `validateLeadInput()` **retorna**
  `{ errors, data }` sin lanzar. Se reutiliza en dos contextos distintos:
  - Alta/edición individual → el caller (`leads.service.js`) lanza
    `ValidationError` si hay errores.
  - Importación CSV/bulk → el caller necesita **seguir procesando** el
    resto de las filas y acumular los errores por fila
    (`{ row, errors, data }`) en vez de abortar todo el batch.

Cuando un validador puede tener más de un "modo de falla" según quién lo
usa, conviene que sea una función pura que **devuelve** el resultado y que
decida el caller qué hacer. Cuando hay un solo consumidor y una sola forma
de fallar, lanzar la excepción ahí mismo es más simple y legible.

## 5. Cómo agregar una feature nueva (ej. `modules/deals/`)

1. Crear la carpeta `backend/src/modules/deals/`.
2. `deals.repository.js` — `export function createDealsRepository(pool) { ... }`
   con los métodos SQL necesarios (`findAllForUser`, `create`, etc).
3. `deals.validator.js` — reglas de validación de entrada (pura función,
   `{ errors, data }` o `throw`, según si tiene uno o varios consumidores).
4. `deals.service.js` — `export function createDealsService({ dealsRepository }) { ... }`
   con los casos de uso, lanzando `AppError`/`NotFoundError`/etc. cuando
   corresponda.
5. `deals.controller.js` — mapea `req`/`res` a llamadas del service. Sin SQL,
   sin validación ahí.
6. `deals.routes.js` — `Router()` con `asyncHandler` + `requireAuth` donde
   aplique.
7. Registrar en `app.js`: instanciar repo → service → controller → montar
   `app.use('/deals', createDealsRouter(dealsController))`.

Ningún archivo fuera de `modules/deals/` necesita tocarse (aparte de esas
~4 líneas en `app.js`), lo cual es justamente el **Open/Closed Principle**
en la práctica.

## 6. Qué se mantuvo igual a propósito

- **Passport** (local + JWT) se mantuvo porque ya es una dependencia
  estable del proyecto y no había razón funcional para sacarla; lo que
  cambió es *cómo* se configura (`auth.strategies.js` recibe sus
  dependencias por parámetro en vez de importar `pool`/`bcrypt` a nivel de
  módulo).
- **100% de paridad de contrato HTTP**: mismos endpoints, mismos status
  codes, mismos shapes de respuesta (`{ user, token }`, `{ leads, total }`,
  `{ error, details }`, etc.). El frontend (`frontend/src/lib/api.js`) no
  necesita ningún cambio. Se validó cada endpoint manualmente
  (success + error paths) contra el comportamiento anterior.
- Se agregó un `notFoundHandler` para rutas no existentes (antes devolvía
  el HTML default de Express; ahora `{ error: 'Route not found' }` en
  JSON), consistente con el resto de la API.

## 7. Próximos pasos sugeridos (no implementados todavía)

- **Tests unitarios** para `*.service.js` con repositorios fake (Node trae
  `node:test` nativo desde Node 18+, sin dependencias nuevas).
- **Tests de integración** para `app.js` con `supertest`, ahora posible sin
  levantar un puerto real gracias a que `createApp()` es una función pura.
- Si el dominio crece mucho (reglas de negocio complejas, invariantes
  ricas), evaluar migrar a TypeScript para que las "interfaces" informales
  de este documento (`userRepository`, `passwordHasher`, `tokenService`)
  sean contratos verificados por el compilador en vez de por convención.
