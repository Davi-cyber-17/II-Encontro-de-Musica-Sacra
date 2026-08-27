
const STORAGE_KEY = 'ibbvbm_encontro_inscricao_v1';

const state = {
  loggedIn: false,
  authToken: null,
  user: null,
  pendingContext: false,
  myRegistration: null,
  config: { pricing: { oneDay: 40, twoDays: 50, earlyBird: 70, regular: 85, earlyBirdDeadline: '2026-04-30' }, paymentInstructions: 'O comprovante deve estar legível e ser referente ao valor total da inscrição.', availability: {} }
};

const header = document.getElementById('siteHeader');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 30);
});

const hamburger = document.getElementById('hamburgerBtn');
const mobileMenu = document.getElementById('mobileMenu');

hamburger.addEventListener('click', () => {
  const open = mobileMenu.style.display === 'block';
  mobileMenu.style.display = open ? 'none' : 'block';
  hamburger.setAttribute('aria-expanded', String(!open));
});

document.querySelectorAll('#mobileMenu a').forEach(a => {
  a.addEventListener('click', () => {
    mobileMenu.style.display = 'none';
    hamburger.setAttribute('aria-expanded', 'false');
  });
});

const io = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.reveal').forEach(el => io.observe(el));

const overlay = document.getElementById('modalOverlay');
const modalContext = document.getElementById('modalContext');
const modalClose = document.getElementById('modalClose');
const tabLogin = document.getElementById('tabLogin');
const tabSignup = document.getElementById('tabSignup');
const panelLogin = document.getElementById('panelLogin');
const panelSignup = document.getElementById('panelSignup');
const accessChoice = document.getElementById('accessChoice');
const participantLoginArea = document.getElementById('participantLoginArea');
const accessParticipant = document.getElementById('accessParticipant');
const accessAdmin = document.getElementById('accessAdmin');
const accessBack = document.getElementById('accessBack');

function switchTab(which) {
  const signup = which === 'signup';
  tabSignup.classList.toggle('active', signup);
  tabLogin.classList.toggle('active', !signup);
  panelSignup.classList.toggle('active', signup);
  panelLogin.classList.toggle('active', !signup);
}

tabLogin?.addEventListener('click', () => switchTab('login'));
tabSignup?.addEventListener('click', () => switchTab('signup'));

function showAccessChoice() {
  accessChoice.style.display = 'block';
  participantLoginArea.style.display = 'none';
}

function showParticipantLogin(withContext = false, tab = 'login') {
  accessChoice.style.display = 'none';
  participantLoginArea.style.display = 'block';
  modalContext.classList.toggle('visible', withContext);
  state.pendingContext = withContext;
  switchTab(tab);

  setTimeout(() => {
    const first = overlay.querySelector('.modal-panel.active input');
    if (first) first.focus();
  }, 50);
}

function openModal(withContext = false, tab = 'login', showChoice = true) {
  overlay.classList.add('open');
  if (showChoice) showAccessChoice();
  else showParticipantLogin(withContext, tab);
}

function closeModal() {
  overlay.classList.remove('open');
}

document.getElementById('loginBtnHeader').addEventListener('click', () => openModal(false, 'login', true));
document.getElementById('loginBtnMobile').addEventListener('click', () => openModal(false, 'login', true));
document.getElementById('loginBtnInsc').addEventListener('click', () => openModal(true, 'login', false));
document.getElementById('loginBtnInscSignup').addEventListener('click', () => openModal(true, 'signup', false));

accessParticipant.addEventListener('click', () => showParticipantLogin(false, 'login'));
accessAdmin.addEventListener('click', () => { window.location.href = 'admin.html'; });
accessBack.addEventListener('click', showAccessChoice);

['navKitsEnsaio', 'navKitsEnsaioMobile'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', e => { e.preventDefault(); openRehearsalKits(); });
});
document.getElementById('kitsLoginBtn')?.addEventListener('click', openRehearsalKits);

const shirtModalOverlay = document.getElementById('shirtModalOverlay');
const shirtModalClose = document.getElementById('shirtModalClose');
const buyShirtBtn = document.getElementById('buyShirtBtn');
const confirmShirtBtn = document.getElementById('confirmShirtBtn');
const shirtSize = document.getElementById('shirtSize');
const shirtQty = document.getElementById('shirtQty');
const shirtOrderName = document.getElementById('shirtOrderName');
const shirtOrderSummary = document.getElementById('shirtOrderSummary');
const shirtLoginHint = document.getElementById('shirtLoginHint');

function updateShirtAccess(){
  const logged = !!state.loggedIn;
  if (shirtLoginHint) shirtLoginHint.textContent = logged ? 'Seu pedido será associado à conta atual.' : 'Para registrar a compra, entre na sua conta.';
}

function openShirtOrder(){
  if (!state.loggedIn) {
    state.pendingContext = false;
    openModal(false, 'login', true);
    return;
  }
  const qty = Number(shirtQty?.value || 1);
  const size = shirtSize?.value || 'M';
  const total = qty * 59.90;
  if (shirtOrderName) shirtOrderName.value = state.user?.name || '';
  if (shirtOrderSummary) {
    shirtOrderSummary.innerHTML = `
      <div class="summary-row"><span class="k">Tamanho</span><span class="v">${size}</span></div>
      <div class="summary-row"><span class="k">Quantidade</span><span class="v">${qty}</span></div>
      <div class="summary-row"><span class="k">Total</span><span class="v">R$ ${total.toFixed(2).replace('.', ',')}</span></div>`;
  }
  shirtModalOverlay.classList.add('open');
}

buyShirtBtn?.addEventListener('click', openShirtOrder);
shirtModalClose?.addEventListener('click', () => shirtModalOverlay.classList.remove('open'));
shirtModalOverlay?.addEventListener('click', e => { if (e.target === shirtModalOverlay) shirtModalOverlay.classList.remove('open'); });

confirmShirtBtn?.addEventListener('click', async () => {
  if (!state.loggedIn) return;
  const name = (shirtOrderName?.value || '').trim();
  if (!name) { shirtOrderName.focus(); return; }
  const quantity = Number(shirtQty?.value || 1);
  const size = shirtSize?.value || 'M';
  if (!state.authToken || !['PP','P','M','G','GG','XG','XXG'].includes(size) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) return;

  confirmShirtBtn.disabled = true;
  try {
    const response = await fetch('/api/shirt-orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.authToken}`
      },
      body: JSON.stringify({ size, quantity, name })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível registrar o pedido.');
    shirtModalOverlay.classList.remove('open');
    alert(`Pedido ${result.order.id} registrado!\n\nTamanho: ${result.order.size}\nQuantidade: ${result.order.quantity}\nTotal: R$ ${result.order.total.toFixed(2).replace('.', ',')}`);
  } catch (error) {
    alert(error.message);
  } finally {
    confirmShirtBtn.disabled = false;
  }
});

modalClose?.addEventListener('click', closeModal);
overlay?.addEventListener('click', e => {
  if (e.target === overlay) closeModal();
});

const myRegOverlay = document.getElementById('myRegOverlay');
document.getElementById('myRegClose')?.addEventListener('click', () => myRegOverlay.classList.remove('open'));
myRegOverlay?.addEventListener('click', e => {
  if (e.target === myRegOverlay) myRegOverlay.classList.remove('open');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    overlay.classList.remove('open');
    myRegOverlay.classList.remove('open');
  }
});

const lockedState = document.getElementById('lockedState');
const formState = document.getElementById('formState');
const successState = document.getElementById('successState');
const greetingText = document.getElementById('greetingText');
const kitsLocked = document.getElementById('kitsLocked');
const kitsContent = document.getElementById('kitsContent');
const kitsLoginBtn = document.getElementById('kitsLoginBtn');
const kitsWelcomeTitle = document.getElementById('kitsWelcomeTitle');
const kitsWelcomeText = document.getElementById('kitsWelcomeText');

function hasCompletedRegistration() {
  return !!(state.loggedIn && state.myRegistration?.id && state.myRegistration?.data);
}

function updateKitsAccess() {
  const unlocked = hasCompletedRegistration();
  if (kitsLocked) kitsLocked.style.display = unlocked ? 'none' : 'block';
  if (kitsContent) kitsContent.style.display = unlocked ? 'block' : 'none';

  ['navKitsEnsaio', 'navKitsEnsaioMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('is-unlocked', unlocked);
    const lock = el.querySelector('span');
    if (lock) lock.textContent = unlocked ? 'Liberado' : 'Bloqueado';
    else if (id === 'navKitsEnsaioMobile') el.textContent = unlocked ? 'Kits de ensaio' : 'Kits de ensaio (bloqueado)';
  });

  if (unlocked) {
    const d = state.myRegistration.data;
    let area = 'participante';
    if (d.coroOrq === 'cantar') area = `coro — naipe ${d.naipe || 'selecionado'}`;
    if (d.coroOrq === 'instrumento') area = `orquestra — ${d.instrumento || 'instrumento selecionado'}`;
    if (kitsWelcomeTitle) kitsWelcomeTitle.textContent = `Olá, ${state.user?.name?.split(' ')[0] || 'participante'}! Seus materiais de ensaio`;
    if (kitsWelcomeText) kitsWelcomeText.textContent = `Acesso liberado para sua inscrição: ${area}.`;
  }
}

function openRehearsalKits() {
  if (!hasCompletedRegistration()) {
    if (!state.loggedIn) {
      state.pendingContext = false;
      openModal(false, 'login', true);
      return;
    }
    document.getElementById('inscricao').scrollIntoView({ behavior: 'smooth' });
    alert('Conclua sua inscrição para liberar os kits de ensaio.');
    return;
  }
  document.getElementById('kits-ensaio').scrollIntoView({ behavior: 'smooth' });
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(n => n[0].toUpperCase()).join('');
}

function updateHeaderUser() {
  const oldChip = document.querySelector('.user-chip');
  if (oldChip) oldChip.remove();

  const loginBtn = document.getElementById('loginBtnHeader');

  if (!state.loggedIn) {
    if (!document.getElementById('loginBtnHeader')) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost';
      btn.id = 'loginBtnHeader';
      btn.textContent = 'Entrar';
      btn.addEventListener('click', () => openModal(false, 'login'));
      document.querySelector('.nav-actions').prepend(btn);
    }
    return;
  }

  const chip = document.createElement('div');
  chip.className = 'user-chip';
  chip.innerHTML = `
    <span class="avatar">${initials(state.user.name)}</span>
    <span class="name">${state.user.name.split(' ')[0]}</span>
    <button class="logout" id="logoutBtn" type="button">Sair</button>
  `;

  if (loginBtn) loginBtn.replaceWith(chip);
  else document.querySelector('.nav-actions').prepend(chip);

  chip.querySelector('#logoutBtn').addEventListener('click', logout);
}

function saveSession() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      user: state.user,
      myRegistration: state.myRegistration,
      authToken: state.authToken
    }));
  } catch (_) {}
}

function loadSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.user) {
      state.loggedIn = true;
      state.user = saved.user;
      state.myRegistration = saved.myRegistration || null;
      state.authToken = saved.authToken || null;
    }
  } catch (_) {}
}

function completeLogin(name, email, token) {
  state.loggedIn = true;
  if (token) state.authToken = token;
  state.user = {
    name: (name || email.split('@')[0]).trim(),
    email: email.trim()
  };

  if (state.myRegistration) {
    regData = JSON.parse(JSON.stringify(state.myRegistration.data));
  } else {
    regData.nome = state.user.name;
    regData.email = state.user.email;
  }

  updateHeaderUser();
  updateShirtAccess();
  lockedState.style.display = 'none';
  successState.classList.remove('visible');
  formState.classList.add('visible');

  greetingText.textContent = `Olá, ${state.user.name.split(' ')[0]} — complete os dados abaixo para confirmar sua vaga.`;

  ['navMinhaInscricao', 'navMinhaInscricaoMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'inline';
  });

  if (!state.myRegistration) {
    currentStepId = 'membership';
    prefillAccountData();
    renderWizard();
  } else {
    showRegistrationSuccess();
  }

  saveSession();
  closeModal();

  if (state.pendingContext) {
    document.getElementById('inscricao').scrollIntoView({ behavior: 'smooth' });
    state.pendingContext = false;
  }
}

function logout() {
  state.loggedIn = false;
  state.user = null;
  state.myRegistration = null;
  state.authToken = null;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
  location.reload();
}

async function authenticate(endpoint, payload, messageId) {
  const message = document.getElementById(messageId);
  if (message) message.textContent = '';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
    completeLogin(result.user.name, result.user.email, result.token);
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  if (senha.length < 8) {
    document.getElementById('loginMessage').textContent = 'A senha deve ter pelo menos 8 caracteres.';
    return;
  }
  const button = e.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  await authenticate('/api/auth/login', { email, password: senha }, 'loginMessage');
  button.disabled = false;
});

document.getElementById('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('signupNome').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const senha = document.getElementById('signupSenha').value;
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  if (senha.length < 8) {
    document.getElementById('signupMessage').textContent = 'A senha deve ter pelo menos 8 caracteres.';
    return;
  }
  const button = e.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  await authenticate('/api/auth/signup', { name, email, password: senha }, 'signupMessage');
  button.disabled = false;
});

const inscForm = document.getElementById('inscForm');
inscForm.addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('wizardNextBtn').click();
});

let regData = {
  isMember: '', nome: '', email: '', telefone: '', idade: '', sexo: '',
  temFilhos: '', filhos: [],
  dias: [],
  oficinaQuinta: '', oficinaSexta: '', oficinaSabado: '',
  coroOrq: '', naipe: '', instrumento: '',
  igreja: '', comoSoube: '', comoSoubeOutro: '', sugestoes: '',
  aceiteTermos: false
};

const WIZARD_STEPS = [
  { id: 'membership' },
  { id: 'personal' },
  { id: 'children', condition: () => regData.temFilhos === 'sim' },
  { id: 'participation' },
  { id: 'workshopQui', condition: () => regData.dias.includes('quinta') },
  { id: 'workshopSex', condition: () => regData.dias.includes('sexta') },
  { id: 'workshopSab', condition: () => regData.dias.includes('sabado') },
  { id: 'choirOrchestra' },
  { id: 'choir', condition: () => regData.coroOrq === 'cantar' },
  { id: 'orchestra', condition: () => regData.coroOrq === 'instrumento' },
  { id: 'general' },
  { id: 'terms' },
  { id: 'payment', condition: () => regData.isMember !== 'sim' }
];

let currentStepId = 'membership';
let childCount = 0;

function activeSteps() {
  return WIZARD_STEPS.filter(s => !s.condition || s.condition());
}

function addChildRow(idadeVal = '') {
  childCount++;

  const row = document.createElement('div');
  row.className = 'child-row';
  row.innerHTML = `
    <div class="field" style="margin-bottom:0;">
      <label>Idade do filho(a) ${childCount}</label>
      <input type="number" min="0" max="17" class="child-age" placeholder="Idade" inputmode="numeric" value="${idadeVal}">
    </div>
    <button type="button" class="btn-remove-child" title="Remover filho" aria-label="Remover filho">&times;</button>
  `;

  row.querySelector('.btn-remove-child').addEventListener('click', () => {
    row.remove();
    if (document.querySelectorAll('.child-row').length === 0) addChildRow();
  });

  document.getElementById('childrenList').appendChild(row);
}

document.getElementById('addChildBtn').addEventListener('click', () => addChildRow());

document.getElementById('gComoSoube').addEventListener('change', e => {
  document.getElementById('gComoSoubeOutroWrap').style.display =
    e.target.value === 'Outro' ? 'block' : 'none';
});

function clearErrors(stepEl) {
  if (!stepEl) return;
  stepEl.querySelectorAll('.error-msg').forEach(e => e.textContent = '');
  stepEl.querySelectorAll('.field-error').forEach(e => e.classList.remove('field-error'));
}

function setError(name, msg) {
  const el = document.querySelector(`.error-msg[data-error-for="${name}"]`);
  if (el) el.textContent = msg;
}

function renderVacancies(availability) {
  if (!availability) return;

  Object.entries(availability).forEach(([category, info]) => {
    const card = document.querySelector(`[data-vacancy-card="${category}"]`);
    const count = document.querySelector(`[data-vacancy-remaining="${category}"]`);
    if (count) count.textContent = info.remaining;

    if (card) {
      card.classList.toggle('is-full', info.full);
      const status = card.querySelector('.vacancy-status');
      if (status) status.textContent = info.full ? 'Vagas encerradas' : 'Disponível';
    }
  });

  updateVacancyOptions(availability);

  const orchestraNote = document.getElementById('orchestraVacancyNote');
  if (orchestraNote && availability.Orquestra) {
    const info = availability.Orquestra;
    orchestraNote.textContent = info.full
      ? 'Vagas encerradas'
      : `${info.remaining} vaga${info.remaining === 1 ? '' : 's'} restante${info.remaining === 1 ? '' : 's'}`;
    orchestraNote.classList.toggle('full', info.full);
  }
}

function updateVacancyOptions(availability) {
  const map = {
    Soprano: 'Soprano',
    Contralto: 'Contralto',
    Tenor: 'Tenor',
    Baixo: 'Baixo'
  };

  Object.entries(map).forEach(([category, value]) => {
    const input = document.querySelector(`input[name="naipe"][value="${value}"]`);
    if (!input) return;

    const label = input.closest('.radio-option');
    if (!label) return;

    const info = availability[category];
    if (!info) return;

    input.disabled = info.full;
    label.classList.toggle('option-full', info.full);

    let note = label.querySelector('.vacancy-inline');
    if (!note) {
      note = document.createElement('small');
      note.className = 'vacancy-inline';
      label.appendChild(note);
    }

    note.textContent = info.full ? 'Vagas encerradas' : `${info.remaining} vaga${info.remaining === 1 ? '' : 's'} restante${info.remaining === 1 ? '' : 's'}`;
    note.classList.toggle('full', info.full);

    if (info.full && input.checked) {
      input.checked = false;
      regData.naipe = '';
    }
  });
}

async function loadVacancies() {
  try {
    const res = await fetch('/api/availability');
    if (!res.ok) return;
    const availability = await res.json();
    state.availability = availability;
    renderVacancies(availability);
  } catch (_) {}
}

async function loadEventConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    state.config = await res.json();
    if (state.config.availability) {
      state.availability = state.config.availability;
      renderVacancies(state.config.availability);
    }
    const p = state.config.pricing || {};
    const fmt = (n) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`;
    document.getElementById('paymentPriceText').innerHTML = `${fmt(p.oneDay)} (1 dia) &middot; ${fmt(p.twoDays)} (2 dias) &middot; ${fmt(p.earlyBird)} até 30/abril ou ${fmt(p.regular)} após, para os 3 dias`;
    document.getElementById('paymentInstructionText').textContent = state.config.paymentInstructions || 'O comprovante deve estar legível e ser referente ao valor total da inscrição.';
  } catch (_) {}
}

// Calcula o valor da inscrição conforme a quantidade de dias escolhidos:
// 1 dia e 2 dias têm valor fixo; os 3 dias seguem o prazo promocional
// (até 30/abril) ou o valor cheio (após 30/abril).
function calculateTotal() {
  const numDias = (regData.dias || []).length;
  const p = state.config.pricing || {};
  if (numDias <= 0) return 0;
  if (numDias === 1) return Number(p.oneDay || 0);
  if (numDias === 2) return Number(p.twoDays || 0);
  const deadline = new Date(`${p.earlyBirdDeadline || '2026-04-30'}T23:59:59`);
  const isEarly = new Date() <= deadline;
  return Number((isEarly ? p.earlyBird : p.regular) || 0);
}

function priceTierLabel() {
  const numDias = (regData.dias || []).length;
  if (numDias === 1) return 'Participação em 1 dia';
  if (numDias === 2) return 'Participação em 2 dias';
  if (numDias >= 3) {
    const p = state.config.pricing || {};
    const deadline = new Date(`${p.earlyBirdDeadline || '2026-04-30'}T23:59:59`);
    return new Date() <= deadline ? 'Até 30 de abril' : 'Após 30 de abril';
  }
  return '';
}

function updatePaymentUI() {
  const isMember = regData.isMember === 'sim';
  document.getElementById('paymentProofField').style.display = isMember ? 'none' : 'block';
  document.getElementById('memberPaymentNotice').style.display = isMember ? 'block' : 'none';
  const total = calculateTotal();
  const labels = { quinta: 'Quinta-feira', sexta: 'Sexta-feira', sabado: 'Sábado' };
  document.getElementById('paymentSummaryBlock').innerHTML = `
    <div class="summary-row"><span class="k">Dias</span><span class="v">${escapeHTML((regData.dias || []).map(d => labels[d]).join(', '))}</span></div>
    <div class="summary-row"><span class="k">Faixa de preço</span><span class="v">${escapeHTML(priceTierLabel())}</span></div>
    <div class="summary-row"><span class="k">Total</span><span class="v">R$ ${total.toFixed(2).replace('.', ',')}</span></div>`;
}

function validateStep(id) {
  const stepEl = document.querySelector(`.wizard-step[data-step="${id}"]`);
  clearErrors(stepEl);
  let valid = true;

  const fail = (name, msg) => {
    setError(name, msg);
    valid = false;
  };

  if (id === 'membership') {
    const member = document.querySelector('input[name="isMember"]:checked');
    regData.isMember = member ? member.value : '';
    if (!regData.isMember) fail('isMember', 'Selecione uma opção.');
  }

  if (id === 'personal') {
    regData.nome = document.getElementById('pNome').value.trim();
    regData.email = document.getElementById('pEmail').value.trim();
    regData.telefone = document.getElementById('pTelefone').value.trim();
    regData.idade = document.getElementById('pIdade').value.trim();
    regData.sexo = document.getElementById('pSexo').value;
    const filhosRadio = document.querySelector('input[name="pFilhos"]:checked');
    regData.temFilhos = filhosRadio ? filhosRadio.value : '';

    if (!regData.nome) fail('pNome', 'Informe seu nome completo.');
    if (!regData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regData.email)) fail('pEmail', 'Informe um e-mail válido.');
    if (!regData.telefone || regData.telefone.replace(/\D/g, '').length < 10) fail('pTelefone', 'Informe um WhatsApp válido.');
    if (!regData.idade || Number(regData.idade) < 1 || Number(regData.idade) > 120) fail('pIdade', 'Informe uma idade válida.');
    if (!regData.sexo) fail('pSexo', 'Selecione uma opção.');
    if (!regData.temFilhos) fail('pFilhos', 'Selecione uma opção.');

    if (regData.temFilhos === 'nao') {
      regData.filhos = [];
      document.getElementById('childrenList').innerHTML = '';
      childCount = 0;
    }
  }

  if (id === 'children') {
    const rows = Array.from(document.querySelectorAll('.child-age'));
    const ages = rows.map(i => i.value.trim());

    if (!ages.length || ages.some(a => a === '' || Number(a) < 0 || Number(a) > 17)) {
      fail('filhos', 'Informe a idade de todos os filhos entre 0 e 17 anos.');
    } else {
      regData.filhos = ages.map(idade => ({ idade }));
    }
  }

  if (id === 'participation') {
    const checked = Array.from(document.querySelectorAll('input[name="pDias"]:checked')).map(i => i.value);
    regData.dias = checked;
    if (!checked.length) fail('pDias', 'Selecione ao menos um dia.');
  }

  if (id === 'workshopQui') {
    const r = document.querySelector('input[name="oficinaQuinta"]:checked');
    regData.oficinaQuinta = r ? r.value : '';
    if (!regData.oficinaQuinta) fail('oficinaQuinta', 'Escolha uma oficina.');
  }

  if (id === 'workshopSex') {
    const r = document.querySelector('input[name="oficinaSexta"]:checked');
    regData.oficinaSexta = r ? r.value : '';
    if (!regData.oficinaSexta) fail('oficinaSexta', 'Escolha uma oficina.');
  }

  if (id === 'workshopSab') {
    const r = document.querySelector('input[name="oficinaSabado"]:checked');
    regData.oficinaSabado = r ? r.value : '';
    if (!regData.oficinaSabado) fail('oficinaSabado', 'Escolha uma oficina.');
  }

  if (id === 'choirOrchestra') {
    const r = document.querySelector('input[name="coroOrq"]:checked');
    regData.coroOrq = r ? r.value : '';
    if (!regData.coroOrq) fail('coroOrq', 'Selecione uma opção.');
  }

  if (id === 'choir') {
    const r = document.querySelector('input[name="naipe"]:checked');
    regData.naipe = r ? r.value : '';
    if (!regData.naipe) fail('naipe', 'Escolha seu naipe.');
  }

  if (id === 'orchestra') {
    regData.instrumento = document.getElementById('instrumento').value;
    const orchestraInfo = state.availability?.Orquestra;
    const oldCategory = state.myRegistration?.data?.coroOrq === 'instrumento' ? 'Orquestra' : null;
    if (orchestraInfo?.full && oldCategory !== 'Orquestra') {
      fail('instrumento', 'As vagas para Orquestra acabaram. Escolha outra opção.');
    }
    if (!regData.instrumento) fail('instrumento', 'Selecione um instrumento.');
  }

  if (id === 'general') {
    regData.igreja = document.getElementById('gIgreja').value.trim();
    regData.comoSoube = document.getElementById('gComoSoube').value;
    regData.comoSoubeOutro = document.getElementById('gComoSoubeOutro').value.trim();
    regData.sugestoes = document.getElementById('gSugestoes').value.trim();

    if (!regData.igreja) fail('gIgreja', 'Informe sua igreja.');
    if (!regData.comoSoube) fail('gComoSoube', 'Selecione uma opção.');
    if (regData.comoSoube === 'Outro' && !regData.comoSoubeOutro) fail('gComoSoube', 'Especifique como você soube do evento.');
  }

  if (id === 'terms') {
    regData.aceiteTermos = document.getElementById('termsAccept').checked;
    if (!regData.aceiteTermos) fail('termsAccept', 'Você precisa aceitar os termos para continuar.');
  }

  if (id === 'payment') {
    updatePaymentUI();
    if (regData.isMember !== 'sim') {
      const file = document.getElementById('paymentProof').files[0];
      if (!file) fail('paymentProof', 'Anexe o comprovante de pagamento para confirmar a inscrição.');
      else if (file.size > 8 * 1024 * 1024) fail('paymentProof', 'O arquivo deve ter no máximo 8 MB.');
    }
  }

  return valid;
}

function renderSummary() {
  const diasLabel = { quinta: 'Quinta-feira', sexta: 'Sexta-feira', sabado: 'Sábado' };

  let coroTxt = 'Não participará do coro ou da orquestra.';
  if (regData.coroOrq === 'cantar') coroTxt = `Coro — naipe: ${regData.naipe || '-'}`;
  if (regData.coroOrq === 'instrumento') coroTxt = `Orquestra — instrumento: ${regData.instrumento || '-'}`;

  const rows = [
    ['Membro da IBBVBM', regData.isMember === 'sim' ? 'Sim — isento de comprovante' : 'Não'],
    ['Nome completo', regData.nome],
    ['E-mail', regData.email],
    ['Telefone / WhatsApp', regData.telefone],
    ['Idade', regData.idade],
    ['Sexo', regData.sexo],
    ['Trará filhos', regData.temFilhos === 'sim' ? `Sim (${regData.filhos.map(f => f.idade + ' anos').join(', ')})` : 'Não'],
    ['Dias de participação', regData.dias.map(d => diasLabel[d]).join(', ') || '-']
  ];

  if (regData.dias.includes('quinta')) rows.push(['Oficina de quinta', regData.oficinaQuinta]);
  if (regData.dias.includes('sexta')) rows.push(['Oficina de sexta', regData.oficinaSexta]);
  if (regData.dias.includes('sabado')) rows.push(['Oficina de sábado', regData.oficinaSabado]);

  rows.push(['Coro / Orquestra', coroTxt]);
  rows.push(['Igreja', regData.igreja]);
  rows.push(['Como soube do evento', regData.comoSoube === 'Outro' ? `Outro — ${regData.comoSoubeOutro}` : regData.comoSoube]);
  if (regData.sugestoes) rows.push(['Sugestões', regData.sugestoes]);
  rows.push(['Valor da inscrição', `R$ ${calculateTotal().toFixed(2).replace('.', ',')}`]);
  rows.push(['Pagamento', regData.isMember === 'sim' ? 'Isento — membro IBBVBM' : 'Comprovante obrigatório']);

  document.getElementById('summaryBlock').innerHTML = rows.map(([k, v]) => `
    <div class="summary-row"><span class="k">${escapeHTML(k)}</span><span class="v">${escapeHTML(v || '-')}</span></div>
  `).join('');
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderWizard() {
  const steps = activeSteps();

  if (!steps.find(s => s.id === currentStepId)) currentStepId = steps[0].id;

  document.querySelectorAll('.wizard-step').forEach(el => {
    el.classList.toggle('active', el.dataset.step === currentStepId);
  });

  const idx = steps.findIndex(s => s.id === currentStepId);
  const total = steps.length;

  document.getElementById('wizardProgressLabel').textContent = `Etapa ${idx + 1} de ${total}`;
  document.getElementById('wizardProgressFill').style.width = `${((idx + 1) / total) * 100}%`;
  document.getElementById('wizardBackBtn').style.visibility = idx === 0 ? 'hidden' : 'visible';

  const nextBtn = document.getElementById('wizardNextBtn');
  const isLastStep = idx === total - 1;
  nextBtn.textContent = isLastStep ? 'Confirmar inscrição' : 'Continuar';

  if (currentStepId === 'children' && document.querySelectorAll('.child-row').length === 0) {
    addChildRow();
  }

  if (currentStepId === 'terms') renderSummary();
  if (currentStepId === 'payment') updatePaymentUI();

  const active = document.querySelector(`.wizard-step[data-step="${currentStepId}"] input, .wizard-step[data-step="${currentStepId}"] select, .wizard-step[data-step="${currentStepId}"] textarea`);
  if (active) setTimeout(() => active.focus(), 80);
}

function scrollWizardIntoView() {
  document.getElementById('wizard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('wizardNextBtn').addEventListener('click', () => {
  if (!validateStep(currentStepId)) return;

  const steps = activeSteps();
  const idx = steps.findIndex(s => s.id === currentStepId);
  const isLastStep = idx === steps.length - 1;

  if (isLastStep) {
    finalizeRegistration();
    return;
  }

  currentStepId = steps[idx + 1].id;
  renderWizard();
  scrollWizardIntoView();
});

document.getElementById('wizardBackBtn').addEventListener('click', () => {
  const steps = activeSteps();
  const idx = steps.findIndex(s => s.id === currentStepId);

  if (idx > 0) {
    currentStepId = steps[idx - 1].id;
    renderWizard();
    scrollWizardIntoView();
  }
});

function generateRegId() {
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `IMS26-${rnd}`;
}

async function finalizeRegistration() {
  try {
    const availabilityResponse = await fetch('/api/availability');
    if (availabilityResponse.ok) {
      state.availability = await availabilityResponse.json();
      renderVacancies(state.availability);
    }
  } catch (_) {}

  const selectedCategory = regData.coroOrq === 'cantar' ? regData.naipe : regData.coroOrq === 'instrumento' ? 'Orquestra' : null;
  const oldCategory = state.myRegistration?.data?.coroOrq === 'cantar'
    ? state.myRegistration?.data?.naipe
    : state.myRegistration?.data?.coroOrq === 'instrumento'
      ? 'Orquestra'
      : null;

  if (selectedCategory && state.availability?.[selectedCategory]?.full && oldCategory !== selectedCategory) {
    alert(`As vagas para ${selectedCategory} acabaram. Escolha outra categoria.`);
    currentStepId = regData.coroOrq === 'cantar' ? 'choir' : 'orchestra';
    renderWizard();
    return;
  }

  const id = state.myRegistration ? state.myRegistration.id : generateRegId();
  const proof = regData.isMember === 'sim' ? null : document.getElementById('paymentProof').files[0];

  const form = new FormData();
  form.append('registrationId', id);
  form.append('data', JSON.stringify(regData));
  form.append('status', regData.isMember === 'sim' ? 'confirmed_member' : 'confirmed_payment');
  if (proof) form.append('paymentProof', proof);

  const nextBtn = document.getElementById('wizardNextBtn');
  nextBtn.disabled = true;
  nextBtn.textContent = 'Enviando...';

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {},
      body: form
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível enviar a inscrição.');

    state.myRegistration = { id: result.registration.id, data: result.registration.data, status: result.registration.status, createdAt: result.registration.createdAt };
    await loadVacancies();
    saveSession();
    showRegistrationSuccess();
  } catch (error) {
    alert(error.message);
  } finally {
    nextBtn.disabled = false;
    nextBtn.textContent = 'Confirmar inscrição';
  }
}

function showRegistrationSuccess() {
  updateKitsAccess();
  document.getElementById('regIdDisplay').textContent = state.myRegistration?.id || '—';
  const statusText = state.myRegistration?.status === 'confirmed_member' ? 'Inscrição confirmada. Como membro da IBBVBM, você não precisa enviar comprovante.' : 'Inscrição confirmada após o recebimento do comprovante de pagamento.';
  document.getElementById('successStatusText').textContent = statusText;
  formState.classList.remove('visible');
  successState.classList.add('visible');
}

function prefillAccountData() {
  if (!state.user) return;
  document.getElementById('pNome').value = state.user.name || '';
  document.getElementById('pEmail').value = state.user.email || '';
}

function prefillFromData(d) {
  regData = JSON.parse(JSON.stringify(d));

  document.querySelectorAll('input[name="isMember"]').forEach(i => i.checked = i.value === d.isMember);
  document.getElementById('pNome').value = d.nome || '';
  document.getElementById('pEmail').value = d.email || '';
  document.getElementById('pTelefone').value = d.telefone || '';
  document.getElementById('pIdade').value = d.idade || '';
  document.getElementById('pSexo').value = d.sexo || '';

  document.querySelectorAll('input[name="pFilhos"]').forEach(i => i.checked = i.value === d.temFilhos);

  document.getElementById('childrenList').innerHTML = '';
  childCount = 0;
  (d.filhos || []).forEach(f => addChildRow(f.idade));

  document.querySelectorAll('input[name="pDias"]').forEach(i => {
    i.checked = (d.dias || []).includes(i.value);
  });

  ['oficinaQuinta', 'oficinaSexta', 'oficinaSabado'].forEach(key => {
    document.querySelectorAll(`input[name="${key}"]`).forEach(i => {
      i.checked = i.value === d[key];
    });
  });

  document.querySelectorAll('input[name="coroOrq"]').forEach(i => {
    i.checked = i.value === d.coroOrq;
  });

  document.querySelectorAll('input[name="naipe"]').forEach(i => {
    i.checked = i.value === d.naipe;
  });

  document.getElementById('instrumento').value = d.instrumento || '';
  document.getElementById('gIgreja').value = d.igreja || '';
  document.getElementById('gComoSoube').value = d.comoSoube || '';
  document.getElementById('gComoSoubeOutroWrap').style.display = d.comoSoube === 'Outro' ? 'block' : 'none';
  document.getElementById('gComoSoubeOutro').value = d.comoSoubeOutro || '';
  document.getElementById('gSugestoes').value = d.sugestoes || '';
  document.getElementById('termsAccept').checked = !!d.aceiteTermos;
}

function startEditRegistration() {
  successState.classList.remove('visible');
  lockedState.style.display = 'none';
  formState.classList.add('visible');
  prefillFromData(state.myRegistration.data);
  currentStepId = 'personal';
  renderWizard();
  document.getElementById('inscricao').scrollIntoView({ behavior: 'smooth' });
}

function openMyRegistration() {
  if (!state.loggedIn) {
    openModal(false, 'login');
    return;
  }

  if (!state.myRegistration) {
    document.getElementById('myRegContent').innerHTML = `
      <p style="color:var(--green-700); margin:20px 0;">
        Você ainda não possui uma inscrição.
        <a href="#inscricao" style="color:var(--green-600); font-weight:600;">Clique aqui para se inscrever</a>.
      </p>
    `;
  } else {
    const d = state.myRegistration.data;
    const diasLabel = { quinta: 'Quinta-feira', sexta: 'Sexta-feira', sabado: 'Sábado' };

    let coroTxt = 'Não participa do coro ou da orquestra.';
    if (d.coroOrq === 'cantar') coroTxt = `Coro — naipe: ${d.naipe || '-'}`;
    if (d.coroOrq === 'instrumento') coroTxt = `Orquestra — instrumento: ${d.instrumento || '-'}`;

    document.getElementById('myRegContent').innerHTML = `
      <div class="reg-id-box" style="margin-bottom:20px;">
        <span class="k">Número da inscrição</span>
        <span class="v">${escapeHTML(state.myRegistration.id)}</span>
      </div>
      <div class="summary-block">
        <div class="summary-row"><span class="k">Nome</span><span class="v">${escapeHTML(d.nome)}</span></div>
        <div class="summary-row"><span class="k">E-mail</span><span class="v">${escapeHTML(d.email)}</span></div>
        <div class="summary-row"><span class="k">Telefone</span><span class="v">${escapeHTML(d.telefone)}</span></div>
        <div class="summary-row"><span class="k">Dias</span><span class="v">${escapeHTML(d.dias.map(x => diasLabel[x]).join(', ') || '-')}</span></div>
        <div class="summary-row"><span class="k">Coro / Orquestra</span><span class="v">${escapeHTML(coroTxt)}</span></div>
        <div class="summary-row"><span class="k">Igreja</span><span class="v">${escapeHTML(d.igreja)}</span></div>
      </div>
      <div class="success-actions">
        <button class="btn btn-ghost" id="editRegBtn" type="button">Editar inscrição</button>
        <button class="btn btn-ghost" id="printModalRegistrationBtn" type="button">Imprimir</button>
      </div>
    `;

    document.getElementById('editRegBtn').addEventListener('click', () => {
      myRegOverlay.classList.remove('open');
      startEditRegistration();
    });

    document.getElementById('printModalRegistrationBtn').addEventListener('click', printRegistration);
  }

  myRegOverlay.classList.add('open');
}

['navMinhaInscricao', 'navMinhaInscricaoMobile'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', e => {
    e.preventDefault();
    openMyRegistration();
  });
});

function printRegistration() {
  if (!state.myRegistration) return;

  const d = state.myRegistration.data;
  const diasLabel = { quinta: 'Quinta-feira', sexta: 'Sexta-feira', sabado: 'Sábado' };

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;

  const rows = [
    ['Número da inscrição', state.myRegistration.id],
    ['Nome completo', d.nome],
    ['E-mail', d.email],
    ['Telefone / WhatsApp', d.telefone],
    ['Idade', d.idade],
    ['Sexo', d.sexo],
    ['Dias', d.dias.map(x => diasLabel[x]).join(', ')],
    ['Igreja', d.igreja],
    ['Coro / Orquestra', d.coroOrq === 'cantar' ? `Coro — ${d.naipe}` : d.coroOrq === 'instrumento' ? `Orquestra — ${d.instrumento}` : 'Não participará']
  ];

  win.document.write(`
    <!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Comprovante ${escapeHTML(state.myRegistration.id)}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:40px;color:#24312A}
      h1{color:#1A2A21;margin-bottom:6px}
      p{color:#456954}
      table{width:100%;border-collapse:collapse;margin-top:25px}
      td{padding:12px;border-bottom:1px solid #DDE6DE}
      td:first-child{font-weight:700;width:35%;color:#456954}
      .id{display:inline-block;padding:12px 18px;background:#DDE6DE;margin:12px 0;font-weight:700}
    </style></head><body>
    <h1>II Encontro de Música Sacra</h1>
    <p>IBB Vila Brasílio Machado</p>
    <div class="id">${escapeHTML(state.myRegistration.id)}</div>
    <table>${rows.map(r => `<tr><td>${escapeHTML(r[0])}</td><td>${escapeHTML(r[1])}</td></tr>`).join('')}</table>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>
  `);
  win.document.close();
}

document.getElementById('viewSuccessRegistrationBtn').addEventListener('click', openMyRegistration);
document.getElementById('editSuccessRegistrationBtn').addEventListener('click', startEditRegistration);
document.getElementById('printRegistrationBtn').addEventListener('click', printRegistration);
document.getElementById('openKitsSuccessBtn').addEventListener('click', openRehearsalKits);

document.querySelectorAll('a[href="#inscricao"]').forEach(link => {
  link.addEventListener('click', () => {
    if (!state.loggedIn) state.pendingContext = true;
  });
});

const phoneInput = document.getElementById('pTelefone');
phoneInput.addEventListener('input', e => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 10) {
    v = v.replace(/^(\d{2})(\d{5})(\d{4}).*/, '($1) $2-$3');
  } else if (v.length > 6) {
    v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3');
  } else if (v.length > 2) {
    v = v.replace(/^(\d{2})(\d{0,5}).*/, '($1) $2');
  }
  e.target.value = v;
});

async function restoreServerSession() {
  if (!state.authToken) return;
  try {
    const meResponse = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${state.authToken}` }
    });
    if (!meResponse.ok) throw new Error('Sessão expirada.');
    const me = await meResponse.json();
    state.loggedIn = true;
    state.user = me.user;

    const regResponse = await fetch('/api/my-registration', {
      headers: { Authorization: `Bearer ${state.authToken}` }
    });
    if (regResponse.ok) {
      const result = await regResponse.json();
      state.myRegistration = result.registration;
    }
    saveSession();
    updateHeaderUser();
    updateShirtAccess();
    updateKitsAccess();
    if (state.myRegistration) {
      showRegistrationSuccess();
    } else {
      lockedState.style.display = 'none';
      formState.classList.add('visible');
      prefillAccountData();
      renderWizard();
    }
  } catch (_) {
    state.loggedIn = false;
    state.user = null;
    state.myRegistration = null;
    state.authToken = null;
    sessionStorage.removeItem(STORAGE_KEY);
    updateKitsAccess();
  }
}

loadSession();
loadEventConfig();
loadVacancies();
updateKitsAccess();
restoreServerSession();

if (state.loggedIn) {
  updateHeaderUser();
  updateShirtAccess();
  lockedState.style.display = 'none';
  greetingText.textContent = `Olá, ${state.user.name.split(' ')[0]} — complete os dados abaixo para confirmar sua vaga.`;

  ['navMinhaInscricao', 'navMinhaInscricaoMobile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'inline';
  });

  if (state.myRegistration) {
    showRegistrationSuccess();
  } else {
    prefillAccountData();
    formState.classList.add('visible');
  }
}

renderWizard();

// ---------- Contagem regressiva (promo + encerramento das inscrições) ----------
function formatCountdown(msLeft) {
  if (msLeft <= 0) return null;
  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h restantes`;
  if (hours > 0) return `${hours}h ${minutes}min restantes`;
  return `${minutes}min restantes`;
}

function tickCountdown() {
  const earlyBirdEl = document.getElementById('cdEarlyBirdTime');
  const deadlineEl = document.getElementById('cdDeadlineTime');
  if (!earlyBirdEl && !deadlineEl) return;

  const earlyBirdDeadline = new Date(`${(state.config?.pricing?.earlyBirdDeadline) || '2026-04-30'}T23:59:59`);
  const regDeadline = new Date('2026-05-13T23:59:59');
  const now = new Date();

  if (earlyBirdEl) {
    const left = formatCountdown(earlyBirdDeadline - now);
    const block = document.getElementById('countdownEarlyBird');
    if (left) { earlyBirdEl.textContent = left; block?.classList.remove('cd-ended'); }
    else { earlyBirdEl.textContent = 'Prazo encerrado'; block?.classList.add('cd-ended'); }
  }
  if (deadlineEl) {
    const left = formatCountdown(regDeadline - now);
    const block = document.getElementById('countdownDeadline');
    if (left) { deadlineEl.textContent = left; block?.classList.remove('cd-ended'); }
    else { deadlineEl.textContent = 'Inscrições encerradas'; block?.classList.add('cd-ended'); }
  }
}
tickCountdown();
setInterval(tickCountdown, 60 * 1000);

// ---------- Compartilhar no WhatsApp ----------
function setupWhatsappShare() {
  const shareText = 'Vem com a gente no II Encontro de Música Sacra da IBBVBM, de 27 a 29 de maio! Corais, instrumentistas e um tempo de louvor, ensino e comunhão. Inscreva-se:';
  const shareUrl = window.location.href.split('#')[0];
  const waLink = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
  ['whatsappShareHero', 'whatsappShareInsc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.href = waLink;
  });
}
setupWhatsappShare();
