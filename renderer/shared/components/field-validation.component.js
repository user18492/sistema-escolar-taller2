// Componente global: formato y validación de los campos de texto de los formularios.
// Uso: marcar cada campo con data-validate="<regla>" (y required si es obligatorio) e incluir
// el script en <head>, sin defer y antes del JS de la vista. La vista llama a
// clearFieldErrors(contenedor) al reiniciar el formulario y, al guardar, a
// validateFields(contenedor), que devuelve el primer campo inválido (ya enfocado) o null.
// Por cada campo con regla:
//   - al escribir se descartan los caracteres que la regla no admite, se aplica la máscara
//     (DNI, fechas) con el cursor junto al mismo carácter y se borra el error mostrado; si una
//     edición deja más dígitos de los admitidos, se rechaza entera en lugar de recortarla;
//   - al salir con un valor, se formatea (espacios, mayúsculas) y se valida. Salir de un campo
//     vacío no muestra nada: "Campo obligatorio." solo aparece al guardar;
//   - el error va en <p class="field-error" id="<id del campo>Error">, que se crea al final de
//     su .form-field si la vista no lo trae, y se agrega al principio de aria-describedby.
// El formato al salir no cambia si un campo está completo (nunca vacía un valor con texto ni
// modifica una fecha completa), así que las vistas no necesitan enterarse de él.
// Reglas: person-name, dni, birth-date (edad con data-min-age y data-max-age), day-month
// (año tomado del texto del elemento cuyo id indica data-year-source), email, phone, street,
// street-number, division y title.
// También expone setFieldError(input, mensaje) e isValidEmail(email), que usa el login.
// Estas reglas solo anticipan errores: el proceso principal vuelve a validar los datos.

(() => {
  const REQUIRED_MESSAGE = 'Campo obligatorio.';

  // Letras de nombres y calles: tildes, ñ y ü, y también ç o ã de apellidos extranjeros
  const LETTERS = 'A-Za-zÀ-ÖØ-öø-ÿ';
  const LETTER_PATTERN = new RegExp(`^[${LETTERS}]$`);
  const PERSON_NAME_PATTERN = new RegExp(`^[${LETTERS}]+([ '-][${LETTERS}]+)*$`);
  const NOT_PERSON_NAME_CHAR = new RegExp(`[^${LETTERS} '-]`, 'g');
  const NOT_STREET_CHAR = new RegExp(`[^${LETTERS}\\d .'°º-]`, 'g');
  const STREET_CONTENT_PATTERN = new RegExp(`[${LETTERS}\\d]`);
  // Partículas que quedan en minúscula dentro del nombre (Juan de la Cruz)
  const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

  // Mismas reglas que auth.service.js, que el renderer no puede importar: el largo de la
  // columna usuarios.email y un formato básico.
  const EMAIL_MAX_LENGTH = 150;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const PHONE_PATTERN = /^\+?([\d -]|\(\d+\))+$/;

  const isDigit = (character) => character >= '0' && character <= '9';
  const digitsOf = (value) => value.replace(/\D/g, '');
  const collapseSpaces = (value) => value.trim().replace(/\s+/g, ' ');
  // Tipográfico → recto, y las tildes pegadas como carácter aparte (NFD) se unen a su letra
  const normalizeText = (value) => value.normalize('NFC').replace(/’/g, "'");

  const isValidEmail = (email) => email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);

  // ---------- Nombres ----------

  // Mayúscula solo si sigue siendo una letra admitida (ÿ y ß no tienen una en ese rango)
  const toUpperLetter = (letter) => {
    const upper = letter.toUpperCase();
    return LETTER_PATTERN.test(upper) ? upper : letter;
  };

  // McDonald u O'Connor ya traen sus mayúsculas; JUAN o jUAN no
  const isMixedCase = (word) => /^\p{Lu}.*\p{Lu}/u.test(word) && /\p{Ll}/u.test(word);

  // Mayúscula inicial en cada palabra y después de "-" o "'" (o'connor → O'Connor). Las
  // partículas quedan en minúscula salvo al comienzo.
  const formatPersonName = (value) =>
    collapseSpaces(value)
      .split(' ')
      .map((word, index) => {
        if (isMixedCase(word)) return word;
        const lower = word.toLowerCase();
        if (index > 0 && NAME_PARTICLES.has(lower)) return lower;
        return lower.replace(/(^|[-'])([^-'])/g, (match, separator, letter) => separator + toUpperLetter(letter));
      })
      .join(' ');

  // ---------- Fechas ----------

  const isRealDate = (year, month, day) => {
    const date = new Date(2000, 0, 1);
    date.setFullYear(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  };

  // AAAAMMDD como número: compara fechas y calcula edades sin pasar por texto ni husos horarios
  const dateKey = (year, month, day) => year * 10000 + month * 100 + day;

  // Agrupa los dígitos en DD/MM/AAAA (o DD/MM): la "/" aparece al escribir el grupo siguiente
  const maskDate = (digits, groupSizes) => {
    const groups = [];
    let start = 0;
    groupSizes.forEach((size) => {
      if (start < digits.length) groups.push(digits.slice(start, start + size));
      start += size;
    });
    return groups.join('/');
  };

  // Relleno al escribir o pegar al final: "1/" pasa a "01/" y "1/3/2000" a "01/03/2000". Solo
  // se rellenan los grupos que ya tienen un separador detrás; devuelve null si el valor no
  // empieza con uno de 1 o 2 dígitos seguido de un separador.
  const padDateGroups = (value, groupCount) => {
    let rest = value.replace(/[^\d\/.\- ]/g, '');
    let digits = '';
    for (let group = 1; group < groupCount; group += 1) {
      const match = rest.match(/^(\d{1,2})[\/.\- ]/);
      if (!match) break;
      digits += match[1].padStart(2, '0');
      rest = rest.slice(match[0].length);
    }
    if (!digits) return null;
    // Sin nada después del último separador, la "/" se conserva para seguir escribiendo
    return { digits: digits + digitsOf(rest), endsWithSeparator: rest === '' };
  };

  const dateMask = (groupSizes) => ({
    maxDigits: groupSizes.reduce((total, size) => total + size, 0),
    groupCount: groupSizes.length,
    format: (digits) => maskDate(digits, groupSizes),
  });

  const validateBirthDate = (value, input) => {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return 'Fecha incompleta (DD/MM/AAAA).';
    const [day, month, year] = match.slice(1).map(Number);
    if (!isRealDate(year, month, day)) return 'La fecha no existe.';

    const today = new Date();
    const birthKey = dateKey(year, month, day);
    const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
    if (birthKey > todayKey) return 'La fecha no puede ser futura.';

    const { minAge, maxAge } = input.dataset;
    const age = Math.floor((todayKey - birthKey) / 10000);
    if (minAge && maxAge && (age < Number(minAge) || age > Number(maxAge))) {
      return `La edad debe estar entre ${minAge} y ${maxAge} años.`;
    }
    return '';
  };

  const validateDayMonth = (value, input) => {
    const match = value.match(/^(\d{2})\/(\d{2})$/);
    if (!match) return 'Fecha incompleta (DD/MM).';
    const yearText = document.getElementById(input.dataset.yearSource)?.textContent.trim() ?? '';
    const year = /^\d{4}$/.test(yearText) ? Number(yearText) : new Date().getFullYear();
    return isRealDate(year, Number(match[2]), Number(match[1])) ? '' : `La fecha no existe en ${year}.`;
  };

  // ---------- Reglas ----------

  // Cada regla define, según corresponda:
  //   - maxLength: largo máximo de las reglas de texto libre (atributo del campo);
  //   - sanitize(valor): quita al escribir los caracteres no admitidos, de a uno, sin agregar;
  //   - mask: máscara de dígitos con su máximo (maxDigits) y cómo agruparlos (format);
  //   - format(valor): formato al salir del campo;
  //   - validate(valor, input): mensaje de error, o '' si el valor es válido.
  const RULES = {
    'person-name': {
      maxLength: 100,
      sanitize: (value) => normalizeText(value).replace(NOT_PERSON_NAME_CHAR, ''),
      format: formatPersonName,
      validate: (value) => (PERSON_NAME_PATTERN.test(value) ? '' : 'Guiones y apóstrofos deben ir entre letras.'),
    },
    dni: {
      mask: { maxDigits: 8, format: (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') },
      validate: (value) => {
        const digits = digitsOf(value);
        if (digits.length < 7 || digits.length > 8) return 'El DNI debe tener 7 u 8 dígitos.';
        return digits.startsWith('0') ? 'El DNI no puede empezar con 0.' : '';
      },
    },
    'birth-date': {
      mask: dateMask([2, 2, 4]),
      validate: validateBirthDate,
    },
    'day-month': {
      mask: dateMask([2, 2]),
      validate: validateDayMonth,
    },
    // Sin limpieza al escribir: un campo type="email" no permite ubicar el cursor
    email: {
      maxLength: EMAIL_MAX_LENGTH,
      format: (value) => value.trim().toLowerCase(),
      validate: (value) => (isValidEmail(value) ? '' : 'El email no es válido.'),
    },
    phone: {
      maxLength: 20,
      sanitize: (value) =>
        value.replace(/[^\d ()+-]/g, '').replace(/\+/g, (plus, index) => (index === 0 ? plus : '')),
      format: collapseSpaces,
      validate: (value) => {
        if (!PHONE_PATTERN.test(value)) return 'Formato de teléfono inválido.';
        const digitCount = digitsOf(value).length;
        return digitCount >= 10 && digitCount <= 13 ? '' : 'El teléfono debe tener entre 10 y 13 dígitos.';
      },
    },
    street: {
      maxLength: 150,
      sanitize: (value) => normalizeText(value).replace(NOT_STREET_CHAR, ''),
      format: collapseSpaces,
      validate: (value) => (STREET_CONTENT_PATTERN.test(value) ? '' : 'La calle debe incluir letras o números.'),
    },
    'street-number': {
      mask: { maxDigits: 5, format: (digits) => digits },
      validate: (value) => (/^[1-9]\d{0,4}$/.test(value) ? '' : 'La altura debe estar entre 1 y 99999.'),
    },
    division: {
      maxLength: 1,
      sanitize: (value) => value.replace(/[^A-Za-z]/g, '').toUpperCase(),
      validate: (value) => (/^[A-Z]$/.test(value) ? '' : 'La división debe ser una letra de A a Z.'),
    },
    title: {
      maxLength: 100,
      sanitize: (value) => value.replace(/\p{Cc}/gu, ''),
      format: collapseSpaces,
      validate: (value) => (/[\p{L}\d]/u.test(value) ? '' : 'El título debe incluir letras o números.'),
    },
  };

  const ruleOf = (element) => {
    const name = element instanceof HTMLInputElement ? element.dataset.validate : undefined;
    return name && Object.hasOwn(RULES, name) ? RULES[name] : null;
  };

  // ---------- Errores ----------

  // El mensaje va en #<id>Error, que describe al campo; sin mensaje se vacía y se oculta, así
  // aria-describedby no anuncia un error viejo.
  const setFieldError = (input, message) => {
    const error = document.getElementById(`${input.id}Error`);
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  const setupField = (input) => {
    const rule = ruleOf(input);
    if (!rule) return;
    if (rule.maxLength) input.maxLength = rule.maxLength;

    const errorId = `${input.id}Error`;
    if (!document.getElementById(errorId)) {
      const error = document.createElement('p');
      error.className = 'field-error';
      error.id = errorId;
      error.hidden = true;
      const formField = input.closest('.form-field');
      if (formField) formField.append(error);
      else (input.closest('.field') ?? input).after(error);
    }

    // El error se lee antes que la descripción que ya tuviera el campo
    const describedBy = (input.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    input.setAttribute('aria-describedby', [errorId, ...describedBy].join(' '));
  };

  // ---------- Formato al escribir ----------

  // Valor y selección antes de cada edición, para poder rechazarla
  const previousStates = new WeakMap();

  // Deja el cursor después de la misma cantidad de caracteres significativos que tenía antes
  // del formato: los dígitos en las máscaras y cualquier carácter conservado en el resto.
  const placeCursor = (input, significantCount, isSignificant) => {
    const { value } = input;
    let cursor = 0;
    for (let seen = 0; cursor < value.length && seen < significantCount; cursor += 1) {
      if (isSignificant(value[cursor])) seen += 1;
    }
    input.setSelectionRange(cursor, cursor);
  };

  // Devuelve false si rechazó la edición porque superaba el máximo de dígitos
  const applyMask = (input, mask, inputType = '') => {
    const { value, selectionStart } = input;
    const isInsertAtEnd = inputType.startsWith('insert') && selectionStart === value.length;
    const padded = mask.groupCount && isInsertAtEnd ? padDateGroups(value, mask.groupCount) : null;
    let digits = padded ? padded.digits : digitsOf(value);

    if (digits.length > mask.maxDigits) {
      const previous = previousStates.get(input);
      if (previous) {
        input.value = previous.value;
        input.setSelectionRange(previous.start, previous.end);
        return false;
      }
      digits = digits.slice(0, mask.maxDigits);
    }

    const formatted = mask.format(digits) + (padded?.endsWithSeparator ? '/' : '');
    if (formatted === value) return true;
    input.value = formatted;
    if (padded) input.setSelectionRange(formatted.length, formatted.length);
    else placeCursor(input, digitsOf(value.slice(0, selectionStart)).length, isDigit);
    return true;
  };

  const sanitizeField = (input, rule, inputType) => {
    if (rule.mask) return applyMask(input, rule.mask, inputType);
    if (!rule.sanitize) return true;
    const { value, selectionStart } = input;
    const sanitized = rule.sanitize(value);
    if (sanitized !== value) {
      input.value = sanitized;
      placeCursor(input, rule.sanitize(value.slice(0, selectionStart)).length, () => true);
    }
    return true;
  };

  const formatField = (input, rule) => {
    const format = rule.mask ? (value) => rule.mask.format(digitsOf(value)) : rule.format;
    if (!format) return;
    const formatted = format(input.value);
    if (formatted !== input.value) input.value = formatted;
  };

  // ---------- API ----------

  window.setFieldError = setFieldError;
  window.isValidEmail = isValidEmail;

  window.clearFieldErrors = (container) => {
    container.querySelectorAll('[data-validate]').forEach((input) => setFieldError(input, ''));
  };

  window.validateFields = (container) => {
    let firstInvalid = null;
    container.querySelectorAll('[data-validate]:not(:disabled)').forEach((input) => {
      const rule = ruleOf(input);
      if (!rule) return;
      formatField(input, rule);
      const message = input.value ? rule.validate(input.value, input) : input.required ? REQUIRED_MESSAGE : '';
      setFieldError(input, message);
      if (message && !firstInvalid) firstInvalid = input;
    });
    firstInvalid?.focus();
    return firstInvalid;
  };

  // ---------- Listeners ----------

  // En fase de captura: la máscara corre antes que los listeners de la vista sobre el campo,
  // que así ven el valor ya formateado.

  document.addEventListener('beforeinput', (event) => {
    const input = event.target;
    if (!ruleOf(input)?.mask) return;
    previousStates.set(input, { value: input.value, start: input.selectionStart, end: input.selectionEnd });
  }, true);

  // Durante una composición (teclas muertas: ´ + a) el valor intermedio no se toca: quitar la
  // tilde suelta impediría escribir "á". Se limpia al terminarla.
  document.addEventListener('input', (event) => {
    const input = event.target;
    const rule = ruleOf(input);
    if (!rule || event.isComposing) return;
    if (sanitizeField(input, rule, event.inputType)) setFieldError(input, '');
  }, true);

  document.addEventListener('compositionend', (event) => {
    const input = event.target;
    const rule = ruleOf(input);
    if (!rule) return;
    const { value } = input;
    sanitizeField(input, rule);
    setFieldError(input, '');
    // La vista solo vio el valor intermedio: se le avisa del limpio
    if (input.value !== value) input.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);

  // Pulsar un botón del pie del modal (Cancelar, Guardar) le quita el foco al campo antes del
  // clic: ese focusout se omite para que su error no aparezca un instante antes de cerrar.
  // Guardar valida todos los campos de todas formas.
  let skipNextFocusout = false;

  document.addEventListener('pointerdown', (event) => {
    skipNextFocusout = Boolean(event.target.closest?.('.modal-footer button:not(:disabled)'));
  }, true);

  document.addEventListener('click', () => {
    skipNextFocusout = false;
  }, true);

  document.addEventListener('focusout', (event) => {
    const input = event.target;
    const rule = ruleOf(input);
    if (!rule) return;
    if (skipNextFocusout) {
      skipNextFocusout = false;
      return;
    }
    // Modal ya cerrado (Escape, Cancelar) o ventana sin foco: el campo sigue siendo el activo
    if (input.closest('.modal-overlay:not(.is-open)') || document.activeElement === input) return;

    formatField(input, rule);
    if (input.value) setFieldError(input, rule.validate(input.value, input));
  }, true);

  const setupAll = () => document.querySelectorAll('[data-validate]').forEach(setupField);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupAll);
  else setupAll();
})();
