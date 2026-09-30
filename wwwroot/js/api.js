const API_BASE_URL = (typeof window !== 'undefined' && window.ERP_API_BASE) ? String(window.ERP_API_BASE).replace(/\/+$/, '') : '/api';

const TOKEN_KEY = 'erp_auth_token';

export function getAuthToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setAuthToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export function clearAuthToken() {
  setAuthToken('');
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body !== undefined && options.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    cache: 'no-store'
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!response.ok) {
    const details = typeof payload === 'string'
      ? payload
      : [payload?.message, payload?.title, payload?.detail, payload?.path]
          .filter(Boolean)
          .join(' | ');
    const err = new Error(details || `API request failed (${response.status})`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

const toQuery = (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
};

const collection = (resource) => ({
  list: (params) => request(`/${resource}${toQuery(params)}`, { method: 'GET' }),
  /** Server-side page: { page, pageSize, search, sortBy, sortDirection, ...filters } */
  listPaged: (params = {}) => request(`/${resource}${toQuery({ page: 1, pageSize: 25, ...params })}`, { method: 'GET' }),
  create: (payload) => request(`/${resource}`, { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) => request(`/${resource}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  remove: (id) => request(`/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' })
});

export const erpApi = {
  baseUrl: API_BASE_URL,
  request,
  health: () => request('/health', { method: 'GET' }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me', { method: 'GET' }),
  listUsers: () => request('/auth/users', { method: 'GET' }),
  createUser: (payload) => request('/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id, payload) => request(`/auth/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteUser: (id) => request(`/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  bootstrap: () => request('/bootstrap', { method: 'GET' }),
  replaceBootstrap: (payload) => request('/bootstrap', { method: 'PUT', body: JSON.stringify(payload) }),
  upsertBootstrap: (payload) => request('/bootstrap?mode=upsert', { method: 'PUT', body: JSON.stringify(payload) }),
  owners: collection('owners'),
  projects: collection('projects'),
  contracts: collection('contracts'),
  invoices: {
    list: (params) => request(`/invoices${toQuery(params)}`, { method: 'GET' }),
    listPaged: (params = {}) => request(`/invoices${toQuery({ page: 1, pageSize: 25, ...params })}`, { method: 'GET' }),
    getById: (id) => request(`/invoices/${encodeURIComponent(id)}`, { method: 'GET' }),
    create: (payload) => request('/invoices', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/invoices/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (id) => request(`/invoices/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  dashboard: () => request('/reports/dashboard', { method: 'GET' }),
  approveInvoice: (id) => request(`/invoices/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  execPositions: {
    list: (contractId) => request(`/execution-positions${contractId ? `?contractId=${encodeURIComponent(contractId)}` : ''}`, { method: 'GET' }),
    getById: (id) => request(`/execution-positions/${encodeURIComponent(id)}`, { method: 'GET' }),
    create: (payload) => request('/execution-positions', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/execution-positions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (id) => request(`/execution-positions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  escalations: {
    list: () => request('/escalations', { method: 'GET' }),
    updatePayment: (invoiceDeductionId, payload) => request(`/escalations/${encodeURIComponent(invoiceDeductionId)}`, { method: 'PUT', body: JSON.stringify(payload) })
  },
  socialInsurance: {
    contracts: () => request('/social-insurance/contracts', { method: 'GET' }),
    updateContract: (contractId, payload) => request(`/social-insurance/contracts/${encodeURIComponent(contractId)}`, { method: 'PUT', body: JSON.stringify(payload) }),
    payments: () => request('/social-insurance/payments', { method: 'GET' }),
    updatePayment: (invoiceId, payload) => request(`/social-insurance/payments/${encodeURIComponent(invoiceId)}`, { method: 'PUT', body: JSON.stringify(payload) })
  },
  costControl: {
    getByContract: (contractId) => request(`/cost-control?contractId=${encodeURIComponent(contractId)}`, { method: 'GET' }),
    getById: (id) => request(`/cost-control/${encodeURIComponent(id)}`, { method: 'GET' }),
    getSummary: (id) => request(`/cost-control/${encodeURIComponent(id)}/summary`, { method: 'GET' }),
    create: (payload) => request('/cost-control', { method: 'POST', body: JSON.stringify(payload) }),
    remove: (id) => request(`/cost-control/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    addMainItem: (costControlId, payload) => request(`/cost-control/${encodeURIComponent(costControlId)}/items`, { method: 'POST', body: JSON.stringify(payload) }),
    updateMainItem: (itemId, payload) => request(`/cost-control/items/${encodeURIComponent(itemId)}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deleteMainItem: (itemId) => request(`/cost-control/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
    addSubItem: (itemId, payload) => request(`/cost-control/items/${encodeURIComponent(itemId)}/sub-items`, { method: 'POST', body: JSON.stringify(payload) }),
    updateSubItem: (subItemId, payload) => request(`/cost-control/sub-items/${encodeURIComponent(subItemId)}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deleteSubItem: (subItemId) => request(`/cost-control/sub-items/${encodeURIComponent(subItemId)}`, { method: 'DELETE' })
  }
};

export function isApiConfigured() {
  return Boolean(API_BASE_URL);
}
