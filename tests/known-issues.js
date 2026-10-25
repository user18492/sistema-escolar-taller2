// Ruido conocido que aparece en muchas pruebas y que todavía no se corrigió: mensajes de consola,
// avisos, etc. Lo que coincide con una entrada no hace fallar la prueba en la que aparece; el
// informe lo cuenta aparte. Cada entrada tiene un motivo y una fecha de vencimiento: vencida, el
// evento vuelve a contar como falla. No sirve para tapar un error nuevo: un error propio de una
// prueba se declara en la prueba (t.allow...), con su motivo.
//
// type: el del evento que registra la suite (ver lib/monitor-events.js); source: 'main' o
// 'renderer'; match: RegExp sobre el mensaje.
module.exports = [
  {
    id: 'renderer-csp-warning',
    type: 'console',
    source: 'renderer',
    level: 'warning',
    match: /Electron Security Warning \(Insecure Content-Security-Policy\)/,
    reason: 'Las vistas no declaran una Content-Security-Policy (hallazgo previo, sin corregir: memoria login-e2e-findings). Electron lo avisa en cada vista mientras la app no está empaquetada.',
    until: '2026-12-31',
    ref: 'memoria: login-e2e-findings',
  },
  {
    id: 'modal-resize-observer-loop',
    type: 'console',
    source: 'renderer',
    match: /ResizeObserver loop completed with undelivered notifications/,
    reason: 'modal-resize.js deja este error cada vez que cambia el alto de un modal (problema previo, sin corregir: memoria form-validation-plan-status). Lo comprueba ui.known-bugs.modal-resize-console.',
    until: '2026-12-31',
    ref: 'memoria: form-validation-plan-status',
  },
];
