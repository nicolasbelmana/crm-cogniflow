import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import LeadForm from '@/components/LeadForm';
import ClassificationBadge from '@/components/ClassificationBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const TEMPERATURE_LABELS = {
  cold: 'Frío',
  warm: 'Tibio',
  hot: 'Caliente',
};

const CLASSIFICATIONS_STORAGE_KEY = 'cogniflow_lead_classifications';
const SELECTED_PROVIDER_STORAGE_KEY = 'cogniflow_selected_provider';

function readStoredClassifications() {
  try {
    const raw = localStorage.getItem(CLASSIFICATIONS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredClassifications(classificationsByLeadId) {
  try {
    localStorage.setItem(CLASSIFICATIONS_STORAGE_KEY, JSON.stringify(classificationsByLeadId));
  } catch {
    // Ignore quota/private-mode errors; UI state still works in-memory.
  }
}

function readStoredProvider() {
  try {
    const value = localStorage.getItem(SELECTED_PROVIDER_STORAGE_KEY);
    return value === 'anthropic' || value === 'ollama' ? value : 'ollama';
  } catch {
    return 'ollama';
  }
}

function writeStoredProvider(provider) {
  try {
    localStorage.setItem(SELECTED_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // Ignore storage errors and keep in-memory value.
  }
}

const PROVIDER_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic (Cloud)' },
  { value: 'ollama', label: 'Ollama (Local)' },
];

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [companyFilter, setCompanyFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingLead, setEditingLead] = useState(null);
  const [classifications, setClassifications] = useState(() => readStoredClassifications());
  const [classificationErrors, setClassificationErrors] = useState({});
  const [classifyingIds, setClassifyingIds] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [reusedBatchIds, setReusedBatchIds] = useState([]);
  const [historyLead, setHistoryLead] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(() => readStoredProvider());
  const batchAbortControllerRef = useRef(null);
  const singleAbortControllersRef = useRef(new Map());

  const loadLeads = useCallback(async (company = search) => {
    setLoading(true);
    setError('');

    try {
      const data = await api.getLeads(company ? { company } : {});
      setLeads(data.leads);
      setSelectedIds(new Set());

      const stored = readStoredClassifications();
      const allowedLeadIds = new Set(data.leads.map((lead) => lead.id));
      setClassifications((current) => {
        const next = {};

        for (const leadId of allowedLeadIds) {
          if (current[leadId]) {
            next[leadId] = current[leadId];
          } else if (stored[leadId]) {
            next[leadId] = stored[leadId];
          }
        }

        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    writeStoredClassifications(classifications);
  }, [classifications]);

  useEffect(() => {
    writeStoredProvider(selectedProvider);
  }, [selectedProvider]);

  useEffect(() => {
    loadLeads('');
  }, [loadLeads]);

  useEffect(() => () => {
    batchAbortControllerRef.current?.abort();
    for (const controller of singleAbortControllersRef.current.values()) {
      controller.abort();
    }
    singleAbortControllersRef.current.clear();
  }, []);

  function markClassifying(id, value) {
    setClassifyingIds((current) => {
      const next = new Set(current);
      if (value) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function handleClassify(leadId, { force = false } = {}) {
    setError('');
    markClassifying(leadId, true);
    setClassificationErrors((current) => {
      const next = { ...current };
      delete next[leadId];
      return next;
    });

    try {
      const controller = new AbortController();
      singleAbortControllersRef.current.set(leadId, controller);

      const { classification, reused } = await api.classifyLead(leadId, {
        force,
        provider: selectedProvider,
        signal: controller.signal,
      });
      setClassifications((current) => ({ ...current, [leadId]: { ...classification, reused } }));

      if (reused && !force) {
        const temperatureLabel = TEMPERATURE_LABELS[classification.temperature] ?? classification.temperature;
        const shouldForce = window.confirm(
          `Este lead no tiene cambios desde la última clasificación (temperatura: ${temperatureLabel}). ¿Querés forzar una nueva clasificación de todas formas?`
        );
        if (shouldForce) {
          await handleClassify(leadId, { force: true });
          return;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        setClassificationErrors((current) => ({ ...current, [leadId]: 'Clasificación detenida por usuario.' }));
        setError('Clasificación detenida por usuario.');
      } else {
        setError(err.message);
        setClassificationErrors((current) => ({ ...current, [leadId]: err.message }));
      }
    } finally {
      singleAbortControllersRef.current.delete(leadId);
      markClassifying(leadId, false);
    }
  }

  async function classifySelectedIds(leadIds, { force = false } = {}) {
    if (leadIds.length === 0) {
      return;
    }

    setError('');
    setBatchLoading(true);
    leadIds.forEach((id) => markClassifying(id, true));
    setClassificationErrors((current) => {
      const next = { ...current };
      leadIds.forEach((id) => delete next[id]);
      return next;
    });

    try {
      const controller = new AbortController();
      batchAbortControllerRef.current = controller;

      const { results, errors } = await api.classifyBatch(leadIds, {
        force,
        provider: selectedProvider,
        signal: controller.signal,
      });
      setClassifications((current) => {
        const next = { ...current };
        results.forEach((result) => {
          next[result.lead_id] = result;
        });
        return next;
      });

      const reusedIds = results.filter((result) => result.reused).map((result) => result.lead_id);
      setReusedBatchIds(force ? [] : reusedIds);

      if (errors.length > 0) {
        setClassificationErrors((current) => {
          const next = { ...current };
          errors.forEach((item) => {
            next[item.leadId] = item.error;
          });
          return next;
        });
        setError(`No se pudieron clasificar ${errors.length} lead(s).`);
      }

      setSelectedIds(new Set());
    } catch (err) {
      if (err?.name === 'AbortError') {
        setError('Clasificación detenida por usuario.');
      } else {
        setError(err.message);
      }
    } finally {
      batchAbortControllerRef.current = null;
      leadIds.forEach((id) => markClassifying(id, false));
      setBatchLoading(false);
    }
  }

  async function handleClassifySelected() {
    await classifySelectedIds(Array.from(selectedIds));
  }

  async function handleForceReusedBatch() {
    const ids = reusedBatchIds;
    setReusedBatchIds([]);
    await classifySelectedIds(ids, { force: true });
  }

  function handleStopBatchClassification() {
    if (!batchLoading && singleAbortControllersRef.current.size === 0) {
      return;
    }

    batchAbortControllerRef.current?.abort();
    for (const controller of singleAbortControllersRef.current.values()) {
      controller.abort();
    }
    singleAbortControllersRef.current.clear();
  }

  function toggleSelected(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) =>
      current.size === leads.length ? new Set() : new Set(leads.map((lead) => lead.id))
    );
  }

  async function handleShowHistory(lead) {
    setHistoryLead(lead);
    setHistoryLoading(true);
    setHistoryItems([]);

    try {
      const { classifications: history } = await api.getClassificationHistory(lead.id);
      setHistoryItems(history);
      if (history.length > 0) {
        setClassifications((current) => ({ ...current, [lead.id]: history[0] }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Eliminar este lead?')) {
      return;
    }

    try {
      await api.deleteLead(id);
      setLeads((current) => current.filter((lead) => lead.id !== id));
      setClassifications((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdate(payload) {
    await api.updateLead(editingLead.id, payload);
    setEditingLead(null);
    await loadLeads();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Listado de leads</CardTitle>
            <CardDescription>
              {leads.length} lead(s) cargados. Clasificalos con IA para conocer su temperatura.
            </CardDescription>
          </div>
          <Link to="/leads/load">
            <Button>Cargar leads</Button>
          </Link>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filtrar por empresa..."
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              className="max-w-sm"
            />
            <select
              value={selectedProvider}
              onChange={(event) => setSelectedProvider(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Proveedor de IA"
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => { setSearch(companyFilter); loadLeads(companyFilter); }}>
              Buscar
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCompanyFilter('');
                setSearch('');
                loadLeads('');
              }}
            >
              Limpiar
            </Button>
            <Button
              className="ml-auto"
              disabled={selectedIds.size === 0 || batchLoading}
              onClick={handleClassifySelected}
            >
              {batchLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Clasificar seleccionados ({selectedIds.size})
            </Button>
            <Button
              variant="destructive"
              disabled={!batchLoading && classifyingIds.size === 0}
              onClick={handleStopBatchClassification}
            >
              Parar clasificación
            </Button>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {reusedBatchIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm">
              <span>
                {reusedBatchIds.length} lead(s) no tenían cambios y no se reclasificaron. ¿Forzar reclasificación de
                todos modos?
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={batchLoading}
                onClick={handleForceReusedBatch}
              >
                Forzar reclasificación
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReusedBatchIds([])}>
                Descartar
              </Button>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando leads...
            </div>
          ) : leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay leads todavía.{' '}
              <Link to="/leads/load" className="font-medium text-primary hover:underline">
                Cargá el primero
              </Link>
            </p>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === leads.length}
                        onChange={toggleSelectAll}
                        aria-label="Seleccionar todos"
                      />
                    </TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Fuente</TableHead>
                    <TableHead>Temperatura</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(lead.id)}
                          onChange={() => toggleSelected(lead.id)}
                          aria-label={`Seleccionar ${lead.name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{lead.name}</TableCell>
                      <TableCell>{lead.company}</TableCell>
                      <TableCell>{lead.email}</TableCell>
                      <TableCell>{lead.phone || '—'}</TableCell>
                      <TableCell>{lead.source}</TableCell>
                      <TableCell>
                        <ClassificationBadge
                          classification={classifications[lead.id]}
                          loading={classifyingIds.has(lead.id)}
                          error={classificationErrors[lead.id]}
                          reused={classifications[lead.id]?.reused}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            title="Clasificar con IA"
                            disabled={classifyingIds.has(lead.id)}
                            onClick={() => handleClassify(lead.id)}
                          >
                            <Sparkles className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            title="Ver historial"
                            onClick={() => handleShowHistory(lead)}
                          >
                            Historial
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingLead(lead)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(lead.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {historyLead ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Historial de clasificaciones</CardTitle>
              <CardDescription>{historyLead.name}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setHistoryLead(null)}>
              Cerrar
            </Button>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando historial...
              </div>
            ) : historyItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Este lead todavía no fue clasificado.
              </p>
            ) : (
              <div className="rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Temperatura</TableHead>
                      <TableHead>Confianza</TableHead>
                      <TableHead>Razonamiento</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{TEMPERATURE_LABELS[item.temperature] ?? item.temperature}</TableCell>
                        <TableCell>{Math.round(item.confidence * 100)}%</TableCell>
                        <TableCell className="max-w-xs">{item.reasoning}</TableCell>
                        <TableCell>{item.model_used}</TableCell>
                        <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {editingLead ? (
        <Card>
          <CardHeader>
            <CardTitle>Editar lead</CardTitle>
            <CardDescription>{editingLead.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <LeadForm
              initialValues={editingLead}
              submitLabel="Actualizar"
              onSubmit={handleUpdate}
              onCancel={() => setEditingLead(null)}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
