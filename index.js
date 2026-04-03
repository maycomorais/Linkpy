/* ============================================================
   LinkPY — index.js  v2.0.0
   Funcionalidades: nav activa, smooth-scroll, mobile menu,
   animaciones de entrada, contadores de estadísticas y barras,
   formulario de contacto → Supabase.
   ============================================================ */

/* ─── Supabase (mesmo projeto do admin — anon key pública é segura
       desde que RLS só permita INSERT na tabela contatos) ─── */
const _SUPA_URL    = 'https://cwauzlddxfalcjcryegb.supabase.co';
const _SUPA_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YXV6bGRkeGZhbGNqY3J5ZWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzUzMzYsImV4cCI6MjA4ODMxMTMzNn0.2X5A-GqrE9iDtq36G8xbcRE3Ve4KuJFmdQildPr1UeE';
const _SUPA_CDN    = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/supabase.js';

let _supaLanding   = null;
let _sdkLoadPromise = null;

/**
 * Garante que o SDK do Supabase está carregado antes de criar o client.
 * Funciona tanto se o <script> já estiver no HTML quanto se não estiver —
 * neste caso injeta a tag dinamicamente (uma única vez).
 */
function loadSupaSdk() {
  // SDK já disponível (script tag no HTML ou carregamento anterior)
  if (window.supabase) return Promise.resolve();

  // Evita injetar o script duas vezes em chamadas paralelas
  if (_sdkLoadPromise) return _sdkLoadPromise;

  _sdkLoadPromise = new Promise((resolve, reject) => {
    const script    = document.createElement('script');
    script.src      = _SUPA_CDN;
    script.crossOrigin = 'anonymous';
    script.onload   = resolve;
    script.onerror  = () => reject(new Error('Falha ao carregar SDK do Supabase'));
    document.head.appendChild(script);
  });

  return _sdkLoadPromise;
}

/** Retorna o client Supabase, carregando o SDK se necessário.
 *
 *  persistSession: false  → não lê nem grava nada no localStorage,
 *  impedindo que a sessão autenticada do painel admin seja herdada
 *  por este client (causaria INSERT com role 'authenticated' em vez
 *  de 'anon', quebrando a RLS policy de inserção pública).
 */
async function getSupaClient() {
  await loadSupaSdk();
  if (!_supaLanding) {
    _supaLanding = window.supabase.createClient(_SUPA_URL, _SUPA_KEY, {
      auth: {
        persistSession:     false,
        autoRefreshToken:   false,
        detectSessionInUrl: false,
      },
    });
  }
  return _supaLanding;
}

document.addEventListener('DOMContentLoaded', () => {

  /* ─────────────────────────────────────────
     1. NAVBAR: compacta en scroll
  ───────────────────────────────────────── */
  const navbar = document.getElementById('navbar');

  window.addEventListener('scroll', () => {
    navbar?.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });


  /* ─────────────────────────────────────────
     2. NAV LINKS: activo según sección visible
  ───────────────────────────────────────── */
  const sections = document.querySelectorAll('section[id], header[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navLinks.forEach(link => {
          link.classList.toggle('active', link.dataset.section === id);
        });
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px' });

  sections.forEach(s => sectionObserver.observe(s));


  /* ─────────────────────────────────────────
     3. MOBILE MENU: toggle
  ───────────────────────────────────────── */
  const menuToggle = document.getElementById('menu-toggle');
  const mobileMenu = document.getElementById('mobile-menu');

  menuToggle?.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    mobileMenu.classList.toggle('hidden', !isOpen);
    menuToggle.querySelector('span').textContent = isOpen ? 'close' : 'menu';
  });

  document.querySelectorAll('.nav-link-mobile').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      mobileMenu.classList.add('hidden');
      menuToggle.querySelector('span').textContent = 'menu';
    });
  });


  /* ─────────────────────────────────────────
     4. SMOOTH SCROLL para links internos
  ───────────────────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const offset = (navbar?.offsetHeight ?? 0) + 8;
      window.scrollTo({
        top: target.getBoundingClientRect().top + window.scrollY - offset,
        behavior: 'smooth',
      });
    });
  });


  /* ─────────────────────────────────────────
     5. FADE-IN-UP: animación de entrada
  ───────────────────────────────────────── */
  const fadeElements = document.querySelectorAll(
    'section > div, header > div, article, .card-lift'
  );

  fadeElements.forEach(el => el.classList.add('fade-in-up'));

  const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        fadeObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  fadeElements.forEach(el => fadeObserver.observe(el));


  /* ─────────────────────────────────────────
     6. CONTADORES DE ESTADÍSTICAS
  ───────────────────────────────────────── */
  function animateCounter(el) {
    const target   = parseInt(el.dataset.target, 10);
    const isK      = el.classList.contains('counter-k');
    const duration = 1600;
    const steps    = duration / 16;
    let   current  = 0;

    const interval = setInterval(() => {
      current++;
      const value = Math.round((target / steps) * current);
      el.textContent = isK ? `+${value}` : `${value}%`;
      if (current >= steps) {
        clearInterval(interval);
        el.textContent = isK ? `+${target}` : `${target}%`;
      }
    }, 16);
  }

  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.counter, .counter-k').forEach(el => {
    counterObserver.observe(el);
  });


  /* ─────────────────────────────────────────
     7. BARRAS DE ESTADÍSTICAS ANIMADAS
  ───────────────────────────────────────── */
  const barObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        setTimeout(() => { entry.target.style.width = entry.target.dataset.width; }, 200);
        barObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });

  document.querySelectorAll('.stat-bar').forEach(bar => barObserver.observe(bar));


  /* ─────────────────────────────────────────
     8. FORMULÁRIO DE CONTATO → Supabase
  ───────────────────────────────────────── */
  const form     = document.getElementById('contact-form');
  const feedback = document.getElementById('form-feedback');

  function showFeedback(msg, type) {
    if (!feedback) return;
    feedback.textContent = msg;
    feedback.className = type === 'success'
      ? 'text-center text-xs text-green-600 font-semibold block mt-2'
      : 'text-center text-xs text-red-500 font-semibold block mt-2';
    setTimeout(() => {
      feedback.className = 'text-center text-xs text-outline hidden';
    }, 6000);
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nome     = form.querySelector('[name="nombre"]')?.value.trim() ?? '';
    const mensagem = form.querySelector('[name="mensaje"]')?.value.trim() ?? '';

    // Validação client-side
    if (nome.length < 2) {
      showFeedback('Por favor, informe seu nome.', 'error');
      return;
    }
    if (mensagem.length < 5) {
      showFeedback('Por favor, descreva sua mensagem.', 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const txtOriginal = btn.textContent;
    btn.textContent = 'Enviando...';
    btn.disabled = true;

    try {
      const supa = await getSupaClient();

      const { error } = await supa
        .from('contatos')
        .insert({ nome, mensagem });

      if (error) throw error;

      form.reset();
      showFeedback('✓ Mensagem enviada! Entraremos em contato em breve.', 'success');

    } catch (err) {
      console.error('[LinkPY] Erro ao enviar contato:', err);
      showFeedback('Ocorreu um erro ao enviar. Tente novamente ou entre em contato pelo WhatsApp.', 'error');
    } finally {
      btn.textContent = txtOriginal;
      btn.disabled    = false;
    }
  });


  /* ─────────────────────────────────────────
     9. BOTÓN PLAY (demo)
  ───────────────────────────────────────── */
  const playBtn = document.getElementById('play-btn');
  playBtn?.addEventListener('click', () => {
    window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank', 'noopener');
  });


  /* ─────────────────────────────────────────
     LOG
  ───────────────────────────────────────── */
  console.log('%cLinkPY ✓ Página cargada', 'color:#003f95;font-weight:bold;font-size:14px;');

});
