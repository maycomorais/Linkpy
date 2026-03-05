const APP_VERSION = "1.0.1";
// Configuração do Supabase (Substitua pelos seus dados)
const supabaseUrl = 'https://cwauzlddxfalcjcryegb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YXV6bGRkeGZhbGNqY3J5ZWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzUzMzYsImV4cCI6MjA4ODMxMTMzNn0.2X5A-GqrE9iDtq36G8xbcRE3Ve4KuJFmdQildPr1UeE';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// DOM Elements
const grid = document.getElementById('grid-clientes');
const form = document.getElementById('form-cliente');

// Função para verificar vencimento (5 dias)
const verificarAlerta = (dataVencimento) => {
    const hoje = new Date();
    const venc = new Date(dataVencimento);
    const diffTime = venc - hoje;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 5 && diffDays >= 0;
};

// Renderizar Clientes
async function fetchClientes() {
    const { data: clientes, error } = await supabase.from('clientes').select('*');
    if (error) return console.error(error);

    grid.innerHTML = clientes.map(c => `
        <article class="card-cliente ${verificarAlerta(c.vencimento_mensalidade) ? 'alerta-vencimento' : ''}">
            <h3>${c.nome_empresa}</h3>
            <p><strong>Resp:</strong> ${c.responsavel_nome}</p>
            <p><strong>Vencimento:</strong> ${new Date(c.vencimento_mensalidade).toLocaleDateString()}</p>
            <div class="btn-group">
                <button onclick="enviarWpp('${c.telefone_responsavel}', '${c.nome_empresa}')">WhatsApp</button>
                <button onclick="verDetalhes('${c.id}')">Ver SQL/Host</button>
            </div>
        </article>
    `).join('');
}

// Lógica de Mensagem WhatsApp
window.enviarWpp = (tel, empresa) => {
    const msg = encodeURIComponent(`Hola! Recordatorio de pago para el sistema de ${empresa}. El vencimiento es en 5 días.`);
    window.open(`https://wa.me/${tel}?text=${msg}`, '_blank');
};

// Inicialização
document.addEventListener('DOMContentLoaded', fetchClientes);

function checkAppVersion() {
    const lastVersion = localStorage.getItem('linkpy_version');
    if (lastVersion !== APP_VERSION) {
        console.log("Nova versão detectada. Atualizando aplicação...");
        localStorage.clear(); // Limpa caches antigos
        localStorage.setItem('linkpy_version', APP_VERSION);
    }
}

// Lógica de Autenticação (Exemplo com Supabase Auth)
async function login(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        alert("Erro: " + error.message);
    } else {
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('admin-wrapper').classList.remove('hidden');
        fetchClientes(); // Carrega os dados
    }
}

// Lógica de Login integrada com a sua UI
async function handleLogin(e) {
    e.preventDefault(); // Impede o recarregamento da página
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    console.log("Tentando login com:", email);

    const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        alert("Erro no login: " + error.message);
    } else {
        console.log("Login realizado com sucesso!");
        // Salva a sessão e limpa a tela de login
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('admin-wrapper').classList.remove('hidden');
        
        // Agora sim carrega os dados
        fetchClientes();
    }
}

// 3. Inicialização Protegida
document.addEventListener('DOMContentLoaded', async () => {
    // Verifica versão (LocalStorage/Cache)
    const lastVersion = localStorage.getItem('linkpy_version');
    if (lastVersion !== APP_VERSION) {
        localStorage.clear();
        localStorage.setItem('linkpy_version', APP_VERSION);
    }

    // Verifica se já existe sessão ativa
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('admin-wrapper').classList.remove('hidden');
        fetchClientes();
    }

    // Listener do Formulário
    const loginForm = document.getElementById('form-login');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    checkAppVersion();
    const loginForm = document.getElementById('form-login');
    if(loginForm) loginForm.addEventListener('submit', handleLogin);
});

// Verificação de Versão e Cache
function checkAppVersion() {
    const lastVersion = localStorage.getItem('linkpy_version');
    if (lastVersion !== APP_VERSION) {
        localStorage.clear();
        localStorage.setItem('linkpy_version', APP_VERSION);
        console.log("Versão atualizada: Cache limpo.");
    }
}
