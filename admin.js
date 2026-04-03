/**
 * LinkPY Admin Panel — admin.js v2.2.0
 *
 * Novidades v2.2.0:
 *  ✅ Painel de Leads: exibe mensagens do formulário de contato do site
 *  ✅ Badge de não lidos no botão "Leads" atualizado em tempo real
 *  ✅ Filtro todos / não lidos / lidos
 *  ✅ Marcar como lido ao abrir + "Marcar todos" em lote
 *  ✅ Atalho WhatsApp para responder ao lead
 */

/* ─────────────────────────────────────────
   CONFIG
───────────────────────────────────────── */
const APP_VERSION         = '2.2.0';
const ADMIN_SUPABASE_URL  = 'https://cwauzlddxfalcjcryegb.supabase.co';
const ADMIN_SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YXV6bGRkeGZhbGNqY3J5ZWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzUzMzYsImV4cCI6MjA4ODMxMTMzNn0.2X5A-GqrE9iDtq36G8xbcRE3Ve4KuJFmdQildPr1UeE';
const PROXY_BASE_URL      = `${ADMIN_SUPABASE_URL}/functions/v1/client-proxy`;
const PAGE_SIZE           = 12;

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
let todosClientes  = [];
let paginaAtual    = 1;
let termoBusca     = '';

// Leads
let todosLeads         = [];
let filtroLeadAtual    = 'todos';
let leadAbertoAtual    = null; // { id, nome, ... } para o modal de detalhe

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
  btnLeads:       document.getElementById('btn-leads'),
  leadsBadge:     document.getElementById('leads-badge'),
  btnFinanceiro:  document.getElementById('btn-financeiro'),
  btnLogout:      document.getElementById('btn-logout'),

  // Modal Cliente
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

  // Drawer de Leads
  leadsOverlay:       document.getElementById('leads-overlay'),
  leadsLista:         document.getElementById('leads-lista'),
  leadsTotalBadge:    document.getElementById('leads-total-badge'),
  btnLeadsFechar:     document.getElementById('btn-leads-fechar'),
  btnLeadsMarcarTodos:document.getElementById('btn-leads-marcar-todos'),

  // Modal Lead detalhe
  modalLead:          document.getElementById('modal-lead'),
  leadModalTitulo:    document.getElementById('lead-modal-titulo'),
  leadModalBody:      document.getElementById('lead-modal-body'),
  btnLeadWpp:         document.getElementById('btn-lead-wpp'),
  btnLeadModalFechar: document.getElementById('btn-lead-modal-fechar'),
  btnLeadModalFechar2:document.getElementById('btn-lead-modal-fechar2'),
};

/* ─────────────────────────────────────────
   UTILITÁRIOS
───────────────────────────────────────── */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const texto = (val) => String(val ?? '');

const diasParaVencer = (dataVenc) => {
  if (!dataVenc) return null;
  return Math.ceil((new Date(dataVenc) - new Date()) / 86_400_000);
};

const formatarData = (iso) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : 'Não definido';

const formatarDataHora = (iso) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';

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

const gerarProxyUrl = () => PROXY_BASE_URL;

/* ─────────────────────────────────────────
   TOAST
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
    'padding:.8rem 1.2rem', 'border-radius:8px', 'font-size:.875rem',
    'font-weight:600', 'box-shadow:0 4px 16px rgba(0,0,0,.12)',
    'max-width:360px', 'line-height:1.4',
    `background:${c.bg}`, `color:${c.cor}`, `border:1px solid ${c.borda}`,
    'display:flex', 'align-items:center', 'gap:.5rem',
    'animation:lp-slideIn .2s ease',
  ].join(';');

  const icone = { error: '⚠', success: '✓', info: 'ℹ' }[tipo] ?? '⚠';
  toast.textContent = `${icone} ${msg}`;

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

  [
    ['Responsável', c.responsavel_nome || 'N/A'],
    ['Vencimento',  formatarData(c.vencimento_mensalidade)],
  ].forEach(([label, val]) => {
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
  btnEditar.addEventListener('click', () => abrirModalEditar(c));

  btnGroup.appendChild(btnWpp);
  btnGroup.appendChild(btnEditar);

  article.appendChild(header);
  article.appendChild(info);
  article.appendChild(btnGroup);
  return article;
}

function criarEstadoVazio(busca) {
  const div = document.createElement('div');
  div.className = 'estado-vazio';
  div.innerHTML = `
    <div class="icone">${busca ? '🔍' : '📋'}</div>
    <h3>${busca ? 'Nenhum resultado encontrado' : 'Nenhum cliente cadastrado'}</h3>
    <p>${busca ? `Nenhum cliente corresponde a "${esc(busca)}".` : 'Cadastre seu primeiro cliente clicando em "+ Novo Cliente".'}</p>
  `;
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

function mostrarErroGrid(msg) {
  el.grid.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'estado-vazio';
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
   MODAL CLIENTE — ABRIR / FECHAR / SALVAR
───────────────────────────────────────── */
function abrirModalNovo() {
  el.modalTitulo.textContent = 'Novo Cliente';
  el.campoId.value = '';
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
  el.campoSupaKey.value = '';
  el.campoSupaKey.type  = 'password';
  el.btnToggleKey.textContent = '👁';
  el.btnExcluir.classList.remove('hidden');

  const { data: credData } = await db
    .from('clientes')
    .select('supabase_anon_key')
    .eq('id', c.id)
    .single();
  if (credData?.supabase_anon_key) {
    el.campoSupaKey.value = texto(credData.supabase_anon_key);
  }

  if (c.client_token) {
    el.proxySection.classList.remove('hidden');
    el.displayToken.textContent = texto(c.client_token);
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

/* ═══════════════════════════════════════════
   MÓDULO LEADS
   ─ fetchLeads, renderizarLeads, badge, drawer,
     marcar como lido, modal de detalhe
═══════════════════════════════════════════ */

/** Busca todos os leads do Supabase e atualiza o estado + badge */
async function fetchLeads() {
  const { data, error } = await db
    .from('contatos')
    .select('id, nome, mensagem, criado_em, lido')
    .order('criado_em', { ascending: false });

  if (error) {
    log.error('Erro ao buscar leads:', error);
    return;
  }

  todosLeads = data ?? [];
  atualizarBadgeLeads();

  // Se o drawer estiver aberto, re-renderiza
  if (el.leadsOverlay.classList.contains('open')) {
    renderizarLeads();
  }
}

/** Atualiza o badge de não lidos no botão do header */
function atualizarBadgeLeads() {
  const naoLidos = todosLeads.filter(l => !l.lido).length;
  if (naoLidos > 0) {
    el.leadsBadge.textContent = naoLidos > 99 ? '99+' : String(naoLidos);
    el.leadsBadge.classList.remove('hidden');
  } else {
    el.leadsBadge.classList.add('hidden');
  }
}

/** Renderiza a lista de leads no drawer conforme filtro ativo */
function renderizarLeads() {
  const lista = filtroLeadAtual === 'nao-lidos'
    ? todosLeads.filter(l => !l.lido)
    : filtroLeadAtual === 'lidos'
      ? todosLeads.filter(l => l.lido)
      : todosLeads;

  // Atualiza badge do total exibido
  const naoLidos = todosLeads.filter(l => !l.lido).length;
  if (naoLidos > 0) {
    el.leadsTotalBadge.textContent = `${naoLidos} não lido${naoLidos !== 1 ? 's' : ''}`;
    el.leadsTotalBadge.classList.remove('hidden');
  } else {
    el.leadsTotalBadge.classList.add('hidden');
  }

  el.leadsLista.innerHTML = '';

  if (lista.length === 0) {
    el.leadsLista.innerHTML = `
      <div class="leads-vazio">
        <span class="leads-vazio-icone">${filtroLeadAtual === 'nao-lidos' ? '🎉' : '📭'}</span>
        <p>${filtroLeadAtual === 'nao-lidos' ? 'Nenhuma mensagem não lida!' : 'Nenhuma mensagem encontrada.'}</p>
      </div>
    `;
    return;
  }

  const frag = document.createDocumentFragment();
  lista.forEach(lead => frag.appendChild(criarItemLead(lead)));
  el.leadsLista.appendChild(frag);
}

/** Cria o elemento de um item de lead na lista */
function criarItemLead(lead) {
  const div = document.createElement('div');
  div.className = `lead-item${lead.lido ? ' lead-lido' : ''}`;
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');

  const resumo = esc(
    lead.mensagem.length > 80
      ? lead.mensagem.slice(0, 80) + '…'
      : lead.mensagem
  );

  div.innerHTML = `
    <div class="lead-item-left">
      <div class="lead-dot ${lead.lido ? 'lead-dot-lido' : 'lead-dot-novo'}"></div>
    </div>
    <div class="lead-item-body">
      <div class="lead-item-header">
        <span class="lead-nome">${esc(lead.nome)}</span>
        <span class="lead-data">${formatarDataHora(lead.criado_em)}</span>
      </div>
      <p class="lead-resumo">${resumo}</p>
    </div>
  `;

  const abrir = () => abrirModalLead(lead);
  div.addEventListener('click', abrir);
  div.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });

  return div;
}

/** Abre o modal de detalhe do lead e o marca como lido */
async function abrirModalLead(lead) {
  leadAbertoAtual = lead;

  el.leadModalTitulo.textContent = `Mensagem de ${lead.nome}`;
  el.leadModalBody.innerHTML = `
    <div class="lead-detalhe-meta">
      <span>👤 <strong>${esc(lead.nome)}</strong></span>
      <span>🕐 ${formatarDataHora(lead.criado_em)}</span>
    </div>
    <div class="lead-detalhe-msg">${esc(lead.mensagem)}</div>
  `;

  // Configurar botão WhatsApp — abre conversa genérica sem número
  // (o lead não fornece telefone; o admin entra em contato manualmente)
  el.btnLeadWpp.onclick = () => {
    const msg = encodeURIComponent(
      `Olá, ${lead.nome}! Recebemos sua mensagem enviada pelo nosso site e gostaríamos de conversar sobre sua necessidade. Podemos ajudar?`
    );
    // Abre WhatsApp Web sem número pré-definido para o admin digitar
    window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener,noreferrer');
  };

  el.modalLead.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Marcar como lido se ainda não estiver
  if (!lead.lido) {
    await marcarLeadComoLido(lead.id);
  }
}

function fecharModalLead() {
  el.modalLead.classList.remove('open');
  document.body.style.overflow = '';
  leadAbertoAtual = null;
}

/** Marca um lead como lido no Supabase e atualiza estado local */
async function marcarLeadComoLido(id) {
  const { error } = await db
    .from('contatos')
    .update({ lido: true, lido_em: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    log.error('Erro ao marcar lead como lido:', error);
    return;
  }

  // Atualiza estado local sem re-fetch
  const idx = todosLeads.findIndex(l => l.id === id);
  if (idx !== -1) todosLeads[idx].lido = true;

  atualizarBadgeLeads();
  renderizarLeads();
}

/** Marca TODOS os leads visíveis como lidos em um único update */
async function marcarTodosLeadsComoLidos() {
  const naoLidos = todosLeads.filter(l => !l.lido);
  if (naoLidos.length === 0) {
    mostrarToast('Todos os leads já estão marcados como lidos.', 'info');
    return;
  }

  el.btnLeadsMarcarTodos.disabled    = true;
  el.btnLeadsMarcarTodos.textContent = 'Marcando...';

  const { error } = await db
    .from('contatos')
    .update({ lido: true, lido_em: new Date().toISOString() })
    .eq('lido', false);

  el.btnLeadsMarcarTodos.disabled    = false;
  el.btnLeadsMarcarTodos.textContent = '✓ Todos lidos';

  if (error) {
    log.error('Erro ao marcar todos como lidos:', error);
    mostrarToast('Erro ao atualizar leads.', 'error');
    return;
  }

  // Atualiza estado local
  todosLeads.forEach(l => { l.lido = true; });
  atualizarBadgeLeads();
  renderizarLeads();
  mostrarToast(`${naoLidos.length} lead${naoLidos.length !== 1 ? 's' : ''} marcado${naoLidos.length !== 1 ? 's' : ''} como lido.`, 'success');
}

/** Abre o drawer de leads */
function abrirDrawerLeads() {
  el.leadsOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  renderizarLeads();
}

/** Fecha o drawer de leads */
function fecharDrawerLeads() {
  el.leadsOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* ─────────────────────────────────────────
   REALTIME — escuta novos leads
───────────────────────────────────────── */
function iniciarRealtimeLeads() {
  db.channel('leads-realtime')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'contatos',
    }, (payload) => {
      // Adiciona o novo lead no topo da lista local
      todosLeads.unshift(payload.new);
      atualizarBadgeLeads();
      if (el.leadsOverlay.classList.contains('open')) {
        renderizarLeads();
      }
      mostrarToast('📩 Novo lead recebido!', 'info');
    })
    .subscribe();
}

/* ─────────────────────────────────────────
   INICIALIZAÇÃO
───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {

  // 1. Controle de versão
  const lastVersion = localStorage.getItem('linkpy_version');
  if (lastVersion !== APP_VERSION) {
    Object.keys(localStorage)
      .filter(k => k.startsWith('linkpy_'))
      .forEach(k => localStorage.removeItem(k));
    localStorage.setItem('linkpy_version', APP_VERSION);
  }

  // 2. Auth
  await initAuth(db, () => {
    el.loginContainer.classList.add('hidden');
    el.adminWrapper.classList.remove('hidden');
    fetchClientes();
    fetchLeads();
    iniciarRealtimeLeads();
  });

  // 3. Logout
  initLogout(db);

  // 4. Toolbar
  el.btnNovoCliente.addEventListener('click', abrirModalNovo);
  el.btnFinanceiro.addEventListener('click', () => { window.location.href = 'financeiro.html'; });

  // 5. LEADS — drawer
  el.btnLeads.addEventListener('click', abrirDrawerLeads);
  el.btnLeadsFechar.addEventListener('click', fecharDrawerLeads);
  el.btnLeadsMarcarTodos.addEventListener('click', marcarTodosLeadsComoLidos);

  // Fechar drawer ao clicar no overlay
  el.leadsOverlay.addEventListener('click', (e) => {
    if (e.target === el.leadsOverlay) fecharDrawerLeads();
  });

  // Filtros do drawer
  document.querySelectorAll('.leads-filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.leads-filtro-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtroLeadAtual = btn.dataset.filtro;
      renderizarLeads();
    });
  });

  // Modal lead detalhe
  el.btnLeadModalFechar.addEventListener('click',  fecharModalLead);
  el.btnLeadModalFechar2.addEventListener('click', fecharModalLead);
  el.modalLead.addEventListener('click', (e) => {
    if (e.target === el.modalLead) fecharModalLead();
  });

  // 6. Busca com debounce
  let debounceTimer;
  el.searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      termoBusca  = e.target.value.toLowerCase().trim();
      paginaAtual = 1;
      renderizarGrid();
    }, 280);
  });

  // 7. Modal cliente
  el.modalFechar.addEventListener('click', fecharModal);
  el.btnCancelar.addEventListener('click', fecharModal);
  el.btnSalvar.addEventListener('click', salvarCliente);
  el.btnExcluir.addEventListener('click', excluirCliente);
  el.modalOverlay.addEventListener('click', (e) => {
    if (e.target === el.modalOverlay) fecharModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (el.modalLead.classList.contains('open'))    { fecharModalLead();    return; }
      if (el.leadsOverlay.classList.contains('open')) { fecharDrawerLeads();  return; }
      if (el.modalOverlay.classList.contains('open')) { fecharModal();        return; }
    }
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
