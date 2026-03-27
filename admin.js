/**
 * LinkPY Admin Panel — admin.js v2.1.0
 *
 * Correções desta versão (auditoria 2025):
 * ✅ [Crítico]  supabase_anon_key removida do select de fetchClientes
 *               → chave agora é carregada apenas ao abrir o modal de edição
 * ✅ [Crítico]  Rate limiting persistido em sessionStorage via auth.js
 *               (não é mais resetado com F5)
 * ✅ [Alto]     Token removido da query string de gerarProxyUrl
 *               → URL base do proxy; token vai no body do POST
 * ✅ [Alto]     btn-financeiro redireciona para financeiro.html (era alert placeholder)
 * ✅ [Médio]    mostrarErroGrid usa esc() para sanitizar mensagens de erro (XSS)
 * ✅ [Médio]    auth duplicado removido — agora vive em auth.js
 * ✅ [Baixo]    alert() de salvar/excluir substituído por toast visual
 */

/* ─────────────────────────────────────────
   CONFIG
   Nota: a ADMIN_SUPABASE_KEY (anon key) precisa estar aqui para que
   o Supabase Auth e o RLS funcionem no browser admin. Esta é uma
   limitação arquitetural do painel client-side. Certifique-se de que:
   1. As políticas RLS do seu projeto admin estão corretas (somente
      usuários autenticados conseguem ler a tabela `clientes`).
   2. A anon key NÃO é a service_role key.
   3. A chave seja rotacionada se tiver sido exposta em commits.
───────────────────────────────────────── */
const APP_VERSION         = '2.1.0';
const ADMIN_SUPABASE_URL  = 'https://cwauzlddxfalcjcryegb.supabase.co';
const ADMIN_SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YXV6bGRkeGZhbGNqY3J5ZWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzUzMzYsImV4cCI6MjA4ODMxMTMzNn0.2X5A-GqrE9iDtq36G8xbcRE3Ve4KuJFmdQildPr1UeE';

// URL BASE do proxy — token vai no corpo do POST, nunca na URL
const PROXY_BASE_URL = `${ADMIN_SUPABASE_URL}/functions/v1/client-proxy`;

const PAGE_SIZE = 12;

/* ─────────────────────────────────────────
   LOGGER
───────────────────────────────────────── */
const DEV = localStorage.getItem('linkpy_debug') === 'true';
const log = {
  info:  (...a) => DEV && console.info('[LP]', ...a),
  warn:  (...a) => DEV && console.warn('[LP]', ...a),
  error: (...a) => console.error('[LP ERROR]', ...a),
};

/* ─────────────────────────────────────────
   SUPABASE CLIENT
───────────────────────────────────────── */
const db = window.supabase.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_KEY);

/* ─────────────────────────────────────────
   ESTADO LOCAL
───────────────────────────────────────── */
let todosClientes = [];
let paginaAtual   = 1;
let termoBusca    = '';

/* ─────────────────────────────────────────
   ELEMENTOS DO DOM
───────────────────────────────────────── */
const el = {
  loginContainer: document.getElementById('login-container'),
  adminWrapper:   document.getElementById('admin-wrapper'),
  formLogin:      document.getElementById('form-login'),
  btnSubmit:      document.getElementById('btn-submit-login'),
  loginError:     document.getElementById('login-error'),
  loginErrorMsg:  document.getElementById('login-error-msg'),
  grid:           document.getElementById('grid-clientes'),
  paginacao:      document.getElementById('paginacao'),
  searchInput:    document.getElementById('search-input'),
  contador:       document.getElementById('contador-clientes'),
  btnNovoCliente: document.getElementById('btn-novo-cliente'),
  btnFinanceiro:  document.getElementById('btn-financeiro'),
  btnLogout:      document.getElementById('btn-logout'),
  modalOverlay:   document.getElementById('modal-cliente'),
  modalTitulo:    document.getElementById('modal-titulo'),
  modalFechar:    document.getElementById('modal-fechar'),
  btnSalvar:      document.getElementById('btn-modal-salvar'),
  btnCancelar:    document.getElementById('btn-modal-cancelar'),
  btnExcluir:     document.getElementById('btn-modal-excluir'),
  campoId:        document.getElementById('modal-cliente-id'),
  campoEmpresa:   document.getElementById('campo-empresa'),
  campoResp:      document.getElementById('campo-responsavel'),
  campoTel:       document.getElementById('campo-telefone'),
  campoVenc:      document.getElementById('campo-vencimento'),
  campoSupaUrl:   document.getElementById('campo-supa-url'),
  campoSupaKey:   document.getElementById('campo-supa-key'),
  btnToggleKey:   document.getElementById('btn-toggle-key'),
  proxySection:   document.getElementById('proxy-section'),
  displayToken:   document.getElementById('display-token'),
  displayProxy:   document.getElementById('display-proxy-url'),
  btnCopyToken:   document.getElementById('btn-copy-token'),
  btnCopyProxy:   document.getElementById('btn-copy-proxy'),
};

/* ─────────────────────────────────────────
   UTILITÁRIOS
───────────────────────────────────────── */

/** Escapa caracteres HTML para uso seguro em innerHTML */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Converte valor para string sem escapar (para textContent) */
const texto = (val) => String(val ?? '');

const diasParaVencer = (dataVenc) => {
  if (!dataVenc) return null;
  const diff = new Date(dataVenc) - new Date();
  return Math.ceil(diff / 86_400_000);
};

const formatarData = (iso) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : 'Não definido';

async function copiarParaClipboard(txt, btnEl) {
  try {
    await navigator.clipboard.writeText(txt);
    const orig = btnEl.textContent;
    btnEl.textContent = '✓ Copiado!';
    btnEl.classList.add('copied');
    setTimeout(() => { btnEl.textContent = orig; btnEl.classList.remove('copied'); }, 2000);
  } catch {
    log.error('Falha ao copiar para clipboard');
  }
}

/**
 * Gera a URL base do proxy para exibição — o token NÃO vai na URL.
 * O site do cliente deve fazer POST para esta URL com { token, table, method, ... }
 * no corpo da requisição.
 * ✅ Fix: token removido da query string (evita exposição em logs/Referer/histórico)
 */
const gerarProxyUrl = () => PROXY_BASE_URL;

/* ─────────────────────────────────────────
   TOAST / FEEDBACK VISUAL
   Substitui alert() por notificações não-bloqueantes
───────────────────────────────────────── */
function mostrarToast(msg, tipo = 'error') {
  const cores = {
    error:   { bg: '#fef2f2', cor: '#b91c1c', borda: '#fecaca' },
    success: { bg: '#f0fdf4', cor: '#15803d', borda: '#bbf7d0' },
    info:    { bg: '#eff6ff', cor: '#1d4ed8', borda: '#bfdbfe' },
  };
  const c = cores[tipo] ?? cores.error;

  const toast = document.createElement('div');
  toast.setAttribute('role', 'alert');
  toast.style.cssText = [
    'position:fixed', 'bottom:1.5rem', 'right:1.5rem', 'z-index:9999',
    `padding:.8rem 1.2rem`, 'border-radius:8px', 'font-size:.875rem',
    'font-weight:600', 'box-shadow:0 4px 16px rgba(0,0,0,.12)',
    'max-width:360px', 'line-height:1.4',
    `background:${c.bg}`, `color:${c.cor}`, `border:1px solid ${c.borda}`,
    'display:flex', 'align-items:center', 'gap:.5rem',
    'animation:lp-slideIn .2s ease',
  ].join(';');

  // Ícone
  const icone = { error: '⚠', success: '✓', info: 'ℹ' }[tipo] ?? '⚠';
  toast.textContent = `${icone} ${msg}`;

  // Adicionar keyframes se ainda não existir
  if (!document.getElementById('lp-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'lp-toast-styles';
    style.textContent = '@keyframes lp-slideIn{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}';
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ─────────────────────────────────────────
   CLIENTES — BUSCA
   ✅ Fix: supabase_anon_key REMOVIDA do select
   (chave só é buscada ao abrir modal de edição de 1 cliente)
───────────────────────────────────────── */
async function fetchClientes() {
  mostrarSkeletons();

  const { data, error } = await db
    .from('clientes')
    .select('id, nome_empresa, responsavel_nome, telefone_responsavel, vencimento_mensalidade, supabase_url, client_token')
    .order('nome_empresa', { ascending: true });

  if (error) {
    log.error('Erro ao buscar clientes:', error);
    mostrarErroGrid(error.message);
    return;
  }

  todosClientes = data ?? [];
  paginaAtual   = 1;
  renderizarGrid();
}

/* ─────────────────────────────────────────
   CLIENTES — RENDERIZAÇÃO
───────────────────────────────────────── */
function renderizarGrid() {
  const filtrados = todosClientes.filter(c =>
    c.nome_empresa?.toLowerCase().includes(termoBusca) ||
    c.responsavel_nome?.toLowerCase().includes(termoBusca) ||
    c.telefone_responsavel?.includes(termoBusca)
  );

  const total  = filtrados.length;
  const inicio = (paginaAtual - 1) * PAGE_SIZE;
  const pagina = filtrados.slice(inicio, inicio + PAGE_SIZE);

  el.contador.textContent = `${total} cliente${total !== 1 ? 's' : ''}`;
  el.grid.innerHTML = '';

  if (total === 0) {
    el.grid.appendChild(criarEstadoVazio(termoBusca));
    el.paginacao.innerHTML = '';
    return;
  }

  const frag = document.createDocumentFragment();
  pagina.forEach(c => frag.appendChild(criarCard(c)));
  el.grid.appendChild(frag);
  renderizarPaginacao(total);
}

function criarCard(c) {
  const dias   = diasParaVencer(c.vencimento_mensalidade);
  const alerta = dias !== null && dias <= 5 && dias >= 0;
  const vencido = dias !== null && dias < 0;

  const article = document.createElement('article');
  article.className = `card-cliente${alerta ? ' alerta-vencimento' : ''}`;
  article.setAttribute('role', 'listitem');

  const header = document.createElement('div');
  header.className = 'card-header';

  const h3 = document.createElement('h3');
  h3.textContent = texto(c.nome_empresa);

  const badge = document.createElement('span');
  badge.className = 'badge badge-vencimento';
  if (vencido) {
    badge.className += ' badge-danger';
    badge.textContent = '⚠ Vencido';
  } else if (alerta) {
    badge.className += ' badge-warning';
    badge.textContent = `⏰ ${dias}d`;
  }

  header.appendChild(h3);
  if (vencido || alerta) header.appendChild(badge);

  const info = document.createElement('div');
  info.className = 'card-info';

  const infoRows = [
    ['Responsável', c.responsavel_nome || 'N/A'],
    ['Vencimento',  formatarData(c.vencimento_mensalidade)],
  ];

  infoRows.forEach(([label, val]) => {
    const row    = document.createElement('div');
    row.className = 'card-info-row';
    const strong = document.createElement('strong');
    strong.textContent = label;
    const span   = document.createElement('span');
    span.textContent = val;
    row.appendChild(strong);
    row.appendChild(span);
    info.appendChild(row);
  });

  const credRow   = document.createElement('div');
  credRow.className = 'card-info-row';
  const credLabel = document.createElement('strong');
  credLabel.textContent = 'Sistema';
  const credInd   = document.createElement('span');
  credInd.className = `credential-indicator ${c.supabase_url ? 'has-cred' : 'no-cred'}`;
  credInd.textContent = c.supabase_url ? '✓ Proxy configurado' : '○ Sem credenciais';
  credRow.appendChild(credLabel);
  credRow.appendChild(credInd);
  info.appendChild(credRow);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';

  const btnWpp = document.createElement('button');
  btnWpp.className = 'btn-success';
  btnWpp.textContent = '💬 WhatsApp';
  btnWpp.setAttribute('title', `Enviar mensagem para ${c.nome_empresa}`);
  btnWpp.addEventListener('click', () => enviarWpp(c.telefone_responsavel, c.nome_empresa));

  const btnEditar = document.createElement('button');
  btnEditar.className = 'btn-ghost';
  btnEditar.textContent = '✏ Editar';
  btnEditar.setAttribute('title', 'Editar cliente e credenciais');
  btnEditar.addEventListener('click', () => abrirModalEditar(c));

  btnGroup.appendChild(btnWpp);
  btnGroup.appendChild(btnEditar);

  article.appendChild(header);
  article.appendChild(info);
  article.appendChild(btnGroup);
  return article;
}

function criarEstadoVazio(busca) {
  const div  = document.createElement('div');
  div.className = 'estado-vazio';
  const icone = document.createElement('div');
  icone.className = 'icone';
  icone.textContent = busca ? '🔍' : '📋';
  const h3 = document.createElement('h3');
  h3.textContent = busca ? 'Nenhum resultado encontrado' : 'Nenhum cliente cadastrado';
  const p = document.createElement('p');
  p.textContent = busca
    ? `Nenhum cliente corresponde a "${busca}".`
    : 'Cadastre seu primeiro cliente clicando em "+ Novo Cliente".';
  div.appendChild(icone);
  div.appendChild(h3);
  div.appendChild(p);
  if (!busca) {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:var(--primary);color:white;padding:.6rem 1.25rem;';
    btn.textContent = '+ Cadastrar primeiro cliente';
    btn.addEventListener('click', abrirModalNovo);
    div.appendChild(btn);
  }
  return div;
}

function mostrarSkeletons() {
  el.grid.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const sk = document.createElement('div');
    sk.className = 'skeleton';
    el.grid.appendChild(sk);
  }
  el.paginacao.innerHTML = '';
}

/**
 * ✅ Fix XSS: msg é passada por esc() antes de ir para innerHTML.
 * Anteriormente usava texto() que apenas faz String(), sem escapar HTML.
 */
function mostrarErroGrid(msg) {
  el.grid.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'estado-vazio';
  // esc() sanitiza a mensagem de erro que pode vir do Supabase
  div.innerHTML = `
    <div class="icone">⚠️</div>
    <h3>Erro ao carregar clientes</h3>
    <p style="color:#dc2626">${esc(msg)}</p>
  `;
  const btn = document.createElement('button');
  btn.style.cssText = 'background:var(--primary);color:white;padding:.6rem 1.25rem;margin-top:.5rem;';
  btn.textContent = '↺ Tentar novamente';
  btn.addEventListener('click', fetchClientes);
  div.appendChild(btn);
  el.grid.appendChild(div);
}

/* ─────────────────────────────────────────
   PAGINAÇÃO
───────────────────────────────────────── */
function renderizarPaginacao(total) {
  const totalPaginas = Math.ceil(total / PAGE_SIZE);
  el.paginacao.innerHTML = '';
  if (totalPaginas <= 1) return;

  const btnAntes = document.createElement('button');
  btnAntes.textContent = '←';
  btnAntes.disabled = paginaAtual === 1;
  btnAntes.addEventListener('click', () => { paginaAtual--; renderizarGrid(); window.scrollTo(0, 0); });

  const info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = `${paginaAtual} / ${totalPaginas}`;

  const btnDepois = document.createElement('button');
  btnDepois.textContent = '→';
  btnDepois.disabled = paginaAtual === totalPaginas;
  btnDepois.addEventListener('click', () => { paginaAtual++; renderizarGrid(); window.scrollTo(0, 0); });

  el.paginacao.appendChild(btnAntes);
  el.paginacao.appendChild(info);
  el.paginacao.appendChild(btnDepois);
}

/* ─────────────────────────────────────────
   WHATSAPP
───────────────────────────────────────── */
function enviarWpp(tel, empresa) {
  if (!tel) { mostrarToast('Telefone não cadastrado para este cliente.', 'info'); return; }
  const msg = encodeURIComponent(
    `Olá! Passando para avisar que a mensalidade do sistema de *${empresa}* vence em breve.\n\n` +
    `Por favor, entre em contato para renovar. Qualquer dúvida, estamos à disposição! 😊`
  );
  window.open(`https://wa.me/${tel}?text=${msg}`, '_blank', 'noopener,noreferrer');
}

/* ─────────────────────────────────────────
   MODAL — ABRIR / FECHAR
───────────────────────────────────────── */
function abrirModalNovo() {
  el.modalTitulo.textContent = 'Novo Cliente';
  el.campoId.value      = '';
  el.campoEmpresa.value = '';
  el.campoResp.value    = '';
  el.campoTel.value     = '';
  el.campoVenc.value    = '';
  el.campoSupaUrl.value = '';
  el.campoSupaKey.value = '';
  el.campoSupaKey.type  = 'password';
  el.btnToggleKey.textContent = '👁';
  el.proxySection.classList.add('hidden');
  el.btnExcluir.classList.add('hidden');
  abrirModal();
}

/**
 * ✅ Fix: supabase_anon_key é buscada separadamente para 1 cliente,
 * somente quando o modal de edição é aberto.
 * Antes, a chave de TODOS os clientes trafegava para o browser na carga inicial.
 */
async function abrirModalEditar(c) {
  el.modalTitulo.textContent = `Editar — ${c.nome_empresa}`;
  el.campoId.value      = String(c.id);
  el.campoEmpresa.value = texto(c.nome_empresa);
  el.campoResp.value    = texto(c.responsavel_nome);
  el.campoTel.value     = texto(c.telefone_responsavel);
  el.campoVenc.value    = c.vencimento_mensalidade
    ? new Date(c.vencimento_mensalidade).toISOString().split('T')[0]
    : '';
  el.campoSupaUrl.value = texto(c.supabase_url);
  el.campoSupaKey.value = '';      // limpa enquanto carrega
  el.campoSupaKey.type  = 'password';
  el.btnToggleKey.textContent = '👁';
  el.btnExcluir.classList.remove('hidden');

  // Buscar apenas a chave deste cliente (somente quando necessário)
  const { data: credData } = await db
    .from('clientes')
    .select('supabase_anon_key')
    .eq('id', c.id)
    .single();
  if (credData?.supabase_anon_key) {
    el.campoSupaKey.value = texto(credData.supabase_anon_key);
  }

  // Proxy info — URL base sem token; token vai no body do POST
  if (c.client_token) {
    el.proxySection.classList.remove('hidden');
    el.displayToken.textContent = texto(c.client_token);
    // ✅ Fix: gerarProxyUrl() agora retorna apenas a URL base
    el.displayProxy.textContent = gerarProxyUrl();
  } else {
    el.proxySection.classList.add('hidden');
  }

  abrirModal();
}

function abrirModal() {
  el.modalOverlay.classList.add('open');
  el.campoEmpresa.focus();
  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  el.modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* ─────────────────────────────────────────
   MODAL — SALVAR / EXCLUIR
   ✅ Fix: alert() substituído por mostrarToast()
───────────────────────────────────────── */
async function salvarCliente() {
  let valido = true;
  if (!el.campoEmpresa.value.trim()) {
    document.getElementById('erro-empresa').classList.remove('hidden');
    el.campoEmpresa.classList.add('input-error');
    valido = false;
  } else {
    document.getElementById('erro-empresa').classList.add('hidden');
    el.campoEmpresa.classList.remove('input-error');
  }
  if (!el.campoTel.value.trim()) {
    document.getElementById('erro-telefone').classList.remove('hidden');
    el.campoTel.classList.add('input-error');
    valido = false;
  } else {
    document.getElementById('erro-telefone').classList.add('hidden');
    el.campoTel.classList.remove('input-error');
  }
  if (!valido) return;

  const payload = {
    nome_empresa:           el.campoEmpresa.value.trim(),
    responsavel_nome:       el.campoResp.value.trim() || null,
    telefone_responsavel:   el.campoTel.value.trim(),
    vencimento_mensalidade: el.campoVenc.value || null,
    supabase_url:           el.campoSupaUrl.value.trim() || null,
    supabase_anon_key:      el.campoSupaKey.value.trim() || null,
  };

  el.btnSalvar.disabled    = true;
  el.btnSalvar.textContent = 'Salvando...';

  const id = el.campoId.value;
  let error;

  if (id) {
    ({ error } = await db.from('clientes').update(payload).eq('id', id));
  } else {
    ({ error } = await db.from('clientes').insert(payload));
  }

  el.btnSalvar.disabled    = false;
  el.btnSalvar.textContent = 'Salvar';

  if (error) {
    log.error('Erro ao salvar cliente:', error);
    mostrarToast(`Erro ao salvar: ${error.message}`, 'error');
    return;
  }

  fecharModal();
  mostrarToast('Cliente salvo com sucesso!', 'success');
  fetchClientes();
}

async function excluirCliente() {
  const id   = el.campoId.value;
  const nome = el.campoEmpresa.value;
  if (!id) return;
  if (!confirm(`Tem certeza que deseja excluir "${nome}"? Essa ação não pode ser desfeita.`)) return;

  el.btnExcluir.disabled    = true;
  el.btnExcluir.textContent = 'Excluindo...';

  const { error } = await db.from('clientes').delete().eq('id', id);

  el.btnExcluir.disabled    = false;
  el.btnExcluir.textContent = '🗑 Excluir';

  if (error) {
    log.error('Erro ao excluir cliente:', error);
    mostrarToast(`Erro ao excluir: ${error.message}`, 'error');
    return;
  }

  fecharModal();
  mostrarToast('Cliente excluído.', 'success');
  fetchClientes();
}

/* ─────────────────────────────────────────
   INICIALIZAÇÃO
───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {

  // 1. Controle de versão — remoção seletiva de localStorage
  const lastVersion = localStorage.getItem('linkpy_version');
  if (lastVersion !== APP_VERSION) {
    Object.keys(localStorage)
      .filter(k => k.startsWith('linkpy_'))
      .forEach(k => localStorage.removeItem(k));
    localStorage.setItem('linkpy_version', APP_VERSION);
  }

  // 2. Auth (via módulo compartilhado auth.js)
  //    initAuth verifica sessão ativa e configura o form de login
  await initAuth(db, () => {
    el.loginContainer.classList.add('hidden');
    el.adminWrapper.classList.remove('hidden');
    fetchClientes();
  });

  // 3. Logout
  initLogout(db);

  // 4. Toolbar
  el.btnNovoCliente.addEventListener('click', abrirModalNovo);

  // ✅ Fix: redireciona para financeiro.html em vez de alert() placeholder
  el.btnFinanceiro.addEventListener('click', () => {
    window.location.href = 'financeiro.html';
  });

  // 5. Busca com debounce
  let debounceTimer;
  el.searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      termoBusca  = e.target.value.toLowerCase().trim();
      paginaAtual = 1;
      renderizarGrid();
    }, 280);
  });

  // 6. Modal
  el.modalFechar.addEventListener('click', fecharModal);
  el.btnCancelar.addEventListener('click', fecharModal);
  el.btnSalvar.addEventListener('click', salvarCliente);
  el.btnExcluir.addEventListener('click', excluirCliente);

  el.modalOverlay.addEventListener('click', (e) => {
    if (e.target === el.modalOverlay) fecharModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.modalOverlay.classList.contains('open')) fecharModal();
  });

  el.btnToggleKey.addEventListener('click', () => {
    const mostrar = el.campoSupaKey.type === 'password';
    el.campoSupaKey.type = mostrar ? 'text' : 'password';
    el.btnToggleKey.textContent = mostrar ? '🙈' : '👁';
  });

  el.btnCopyToken.addEventListener('click', () =>
    copiarParaClipboard(el.displayToken.textContent, el.btnCopyToken));
  el.btnCopyProxy.addEventListener('click', () =>
    copiarParaClipboard(el.displayProxy.textContent, el.btnCopyProxy));
});
