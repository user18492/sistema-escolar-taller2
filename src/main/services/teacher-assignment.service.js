const teacherAssignmentRepository = require('../repositories/teacher-assignment.repository');
const profileImageService = require('./profile-image.service');

// Lista explícita de campos, como toListedCourse (course.service.js): lo que muestran la tabla de
// Docencia y sus filtros, y los ids para identificar la fila, al profesor y a la materia. `teacher`
// trae `imageUrl`, la URL de su foto (null si no tiene); `course`, los mismos campos que un curso
// de listCourses, y `subject.id` es el materia_id: la misma materia tiene el mismo id en todos los
// grados donde se dicta.
function toListedTeacherAssignment({ id, teacher, course, subject }) {
  return {
    id,
    teacher: {
      id: teacher.id,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: teacher.email,
      imageUrl: profileImageService.toImageUrl(teacher.imageFileName),
    },
    course: {
      id: course.id,
      gradeName: course.gradeName,
      educationLevel: course.educationLevel,
      division: course.division,
      shift: course.shift,
      schoolYear: course.schoolYear,
    },
    subject: {
      id: subject.id,
      name: subject.name,
    },
  };
}

// Asignaciones docentes vigentes de la institución de `currentUser` (el de la sesión), de todos los
// ciclos lectivos, en el orden del repositorio.
async function listTeacherAssignments(currentUser) {
  const teacherAssignments = await teacherAssignmentRepository.findByInstitution(currentUser.institutionId);
  return teacherAssignments.map(toListedTeacherAssignment);
}

module.exports = { listTeacherAssignments };
