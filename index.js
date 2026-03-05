document.addEventListener('DOMContentLoaded', () => {
    // Scroll suave para links internos
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });

    // Função opcional: Log de visitas ou analytics simples
    console.log("LinkPy Landing Page Cargada");
});