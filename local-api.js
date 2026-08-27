/*
 * API LOCAL — versão 100% estática
 * Substitui o servidor Node/Express por armazenamento no navegador.
 * Os dados ficam neste navegador/origem via localStorage + IndexedDB.
 */
(() => {
  const DB = {
    users: 'ibbvbm_static_users_v1',
    regs: 'ibbvbm_static_regs_v1',
    shirts: 'ibbvbm_static_shirts_v1',
    config: 'ibbvbm_static_config_v1',
    sessions: 'ibbvbm_static_sessions_v1',
    admin: 'ibbvbm_static_admin_v1',
    loginAttempts: 'ibbvbm_static_login_attempts_v1'
  };

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

  // Calcula o valor da inscrição de acordo com a quantidade de dias
  // escolhidos e a tabela de preços vigente (1 dia, 2 dias, ou os 3 dias
  // — que dependem do prazo promocional até 30/abril).
  function calcRegistrationTotal(numDias, pricing) {
    const p = pricing || DEFAULT_CONFIG.pricing;
    if (numDias <= 0) return 0;
    if (numDias === 1) return Number(p.oneDay);
    if (numDias === 2) return Number(p.twoDays);
    const deadline = new Date(`${p.earlyBirdDeadline}T23:59:59`);
    const isEarly = new Date() <= deadline;
    return Number(isEarly ? p.earlyBird : p.regular);
  }

  // --- Segurança ---
  // Este site não tem servidor: todo o "backend" roda no navegador da própria
  // pessoa, então não existe segredo real que o servidor guarda e o cliente não
  // vê. Ainda assim, evitamos os dois erros mais comuns desse tipo de site:
  //   1) Nenhuma senha fica hardcoded no código-fonte (nem a do admin, nem a
  //      de ninguém). O administrador cria a própria conta no primeiro acesso.
  //   2) Nenhuma senha é guardada em texto puro no localStorage — só o hash
  //      (SHA-256 + salt aleatório por conta), via Web Crypto (API nativa do
  //      navegador, sem depender de nenhum serviço externo).
  // Isso não substitui um backend de verdade: quem tiver acesso ao mesmo
  // navegador ainda pode abrir o DevTools e manipular os dados locais. Para
  // dados sensíveis de produção, o ideal continua sendo um servidor real.
  const LOGIN_MAX_ATTEMPTS = 5;
  const LOGIN_LOCKOUT_MS = 2 * 60 * 1000; // 2 minutos de bloqueio após exceder tentativas

  const nativeFetch = window.fetch.bind(window);

  const read = (key, fallback) => {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (_) { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  function randomHex(byteLength) {
    const arr = new Uint8Array(byteLength);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${password}`));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function makeCredential(password) {
    const salt = randomHex(16);
    const passwordHash = await hashPassword(password, salt);
    return { salt, passwordHash };
  }

  async function verifyCredential(password, salt, passwordHash) {
    const attempt = await hashPassword(password, salt);
    return attempt === passwordHash;
  }

  // Bloqueio simples contra tentativas repetidas de login (força bruta).
  // Chave de identificação é o e-mail (ou "admin" para o painel administrativo).
  function loginGate(identifier) {
    const attempts = read(DB.loginAttempts, {});
    const entry = attempts[identifier];
    if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
      const secondsLeft = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
      return { blocked: true, secondsLeft };
    }
    return { blocked: false };
  }

  function registerLoginFailure(identifier) {
    const attempts = read(DB.loginAttempts, {});
    const entry = attempts[identifier] || { count: 0, lockedUntil: 0 };
    entry.count++;
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
      entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
      entry.count = 0;
    }
    attempts[identifier] = entry;
    write(DB.loginAttempts, attempts);
  }

  function clearLoginFailures(identifier) {
    const attempts = read(DB.loginAttempts, {});
    if (attempts[identifier]) {
      delete attempts[identifier];
      write(DB.loginAttempts, attempts);
    }
  }

  function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function textResponse(text, status = 200) {
    return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  function getConfig() {
    const c = read(DB.config, DEFAULT_CONFIG);
    return {
      ...DEFAULT_CONFIG,
      ...c,
      pricing: { ...DEFAULT_CONFIG.pricing, ...(c.pricing || {}) },
      vacancies: { ...DEFAULT_CONFIG.vacancies, ...(c.vacancies || {}) }
    };
  }

  function categoryOf(data) {
    if (data?.coroOrq === 'cantar' && ['Soprano','Contralto','Tenor','Baixo'].includes(data.naipe)) return data.naipe;
    if (data?.coroOrq === 'instrumento') return 'Orquestra';
    return null;
  }

  function availability() {
    const regs = read(DB.regs, []);
    const config = getConfig();
    const used = Object.fromEntries(Object.keys(config.vacancies).map(k => [k, 0]));
    regs.forEach(r => {
      const c = categoryOf(r.data);
      if (c && used[c] !== undefined) used[c]++;
    });
    return Object.keys(config.vacancies).map(k => {
      const limit = Math.max(0, Number(config.vacancies[k] ?? 15));
      const occupied = used[k] || 0;
      return { [k]: { limit, occupied, remaining: Math.max(0, limit - occupied), full: occupied >= limit } };
    }).reduce((a,b) => Object.assign(a,b), {});
  }

  function authToken(headers) {
    return String(headers?.get?.('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  }

  function currentUser(headers) {
    const token = authToken(headers);
    if (!token) return null;
    const sessions = read(DB.sessions, {});
    const session = sessions[token];
    if (!session || session.type !== 'user' || session.expiresAt < Date.now()) return null;
    return read(DB.users, []).find(u => u.id === session.userId) || null;
  }

  function currentAdmin(headers) {
    const token = authToken(headers);
    if (!token) return false;
    const sessions = read(DB.sessions, {});
    return !!(sessions[token]?.type === 'admin' && sessions[token].expiresAt >= Date.now());
  }

  function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email };
  }

  function safeReg(reg) {
    return {
      ...reg,
      paymentProofUrl: reg.paymentProof ? `/api/admin/proof/${encodeURIComponent(reg.id)}` : null
    };
  }

  // IndexedDB guarda o comprovante sem depender de servidor.
  // Quando o site é aberto direto como arquivo (file://), o Chrome e outros
  // navegadores bloqueiam o IndexedDB — nesse caso caímos para o localStorage
  // (o arquivo é salvo em base64), garantindo que funcione sem servidor algum.
  const IDB_NAME = 'ibbvbm_static_files_v1';
  const IDB_STORE = 'files';
  const FALLBACK_PREFIX = 'ibbvbm_static_file_fallback_v1:';
  let idbBroken = false;

  function openIDB() {
    return new Promise((resolve) => {
      if (idbBroken || !('indexedDB' in window)) return resolve(null);
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { idbBroken = true; resolve(null); };
      } catch (_) { idbBroken = true; resolve(null); }
    });
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function dataURLToBlob(dataURL) {
    const [meta, b64] = dataURL.split(',');
    const mime = /data:(.*?);base64/.exec(meta)?.[1] || 'application/octet-stream';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function saveFileFallback(key, file) {
    try {
      const dataURL = await fileToDataURL(file);
      localStorage.setItem(FALLBACK_PREFIX + key, dataURL);
    } catch (_) { /* arquivo grande demais para o localStorage: ignorado silenciosamente */ }
  }

  async function saveFile(key, file) {
    if (!file) return;
    const db = await openIDB();
    if (!db) return saveFileFallback(key, file);
    await new Promise(resolve => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(file, key);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      } catch (_) { resolve(); }
    });
  }

  async function getFile(key) {
    const db = await openIDB();
    if (!db) {
      const dataURL = localStorage.getItem(FALLBACK_PREFIX + key);
      return dataURL ? dataURLToBlob(dataURL) : null;
    }
    return new Promise(resolve => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function localApi(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const clean = new URL(url, location.href);
    const path = clean.pathname;
    const headers = new Headers(options.headers || {});
    const body = options.body;
    const user = currentUser(headers);
    const admin = currentAdmin(headers);

    // Authentication
    if (path === '/api/auth/signup' && method === 'POST') {
      const p = JSON.parse(body || '{}');
      const name = String(p.name || '').trim();
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      if (name.length < 2 || name.length > 120) return jsonResponse({error:'Informe seu nome completo.'},400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({error:'Informe um e-mail válido.'},400);
      if (password.length < 8) return jsonResponse({error:'A senha deve ter pelo menos 8 caracteres.'},400);
      const users = read(DB.users, []);
      if (users.some(u => u.email === email)) return jsonResponse({error:'Este e-mail já possui uma conta.'},409);
      const { salt, passwordHash } = await makeCredential(password);
      const newUser = { id: uid('USR'), name, email, salt, passwordHash, createdAt: new Date().toISOString() };
      users.push(newUser); write(DB.users, users);
      const sessions = read(DB.sessions, {});
      const token = uid('TOKEN');
      sessions[token] = { type:'user', userId:newUser.id, expiresAt:Date.now()+12*60*60*1000 };
      write(DB.sessions, sessions);
      return jsonResponse({token, user:publicUser(newUser)},201);
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const p = JSON.parse(body || '{}');
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      const gate = loginGate(`user:${email}`);
      if (gate.blocked) return jsonResponse({error:`Muitas tentativas. Tente novamente em ${gate.secondsLeft}s.`},429);
      const u = read(DB.users, []).find(x => x.email === email);
      const ok = u && await verifyCredential(password, u.salt, u.passwordHash);
      if (!ok) { registerLoginFailure(`user:${email}`); return jsonResponse({error:'E-mail ou senha inválidos.'},401); }
      clearLoginFailures(`user:${email}`);
      const sessions = read(DB.sessions, {});
      const token = uid('TOKEN');
      sessions[token] = { type:'user', userId:u.id, expiresAt:Date.now()+12*60*60*1000 };
      write(DB.sessions, sessions);
      return jsonResponse({token, user:publicUser(u)});
    }

    if (path === '/api/me' && method === 'GET') {
      if (!user) return jsonResponse({error:'Sessão expirada. Entre novamente.'},401);
      return jsonResponse({user:publicUser(user)});
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const token = authToken(headers);
      const sessions = read(DB.sessions, {});
      delete sessions[token]; write(DB.sessions, sessions);
      return jsonResponse({ok:true});
    }

    // Public configuration
    if (path === '/api/config' && method === 'GET') {
      const c = getConfig();
      return jsonResponse({...c, availability:availability()});
    }
    if (path === '/api/availability' && method === 'GET') {
      return jsonResponse(availability());
    }

    // Shirt orders
    if (path === '/api/shirt-orders' && method === 'POST') {
      if (!user) return jsonResponse({error:'Entre na sua conta para continuar.'},401);
      const p = JSON.parse(body || '{}');
      const size = String(p.size || '');
      const quantity = Number(p.quantity);
      const name = String(p.name || user.name).trim();
      if (!['PP','P','M','G','GG','XG','XXG'].includes(size)) return jsonResponse({error:'Tamanho de camiseta inválido.'},400);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return jsonResponse({error:'Quantidade inválida.'},400);
      if (name.length < 2 || name.length > 120) return jsonResponse({error:'Nome inválido.'},400);
      const orders = read(DB.shirts, []);
      const order = {
        id: uid('CAM'), userId:user.id, name, email:user.email, size, quantity,
        unitPrice:59.90, total:Number((quantity*59.90).toFixed(2)),
        status:'pending', createdAt:new Date().toISOString()
      };
      orders.push(order); write(DB.shirts, orders);
      return jsonResponse({order},201);
    }

    if (path === '/api/my-shirt-orders' && method === 'GET') {
      if (!user) return jsonResponse({error:'Sessão expirada.'},401);
      return jsonResponse({orders:read(DB.shirts, []).filter(o => o.userId === user.id)});
    }

    if (path === '/api/my-registration' && method === 'GET') {
      if (!user) return jsonResponse({error:'Sessão expirada.'},401);
      const reg = read(DB.regs, []).find(r => r.data?.email === user.email);
      return jsonResponse({registration:reg ? safeReg(reg) : null});
    }

    // Registration
    if (path === '/api/register' && method === 'POST') {
      if (!user) return jsonResponse({error:'Entre na sua conta para continuar.'},401);
      const form = body instanceof FormData ? body : null;
      if (!form) return jsonResponse({error:'Dados da inscrição inválidos.'},400);

      let data = {};
      try { data = JSON.parse(String(form.get('data') || '{}')); } catch (_) {
        return jsonResponse({error:'Dados da inscrição inválidos.'},400);
      }
      data.email = user.email;
      data.nome = data.nome || user.name;
      if (!data.nome || data.nome.length < 2 || data.nome.length > 120) return jsonResponse({error:'Informe um nome válido.'},400);
      if (!Array.isArray(data.dias) || !data.dias.length) return jsonResponse({error:'Selecione ao menos um dia válido.'},400);
      if (!['sim','nao'].includes(data.isMember)) return jsonResponse({error:'Informe se você é membro da IBBVBM.'},400);
      if (data.coroOrq === 'cantar' && !['Soprano','Contralto','Tenor','Baixo'].includes(data.naipe)) return jsonResponse({error:'Selecione um naipe válido.'},400);
      if (data.coroOrq === 'instrumento' && !data.instrumento) return jsonResponse({error:'Selecione um instrumento.'},400);

      const proof = form.get('paymentProof');
      if (data.isMember !== 'sim' && !(proof instanceof File)) return jsonResponse({error:'Anexe o comprovante de pagamento.'},400);
      if (proof instanceof File && proof.size > 8*1024*1024) return jsonResponse({error:'O arquivo deve ter no máximo 8 MB.'},400);

      const regs = read(DB.regs, []);
      const requestedId = String(form.get('registrationId') || '').trim();
      const ownIndex = regs.findIndex(r => r.data?.email === user.email);
      const id = requestedId || (ownIndex >= 0 ? regs[ownIndex].id : uid('IMS26'));
      const existingIndex = regs.findIndex(r => r.id === id);
      if (existingIndex >= 0 && regs[existingIndex].data?.email !== user.email) {
        return jsonResponse({error:'Esta inscrição pertence a outra conta.'},403);
      }

      const selectedCategory = categoryOf(data);
      if (selectedCategory) {
        const av = availability();
        const oldCategory = existingIndex >= 0 ? categoryOf(regs[existingIndex].data) : null;
        if (av[selectedCategory]?.full && oldCategory !== selectedCategory) {
          return jsonResponse({error:`As vagas para ${selectedCategory} acabaram.`,category:selectedCategory,availability:av},409);
        }
      }

      const oldProof = existingIndex >= 0 ? regs[existingIndex].paymentProof : null;
      const now = new Date().toISOString();
      let proofMeta = data.isMember === 'sim' ? null : oldProof;
      if (proof instanceof File) {
        await saveFile(`proof:${id}`, proof);
        proofMeta = { originalName:proof.name, mimetype:proof.type || 'application/octet-stream', uploadedAt:now };
      }

      const config = getConfig();
      const reg = {
        id, data,
        status:data.isMember === 'sim' ? 'confirmed_member' : 'confirmed_payment',
        total:Number(calcRegistrationTotal(data.dias.length, config.pricing).toFixed(2)),
        createdAt:existingIndex >= 0 ? regs[existingIndex].createdAt : now,
        updatedAt:now,
        paymentProof:proofMeta
      };
      if (existingIndex >= 0) regs[existingIndex] = reg; else regs.push(reg);
      write(DB.regs, regs);
      return jsonResponse({ok:true,registration:safeReg(reg)});
    }

    // Admin
    // Não existe usuário admin padrão: a primeira pessoa a acessar o painel
    // cria a própria conta (e-mail + senha), que fica salva só neste
    // navegador, com a senha em hash (nunca em texto puro).
    if (path === '/api/admin/setup-status' && method === 'GET') {
      return jsonResponse({configured: !!read(DB.admin, null)});
    }

    if (path === '/api/admin/setup' && method === 'POST') {
      if (read(DB.admin, null)) return jsonResponse({error:'A conta de administrador já foi configurada.'},409);
      const p = JSON.parse(body || '{}');
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({error:'Informe um e-mail válido.'},400);
      if (password.length < 8) return jsonResponse({error:'A senha deve ter pelo menos 8 caracteres.'},400);
      const { salt, passwordHash } = await makeCredential(password);
      write(DB.admin, { email, salt, passwordHash, createdAt: new Date().toISOString() });
      const sessions = read(DB.sessions, {});
      const token = uid('ADMIN');
      sessions[token] = {type:'admin',expiresAt:Date.now()+8*60*60*1000};
      write(DB.sessions,sessions);
      return jsonResponse({token},201);
    }

    if (path === '/api/admin/login' && method === 'POST') {
      const account = read(DB.admin, null);
      if (!account) return jsonResponse({error:'Nenhuma conta de administrador configurada neste navegador.', needsSetup:true},409);
      const p = JSON.parse(body || '{}');
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      const gate = loginGate('admin');
      if (gate.blocked) return jsonResponse({error:`Muitas tentativas. Tente novamente em ${gate.secondsLeft}s.`},429);
      const ok = email === account.email && await verifyCredential(password, account.salt, account.passwordHash);
      if (!ok) { registerLoginFailure('admin'); return jsonResponse({error:'E-mail ou senha de administrador inválidos.'},401); }
      clearLoginFailures('admin');
      const sessions = read(DB.sessions, {});
      const token = uid('ADMIN');
      sessions[token] = {type:'admin',expiresAt:Date.now()+8*60*60*1000};
      write(DB.sessions,sessions);
      return jsonResponse({token});
    }

    if (path === '/api/admin/change-password' && method === 'POST') {
      if (!admin) return jsonResponse({error:'Sessão administrativa expirada.'},401);
      const account = read(DB.admin, null);
      if (!account) return jsonResponse({error:'Nenhuma conta de administrador configurada.'},409);
      const p = JSON.parse(body || '{}');
      const currentPassword = String(p.currentPassword || '');
      const newPassword = String(p.newPassword || '');
      const ok = await verifyCredential(currentPassword, account.salt, account.passwordHash);
      if (!ok) return jsonResponse({error:'Senha atual incorreta.'},401);
      if (newPassword.length < 8) return jsonResponse({error:'A nova senha deve ter pelo menos 8 caracteres.'},400);
      const { salt, passwordHash } = await makeCredential(newPassword);
      write(DB.admin, { ...account, salt, passwordHash });
      return jsonResponse({ok:true});
    }

    if (path === '/api/admin/registrations' && method === 'GET') {
      if (!admin) return jsonResponse({error:'Sessão administrativa expirada.'},401);
      return jsonResponse(read(DB.regs, []).map(safeReg));
    }
    if (path === '/api/admin/config' && method === 'GET') {
      if (!admin) return jsonResponse({error:'Sessão administrativa expirada.'},401);
      return jsonResponse(getConfig());
    }
    if (path === '/api/admin/shirt-orders' && method === 'GET') {
      if (!admin) return jsonResponse({error:'Sessão administrativa expirada.'},401);
      return jsonResponse(read(DB.shirts, []));
    }

    if (path === '/api/admin/config' && method === 'PUT') {
      if (!admin) return jsonResponse({error:'Sessão administrativa expirada.'},401);
      const p = JSON.parse(body || '{}');
      const current = getConfig();
      const vacancies = {...current.vacancies};
      Object.keys(vacancies).forEach(k => {
        if (p.vacancies?.[k] !== undefined) {
          const n = Number(p.vacancies[k]);
          if (!Number.isFinite(n) || n < 0) throw new Error(`Limite inválido para ${k}.`);
          vacancies[k] = Math.floor(n);
        }
      });
      const pricingInput = p.pricing || {};
      const pricing = {...current.pricing};
      for (const key of ['oneDay','twoDays','earlyBird','regular']) {
        if (pricingInput[key] !== undefined) {
          const n = Number(pricingInput[key]);
          if (!Number.isFinite(n) || n < 0) return jsonResponse({error:'Valor de preço inválido.'},400);
          pricing[key] = n;
        }
      }
      if (pricingInput.earlyBirdDeadline) {
        if (isNaN(Date.parse(pricingInput.earlyBirdDeadline))) return jsonResponse({error:'Data limite promocional inválida.'},400);
        pricing.earlyBirdDeadline = String(pricingInput.earlyBirdDeadline);
      }
      const next = {...current,pricing,paymentInstructions:String(p.paymentInstructions || ''),vacancies};
      write(DB.config,next);
      return jsonResponse(next);
    }

    if (path.startsWith('/api/admin/proof/') && method === 'GET') {
      if (!admin) return jsonResponse({error:'Sessão administrativa expirada.'},401);
      const id = decodeURIComponent(path.split('/').pop());
      const reg = read(DB.regs, []).find(r => r.id === id);
      if (!reg?.paymentProof) return textResponse('Comprovante não encontrado.',404);
      const file = await getFile(`proof:${id}`);
      if (!file) return textResponse('Arquivo não encontrado neste navegador.',404);
      return new Response(file, {status:200, headers:{'Content-Type':file.type || reg.paymentProof.mimetype || 'application/octet-stream'}});
    }

    return nativeFetch(url, options);
  }

  window.fetch = localApi;
  window.IBBVBM_LOCAL = { clearAll: () => {
    Object.values(DB).forEach(k => localStorage.removeItem(k));
  }};
})();
