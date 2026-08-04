const API_URL = import.meta.env.VITE_API_URL || '';
const AUTH_EXPIRED_EVENT = 'cogniflow:auth-expired';
const TOKEN_KEY = 'cogniflow_token';
const USER_KEY = 'cogniflow_user';

function getAuthHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse(response) {
  const raw = await response.text();
  const data = (() => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();

  if (!response.ok) {
    const backendError = String(data.error || '').toLowerCase();
    const tokenExpired = response.status === 401 || backendError.includes('jwt expired');

    if (tokenExpired) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      throw new Error('Tu sesión expiró. Iniciá sesión nuevamente.');
    }

    const details = Array.isArray(data.details) ? data.details.join(', ') : null;
    const textFallback = raw && !data.error ? raw.slice(0, 220) : null;
    const message =
      data.error ||
      details ||
      textFallback ||
      `HTTP ${response.status} ${response.statusText || 'Request failed'}`;
    throw new Error(message);
  }

  return data;
}

export const api = {
  AUTH_EXPIRED_EVENT,

  async register(payload) {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return handleResponse(response);
  },

  async login(payload) {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return handleResponse(response);
  },

  async logout() {
    const response = await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    });

    return handleResponse(response);
  },

  async me() {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: getAuthHeaders(),
    });

    return handleResponse(response);
  },

  async getLeads(params = {}) {
    const searchParams = new URLSearchParams();
    if (params.company) {
      searchParams.set('company', params.company);
    }

    const query = searchParams.toString();
    const response = await fetch(`${API_URL}/leads${query ? `?${query}` : ''}`, {
      headers: getAuthHeaders(),
    });

    return handleResponse(response);
  },

  async createLead(payload) {
    const response = await fetch(`${API_URL}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });

    return handleResponse(response);
  },

  async bulkLeads(payload) {
    const response = await fetch(`${API_URL}/leads/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });

    return handleResponse(response);
  },

  async updateLead(id, payload) {
    const response = await fetch(`${API_URL}/leads/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });

    return handleResponse(response);
  },

  async deleteLead(id) {
    const response = await fetch(`${API_URL}/leads/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    return handleResponse(response);
  },

  async classifyLead(leadId, { force, provider, signal } = {}) {
    const query = force ? '?force=true' : '';
    const response = await fetch(`${API_URL}/classifications${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ leadId, ...(provider ? { provider } : {}) }),
      signal,
    });

    return handleResponse(response);
  },

  async classifyBatch(leadIds, { force, provider, signal } = {}) {
    const query = force ? '?force=true' : '';
    const response = await fetch(`${API_URL}/classifications/batch${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ leadIds, ...(provider ? { provider } : {}) }),
      signal,
    });

    return handleResponse(response);
  },

  async getClassificationHistory(leadId) {
    const response = await fetch(`${API_URL}/classifications/${leadId}`, {
      headers: getAuthHeaders(),
    });

    return handleResponse(response);
  },

  async getUsage({ days } = {}) {
    const searchParams = new URLSearchParams();
    if (Number.isFinite(days) && days > 0) {
      searchParams.set('days', String(days));
    }

    const query = searchParams.toString();
    const response = await fetch(`${API_URL}/classifications/usage${query ? `?${query}` : ''}`, {
      headers: getAuthHeaders(),
    });

    return handleResponse(response);
  },
};
