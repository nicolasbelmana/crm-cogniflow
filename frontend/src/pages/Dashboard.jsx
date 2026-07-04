import { Link } from 'react-router-dom';
import { Upload, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function Dashboard() {
  const { user } = useAuth();
  const [totalLeads, setTotalLeads] = useState(null);

  useEffect(() => {
    api
      .getLeads()
      .then((data) => setTotalLeads(data.total))
      .catch(() => setTotalLeads(0));
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
          <CardDescription>
            Bienvenido/a, {user?.name}. Gestión de leads activa (Semana 2).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Total de leads</p>
            <p className="text-3xl font-semibold">{totalLeads ?? '...'}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Empresa</p>
            <p className="text-lg font-medium">{user?.company_name}</p>
          </div>
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
