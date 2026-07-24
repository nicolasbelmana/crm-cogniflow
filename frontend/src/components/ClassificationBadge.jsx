import { Loader2, AlertTriangle, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const LABELS = {
  cold: 'Frío',
  warm: 'Tibio',
  hot: 'Caliente',
};

export default function ClassificationBadge({ classification, loading, error, reused }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Clasificando...
      </span>
    );
  }

  if (error) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-destructive"
        title={error}
      >
        <AlertTriangle className="h-3 w-3" />
        Error
      </span>
    );
  }

  if (!classification) {
    return <span className="text-xs text-muted-foreground">Sin clasificar</span>;
  }

  const { temperature, confidence } = classification;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <Badge variant={temperature}>{LABELS[temperature] ?? temperature}</Badge>
        {reused ? (
          <span
            className="inline-flex items-center text-muted-foreground"
            title="Ya estaba clasificado (sin cambios desde la última clasificación)"
          >
            <History className="h-3 w-3" />
          </span>
        ) : null}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {Math.round(confidence * 100)}% confianza
        {reused ? ' · sin cambios' : ''}
      </span>
    </div>
  );
}
