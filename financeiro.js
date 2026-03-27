/**
 * LinkPY Financeiro — financeiro.js v1.0.0
 *
 * Módulo completo: dashboard, cobranças, despesas, propostas.
 * Reutiliza o mesmo padrão de auth e Supabase do admin.js.
 */

/* ─────────────────────────────────────────
   CONFIG
───────────────────────────────────────── */
const ADMIN_SUPABASE_URL = 'https://cwauzlddxfalcjcryegb.supabase.co';
const ADMIN_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YXV6bGRkeGZhbGNqY3J5ZWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzUzMzYsImV4cCI6MjA4ODMxMTMzNn0.2X5A-GqrE9iDtq36G8xbcRE3Ve4KuJFmdQildPr1UeE';

const db = window.supabase.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_KEY);

/* ─────────────────────────────────────────
   ESTADO
───────────────────────────────────────── */
let clientes   = [];   // cache de todos os clientes
let cobrancas  = [];
let despesas   = [];
let propostas  = [];
let chartReceita = null;

/* ─────────────────────────────────────────
   FORMATADORES
───────────────────────────────────────── */
const moeda = (v) => {
  if (v == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
};

const dataLocal = (iso) => {
  if (!iso) return '—';
  // Evita shift de timezone (date-only ISO → tratar como local)
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

/* ─────────────────────────────────────────
   AUTH
───────────────────────────────────────── */
let loginTentativas = 0;
let loginBloqueado  = false;

async function handleLogin(e) {
  e.preventDefault();
  if (loginBloqueado) return;

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('btn-submit-login');
  const errEl    = document.getElementById('login-error');
  const errMsg   = document.getElementById('login-error-msg');

  if (!email || !password) {
    errMsg.textContent = 'Preencha email e senha.';
    errEl.classList.add('show'); return;
  }

  btn.disabled = true; btn.textContent = 'Entrando...';

  const { error } = await db.auth.signInWithPassword({ email, password });

  btn.disabled = false; btn.textContent = 'Entrar';

  if (error) {
    loginTentativas++;
    const r = 5 - loginTentativas;
    errMsg.textContent = r > 0 ? `Credenciais inválidas. Tentativas: ${r}` : 'Conta bloqueada.';
    errEl.classList.add('show');
    if (loginTentativas >= 5) {
      loginBloqueado = true;
      btn.disabled = true;
      let s = 30;
      const iv = setInterval(() => {
        s--;
        errMsg.textContent = `Muitas tentativas. Aguarde ${s}s.`;
        if (s <= 0) {
          clearInterval(iv);
          loginBloqueado = false; loginTentativas = 0;
          btn.disabled = false; errEl.classList.remove('show');
        }
      }, 1000);
    }
  } else {
    loginTentativas = 0;
    errEl.classList.remove('show');
    iniciarApp();
  }
}

async function iniciarApp() {
  document.getElementById('login-container').classList.add('hidden');
  document.getElementById('fin-wrapper').classList.remove('hidden');
  await carregarClientes();
  await Promise.all([carregarCobrancas(), carregarDespesas(), carregarPropostas()]);
  renderizarDashboard();
  popularSelects();
}

/* ─────────────────────────────────────────
   CARREGAMENTO DE DADOS
───────────────────────────────────────── */
async function carregarClientes() {
  const { data } = await db.from('clientes').select('id, nome_empresa, telefone_responsavel').order('nome_empresa');
  clientes = data ?? [];
}

async function carregarCobrancas() {
  const { data, error } = await db
    .from('cobrancas')
    .select('*')
    .order('data_vencimento', { ascending: true });
  if (!error) cobrancas = data ?? [];
}

async function carregarDespesas() {
  const { data, error } = await db
    .from('despesas')
    .select('*')
    .order('data', { ascending: false });
  if (!error) despesas = data ?? [];
}

async function carregarPropostas() {
  const { data, error } = await db
    .from('propostas')
    .select('*')
    .order('created_at', { ascending: false });
  if (!error) propostas = data ?? [];
}

/* ─────────────────────────────────────────
   DASHBOARD
───────────────────────────────────────── */
function renderizarDashboard() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const mesInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const mesFim    = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

  // KPIs de cobranças
  const pendentes = cobrancas.filter(c => c.status === 'pendente' && new Date(c.data_vencimento) >= hoje);
  const atrasadas = cobrancas.filter(c =>
    (c.status === 'pendente' || c.status === 'vencido') && new Date(c.data_vencimento + 'T00:00:00') < hoje
  );
  const pagosMes  = cobrancas.filter(c => {
    if (c.status !== 'pago' || !c.data_pagamento) return false;
    const dp = new Date(c.data_pagamento + 'T00:00:00');
    return dp >= mesInicio && dp <= mesFim;
  });

  // KPI despesas do mês
  const despMes = despesas.filter(d => {
    const dd = new Date(d.data + 'T00:00:00');
    return dd >= mesInicio && dd <= mesFim;
  });

  const soma = (arr) => arr.reduce((s, c) => s + Number(c.valor ?? 0), 0);

  // Atualizar KPI cards
  const set = (id, val, sub) => {
    document.getElementById(id).textContent = val;
    const subEl = document.getElementById(id + '-qtd');
    if (subEl) subEl.textContent = sub;
  };

  set('kpi-a-receber', moeda(soma(pendentes)), `${pendentes.length} cobrança(s)`);
  set('kpi-recebido',  moeda(soma(pagosMes)),  `${pagosMes.length} pago(s) este mês`);
  set('kpi-atrasado',  moeda(soma(atrasadas)), `${atrasadas.length} em atraso`);
  set('kpi-despesas',  moeda(soma(despMes)),   `${despMes.length} lançamento(s)`);

  // Próximos vencimentos (pendentes, ordem crescente, max 10)
  const proximos = [...cobrancas]
    .filter(c => c.status === 'pendente')
    .sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento))
    .slice(0, 10);

  const listaEl = document.getElementById('lista-proximos');
  listaEl.innerHTML = '';
  if (proximos.length === 0) {
    listaEl.innerHTML = '<p style="padding:1rem 1.25rem;color:var(--text-hint);font-size:.8rem">Nenhum vencimento pendente.</p>';
  } else {
    proximos.forEach(c => {
      const dias = diasAte(c.data_vencimento);
      const vencido = dias !== null && dias < 0;
      const div = document.createElement('div');
      div.className = 'recente-item';
      div.innerHTML = `
        <div class="recente-dot ${vencido ? 'dot-vencido' : 'dot-pendente'}"></div>
        <div class="recente-body">
          <div class="recente-nome">${esc(nomeCliente(c.cliente_id))} — ${esc(c.descricao)}</div>
          <div class="recente-data">${vencido ? '⚠ ' : ''}${dataLocal(c.data_vencimento)}${dias !== null ? ` (${vencido ? Math.abs(dias) + 'd atraso' : dias === 0 ? 'hoje' : dias + 'd'})` : ''}</div>
        </div>
        <div class="recente-valor">${moeda(c.valor)}</div>
      `;
      div.addEventListener('click', () => abrirModalCob(c));
      listaEl.appendChild(div);
    });
  }

  renderizarGrafico();
}

function renderizarGrafico() {
  // Agrupa cobranças pagas por mês (últimos 6 meses)
  const meses = [];
  const hoje = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    meses.push({
      label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
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

  const ctx = document.getElementById('chart-receita').getContext('2d');
  if (chartReceita) chartReceita.destroy();

  chartReceita = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: meses.map(m => m.label),
      datasets: [
        {
          label: 'Recebido',
          data: recebido,
          backgroundColor: 'rgba(22, 163, 74, .75)',
          borderRadius: 5,
          borderSkipped: false,
        },
        {
          label: 'Despesas',
          data: despMes,
          backgroundColor: 'rgba(220, 38, 38, .55)',
          borderRadius: 5,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Inter', size: 12 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${moeda(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } },
        y: {
          beginAtZero: true,
          ticks: {
            font: { family: 'Inter', size: 11 },
            callback: (v) => 'R$ ' + Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v),
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
  const busca  = document.getElementById('busca-cobrancas').value.toLowerCase();
  const status = document.getElementById('filtro-status-cob').value;
  const tipo   = document.getElementById('filtro-tipo-cob').value;

  return cobrancas.filter(c => {
    const nome = nomeCliente(c.cliente_id).toLowerCase();
    const desc = (c.descricao ?? '').toLowerCase();
    if (busca  && !nome.includes(busca) && !desc.includes(busca)) return false;
    if (status && c.status !== status) return false;
    if (tipo   && c.tipo   !== tipo)   return false;
    return true;
  });
}

function renderizarCobrancas() {
  const dados = filtrarCobrancas();
  const el = document.getElementById('tabela-cobrancas');

  if (dados.length === 0) {
    el.innerHTML = '<div class="tabela-vazia"><div class="icone">📋</div><p>Nenhuma cobrança encontrada.</p></div>';
    return;
  }

  const tbody = dados.map(c => {
    const dias = diasAte(c.data_vencimento);
    let classeData = '';
    if (c.status === 'pendente' && dias !== null) {
      if (dias < 0)     classeData = 'data-vencida';
      else if (dias <= 5) classeData = 'data-proxima';
    }
    return `<tr data-id="${c.id}" class="linha-cobranca">
      <td>${esc(nomeCliente(c.cliente_id))}</td>
      <td>${esc(c.descricao)}</td>
      <td><span class="tipo-badge">${c.tipo}</span></td>
      <td class="col-valor ${c.status === 'pago' ? 'col-verde' : c.status === 'vencido' ? 'col-vermelho' : ''}">${moeda(c.valor)}</td>
      <td class="${classeData}">${dataLocal(c.data_vencimento)}</td>
      <td><span class="status-badge status-${c.status}">${labelStatus(c.status)}</span></td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="fin-table" role="grid">
      <thead><tr>
        <th>Cliente</th><th>Descrição</th><th>Tipo</th>
        <th>Valor</th><th>Vencimento</th><th>Status</th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

  el.querySelectorAll('.linha-cobranca').forEach(tr => {
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
  document.getElementById('cob-id').value          = c?.id ?? '';
  document.getElementById('cob-descricao').value   = c?.descricao ?? '';
  document.getElementById('cob-valor').value       = c?.valor ?? '';
  document.getElementById('cob-vencimento').value  = c?.data_vencimento ?? '';
  document.getElementById('cob-tipo').value        = c?.tipo ?? 'mensalidade';
  document.getElementById('cob-status').value      = c?.status ?? 'pendente';
  document.getElementById('cob-data-pagamento').value = c?.data_pagamento ?? '';
  document.getElementById('cob-obs').value         = c?.observacoes ?? '';
  document.getElementById('cob-cliente').value     = c?.cliente_id ?? '';

  document.getElementById('btn-cob-excluir').classList.toggle('hidden', !c);
  document.getElementById('btn-cob-whatsapp').classList.toggle('hidden', !c || !telCliente(c.cliente_id));
  abrirModal(modal);
}

async function salvarCobranca() {
  const id          = document.getElementById('cob-id').value;
  const descricao   = document.getElementById('cob-descricao').value.trim();
  const valor       = parseFloat(document.getElementById('cob-valor').value);
  const vencimento  = document.getElementById('cob-vencimento').value;
  const clienteId   = document.getElementById('cob-cliente').value || null;

  if (!descricao || !vencimento || isNaN(valor)) {
    alert('Preencha descrição, valor e vencimento.'); return;
  }

  const payload = {
    cliente_id:       clienteId,
    descricao,
    valor,
    tipo:             document.getElementById('cob-tipo').value,
    status:           document.getElementById('cob-status').value,
    data_vencimento:  vencimento,
    data_pagamento:   document.getElementById('cob-data-pagamento').value || null,
    observacoes:      document.getElementById('cob-obs').value.trim() || null,
  };

  const btn = document.getElementById('btn-cob-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const { error } = id
    ? await db.from('cobrancas').update(payload).eq('id', id)
    : await db.from('cobrancas').insert(payload);

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) { alert('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-cobranca'));
  await carregarCobrancas();
  renderizarCobrancas();
  renderizarDashboard();
}

async function excluirCobranca() {
  const id   = document.getElementById('cob-id').value;
  const desc = document.getElementById('cob-descricao').value;
  if (!id || !confirm(`Excluir cobrança "${desc}"?`)) return;
  const { error } = await db.from('cobrancas').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-cobranca'));
  await carregarCobrancas();
  renderizarCobrancas();
  renderizarDashboard();
}

function enviarWhatsAppCobranca() {
  const id       = document.getElementById('cob-id').value;
  const cob      = cobrancas.find(c => c.id === id);
  if (!cob) return;
  const tel    = telCliente(cob.cliente_id);
  const nome   = nomeCliente(cob.cliente_id);
  const venc   = dataLocal(cob.data_vencimento);
  const dias   = diasAte(cob.data_vencimento);
  if (!tel) { alert('Telefone não cadastrado para este cliente.'); return; }

  let msg;
  if (dias !== null && dias < 0) {
    msg = `Olá! Passamos para avisar que a cobrança *${cob.descricao}* de *${moeda(cob.valor)}* para ${nome} está *em atraso* desde ${venc}.\n\nPor favor, regularize para evitar suspensão do serviço. Qualquer dúvida, estamos à disposição! 😊`;
  } else {
    msg = `Olá! Lembrete: a cobrança *${cob.descricao}* de *${moeda(cob.valor)}* para ${nome} vence em *${venc}*${dias === 0 ? ' (HOJE)' : dias === 1 ? ' (amanhã)' : ` (${dias} dias)`}.\n\nQualquer dúvida, estamos à disposição! 😊`;
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
  const busca = document.getElementById('busca-despesas').value.toLowerCase();
  const cat   = document.getElementById('filtro-cat-desp').value;
  return despesas.filter(d => {
    if (busca && !(d.descricao ?? '').toLowerCase().includes(busca)) return false;
    if (cat   && d.categoria !== cat) return false;
    return true;
  });
}

function renderizarDespesas() {
  const dados = filtrarDespesas();
  const el = document.getElementById('tabela-despesas');
  if (dados.length === 0) {
    el.innerHTML = '<div class="tabela-vazia"><div class="icone">📤</div><p>Nenhuma despesa encontrada.</p></div>';
    return;
  }
  const tbody = dados.map(d => `
    <tr data-id="${d.id}" class="linha-despesa">
      <td>${esc(d.descricao)}</td>
      <td><span class="tipo-badge">${CATEGORIAS[d.categoria] ?? d.categoria}</span></td>
      <td class="col-valor col-vermelho">${moeda(d.valor)}</td>
      <td>${dataLocal(d.data)}</td>
      <td style="color:var(--text-hint);font-size:.78rem">${esc(d.observacoes ?? '—')}</td>
    </tr>`).join('');

  el.innerHTML = `
    <table class="fin-table">
      <thead><tr><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Data</th><th>Obs.</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

  el.querySelectorAll('.linha-despesa').forEach(tr => {
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
  document.getElementById('desp-valor').value       = d?.valor ?? '';
  document.getElementById('desp-data').value        = d?.data ?? new Date().toISOString().split('T')[0];
  document.getElementById('desp-categoria').value   = d?.categoria ?? 'outros';
  document.getElementById('desp-obs').value         = d?.observacoes ?? '';
  document.getElementById('btn-desp-excluir').classList.toggle('hidden', !d);
  abrirModal(modal);
}

async function salvarDespesa() {
  const id        = document.getElementById('desp-id').value;
  const descricao = document.getElementById('desp-descricao').value.trim();
  const valor     = parseFloat(document.getElementById('desp-valor').value);
  const data      = document.getElementById('desp-data').value;

  if (!descricao || !data || isNaN(valor)) {
    alert('Preencha descrição, valor e data.'); return;
  }

  const payload = {
    descricao, valor, data,
    categoria:   document.getElementById('desp-categoria').value,
    observacoes: document.getElementById('desp-obs').value.trim() || null,
  };

  const btn = document.getElementById('btn-desp-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const { error } = id
    ? await db.from('despesas').update(payload).eq('id', id)
    : await db.from('despesas').insert(payload);

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) { alert('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-despesa'));
  await carregarDespesas();
  renderizarDespesas();
  renderizarDashboard();
}

async function excluirDespesa() {
  const id   = document.getElementById('desp-id').value;
  const desc = document.getElementById('desp-descricao').value;
  if (!id || !confirm(`Excluir despesa "${desc}"?`)) return;
  const { error } = await db.from('despesas').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-despesa'));
  await carregarDespesas(); renderizarDespesas(); renderizarDashboard();
}

/* ─────────────────────────────────────────
   PROPOSTAS — TABELA + MODAL
───────────────────────────────────────── */
function filtrarPropostas() {
  const busca   = document.getElementById('busca-propostas').value.toLowerCase();
  const status  = document.getElementById('filtro-status-prop').value;
  return propostas.filter(p => {
    const nome  = nomeCliente(p.cliente_id).toLowerCase();
    const titulo = (p.titulo ?? '').toLowerCase();
    if (busca  && !nome.includes(busca) && !titulo.includes(busca)) return false;
    if (status && p.status !== status) return false;
    return true;
  });
}

function renderizarPropostas() {
  const dados = filtrarPropostas();
  const el = document.getElementById('tabela-propostas');
  if (dados.length === 0) {
    el.innerHTML = '<div class="tabela-vazia"><div class="icone">📝</div><p>Nenhuma proposta encontrada.</p></div>';
    return;
  }
  const tbody = dados.map(p => `
    <tr data-id="${p.id}" class="linha-proposta">
      <td>${esc(nomeCliente(p.cliente_id))}</td>
      <td>${esc(p.titulo)}</td>
      <td class="col-valor">${moeda(p.valor)}</td>
      <td>${dataLocal(p.validade)}</td>
      <td><span class="status-badge status-${p.status}">${labelStatus(p.status)}</span></td>
    </tr>`).join('');

  el.innerHTML = `
    <table class="fin-table">
      <thead><tr><th>Cliente</th><th>Título</th><th>Valor</th><th>Validade</th><th>Status</th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;

  el.querySelectorAll('.linha-proposta').forEach(tr => {
    tr.addEventListener('click', () => {
      const p = propostas.find(x => x.id === tr.dataset.id);
      if (p) abrirModalProp(p);
    });
  });
}

function abrirModalProp(p = null) {
  const modal = document.getElementById('modal-proposta');
  document.getElementById('modal-prop-titulo').textContent = p ? 'Editar Proposta' : 'Nova Proposta';
  document.getElementById('prop-id').value           = p?.id ?? '';
  document.getElementById('prop-titulo-campo').value = p?.titulo ?? '';
  document.getElementById('prop-descricao').value    = p?.descricao ?? '';
  document.getElementById('prop-valor').value        = p?.valor ?? '';
  document.getElementById('prop-validade').value     = p?.validade ?? '';
  document.getElementById('prop-status').value       = p?.status ?? 'rascunho';
  document.getElementById('prop-cliente').value      = p?.cliente_id ?? '';
  document.getElementById('btn-prop-excluir').classList.toggle('hidden', !p);
  // Botão "Gerar Cobrança" só aparece para propostas aprovadas já salvas
  document.getElementById('btn-prop-converter').classList.toggle('hidden', !p || p.status !== 'aprovada');
  abrirModal(modal);
}

async function salvarProposta() {
  const id     = document.getElementById('prop-id').value;
  const titulo = document.getElementById('prop-titulo-campo').value.trim();
  const valor  = parseFloat(document.getElementById('prop-valor').value);
  if (!titulo || isNaN(valor)) { alert('Preencha título e valor.'); return; }

  const payload = {
    cliente_id:  document.getElementById('prop-cliente').value || null,
    titulo,
    descricao:   document.getElementById('prop-descricao').value.trim() || null,
    valor,
    status:      document.getElementById('prop-status').value,
    validade:    document.getElementById('prop-validade').value || null,
  };

  const btn = document.getElementById('btn-prop-salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';

  const { data: saved, error } = id
    ? await (await db.from('propostas').update(payload).eq('id', id).select()).valueOf()
    : await (await db.from('propostas').insert(payload).select()).valueOf();

  btn.disabled = false; btn.textContent = 'Salvar';

  if (error) { alert('Erro: ' + error.message); return; }

  // Mostrar botão converter se status mudou para aprovada
  if (saved?.[0]?.status === 'aprovada') {
    document.getElementById('btn-prop-converter').classList.remove('hidden');
  }

  fecharModal(document.getElementById('modal-proposta'));
  await carregarPropostas(); renderizarPropostas();
}

async function excluirProposta() {
  const id    = document.getElementById('prop-id').value;
  const titulo = document.getElementById('prop-titulo-campo').value;
  if (!id || !confirm(`Excluir proposta "${titulo}"?`)) return;
  const { error } = await db.from('propostas').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  fecharModal(document.getElementById('modal-proposta'));
  await carregarPropostas(); renderizarPropostas();
}

/** Converte proposta aprovada em cobrança automaticamente */
async function converterPropostaEmCobranca() {
  const id       = document.getElementById('prop-id').value;
  const proposta = propostas.find(p => p.id === id);
  if (!proposta) return;

  const clienteId = document.getElementById('prop-cliente').value || null;
  const valor     = parseFloat(document.getElementById('prop-valor').value);
  const titulo    = document.getElementById('prop-titulo-campo').value.trim();

  const hoje = new Date();
  const venc = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0); // fim do mês atual

  const payload = {
    cliente_id:      clienteId,
    descricao:       titulo,
    valor,
    tipo:            'avulso',
    status:          'pendente',
    data_vencimento: venc.toISOString().split('T')[0],
    observacoes:     `Gerado automaticamente a partir da proposta: ${titulo}`,
  };

  const { error } = await db.from('cobrancas').insert(payload);
  if (error) { alert('Erro ao criar cobrança: ' + error.message); return; }

  fecharModal(document.getElementById('modal-proposta'));
  await carregarCobrancas();
  renderizarCobrancas();
  renderizarDashboard();
  // Mudar para aba de cobranças
  ativarAba('cobrancas');
  alert(`✅ Cobrança de ${moeda(valor)} criada com vencimento ${dataLocal(payload.data_vencimento)}.`);
}

/* ─────────────────────────────────────────
   EXPORTAR (Excel)
───────────────────────────────────────── */
function exportarExcel() {
  const wb = XLSX.utils.book_new();

  // Aba Cobranças
  const cobDados = cobrancas.map(c => ({
    'Cliente':      nomeCliente(c.cliente_id),
    'Descrição':    c.descricao,
    'Tipo':         c.tipo,
    'Valor (R$)':   Number(c.valor),
    'Vencimento':   dataLocal(c.data_vencimento),
    'Pagamento':    dataLocal(c.data_pagamento),
    'Status':       c.status,
    'Observações':  c.observacoes ?? '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cobDados), 'Cobranças');

  // Aba Despesas
  const despDados = despesas.map(d => ({
    'Descrição':  d.descricao,
    'Categoria':  d.categoria,
    'Valor (R$)': Number(d.valor),
    'Data':       dataLocal(d.data),
    'Observações': d.observacoes ?? '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(despDados), 'Despesas');

  // Aba Propostas
  const propDados = propostas.map(p => ({
    'Cliente':   nomeCliente(p.cliente_id),
    'Título':    p.titulo,
    'Descrição': p.descricao ?? '',
    'Valor (R$)': Number(p.valor),
    'Validade':  dataLocal(p.validade),
    'Status':    p.status,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(propDados), 'Propostas');

  const mes = new Date().toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }).replace('/', '-');
  XLSX.writeFile(wb, `linkpy-financeiro-${mes}.xlsx`);
}

/* ─────────────────────────────────────────
   MODAL — HELPERS GENÉRICOS
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
  // Renderiza a aba ao abrir para garantir dados atualizados
  if (nome === 'cobrancas') renderizarCobrancas();
  if (nome === 'despesas')  renderizarDespesas();
  if (nome === 'propostas') renderizarPropostas();
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
/** Escapa string para uso seguro em innerHTML */
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const STATUS_LABELS = {
  pendente: 'Pendente', pago: 'Pago', vencido: 'Vencido', cancelado: 'Cancelado',
  rascunho: 'Rascunho', enviada: 'Enviada', aprovada: 'Aprovada', recusada: 'Recusada',
};
const labelStatus = (s) => STATUS_LABELS[s] ?? s;

/** Popula <select> de clientes nos 3 modais */
function popularSelects() {
  const opcoes = ['<option value="">— Sem cliente —</option>']
    .concat(clientes.map(c => `<option value="${c.id}">${esc(c.nome_empresa)}</option>`))
    .join('');
  ['cob-cliente', 'prop-cliente'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opcoes;
  });
}

/* ─────────────────────────────────────────
   INICIALIZAÇÃO
───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {

  // Auth
  document.getElementById('form-login').addEventListener('submit', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await db.auth.signOut(); location.reload();
  });

  // Verificar sessão ativa
  const { data: { session } } = await db.auth.getSession();
  if (session) iniciarApp();

  // Abas
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => ativarAba(btn.dataset.tab))
  );

  // Botões de abertura de modal
  document.getElementById('btn-nova-cobranca').addEventListener('click', () => abrirModalCob());
  document.getElementById('btn-nova-despesa').addEventListener('click', () => abrirModalDesp());
  document.getElementById('btn-nova-proposta').addEventListener('click', () => abrirModalProp());

  // Exportar
  document.getElementById('btn-exportar').addEventListener('click', exportarExcel);

  // Salvar / Excluir — cobranças
  document.getElementById('btn-cob-salvar').addEventListener('click', salvarCobranca);
  document.getElementById('btn-cob-excluir').addEventListener('click', excluirCobranca);
  document.getElementById('btn-cob-whatsapp').addEventListener('click', enviarWhatsAppCobranca);

  // Salvar / Excluir — despesas
  document.getElementById('btn-desp-salvar').addEventListener('click', salvarDespesa);
  document.getElementById('btn-desp-excluir').addEventListener('click', excluirDespesa);

  // Salvar / Excluir / Converter — propostas
  document.getElementById('btn-prop-salvar').addEventListener('click', salvarProposta);
  document.getElementById('btn-prop-excluir').addEventListener('click', excluirProposta);
  document.getElementById('btn-prop-converter').addEventListener('click', converterPropostaEmCobranca);

  // Fechar modais (botões com classe .modal-fechar)
  document.querySelectorAll('.modal-fechar').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.modal;
      if (id) fecharModal(document.getElementById(id));
    });
  });

  // Fechar clicando fora ou Escape
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) fecharModal(overlay); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => fecharModal(m));
    }
  });

  // Filtros — cobranças
  ['busca-cobrancas', 'filtro-status-cob', 'filtro-tipo-cob'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderizarCobrancas);
  });

  // Filtros — despesas
  ['busca-despesas', 'filtro-cat-desp'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderizarDespesas);
  });

  // Filtros — propostas
  ['busca-propostas', 'filtro-status-prop'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderizarPropostas);
  });

  // Mostrar/ocultar data de pagamento quando status muda
  document.getElementById('cob-status').addEventListener('change', (e) => {
    const grupo = document.getElementById('grupo-data-pagamento');
    if (e.target.value === 'pago' && !document.getElementById('cob-data-pagamento').value) {
      document.getElementById('cob-data-pagamento').value = new Date().toISOString().split('T')[0];
    }
  });

  // Botão "Gerar Cobrança" da proposta: atualizar visibilidade ao mudar status
  document.getElementById('prop-status').addEventListener('change', (e) => {
    const id = document.getElementById('prop-id').value;
    document.getElementById('btn-prop-converter')
      .classList.toggle('hidden', !id || e.target.value !== 'aprovada');
  });
});
