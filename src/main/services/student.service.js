const studentRepository = require('../repositories/student.repository');
const { toIsoDate } = require('./user.service');

// Lista explícita de campos, como toListedUser (user.service.js): lo que muestran la tabla de
// Alumnos del Secretario, sus filtros y el modal de edición, y el id para identificar la fila. `dni`
// son solo los dígitos, `phone` el teléfono tal como se guarda, `street` y `streetNumber` la calle y
// la altura de la dirección, `birthDate` el día de nacimiento ('AAAA-MM-DD') y `status` ACTIVE o
// GRADUATED. Las vistas del Profesor muestran menos datos del alumno: ver toListedStudent
// (enrollment.service.js).
function toListedStudent(student) {
  return {
    id: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    dni: student.dni,
    email: student.email,
    phone: student.phone,
    street: student.street,
    streetNumber: student.streetNumber,
    birthDate: toIsoDate(student.birthDate),
    status: student.status,
  };
}

// Alumnos de la institución de `currentUser` (el de la sesión), activos y egresados, en el orden
// del repositorio.
async function listStudents(currentUser) {
  const students = await studentRepository.findByInstitution(currentUser.institutionId);
  return students.map(toListedStudent);
}

module.exports = { listStudents };
