const API_URL = import.meta.env.VITE_API_URL || '';

function getAuthHeaders() {
  const token = localStorage.getItem('cogniflow_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.error ||
      data.details?.join(', ') ||
      'Something went wrong. Please try again.';
    throw new Error(message);
  }

  return data;
}

export const api = {
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
};
