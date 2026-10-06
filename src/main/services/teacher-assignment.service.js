const teacherAssignmentRepository = require('../repositories/teacher-assignment.repository');
const userRepository = require('../repositories/user.repository');
const courseRepository = require('../repositories/course.repository');
const subjectRepository = require('../repositories/subject.repository');
const profileImageService = require('./profile-image.service');
const { toListedCourse } = require('./course.service');

// Error previsto, con un mensaje apto para la UI (como CourseError en course.service.js).
// `fieldErrors` ({ campo: mensaje }), si llega, indica qué campos del formulario están mal.
class TeacherAssignmentError extends Error {
  constructor(code, message, fieldErrors) {
    super(message);
    this.name = 'TeacherAssignmentError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

// Valor de usuario_rol.nombre de quienes pueden tener asignaciones docentes.
const TEACHER_ROLE = 'PROFESOR';

// Lo que se muestra de un profesor, y su id para identificarlo. `imageUrl` es la URL de su foto
// (null si no tiene).
function toListedTeacher(teacher) {
  return {
    id: teacher.id,
    firstName: teacher.firstName,
    lastName: teacher.lastName,
    email: teacher.email,
    imageUrl: profileImageService.toImageUrl(teacher.imageFileName),
  };
}

// `id` es el materia_id: la misma materia tiene el mismo id en todos los grados donde se dicta.
function toListedSubject(subject) {
  return {
    id: subject.id,
    name: subject.name,
  };
}

// Lista explícita de campos, como toListedCourse (course.service.js): lo que muestran la tabla de
// Docencia y sus filtros, y los ids para identificar la fila, al profesor y a la materia. `course`
// trae los mismos campos que un curso de listCourses.
function toListedTeacherAssignment({ id, teacher, course, subject }) {
  return {
    id,
    teacher: toListedTeacher(teacher),
    course: toListedCourse(course),
    subject: toListedSubject(subject),
  };
}

// Asignaciones docentes vigentes de la institución de `currentUser` (el de la sesión), de todos los
// ciclos lectivos, en el orden del repositorio.
async function listTeacherAssignments(currentUser) {
  const teacherAssignments = await teacherAssignmentRepository.findByInstitution(currentUser.institutionId);
  return teacherAssignments.map(toListedTeacherAssignment);
}

// ---------- Alta: qué se puede asignar ----------

// Las asignaciones se crean para el ciclo lectivo del año en curso, el mismo que anuncia el
// formulario y el de un curso nuevo (createCourse, course.service.js).
function currentSchoolYear() {
  return new Date().getFullYear();
}

// Profesores de la institución que pueden recibir una asignación: los activos, sin los suspendidos
// ni los dados de baja.
function findAssignableTeachers(institutionId) {
  return userRepository.findActiveByRole(institutionId, TEACHER_ROLE);
}

// Cursos de la institución que pueden recibir una asignación: los vigentes del ciclo lectivo en
// curso.
function findAssignableCourses(institutionId) {
  return courseRepository.findByInstitution(institutionId, currentSchoolYear());
}

// El alta y las materias de un curso solo aceptan lo que ofrecen findAssignableTeachers y
// findAssignableCourses: los ids llegan del renderer y la lista que tiene a la vista puede haber
// quedado vieja (otra sesión suspendió al profesor o dio de baja el curso).
async function assertAssignableTeacher(institutionId, teacherId) {
  const teachers = await findAssignableTeachers(institutionId);
  if (!teachers.some((teacher) => teacher.id === teacherId)) {
    throw new TeacherAssignmentError('TEACHER_NOT_AVAILABLE', 'El profesor elegido ya no está disponible.');
  }
}

async function assertAssignableCourse(institutionId, courseId) {
  const courses = await findAssignableCourses(institutionId);
  if (!courses.some((course) => course.id === courseId)) {
    throw new TeacherAssignmentError('COURSE_NOT_AVAILABLE', 'El curso elegido ya no está disponible.');
  }
}

// Profesores que ofrece el formulario de alta: los activos de la institución de `currentUser`, por
// apellido y nombre.
async function listAssignableTeachers(currentUser) {
  const teachers = await findAssignableTeachers(currentUser.institutionId);
  return teachers.map(toListedTeacher);
}

// Cursos que ofrece el formulario de alta: los vigentes de la institución de `currentUser` en el
// ciclo lectivo en curso, con los campos y el orden de listCourses (course.service.js).
async function listAssignableCourses(currentUser) {
  const courses = await findAssignableCourses(currentUser.institutionId);
  return courses.map(toListedCourse);
}

// Materias que ofrece el formulario de alta para un curso: las del plan de estudios de su grado que
// todavía no tienen un profesor en él, por nombre. Lanza un TeacherAssignmentError
// COURSE_NOT_AVAILABLE si el curso no es uno de listAssignableCourses.
async function listAssignableSubjects(currentUser, courseId) {
  await assertAssignableCourse(currentUser.institutionId, courseId);
  const subjects = await subjectRepository.findUnassignedByCourse(courseId);
  return subjects.map(toListedSubject);
}

// Crea una asignación docente vigente y la devuelve con los campos de listTeacherAssignments.
// `data` trae teacherId (un profesor de listAssignableTeachers), courseId (un curso de
// listAssignableCourses) y subjectId (una materia del plan de estudios del grado de ese curso).
// Una materia la dicta un solo profesor en cada curso: si ya tiene uno, no se guarda nada y se
// lanza un TeacherAssignmentError DUPLICATE_VALUE con fieldErrors.subject. La regla la aplica el
// índice único de asignacion_docente al insertar, así que tampoco pasan dos altas simultáneas; una
// asignación dada de baja no cuenta.
// También lanza un TeacherAssignmentError si el profesor o el curso no se pueden elegir
// (TEACHER_NOT_AVAILABLE, COURSE_NOT_AVAILABLE) o si la materia no es del grado del curso
// (SUBJECT_NOT_IN_GRADE, con fieldErrors.subject).
async function createTeacherAssignment(currentUser, { teacherId, courseId, subjectId }) {
  const { institutionId } = currentUser;
  await assertAssignableTeacher(institutionId, teacherId);
  await assertAssignableCourse(institutionId, courseId);

  let teacherAssignment;
  try {
    teacherAssignment = await teacherAssignmentRepository.create({ teacherId, courseId, subjectId });
  } catch (error) {
    if (teacherAssignmentRepository.isDuplicateError(error)) {
      throw new TeacherAssignmentError('DUPLICATE_VALUE', 'La materia ya tiene un profesor asignado en ese curso.', {
        subject: 'Esta materia ya tiene un profesor asignado en el curso.',
      });
    }
    throw error;
  }
  if (!teacherAssignment) {
    throw new TeacherAssignmentError('SUBJECT_NOT_IN_GRADE', 'La materia no es del plan de estudios del curso.', {
      subject: 'Esta materia no es del plan de estudios del curso.',
    });
  }
  return toListedTeacherAssignment(teacherAssignment);
}

// ---------- Baja ----------

// Error de una baja que no encontró la asignación vigente: si existe en la institución es porque ya
// estaba dada de baja (TEACHER_ASSIGNMENT_ALREADY_DELETED); si no, TEACHER_ASSIGNMENT_NOT_FOUND.
async function notActiveError(teacherAssignmentId, institutionId) {
  if (await teacherAssignmentRepository.existsInInstitution(teacherAssignmentId, institutionId)) {
    return new TeacherAssignmentError('TEACHER_ASSIGNMENT_ALREADY_DELETED', 'La asignación ya había sido eliminada.');
  }
  return new TeacherAssignmentError('TEACHER_ASSIGNMENT_NOT_FOUND', 'La asignación ya no existe.');
}

// Baja lógica de una asignación docente de la institución de `currentUser`: la fila queda con su
// fecha de baja, deja de listarse y su materia vuelve a estar entre las de listAssignableSubjects
// para ese curso, así que se puede asignar a otro profesor. Se puede dar de baja cualquiera de las
// de listTeacherAssignments, también las de otro ciclo lectivo, las de un profesor suspendido y las
// de un curso dado de baja.
// Devuelve la asignación dada de baja, con los campos de listTeacherAssignments. Lanza un
// TeacherAssignmentError si no existe en la institución (TEACHER_ASSIGNMENT_NOT_FOUND) o si ya
// estaba dada de baja (TEACHER_ASSIGNMENT_ALREADY_DELETED).
async function deleteTeacherAssignment(currentUser, teacherAssignmentId) {
  const { institutionId } = currentUser;
  const deletedAssignment = await teacherAssignmentRepository.markAsDeleted(teacherAssignmentId, institutionId);
  if (deletedAssignment) return toListedTeacherAssignment(deletedAssignment);
  throw await notActiveError(teacherAssignmentId, institutionId);
}

module.exports = {
  listTeacherAssignments,
  listAssignableTeachers,
  listAssignableCourses,
  listAssignableSubjects,
  createTeacherAssignment,
  deleteTeacherAssignment,
  TeacherAssignmentError,
};
