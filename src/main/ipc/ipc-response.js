// Forma común de las respuestas IPC rechazadas: { ok: false, error: { code, message } },
// con el mensaje listo para mostrar en la interfaz.
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

module.exports = { failure };
