let csrfToken = '';

const trustedItemRequest = item => ({
  lineId:item.lineId,
  productId:item.productId,
  quantity:Number(item.quantity),
  note:item.note || '',
  configuration:item.configuration || {}
});

const trustedOrderRequest = order => ({
  type:order.type,
  table:order.table,
  guests:Number(order.guests),
  source:order.source,
  customerName:order.customerName,
  phone:order.phone,
  address:order.address,
  orderNote:order.orderNote,
  items:(order.items || []).map(trustedItemRequest)
});

export async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const securityHeader = ['POST','PUT','PATCH','DELETE'].includes(method) && csrfToken
    ? { 'X-CSRF-Token':csrfToken }
    : {};
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...securityHeader, ...(options.headers || {}) }
  });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    csrfToken = '';
    window.dispatchEvent(new CustomEvent('pizzas:session-expired'));
  }
  if (!response.ok) throw new Error(result?.error || 'No se pudo guardar la información.');
  if (result?.csrfToken) csrfToken = result.csrfToken;
  if (path === '/api/auth/logout') csrfToken = '';
  return result;
}

export const api = {
  authStatus: () => request('/api/auth/status'),
  setupAuth: credentials => request('/api/auth/setup', { method: 'POST', body: JSON.stringify(credentials) }),
  login: credentials => request('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: '{}' }),
  bootstrap: () => request('/api/bootstrap'),
  openCash: data => request('/api/cash/open', { method: 'POST', body: JSON.stringify(data) }),
  closeCash: data => request('/api/cash/close', { method: 'POST', body: JSON.stringify(data) }),
  acknowledgeCashClose: () => request('/api/cash/close/acknowledge', { method: 'POST', body: '{}' }),
  saveSettings: settings => request('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  savePizzaSizes: pizzaSizes => request('/api/pizza-sizes', { method: 'PUT', body: JSON.stringify({ pizzaSizes }) }),
  saveCatalog: catalog => request('/api/catalog', { method: 'PUT', body: JSON.stringify({ catalog }) }),
  saveRawMaterials: (rawMaterials, categories = []) => request('/api/raw-materials', { method: 'PUT', body: JSON.stringify({ rawMaterials, categories }) }),
  createUser: user => request('/api/users', { method: 'POST', body: JSON.stringify(user) }),
  changePassword: data => request('/api/users/password', { method: 'PUT', body: JSON.stringify(data) }),
  createOrder: order => request('/api/orders', { method: 'POST', body: JSON.stringify(trustedOrderRequest(order)) }),
  addOrderItems: (id, items) => request(`/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ addItems: true, items:items.map(trustedItemRequest) }) }),
  updateOrder: (id, update) => request(`/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify(update) })
};
