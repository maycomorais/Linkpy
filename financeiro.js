/**
 * LinkPY Financeiro — financeiro.js v3.0.0
 *
 * Novidades v3.0.0:
 *  ✅ Busca de cliente com dropdown pesquisável nos modais (fix principal)
 *  ✅ Filtro por cliente nas toolbars de Cobranças e Propostas
 *  ✅ Tipo "Implementação" adicionado (além de Mensalidade, Setup, Avulso)
 *  ✅ Toggle de moeda nos KPIs (₲ PYG / R$ BRL / $ USD)
 *  ✅ KPI de Lucro Líquido do mês
 *  ✅ Painel "Clientes em Risco / Suspensos" no Dashboard
 *  ✅ Multi-moeda: PYG, BRL, USD em cobranças, despesas e propostas
 *  ✅ Conversão automática para PYG (taxa MoneyGram com spread ~6%)
 *  ✅ API de câmbio em tempo real (cache de 1h)
 */

/* ─────────────────────────────────────────
   CONFIG
───────────────────────────────────────── */
const ADMIN_SUPABASE_URL = 'https://cwauzlddxfalcjcryegb.supabase.co';
const ADMIN_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YXV6bGRkeGZhbGNqY3J5ZWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzUzMzYsImV4cCI6MjA4ODMxMTMzNn0.2X5A-GqrE9iDtq36G8xbcRE3Ve4KuJFmdQildPr1UeE';
const GRACE_DAYS = 5; // dias de carência — mesmo valor da edge function

const db = window.supabase.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_KEY);

/* ─────────────────────────────────────────
   MÓDULO DE CÂMBIO
───────────────────────────────────────── */
const Cambio = {
  _rates:    null,
  _fetched:  null,
  _CACHE_MS: 60 * 60 * 1000,
  _SPREAD:   0.06,
  _FALLBACK: { usd_pyg: 7850, brl_pyg: 1380 },

  async _fetchRates() {
    const url = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const usdRates = json.usd;
    const usdPyg = usdRates.pyg;
    const brlPyg = usdPyg / usdRates.brl;
    return { usd_pyg: usdPyg, brl_pyg: brlPyg };
  },

  async getRates() {
    const agora = Date.now();
    if (this._rates && this._fetched && (agora - this._fetched) < this._CACHE_MS) {
      return this._rates;
    }
    try {
      this._rates  = await this._fetchRates();
      this._fetched = agora;
    } catch (e) {
      console.warn('[Cambio] Fallback rates:', e.message);
      if (!this._rates) this._rates = this._FALLBACK;
    }
    return this._rates;
  },

  async toPYG(valor, moeda) {
    const v = Number(valor);
    if (!v || isNaN(v)) return 0;
    if (moeda === 'PYG') return Math.round(v);
    const rates = await this.getRates();
    const base  = moeda === 'USD' ? rates.usd_pyg : rates.brl_pyg;
    return Math.round(v * base * (1 + this._SPREAD));
  },

  /** Converte PYG para outra moeda (sem spread — só para exibição nos KPIs) */
  async fromPYG(valorPYG, moeda) {
    if (moeda === 'PYG') return Math.round(Number(valorPYG));
    const rates = await this.getRates();
    const base  = moeda === 'USD' ? rates.usd_pyg : rates.brl_pyg;
    return Number(valorPYG) / base;
  },

  async getDisplayRate(moeda) {
    if (moeda === 'PYG') return 1;
    const rates = await this.getRates();
    const base  = moeda === 'USD' ? rates.usd_pyg : rates.brl_pyg;
    return Math.round(base * (1 + this._SPREAD));
  },

  async atualizarStrip() {
    try {
      const rates = await this.getRates();
      const usdDisp = Math.round(rates.usd_pyg * (1 + this._SPREAD));
      const brlDisp = Math.round(rates.brl_pyg * (1 + this._SPREAD));
      const usdEl  = document.getElementById('taxa-usd');
      const brlEl  = document.getElementById('taxa-brl');
      const updEl  = document.getElementById('taxa-atualizado');
      if (usdEl) usdEl.textContent = `$ 1 USD = ₲ ${usdDisp.toLocaleString('es-PY')}`;
      if (brlEl) brlEl.textContent = `R$ 1 BRL = ₲ ${brlDisp.toLocaleString('es-PY')}`;
      if (updEl && this._fetched) {
        const hora = new Date(this._fetched).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        updEl.textContent = `atualizado ${hora}`;
      }
    } catch { /* silencioso */ }
  },
};

/* ─────────────────────────────────────────
   ESTADO
───────────────────────────────────────── */
let clientes     = [];
let cobrancas    = [];
let despesas     = [];
let propostas    = [];
let chartReceita = null;
let kpiMoeda     = 'PYG';   // moeda ativa nos KPIs

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
  ].join(';');
  toast.textContent = `${{ error: '⚠', success: '✓', info: 'ℹ' }[tipo] ?? '⚠'} ${msg}`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ─────────────────────────────────────────
   FORMATADORES
───────────────────────────────────────── */
const moenaPYG = (v) => {
  if (v == null || v === '' || isNaN(Number(v))) return '—';
  return `₲ ${Math.round(Number(v)).toLocaleString('es-PY')}`;
};

const moedaOriginal = (valor, moeda) => {
  if (valor == null) return '—';
  const sym = { PYG: '₲', BRL: 'R$', USD: '$' }[moeda] ?? moeda;
  if (moeda === 'PYG') return `${sym} ${Math.round(Number(valor)).toLocaleString('es-PY')}`;
  return `${sym} ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Formata um valor em PYG para exibição na moeda do toggle de KPI */
async function formatKpi(valorPYG) {
  if (kpiMoeda === 'PYG') return moenaPYG(valorPYG);
  const converted = await Cambio.fromPYG(valorPYG, kpiMoeda);
  if (kpiMoeda === 'BRL') return `R$ ${converted.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (kpiMoeda === 'USD') return `$ ${converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return moenaPYG(valorPYG);
}

const dataLocal = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
};

const diasAte = (iso) => {
  if (!iso) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(iso + 'T00:00:00');
  return Math.round((alvo - hoje) / 86_400_000);
};

const nomeCliente = (id) =>
  clientes.find(c => c.id === id)?.nome_empresa ?? 'Cliente removido';

const telCliente = (id) =>
  clientes.find(c => c.id === id)?.telefone_responsavel ?? '';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ─────────────────────────────────────────
   EQUIVALENTE PYG — helper para modais
───────────────────────────────────────── */
async function atualizarEquivPYG(valorInput, moedaSelect, equivEl) {
  const valor = parseFloat(valorInput.value);
  const moeda = moedaSelect.value;
  if (!valor || isNaN(valor) || moeda === 'PYG') {
    equivEl.classList.add('hidden'); return;
  }
  const pyg = await Cambio.toPYG(valor, moeda);
  equivEl.textContent = `≈ ${moenaPYG(pyg)} (com spread 6%)`;
  equivEl.classList.remove('hidden');
}

function bindEquiv(valorId, moedaId, equivId) {
  const vEl = document.getElementById(valorId);
  const mEl = document.getElementById(moedaId);
  const eEl = document.getElementById(equivId);
  if (!vEl || !mEl || !eEl) return;
  const upd = () => atualizarEquivPYG(vEl, mEl, eEl);
  vEl.addEventListener('input', upd);
  mEl.addEventListener('change', upd);
}

/* ─────────────────────────────────────────
   DROPDOWN DE BUSCA DE CLIENTE (nos modais)
───────────────────────────────────────── */
/**
 * Vincula o dropdown de busca de clientes a um modal.
 * @param {string} searchId   - id do input de texto
 * @param {string} hiddenId   - id do input hidden (armazena o UUID)
 * @param {string} dropdownId - id do div dropdown
 */
function bindClientSearch(searchId, hiddenId, dropdownId) {
  const input    = document.getElementById(searchId);
  const hidden   = document.getElementById(hiddenId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !hidden || !dropdown) return;

  function renderOpcoes(filtro = '') {
    const lc = filtro.toLowerCase();
    const lista = clientes.filter(c =>
      !lc || c.nome_empresa.toLowerCase().includes(lc)
    );

    dropdown.innerHTML = [
      `<div class="cliente-option" data-id="" data-nome="">— Sem cliente —</div>`,
      ...lista.map(c =>
        `<div class="cliente-option" data-id="${esc(c.id)}" data-nome="${esc(c.nome_empresa)}">${esc(c.nome_empresa)}</div>`
      ),
    ].join('');

    dropdown.querySelectorAll('.cliente-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        hidden.value = opt.dataset.id;
        input.value  = opt.dataset.nome;
        dropdown.classList.remove('open');
      });
    });

    dropdown.classList.toggle('open', lista.length > 0 || !filtro);
  }

  input.addEventListener('focus', () => renderOpcoes(input.value));
  input.addEventListener('input', () => renderOpcoes(input.value));
  input.addEventListener('blur',  () => setTimeout(() => dropdown.classList.remove('open'), 180));

  // Limpa hidden se o texto for apagado manualmente
  input.addEventListener('change', () => {
    if (!input.value.trim()) hidden.value = '';
  });
}

/** Define o cliente selecionado programaticamente (ao abrir modal em edição) */
function setClienteSearch(searchId, hiddenId, clienteId) {
  const input  = document.getElementById(searchId);
  const hidden = document.getElementById(hiddenId);
  if (!input || !hidden) return;
  hidden.value = clienteId ?? '';
  input.value  = clienteId ? nomeCliente(clienteId) : '';
}

/* ─────────────────────────────────────────
   INICIALIZAÇÃO DO APP (após login)
───────────────────────────────────────── */
async function iniciarApp() {
  document.getElementById('login-container').classList.add('hidden');
  document.getElementById('fin-wrapper').classList.remove('hidden');

  await Cambio.getRates();
  Cambio.atualizarStrip();

  await carregarClientes();
  await Promise.all([carregarCobrancas(), carregarDespesas(), carregarPropostas()]);

  renderizarDashboard();
  popularSelects();

  // Vincula dropdowns de busca de clientes nos modais
  bindClientSearch('cob-cliente-search', 'cob-cliente', 'cob-cliente-dropdown');
  bindClientSearch('prop-cliente-search', 'prop-cliente', 'prop-cliente-dropdown');

  // Bind equivalentes PYG
  bindEquiv('cob-valor', 'cob-moeda', 'cob-equiv');
  bindEquiv('desp-valor', 'desp-moeda', 'desp-equiv');
  bindEquiv('prop-valor', 'prop-moeda', 'prop-equiv');
}

/* ─────────────────────────────────────────
   CARREGAMENTO DE DADOS
───────────────────────────────────────── */
async function carregarClientes() {
  const { data } = await db
    .from('clientes')
    .select('id, nome_empresa, telefone_responsavel, ativo, suspenso_auto, vencimento_mensalidade')
    .order('nome_empresa');
  clientes = data ?? [];
}

async function carregarCobrancas() {
  const { data, error } = await db
    .from('cobrancas')
    .select('id, cliente_id, descricao, tipo, valor, moeda, valor_original, status, data_vencimento, data_pagamento, observacoes')
    .order('data_vencimento', { ascending: true });
  if (!error) cobrancas = data ?? [];
}

async function carregarDespesas() {
  const { data, error } = await db
    .from('despesas')
    .select('id, descricao, categoria, valor, moeda, valor_original, data, observacoes')
    .order('data', { ascending: false });
  if (!error) despesas = data ?? [];
}

async function carregarPropostas() {
  const { data, error } = await db
    .from('propostas')
    .select('id, cliente_id, titulo, descricao, valor, moeda, valor_original, status, validade, created_at')
    .order('created_at', { ascending: false });
  if (!error) propostas = data ?? [];
}

/* ─────────────────────────────────────────
   POPULAR SELECTS (toolbars)
───────────────────────────────────────── */
function popularSelects() {
  // Selects de filtro nas toolbars
  const opcoesFiltro = ['<option value="">Todos os clientes</option>']
    .concat(clientes.map(c => `<option value="${esc(c.id)}">${esc(c.nome_empresa)}</option>`))
    .join('');

  ['filtro-cliente-cob', 'filtro-cliente-prop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opcoesFiltro;
  });
}

/* ─────────────────────────────────────────
   DASHBOARD — KPIs
───────────────────────────────────────── */
async function renderizarDashboard() {
  const hoje     = new Date(); hoje.setHours(0, 0, 0, 0);
  const mesInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const mesFim    = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

  const pendentes = cobrancas.filter(c =>
    c.status === 'pendente' && new Date(c.data_vencimento + 'T00:00:00') >= hoje
  );
  const atrasadas = cobrancas.filter(c => {
    if (!['pendente', 'vencido'].includes(c.status)) return false;
    return new Date(c.data_vencimento + 'T00:00:00') < hoje;
  });
  const pagosMes = cobrancas.filter(c => {
    if (c.status !== 'pago' || !c.data_pagamento) return false;
    const dp = new Date(c.data_pagamento + 'T00:00:00');
    return dp >= mesInicio && dp <= mesFim;
  });
  const despMes = despesas.filter(d => {
    const dd = new Date(d.data + 'T00:00:00');
    return dd >= mesInicio && dd <= mesFim;
  });

  const somaValor = (arr) => arr.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const totalRecebido = somaValor(pagosMes);
  const totalDesp     = somaValor(despMes);
  const lucro         = totalRecebido - totalDesp;

  const set = async (id, pyg, sub) => {
    const el    = document.getElementById(id);
    const subEl = document.getElementById(id + '-qtd');
    if (el)    el.textContent    = await formatKpi(pyg);
    if (subEl) subEl.textContent = sub;
  };

  await set('kpi-a-receber', somaValor(pendentes), `${pendentes.length} cobrança(s)`);
  await set('kpi-recebido',  totalRecebido,        `${pagosMes.length} pago(s) este mês`);
  await set('kpi-atrasado',  somaValor(atrasadas), `${atrasadas.length} em atraso`);
  await set('kpi-despesas',  totalDesp,            `${despMes.length} lançamento(s)`);

  const lucroEl    = document.getElementById('kpi-lucro');
  const lucroQtdEl = document.getElementById('kpi-lucro-qtd');
  if (lucroEl) {
    lucroEl.textContent = await formatKpi(Math.abs(lucro));
    lucroEl.style.color = lucro >= 0 ? 'var(--success)' : 'var(--danger)';
  }
  if (lucroQtdEl) lucroQtdEl.textContent = lucro >= 0 ? '↑ positivo' : '↓ negativo';

  // Próximos vencimentos
  const proximos = [...cobrancas]
    .filter(c => c.status === 'pendente')
    .sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento))
    .slice(0, 10);

  const listaEl = document.getElementById('lista-proximos');
  listaEl.innerHTML = proximos.length === 0
    ? '<p style="padding:1rem 1.25rem;color:var(--text-hint);font-size:.8rem">Nenhum vencimento pendente.</p>'
    : proximos.map(c => {
      const dias    = diasAte(c.data_vencimento);
      const vencido = dias !== null && dias < 0;
      return `
        <div class="recente-item" data-id="${c.id}" style="cursor:pointer">
          <div class="recente-dot ${vencido ? 'dot-vencido' : 'dot-pendente'}"></div>
          <div class="recente-body">
            <div class="recente-nome">${esc(nomeCliente(c.cliente_id))} — ${esc(c.descricao)}</div>
            <div class="recente-data">${vencido ? '⚠ ' : ''}${dataLocal(c.data_vencimento)}${dias !== null ? ` (${vencido ? Math.abs(dias) + 'd atraso' : dias === 0 ? 'hoje' : dias + 'd'})` : ''}</div>
          </div>
          <div class="recente-valor">${moenaPYG(c.valor)}</div>
        </div>`;
    }).join('');

  listaEl.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const c = cobrancas.find(x => x.id === el.dataset.id);
      if (c) abrirModalCob(c);
    });
  });

  renderizarClientesEmRisco();
  renderizarGrafico();
}

/* ─────────────────────────────────────────
   PAINEL CLIENTES EM RISCO / SUSPENSOS
───────────────────────────────────────── */
function renderizarClientesEmRisco() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  // Agrupa cobranças atrasadas por cliente
  const byCliente = {};
  cobrancas.forEach(c => {
    if (!['pendente', 'vencido'].includes(c.status) || !c.data_vencimento) return;
    const venc = new Date(c.data_vencimento + 'T00:00:00');
    const dias = Math.floor((hoje - venc) / 86_400_000);
    if (dias <= 0) return;
    const key = c.cliente_id || '__sem__';
    if (!byCliente[key]) byCliente[key] = { maxDias: 0, total: 0, count: 0 };
    if (dias > byCliente[key].maxDias) byCliente[key].maxDias = dias;
    byCliente[key].total += Number(c.valor ?? 0);
    byCliente[key].count++;
  });

  const sorted = Object.entries(byCliente).sort((a, b) => b[1].maxDias - a[1].maxDias);
  const emRisco = sorted.filter(([, d]) => d.maxDias > GRACE_DAYS);

  const painel   = document.getElementById('painel-risco');
  const badge    = document.getElementById('risco-count-badge');

  if (!painel) return;

  // Atualiza badge de contagem no cabeçalho
  if (badge) {
    if (emRisco.length > 0) {
      badge.textContent = emRisco.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  if (sorted.length === 0) {
    painel.innerHTML = '<div class="risco-ok">✅ Nenhum cliente com cobrança em atraso.</div>';
    return;
  }

  painel.innerHTML = sorted.map(([clienteId, d]) => {
    const critico = d.maxDias > GRACE_DAYS;
    const cliente = clientes.find(c => c.id === clienteId);
    // Verifica se o cliente está marcado como suspenso automaticamente no banco
    const suspensoAuto = cliente?.suspenso_auto === true;
    const inativo      = cliente?.ativo === false;

    return `
      <div class="risco-item ${critico ? 'risco-critico' : ''}">
        <div class="risco-info">
          <span class="risco-nome">${esc(nomeCliente(clienteId === '__sem__' ? null : clienteId))}</span>
          <span class="risco-detalhes">${d.count} cobrança(s) em atraso · ${moenaPYG(d.total)}</span>
        </div>
        <div class="risco-badges">
          <span class="dias-badge ${critico ? 'dias-critico' : 'dias-warn'}">${d.maxDias}d atraso</span>
          ${inativo
            ? '<span class="status-badge status-vencido">🔴 Suspenso</span>'
            : critico
              ? '<span class="status-badge status-vencido">⚡ Suspenso Auto</span>'
              : '<span class="status-badge status-pendente">⏰ Em Risco</span>'
          }
        </div>
      </div>`;
  }).join('');
}

/* ─────────────────────────────────────────
   GRÁFICO
───────────────────────────────────────── */
function renderizarGrafico() {
  const meses = [];
  const hoje  = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    meses.push({
      label:  d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      inicio: new Date(d.getFullYear(), d.getMonth(), 1),
      fim:    new Date(d.getFullYear(), d.getMonth() + 1, 0),
    });
  }

  const recebido = meses.map(m =>
    cobrancas
      .filter(c => {
        if (c.status !== 'pago' || !c.data_pagamento) return false;
        const dp = new Date(c.data_pagamento + 'T00:00:00');
        return dp >= m.inicio && dp <= m.fim;
      })
      .reduce((s, c) => s + Number(c.valor ?? 0), 0)
  );

  const despMes = meses.map(m =>
    despesas
      .filter(d => {
        const dd = new Date(d.data + 'T00:00:00');
        return dd >= m.inicio && dd <= m.fim;
      })
      .reduce((s, d) => s + Number(d.valor ?? 0), 0)
  );

  const ctx = document.getElementById('chart-receita')?.getContext('2d');
  if (!ctx) return;
  if (chartReceita) chartReceita.destroy();

  chartReceita = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: meses.map(m => m.label),
      datasets: [
        { label: 'Recebido (₲)', data: recebido, backgroundColor: 'rgba(22,163,74,.75)', borderRadius: 5, borderSkipped: false },
        { label: 'Despesas (₲)', data: despMes,  backgroundColor: 'rgba(220,38,38,.55)',  borderRadius: 5, borderSkipped: false },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Inter', size: 12 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${moenaPYG(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } },
        y: {
          beginAtZero: true,
          ticks: {
            font: { family: 'Inter', size: 11 },
            callback: (v) => '₲ ' + Intl.NumberFormat('es-PY', { notation: 'compact' }).format(v),
          },
          grid: { color: '#f1f5f9' },
        },
      },
    },
  });
}

/* ─────────────────────────────────────────
   COBRANÇAS — TABELA
───────────────────────────────────────── */
function filtrarCobrancas() {
  const busca     = document.getElementById('busca-cobrancas')?.value.toLowerCase() ?? '';
  const status    = document.getElementById('filtro-status-cob')?.value ?? '';
  const tipo      = document.getElementById('filtro-tipo-cob')?.value ?? '';
  const clienteId = document.getElementById('filtro-cliente-cob')?.value ?? '';

  return cobrancas.filter(c => {
    const desc = (c.descricao ?? '').toLowerCase();
    if (busca     && !desc.includes(busca)) return false;
    if (status    && c.status    !== status) return false;
    if (tipo      && c.tipo      !== tipo)   return false;
    if (clienteId && c.cliente_id !== clienteId) return false;
    return true;
  });
}

const TIPO_LABELS = {
  mensalidade:  'Mensalidade',
  setup:        'Setup',
  implementacao: 'Implementação',
  avulso:       'Avulso',
};
const tipoLabel = (t) => TIPO_LABELS[t] ?? t;

function renderizarCobrancas() {
  const dados = filtrarCobrancas();
  const elTab = document.getElementById('tabela-cobrancas');

  if (dados.length === 0) {
    elTab.innerHTML = '<div class="tabela-vazia"><div class="icone">📋</div><p>Nenhuma cobrança encontrada.</p></div>';
    return;
  }

  const tbody = dados.map(c => {
    const dias = diasAte(c.data_vencimento);
    let classeData = '';
    if (c.status === 'pendente' && dias !== null) {
      if (dias < 0)       classeData = 'data-vencida';
      else if (dias <= 5) classeData = 'data-proxima';
    }
    const moedaFmt = c.moeda && c.moeda !== 'PYG' && c.valor_original
      ? `<span class="moeda-badge moeda-${c.moeda.toLowerCase()}">${c.moeda}</span> ${moedaOriginal(c.valor_original, c.moeda)}`
      : moenaPYG(c.valor);

    return `<tr data-id="${c.id}" class="linha-cobranca">
      <td>${esc(nomeCliente(c.cliente_id))}</td>
      <td>${esc(c.descricao)}</td>
      <td><span class="tipo-badge">${esc(tipoLabel(c.tipo))}</span></td>
      <td class="col-valor ${c.status === 'pago' ? 'col-verde' : c.status === 'vencido' ? 'col-vermelho' : ''}">${moedaFmt}</td>
      <td class="${classeData}">${dataLocal(c.data_vencimento)}</td>
      <td><span class="status-badge status-${c.status}">${labelStatus(c.status)}</span></td>
    </tr>`;
  }).join('');

  elTab.innerHTML = `
    <table class="fin-table" role="grid">
      <thead><tr>
        <th>Cliente</th><th>Descrição</th><th>Tipo</th>
        <th>Valor</th><th>Vencimento</th><th>Status</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

  elTab.querySelectorAll('.linha-cobranca').forEach(tr => {
    tr.addEventListener('click', () => {
      const c = cobrancas.find(x => x.id === tr.dataset.id);
      if (c) abrirModalCob(c);
    });
  });
}

/* ─────────────────────────────────────────
   COBRANÇAS — MODAL
───────────────────────────────────────── */
function abrirModalCob(c = null) {
  const modal = document.getElementById('modal-cobranca');
  document.getElementById('modal-cob-titulo').textContent = c ? 'Editar Cobrança' : 'Nova Cobrança';
  document.getElementById('cob-id').value              = c?.id ?? '';
  document.getElementById('cob-descricao').value       = c?.descricao ?? '';
  document.getElementById('cob-vencimento').value      = c?.data_vencimento ?? '';
  document.getElementById('cob-tipo').value            = c?.tipo ?? 'mensalidade';
  document.getElementById('cob-status').value          = c?.status ?? 'pendente';
  document.getElementById('cob-data-pagamento').value  = c?.data_pagamento ?? '';
  document.getElementById('cob-obs').value             = c?.observacoes ?? '';

  // Dropdown de cliente pesquisável
  setClienteSearch('cob-cliente-search', 'cob-cliente', c?.cliente_id ?? null);

  // Multi-moeda
  const moeda = c?.moeda ?? 'PYG';
  document.getElementById('cob-moeda').value = moeda;
  document.getElementById('cob-valor').value = moeda !== 'PYG' && c?.valor_original
    ? c.valor_original : (c?.valor ?? '');
  document.getElementById('cob-equiv').classList.add('hidden');

  document.getElementById('btn-cob-excluir').classList.toggle('hidden', !c);
  document.getElementById('btn-cob-whatsapp').classList.toggle('hidden', !c || !telCliente(c.cliente_id));
  abrirModal(modal);
}

async function salvarCobranca() {
  const id         = document.getElementById('cob-id').value;
  const descricao  = document.getElementById('cob-descricao').value.trim();
  const valorRaw   = parseFloat(document.getElementById('cob-valor').value);
  const moeda      = document.getElementById('cob-moeda').value;
  const vencimento = document.getElementById('cob-vencimento').value;
  const clienteId  = document.getElementById('cob-cliente').value || null;

  if (!descricao || !vencimento || isNaN(valorRaw)) {
    mostrarToast('Preencha descrição, valor e vencimento.', 'error'); return;
  }

  const valorPYG = await Cambio.toPYG(valorRaw, moeda);

  const payload = {
    cliente_id:      clienteId,
    descricao,
    valor:           valorPYG,
    moeda,
    valor_original:  valorRaw,
    tipo:            document.getElementById('cob-tipo').value,
    status:          document.getElementById('cob-status').value,
    data_vencimento: vencimento,
    data_pagamento:  document.getElementById('cob-data-pagamento').value || null,
    observacoes:     document.getElementById('cob-obs').value.trim() || null,
  };

  const btn = document.getElementById('btn-cob-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const { error } = id
    ? await db.from('cobrancas').update(payload).eq('id', id)
    : await db.from('cobrancas').insert(payload);

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) { mostrarToast('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-cobranca'));
  mostrarToast('Cobrança salva!', 'success');
  await carregarCobrancas();
  renderizarCobrancas();
  await renderizarDashboard();
}

async function excluirCobranca() {
  const id   = document.getElementById('cob-id').value;
  const desc = document.getElementById('cob-descricao').value;
  if (!id || !confirm(`Excluir cobrança "${desc}"?`)) return;
  const { error } = await db.from('cobrancas').delete().eq('id', id);
  if (error) { mostrarToast('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-cobranca'));
  await carregarCobrancas(); renderizarCobrancas(); await renderizarDashboard();
}

function enviarWhatsAppCobranca() {
  const id  = document.getElementById('cob-id').value;
  const cob = cobrancas.find(c => c.id === id);
  if (!cob) return;
  const tel  = telCliente(cob.cliente_id);
  const nome = nomeCliente(cob.cliente_id);
  const venc = dataLocal(cob.data_vencimento);
  const dias = diasAte(cob.data_vencimento);
  const valorFmt = cob.moeda && cob.moeda !== 'PYG' && cob.valor_original
    ? moedaOriginal(cob.valor_original, cob.moeda)
    : moenaPYG(cob.valor);
  if (!tel) { mostrarToast('Telefone não cadastrado.', 'info'); return; }

  let msg;
  if (dias !== null && dias < 0) {
    msg = `Olá! A cobrança *${cob.descricao}* de *${valorFmt}* para ${nome} está *em atraso* desde ${venc}.\n\nPor favor, regularize para evitar suspensão do serviço. 😊`;
  } else {
    msg = `Olá! Lembrete: a cobrança *${cob.descricao}* de *${valorFmt}* para ${nome} vence em *${venc}*${dias === 0 ? ' (HOJE)' : dias === 1 ? ' (amanhã)' : ` (${dias} dias)`}.\n\nQualquer dúvida, estamos à disposição! 😊`;
  }
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}

/* ─────────────────────────────────────────
   DESPESAS — TABELA + MODAL
───────────────────────────────────────── */
const CATEGORIAS = {
  infra: '🖥 Infra', software: '💻 Software', marketing: '📣 Marketing',
  pessoal: '👥 Pessoal', impostos: '🧾 Impostos', outros: '📦 Outros',
};

function filtrarDespesas() {
  const busca = document.getElementById('busca-despesas')?.value.toLowerCase() ?? '';
  const cat   = document.getElementById('filtro-cat-desp')?.value ?? '';
  return despesas.filter(d => {
    if (busca && !(d.descricao ?? '').toLowerCase().includes(busca)) return false;
    if (cat   && d.categoria !== cat) return false;
    return true;
  });
}

function renderizarDespesas() {
  const dados = filtrarDespesas();
  const elTab = document.getElementById('tabela-despesas');

  if (dados.length === 0) {
    elTab.innerHTML = '<div class="tabela-vazia"><div class="icone">📤</div><p>Nenhuma despesa encontrada.</p></div>';
    return;
  }

  const tbody = dados.map(d => {
    const moedaFmt = d.moeda && d.moeda !== 'PYG' && d.valor_original
      ? `<span class="moeda-badge moeda-${d.moeda.toLowerCase()}">${d.moeda}</span> ${moedaOriginal(d.valor_original, d.moeda)}`
      : moenaPYG(d.valor);

    return `<tr data-id="${d.id}" class="linha-despesa">
      <td>${esc(d.descricao)}</td>
      <td><span class="tipo-badge">${esc(CATEGORIAS[d.categoria] ?? d.categoria)}</span></td>
      <td class="col-valor col-vermelho">${moedaFmt}</td>
      <td>${dataLocal(d.data)}</td>
      <td style="color:var(--text-hint);font-size:.78rem">${esc(d.observacoes ?? '—')}</td>
    </tr>`;
  }).join('');

  elTab.innerHTML = `
    <table class="fin-table">
      <thead><tr><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Data</th><th>Obs.</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

  elTab.querySelectorAll('.linha-despesa').forEach(tr => {
    tr.addEventListener('click', () => {
      const d = despesas.find(x => x.id === tr.dataset.id);
      if (d) abrirModalDesp(d);
    });
  });
}

function abrirModalDesp(d = null) {
  const modal = document.getElementById('modal-despesa');
  document.getElementById('modal-desp-titulo').textContent = d ? 'Editar Despesa' : 'Nova Despesa';
  document.getElementById('desp-id').value          = d?.id ?? '';
  document.getElementById('desp-descricao').value   = d?.descricao ?? '';
  document.getElementById('desp-data').value        = d?.data ?? new Date().toISOString().split('T')[0];
  document.getElementById('desp-categoria').value   = d?.categoria ?? 'outros';
  document.getElementById('desp-obs').value         = d?.observacoes ?? '';

  const moeda = d?.moeda ?? 'PYG';
  document.getElementById('desp-moeda').value = moeda;
  document.getElementById('desp-valor').value = moeda !== 'PYG' && d?.valor_original
    ? d.valor_original : (d?.valor ?? '');
  document.getElementById('desp-equiv').classList.add('hidden');

  document.getElementById('btn-desp-excluir').classList.toggle('hidden', !d);
  abrirModal(modal);
}

async function salvarDespesa() {
  const id        = document.getElementById('desp-id').value;
  const descricao = document.getElementById('desp-descricao').value.trim();
  const valorRaw  = parseFloat(document.getElementById('desp-valor').value);
  const moeda     = document.getElementById('desp-moeda').value;
  const data      = document.getElementById('desp-data').value;

  if (!descricao || !data || isNaN(valorRaw)) {
    mostrarToast('Preencha descrição, valor e data.', 'error'); return;
  }

  const valorPYG = await Cambio.toPYG(valorRaw, moeda);

  const payload = {
    descricao,
    valor:           valorPYG,
    moeda,
    valor_original:  valorRaw,
    data,
    categoria:       document.getElementById('desp-categoria').value,
    observacoes:     document.getElementById('desp-obs').value.trim() || null,
  };

  const btn = document.getElementById('btn-desp-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const { error } = id
    ? await db.from('despesas').update(payload).eq('id', id)
    : await db.from('despesas').insert(payload);

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) { mostrarToast('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-despesa'));
  mostrarToast('Despesa salva!', 'success');
  await carregarDespesas(); renderizarDespesas(); await renderizarDashboard();
}

async function excluirDespesa() {
  const id   = document.getElementById('desp-id').value;
  const desc = document.getElementById('desp-descricao').value;
  if (!id || !confirm(`Excluir despesa "${desc}"?`)) return;
  const { error } = await db.from('despesas').delete().eq('id', id);
  if (error) { mostrarToast('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-despesa'));
  await carregarDespesas(); renderizarDespesas(); await renderizarDashboard();
}

/* ─────────────────────────────────────────
   PROPOSTAS — TABELA + MODAL
───────────────────────────────────────── */
function filtrarPropostas() {
  const busca     = document.getElementById('busca-propostas')?.value.toLowerCase() ?? '';
  const status    = document.getElementById('filtro-status-prop')?.value ?? '';
  const clienteId = document.getElementById('filtro-cliente-prop')?.value ?? '';

  return propostas.filter(p => {
    const titulo = (p.titulo ?? '').toLowerCase();
    if (busca     && !titulo.includes(busca)) return false;
    if (status    && p.status     !== status)    return false;
    if (clienteId && p.cliente_id !== clienteId) return false;
    return true;
  });
}

function renderizarPropostas() {
  const dados = filtrarPropostas();
  const elTab = document.getElementById('tabela-propostas');

  if (dados.length === 0) {
    elTab.innerHTML = '<div class="tabela-vazia"><div class="icone">📝</div><p>Nenhuma proposta encontrada.</p></div>';
    return;
  }

  const tbody = dados.map(p => {
    const moedaFmt = p.moeda && p.moeda !== 'PYG' && p.valor_original
      ? `<span class="moeda-badge moeda-${p.moeda.toLowerCase()}">${p.moeda}</span> ${moedaOriginal(p.valor_original, p.moeda)}`
      : moenaPYG(p.valor);

    return `<tr data-id="${p.id}" class="linha-proposta">
      <td>${esc(nomeCliente(p.cliente_id))}</td>
      <td>${esc(p.titulo)}</td>
      <td class="col-valor">${moedaFmt}</td>
      <td>${dataLocal(p.validade)}</td>
      <td><span class="status-badge status-${p.status}">${labelStatus(p.status)}</span></td>
    </tr>`;
  }).join('');

  elTab.innerHTML = `
    <table class="fin-table">
      <thead><tr><th>Cliente</th><th>Título</th><th>Valor</th><th>Validade</th><th>Status</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

  elTab.querySelectorAll('.linha-proposta').forEach(tr => {
    tr.addEventListener('click', () => {
      const p = propostas.find(x => x.id === tr.dataset.id);
      if (p) abrirModalProp(p);
    });
  });
}

function abrirModalProp(p = null) {
  const modal = document.getElementById('modal-proposta');
  document.getElementById('modal-prop-titulo').textContent = p ? 'Editar Proposta' : 'Nova Proposta';
  document.getElementById('prop-id').value            = p?.id ?? '';
  document.getElementById('prop-titulo-campo').value  = p?.titulo ?? '';
  document.getElementById('prop-descricao').value     = p?.descricao ?? '';
  document.getElementById('prop-validade').value      = p?.validade ?? '';
  document.getElementById('prop-status').value        = p?.status ?? 'rascunho';

  // Dropdown de cliente pesquisável
  setClienteSearch('prop-cliente-search', 'prop-cliente', p?.cliente_id ?? null);

  const moeda = p?.moeda ?? 'PYG';
  document.getElementById('prop-moeda').value = moeda;
  document.getElementById('prop-valor').value = moeda !== 'PYG' && p?.valor_original
    ? p.valor_original : (p?.valor ?? '');
  document.getElementById('prop-equiv').classList.add('hidden');

  document.getElementById('btn-prop-excluir').classList.toggle('hidden', !p);
  document.getElementById('btn-prop-converter').classList.toggle('hidden', !p || p.status !== 'aprovada');
  abrirModal(modal);
}

async function salvarProposta() {
  const id     = document.getElementById('prop-id').value;
  const titulo = document.getElementById('prop-titulo-campo').value.trim();
  const valorRaw = parseFloat(document.getElementById('prop-valor').value);
  const moeda  = document.getElementById('prop-moeda').value;

  if (!titulo || isNaN(valorRaw)) { mostrarToast('Preencha título e valor.', 'error'); return; }

  const valorPYG = await Cambio.toPYG(valorRaw, moeda);

  const payload = {
    cliente_id:     document.getElementById('prop-cliente').value || null,
    titulo,
    descricao:      document.getElementById('prop-descricao').value.trim() || null,
    valor:          valorPYG,
    moeda,
    valor_original: valorRaw,
    status:         document.getElementById('prop-status').value,
    validade:       document.getElementById('prop-validade').value || null,
  };

  const btn = document.getElementById('btn-prop-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const { data: saved, error } = id
    ? await db.from('propostas').update(payload).eq('id', id).select().single()
    : await db.from('propostas').insert(payload).select().single();

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) { mostrarToast('Erro: ' + error.message); return; }

  if (saved?.status === 'aprovada') {
    document.getElementById('btn-prop-converter').classList.remove('hidden');
  }

  fecharModal(document.getElementById('modal-proposta'));
  mostrarToast('Proposta salva!', 'success');
  await carregarPropostas(); renderizarPropostas();
}

async function excluirProposta() {
  const id    = document.getElementById('prop-id').value;
  const titulo = document.getElementById('prop-titulo-campo').value;
  if (!id || !confirm(`Excluir proposta "${titulo}"?`)) return;
  const { error } = await db.from('propostas').delete().eq('id', id);
  if (error) { mostrarToast('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-proposta'));
  await carregarPropostas(); renderizarPropostas();
}

async function converterPropostaEmCobranca() {
  const id       = document.getElementById('prop-id').value;
  const proposta = propostas.find(p => p.id === id);
  if (!proposta) return;

  const hoje = new Date();
  const venc = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

  const payload = {
    cliente_id:      proposta.cliente_id,
    descricao:       proposta.titulo,
    valor:           proposta.valor,
    moeda:           proposta.moeda,
    valor_original:  proposta.valor_original,
    tipo:            'avulso',
    status:          'pendente',
    data_vencimento: venc.toISOString().split('T')[0],
    observacoes:     `Gerado automaticamente da proposta: ${proposta.titulo}`,
  };

  const { error } = await db.from('cobrancas').insert(payload);
  if (error) { mostrarToast('Erro ao criar cobrança: ' + error.message); return; }

  fecharModal(document.getElementById('modal-proposta'));
  mostrarToast(`Cobrança de ${moenaPYG(proposta.valor)} criada com sucesso!`, 'success');
  await carregarCobrancas(); renderizarCobrancas(); await renderizarDashboard();
  ativarAba('cobrancas');
}

/* ─────────────────────────────────────────
   EXPORTAR (Excel)
───────────────────────────────────────── */
function exportarExcel() {
  const wb = XLSX.utils.book_new();

  const cobDados = cobrancas.map(c => ({
    'Cliente':          nomeCliente(c.cliente_id),
    'Descrição':        c.descricao,
    'Tipo':             tipoLabel(c.tipo),
    'Moeda Original':   c.moeda ?? 'PYG',
    'Valor Original':   Number(c.valor_original ?? c.valor),
    'Valor PYG (₲)':   Number(c.valor),
    'Vencimento':       dataLocal(c.data_vencimento),
    'Pagamento':        dataLocal(c.data_pagamento),
    'Status':           c.status,
    'Observações':      c.observacoes ?? '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cobDados), 'Cobranças');

  const despDados = despesas.map(d => ({
    'Descrição':        d.descricao,
    'Categoria':        d.categoria,
    'Moeda Original':   d.moeda ?? 'PYG',
    'Valor Original':   Number(d.valor_original ?? d.valor),
    'Valor PYG (₲)':   Number(d.valor),
    'Data':             dataLocal(d.data),
    'Observações':      d.observacoes ?? '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(despDados), 'Despesas');

  const propDados = propostas.map(p => ({
    'Cliente':          nomeCliente(p.cliente_id),
    'Título':           p.titulo,
    'Moeda Original':   p.moeda ?? 'PYG',
    'Valor Original':   Number(p.valor_original ?? p.valor),
    'Valor PYG (₲)':   Number(p.valor),
    'Validade':         dataLocal(p.validade),
    'Status':           p.status,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(propDados), 'Propostas');

  const mes = new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }).replace('/', '-');
  XLSX.writeFile(wb, `linkpy-financeiro-${mes}.xlsx`);
}

/* ─────────────────────────────────────────
   MODAL — HELPERS
───────────────────────────────────────── */
function abrirModal(modalEl) {
  modalEl.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function fecharModal(modalEl) {
  modalEl.classList.remove('open');
  document.body.style.overflow = '';
}

/* ─────────────────────────────────────────
   ABAS
───────────────────────────────────────── */
function ativarAba(nome) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const ativo = b.dataset.tab === nome;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-selected', ativo);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('hidden', p.id !== `tab-${nome}`);
  });
  if (nome === 'cobrancas') renderizarCobrancas();
  if (nome === 'despesas')  renderizarDespesas();
  if (nome === 'propostas') renderizarPropostas();
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const STATUS_LABELS = {
  pendente: 'Pendente', pago: 'Pago', vencido: 'Vencido', cancelado: 'Cancelado',
  rascunho: 'Rascunho', enviada: 'Enviada', aprovada: 'Aprovada', recusada: 'Recusada',
};
const labelStatus = (s) => STATUS_LABELS[s] ?? s;

/* ─────────────────────────────────────────
   INICIALIZAÇÃO
───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {

  await initAuth(db, iniciarApp);
  initLogout(db);

  // Abas
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => ativarAba(btn.dataset.tab))
  );

  // Botões modais
  document.getElementById('btn-nova-cobranca').addEventListener('click', () => abrirModalCob());
  document.getElementById('btn-nova-despesa').addEventListener('click',  () => abrirModalDesp());
  document.getElementById('btn-nova-proposta').addEventListener('click', () => abrirModalProp());
  document.getElementById('btn-exportar').addEventListener('click', exportarExcel);

  // Cobranças
  document.getElementById('btn-cob-salvar').addEventListener('click',   salvarCobranca);
  document.getElementById('btn-cob-excluir').addEventListener('click',  excluirCobranca);
  document.getElementById('btn-cob-whatsapp').addEventListener('click', enviarWhatsAppCobranca);

  // Despesas
  document.getElementById('btn-desp-salvar').addEventListener('click',  salvarDespesa);
  document.getElementById('btn-desp-excluir').addEventListener('click', excluirDespesa);

  // Propostas
  document.getElementById('btn-prop-salvar').addEventListener('click',    salvarProposta);
  document.getElementById('btn-prop-excluir').addEventListener('click',   excluirProposta);
  document.getElementById('btn-prop-converter').addEventListener('click', converterPropostaEmCobranca);

  // Fechar modais
  document.querySelectorAll('.modal-fechar').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.modal;
      if (id) fecharModal(document.getElementById(id));
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) fecharModal(overlay); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => fecharModal(m));
    }
  });

  // Filtros das toolbars
  ['busca-cobrancas', 'filtro-status-cob', 'filtro-tipo-cob', 'filtro-cliente-cob'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderizarCobrancas);
    document.getElementById(id)?.addEventListener('change', renderizarCobrancas);
  });
  ['busca-despesas', 'filtro-cat-desp'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderizarDespesas);
  });
  ['busca-propostas', 'filtro-status-prop', 'filtro-cliente-prop'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderizarPropostas);
    document.getElementById(id)?.addEventListener('change', renderizarPropostas);
  });

  // Auto-preenche data de pagamento ao marcar como pago
  document.getElementById('cob-status').addEventListener('change', (e) => {
    if (e.target.value === 'pago' && !document.getElementById('cob-data-pagamento').value) {
      document.getElementById('cob-data-pagamento').value = new Date().toISOString().split('T')[0];
    }
  });

  // Toggle converter proposta
  document.getElementById('prop-status').addEventListener('change', (e) => {
    const id = document.getElementById('prop-id').value;
    document.getElementById('btn-prop-converter')
      .classList.toggle('hidden', !id || e.target.value !== 'aprovada');
  });

  // ── Toggle de moeda dos KPIs ──
  document.querySelectorAll('.kpi-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.kpi-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      kpiMoeda = btn.dataset.currency;
      await renderizarDashboard();
    });
  });
});
