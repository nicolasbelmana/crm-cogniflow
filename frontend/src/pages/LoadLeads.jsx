import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { previewCsv } from '@/lib/csv';
import LeadForm from '@/components/LeadForm';
import { Button } from '@/components/ui/button';
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

export default function LoadLeads() {
  const [csvText, setCsvText] = useState('');
  const [previewRows, setPreviewRows] = useState([]);
  const [previewError, setPreviewError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const [manualMessage, setManualMessage] = useState('');

  async function handleManualSubmit(payload) {
    await api.createLead(payload);
    setManualMessage('Lead guardado correctamente.');
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

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
      const rows = previewCsv(text);
      setPreviewRows(rows);
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
        `Importados ${result.imported} leads${
          result.skipped ? ` (${result.skipped} filas omitidas por errores)` : ''
        }.`
      );
      setPreviewRows([]);
      setCsvText('');
    } catch (error) {
      setPreviewError(error.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Carga manual</CardTitle>
          <CardDescription>Agregá un lead individual con sus datos básicos.</CardDescription>
        </CardHeader>
        <CardContent>
          <LeadForm submitLabel="Guardar lead" onSubmit={handleManualSubmit} />
          {manualMessage ? (
            <p className="mt-4 text-sm text-green-700">{manualMessage}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Importar CSV</CardTitle>
          <CardDescription>
            Columnas soportadas: name, email, company, phone, chat_history (también en
            español: nombre, correo, empresa, telefono).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary hover:text-secondary-foreground">
              <FileUp className="h-4 w-4" />
              Seleccionar CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            </label>
            <Button type="button" variant="outline" onClick={() => handlePreview()} disabled={!csvText}>
              Previsualizar
            </Button>
            <Button type="button" onClick={handleImport} disabled={!csvText || importing}>
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                'Guardar leads'
              )}
            </Button>
            <Link to="/leads">
              <Button type="button" variant="ghost">
                Ver listado
              </Button>
            </Link>
          </div>

          {previewError ? (
            <p className="text-sm text-destructive" role="alert">
              {previewError}
            </p>
          ) : null}

          {importMessage ? (
            <p className="text-sm text-green-700">{importMessage}</p>
          ) : null}

          {previewRows.length > 0 ? (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Teléfono</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, index) => (
                    <TableRow key={`${row.email}-${index}`}>
                      <TableCell>{row.name || '—'}</TableCell>
                      <TableCell>{row.email || '—'}</TableCell>
                      <TableCell>{row.company || '—'}</TableCell>
                      <TableCell>{row.phone || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="border-t border-border p-3 text-sm text-muted-foreground">
                {previewRows.length} fila(s) listas para importar
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
