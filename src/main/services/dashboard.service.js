const userRepository = require('../repositories/user.repository');
const courseRepository = require('../repositories/course.repository');
const teacherAssignmentRepository = require('../repositories/teacher-assignment.repository');

// Indicadores de la vista Inicio del Administrador para la institución de `currentUser` (el de la
// sesión):
//   - userCount: usuarios vigentes (activos y suspendidos, sin los dados de baja), con el propio
//     administrador.
//   - courseCount: cursos vigentes, de todos los ciclos lectivos (los que lista Cursos).
//   - teacherAssignmentCount: asignaciones docentes vigentes, de todos los ciclos lectivos (las que
//     lista Docencia).
//   - assignedTeacherCount: profesores distintos que tienen al menos una de esas asignaciones.
// Cada consulta corre por separado: un cambio hecho mientras tanto puede entrar en una y no en otra.
async function getAdminSummary(currentUser) {
  const { institutionId } = currentUser;
  const [userCount, courseCount, teacherAssignments] = await Promise.all([
    userRepository.countNotDeleted(institutionId),
    courseRepository.countByInstitution(institutionId),
    teacherAssignmentRepository.countByInstitution(institutionId),
  ]);
  return {
    userCount,
    courseCount,
    assignedTeacherCount: teacherAssignments.teacherTotal,
    teacherAssignmentCount: teacherAssignments.total,
  };
}

module.exports = { getAdminSummary };
