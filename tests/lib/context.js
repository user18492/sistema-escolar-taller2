// Contexto `t` que recibe cada prueba: aserciones, avisos y la declaración explícita de los errores
// que la prueba espera. Lo que la prueba no declara y los monitores registran (rechazos IPC, errores
// de consola, toasts de error, avisos de PostgreSQL...) hace fallar la prueba al terminar.
const util = require('node:util');

class AbortTest extends Error {
  constructor(message) {
    super(message);
    this.name = 'AbortTest';
  }
}

function brief(value, max = 1500) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
  } catch {
    text = util.inspect(value, { depth: 4 });
  }
  if (text === undefined) text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function toMatcher(value) {
  if (value === '*' || value === undefined || value === null) return () => true;
  if (value instanceof RegExp) return (text) => value.test(String(text ?? ''));
  if (typeof value === 'function') return value;
  return (text) => text === value;
}

class TestContext {
  constructor(definition) {
    this.definition = definition;
    this.id = definition.id;
    this.failures = [];
    this.warnings = [];
    this.allowances = [];
    this.steps = [];
    this.currentStep = null;
  }

  // ---------- Resultado ----------

  fail(message, detail) {
    this.failures.push({ type: 'assert', step: this.currentStep, message, detail: detail === undefined ? undefined : brief(detail) });
    return false;
  }

  warn(message, detail) {
    this.warnings.push({ type: 'warning', step: this.currentStep, message, detail: detail === undefined ? undefined : brief(detail) });
  }

  // Aserción blanda: registra la falla y la prueba sigue.
  check(condition, message, detail) {
    if (condition) return true;
    return this.fail(message, detail);
  }

  equal(actual, expected, message) {
    if (util.isDeepStrictEqual(actual, expected)) return true;
    return this.fail(message, { actual, expected });
  }

  // Aserción dura: si no se cumple, la prueba se corta (lo que sigue depende de esto).
  require(condition, message, detail) {
    if (condition) return true;
    this.fail(message, detail);
    throw new AbortTest(message);
  }

  // Divide una prueba larga en pasos: una falla informa en qué paso ocurrió.
  async step(name, fn) {
    const previous = this.currentStep;
    this.currentStep = name;
    this.steps.push(name);
    try {
      return await fn();
    } finally {
      this.currentStep = previous;
    }
  }

  // ---------- Errores esperados ----------

  // Rechazo IPC esperado ({ ok: false, error: { code } }) de `channel` con `code` ('*' para
  // cualquiera). Sin esta declaración, cualquier rechazo hace fallar la prueba.
  allowRejection(channel, code, reason = '') {
    this.allowances.push({ type: 'ipc-reject', channel: toMatcher(channel), code: toMatcher(code), reason });
  }

  // Cualquier otro evento esperado: type es el del monitor ('console', 'dialog', 'ui-error',
  // 'ipc-throw', 'ipc-unexpected', 'ipc-timeout', 'pg-notice', 'resource', 'uncaught'); match se
  // compara con su mensaje.
  allow(type, match, reason = '') {
    this.allowances.push({ type, match: toMatcher(match), reason });
  }

  isAllowed(event) {
    return this.allowances.find((allowance) => {
      if (allowance.type !== event.type) return false;
      if (allowance.channel) return allowance.channel(event.channel) && allowance.code(event.code);
      return allowance.match(event.message);
    });
  }
}

module.exports = { TestContext, AbortTest, brief, toMatcher };
