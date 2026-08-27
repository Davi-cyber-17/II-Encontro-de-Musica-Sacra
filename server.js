/*
 * BACKEND REAL — II Encontro de Música Sacra (IBBVBM)
 * Node/Express + SQLite (better-sqlite3), com upload de comprovantes em disco.
 *
 * Este servidor implementa EXATAMENTE os mesmos endpoints que o antigo
 * local-api.js simulava no navegador — só que agora os dados ficam num
 * banco de verdade, compartilhado entre todos os visitantes.
 *
 * Ele também serve os arquivos estáticos do site (pasta /public), então
 * front-end e back-end rodam na mesma origem — não precisa configurar CORS
 * nem trocar nenhuma URL relativa (/api/...) no script.js.
 */
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'ibbvbm.sqlite'));
db.pragma('journal_mode = WAL');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  userId TEXT,
  expiresAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL,
  total REAL NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  paymentProofOriginalName TEXT,
  paymentProofMimetype TEXT,
  paymentProofUploadedAt TEXT,
  paymentProofPath TEXT
);
CREATE TABLE IF NOT EXISTS shirt_orders (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unitPrice REAL NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  salt TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  identifier TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  lockedUntil INTEGER NOT NULL DEFAULT 0
);
`);

const DEFAULT_CONFIG = {
  pricing: {
    oneDay: 40,
    twoDays: 50,
    earlyBird: 70,
    regular: 85,
    earlyBirdDeadline: '2026-04-30'
  },
  paymentInstructions: 'O comprovante deve estar legível e ser referente ao valor total da inscrição.',
  vacancies: { Soprano: 15, Contralto: 15, Tenor: 15, Baixo: 15, Orquestra: 15 }
};
if (!db.prepare('SELECT 1 FROM config WHERE id = 1').get()) {
  db.prepare('INSERT INTO config (id, json) VALUES (1, ?)').run(JSON.stringify(DEFAULT_CONFIG));
}

// ---------- Helpers ----------
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 2 * 60 * 1000;
const USER_SESSION_MS = 12 * 60 * 60 * 1000;
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_PROOF_BYTES = 8 * 1024 * 1024;

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeCredential(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, passwordHash: hashPassword(password, salt) };
}
function verifyCredential(password, salt, passwordHash) {
  const attempt = hashPassword(password, salt);
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function loginGate(identifier) {
  const entry = db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(identifier);
  if (entry && entry.lockedUntil > Date.now()) {
    return { blocked: true, secondsLeft: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  return { blocked: false };
}
function registerLoginFailure(identifier) {
  const entry = db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(identifier) || { count: 0, lockedUntil: 0 };
  let count = entry.count + 1;
  let lockedUntil = entry.lockedUntil;
  if (count >= LOGIN_MAX_ATTEMPTS) { lockedUntil = Date.now() + LOGIN_LOCKOUT_MS; count = 0; }
  db.prepare('INSERT INTO login_attempts (identifier, count, lockedUntil) VALUES (?,?,?) ON CONFLICT(identifier) DO UPDATE SET count=excluded.count, lockedUntil=excluded.lockedUntil')
    .run(identifier, count, lockedUntil);
}
function clearLoginFailures(identifier) {
  db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(identifier);
}

function getConfig() {
  const row = db.prepare('SELECT json FROM config WHERE id = 1').get();
  const c = row ? JSON.parse(row.json) : {};
  return {
    ...DEFAULT_CONFIG, ...c,
    pricing: { ...DEFAULT_CONFIG.pricing, ...(c.pricing || {}) },
    vacancies: { ...DEFAULT_CONFIG.vacancies, ...(c.vacancies || {}) }
  };
}
function saveConfig(next) {
  db.prepare('UPDATE config SET json = ? WHERE id = 1').run(JSON.stringify(next));
}

function categoryOf(data) {
  if (data?.coroOrq === 'cantar' && ['Soprano', 'Contralto', 'Tenor', 'Baixo'].includes(data.naipe)) return data.naipe;
  if (data?.coroOrq === 'instrumento') return 'Orquestra';
  return null;
}

function calcRegistrationTotal(numDias, pricing) {
  const p = pricing || DEFAULT_CONFIG.pricing;
  if (numDias <= 0) return 0;
  if (numDias === 1) return Number(p.oneDay);
  if (numDias === 2) return Number(p.twoDays);
  const deadline = new Date(`${p.earlyBirdDeadline}T23:59:59`);
  const isEarly = new Date() <= deadline;
  return Number(isEarly ? p.earlyBird : p.regular);
}

function availability() {
  const regs = db.prepare('SELECT data FROM registrations').all().map(r => JSON.parse(r.data));
  const config = getConfig();
  const used = Object.fromEntries(Object.keys(config.vacancies).map(k => [k, 0]));
  regs.forEach(data => {
    const c = categoryOf(data);
    if (c && used[c] !== undefined) used[c]++;
  });
  return Object.keys(config.vacancies).map(k => {
    const limit = Math.max(0, Number(config.vacancies[k] ?? 15));
    const occupied = used[k] || 0;
    return { [k]: { limit, occupied, remaining: Math.max(0, limit - occupied), full: occupied >= limit } };
  }).reduce((a, b) => Object.assign(a, b), {});
}

function rowToRegistration(row) {
  const data = JSON.parse(row.data);
  const paymentProof = row.paymentProofPath ? {
    originalName: row.paymentProofOriginalName,
    mimetype: row.paymentProofMimetype,
    uploadedAt: row.paymentProofUploadedAt
  } : null;
  return {
    id: row.id, data, status: row.status, total: row.total,
    createdAt: row.createdAt, updatedAt: row.updatedAt, paymentProof
  };
}
function safeReg(reg) {
  return { ...reg, paymentProofUrl: reg.paymentProof ? `/api/admin/proof/${encodeURIComponent(reg.id)}` : null };
}

function publicUser(u) { return { id: u.id, name: u.name, email: u.email }; }

function authToken(req) {
  const h = req.headers['authorization'] || '';
  return h.replace(/^Bearer\s+/i, '').trim();
}
function currentUser(req) {
  const token = authToken(req);
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session || session.type !== 'user' || session.expiresAt < Date.now()) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) || null;
}
function currentAdmin(req) {
  const token = authToken(req);
  if (!token) return false;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  return !!(session && session.type === 'admin' && session.expiresAt >= Date.now());
}
function createSession(type, userId, ttlMs) {
  const token = uid(type === 'admin' ? 'ADMIN' : 'TOKEN');
  db.prepare('INSERT INTO sessions (token, type, userId, expiresAt) VALUES (?,?,?,?)')
    .run(token, type, userId || null, Date.now() + ttlMs);
  return token;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${uid('PROOF')}${path.extname(file.originalname || '').slice(0, 10)}`)
  }),
  limits: { fileSize: MAX_PROOF_BYTES }
});

const api = express.Router();

// ---- Auth ----
api.post('/auth/signup', (req, res) => {
  const { name = '', email = '', password = '' } = req.body || {};
  const n = String(name).trim();
  const e = String(email).trim().toLowerCase();
  const p = String(password);
  if (n.length < 2 || n.length > 120) return res.status(400).json({ error: 'Informe seu nome completo.' });
  if (!EMAIL_RE.test(e)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (p.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(e)) return res.status(409).json({ error: 'Este e-mail já possui uma conta.' });
  const { salt, passwordHash } = makeCredential(p);
  const newUser = { id: uid('USR'), name: n, email: e, salt, passwordHash, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO users (id,name,email,salt,passwordHash,createdAt) VALUES (@id,@name,@email,@salt,@passwordHash,@createdAt)').run(newUser);
  const token = createSession('user', newUser.id, USER_SESSION_MS);
  res.status(201).json({ token, user: publicUser(newUser) });
});

api.post('/auth/login', (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const e = String(email).trim().toLowerCase();
  const p = String(password);
  const gate = loginGate(`user:${e}`);
  if (gate.blocked) return res.status(429).json({ error: `Muitas tentativas. Tente novamente em ${gate.secondsLeft}s.` });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
  const ok = u && verifyCredential(p, u.salt, u.passwordHash);
  if (!ok) { registerLoginFailure(`user:${e}`); return res.status(401).json({ error: 'E-mail ou senha inválidos.' }); }
  clearLoginFailures(`user:${e}`);
  const token = createSession('user', u.id, USER_SESSION_MS);
  res.json({ token, user: publicUser(u) });
});

api.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  res.json({ user: publicUser(user) });
});

api.post('/auth/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(authToken(req));
  res.json({ ok: true });
});

// ---- Public config ----
api.get('/config', (req, res) => res.json({ ...getConfig(), availability: availability() }));
api.get('/availability', (req, res) => res.json(availability()));

// ---- Shirt orders ----
api.post('/shirt-orders', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  const { size = '', quantity, name = user.name } = req.body || {};
  const qty = Number(quantity);
  const nm = String(name).trim();
  if (!['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG'].includes(size)) return res.status(400).json({ error: 'Tamanho de camiseta inválido.' });
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) return res.status(400).json({ error: 'Quantidade inválida.' });
  if (nm.length < 2 || nm.length > 120) return res.status(400).json({ error: 'Nome inválido.' });
  const order = {
    id: uid('CAM'), userId: user.id, name: nm, email: user.email, size, quantity: qty,
    unitPrice: 59.90, total: Number((qty * 59.90).toFixed(2)), status: 'pending', createdAt: new Date().toISOString()
  };
  db.prepare('INSERT INTO shirt_orders (id,userId,name,email,size,quantity,unitPrice,total,status,createdAt) VALUES (@id,@userId,@name,@email,@size,@quantity,@unitPrice,@total,@status,@createdAt)').run(order);
  res.status(201).json({ order });
});

api.get('/my-shirt-orders', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sessão expirada.' });
  const orders = db.prepare('SELECT * FROM shirt_orders WHERE userId = ?').all(user.id);
  res.json({ orders });
});

api.get('/my-registration', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sessão expirada.' });
  const row = db.prepare('SELECT * FROM registrations WHERE email = ?').get(user.email);
  res.json({ registration: row ? safeReg(rowToRegistration(row)) : null });
});

// ---- Registration ----
api.post('/register', upload.single('paymentProof'), (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });

  let data;
  try { data = JSON.parse(req.body?.data || '{}'); } catch (_) {
    return res.status(400).json({ error: 'Dados da inscrição inválidos.' });
  }
  data.email = user.email;
  data.nome = data.nome || user.name;
  if (!data.nome || data.nome.length < 2 || data.nome.length > 120) return res.status(400).json({ error: 'Informe um nome válido.' });
  if (!Array.isArray(data.dias) || !data.dias.length) return res.status(400).json({ error: 'Selecione ao menos um dia válido.' });
  if (!['sim', 'nao'].includes(data.isMember)) return res.status(400).json({ error: 'Informe se você é membro da IBBVBM.' });
  if (data.coroOrq === 'cantar' && !['Soprano', 'Contralto', 'Tenor', 'Baixo'].includes(data.naipe)) return res.status(400).json({ error: 'Selecione um naipe válido.' });
  if (data.coroOrq === 'instrumento' && !data.instrumento) return res.status(400).json({ error: 'Selecione um instrumento.' });

  const file = req.file;
  if (data.isMember !== 'sim' && !file) return res.status(400).json({ error: 'Anexe o comprovante de pagamento.' });

  const existing = db.prepare('SELECT * FROM registrations WHERE email = ?').get(user.email);
  const requestedId = String(req.body?.registrationId || '').trim();
  const id = requestedId || (existing ? existing.id : uid('IMS26'));
  const existingById = db.prepare('SELECT * FROM registrations WHERE id = ?').get(id);
  if (existingById && JSON.parse(existingById.data)?.email !== user.email) {
    return res.status(403).json({ error: 'Esta inscrição pertence a outra conta.' });
  }

  const selectedCategory = categoryOf(data);
  if (selectedCategory) {
    const av = availability();
    const oldCategory = existingById ? categoryOf(JSON.parse(existingById.data)) : null;
    if (av[selectedCategory]?.full && oldCategory !== selectedCategory) {
      return res.status(409).json({ error: `As vagas para ${selectedCategory} acabaram.`, category: selectedCategory, availability: av });
    }
  }

  const now = new Date().toISOString();
  let proofName = existingById?.paymentProofOriginalName || null;
  let proofMime = existingById?.paymentProofMimetype || null;
  let proofUploadedAt = existingById?.paymentProofUploadedAt || null;
  let proofPath = existingById?.paymentProofPath || null;
  if (data.isMember === 'sim') { proofName = proofMime = proofUploadedAt = proofPath = null; }
  if (file) {
    if (proofPath) { try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(proofPath))); } catch (_) {} }
    proofName = file.originalname; proofMime = file.mimetype; proofUploadedAt = now; proofPath = file.filename;
  }

  const config = getConfig();
  const total = Number(calcRegistrationTotal(data.dias.length, config.pricing).toFixed(2));
  const status = data.isMember === 'sim' ? 'confirmed_member' : 'confirmed_payment';
  const createdAt = existingById ? existingById.createdAt : now;

  db.prepare(`INSERT INTO registrations (id,email,data,status,total,createdAt,updatedAt,paymentProofOriginalName,paymentProofMimetype,paymentProofUploadedAt,paymentProofPath)
    VALUES (@id,@email,@data,@status,@total,@createdAt,@updatedAt,@proofName,@proofMime,@proofUploadedAt,@proofPath)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, data=excluded.data, status=excluded.status, total=excluded.total,
      updatedAt=excluded.updatedAt, paymentProofOriginalName=excluded.paymentProofOriginalName,
      paymentProofMimetype=excluded.paymentProofMimetype, paymentProofUploadedAt=excluded.paymentProofUploadedAt,
      paymentProofPath=excluded.paymentProofPath`).run({
    id, email: user.email, data: JSON.stringify(data), status, total, createdAt, updatedAt: now,
    proofName, proofMime, proofUploadedAt, proofPath
  });

  const row = db.prepare('SELECT * FROM registrations WHERE id = ?').get(id);
  res.json({ ok: true, registration: safeReg(rowToRegistration(row)) });
});

// ---- Admin ----
api.get('/admin/setup-status', (req, res) => {
  res.json({ configured: !!db.prepare('SELECT 1 FROM admin WHERE id = 1').get() });
});

api.post('/admin/setup', (req, res) => {
  if (db.prepare('SELECT 1 FROM admin WHERE id = 1').get()) return res.status(409).json({ error: 'A conta de administrador já foi configurada.' });
  const { email = '', password = '' } = req.body || {};
  const e = String(email).trim().toLowerCase();
  const p = String(password);
  if (!EMAIL_RE.test(e)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (p.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
  const { salt, passwordHash } = makeCredential(p);
  db.prepare('INSERT INTO admin (id,email,salt,passwordHash,createdAt) VALUES (1,?,?,?,?)').run(e, salt, passwordHash, new Date().toISOString());
  const token = createSession('admin', null, ADMIN_SESSION_MS);
  res.status(201).json({ token });
});

api.post('/admin/login', (req, res) => {
  const account = db.prepare('SELECT * FROM admin WHERE id = 1').get();
  if (!account) return res.status(409).json({ error: 'Nenhuma conta de administrador configurada.', needsSetup: true });
  const { email = '', password = '' } = req.body || {};
  const e = String(email).trim().toLowerCase();
  const p = String(password);
  const gate = loginGate('admin');
  if (gate.blocked) return res.status(429).json({ error: `Muitas tentativas. Tente novamente em ${gate.secondsLeft}s.` });
  const ok = e === account.email && verifyCredential(p, account.salt, account.passwordHash);
  if (!ok) { registerLoginFailure('admin'); return res.status(401).json({ error: 'E-mail ou senha de administrador inválidos.' }); }
  clearLoginFailures('admin');
  const token = createSession('admin', null, ADMIN_SESSION_MS);
  res.json({ token });
});

api.post('/admin/change-password', (req, res) => {
  if (!currentAdmin(req)) return res.status(401).json({ error: 'Sessão administrativa expirada.' });
  const account = db.prepare('SELECT * FROM admin WHERE id = 1').get();
  if (!account) return res.status(409).json({ error: 'Nenhuma conta de administrador configurada.' });
  const { currentPassword = '', newPassword = '' } = req.body || {};
  if (!verifyCredential(String(currentPassword), account.salt, account.passwordHash)) return res.status(401).json({ error: 'Senha atual incorreta.' });
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
  const { salt, passwordHash } = makeCredential(String(newPassword));
  db.prepare('UPDATE admin SET salt = ?, passwordHash = ? WHERE id = 1').run(salt, passwordHash);
  res.json({ ok: true });
});

api.get('/admin/registrations', (req, res) => {
  if (!currentAdmin(req)) return res.status(401).json({ error: 'Sessão administrativa expirada.' });
  const rows = db.prepare('SELECT * FROM registrations ORDER BY createdAt DESC').all();
  res.json(rows.map(r => safeReg(rowToRegistration(r))));
});

api.get('/admin/config', (req, res) => {
  if (!currentAdmin(req)) return res.status(401).json({ error: 'Sessão administrativa expirada.' });
  res.json(getConfig());
});

api.get('/admin/shirt-orders', (req, res) => {
  if (!currentAdmin(req)) return res.status(401).json({ error: 'Sessão administrativa expirada.' });
  res.json(db.prepare('SELECT * FROM shirt_orders ORDER BY createdAt DESC').all());
});

api.put('/admin/config', (req, res) => {
  if (!currentAdmin(req)) return res.status(401).json({ error: 'Sessão administrativa expirada.' });
  const p = req.body || {};
  const current = getConfig();
  const vacancies = { ...current.vacancies };
  Object.keys(vacancies).forEach(k => {
    if (p.vacancies?.[k] !== undefined) {
      const n = Number(p.vacancies[k]);
      if (!Number.isFinite(n) || n < 0) return;
      vacancies[k] = Math.floor(n);
    }
  });
  const pricingInput = p.pricing || {};
  const pricing = { ...current.pricing };
  for (const key of ['oneDay', 'twoDays', 'earlyBird', 'regular']) {
    if (pricingInput[key] !== undefined) {
      const n = Number(pricingInput[key]);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Valor de preço inválido.' });
      pricing[key] = n;
    }
  }
  if (pricingInput.earlyBirdDeadline) {
    if (isNaN(Date.parse(pricingInput.earlyBirdDeadline))) return res.status(400).json({ error: 'Data limite promocional inválida.' });
    pricing.earlyBirdDeadline = String(pricingInput.earlyBirdDeadline);
  }
  const next = { ...current, pricing, paymentInstructions: String(p.paymentInstructions || ''), vacancies };
  saveConfig(next);
  res.json(next);
});

api.get('/admin/proof/:id', (req, res) => {
  if (!currentAdmin(req)) return res.status(401).json({ error: 'Sessão administrativa expirada.' });
  const row = db.prepare('SELECT * FROM registrations WHERE id = ?').get(req.params.id);
  if (!row || !row.paymentProofPath) return res.status(404).type('text/plain').send('Comprovante não encontrado.');
  const filePath = path.join(UPLOADS_DIR, path.basename(row.paymentProofPath));
  if (!fs.existsSync(filePath)) return res.status(404).type('text/plain').send('Arquivo não encontrado no servidor.');
  res.type(row.paymentProofMimetype || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

app.use('/api', api);

// Erros do multer (ex: arquivo grande demais) viram JSON, não HTML
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'O arquivo deve ter no máximo 8 MB.' });
    return res.status(400).json({ error: 'Falha no envio do arquivo.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ---- Frontend estático (mesma origem, sem CORS) ----
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
