# Bugs y mejoras — Clasificación de leads

**Fecha de apertura:** 18 de julio de 2026
**Contexto:** Al clasificar leads (individual o en batch), el frontend no refleja correctamente qué pasó con cada lead (clasificado, ya clasificado previamente, o fallido), y no existe una regla de UX para cuando un lead no cambió desde su última clasificación.

Archivos principales involucrados:
- `backend/src/modules/classifications/classifications.service.js`
- `backend/src/modules/classifications/classifications.controller.js`
- `backend/src/modules/classifications/classifications.routes.js`
- `frontend/src/pages/Leads.jsx`
- `frontend/src/lib/api.js`
- `frontend/src/components/ClassificationBadge.jsx`

---

## Bug reportado

Al clasificar un lead que ya alcanzó el límite diario de reclasificaciones (`MAX_RECLASSIFICATIONS_PER_DAY = 5`), la API responde correctamente con el error:

```json
{
  "classified": 0,
  "failed": 1,
  "results": [],
  "errors": [
    {
      "leadId": "b2cb7878-450c-4241-b27c-edaf18b02c50",
      "error": "Lead b2cb7878-450c-4241-b27c-edaf18b02c50 reached the daily reclassification limit (5/day). Use force=true to override."
    }
  ]
}
```

Pero en el frontend (`Leads.jsx`, `handleClassifySelected`) esto **no se ve reflejado por lead**: sólo se muestra un mensaje genérico (`No se pudieron clasificar N lead(s).`) sin indicar cuál lead falló ni por qué, y la fila de ese lead en la tabla se queda sin ningún indicador de error.

Además, cuando un lead se "clasifica" pero en realidad el backend reutilizó una clasificación existente (opción 5 de `OPTIMIZACION_API_CLAUDE.md`: mismo `prompt_hash`, no se llamó a la IA), el frontend no distingue ese caso de una clasificación nueva — el usuario no tiene forma de saber si el lead ya estaba clasificado o si se acaba de gastar una llamada a la API.

### Causa raíz

1. **`classifyBatch` (service) devuelve `errors` con `leadId` + `error`, pero `Leads.jsx` sólo lee `errors.length`** para armar un string genérico; nunca mapea cada error a su fila/lead en la tabla ni los usa para marcar visualmente el estado de esa fila.
2. **No hay forma de distinguir "reutilizado" de "clasificado ahora"** en la respuesta de la API: `classifyOne`, `classifyGroup` y `classifyBatch` devuelven la misma forma de objeto (`classification` / fila de `classifications`) sin un flag como `reused: true/false`. El frontend no puede mostrar "ya estaba clasificado" aunque la info exista implícitamente (mismo `prompt_hash`) en el backend.
3. **No existe confirmación de usuario cuando el lead no cambió**: actualmente, si el `prompt_hash` coincide, el backend devuelve silenciosamente la clasificación vieja (sin llamar a la IA) — esto es correcto para ahorrar costo, pero el usuario que aprieta "Clasificar" esperando un resultado nuevo no tiene forma de saber que no pasó nada nuevo, ni de pedir explícitamente una reclasificación.

---

## Plan de solución

### 1. Backend: exponer estado por resultado (`reused` / `limitReached`)

- `classifications.service.js`:
  - `classifyOne` debe devolver `{ classification, reused: boolean }` en lugar de la fila pelada, para que el caller sepa si fue cache-hit.
  - `classifyGroup` debe marcar cada resultado reutilizado (`reused: true`) vs. recién clasificado (`reused: false`) al armar el array que devuelve.
  - `classifyBatch` debe propagar ese flag en `results` (cada item ya trae `lead_id`; agregar `reused`).
- `classifications.controller.js`: `classifySingle` devuelve `{ classification, reused }`; `classifyBatch` ya no cambia de forma (sigue devolviendo `results`/`errors`), pero cada item de `results` ahora incluye `reused`.
- **Consideración de compatibilidad:** revisar que `classifications.repository.js#create` no se vea afectado; el flag `reused` se calcula en el service, no se persiste.

**Estado:** Completado

---

### 2. Backend: distinguir el error de límite diario del resto de errores

- En `classifyBatch`, cuando `classifyOne`/`classifyGroup` fallan por `AppError` de status `429` (límite diario), incluir en el error del array un campo `code: 'DAILY_LIMIT_REACHED'` (o similar) además del `message`, para que el frontend pueda diferenciar "hubo un error real" de "se alcanzó el límite" y mostrar un mensaje/acción distinta (ej. botón "Forzar" con `force=true`).
- Revisar `AppError` (`backend/src/shared/errors/AppError.js`) para ver si ya soporta un campo `code`/`type` opcional; si no, agregarlo sin romper el resto de usos.

**Estado:** Completado

---

### 3. Frontend: mostrar resultado por lead (éxito / reutilizado / error) en la tabla

- `Leads.jsx`:
  - Nuevo estado `classificationErrors` (`{ [leadId]: string }`) para guardar el mensaje de error puntual de cada lead que falló en el último batch/clasificación individual.
  - `handleClassify` y `handleClassifySelected` deben, además de actualizar `classifications`, limpiar/setear `classificationErrors` por lead.
  - En la tabla, la celda de "Temperatura" (o una nueva celda de "Estado") debe mostrar:
    - Ícono/tooltip de "ya estaba clasificado" cuando `reused === true`.
    - Ícono/mensaje de error puntual (con el texto de `classificationErrors[lead.id]`) cuando ese lead falló, en vez de sólo un mensaje genérico arriba de la tabla.
  - Mantener el mensaje genérico de arriba como resumen (`X clasificados, Y fallidos`), pero ya no como única fuente de información.
- `ClassificationBadge.jsx`: agregar soporte opcional para un estado `reused` (ej. subtítulo "sin cambios" o ícono distinto) y un estado `error`.

**Estado:** Completado

---

### 4. Nueva regla de negocio: confirmar reclasificación si el lead no cambió

Objetivo: si el `prompt_hash` del lead coincide con su última clasificación (no hay cambios en los datos relevantes), **no reclasificar automáticamente ni silenciosamente**: preguntarle al usuario si quiere forzar la reclasificación de todas formas.

- **Backend:**
  - `classifyOne(userId, leadId, { force })`: si `!force` y el `prompt_hash` coincide, en lugar de llamar a la IA devolver de una vez la clasificación existente marcada con `reused: true` (ya cubierto por el punto 1) — esto ya es el comportamiento actual, se mantiene como respuesta rápida sin costo.
  - No se requiere un nuevo endpoint: el flujo de confirmación se resuelve en el frontend usando el flag `reused` de la respuesta (ver siguiente punto). El backend simplemente sigue devolviendo la clasificación existente al toque, sin gastar tokens; el frontend decide si eso amerita preguntar antes o informar después.
  - Alternativa (a evaluar): agregar modo "dry-run" (`GET /classifications/:leadId/check`) que sólo devuelva `{ unchanged: boolean, latest }` sin persistir nada, para poder preguntar **antes** de disparar la clasificación (mejor UX que preguntar después). Se prioriza esta alternativa si el flujo "clasificar y después informar que no cambió" resulta confuso en la práctica.
- **Frontend:**
  - Al clasificar un lead individual (`handleClassify`):
    - Si la respuesta trae `reused: true`, mostrar un mensaje/diálogo: *"Este lead no tiene cambios desde la última clasificación (temperatura: X). ¿Querés forzar una nueva clasificación de todas formas?"* con botones "Sí, forzar" / "Cerrar".
    - Si el usuario confirma "Sí, forzar", repetir la llamada con `force=true` (`api.classifyLead(leadId, { force: true })`).
  - En clasificación por lote (`handleClassifySelected`): no interrumpir con un diálogo por cada lead reutilizado (sería intrusivo); en su lugar, mostrar un resumen post-batch: *"N lead(s) no tenían cambios y no se reclasificaron. ¿Forzar reclasificación de todos modos?"* con un botón que reintente sólo esos `leadIds` con `force=true`.
  - `api.js`: `classifyLead(leadId, { force } = {})` y `classifyBatch(leadIds, { force } = {})` deben aceptar la opción y pasarla como query param `?force=true` (ya soportado por el backend).

**Estado:** Completado

---

### 5. Ajustes menores / validaciones

- Revisar `classifications.validator.js` / `classifications.routes.js` para confirmar que `force` como query param se documenta y valida consistentemente (`'true'` string vs boolean) en ambos endpoints (`/classifications` y `/classifications/batch`).
- Agregar tests (si existe suite) o al menos casos manuales de prueba:
  - Clasificar un lead nuevo (sin historial) → `reused: false`.
  - Reclasificar sin cambios → `reused: true`, sin llamada a Anthropic (verificar en logs/usage report que `tokens_used` no aumentó).
  - Reclasificar sin cambios con `force=true` → `reused: false`, sí llama a Anthropic.
  - Alcanzar el límite diario → error con `code: 'DAILY_LIMIT_REACHED'`, se muestra en la fila correspondiente.

**Estado:** En progreso

**Nota sobre `force`:** no hay inconsistencia — ambos endpoints (`POST /classifications` y `POST /classifications/batch`) ya normalizaban `req.query.force === 'true'` de forma idéntica. Se extrajo esa lógica a un helper `parseForceFlag(req)` en `classifications.controller.js` para garantizar que ambos endpoints usen exactamente la misma regla en el futuro (en vez de mantener la comparación duplicada), y se documentó el contrato del query param con un comentario en `classifications.routes.js`.

**Nota sobre tests automatizados:** el backend no tiene ningún framework de test instalado (`package.json` no declara `jest`/`mocha`/`vitest`, no existen archivos `*.test.js` ni `*.spec.js` en el repo). No se agrega una suite automatizada como parte de este bug para no introducir una dependencia/infraestructura de testing nueva sin decisión explícita del equipo. En su lugar, se documentan a continuación los pasos manuales reproducibles con `curl` para cada caso.

### Casos de prueba manual (`force` / `reused` / límite diario)

Requiere el backend corriendo (`npm run dev` en `backend/`) y un `TOKEN` JWT válido (login vía `POST /auth/login`) y un `LEAD_ID` existente del usuario autenticado.

1. **Clasificar un lead nuevo (sin historial) → `reused: false`:**
   ```powershell
   curl -X POST http://localhost:3000/classifications -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"leadId\":\"$LEAD_ID\"}"
   ```
   Verificar en la respuesta `{ "classification": {...}, "reused": false }`.

2. **Reclasificar el mismo lead sin cambios → `reused: true`, sin llamada a Anthropic:**
   Repetir el mismo request inmediatamente. Verificar `"reused": true` y que `GET /classifications/usage` no incrementó `tokensUsed` para ese lead (comparar antes/después).

3. **Reclasificar sin cambios con `force=true` → `reused: false`, sí llama a Anthropic:**
   ```powershell
   curl -X POST "http://localhost:3000/classifications?force=true" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"leadId\":\"$LEAD_ID\"}"
   ```
   Verificar `"reused": false` y que `tokensUsed` en el usage report sí aumentó.

4. **Alcanzar el límite diario → error con `code: 'DAILY_LIMIT_REACHED'`:**
   Repetir el paso 3 (con `force=true`) 5 veces en menos de 24hs para el mismo lead, luego un 6to intento. Esperar `429` con body `{ "message": "...reached the daily reclassification limit...", "code": "DAILY_LIMIT_REACHED" }`. Repetirlo vía `POST /classifications/batch?force=true` con `leadIds: [LEAD_ID]` y confirmar que el item correspondiente en `errors` trae `code: 'DAILY_LIMIT_REACHED'`, y que en `Leads.jsx` la fila del lead muestra el error puntual (punto 3 del plan).

---

## Prioridad sugerida

1. Backend: exponer `reused` en las respuestas de clasificación (punto 1)
2. Frontend: mostrar estado por lead en la tabla (éxito/reutilizado/error) (punto 3)
3. Backend: distinguir error de límite diario con un código (punto 2)
4. Nueva regla de confirmación para leads sin cambios (punto 4)
5. Ajustes menores y pruebas manuales (punto 5)

---

## Checklist de tareas

### 1. Backend: exponer `reused` en las respuestas de clasificación
- [x] `classifyOne` devuelve `{ classification, reused }` en vez de la fila pelada
- [x] `classifyGroup` marca `reused: true/false` en cada resultado del array
- [x] `classifyBatch` propaga `reused` en cada item de `results`
- [x] `classifications.controller.js#classifySingle` devuelve `{ classification, reused }`
- [x] Verificar que `classifications.repository.js#create` no se vea afectado

### 2. Backend: código de error para el límite diario
- [x] Revisar si `AppError` soporta un campo `code`/`type` opcional
- [x] Agregar `code: 'DAILY_LIMIT_REACHED'` al error 429 de `assertReclassificationLimit`
- [x] Confirmar que `classifyBatch` incluye ese `code` en el array `errors`

### 3. Frontend: estado por lead en la tabla
- [x] Nuevo estado `classificationErrors` (`{ [leadId]: string }`) en `Leads.jsx`
- [x] `handleClassify` limpia/setea error puntual del lead
- [x] `handleClassifySelected` mapea `errors` del batch a `classificationErrors` por `leadId`
- [x] Celda de estado en la tabla muestra ícono/tooltip "ya estaba clasificado" cuando `reused === true`
- [x] Celda de estado muestra el error puntual cuando ese lead falló
- [x] Mantener el resumen genérico arriba (`X clasificados, Y fallidos`) como complemento, no única fuente
- [x] `ClassificationBadge.jsx` soporta estado `reused` y estado `error`

### 4. Nueva regla: confirmar reclasificación si el lead no cambió
- [x] Decidir si se implementa el endpoint "dry-run" (`GET /classifications/:leadId/check`) o se resuelve sólo con el flag `reused` post-respuesta
- [x] `api.js`: `classifyLead(leadId, { force } = {})` acepta y envía `force` como query param
- [x] `api.js`: `classifyBatch(leadIds, { force } = {})` acepta y envía `force` como query param
- [x] `handleClassify`: si `reused: true`, mostrar diálogo de confirmación para forzar reclasificación
- [x] Confirmar diálogo → reintentar con `force: true`
- [x] `handleClassifySelected`: resumen post-batch de leads sin cambios + botón para forzar sólo esos `leadIds`

### 5. Ajustes menores / validaciones
- [x] Revisar consistencia de `force` (`'true'` string vs boolean) en `/classifications` y `/classifications/batch`
- [ ] Caso de prueba: clasificar lead nuevo → `reused: false`
- [ ] Caso de prueba: reclasificar sin cambios → `reused: true`, sin gasto de tokens
- [ ] Caso de prueba: reclasificar sin cambios con `force=true` → `reused: false`, sí llama a Anthropic
- [ ] Caso de prueba: alcanzar límite diario → error con `code: 'DAILY_LIMIT_REACHED'` visible en la fila

---

## Historial de cambios

| Fecha | Autor | Cambio |
|---|---|---|
| 2026-07-18 | GitHub Copilot (con nicolasbelmana) | Apertura del documento: bug reportado (batch classify no refleja resultados/errores por lead en el front) + plan de solución, incluyendo nueva regla de confirmación de reclasificación cuando el lead no tiene cambios. Estado inicial: **No iniciado** para todos los puntos. |
| 2026-07-18 | GitHub Copilot (con nicolasbelmana) | Se agrega sección "Checklist de tareas" con ítems tildables por punto del plan, para ir marcando el progreso de la implementación. |
| 2026-07-18 | GitHub Copilot (con nicolasbelmana) | Tarea 1 completada: `classifyOne`/`classifyGroup`/`classifyBatch` (`classifications.service.js`) ahora devuelven/propagan el flag `reused`; `classifySingle` (`classifications.controller.js`) responde `{ classification, reused }`. No se modificó `classifications.repository.js#create`. |
| 2026-07-18 | GitHub Copilot (con nicolasbelmana) | Tarea 2 completada: `AppError` ahora acepta un 4to parámetro opcional `code`; `errorHandler.js` lo incluye en la respuesta JSON cuando está presente. `assertReclassificationLimit` (`classifications.service.js`) lanza el error 429 con `code: 'DAILY_LIMIT_REACHED'`, y `classifyBatch` propaga ese `code` en cada item de `errors` cuando el fallback por-lead falla con ese código. |
| 2026-07-18 | GitHub Copilot (con nicolasbelmana) | Nuevo bug reportado: hay que reingresar a `localhost` o relevantar el servidor después de actualizar código que no debería requerirlo. Se agrega sección "Bug: hay que re-entrar a localhost / relevantar el servidor tras editar código" con plan de revisión en frontend y backend (ver más abajo). |

---

# Bug: hay que re-entrar a localhost / relevantar el servidor tras editar código

**Fecha de apertura:** 18 de julio de 2026
**Contexto:** al editar código que en teoría no debería romper nada (ni requerir un restart manual), la app deja de funcionar y el usuario tiene que: (a) refrescar/reingresar manualmente a `localhost` en el navegador, y/o (b) matar y volver a levantar el servidor backend a mano. Esto pasa tanto con cambios en frontend como en backend.

Archivos principales sospechosos:
- Backend: `backend/src/server.js`, `backend/src/app.js`, `backend/src/shared/database/pool.js`, `backend/package.json` (script `dev`)
- Frontend: `frontend/src/context/AuthContext.jsx`, `frontend/src/lib/api.js`, `frontend/vite.config.js`, `frontend/src/main.jsx`

## Hipótesis relevadas (revisión de código, a confirmar/descartar)

### Backend

1. **`node --watch` reinicia todo el proceso en cada guardado** (`"dev": "node --watch src/server.js"`). Durante la ventana de restart (desde que muere el proceso viejo hasta que el nuevo vuelve a hacer `listen`), cualquier request del frontend recibe `ECONNREFUSED`/`ECONNRESET`. En Windows esa ventana puede ser más larga y, si el puerto tarda en liberarse, puede aparecer `EADDRINUSE` y quedar el server sin levantar hasta matarlo manualmente (coincide con "volver a levantar el servidor").
2. **El `pg.Pool` (`pool.js`) no tiene handler de `error`** en el pool (`pool.on('error', ...)`). Un error de conexión idle (ej. Postgres cierra una conexión ociosa) puede emitir un evento `error` no escuchado, que en Node hace crashear el proceso entero (unhandled error event) en vez de sólo loguearlo — esto tumbaría el servidor sin que haya habido ningún cambio de código de por medio, y encima simultáneo a una sesión de desarrollo activa.
3. **Sin manejo de señales / shutdown gracioso** en `server.js` (no hay `SIGTERM`/`SIGINT` handler que cierre el pool y el server ordenadamente). Combinado con `--watch`, esto puede dejar conexiones a Postgres colgadas entre reinicios y, en casos raros, hacer que el nuevo proceso tarde más en levantar o falle el primer `listen`.
4. **`passport` es un singleton global** y `configureAuthStrategies(passport, ...)` se llama en cada `createApp()`. Dentro de un mismo proceso esto no debería ser un problema (un solo `createApp()` por arranque), pero conviene confirmar que no haya registro duplicado de estrategias si en algún punto se llega a invocar `createApp()` más de una vez en el mismo proceso (tests, por ejemplo).

### Frontend

5. **`AuthContext.jsx` trata cualquier error de `api.me()` como token inválido.** El `.catch()` del `useEffect` inicial borra `token`/`user` de `localStorage` y desloguea al usuario ante **cualquier** rechazo de la promesa — incluyendo errores de red transitorios (`fetch` falla con `TypeError: Failed to fetch` cuando el backend está reiniciando por `--watch`, no sólo un 401/403 real del servidor). Esto explicaría exactamente el síntoma "tengo que volver a entrar" (re-loguearse) cada vez que el backend se reinicia mientras el frontend sigue abierto: un simple restart del backend por un cambio de código dispara un logout silencioso en el cliente.
6. **`handleResponse` en `api.js` no distingue errores de red de errores HTTP.** Si `fetch` rechaza (backend caído/reiniciando), no hay reintento ni backoff; el error sube tal cual y, combinado con el punto 5, se interpreta como sesión inválida en vez de "el backend no está disponible en este instante, reintentar".
7. **Vite HMR vs. archivos que exportan mezcla de componentes y no-componentes.** `AuthContext.jsx` exporta `AuthProvider` (componente) y `useAuth` (hook, no-componente) desde el mismo archivo. React Fast Refresh no puede preservar el estado del componente en ese caso y fuerza un **full reload** de la página en cada edición de ese archivo (o de cualquier archivo que lo importe transitivamente), lo cual, combinado con el punto 5 (logout ante error de red durante el reload) o con estado no persistido, puede dar la sensación de "tengo que volver a entrar".
8. **No hay Error Boundary** en `App.jsx`/`main.jsx`. Si una edición introduce momentáneamente un error de render (incluso uno que el propio HMR luego corrige), React puede desmontar el árbol completo y dejar una pantalla en blanco que no se recupera sola hasta un refresh manual del navegador.
9. **`vite.config.js` no tiene configurado `server.watch`/polling** para el caso de que el filesystem no dispare eventos de forma confiable (común en algunos setups de Windows con OneDrive, que es justamente donde vive este repo: `OneDrive\Escritorio\...`). OneDrive puede interferir con el watcher de archivos (bloqueos de archivo, sync en curso) y hacer que ni Vite ni `node --watch` detecten el cambio o tarden en reaccionar, dando la sensación de que "hay que reiniciar a mano".

---

## Plan de revisión (tareas)

### Backend

- [ ] Agregar `pool.on('error', (err) => console.error('[pg pool] unexpected error on idle client', err))` en `pool.js` para que un error de conexión idle no tumbe el proceso completo.
- [ ] Agregar manejo de `SIGTERM`/`SIGINT` en `server.js`: cerrar el servidor HTTP (`server.close()`) y el pool (`pool.end()`) antes de salir, para que `node --watch` reinicie de forma limpia y libere el puerto sin dejar handles colgados.
- [ ] Confirmar en Windows si `node --watch` deja el puerto ocupado tras un restart (reproducir: editar un archivo backend varias veces seguidas y ver si en algún reinicio aparece `EADDRINUSE` en la consola). Si pasa, evaluar migrar a `nodemon` con `--signal SIGTERM` o ajustar el delay de watch.
- [ ] Revisar si conviene loguear explícitamente en `server.listen` los reinicios (timestamp) para poder correlacionar "edité X archivo" → "el server tardó/falló en volver a levantar".
- [ ] Confirmar que `configureAuthStrategies` no registra estrategias duplicadas si `createApp()` se invoca más de una vez en el mismo proceso.

### Frontend

- [ ] `AuthContext.jsx`: en el `.catch()` de `api.me()`, distinguir un error de autenticación real (401/403, es decir "el token es inválido") de un error de red/servidor no disponible. Sólo limpiar `token`/`user` y desloguear en el primer caso; en el segundo, mantener la sesión y opcionalmente reintentar (o mostrar un estado "reconectando" en vez de mandar al login).
  - Para esto, `api.js#handleResponse`/`api.me()` debería poder señalizar "fue un fetch fallido (red)" vs. "fue un 401 del backend" (por ejemplo, distinguiendo por `response` presente/ausente, o agregando un `code`/`status` a los errores lanzados, similar a lo ya hecho en el backend con `AppError.code`).
- [ ] Separar `useAuth` de `AuthProvider` en archivos distintos (ej. `AuthContext.jsx` sólo el Provider/Context, `useAuth.js` el hook) para que Fast Refresh pueda preservar estado en vez de forzar full reload en cada edición relacionada con auth.
- [ ] Revisar el resto de archivos de contexto/hooks compartidos (`hooks/auth/useLoginForm.js`, etc.) por el mismo patrón (componente + hook/util no-componente en el mismo archivo) que rompe Fast Refresh.
- [ ] Agregar un Error Boundary de nivel app (envolviendo `<App />` en `main.jsx` o dentro de `App.jsx`) para que un error de render puntual no deje la pantalla en blanco sin posibilidad de recuperación vía HMR.
- [ ] Reproducir puntualmente en este entorno (repo dentro de OneDrive) si Vite y/o `node --watch` tardan en detectar cambios o directamente no los detectan; si se confirma, agregar `usePolling`/`interval` en el watcher de Vite (`server.watch.usePolling`) y evaluar mover el repo fuera de una carpeta sincronizada por OneDrive como mitigación de fondo.
- [ ] Confirmar si el navegador queda "colgado" esperando una respuesta del backend caído (sin timeout en los `fetch` de `api.js`) durante el restart — si no hay `AbortController`/timeout, un request iniciado justo antes del restart puede quedar pendiente indefinidamente y dar la sensación de que la app "se rompió" hasta refrescar manualmente.

### Verificación conjunta (frontend + backend)

- [ ] Reproducir el escenario end-to-end: con el usuario logueado y la grilla de leads abierta, editar y guardar un archivo del backend (ej. un comentario en `classifications.service.js`) y observar en DevTools (Network + Console) qué ocurre exactamente con el próximo request: ¿falla con network error?, ¿el frontend desloguea?, ¿la UI queda en blanco?
- [ ] Repetir lo mismo editando sólo un archivo de frontend (ej. un cambio trivial en `Leads.jsx`) y confirmar si HMR aplica el cambio sin perder sesión/estado, o si fuerza full reload.
- [ ] Documentar en este archivo, una vez reproducido, cuál de las hipótesis (1–9) es la causa real (puede ser más de una) antes de implementar los fixes, para no arreglar síntomas que no aplican en este entorno.
| 2026-07-18 | GitHub Copilot (con nicolasbelmana) | Tarea 3 completada: `Leads.jsx` agrega estado `classificationErrors` por lead; `handleClassify`/`handleClassifySelected` lo setean/limpian y guardan `reused` junto a la clasificación. `ClassificationBadge.jsx` ahora acepta `error` (ícono + tooltip) y `reused` (ícono de historial + subtítulo "sin cambios"). El resumen genérico de arriba se mantiene como complemento. |
| 2026-07-18 | GitHub Copilot (con nicolasbelmana) | Tarea 4 completada: se optó por resolver la confirmación sólo con el flag `reused` post-respuesta (sin endpoint dry-run). `api.js` (`classifyLead`/`classifyBatch`) ahora aceptan `{ force }` y lo envían como query param `?force=true`. `Leads.jsx#handleClassify` acepta `{ force }`, y si la respuesta vuelve con `reused: true` sin `force`, muestra un `window.confirm` para reclasificar forzando; si el usuario acepta, reintenta con `force: true`. Se extrajo `classifySelectedIds(leadIds, { force })` de `handleClassifySelected`; tras un batch sin `force`, los leads reutilizados se guardan en el nuevo estado `reusedBatchIds` y se muestra un banner resumen ("N lead(s) no tenían cambios...") con botón "Forzar reclasificación" que reintenta sólo esos `leadIds` con `force: true`. |
| 2026-07-18 | GitHub Copilot (con nicolasbelmana) | Tarea 5 iniciada: se confirmó que `force` ya se normalizaba igual (`'true'` string) en ambos endpoints; se extrajo esa comparación a un helper `parseForceFlag(req)` en `classifications.controller.js` y se documentó el query param en `classifications.routes.js`. No se agregó una suite de tests automatizada (el backend no tiene ningún framework de test instalado); en su lugar se documentaron en `Bugs.md` los 4 casos de prueba manual con comandos `curl` reproducibles, pendientes de ejecución real contra el backend. |