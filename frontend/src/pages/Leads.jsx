import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import LeadForm from '@/components/LeadForm';
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

export default function Leads() {
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

  useEffect(() => {
    loadLeads('');
  }, [loadLeads]);

  async function handleDelete(id) {
    if (!window.confirm('¿Eliminar este lead?')) {
      return;
    }

    try {
      await api.deleteLead(id);
      setLeads((current) => current.filter((lead) => lead.id !== id));
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
              {leads.length} lead(s) cargados. La columna de temperatura llegará en la Semana 3.
            </CardDescription>
          </div>
          <Link to="/leads/load">
            <Button>Cargar leads</Button>
          </Link>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Filtrar por empresa..."
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              className="max-w-sm"
            />
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
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
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
                    <TableHead>Nombre</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Fuente</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">{lead.name}</TableCell>
                      <TableCell>{lead.company}</TableCell>
                      <TableCell>{lead.email}</TableCell>
                      <TableCell>{lead.phone || '—'}</TableCell>
                      <TableCell>{lead.source}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
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
