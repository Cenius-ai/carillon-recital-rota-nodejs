/** Same-origin JSON API client for the Carillon Recital Rota server. */

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields || null;
  }
}

async function request(method, path, body) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload.error === 'string' && payload.error) ||
      `The request could not be completed (HTTP ${response.status}).`;
    throw new ApiError(response.status, message, payload && payload.fields);
  }

  return payload;
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  me: () => request('GET', '/api/auth/me'),
  register: (payload) => request('POST', '/api/auth/register', payload),
  login: (payload) => request('POST', '/api/auth/login', payload),
  logout: () => request('POST', '/api/auth/logout', {}),
  meta: () => request('GET', '/api/meta'),

  listRecitals: (scope = 'upcoming') => request('GET', `/api/recitals${query({ scope })}`),
  getRecital: (id) => request('GET', `/api/recitals/${encodeURIComponent(id)}`),
  createRecital: (payload) => request('POST', '/api/recitals', payload),
  updateRecital: (id, payload) => request('PATCH', `/api/recitals/${encodeURIComponent(id)}`, payload),
  deleteRecital: (id) => request('DELETE', `/api/recitals/${encodeURIComponent(id)}`, {}),
  claimRecital: (id) => request('POST', `/api/recitals/${encodeURIComponent(id)}/claim`, {}),
  releaseRecital: (id) => request('POST', `/api/recitals/${encodeURIComponent(id)}/release`, {}),

  listPieces: (recitalId) => request('GET', `/api/recitals/${encodeURIComponent(recitalId)}/pieces`),
  createPiece: (recitalId, payload) =>
    request('POST', `/api/recitals/${encodeURIComponent(recitalId)}/pieces`, payload),
  updatePiece: (id, payload) => request('PATCH', `/api/pieces/${encodeURIComponent(id)}`, payload),
  deletePiece: (id) => request('DELETE', `/api/pieces/${encodeURIComponent(id)}`, {}),

  listSlots: (scope = 'upcoming') => request('GET', `/api/practice-slots${query({ scope })}`),
  createSlot: (payload) => request('POST', '/api/practice-slots', payload),
  claimSlot: (id) => request('POST', `/api/practice-slots/${encodeURIComponent(id)}/claim`, {}),
  releaseSlot: (id) => request('POST', `/api/practice-slots/${encodeURIComponent(id)}/release`, {}),
  deleteSlot: (id) => request('DELETE', `/api/practice-slots/${encodeURIComponent(id)}`, {})
};
