// Vista Inicio (dashboard) del Administrador — interacción puramente visual, sin lógica de negocio

document.addEventListener('DOMContentLoaded', () => {

  const dropdowns = document.querySelectorAll('.dropdown');

  const closeDropdown = (dropdown) => {
    dropdown.classList.remove('open');
    dropdown.querySelector('.dropdown-toggle')?.setAttribute('aria-expanded', 'false');
    const menu = dropdown.querySelector('.dropdown-menu');
    if (menu) menu.hidden = true;
  };

  const closeAllDropdowns = (except) => {
    dropdowns.forEach((dropdown) => {
      if (dropdown !== except) closeDropdown(dropdown);
    });
  };

  dropdowns.forEach((dropdown) => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const label = dropdown.querySelector('.dropdown-label');
    const menu = dropdown.querySelector('.dropdown-menu');
    if (!toggle || !menu) return;
    const options = dropdown.querySelectorAll('.dropdown-option');

    toggle.addEventListener('click', () => {
      const isOpen = dropdown.classList.contains('open');
      closeAllDropdowns(dropdown);

      if (isOpen) {
        closeDropdown(dropdown);
        return;
      }

      dropdown.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
    });

    options.forEach((option) => {
      option.addEventListener('click', () => {
        options.forEach((o) => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
        });
        option.classList.add('selected');
        option.setAttribute('aria-selected', 'true');
        label.textContent = option.textContent.trim();
        closeDropdown(dropdown);
        dropdown.dispatchEvent(new CustomEvent('dropdown-change', { detail: { value: option.dataset.value } }));
      });
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown')) {
      closeAllDropdowns();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllDropdowns();
    }
  });

  // ---------- Filtro de nivel educativo del gráfico "Inscripciones por grado" ----------

  const levelDropdown = document.querySelector('[data-filter="chart-level"]');
  const chartBars = document.querySelector('[data-role="chart-bars"]');
  const chartLegend = document.querySelector('[data-role="chart-legend"]');

  if (levelDropdown && chartBars) {
    const modeByLevel = { ALL: 'mode-all', PRIMARY: 'mode-primary', SECONDARY: 'mode-secondary' };
    let currentLevel = levelDropdown.querySelector('.dropdown-option.selected')?.dataset.value ?? 'ALL';

    levelDropdown.addEventListener('dropdown-change', (event) => {
      const level = event.detail.value;
      // Sin cambio real de nivel no se vuelve a animar el gráfico
      if (level === currentLevel) return;
      currentLevel = level;
      chartBars.classList.remove('mode-all', 'mode-primary', 'mode-secondary');
      chartBars.classList.add(modeByLevel[level] ?? 'mode-all');
      if (chartLegend) chartLegend.hidden = level !== 'ALL';
      playChartEntrance();
    });
  }

  // ---------- Animación de entrada de las barras del gráfico ----------

  function playChartEntrance() {
    if (!chartBars) return;
    // Se colapsan las barras sin transición para que todas partan desde el mismo
    // estado inicial, incluso las que ya estaban visibles (cambio desde "Todos")
    chartBars.classList.add('is-resetting');
    chartBars.classList.remove('is-loaded');
    void chartBars.offsetWidth; // aplica scaleY(0) de forma inmediata
    chartBars.classList.remove('is-resetting');
    void chartBars.offsetWidth; // reactiva la transición antes de animar
    chartBars.classList.add('is-loaded');
  }

  playChartEntrance();
});
