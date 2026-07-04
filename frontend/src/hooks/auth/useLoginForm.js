import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { validateLoginInput } from '@/lib/validators/authValidators';

/**
 * Application layer for the Login screen: owns all state, validation and
 * the submit/navigation flow. `pages/Login.jsx` only reads what this hook
 * returns and renders JSX — it never touches `useState`, `useAuth` or
 * `react-router-dom` directly.
 */
export function useLoginForm() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const validationError = validateLoginInput({ email, password });
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      await login(email.trim(), password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    email,
    password,
    error,
    submitting,
    setEmail,
    setPassword,
    handleSubmit,
  };
}
