import { Link } from 'react-router-dom';
import { Upload, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function formatCurrency(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('es-AR').format(Number(value) || 0);
}

function normalizeProvider(providerUsed) {
  const value = String(providerUsed ?? '').trim().toLowerCase();
  return value || 'unknown';
}

function getProviderUsageMap(totalsByProvider = []) {
  return totalsByProvider.reduce((acc, row) => {
    const key = normalizeProvider(row.providerUsed);
    acc[key] = {
      classificationsCount: Number(row.classificationsCount ?? 0),
      tokensUsed: Number(row.tokensUsed ?? 0),
      estimatedCostUsd: Number(row.estimatedCostUsd ?? 0),
    };
    return acc;
  }, {});
}

export default function Dashboard() {
  const { user } = useAuth();
  const [totalLeads, setTotalLeads] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    Promise.all([api.getLeads(), api.getUsage({ days: 30 })])
      .then(([leadsData, usageData]) => {
        setTotalLeads(leadsData.total);
        setUsage(usageData.usage);
      })
      .catch(() => {
        setTotalLeads(0);
        setUsage(null);
      });
  }, []);

  const quotaPct = usage?.quota?.usedPct ?? 0;
  const dailyRows = usage?.byDay ?? [];
  const cache = usage?.cache;
  const byProvider = getProviderUsageMap(usage?.totalsByProvider ?? []);
  const cloudUsage = byProvider.anthropic ?? { classificationsCount: 0, tokensUsed: 0, estimatedCostUsd: 0 };
  const localUsage = byProvider.ollama ?? { classificationsCount: 0, tokensUsed: 0, estimatedCostUsd: 0 };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard Financiero IA</CardTitle>
          <CardDescription>
            Bienvenido/a, {user?.name}. Consumo y costos de clasificaciones IA.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Total de leads</p>
            <p className="text-3xl font-semibold">{totalLeads ?? '...'}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Tokens (30 días)</p>
            <p className="text-2xl font-semibold">{formatNumber(usage?.totals?.tokensUsed)}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Costo total (30 días)</p>
            <p className="text-2xl font-semibold">{formatCurrency(usage?.totals?.estimatedCostUsd)}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Llamadas IA (30 días)</p>
            <p className="text-2xl font-semibold">{formatNumber(usage?.totals?.classificationsCount)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cuota mensual</CardTitle>
          <CardDescription>
            {formatNumber(usage?.quota?.usedTokens)} / {formatNumber(usage?.quota?.monthlyTokenQuota)} tokens
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Alcance: cuota cloud ({(usage?.quota?.cloudProviders ?? ['anthropic']).join(', ')}). El uso local no descuenta esta cuota.
          </p>
          <div className="h-3 w-full rounded-full bg-secondary">
            <div
              className={`h-3 rounded-full ${usage?.quota?.overQuota ? 'bg-destructive' : 'bg-primary'}`}
              style={{ width: `${Math.min(100, quotaPct)}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">{quotaPct.toFixed(1)}% usado</p>
          {usage?.quota?.overQuota ? (
            <p className="text-sm font-medium text-destructive">
              Aviso: cuota superada. Decisión actual: permitir continuar con advertencia visible.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Consumo por proveedor (30 días)</CardTitle>
            <CardDescription>Separación entre IA cloud y local</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="rounded border p-3">
              <p className="font-medium">Cloud (Anthropic)</p>
              <p className="text-muted-foreground">Tokens: {formatNumber(cloudUsage.tokensUsed)}</p>
              <p className="text-muted-foreground">Costo: {formatCurrency(cloudUsage.estimatedCostUsd)}</p>
              <p className="text-muted-foreground">Llamadas: {formatNumber(cloudUsage.classificationsCount)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium">Local (Ollama)</p>
              <p className="text-muted-foreground">Tokens: {formatNumber(localUsage.tokensUsed)}</p>
              <p className="text-muted-foreground">Costo: {formatCurrency(localUsage.estimatedCostUsd)}</p>
              <p className="text-muted-foreground">Llamadas: {formatNumber(localUsage.classificationsCount)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cache</CardTitle>
            <CardDescription>Eficiencia del cache de respuestas</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Cache Hits</p>
              <p className="text-lg font-semibold">{formatNumber(cache?.cache_hit)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Cache Misses</p>
              <p className="text-lg font-semibold">{formatNumber(cache?.cache_miss)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Llamadas evitadas</p>
              <p className="text-lg font-semibold">{formatNumber(cache?.cache_saved_calls)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Tokens ahorrados</p>
              <p className="text-lg font-semibold">{formatNumber(cache?.cache_saved_tokens)}</p>
            </div>
            <div className="rounded border p-3 col-span-2">
              <p className="text-muted-foreground">USD ahorrados</p>
              <p className="text-lg font-semibold">{formatCurrency(cache?.cache_saved_usd)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Empresa</CardTitle>
            <CardDescription>{user?.company_name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Modelo principal: {usage?.model ?? '—'}</p>
            <p>Costo promedio por llamada: {formatCurrency(usage?.stats?.average_cost)}</p>
            <p>Tokens promedio por llamada: {formatNumber(usage?.stats?.average_tokens)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Consumo diario</CardTitle>
          <CardDescription>Últimos 30 días</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Costo USD</TableHead>
                <TableHead>Llamadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dailyRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Sin clasificaciones en el período.
                  </TableCell>
                </TableRow>
              ) : (
                dailyRows.map((row) => (
                  <TableRow key={`${row.day}-${row.providerUsed}`}>
                    <TableCell>{new Date(row.day).toLocaleDateString('es-AR')}</TableCell>
                    <TableCell>{row.providerUsed}</TableCell>
                    <TableCell>{formatNumber(row.tokensUsed)}</TableCell>
                    <TableCell>{formatCurrency(row.estimatedCostUsd)}</TableCell>
                    <TableCell>{formatNumber(row.classificationsCount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Upload className="h-5 w-5" />
              Cargar leads
            </CardTitle>
            <CardDescription>Formulario manual o importación CSV con preview.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/leads/load">
              <Button>Ir a carga</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              Ver leads
            </CardTitle>
            <CardDescription>Listado con filtros por empresa y acciones CRUD.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/leads">
              <Button variant="outline">Ver listado</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
