import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emptyForm = {
  name: '',
  email: '',
  company: '',
  phone: '',
  chat_history: '',
};

export default function LeadForm({ initialValues, submitLabel, onSubmit, onCancel }) {
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
          ? initialValues.chat_history
              .map((item) => (typeof item === 'string' ? item : item.text))
              .join('\n')
          : '',
      });
    }
  }, [initialValues]);

  function updateField(field) {
    return (event) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };
  }

  function validate() {
    if (form.name.trim().length < 2) {
      return 'El nombre debe tener al menos 2 caracteres.';
    }

    if (!EMAIL_REGEX.test(form.email.trim())) {
      return 'Ingresá un email válido.';
    }

    if (form.company.trim().length < 2) {
      return 'La empresa debe tener al menos 2 caracteres.';
    }

    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const validationError = validate();
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" value={form.name} onChange={updateField('name')} disabled={submitting} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={updateField('email')}
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company">Empresa</Label>
          <Input
            id="company"
            value={form.company}
            onChange={updateField('company')}
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Teléfono (opcional)</Label>
          <Input
            id="phone"
            value={form.phone}
            onChange={updateField('phone')}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="chat_history">Historial de chat (opcional)</Label>
        <Textarea
          id="chat_history"
          placeholder="Un mensaje por línea"
          value={form.chat_history}
          onChange={updateField('chat_history')}
          disabled={submitting}
        />
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            submitLabel
          )}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
