/**
 * LinkPY — auth.js  (módulo compartilhado de autenticação)
 *
 * Inclua este arquivo ANTES de admin.js e financeiro.js.
 *
 * Correções aplicadas vs. versão original:
 *  ✅ Rate-limiting persistido em sessionStorage (resiste a F5)
 *  ✅ Lockout reiniciado corretamente ao recarregar durante bloqueio
 *  ✅ Código de auth não mais duplicado entre admin.js e financeiro.js
 */

/* ─── Persistência do lockout ───
   sessionStorage sobrevive a recarregamentos (F5) na mesma aba,
   mas é apagado ao fechar a aba — melhor que variável em memória
   (que é zerada em qualquer reload).
   Nota: a proteção definitiva precisa ser server-side (Supabase Auth
   possui configuração de rate-limit no dashboard do projeto).
*/
const AUTH_STORAGE_KEY = 'linkpy_auth_lockout';

function _getLockoutState() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { tentativas: 0, bloqueadoAte: null };
  } catch {
    return { tentativas: 0, bloqueadoAte: null };
  }
}

function _setLockoutState(state) {
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
}

function _clearLockoutState() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

/* ─── initAuth ───
   Configura login, lockout e sessão persistida.
   @param {object}   db        - Supabase client já inicializado
   @param {Function} onSuccess - chamado após login bem-sucedido ou sessão ativa
*/
async function initAuth(db, onSuccess) {
  const formLogin = document.getElementById('form-login');
  const btnSubmit = document.getElementById('btn-submit-login');
  const errEl     = document.getElementById('login-error');
  const errMsg    = document.getElementById('login-error-msg');

  function mostrarErro(msg) {
    if (!msg) { errEl.classList.remove('show'); return; }
    errMsg.textContent = msg;
    errEl.classList.add('show');
  }

  function iniciarCountdown(secsTotal) {
    let secs = secsTotal;
    btnSubmit.disabled = true;
    mostrarErro(`Muitas tentativas. Aguarde ${secs}s para tentar novamente.`);

    const iv = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(iv);
        _clearLockoutState();
        btnSubmit.disabled = false;
        mostrarErro(null);
      } else {
        mostrarErro(`Muitas tentativas. Aguarde ${secs}s para tentar novamente.`);
      }
    }, 1000);
  }

  // Verificar bloqueio ativo ao (re)carregar a página
  const estadoInicial = _getLockoutState();
  if (estadoInicial.bloqueadoAte && Date.now() < estadoInicial.bloqueadoAte) {
    const secsRestantes = Math.ceil((estadoInicial.bloqueadoAte - Date.now()) / 1000);
    iniciarCountdown(secsRestantes);
  }

  // Verificar sessão ativa (sem novo login)
  const { data: { session } } = await db.auth.getSession();
  if (session) { onSuccess(); return; }

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();

    const estado = _getLockoutState();
    if (estado.bloqueadoAte && Date.now() < estado.bloqueadoAte) return;

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      mostrarErro('Preencha email e senha.'); return;
    }

    btnSubmit.disabled    = true;
    btnSubmit.textContent = 'Entrando...';

    const { error } = await db.auth.signInWithPassword({ email, password });

    btnSubmit.disabled    = false;
    btnSubmit.textContent = 'Entrar';

    if (error) {
      const novas      = estado.tentativas + 1;
      const restantes  = 5 - novas;

      if (novas >= 5) {
        _setLockoutState({ tentativas: novas, bloqueadoAte: Date.now() + 30_000 });
        iniciarCountdown(30);
      } else {
        _setLockoutState({ tentativas: novas, bloqueadoAte: null });
        mostrarErro(
          restantes > 0
            ? `Credenciais inválidas. Tentativas restantes: ${restantes}`
            : 'Conta bloqueada temporariamente por segurança.'
        );
      }
    } else {
      _clearLockoutState();
      mostrarErro(null);
      onSuccess();
    }
  });
}

/* ─── initLogout ───
   Conecta o botão de logout ao signOut do Supabase.
*/
function initLogout(db) {
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await db.auth.signOut();
    location.reload();
  });
}
