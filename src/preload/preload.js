const { contextBridge, ipcRenderer } = require('electron');

// Se exponen acciones concretas, sin dar acceso directo al IPC desde la UI.
contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => {
      const handler = (_event, maximized) => callback(maximized);
      ipcRenderer.on('window:maximized-change', handler);
      return () => ipcRenderer.removeListener('window:maximized-change', handler);
    },
  },
  auth: {
    // Resuelve { ok: true, user } con la sesión iniciada o { ok: false, error: { code, message } }, con el
    // mensaje listo para mostrar. Si las credenciales permiten ingresar con varias cuentas (en varias
    // instituciones, o con varios roles en una misma), resuelve { ok: true, institutions }
    // ([{ id, name, role }], una por cuenta: la misma institución se repite si el usuario tiene en ella
    // más de un rol) y la sesión se inicia con selectInstitution.
    // Con un acceso exitoso, `rememberAccount` guarda el email para el próximo inicio o lo olvida.
    login: (email, password, rememberAccount) => ipcRenderer.invoke('auth:login', { email, password, rememberAccount }),
    // Completa el login con la cuenta elegida: el id y el rol de una de `institutions`. Resuelve como
    // login: { ok: true, user } o { ok: false, error: { code, message } }; NO_PENDING_LOGIN indica que hay
    // que volver a ingresar las credenciales.
    selectInstitution: (institutionId, role, rememberAccount) => ipcRenderer.invoke('auth:select-institution', { institutionId, role, rememberAccount }),
    // Resuelve { firstName, lastName, role, imageUrl, institutionName }, o null si no hay sesión iniciada.
    getCurrentUser: () => ipcRenderer.invoke('auth:get-current-user'),
    // También descarta un login que quedó a la espera de elegir la institución.
    logout: () => ipcRenderer.invoke('auth:logout'),
    // Resuelve el email recordado, o null si no hay ninguno.
    getRememberedEmail: () => ipcRenderer.invoke('auth:get-remembered-email'),
    forgetRememberedEmail: () => ipcRenderer.invoke('auth:forget-remembered-email'),
  },
  // Si la cuenta de la sesión fue suspendida o dada de baja, las operaciones de profile, de users, de
  // courses, de grades, de teacherAssignments, de students, de enrollments, de evaluations, de scores
  // y de dashboard resuelven { ok: false, error: { code: 'ACCOUNT_SUSPENDED', message } } y el
  // proceso principal cierra la sesión y vuelve al login.
  profile: {
    // Cualquier rol. Resuelve { ok: true, profile } con los datos del usuario de la sesión, leídos de
    // la base ({ firstName, lastName, dni, email, birthDate, imageUrl }, con dni solo los dígitos,
    // birthDate 'AAAA-MM-DD' o null e imageUrl la URL de su foto, profile-image://avatars/<archivo>, o
    // null), o { ok: false, error: { code, message } }.
    get: () => ipcRenderer.invoke('profile:get'),
    // Cualquier rol. Guarda los datos del usuario de la sesión, sin cambiar su rol ni su estado.
    // `data` es { firstName, lastName, dni, email, birthDate, newPassword, repeatPassword, image,
    // removeImage }, con birthDate 'AAAA-MM-DD' y con image y removeImage como en users.update.
    // newPassword y repeatPassword viajan en texto plano, tal cual se escribieron: vacíos los dos
    // conservan la contraseña actual; si no, tienen que coincidir y el proceso principal guarda solo
    // el hash. Resuelve { ok: true, profile } con los datos como quedaron (mismos campos que get), y
    // getCurrentUser pasa a informar el nombre, el apellido y la foto nuevos, o
    // { ok: false, error: { code, message, fieldErrors } }: fieldErrors ({ campo: mensaje }, con los
    // nombres de `data`) llega con DUPLICATE_VALUE (dni o email de otro usuario vigente con su mismo
    // rol) y con los campos inválidos, también los de la contraseña; una foto inválida da
    // INVALID_INPUT sin fieldErrors.
    update: (data) => ipcRenderer.invoke('profile:update', data),
    // Cualquier rol. Baja lógica de la cuenta del usuario de la sesión, que queda además suspendida:
    // no puede volver a ingresar hasta que un administrador la restaure (users.restore). Resuelve
    // { ok: true } con la sesión ya cerrada (getCurrentUser pasa a informar null) o
    // { ok: false, error: { code, message } }, sin cambiar nada: LAST_ADMIN indica que es el único
    // administrador activo y vigente de su institución, que no se puede dar de baja, y
    // USER_HAS_TEACHER_ASSIGNMENTS, que tiene asignaciones docentes vigentes.
    delete: () => ipcRenderer.invoke('profile:delete'),
  },
  users: {
    // Solo ADMIN. Resuelve { ok: true, users } con los demás usuarios de su institución, vigentes y dados de
    // baja, ordenados por apellido y nombre ({ id, firstName, lastName, dni, email, birthDate, isActive, role,
    // imageUrl, deletedAt }, con birthDate 'AAAA-MM-DD' o null, imageUrl la URL de su foto,
    // profile-image://avatars/<archivo>, o null, y deletedAt el instante de su baja en ISO 8601, o null si
    // está vigente), o { ok: false, error: { code, message } }.
    list: () => ipcRenderer.invoke('users:list'),
    // Solo ADMIN. Crea un usuario en su institución, siempre activo. `data` tiene los campos de update
    // sin isActive, con role ('ADMIN', 'SECRETARIO' o 'PROFESOR', que la cuenta conserva: no se cambia
    // después) y con password obligatoria: viaja en texto plano y el proceso principal guarda solo su
    // hash. `image` null lo crea sin foto y `removeImage` no quita nada (no puede ser true junto con
    // image). Resuelve { ok: true, user } con el usuario creado (mismos campos que list) o
    // { ok: false, error: { code, message, fieldErrors } }, como update: DUPLICATE_VALUE indica un dni
    // o un email de otro usuario vigente con ese rol, y DELETED_USER_EXISTS (sin fieldErrors), que hay
    // una cuenta dada de baja con ese dni y ese rol: en lugar de crear otra, hay que restaurarla.
    create: (data) => ipcRenderer.invoke('users:create', data),
    // Solo ADMIN. Guarda los datos del usuario con ese id (usuario_id) de su institución, sin cambiar
    // su rol. `data` es { firstName, lastName, dni, email, birthDate, isActive, password, image,
    // removeImage }, con birthDate 'AAAA-MM-DD', isActive false para suspenderlo (sigue en el listado,
    // pero no puede iniciar sesión) y password null para conservar la actual. `image` es el recorte de
    // una foto nueva (Uint8Array con un PNG de 512 × 512), o null para no cambiarla; `removeImage` true
    // quita la foto actual y no puede venir junto con image. Resuelve { ok: true, user } con el usuario
    // como quedó (mismos campos que list) o { ok: false, error: { code, message, fieldErrors } }:
    // fieldErrors ({ campo: mensaje }) llega con DUPLICATE_VALUE (dni o email de otro usuario vigente
    // con su mismo rol) y con los campos inválidos; una foto inválida da INVALID_INPUT sin fieldErrors,
    // USER_NOT_FOUND indica que ya no está vigente y LAST_ADMIN, que es el único administrador activo y
    // vigente de la institución, que no se puede suspender.
    update: (userId, data) => ipcRenderer.invoke('users:update', userId, data),
    // Solo ADMIN. Baja lógica del usuario con ese id (usuario_id) de su institución, que queda además
    // suspendido. Resuelve { ok: true, user } con el usuario como quedó (mismos campos que list, con su
    // deletedAt) o { ok: false, error: { code, message } }; USER_NOT_FOUND y USER_ALREADY_DELETED indican
    // que ya no está vigente, USER_HAS_TEACHER_ASSIGNMENTS, que tiene asignaciones docentes vigentes
    // (hay que reasignarlas o darlas de baja antes), y LAST_ADMIN, que es el único administrador activo
    // y vigente de la institución.
    delete: (userId) => ipcRenderer.invoke('users:delete', userId),
    // Solo ADMIN. Restaura al usuario dado de baja con ese id (usuario_id) de su institución: vuelve a
    // estar vigente y queda activo, con la contraseña que tenía. Resuelve { ok: true, user } con el
    // usuario como quedó (mismos campos que list, con deletedAt null) o
    // { ok: false, error: { code, message } }; USER_NOT_FOUND y USER_NOT_DELETED indican que ya no está
    // dado de baja, y DUPLICATE_VALUE, que ya hay un usuario vigente con su dni o su email y su mismo
    // rol.
    restore: (userId) => ipcRenderer.invoke('users:restore', userId),
  },
  courses: {
    // Solo ADMIN. Resuelve { ok: true, courses } con los cursos vigentes de su institución (sin los dados
    // de baja), de todos los ciclos lectivos ({ id, gradeName, educationLevel, division, shift,
    // schoolYear }, con gradeName el nombre del grado, 1° a 6°, educationLevel 'PRIMARY' o 'SECONDARY',
    // division una letra mayúscula, shift 'MORNING' o 'AFTERNOON' y schoolYear el año del ciclo lectivo),
    // o { ok: false, error: { code, message } }. Llegan siempre en el mismo orden: ciclo lectivo (el más
    // reciente primero), nivel educativo (primaria antes que secundaria), grado, división y turno.
    list: () => ipcRenderer.invoke('courses:list'),
    // Solo ADMIN. Crea un curso en su institución, para el ciclo lectivo del año en curso. `data` es
    // { gradeId, division, shift }, con gradeId el id de un grado de grades.list (define también el
    // nivel educativo), division una letra (se guarda en mayúscula) y shift 'MORNING' o 'AFTERNOON'.
    // Resuelve { ok: true, course } con el curso creado (mismos campos que list) o
    // { ok: false, error: { code, message, fieldErrors } }: fieldErrors ({ campo: mensaje }) llega si
    // la división no es válida, DUPLICATE_VALUE indica que la institución ya tiene ese curso vigente
    // en el ciclo lectivo y GRADE_NOT_FOUND, que el grado no está en el catálogo.
    create: (data) => ipcRenderer.invoke('courses:create', data),
    // Solo ADMIN. Guarda el grado, la división y el turno del curso vigente con ese id (curso_id) de su
    // institución; el ciclo lectivo no cambia. `data` es { gradeId, division, shift }, como en create.
    // Resuelve { ok: true, course } con el curso como quedó (mismos campos que list) o
    // { ok: false, error: { code, message, fieldErrors } }: fieldErrors llega si la división no es
    // válida, DUPLICATE_VALUE indica que la institución ya tiene otro curso vigente igual en ese ciclo
    // lectivo, GRADE_NOT_FOUND, que el grado no está en el catálogo, y COURSE_NOT_FOUND y
    // COURSE_ALREADY_DELETED, que el curso ya no está vigente.
    update: (courseId, data) => ipcRenderer.invoke('courses:update', courseId, data),
    // Solo ADMIN. Baja lógica del curso con ese id (curso_id) de su institución: deja de listarse y su
    // grado, división y turno se pueden volver a crear en ese ciclo lectivo. Resuelve
    // { ok: true, course } con el curso dado de baja (mismos campos que list) o
    // { ok: false, error: { code, message } }; COURSE_NOT_FOUND y COURSE_ALREADY_DELETED indican que ya
    // no está vigente.
    delete: (courseId) => ipcRenderer.invoke('courses:delete', courseId),
  },
  grades: {
    // Solo ADMIN. Resuelve { ok: true, grades } con el catálogo de grados, común a todas las
    // instituciones ({ id, name, educationLevel }, con name el nombre del grado, 1° a 6°, que se repite
    // entre niveles, y educationLevel 'PRIMARY' o 'SECONDARY'), o { ok: false, error: { code, message } }.
    // Llegan siempre en el mismo orden: nivel educativo (primaria antes que secundaria) y grado.
    list: () => ipcRenderer.invoke('grades:list'),
  },
  teacherAssignments: {
    // Solo ADMIN. Resuelve { ok: true, teacherAssignments } con las asignaciones docentes vigentes de su
    // institución (sin las dadas de baja), de todos los ciclos lectivos ({ id, teacher, course, subject },
    // con teacher { id, firstName, lastName, email, imageUrl }, el profesor, e imageUrl la URL de su foto,
    // profile-image://avatars/<archivo>, o null; course { id, gradeName, educationLevel, division, shift,
    // schoolYear }, con los mismos valores que en courses.list, y subject { id, name }, la materia), o
    // { ok: false, error: { code, message } }. Llegan siempre en el mismo orden: ciclo lectivo (el más
    // reciente primero), profesor (por apellido y nombre), curso (nivel educativo, grado, división y
    // turno) y materia.
    list: () => ipcRenderer.invoke('teacher-assignments:list'),
    // Solo PROFESOR. Resuelve { ok: true, teacherAssignments } con las asignaciones docentes vigentes a
    // su cargo (sin las dadas de baja ni las de otros profesores), de todos los ciclos lectivos
    // ({ id, course, subject }, con course y subject como en list; el profesor no viaja: es el de la
    // sesión), o { ok: false, error: { code, message } }. Llegan siempre en el mismo orden: ciclo
    // lectivo (el más reciente primero), curso (nivel educativo, grado, división y turno) y materia.
    listOwn: () => ipcRenderer.invoke('teacher-assignments:list-own'),
    // Solo PROFESOR. Resuelve { ok: true, teacherAssignment } con la asignación docente vigente con ese
    // id (asignacion_docente_id), si está a su cargo ({ id, course, subject }, como en listOwn), o
    // { ok: false, error: { code, message } }: TEACHER_ASSIGNMENT_NOT_FOUND indica que no existe, que
    // fue dada de baja o que es de otro profesor, sin distinguir entre esos casos.
    getOwn: (teacherAssignmentId) => ipcRenderer.invoke('teacher-assignments:get-own', teacherAssignmentId),
    // Solo ADMIN. Lo que ofrece el formulario de alta en Profesor: resuelve { ok: true, teachers } con
    // los profesores activos de su institución (sin los suspendidos ni los dados de baja), por apellido
    // y nombre ({ id, firstName, lastName, email, imageUrl }, como teacher en list), o
    // { ok: false, error: { code, message } }.
    listAssignableTeachers: () => ipcRenderer.invoke('teacher-assignments:list-assignable-teachers'),
    // Solo ADMIN. Lo que ofrece el formulario de alta en Curso: resuelve { ok: true, courses } con los
    // cursos vigentes de su institución en el ciclo lectivo del año en curso (mismos campos y orden que
    // courses.list), o { ok: false, error: { code, message } }.
    listAssignableCourses: () => ipcRenderer.invoke('teacher-assignments:list-assignable-courses'),
    // Solo ADMIN. Lo que ofrece el formulario en Materia para el curso con ese id (uno de
    // listAssignableCourses): resuelve { ok: true, subjects } con las materias del plan de estudios de
    // su grado que todavía no tienen un profesor en ese curso, por nombre ({ id, name }, como subject en
    // list; vacía si ya están todas asignadas), o { ok: false, error: { code, message } }:
    // COURSE_NOT_AVAILABLE indica que el curso ya no se puede elegir. Al editar, `teacherAssignmentId`
    // es el id de la asignación: su materia sigue entre las de su curso, que se acepta aunque no sea
    // uno de listAssignableCourses; TEACHER_ASSIGNMENT_NOT_FOUND y TEACHER_ASSIGNMENT_ALREADY_DELETED
    // indican que esa asignación ya no está vigente.
    listAssignableSubjects: (courseId, teacherAssignmentId = null) =>
      ipcRenderer.invoke('teacher-assignments:list-assignable-subjects', courseId, teacherAssignmentId),
    // Solo ADMIN. Crea una asignación docente vigente. `data` es { teacherId, courseId, subjectId }: los
    // ids de un profesor de listAssignableTeachers, de un curso de listAssignableCourses y de una materia
    // de listAssignableSubjects para ese curso. Resuelve { ok: true, teacherAssignment } con la
    // asignación creada (mismos campos que list) o { ok: false, error: { code, message, fieldErrors } },
    // sin guardar nada: DUPLICATE_VALUE indica que la materia ya tiene un profesor en ese curso y
    // SUBJECT_NOT_IN_GRADE, que no es de su plan de estudios (los dos traen fieldErrors.subject, el
    // mensaje para el campo Materia); TEACHER_NOT_AVAILABLE y COURSE_NOT_AVAILABLE, que el profesor o el
    // curso ya no se pueden elegir.
    create: (data) => ipcRenderer.invoke('teacher-assignments:create', data),
    // Solo ADMIN. Guarda el profesor, el curso y la materia de la asignación docente vigente con ese id
    // (asignacion_docente_id) de su institución. `data` es { teacherId, courseId, subjectId }, como en
    // create; el profesor y el curso que la asignación ya tiene se pueden conservar aunque no estén en
    // listAssignableTeachers ni en listAssignableCourses, y la materia es una de listAssignableSubjects
    // para ese curso y esa asignación. Resuelve { ok: true, teacherAssignment } con la asignación como
    // quedó (mismos campos que list) o { ok: false, error: { code, message, fieldErrors } }, sin
    // guardar nada, con los códigos de create: DUPLICATE_VALUE indica que la materia ya tiene un
    // profesor en ese curso con otra asignación (guardarla sin cambios no es un duplicado). Además,
    // TEACHER_ASSIGNMENT_NOT_FOUND y TEACHER_ASSIGNMENT_ALREADY_DELETED indican que ya no está vigente.
    update: (teacherAssignmentId, data) => ipcRenderer.invoke('teacher-assignments:update', teacherAssignmentId, data),
    // Solo ADMIN. Baja lógica de la asignación docente con ese id (asignacion_docente_id) de su
    // institución: deja de listarse y su materia vuelve a estar entre las de listAssignableSubjects
    // para ese curso. Resuelve { ok: true, teacherAssignment } con la asignación dada de baja (mismos
    // campos que list) o { ok: false, error: { code, message } }; TEACHER_ASSIGNMENT_NOT_FOUND y
    // TEACHER_ASSIGNMENT_ALREADY_DELETED indican que ya no está vigente.
    delete: (teacherAssignmentId) => ipcRenderer.invoke('teacher-assignments:delete', teacherAssignmentId),
  },
  students: {
    // Solo SECRETARIO. Resuelve { ok: true, students } con los alumnos de su institución, vigentes y
    // dados de baja, activos y egresados ({ id, firstName, lastName, dni, email, phone, street,
    // streetNumber, birthDate, status, deletedAt }, con dni y phone solo los dígitos, street y
    // streetNumber la calle y la altura de la dirección, birthDate 'AAAA-MM-DD', status 'ACTIVE' o
    // 'GRADUATED' y deletedAt el instante de su baja en ISO 8601, o null si está vigente), o
    // { ok: false, error: { code, message } }.
    // Llegan siempre en el mismo orden: por apellido y nombre.
    list: () => ipcRenderer.invoke('students:list'),
    // Solo SECRETARIO. Registra un alumno en su institución, siempre activo: el estado no se elige en
    // el alta. `data` es { firstName, lastName, dni, email, phone, street, streetNumber, birthDate },
    // con dni y phone solo los dígitos (un phone con otro carácter se rechaza), street y streetNumber
    // la calle y la altura de la dirección y birthDate 'AAAA-MM-DD'. Resuelve { ok: true, student }
    // con el alumno creado (mismos campos que list) o { ok: false, error: { code, message,
    // fieldErrors } }, sin crear nada: fieldErrors ({ campo: mensaje }) llega con INVALID_INPUT (campos
    // inválidos) y con DUPLICATE_VALUE (dni o email de otro alumno vigente de la institución), y
    // DELETED_STUDENT_EXISTS (sin fieldErrors) indica que son de un alumno dado de baja: en lugar de
    // registrarlo otra vez, hay que restaurarlo desde Eliminados; el mensaje lo nombra.
    create: (data) => ipcRenderer.invoke('students:create', data),
    // Solo SECRETARIO. Guarda los cambios del alumno vigente con ese id (alumno_id) de su
    // institución. `data` trae los mismos campos que create y además status ('ACTIVE' o
    // 'GRADUATED'). Resuelve { ok: true, student } con el alumno como quedó (mismos campos que list)
    // o { ok: false, error: { code, message, fieldErrors } }, sin guardar nada, con los códigos de
    // create: DUPLICATE_VALUE indica que el dni o el email son de otro alumno de la institución
    // (conservar los suyos no es un duplicado), e INVALID_INPUT llega sin fieldErrors si el estado no
    // es válido. Además, STUDENT_NOT_FOUND indica que el alumno ya no está vigente.
    update: (studentId, data) => ipcRenderer.invoke('students:update', studentId, data),
    // Solo SECRETARIO. Baja lógica del alumno vigente con ese id (alumno_id) de su institución: se
    // lista entre los dados de baja y sus inscripciones activas pasan a canceladas, sin darse de
    // baja, todo o nada.
    // Resuelve { ok: true, cancelledEnrollmentCount }, con cuántas inscripciones activas se
    // cancelaron (0 o 1), o { ok: false, error: { code, message } }, sin cambiar nada;
    // STUDENT_NOT_FOUND y STUDENT_ALREADY_DELETED indican que ya no está vigente.
    delete: (studentId) => ipcRenderer.invoke('students:delete', studentId),
    // Solo SECRETARIO. Restaura al alumno dado de baja con ese id (alumno_id) de su institución:
    // vuelve a listarse entre los vigentes, con el estado que tenía, y sus inscripciones no cambian
    // (las que la baja canceló siguen canceladas). Resuelve { ok: true, student } con el alumno como
    // quedó (mismos campos que list, con deletedAt null) o { ok: false, error: { code, message } },
    // sin cambiar nada: STUDENT_NOT_FOUND indica que no existe en la institución,
    // STUDENT_NOT_DELETED, que ya estaba vigente, y DUPLICATE_VALUE (sin fieldErrors), que otro
    // alumno vigente de la institución ya tiene su dni o su email; el mensaje dice cuál.
    restore: (studentId) => ipcRenderer.invoke('students:restore', studentId),
  },
  enrollments: {
    // Solo SECRETARIO. Resuelve { ok: true, enrollments, total, page } con la página `page` (1 la
    // primera; de `pageSize` inscripciones, hasta 100) de las inscripciones vigentes de su
    // institución (sin las dadas de baja), de todos los ciclos lectivos, que pasan `filters`; filtrar
    // y paginar se hace sobre todas, en el proceso principal. `filters` es { enrollmentIds,
    // studentIds, grades, divisions, shifts, statuses }, cada uno un arreglo, vacío si no filtra:
    // ids de inscripciones y de alumnos (de listFilterOptions), grados { educationLevel, gradeName }
    // ('PRIMARY' o 'SECONDARY' y el nombre del grado, 1° a 6°), divisiones (letras mayúsculas),
    // turnos ('MORNING' o 'AFTERNOON') y estados ('ACTIVE', 'COMPLETED' o 'CANCELLED'). Una
    // inscripción pasa un filtro si coincide con alguno de sus valores, y tiene que pasarlos todos.
    // Cada inscripción es { id, number, enrollmentDate, status, student, course }, con number y
    // enrollmentDate como en listByOwnAssignment, status uno de los estados, student
    // { firstName, lastName } y course como en courses.list. `total` es cuántas pasan los filtros y
    // `page`, la página devuelta: si la pedida ya no existe, la última (con ninguna, la 1). Llegan
    // siempre en el mismo orden: por alumno (apellido y nombre). Resuelve
    // { ok: false, error: { code, message } } si no: INVALID_INPUT indica filtros o página inválidos.
    list: (filters, page, pageSize) => ipcRenderer.invoke('enrollments:list', filters, page, pageSize),
    // Solo SECRETARIO. Las opciones de los filtros Número de inscripción y Alumno: resuelve
    // { ok: true, enrollments, students } con todas las inscripciones vigentes de su institución,
    // sin filtrar ({ id, number, student }, con number como en list y student { firstName,
    // lastName }), y sus alumnos, una vez cada uno ({ id, firstName, lastName, email }), las dos
    // listas en el orden de list, o { ok: false, error: { code, message } }.
    listFilterOptions: () => ipcRenderer.invoke('enrollments:list-filter-options'),
    // Solo PROFESOR. Resuelve { ok: true, enrollments } con las inscripciones del curso de la
    // asignación docente vigente con ese id (asignacion_docente_id), si está a su cargo: las activas
    // y las finalizadas del curso, sin las canceladas ({ id, number, enrollmentDate, student }, con
    // number el número de inscripción, 'INS-' y el id con al menos seis dígitos, INS-000012;
    // enrollmentDate el día de la inscripción, 'AAAA-MM-DD', y student { firstName, lastName, dni },
    // el alumno, con dni solo los dígitos), o { ok: false, error: { code, message } }:
    // TEACHER_ASSIGNMENT_NOT_FOUND indica que la asignación no existe, que fue dada de baja o que es
    // de otro profesor, sin distinguir entre esos casos. Llegan siempre en el mismo orden: por
    // alumno (apellido y nombre).
    listByOwnAssignment: (teacherAssignmentId) =>
      ipcRenderer.invoke('enrollments:list-by-own-assignment', teacherAssignmentId),
  },
  evaluations: {
    // Solo PROFESOR. Resuelve { ok: true, evaluations } con las evaluaciones vigentes (sin las dadas
    // de baja) de la asignación docente vigente con ese id (asignacion_docente_id), si está a su
    // cargo ({ id, title, evaluationDate }, con evaluationDate el día de la evaluación,
    // 'AAAA-MM-DD'), o { ok: false, error: { code, message } }: TEACHER_ASSIGNMENT_NOT_FOUND indica
    // que la asignación no existe, que fue dada de baja o que es de otro profesor, sin distinguir
    // entre esos casos. Llegan siempre en el mismo orden: por fecha (la más antigua primero) y
    // título.
    listByOwnAssignment: (teacherAssignmentId) =>
      ipcRenderer.invoke('evaluations:list-by-own-assignment', teacherAssignmentId),
    // Solo PROFESOR. Crea una evaluación vigente en la asignación docente vigente con ese id
    // (asignacion_docente_id), si está a su cargo. `data` es { title, evaluationDate }, con
    // evaluationDate el día de la evaluación, 'AAAA-MM-DD'. Resuelve { ok: true, evaluation } con la
    // evaluación creada (mismos campos que listByOwnAssignment) o
    // { ok: false, error: { code, message, fieldErrors } }, sin guardar nada: fieldErrors
    // ({ campo: mensaje }, con los nombres de `data`) llega con INVALID_INPUT si el título está
    // vacío o no tiene letras ni números, o si la fecha no existe en el calendario o no es del
    // ciclo lectivo de la asignación, y con DUPLICATE_VALUE (la asignación ya tiene una evaluación
    // vigente con ese título, en fieldErrors.title); TEACHER_ASSIGNMENT_NOT_FOUND, como en
    // listByOwnAssignment.
    create: (teacherAssignmentId, data) => ipcRenderer.invoke('evaluations:create', teacherAssignmentId, data),
    // Solo PROFESOR. Guarda el título y la fecha de la evaluación vigente con ese id
    // (evaluacion_id), si es de la asignación docente vigente con ese id (asignacion_docente_id) y
    // esa asignación está a su cargo; la evaluación conserva su asignación. `data` es
    // { title, evaluationDate }, como en create, y se valida igual. Resuelve
    // { ok: true, evaluation } con la evaluación como quedó (mismos campos que listByOwnAssignment)
    // o { ok: false, error: { code, message, fieldErrors } }, sin guardar nada: fieldErrors llega
    // con INVALID_INPUT, como en create, y con DUPLICATE_VALUE (la asignación ya tiene otra
    // evaluación vigente con ese título, en fieldErrors.title; guardarla sin cambios no es un
    // duplicado); TEACHER_ASSIGNMENT_NOT_FOUND, como en listByOwnAssignment, y EVALUATION_NOT_FOUND
    // indica que la evaluación no existe, que fue dada de baja o que es de otra asignación, sin
    // distinguir entre esos casos.
    update: (teacherAssignmentId, evaluationId, data) =>
      ipcRenderer.invoke('evaluations:update', teacherAssignmentId, evaluationId, data),
    // Solo PROFESOR. Baja lógica de la evaluación vigente con ese id (evaluacion_id), si es de la
    // asignación docente vigente con ese id (asignacion_docente_id) y esa asignación está a su
    // cargo: deja de listarse en listByOwnAssignment y su título se puede volver a usar en la
    // asignación; sus calificaciones se conservan sin cambios. Resuelve { ok: true, evaluation }
    // con la evaluación dada de baja (mismos campos que listByOwnAssignment) o
    // { ok: false, error: { code, message } }, sin modificar nada: TEACHER_ASSIGNMENT_NOT_FOUND,
    // como en listByOwnAssignment, y EVALUATION_NOT_FOUND indica que la evaluación no existe, que
    // ya estaba dada de baja o que es de otra asignación, sin distinguir entre esos casos.
    delete: (teacherAssignmentId, evaluationId) =>
      ipcRenderer.invoke('evaluations:delete', teacherAssignmentId, evaluationId),
  },
  scores: {
    // Solo PROFESOR. Resuelve { ok: true, evaluation, scores } con la evaluación vigente con ese id
    // (evaluacion_id), si es de la asignación docente vigente con ese id (asignacion_docente_id) y
    // esa asignación está a su cargo ({ id, title, evaluationDate }, como en
    // evaluations.listByOwnAssignment), y con sus calificaciones: una por cada inscripción del
    // curso de la asignación, activa o finalizada (sin las canceladas), tenga o no una nota cargada
    // ({ enrollmentId, student, value, isEnrollmentActive }, con enrollmentId el id de la
    // inscripción, que identifica la fila; student { firstName, lastName, dni }, el alumno, con dni
    // solo los dígitos; value la nota, un número de 0 a 10 con hasta dos decimales, o null si
    // todavía no fue calificado o su calificación se dio de baja, e isEnrollmentActive false si la
    // inscripción está finalizada: su nota es de solo lectura, no se puede cargar, corregir ni dar
    // de baja), o
    // { ok: false, error: { code, message } }:
    // TEACHER_ASSIGNMENT_NOT_FOUND indica que la asignación no existe, que fue dada de baja o que
    // es de otro profesor, y EVALUATION_NOT_FOUND, que la evaluación no existe, que fue dada de
    // baja o que es de otra asignación, sin distinguir entre esos casos. Llegan siempre en el mismo
    // orden: por alumno (apellido y nombre), como enrollments.listByOwnAssignment.
    listByOwnEvaluation: (teacherAssignmentId, evaluationId) =>
      ipcRenderer.invoke('scores:list-by-own-evaluation', teacherAssignmentId, evaluationId),
    // Solo PROFESOR. Guarda la nota de un alumno en esa evaluación de esa asignación (los mismos ids
    // que en listByOwnEvaluation). `data` es { enrollmentId, value }: el id de la inscripción del
    // alumno (una de listByOwnEvaluation, activa) y la nota, un número de 0 a 10 con hasta dos
    // decimales. Si el alumno no tenía nota en la evaluación (todavía no fue calificado o su
    // calificación se dio de baja) se crea su calificación; si ya tenía, se modifica esa misma.
    // Resuelve { ok: true, score } con la nota como quedó guardada
    // ({ enrollmentId, value }) o { ok: false, error: { code, message } }, sin guardar nada:
    // INVALID_SCORE indica que la nota no es un número de 0 a 10 con hasta dos decimales;
    // ENROLLMENT_NOT_FOUND, que la inscripción no existe o no es del curso de la asignación, y
    // ENROLLMENT_NOT_ACTIVE, que fue finalizada o cancelada; además,
    // TEACHER_ASSIGNMENT_NOT_FOUND y EVALUATION_NOT_FOUND, como en listByOwnEvaluation.
    save: (teacherAssignmentId, evaluationId, data) =>
      ipcRenderer.invoke('scores:save', teacherAssignmentId, evaluationId, data),
    // Solo PROFESOR. Baja lógica de la calificación de un alumno en esa evaluación de esa asignación
    // (los mismos ids que en listByOwnEvaluation). `enrollmentId` es el id de la inscripción del
    // alumno (una de listByOwnEvaluation, activa y con nota). El alumno sigue en
    // listByOwnEvaluation, con value null, y se le puede cargar otra nota con save. Resuelve
    // { ok: true, score } con la calificación del alumno como quedó ({ enrollmentId, value: null })
    // o { ok: false, error: { code, message } }, sin modificar nada: SCORE_NOT_FOUND indica
    // que el alumno no tiene una calificación en la evaluación (nunca la tuvo, ya se dio de baja o
    // la inscripción no existe o no es del curso de la asignación, sin distinguir entre esos casos)
    // y ENROLLMENT_NOT_ACTIVE, que la inscripción fue finalizada o cancelada; además,
    // TEACHER_ASSIGNMENT_NOT_FOUND y EVALUATION_NOT_FOUND, como en listByOwnEvaluation.
    delete: (teacherAssignmentId, evaluationId, enrollmentId) =>
      ipcRenderer.invoke('scores:delete', teacherAssignmentId, evaluationId, enrollmentId),
  },
  dashboard: {
    // Solo ADMIN. Resuelve { ok: true, summary } con los indicadores de la vista Inicio para su
    // institución ({ userCount, courseCount, assignedTeacherCount, teacherAssignmentCount }, todos
    // enteros: los usuarios vigentes, activos o suspendidos y con el propio administrador; los cursos
    // vigentes y las asignaciones docentes vigentes, de todos los ciclos lectivos, y los profesores
    // distintos que tienen al menos una de esas asignaciones), o
    // { ok: false, error: { code, message } }.
    getAdminSummary: () => ipcRenderer.invoke('dashboard:get-admin-summary'),
    // Solo SECRETARIO. Resuelve { ok: true, summary } con los indicadores de la vista Inicio para su
    // institución ({ activeEnrollmentCount }, un entero: las inscripciones activas del ciclo lectivo
    // del año en curso, sin las de años anteriores; 0 si ese año todavía no tiene ninguna), o
    // { ok: false, error: { code, message } }.
    getSecretarySummary: () => ipcRenderer.invoke('dashboard:get-secretary-summary'),
  },
});
