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
  const chartCard = document.querySelector('.chart-card');
  const chartBars = document.querySelector('[data-role="chart-bars"]');
  const chartLegend = document.querySelector('[data-role="chart-legend"]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (levelDropdown && chartBars) {
    const modeByLevel = { ALL: 'mode-all', PRIMARY: 'mode-primary', SECONDARY: 'mode-secondary' };
    let currentLevel = levelDropdown.querySelector('.dropdown-option.selected')?.dataset.value ?? 'ALL';

    levelDropdown.addEventListener('dropdown-change', (event) => {
      const level = event.detail.value;
      // Sin cambio real de nivel no se vuelve a animar el gráfico
      if (level === currentLevel) return;
      currentLevel = level;
      animateCardResize(() => {
        chartBars.classList.remove('mode-all', 'mode-primary', 'mode-secondary');
        chartBars.classList.add(modeByLevel[level] ?? 'mode-all');
        setLegendVisible(level === 'ALL');
      });
      playChartEntrance();
    });
  }

  // ---------- Transición de alto de la card del gráfico ----------

  // Finaliza la transición de alto en curso, si la hay
  let endCardResize = null;

  // Aplica `applyChange` y lleva el alto de la card desde su valor actual hasta el
  // resultante, con la misma curva y duración que usan las barras del gráfico
  function animateCardResize(applyChange) {
    if (!chartCard || reducedMotion.matches) {
      applyChange();
      return;
    }

    const startHeight = chartCard.getBoundingClientRect().height;
    // Cierra una transición previa para medir el alto natural, sin salto visible
    // porque el alto inicial se restituye antes del siguiente repintado
    endCardResize?.();
    applyChange();
    const endHeight = chartCard.getBoundingClientRect().height;
    if (Math.abs(endHeight - startHeight) < 1) return;

    chartCard.classList.add('is-resizing');
    chartCard.style.height = `${startHeight}px`;
    void chartCard.offsetHeight; // fija el alto inicial antes de animar
    chartCard.style.height = `${endHeight}px`;

    const finish = () => {
      window.clearTimeout(fallbackTimer);
      chartCard.removeEventListener('transitionend', onTransitionEnd);
      chartCard.classList.remove('is-resizing');
      chartCard.style.height = '';
      // La leyenda solo se oculta al terminar de desvanecerse
      if (chartLegend?.classList.contains('is-leaving')) {
        chartLegend.classList.remove('is-leaving');
        chartLegend.hidden = true;
      }
      endCardResize = null;
    };

    const onTransitionEnd = (transitionEvent) => {
      if (transitionEvent.target === chartCard && transitionEvent.propertyName === 'height') finish();
    };

    // Respaldo por si la transición no llega a emitir su evento de fin
    const fallbackTimer = window.setTimeout(finish, 700);
    chartCard.addEventListener('transitionend', onTransitionEnd);
    endCardResize = finish;
  }

  // Muestra u oculta la leyenda del gráfico doble acompañando el cambio de alto
  function setLegendVisible(visible) {
    if (!chartLegend) return;

    if (visible) {
      chartLegend.classList.remove('is-leaving');
      chartLegend.hidden = false;
      if (reducedMotion.matches) return;
      chartLegend.classList.add('is-entering');
      void chartLegend.offsetWidth; // aplica la opacidad inicial de forma inmediata
      chartLegend.classList.remove('is-entering');
      return;
    }

    if (reducedMotion.matches) {
      chartLegend.hidden = true;
      return;
    }

    chartLegend.classList.add('is-leaving');
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
