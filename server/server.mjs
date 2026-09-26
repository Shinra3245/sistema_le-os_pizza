import http from 'node:http';
import { appendFile, chmod, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { configuredPizzaSizes, configuredProductCategories, menuFromSource, normalizeProductHierarchy, pizzaPriceForSubcategory, pizzaSizes, productSubcategory } from '../src/domain/menu-model.js';
import { cashCloseReportPdf, generalReportPdf } from './pdf-reports.mjs';
import { ValidationError, canonicalizeItems, cleanText, validateCatalog, validateCatalogCategories, validateOrderMetadata, validateRawMaterials, validateSettings } from './validation.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.join(appDir, 'dist');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(appDir, 'data');
const storePath = path.join(dataDir, 'restaurante.json');
const authPath = path.join(dataDir, 'auth.json');
const auditPath = path.join(dataDir, 'audit.jsonl');
const sourceMenuPath = path.join(appDir, 'seed', 'menu_completo.json');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};
const scrypt = promisify(scryptCallback);
const sessions = new Map();
const loginAttempts = new Map();
let mutationQueue = Promise.resolve();
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};
const kitchenStations = ['Pizzas', 'Platillos', 'Bebidas'];
const terminalOrderStatuses = new Set(['cerrado', 'cancelado', 'cerrado_turno']);
const isOpenOrder = order => !terminalOrderStatuses.has(order.status);
const normalizeStation = value => {
  const station = String(value || '').toLocaleLowerCase('es-MX');
  if (station.includes('pizza')) return 'Pizzas';
  if (station.includes('bebid')) return 'Bebidas';
  return 'Platillos';
};

function applyPizzaSizePricing(catalog, sizes) {
  const firstActive = sizes.find(size => size.active !== false) || sizes[0];
  return catalog.map(product => {
    if (product.kind === 'pizza') {
      const prices = Object.fromEntries(sizes.map(size => [size.id, pizzaPriceForSubcategory(size, productSubcategory(product))]));
      return { ...product, prices, price:prices[firstActive.id] };
    }
    if (product.kind === 'supplement') return { ...product, prices:Object.fromEntries(sizes.map(size => [size.id, size.cheeseRimPrice])), price:firstActive.cheeseRimPrice };
    return product;
  });
}

function validatePizzaSizes(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 12) throw new Error('Configura entre 1 y 12 tamaños de pizza.');
  const normalized = configuredPizzaSizes({ pizzaSizes:entries });
  const ids = new Set(); const names = new Set();
  for (const size of normalized) {
    const nameKey = size.name.toLocaleLowerCase('es-MX');
    if (!/^[a-z0-9_-]{2,30}$/.test(size.id) || !size.name || size.name.length > 40) throw new Error('Cada tamaño necesita un nombre válido.');
    if (ids.has(size.id) || names.has(nameKey)) throw new Error('No puede haber tamaños repetidos.');
    if (!Number.isFinite(size.basePrice) || size.basePrice <= 0 || size.basePrice > 10000) throw new Error(`El precio base de ${size.name} debe ser mayor a cero.`);
    const amounts = [size.adjustments.Especialidades, size.adjustments.Gourmet, size.cheeseRimPrice];
    if (amounts.some(amount => !Number.isFinite(amount) || amount < 0 || amount > 10000)) throw new Error(`Revisa los precios de ${size.name}.`);
    ids.add(size.id); names.add(nameKey);
  }
  if (!normalized.some(size => size.active !== false)) throw new Error('Debe permanecer al menos un tamaño habilitado.');
  return normalized;
}

async function loadStore() {
  const source = JSON.parse(await readFile(sourceMenuPath, 'utf8'));
  let current;
  try {
    current = JSON.parse(await readFile(storePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    current = {
      settings: {
        restaurantName: source.restaurante || 'Pizzas a la Leña',
        tableCount: 12, currency: 'MXN', paperWidth: '58mm',
        phone: '413-162-86-05',
        socialNote: 'WhatsApp, Facebook e Instagram: integración futura documentada.'
      },
      catalog: [], orders: [], cashSessions: [], rawMaterials: [], rawMaterialCategories: [], menuVersion: ''
    };
  }
  current.settings ||= {};
  current.settings.phone ||= '413-162-86-05';
  current.settings.tableCount ||= 12;
  current.settings.paperWidth ||= '58mm';
  const hadPizzaSizes = Array.isArray(current.settings.pizzaSizes) && current.settings.pizzaSizes.length > 0;
  current.settings.pizzaSizes = hadPizzaSizes ? configuredPizzaSizes(current.settings) : structuredClone(pizzaSizes);
  const standardPizzaDetails = new Map(pizzaSizes.map(size => [size.id,size.detail]));
  current.settings.pizzaSizes = current.settings.pizzaSizes.map(size => standardPizzaDetails.has(size.id) ? { ...size, detail:standardPizzaDetails.get(size.id) } : size);
  current.orders ||= [];
  current.cashSessions ||= [];
  current.catalog ||= [];
  current.rawMaterials ||= [];
  current.rawMaterialCategories ||= [];
  current.catalog = current.catalog.map(({ inventory: _legacyInventory, ...product }) => normalizeProductHierarchy(product));
  current.rawMaterials = current.rawMaterials.map(material => ({ id:material.id || randomUUID(), name:String(material.name || '').trim(), category:String(material.category || '').trim(), stock:Math.max(0, Number(material.stock) || 0) })).filter(material => material.name && material.category);
  current.rawMaterialCategories = [...new Set([...current.rawMaterialCategories.map(value => String(value).trim()), ...current.rawMaterials.map(material => material.category)].filter(Boolean))];
  current.orders = current.orders.map(order => {
    const items = (order.items || []).map(item => ({ ...item, station: normalizeStation(item.station || item.group) }));
    const tickets = kitchenStations.filter(station => items.some(item => item.station === station)).map(station => {
      const previous = (order.tickets || []).filter(ticket => normalizeStation(ticket.station) === station);
      const status = previous.some(ticket => ticket.status === 'pendiente') ? 'pendiente' : previous.some(ticket => ticket.status === 'preparando') ? 'preparando' : 'listo';
      return { station, status };
    });
    return { ...order, items, tickets };
  });
  const activeCashSessionIds = new Set(current.cashSessions.filter(session => session.status === 'abierta').map(session => session.id));
  const reconciledAt = new Date().toISOString();
  current.orders = current.orders.map(order => {
    if (!isOpenOrder(order) || activeCashSessionIds.has(order.cashSessionId)) return order;
    return {
      ...order,
      status:'cerrado_turno',
      closedAt:order.closedAt || reconciledAt,
      updatedAt:reconciledAt,
      closure:order.closure || {
        type:'reconciliacion_inicio',
        reason:'Pedido pendiente cerrado automáticamente porque su turno de caja ya no está abierto.',
        previousStatus:order.status
      }
    };
  });
  current.cashSessions = current.cashSessions.map(session => {
    if (session.status !== 'cerrada' || !session.report) return session;
    const sessionOrders = current.orders.filter(order => order.cashSessionId === session.id);
    return {
      ...session,
      report:{
        ...session.report,
        autoClosedOrders:sessionOrders.filter(order => order.status === 'cerrado_turno').length,
        openOrders:sessionOrders.filter(isOpenOrder).length
      }
    };
  });
  if (current.menuVersion !== (source.version || 'initial')) {
    const oldByIdentity = new Map(current.catalog.map(item => [`${item.category}|${String(item.name).toLocaleLowerCase('es-MX')}`, item]));
    const imported = menuFromSource(source).map(item => {
      const old = oldByIdentity.get(`${item.category}|${String(item.name).toLocaleLowerCase('es-MX')}`);
      return { ...item, ...(old?.active === false ? { active: false } : {}) };
    });
    const custom = current.catalog.filter(item => item.id?.startsWith('manual-'));
    current.catalog = [...imported, ...custom];
    current.menuVersion = source.version || 'initial';
  }
  if (!hadPizzaSizes) current.catalog = applyPizzaSizePricing(current.catalog, current.settings.pizzaSizes);
  current.settings.catalogCategories = configuredProductCategories(current.settings, current.catalog).map(({ builtin: _builtin, ...category }) => category);
  return current;
}

let store;
let authRecord = null;
let authSetupInProgress = false;
const serializeMutation = task => {
  const pending = mutationQueue.then(task, task);
  mutationQueue = pending.catch(() => undefined);
  return pending;
};

async function secureDataDirectory() {
  await mkdir(dataDir, { recursive:true, mode:0o700 });
  await chmod(dataDir, 0o700);
}

async function saveStore() {
  await secureDataDirectory();
  const tempPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(store, null, 2), { encoding:'utf8', mode:0o600 });
  await rename(tempPath, storePath);
  await chmod(storePath, 0o600);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendDownload(response, contentType, disposition, contents) {
  response.writeHead(200, {
    ...securityHeaders,
    'Content-Type': contentType,
    'Content-Disposition': disposition,
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache'
  });
  response.end(contents);
}

async function auditEvent(request, action, outcome, details = {}) {
  try {
    await secureDataDirectory();
    const session = sessionFor(request, { touch:false });
    const safeDetails = Object.fromEntries(Object.entries(details).slice(0, 12).map(([key, value]) => [cleanText(key, 50), cleanText(value, 240)]));
    const entry = {
      timestamp:new Date().toISOString(), action, outcome,
      user:session?.username || cleanText(details.username, 30) || null,
      source:request.socket.remoteAddress || 'local', details:safeDetails
    };
    await appendFile(auditPath, `${JSON.stringify(entry)}\n`, { encoding:'utf8', mode:0o600 });
    await chmod(auditPath, 0o600);
  } catch (error) {
    console.error('[audit] No se pudo registrar el evento:', error.message);
  }
}

function readSessionToken(request) {
  const cookie = request.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)pos_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] || '';
}

function sessionFor(request, { touch = true } = {}) {
  const token = readSessionToken(request);
  const session = sessions.get(token);
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt <= now || session.idleExpiresAt <= now) { sessions.delete(token); return null; }
  if (touch) session.idleExpiresAt = Math.min(session.expiresAt, now + 30 * 60 * 1000);
  return session;
}

function sessionIsValid(request) { return Boolean(sessionFor(request)); }

function users() { return authRecord?.users || []; }
function safeUser(user) { return { username: user.username, role: 'admin' }; }
function currentUser(request) {
  const session = sessionFor(request);
  return session ? { username: session.username, role: session.role || 'admin' } : null;
}
function can(request, ...allowed) {
  const user = currentUser(request);
  return Boolean(user && (user.role === 'admin' || allowed.includes(user.role)));
}
function requireRole(request, response, ...allowed) {
  if (can(request, ...allowed)) return true;
  void auditEvent(request, 'authorization.denied', 'failure', { path:request.url });
  sendJson(response, 403, { error: 'Tu usuario no tiene permiso para esta acción.' });
  return false;
}

function issueSession(response, request, user) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, { expiresAt: now + 8 * 60 * 60 * 1000, idleExpiresAt:now + 30 * 60 * 1000, csrfToken:randomBytes(32).toString('hex'), username: user.username, role: user.role || 'admin' });
  const secure = request.socket.encrypted ? '; Secure' : '';
  response.setHeader('Set-Cookie', `pos_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`);
}

const passwordIsSecure = password => typeof password === 'string' && password.length >= 10 && password.length <= 128 && /\p{Ll}/u.test(password) && /\p{Lu}/u.test(password) && /\d/u.test(password);
async function passwordMatches(user, password) {
  const candidate = await scrypt(typeof password === 'string' ? password : '', user?.salt || randomBytes(16).toString('hex'), 64);
  const expected = Buffer.from(user?.hash || '00'.repeat(64), 'hex');
  return Boolean(user && expected.length === candidate.length && timingSafeEqual(expected, candidate));
}

const loginKey = (request, username) => `${request.socket.remoteAddress || 'local'}|${String(username || '').toLocaleLowerCase('es-MX')}`;
function loginThrottle(request, username) {
  const key = loginKey(request, username);
  const state = loginAttempts.get(key);
  if (!state) return { key, retryAfter:0 };
  const now = Date.now();
  if (state.lockedUntil > now) return { key, retryAfter:Math.ceil((state.lockedUntil - now) / 1000) };
  if (now - state.startedAt > 15 * 60 * 1000) loginAttempts.delete(key);
  return { key, retryAfter:0 };
}
function registerLoginFailure(key) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  const state = !current || now - current.startedAt > 15 * 60 * 1000
    ? { failures:0, startedAt:now, lockedUntil:0 }
    : current;
  state.failures += 1;
  if (state.failures >= 5) state.lockedUntil = now + 15 * 60 * 1000;
  loginAttempts.set(key, state);
  return state.lockedUntil > now ? 15 * 60 : 0;
}

const mutationMethod = method => ['POST','PUT','PATCH','DELETE'].includes(method);
function requestOriginIsValid(request) {
  const origin = request.headers.origin;
  if (!origin) return !request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin';
  try {
    const parsed = new URL(origin);
    const protocol = request.socket.encrypted ? 'https:' : 'http:';
    return parsed.protocol === protocol && parsed.host === request.headers.host;
  } catch { return false; }
}
function csrfIsValid(request, session) {
  const token = String(request.headers['x-csrf-token'] || '');
  if (!/^[a-f0-9]{64}$/.test(token) || !session?.csrfToken) return false;
  return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(session.csrfToken, 'hex'));
}

const orderIsReady = order => Array.isArray(order.tickets) && order.tickets.length > 0 && order.tickets.every(ticket => ticket.status === 'listo');

function clearSession(request, response) {
  const token = readSessionToken(request);
  sessions.delete(token);
  response.setHeader('Set-Cookie', 'pos_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}

const activeCashSession = () => store.cashSessions.find(item => item.status === 'abierta') || null;
const cents = amount => Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
const orderSubtotal = order => (order.items || []).reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * Math.max(1, Number(item.quantity) || 1), 0);
function cashReport(session) {
  const sessionOrders = store.orders.filter(order => order.cashSessionId === session.id);
  const paidOrders = store.orders.filter(order => order.paid && order.payment?.cashSessionId === session.id);
  const payments = paidOrders.map(order => order.payment);
  const methodTotals = Object.fromEntries(['Efectivo', 'Tarjeta', 'Transferencia'].map(method => [method, cents(payments.filter(payment => payment.method === method).reduce((sum, payment) => sum + payment.total, 0))]));
  const cashSales = cents(payments.filter(payment => payment.method === 'Efectivo').reduce((sum, payment) => sum + payment.total, 0));
  const totalSales = cents(Object.values(methodTotals).reduce((sum, amount) => sum + amount, 0));
  const cardFees = cents(payments.reduce((sum, payment) => sum + (Number(payment.cardFee) || 0), 0));
  const tipTotals = Object.fromEntries(['Tarjeta', 'Transferencia'].map(method => [method, cents(payments.filter(payment => payment.method === method).reduce((sum, payment) => sum + (Number(payment.tip) || 0), 0))]));
  const tips = cents(Object.values(tipTotals).reduce((sum, amount) => sum + amount, 0));
  const salesSubtotal = cents(payments.reduce((sum, payment) => sum + (Number(payment.subtotal) || 0), 0));
  const expectedCash = cents(Number(session.openingCash) + cashSales);
  const expectedTurnTotal = cents(Number(session.openingCash) + totalSales);
  return {
    salesSubtotal, totalSales, cardFees, tips, tipTotals, methodTotals, cashSales, expectedCash, expectedTurnTotal,
    paidOrders: paidOrders.length, ordersTotal:sessionOrders.length,
    cancelledOrders:sessionOrders.filter(order => order.status === 'cancelado').length,
    autoClosedOrders:sessionOrders.filter(order => order.status === 'cerrado_turno').length,
    openOrders: sessionOrders.filter(isOpenOrder).length
  };
}

async function persistAuth(record) {
  await secureDataDirectory();
  const tempPath = `${authPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, authPath);
  await chmod(authPath, 0o600);
}

async function loadAuth() {
  try {
    const record = JSON.parse(await readFile(authPath, 'utf8'));
    if (record?.users) return { users: record.users.filter(user => !user.role || user.role === 'admin').map(user => ({ ...user, role: 'admin' })) };
    if (record?.username && record?.salt && record?.hash) return { users: [{ ...record, role: 'admin' }] };
    return null;
  }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function xml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]); }
function exportRows() { return store.orders.map(order => [order.number, new Date(order.createdAt).toLocaleString('es-MX'), order.type, order.table ? `Mesa ${order.table}` : order.customerName || '', order.status, orderSubtotal(order), order.payment?.method || '', order.payment?.total || 0]); }
function excelReport() {
  const rows = exportRows();
  const sheet = (name, headers, data) => `<Worksheet ss:Name="${xml(name)}"><Table><Row>${headers.map(value => `<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`).join('')}</Row>${data.map(row => `<Row>${row.map(value => `<Cell><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xml(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`;
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheet('Pedidos', ['Folio','Fecha','Servicio','Cliente o mesa','Estado','Subtotal','Pago','Total'], rows)}${sheet('Materias primas', ['Materia prima','Categoría','Existencias'], store.rawMaterials.map(material => [material.name, material.category, material.stock]))}</Workbook>`;
}
async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2_000_000) throw new ValidationError('La solicitud supera el límite permitido.', 413);
  }
  return body ? JSON.parse(body) : {};
}

async function serveStatic(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
  } catch {
    response.writeHead(400).end('Ruta inválida');
    return;
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (relative.split('/').some(part => part.startsWith('.'))) {
    response.writeHead(404).end('No encontrado');
    return;
  }
  const builtTarget = path.resolve(frontendDir, relative);
  if (!builtTarget.startsWith(`${frontendDir}${path.sep}`) && builtTarget !== frontendDir) {
    response.writeHead(403).end('Acceso denegado');
    return;
  }
  try {
    let target = builtTarget;
    let contents;
    try { contents = await readFile(target); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (path.extname(relative)) throw error;
      target = path.join(frontendDir, 'index.html');
      contents = await readFile(target);
    }
    response.writeHead(200, {
      ...securityHeaders,
      'Content-Type': mimeTypes[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': path.extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, securityHeaders).end('No se pudo abrir el recurso.');
  }
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  if (mutationMethod(request.method) && !requestOriginIsValid(request)) {
    await auditEvent(request, 'request.origin', 'failure', { path:pathname });
    return sendJson(response, 403, { error: 'El origen de la solicitud no está permitido.' });
  }
  if (request.method === 'GET' && pathname === '/api/auth/status') {
    sendJson(response, 200, { configured: users().length > 0, username: 'pizzas' });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/auth/setup') {
    const body = await readBody(request);
    if (users().length || authSetupInProgress) return sendJson(response, 409, { error: 'El acceso ya está configurado. Inicia sesión.' });
    if (body.username !== 'pizzas') return sendJson(response, 400, { error: 'El usuario inicial debe ser pizzas.' });
    if (!passwordIsSecure(body.password)) return sendJson(response, 400, { error: 'La contraseña debe tener entre 10 y 128 caracteres, con mayúscula, minúscula y número.' });
    authSetupInProgress = true;
    try {
      const salt = randomBytes(16).toString('hex');
      const hash = await scrypt(body.password, salt, 64);
      const record = { users: [{ username: 'pizzas', role: 'admin', salt, hash: hash.toString('hex') }] };
      await persistAuth(record);
      authRecord = record;
      issueSession(response, request, record.users[0]);
      await auditEvent(request, 'auth.setup', 'success', { username:'pizzas' });
      sendJson(response, 201, safeUser(record.users[0]));
    } finally { authSetupInProgress = false; }
    return;
  }
  if (request.method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(request);
    if (!users().length) return sendJson(response, 409, { error: 'Configura el acceso inicial antes de iniciar sesión.' });
    const username = String(body.username || '').trim().toLocaleLowerCase('es-MX');
    const throttle = loginThrottle(request, username);
    if (throttle.retryAfter) {
      response.setHeader('Retry-After', String(throttle.retryAfter));
      await auditEvent(request, 'auth.login', 'blocked', { username });
      return sendJson(response, 429, { error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.' });
    }
    const user = users().find(item => item.username === username);
    if (!await passwordMatches(user, body.password)) {
      const retryAfter = registerLoginFailure(throttle.key);
      await auditEvent(request, 'auth.login', 'failure', { username });
      if (retryAfter) response.setHeader('Retry-After', String(retryAfter));
      return sendJson(response, 401, { error: 'Usuario o contraseña incorrectos.' });
    }
    loginAttempts.delete(throttle.key);
    issueSession(response, request, user);
    await auditEvent(request, 'auth.login', 'success', { username });
    sendJson(response, 200, safeUser(user));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    const session = sessionFor(request);
    if (!session) return sendJson(response, 401, { error: 'Tu sesión terminó. Inicia sesión para continuar.' });
    if (!csrfIsValid(request, session)) return sendJson(response, 403, { error: 'La solicitud de seguridad no es válida. Actualiza la página.' });
    if (activeCashSession()) return sendJson(response, 409, { error: 'Registra el corte de caja antes de cerrar sesión.' });
    await auditEvent(request, 'auth.logout', 'success');
    clearSession(request, response);
    sendJson(response, 200, { ok: true });
    return;
  }
  const authenticatedSession = sessionFor(request);
  if (!authenticatedSession) return sendJson(response, 401, { error: 'Tu sesión terminó. Inicia sesión para continuar.' });
  if (mutationMethod(request.method) && !csrfIsValid(request, authenticatedSession)) {
    await auditEvent(request, 'request.csrf', 'failure', { path:pathname });
    return sendJson(response, 403, { error: 'La solicitud de seguridad no es válida. Actualiza la página.' });
  }
  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    const authSession = sessionFor(request);
    const closedCashSummary = authSession?.lastClosedCashSessionId ? store.cashSessions.find(item => item.id === authSession.lastClosedCashSessionId && item.status === 'cerrada') || null : null;
    sendJson(response, 200, { settings: store.settings, catalog: store.catalog, orders: store.orders, cashSessions: store.cashSessions, rawMaterials:store.rawMaterials, rawMaterialCategories:store.rawMaterialCategories, activeCashSession: activeCashSession(), closedCashSummary, currentUser: currentUser(request), users: can(request, 'admin') ? users().map(safeUser) : [], csrfToken:authenticatedSession.csrfToken });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/users') {
    if (!requireRole(request, response, 'admin')) return;
    const body = await readBody(request);
    const username = String(body.username || '').trim().toLocaleLowerCase('es-MX');
    if (!/^[a-z0-9._-]{3,30}$/i.test(username) || users().some(user => user.username === username)) return sendJson(response, 400, { error: 'Usa un usuario único de 3 a 30 caracteres.' });
    if (!passwordIsSecure(body.password)) return sendJson(response, 400, { error: 'La contraseña debe tener entre 10 y 128 caracteres, con mayúscula, minúscula y número.' });
    const salt = randomBytes(16).toString('hex'); const hash = await scrypt(body.password, salt, 64);
    const user = { username, role: 'admin', salt, hash: hash.toString('hex') };
    authRecord.users.push(user); await persistAuth(authRecord); await auditEvent(request, 'admin.create', 'success', { username }); sendJson(response, 201, safeUser(user)); return;
  }
  if (request.method === 'PUT' && pathname === '/api/users/password') {
    if (!requireRole(request, response, 'admin')) return;
    const body = await readBody(request);
    const actor = users().find(user => user.username === currentUser(request)?.username);
    if (!await passwordMatches(actor, body.currentPassword)) return sendJson(response, 401, { error: 'La contraseña actual no es correcta.' });
    const targetUsername = String(body.username || '').trim().toLocaleLowerCase('es-MX');
    const target = users().find(user => user.username === targetUsername);
    if (!target) return sendJson(response, 404, { error: 'No encontramos ese administrador.' });
    if (!passwordIsSecure(body.newPassword)) return sendJson(response, 400, { error: 'La nueva contraseña debe tener entre 10 y 128 caracteres, con mayúscula, minúscula y número.' });
    if (body.newPassword === body.currentPassword && target.username === actor.username) return sendJson(response, 400, { error: 'La nueva contraseña debe ser diferente de la actual.' });
    const salt = randomBytes(16).toString('hex'); const hash = await scrypt(body.newPassword, salt, 64);
    target.salt = salt; target.hash = hash.toString('hex'); target.role = 'admin';
    await persistAuth(authRecord);
    const currentToken = readSessionToken(request);
    for (const [token, session] of sessions) if (session.username === target.username && token !== currentToken) sessions.delete(token);
    await auditEvent(request, 'admin.password_change', 'success', { username:target.username });
    sendJson(response, 200, { user:safeUser(target) });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/cash/open') {
    if (!requireRole(request, response, 'admin')) return;
    if (activeCashSession()) return sendJson(response, 409, { error: 'Ya hay una caja abierta. Reanuda ese turno.' });
    const body = await readBody(request);
    const openingCash = Number(body.openingCash);
    if (!Number.isSafeInteger(openingCash) || openingCash < 0 || openingCash > 1_000_000) return sendJson(response, 400, { error: 'Escribe un fondo inicial en pesos, sin centavos.' });
    const session = {
      id: randomUUID(), status: 'abierta', openingCash, openedAt: new Date().toISOString(),
      openedBy: sessionFor(request)?.username || 'pizzas', note: String(body.note || '').trim().slice(0, 240)
    };
    store.cashSessions.unshift(session);
    await saveStore();
    await auditEvent(request, 'cash.open', 'success', { cashSessionId:session.id, openingCash });
    sendJson(response, 201, { session });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/cash/close') {
    if (!requireRole(request, response, 'admin')) return;
    const session = activeCashSession();
    if (!session) return sendJson(response, 409, { error: 'No hay una caja abierta para cortar.' });
    const body = await readBody(request);
    const countedCash = Number(body.countedCash);
    if (!Number.isSafeInteger(countedCash) || countedCash < 0 || countedCash > 1_000_000) return sendJson(response, 400, { error: 'Escribe el efectivo contado en pesos, sin centavos.' });
    const openOrders = store.orders.filter(order => order.cashSessionId === session.id && isOpenOrder(order));
    const closedAt = new Date().toISOString();
    const closedBy = sessionFor(request)?.username || 'pizzas';
    for (const order of openOrders) {
      const previousStatus = order.status;
      order.status = 'cerrado_turno';
      order.closedAt = closedAt;
      order.updatedAt = closedAt;
      order.closure = {
        type:'corte_caja',
        reason:'Pedido pendiente cerrado automáticamente al finalizar el turno.',
        previousStatus,
        closedBy
      };
    }
    const report = cashReport(session);
    session.status = 'cerrada';
    session.closedAt = closedAt;
    session.closedBy = closedBy;
    session.countedCash = countedCash;
    session.report = { ...report, countedCash, difference: cents(countedCash - report.expectedCash) };
    const authSession = sessionFor(request); if (authSession) authSession.lastClosedCashSessionId = session.id;
    await saveStore();
    await auditEvent(request, 'cash.close', 'success', { cashSessionId:session.id, countedCash, difference:session.report.difference, autoClosedOrders:openOrders.length });
    sendJson(response, 200, { session, report: session.report });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/cash/close/acknowledge') {
    if (!requireRole(request, response, 'admin')) return;
    const authSession = sessionFor(request); if (authSession) delete authSession.lastClosedCashSessionId;
    sendJson(response, 200, { ok:true });
    return;
  }
  if (request.method === 'PUT' && pathname === '/api/settings') {
    if (!requireRole(request, response, 'admin')) return;
    const settings = await readBody(request);
    store.settings = validateSettings(settings, store.settings);
    await saveStore();
    await auditEvent(request, 'settings.update', 'success');
    sendJson(response, 200, store.settings);
    return;
  }
  if (request.method === 'PUT' && pathname === '/api/pizza-sizes') {
    if (!requireRole(request, response, 'admin')) return;
    const body = await readBody(request);
    try {
      const sizes = validatePizzaSizes(body.pizzaSizes);
      store.settings.pizzaSizes = sizes;
      store.catalog = applyPizzaSizePricing(store.catalog, sizes);
      await saveStore();
      await auditEvent(request, 'pizza_sizes.update', 'success', { count:sizes.length });
      sendJson(response, 200, { pizzaSizes:sizes, catalog:store.catalog });
    } catch (error) {
      sendJson(response, 400, { error:error.message });
    }
    return;
  }
  if (request.method === 'PUT' && pathname === '/api/catalog') {
    if (!requireRole(request, response, 'admin')) return;
    const body = await readBody(request);
    store.catalog = validateCatalog(body.catalog, store.settings.catalogCategories);
    await saveStore();
    await auditEvent(request, 'catalog.update', 'success', { count:store.catalog.length });
    sendJson(response, 200, store.catalog);
    return;
  }
  if (request.method === 'PUT' && pathname === '/api/catalog-categories') {
    if (!requireRole(request, response, 'admin')) return;
    const body = await readBody(request);
    store.settings.catalogCategories = validateCatalogCategories(body.categories, store.catalog);
    await saveStore();
    await auditEvent(request, 'catalog_categories.update', 'success', { count:store.settings.catalogCategories.length });
    sendJson(response, 200, store.settings.catalogCategories);
    return;
  }
  if (request.method === 'PUT' && pathname === '/api/raw-materials') {
    if (!requireRole(request, response, 'admin')) return;
    const body = await readBody(request);
    const validated = validateRawMaterials(body.rawMaterials, [...(store.rawMaterialCategories || []), ...(Array.isArray(body.categories) ? body.categories : [])]);
    store.rawMaterials = validated.materials;
    store.rawMaterialCategories = validated.categories;
    await saveStore();
    await auditEvent(request, 'inventory.update', 'success', { count:store.rawMaterials.length });
    sendJson(response, 200, { rawMaterials:store.rawMaterials, categories:store.rawMaterialCategories });
    return;
  }
  if (request.method === 'POST' && pathname === '/api/orders') {
    if (!requireRole(request, response, 'admin')) return;
    const body = await readBody(request);
    const cash = activeCashSession();
    if (!cash) return sendJson(response, 409, { error: 'Abre la caja antes de registrar pedidos.' });
    const metadata = validateOrderMetadata(body, store.settings, store.orders);
    const items = canonicalizeItems(body.items, store.catalog, store.settings);
    const now = new Date().toISOString();
    const order = {
      ...metadata,
      items,
      cashSessionId: cash.id,
      id: randomUUID(),
      number: store.orders.reduce((max, item) => Math.max(max, Number(item.number) || 0), 0) + 1,
      createdAt: now,
      status: 'nuevo',
      tickets: kitchenStations.filter(station => items.some(item => item.station === station)).map(station => ({ station, status: 'pendiente' })),
      inventoryMovements: []
    };
    store.orders.unshift(order);
    await saveStore();
    await auditEvent(request, 'order.create', 'success', { orderId:order.id, number:order.number, type:order.type });
    sendJson(response, 201, order);
    return;
  }
  const orderMatch = pathname.match(/^\/api\/orders\/([\w-]+)$/);
  if (orderMatch && request.method === 'PATCH') {
    const body = await readBody(request);
    const order = store.orders.find(item => item.id === orderMatch[1]);
    if (!order) return sendJson(response, 404, { error: 'No encontramos esa comanda.' });
    if (!requireRole(request, response, 'admin')) return;
    const commands = [body.addItems === true, Boolean(body.cancellation), body.finishAllTickets === true, Boolean(body.ticketStation), body.dispatchDelivery === true, Boolean(body.payment)].filter(Boolean);
    if (commands.length !== 1) return sendJson(response, 400, { error: 'Envía una sola acción válida para el pedido.' });
    if (body.addItems) {
      if (Object.keys(body).some(key => !['addItems','items'].includes(key))) return sendJson(response, 400, { error: 'La solicitud contiene campos que no corresponden a agregar partidas.' });
      if (!isOpenOrder(order) || order.paid || order.status === 'en_ruta') return sendJson(response, 409, { error: 'Solo puedes agregar partidas antes de cerrar o enviar el pedido.' });
      const additions = canonicalizeItems(body.items, store.catalog, store.settings);
      order.items.push(...additions);
      kitchenStations.forEach(station => { if (additions.some(item => item.station === station)) { const ticket = order.tickets.find(item => normalizeStation(item.station) === station); if (ticket) ticket.status = 'pendiente'; else order.tickets.push({ station, status: 'pendiente' }); } });
      await auditEvent(request, 'order.add_items', 'success', { orderId:order.id, items:additions.length });
    }
    if (body.cancellation) {
      if (Object.keys(body).some(key => key !== 'cancellation')) return sendJson(response, 400, { error: 'La solicitud contiene campos que no corresponden a cancelar.' });
      const reason = String(body.cancellation.reason || '').trim().slice(0, 280);
      if (!reason) return sendJson(response, 400, { error: 'Escribe el motivo de la cancelación.' });
      if (order.status === 'cancelado') return sendJson(response, 409, { error: 'Este pedido ya fue cancelado.' });
      if (order.paid) {
        const cash = activeCashSession();
        if (!cash || order.payment?.cashSessionId !== cash.id) return sendJson(response, 409, { error: 'No puedes reembolsar un cobro perteneciente a un corte ya cerrado.' });
      }
      order.cancellation = { reason, cancelledAt: new Date().toISOString(), cancelledBy: currentUser(request).username, refunded: Boolean(order.paid), refundAmount: order.paid ? Number(order.payment?.total || 0) : 0 };
      if (order.paid) order.refund = { ...order.cancellation, refundedAt: new Date().toISOString() };
      order.paid = false; order.status = 'cancelado';
      await auditEvent(request, 'order.cancel', 'success', { orderId:order.id, reason, refunded:order.cancellation.refunded });
    }
    if (body.ticketStation) {
      if (Object.keys(body).some(key => !['ticketStation','status'].includes(key)) || body.status !== 'listo') return sendJson(response, 400, { error: 'La estación solo puede marcarse como terminada.' });
      if (!isOpenOrder(order) || order.status === 'en_ruta') return sendJson(response, 409, { error: 'La preparación de este pedido ya no se puede modificar.' });
      const ticket = order.tickets.find(item => normalizeStation(item.station) === normalizeStation(body.ticketStation));
      if (!ticket) return sendJson(response, 404, { error: 'No encontramos ese grupo de cocina.' });
      ticket.status = 'listo';
      ticket.updatedAt = new Date().toISOString();
      await auditEvent(request, 'order.station_ready', 'success', { orderId:order.id, station:ticket.station });
    }
    if (body.finishAllTickets) {
      if (Object.keys(body).some(key => key !== 'finishAllTickets')) return sendJson(response, 400, { error: 'La solicitud contiene campos que no corresponden a terminar la preparación.' });
      if (!isOpenOrder(order) || order.status === 'en_ruta') return sendJson(response, 409, { error: 'La preparación de este pedido ya no se puede modificar.' });
      const updatedAt = new Date().toISOString();
      order.tickets.forEach(ticket => { ticket.status = 'listo'; ticket.updatedAt = updatedAt; });
      await auditEvent(request, 'order.preparation_ready', 'success', { orderId:order.id });
    }
    if (body.dispatchDelivery) {
      if (Object.keys(body).some(key => key !== 'dispatchDelivery')) return sendJson(response, 400, { error: 'La solicitud contiene campos que no corresponden a la salida a domicilio.' });
      if (order.type !== 'domicilio' || order.paid || order.status === 'en_ruta' || !orderIsReady(order)) return sendJson(response, 409, { error: 'Solo un domicilio preparado y pendiente de pago puede salir a reparto.' });
      order.status = 'en_ruta';
      order.dispatchedAt = new Date().toISOString();
      await auditEvent(request, 'order.dispatch', 'success', { orderId:order.id });
    }
    if (body.payment) {
      if (Object.keys(body).some(key => key !== 'payment')) return sendJson(response, 400, { error: 'La solicitud contiene campos que no corresponden al pago.' });
      const cash = activeCashSession();
      if (!cash) return sendJson(response, 409, { error: 'Abre la caja antes de cobrar pedidos.' });
      if (order.cashSessionId !== cash.id) return sendJson(response, 409, { error: 'El pedido pertenece a otro turno de caja.' });
      if (order.payment?.paidAt) return sendJson(response, 409, { error: 'Este pedido ya tiene un pago registrado.' });
      if (!orderIsReady(order)) return sendJson(response, 409, { error: 'Termina toda la preparación antes de cobrar.' });
      if (order.type === 'domicilio' && order.status !== 'en_ruta') return sendJson(response, 409, { error: 'Marca la salida a domicilio antes de liquidar al repartidor.' });
      if (order.type !== 'domicilio' && !['nuevo','abierto','listo'].includes(order.status)) return sendJson(response, 409, { error: 'El pedido no está disponible para cobro.' });
      const method = body.payment.method;
      if (!['Efectivo', 'Tarjeta', 'Transferencia'].includes(method)) return sendJson(response, 400, { error: 'Selecciona una forma de pago válida.' });
      const subtotal = cents(orderSubtotal(order));
      const tipType = method === 'Efectivo' ? 'ninguna' : (body.payment.tipType || 'ninguna');
      const tipValue = tipType === 'ninguna' ? 0 : Number(body.payment.tipValue);
      if (tipType !== 'ninguna' && !['porcentaje', 'cantidad'].includes(tipType)) return sendJson(response, 400, { error: 'Selecciona porcentaje, cantidad fija o sin propina.' });
      if (!Number.isFinite(tipValue) || tipValue < 0 || tipValue > 100_000 || (tipType === 'cantidad' && !Number.isSafeInteger(tipValue)) || (tipType === 'porcentaje' && tipValue > 100)) return sendJson(response, 400, { error: 'Revisa el monto de la propina.' });
      const cardFee = method === 'Tarjeta' ? Math.round(subtotal * 0.04) : 0;
      const tip = tipType === 'porcentaje' ? Math.round(subtotal * tipValue / 100) : (tipType === 'cantidad' ? tipValue : 0);
      const total = cents(subtotal + cardFee + tip);
      const received = method === 'Efectivo' ? Number(body.payment.received) : total;
      if (!Number.isSafeInteger(received) || received < total) return sendJson(response, 400, { error: 'El monto recibido debe cubrir el total.' });
      order.payment = {
        method, subtotal, cardFee, tip, tipType, tipValue,
        received, change: method === 'Efectivo' ? received - total : 0, total,
        paidAt: new Date().toISOString(), cashSessionId: cash.id
      };
      order.paid = true;
      order.status = 'cerrado';
      await auditEvent(request, 'order.payment', 'success', { orderId:order.id, method, total });
    }
    order.updatedAt = new Date().toISOString();
    await saveStore();
    sendJson(response, 200, order);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/export') {
    if (!requireRole(request, response, 'admin')) return;
    await auditEvent(request, 'export.json', 'success');
    sendDownload(response, 'application/json; charset=utf-8', `attachment; filename="pizzas-a-la-lena-respaldo-${new Date().toISOString().slice(0, 10)}.json"`, JSON.stringify({ exportedAt: new Date().toISOString(), ...store }, null, 2));
    return;
  }
  const cashPdfMatch = pathname.match(/^\/api\/cash-sessions\/([\w-]+)\/report\.pdf$/);
  if (request.method === 'GET' && cashPdfMatch) {
    if (!requireRole(request, response, 'admin')) return;
    const session = store.cashSessions.find(item => item.id === cashPdfMatch[1] && item.status === 'cerrada');
    if (!session) return sendJson(response, 404, { error: 'No encontramos ese corte de caja.' });
    const report = session.report || cashReport(session);
    const orders = store.orders.filter(order => order.cashSessionId === session.id).sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
    await auditEvent(request, 'cash.report_pdf', 'success', { cashSessionId:session.id });
    sendDownload(response, 'application/pdf', `attachment; filename="corte-caja-${new Date(session.closedAt).toISOString().slice(0,10)}.pdf"`, cashCloseReportPdf({ settings:store.settings, session, report, orders })); return;
  }
  if (request.method === 'GET' && pathname === '/api/export/excel') {
    if (!requireRole(request, response, 'admin')) return;
    await auditEvent(request, 'export.excel', 'success');
    sendDownload(response, 'application/vnd.ms-excel; charset=utf-8', `attachment; filename="pizzas-a-la-lena-reporte-${new Date().toISOString().slice(0,10)}.xls"`, excelReport()); return;
  }
  if (request.method === 'GET' && pathname === '/api/export/pdf') {
    if (!requireRole(request, response, 'admin')) return;
    await auditEvent(request, 'export.pdf', 'success');
    sendDownload(response, 'application/pdf', `attachment; filename="pizzas-a-la-lena-reporte-${new Date().toISOString().slice(0,10)}.pdf"`, generalReportPdf({ settings:store.settings, orders:store.orders, rawMaterials:store.rawMaterials })); return;
  }
  sendJson(response, 404, { error: 'Ruta de API no encontrada.' });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      return mutationMethod(request.method)
        ? await serializeMutation(() => handleApi(request, response, url))
        : await handleApi(request, response, url);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, securityHeaders).end('Método no permitido');
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error instanceof ValidationError ? error.status : 500;
    sendJson(response, status, {
      error: error instanceof SyntaxError ? 'El contenido enviado no es JSON válido.' : error instanceof ValidationError ? error.message : 'No se pudo completar la operación.'
    });
    console.error(`[error] ${request.method} ${request.url}:`, error.message);
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

store = await loadStore();
authRecord = await loadAuth();
await saveStore();
server.listen(port, host, () => {
  console.log(`Pizzas a la Leña listo en http://${host}:${port}`);
  console.log('Los pedidos, la carta y los ajustes se guardan localmente en sistema_web/data/restaurante.json');
});
