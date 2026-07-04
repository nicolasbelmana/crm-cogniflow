# Plan de refactor — Custom Hooks como capa de aplicación (frontend)

> **Estado:** Fase 0 (Login) ya implementada como prueba de concepto y
> validada end-to-end. Este documento es la guía para completar las fases
> restantes en otro momento, sin necesitar el contexto de la conversación
> original.

## Cómo retomar este trabajo

1. Elegí la siguiente fase no marcada como hecha (ver checklist abajo).
2. Usá `pages/Login.jsx` + `hooks/auth/useLoginForm.js` +
   `lib/validators/authValidators.js` como **plantilla de referencia** — ya
   implementan el patrón completo y están funcionando.
3. Seguí los pasos de la fase (archivos a crear, contrato del hook, sketch
   de código).
4. Corré `get_errors` sobre los archivos tocados.
5. Probá manualmente en el navegador (`npm run dev` en `frontend/` y
   `backend/`) siguiendo el checklist de esa fase.
6. Marcá la fase como hecha en este documento.

## El patrón (ya aplicado a Login, replicar igual en el resto)

```
JSX (pages/, components/)  →  Custom Hook (hooks/**)  →  lib/ (api, validators, storage)
     "view"                      "application layer"         "infra"
```

**Regla dura:** ningún archivo en `pages/` o `components/` (excepto
`components/ui/**`, que son primitivos "dumb" por diseño) puede:
- usar `useState` / `useEffect` directamente,
- llamar a `api.*` directamente,
- leer/escribir `localStorage` directamente.

Si necesita estado, efectos o acceso a datos, ese archivo consume un hook de
`hooks/**` que expone lo necesario.

**Convención de contrato:** todo hook devuelve **un solo objeto** (no una
tupla larga de `useState`), por ejemplo:

```js
const { email, password, error, submitting, setEmail, setPassword, handleSubmit } = useLoginForm();
```

**Convención de nombres/ubicación:** `hooks/<dominio>/use<Nombre>.js` (archivo
`.js`, no `.jsx` — estos hooks no contienen JSX). Validadores puros en
`lib/validators/<dominio>Validators.js`.

**Excepción documentada:** interacciones directas del browser como
`window.confirm(...)` se quedan en el JSX, no en el hook. El hook expone la
acción "cruda" (ej. `deleteLead(id)` sin confirmar); el componente decide si
pregunta antes de invocarla. Razón: no es una regla de negocio, es UI.

## Ya implementado (referencia)

| Archivo | Rol |
|---|---|
| `lib/validators/authValidators.js` | `isValidEmail()`, `validateLoginInput()` — funciones puras, sin React. |
| `hooks/auth/useLoginForm.js` | Estado del form, validación, submit, navegación post-login. |
| `pages/Login.jsx` | JSX puro. Cero `useState`/`useNavigate`/`useAuth` directos. |

---

## Checklist de fases pendientes

- [ ] **Fase A** — Register.jsx
- [ ] **Fase B** — LeadForm.jsx (compartido crear/editar)
- [ ] **Fase C** — Leads.jsx (listado + filtro + CRUD)
- [ ] **Fase D** — LoadLeads.jsx (CSV import + alta manual)
- [ ] **Fase E** — Dashboard.jsx
- [ ] **Fase F** — AuthContext.jsx + lib/authStorage.js
- [ ] **Fase G** — Auditoría final (grep)
- [ ] **Fase H** — frontend/ARCHITECTURE.md

Orden sugerido: **A → F → B → C → D → E → G → H** (A reutiliza el patrón de
auth recién validado; F es infra chica y de bajo riesgo; B es prerequisito
de C y D porque `LeadForm` se usa desde ambas páginas).

---

## Fase A — `pages/Register.jsx`

**Problema actual:** mezcla `useState` del form completo, validación
(`validateForm()`), submit y navegación en el mismo archivo que el JSX.

**Crear:**
- `hooks/auth/useRegisterForm.js`

**Editar:**
- `lib/validators/authValidators.js` → agregar `validateRegisterInput()`
- `pages/Register.jsx` → JSX puro

**Contrato del hook:**
```js
useRegisterForm() -> { form, error, submitting, updateField, handleSubmit }
```

**Sketch — agregar a `authValidators.js`:**
```js
export function validateRegisterInput({ name, company_name, email, password, confirmPassword }) {
  if (name.trim().length < 2) {
    return 'El nombre debe tener al menos 2 caracteres.';
  }
  if (company_name.trim().length < 2) {
    return 'El nombre de la empresa debe tener al menos 2 caracteres.';
  }
  if (!isValidEmail(email)) {
    return 'Ingresá un email válido.';
  }
  if (password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (password !== confirmPassword) {
    return 'Las contraseñas no coinciden.';
  }
  return null;
}
```

**Sketch — `hooks/auth/useRegisterForm.js`:**
```js
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { validateRegisterInput } from '@/lib/validators/authValidators';

const emptyForm = { name: '', company_name: '', email: '', password: '', confirmPassword: '' };

export function useRegisterForm() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function updateField(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const validationError = validateRegisterInput(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      await register({
        name: form.name.trim(),
        company_name: form.company_name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return { form, error, submitting, updateField, handleSubmit };
}
```

`Register.jsx` queda igual en el JSX, cambiando solo el `value`/`onChange` de
cada `Input` a `form.<campo>` / `updateField('<campo>')`, e importando
`useRegisterForm` en vez de `useState`/`useAuth`/`useNavigate`.

**Checklist de prueba:**
- [ ] Registro válido → navega a `/dashboard`.
- [ ] Cada validación individual (nombre corto, empresa corta, email
      inválido, password corto, passwords no coinciden) muestra el mensaje
      correcto.
- [ ] Registro con email duplicado → muestra `err.message` del backend
      (`Email already registered`).

---

## Fase B — `components/LeadForm.jsx` (compartido por Leads.jsx y LoadLeads.jsx)

**Problema actual:** estado del form, sincronización con `initialValues`
(modo edición), validación y submit, todo en el componente.

**Crear:**
- `lib/validators/leadValidators.js`
- `hooks/leads/useLeadForm.js`

**Editar:**
- `components/LeadForm.jsx` → JSX puro

**Importante:** `Leads.jsx` y `LoadLeads.jsx` siguen usando
`<LeadForm initialValues={...} submitLabel="..." onSubmit={...} onCancel={...} />`
exactamente igual — el cambio es 100% interno a `LeadForm.jsx`.

**Contrato del hook:**
```js
useLeadForm({ initialValues, onSubmit }) -> { form, error, submitting, updateField, handleSubmit }
```

**Sketch — `lib/validators/leadValidators.js`:**
```js
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLeadFormInput({ name, email, company }) {
  if (name.trim().length < 2) {
    return 'El nombre debe tener al menos 2 caracteres.';
  }
  if (!EMAIL_REGEX.test(email.trim())) {
    return 'Ingresá un email válido.';
  }
  if (company.trim().length < 2) {
    return 'La empresa debe tener al menos 2 caracteres.';
  }
  return null;
}
```

**Sketch — `hooks/leads/useLeadForm.js`:**
```js
import { useEffect, useState } from 'react';
import { validateLeadFormInput } from '@/lib/validators/leadValidators';

const emptyForm = { name: '', email: '', company: '', phone: '', chat_history: '' };

export function useLeadForm({ initialValues, onSubmit }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialValues) {
      setForm({
        name: initialValues.name || '',
        email: initialValues.email || '',
        company: initialValues.company || '',
        phone: initialValues.phone || '',
        chat_history: Array.isArray(initialValues.chat_history)
          ? initialValues.chat_history.map((item) => (typeof item === 'string' ? item : item.text)).join('\n')
          : '',
      });
    }
  }, [initialValues]);

  function updateField(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const validationError = validateLeadFormInput(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      await onSubmit({
        name: form.name.trim(),
        email: form.email.trim(),
        company: form.company.trim(),
        phone: form.phone.trim() || null,
        chat_history: form.chat_history,
      });

      if (!initialValues) {
        setForm(emptyForm);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return { form, error, submitting, updateField, handleSubmit };
}
```

**Checklist de prueba:**
- [ ] Desde `LoadLeads.jsx`: crear lead manual válido → mensaje de éxito y
      form se limpia.
- [ ] Desde `Leads.jsx`: editar un lead existente → form se precarga con sus
      valores, `chat_history` array se muestra como texto línea por línea.
- [ ] Validaciones (nombre/email/empresa inválidos) muestran error y no
      llaman a `onSubmit`.

---

## Fase C — `pages/Leads.jsx`

**Problema actual:** lista, filtro, loading/error, selección de edición,
delete y update, todo mezclado con el JSX de la tabla.

**Crear:**
- `hooks/leads/useLeadsList.js`

**Editar:**
- `pages/Leads.jsx` → JSX puro

**Contrato del hook:**
```js
useLeadsList() -> {
  leads, companyFilter, setCompanyFilter, loading, error, editingLead,
  applyFilter, clearFilter, startEdit, cancelEdit, deleteLead, updateLead,
}
```

**Sketch — `hooks/leads/useLeadsList.js`:**
```js
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function useLeadsList() {
  const [leads, setLeads] = useState([]);
  const [companyFilter, setCompanyFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingLead, setEditingLead] = useState(null);

  const loadLeads = useCallback(async (company = search) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getLeads(company ? { company } : {});
      setLeads(data.leads);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { loadLeads(''); }, [loadLeads]);

  function applyFilter() {
    setSearch(companyFilter);
    loadLeads(companyFilter);
  }

  function clearFilter() {
    setCompanyFilter('');
    setSearch('');
    loadLeads('');
  }

  async function deleteLead(id) {
    try {
      await api.deleteLead(id);
      setLeads((current) => current.filter((lead) => lead.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateLead(payload) {
    await api.updateLead(editingLead.id, payload);
    setEditingLead(null);
    await loadLeads();
  }

  return {
    leads, companyFilter, setCompanyFilter, loading, error, editingLead,
    applyFilter, clearFilter,
    startEdit: setEditingLead,
    cancelEdit: () => setEditingLead(null),
    deleteLead, updateLead,
  };
}
```

**En el JSX de `Leads.jsx`, el botón de borrar mantiene el `confirm` (excepción documentada):**
```jsx
<Button
  variant="outline"
  size="sm"
  onClick={() => { if (window.confirm('¿Eliminar este lead?')) deleteLead(lead.id); }}
>
  <Trash2 className="h-4 w-4" />
</Button>
```

**Checklist de prueba:**
- [ ] Carga inicial lista todos los leads.
- [ ] Filtro por empresa (buscar + limpiar).
- [ ] Editar abre el form precargado (Fase B) y al guardar refresca la lista.
- [ ] Borrar pide confirmación; aceptar quita el lead de la tabla; cancelar
      no hace nada.

---

## Fase D — `pages/LoadLeads.jsx`

**Problema actual:** lectura de archivo (`FileReader`), preview de CSV,
import bulk y alta manual, todo en el componente.

**Crear:**
- `hooks/leads/useCsvImport.js`
- `hooks/leads/useManualLeadEntry.js`

**Editar:**
- `pages/LoadLeads.jsx` → JSX puro

**Contratos:**
```js
useCsvImport() -> {
  csvText, previewRows, previewError, importMessage, importing,
  handleFileChange, handlePreview, handleImport,
}
useManualLeadEntry() -> { manualMessage, handleManualSubmit }
```

**Sketch — `hooks/leads/useCsvImport.js`:**
```js
import { useState } from 'react';
import { api } from '@/lib/api';
import { previewCsv } from '@/lib/csv';

export function useCsvImport() {
  const [csvText, setCsvText] = useState('');
  const [previewRows, setPreviewRows] = useState([]);
  const [previewError, setPreviewError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [importing, setImporting] = useState(false);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setCsvText(text);
      handlePreview(text);
    };
    reader.readAsText(file);
  }

  function handlePreview(text = csvText) {
    setPreviewError('');
    setImportMessage('');
    try {
      setPreviewRows(previewCsv(text));
    } catch (error) {
      setPreviewRows([]);
      setPreviewError(error.message);
    }
  }

  async function handleImport() {
    setImportMessage('');
    setPreviewError('');
    setImporting(true);
    try {
      const result = await api.bulkLeads({ csv: csvText });
      setImportMessage(
        `Importados ${result.imported} leads${result.skipped ? ` (${result.skipped} filas omitidas por errores)` : ''}.`
      );
      setPreviewRows([]);
      setCsvText('');
    } catch (error) {
      setPreviewError(error.message);
    } finally {
      setImporting(false);
    }
  }

  return { csvText, previewRows, previewError, importMessage, importing, handleFileChange, handlePreview, handleImport };
}
```

**Sketch — `hooks/leads/useManualLeadEntry.js`:**
```js
import { useState } from 'react';
import { api } from '@/lib/api';

export function useManualLeadEntry() {
  const [manualMessage, setManualMessage] = useState('');

  async function handleManualSubmit(payload) {
    await api.createLead(payload);
    setManualMessage('Lead guardado correctamente.');
  }

  return { manualMessage, handleManualSubmit };
}
```

**Checklist de prueba:**
- [ ] Seleccionar archivo CSV → dispara preview automático.
- [ ] Botón "Previsualizar" con texto pegado manualmente (si aplica).
- [ ] Importar CSV con filas válidas e inválidas → mensaje con
      `imported`/`skipped` correcto.
- [ ] Alta manual (`LeadForm`) → mensaje de éxito, independiente del CSV.

---

## Fase E — `pages/Dashboard.jsx`

**Problema actual:** `useEffect` + `api.getLeads()` inline junto al JSX.

**Crear:**
- `hooks/leads/useDashboardSummary.js`

**Editar:**
- `pages/Dashboard.jsx` → JSX puro

**Contrato:**
```js
useDashboardSummary() -> { user, totalLeads }
```

**Sketch:**
```js
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

export function useDashboardSummary() {
  const { user } = useAuth();
  const [totalLeads, setTotalLeads] = useState(null);

  useEffect(() => {
    api.getLeads()
      .then((data) => setTotalLeads(data.total))
      .catch(() => setTotalLeads(0));
  }, []);

  return { user, totalLeads };
}
```

**Checklist de prueba:**
- [ ] Dashboard muestra nombre/empresa del usuario y el total de leads real.

---

## Fase F — `context/AuthContext.jsx` + `lib/authStorage.js`

**Problema actual:** `AuthContext.jsx` toca `localStorage` directamente en
varios puntos (`TOKEN_KEY`, `USER_KEY`). **Además `lib/api.js` (función
`getAuthHeaders()`) también lee `localStorage.getItem('cogniflow_token')`
directamente** — es un segundo punto de acceso a storage que hay que
unificar en esta fase.

**Crear:**
- `lib/authStorage.js`

**Editar:**
- `context/AuthContext.jsx` → delega toda lectura/escritura a `authStorage`
- `lib/api.js` → `getAuthHeaders()` usa `authStorage.getToken()` en vez de
  `localStorage.getItem(...)` directo

**Sketch — `lib/authStorage.js`:**
```js
const TOKEN_KEY = 'cogniflow_token';
const USER_KEY = 'cogniflow_user';

/**
 * Único lugar del frontend que toca localStorage para la sesión de auth.
 */
export const authStorage = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
  getUser() {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  },
  saveSession(user, token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};
```

`AuthContext.jsx` reemplaza cada `localStorage.getItem/setItem/removeItem`
por la llamada equivalente de `authStorage`. La lógica (orden de llamadas,
try/catch de logout, etc.) no cambia, solo el acceso a storage.

`lib/api.js`:
```js
import { authStorage } from '@/lib/authStorage';

function getAuthHeaders() {
  const token = authStorage.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

**Checklist de prueba:**
- [ ] Login → refrescar la página (F5) → sigue autenticado (rehidrata desde
      storage vía `/auth/me`).
- [ ] Logout → limpia sesión, redirige a `/login`.
- [ ] Token inválido/expirado al cargar la app → limpia sesión
      silenciosamente (no rompe la UI).

---

## Fase G — Auditoría final

Correr búsquedas para confirmar que no quedó ningún caso suelto:

```powershell
# Ningún useState/useEffect fuera de hooks/ (excepto components/ui/**)
Select-String -Path "frontend/src/pages/**/*.jsx","frontend/src/components/**/*.jsx" -Pattern "useState|useEffect" | Where-Object { $_.Path -notmatch "components\\ui\\" }

# Ningún api.* directo fuera de hooks/
Select-String -Path "frontend/src/pages/**/*.jsx","frontend/src/components/**/*.jsx" -Pattern "api\." | Where-Object { $_.Path -notmatch "components\\ui\\" }
```

Ambas búsquedas deberían devolver **cero resultados**. Luego, regresión
manual completa: login, registro, dashboard, listado de leads (filtro,
editar, borrar), carga de leads (manual + CSV), logout.

---

## Fase H — `frontend/ARCHITECTURE.md`

Espejo de `backend/ARCHITECTURE.md`, adaptado a este patrón. Debe incluir:

1. Diagrama de capas (JSX → hook → lib/).
2. Tabla de mapeo backend↔frontend (`controller`→JSX, `service`→hook,
   `repository`→`lib/api.js`, `validator`→`lib/validators/*`).
3. La regla dura (sin `useState`/`useEffect`/`api.*` fuera de `hooks/**`).
4. La excepción de `window.confirm` y por qué.
5. Guía paso a paso para agregar una pantalla nueva (ej. una futura sección
   "Deals"): qué hook crear, qué va en el validador, qué va en el JSX.
6. Referencia a `Login.jsx` / `useLoginForm.js` / `authValidators.js` como
   ejemplo canónico ya implementado.
