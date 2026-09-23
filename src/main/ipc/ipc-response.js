// Forma común de las respuestas IPC rechazadas: { ok: false, error: { code, message } },
// con el mensaje listo para mostrar en la interfaz. Con `fieldErrors` ({ campo: mensaje }), el
// error también indica qué campos del formulario marcar y con qué mensaje.
function failure(code, message, fieldErrors) {
  const error = { code, message };
  if (fieldErrors) error.fieldErrors = fieldErrors;
  return { ok: false, error };
}

module.exports = { failure };
