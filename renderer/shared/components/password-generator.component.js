// Componente reutilizable: generador de contraseñas de los formularios de usuario (alta y edición).
// Uso: <password-generator></password-generator> genera la sección "Contraseña": encabezado, botón
// "Generar contraseña" y el recuadro con la contraseña enmascarada y sus acciones Mostrar/Ocultar,
// Copiar y Descartar. Los estilos están en password-generator.css.
// API para la vista:
//   - reset(mode): 'create' genera una contraseña y la muestra enmascarada; 'edit' no tiene
//     contraseña y oculta el recuadro, para conservar la actual. Pone el texto de ayuda del modo.
//   - clear(): borra la contraseña del estado y del DOM. La vista lo llama al cerrar el modal.
//   - value: la contraseña en texto plano. En 'create' siempre es un string; en 'edit' es un
//     string si se generó una, o null para conservar la actual.
// Generar, Descartar, reset() y clear() cancelan el "Copiado" pendiente de la contraseña anterior.
// En 'edit', "Descartar" quita la contraseña generada y vuelve a conservar la actual.
// Solo genera: la contraseña viaja en texto plano al proceso principal, que la valida y la hashea
// (src/main/services/password.service.js). Si cambian las reglas de acá, revisar las de ese
// servicio: toda contraseña generada tiene que cumplirlas. El renderer no puede importarlo.
// Sin shadow DOM ni ids: los botones se buscan dentro del elemento por data-action, así puede
// haber más de un generador por página.
// El script se carga sin defer en <head>, así el marcado existe antes de que la vista lo use en
// DOMContentLoaded.

(() => {
  const PASSWORD_LENGTH = 16;

  // Mayúsculas, minúsculas, dígitos y símbolos, sin los caracteres ambiguos 0 O 1 l I.
  const CHARACTER_GROUPS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*'];
  const ALPHABET = CHARACTER_GROUPS.join('');

  const HELP_TEXTS = {
    create: 'Se generará automáticamente una contraseña segura.',
    edit: 'Genera una nueva contraseña solo si necesitas reemplazar la actual.',
  };

  const COPIED_MS = 1500;

  // Índice uniforme en [0, max): se descartan los valores del último tramo incompleto de 2^32,
  // que harían más probables los primeros índices (sesgo de módulo).
  const randomIndex = (max) => {
    const limit = 2 ** 32 - (2 ** 32 % max);
    const values = new Uint32Array(1);
    do {
      crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return values[0] % max;
  };

  const pick = (characters) => characters[randomIndex(characters.length)];

  // Un carácter de cada grupo, el resto del alfabeto completo y una mezcla Fisher–Yates para que
  // los obligatorios no queden al principio. Unos 95 bits de entropía.
  const generatePassword = () => {
    const characters = CHARACTER_GROUPS.map(pick);
    while (characters.length < PASSWORD_LENGTH) characters.push(pick(ALPHABET));
    for (let i = characters.length - 1; i > 0; i -= 1) {
      const j = randomIndex(i + 1);
      [characters[i], characters[j]] = [characters[j], characters[i]];
    }
    return characters.join('');
  };

  class PasswordGenerator extends HTMLElement {
    #mode = 'create';
    #password = null;
    #copiedTimer = null;

    connectedCallback() {
      // Se genera una sola vez: los listeners quedan sobre estos nodos
      if (this.rendered) return;
      this.rendered = true;
      this.innerHTML = `<div class="password-section">
        <div class="password-heading">
          <span class="password-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <div>
            <span class="password-title">Contraseña</span>
            <p>${HELP_TEXTS.create}</p>
          </div>
        </div>

        <button type="button" class="btn btn-outline-blue" data-action="generate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
          Generar contraseña
        </button>

        <div class="password-display" hidden>
          <span class="password-value" data-visible="false"></span>
          <div class="password-actions">
            <button type="button" class="link-btn" data-action="toggle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Mostrar</span>
            </button>
            <button type="button" class="link-btn" data-action="copy">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copiar</span>
            </button>
            <button type="button" class="link-btn" data-action="discard" hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              <span>Descartar</span>
            </button>
          </div>
        </div>
      </div>`;

      this.querySelector('[data-action="generate"]').addEventListener('click', () => {
        this.#showPassword(generatePassword());
      });

      this.querySelector('[data-action="toggle"]').addEventListener('click', () => {
        const valueElement = this.querySelector('.password-value');
        valueElement.dataset.visible = String(valueElement.dataset.visible !== 'true');
        this.#render();
      });

      this.querySelector('[data-action="copy"]').addEventListener('click', () => this.#copy());

      // El botón con el foco desaparece: el foco pasa a "Generar contraseña".
      this.querySelector('[data-action="discard"]').addEventListener('click', () => {
        this.#showPassword(null);
        this.querySelector('[data-action="generate"]').focus();
      });
    }

    get value() {
      return this.#password;
    }

    reset(mode) {
      this.#mode = mode;
      this.querySelector('.password-heading p').textContent = HELP_TEXTS[mode];
      this.#showPassword(mode === 'create' ? generatePassword() : null);
    }

    // No oculta el recuadro: el modal sigue a la vista mientras se desvanece y no debe cambiar de alto.
    clear() {
      this.#setPassword(null);
    }

    // Cancela el "Copiado" pendiente, que corresponde a la contraseña anterior.
    #setPassword(password) {
      this.#password = password;
      this.#resetCopied();
      this.querySelector('.password-value').dataset.visible = 'false';
      this.#render();
    }

    // Con null oculta el recuadro: en 'edit' significa conservar la contraseña actual.
    #showPassword(password) {
      this.#setPassword(password);
      this.querySelector('.password-display').hidden = password === null;
      this.querySelector('[data-action="discard"]').hidden = password === null || this.#mode !== 'edit';
    }

    #render() {
      const valueElement = this.querySelector('.password-value');
      const password = this.#password ?? '';
      const isVisible = valueElement.dataset.visible === 'true';
      valueElement.textContent = isVisible ? password : '•'.repeat(password.length);
      this.querySelector('[data-action="toggle"] span').textContent = isVisible ? 'Ocultar' : 'Mostrar';
    }

    async #copy() {
      const password = this.#password;
      if (password === null) return;
      try {
        await navigator.clipboard.writeText(password);
      } catch (error) {
        const textarea = document.createElement('textarea');
        textarea.value = password;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      // Si mientras tanto se reinició, se descartó o se generó otra, "Copiado" ya no corresponde.
      if (password !== this.#password) return;
      clearTimeout(this.#copiedTimer);
      const copyButton = this.querySelector('[data-action="copy"]');
      copyButton.classList.add('copied');
      copyButton.querySelector('span').textContent = 'Copiado';
      this.#copiedTimer = setTimeout(() => this.#resetCopied(), COPIED_MS);
    }

    #resetCopied() {
      clearTimeout(this.#copiedTimer);
      const copyButton = this.querySelector('[data-action="copy"]');
      copyButton.classList.remove('copied');
      copyButton.querySelector('span').textContent = 'Copiar';
    }
  }

  customElements.define('password-generator', PasswordGenerator);
})();
