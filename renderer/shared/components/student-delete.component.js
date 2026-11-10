// Componente global: baja de un alumno (Alumnos del Secretario y su reporte Alumnos activos sin
// inscripción), la que se confirma en el modal "Eliminar alumno" (<confirm-modal entity="Student">,
// confirm-modal.component.js). Pide la baja lógica (window.api.students.delete): el alumno deja de
// estar vigente y su inscripción activa, si tiene, pasa a cancelada. El resultado se avisa con un
// toast (toast.component.js).
// Uso: onConfirm del modal llama a deleteStudent(student, { onDeleted, onGone }) y devuelve su
// promesa, que no resuelve ningún mensaje: así el modal la espera abierto y después se cierra.
//   - student: el alumno cargado de la base ({ id, firstName, lastName }), que nombra el toast.
//   - onDeleted(response): se dio de baja; la vista actualiza su tabla antes del toast de éxito.
//   - onGone(code): el alumno ya no estaba vigente (NO_LONGER_ACTIVE_CODES: otra sesión lo dio de
//     baja): los datos de la vista quedaron viejos y los vuelve a pedir antes del toast de error.
//   Si devuelven una promesa, se espera antes del toast.
// El modal se declara igual en cada vista que lo usa:
//   <confirm-modal entity="Student" heading="Eliminar alumno" description="¿Quieres eliminar este
//   alumno?" consequence="Si tiene una inscripción activa, se cancelará."></confirm-modal>

(() => {
  // El alumno ya no está vigente
  const NO_LONGER_ACTIVE_CODES = ['STUDENT_NOT_FOUND', 'STUDENT_ALREADY_DELETED'];

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  window.deleteStudent = async (student, { onDeleted, onGone } = {}) => {
    let response;
    try {
      response = await window.api?.students?.delete(Number(student.id));
    } catch (error) {
      console.error('Error al eliminar el alumno:', error);
    }
    if (response?.ok) {
      await onDeleted?.(response);
      // La base admite una sola inscripción activa por alumno
      const cancelledText = response.cancelledEnrollmentCount > 0 ? ' y se canceló su inscripción activa' : '';
      showToast({
        type: 'success',
        title: 'Alumno eliminado',
        description: `Se eliminó a ${student.firstName} ${student.lastName}${cancelledText}.`,
      });
      return;
    }
    if (NO_LONGER_ACTIVE_CODES.includes(response?.error?.code)) await onGone?.(response.error.code);
    showToast({ type: 'error', title: 'No se pudo eliminar el alumno', description: errorDescription(response?.error) });
  };
})();
