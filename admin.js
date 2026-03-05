const APP_VERSION = "1.0.6"; 

// Configuração do Supabase
const supabaseUrl = 'https://cwauzlddxfalcjcryegb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YXV6bGRkeGZhbGNqY3J5ZWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzUzMzYsImV4cCI6MjA4ODMxMTMzNn0.2X5A-GqrE9iDtq36G8xbcRE3Ve4KuJFmdQildPr1UeE';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// DOM Elements
const grid = document.getElementById('grid-clientes');
const loginContainer = document.getElementById('login-container');
const adminWrapper = document.getElementById('admin-wrapper');

// --- FUNÇÕES DE SUPORTE ---

const verificarAlerta = (dataVencimento) => {
    if (!dataVencimento) return false;
    const hoje = new Date();
    const venc = new Date(dataVencimento);
    const diffTime = venc - hoje;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 5 && diffDays >= 0;
};

async function fetchClientes() {
    console.log("Buscando clientes...");
    const { data: clientes, error } = await supabase.from('clientes').select('*');
    if (error) {
        console.error("Erro ao buscar clientes:", error);
        return;
    }

    grid.innerHTML = clientes.map(c => `
        <article class="card-cliente ${verificarAlerta(c.vencimento_mensalidade) ? 'alerta-vencimento' : ''}">
            <h3>${c.nome_empresa}</h3>
            <p><strong>Resp:</strong> ${c.responsavel_nome || 'N/A'}</p>
            <p><strong>Vencimento:</strong> ${c.vencimento_mensalidade ? new Date(c.vencimento_mensalidade).toLocaleDateString() : 'Não definido'}</p>
            <div class="btn-group">
                <button onclick="enviarWpp('${c.telefone_responsavel}', '${c.nome_empresa}')">WhatsApp</button>
                <button onclick="alert('Detalhes em desenvolvimento')">Ver SQL/Host</button>
            </div>
        </article>
    `).join('');
}

// --- LOGICA DE AUTENTICAÇÃO ---

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        alert("Erro no login: " + error.message);
    } else {
        showAdmin();
    }
}

function showAdmin() {
    loginContainer.classList.add('hidden');
    adminWrapper.classList.remove('hidden');
    fetchClientes();
}

window.logout = async () => {
    await supabase.auth.signOut();
    location.reload();
};

window.enviarWpp = (tel, empresa) => {
    const msg = encodeURIComponent(`Hola! Recordatorio de pago para el sistema de ${empresa}. El vencimiento es en 5 días.`);
    window.open(`https://wa.me/${tel}?text=${msg}`, '_blank');
};

// --- INICIALIZAÇÃO ---

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Controle de Versão/Cache
    const lastVersion = localStorage.getItem('linkpy_version');
    if (lastVersion !== APP_VERSION) {
        localStorage.clear();
        localStorage.setItem('linkpy_version', APP_VERSION);
    }

    // 2. Verificar Sessão Ativa
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        showAdmin();
    }

    // 3. Event Listeners
    const loginForm = document.getElementById('form-login');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
});