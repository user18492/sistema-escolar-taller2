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
    // mensaje listo para mostrar. Si las credenciales permiten ingresar a varias instituciones, resuelve
    // { ok: true, institutions } ([{ id, name, role }], con el rol del usuario en cada una y name null si
    // la institución no tiene nombre) y la sesión se inicia con selectInstitution.
    // Con un acceso exitoso, `rememberAccount` guarda el email para el próximo inicio o lo olvida.
    login: (email, password, rememberAccount) => ipcRenderer.invoke('auth:login', { email, password, rememberAccount }),
    // Completa el login con la institución elegida (el id de una de `institutions`). Resuelve como login:
    // { ok: true, user } o { ok: false, error: { code, message } }; NO_PENDING_LOGIN indica que hay que
    // volver a ingresar las credenciales.
    selectInstitution: (institutionId, rememberAccount) => ipcRenderer.invoke('auth:select-institution', { institutionId, rememberAccount }),
    // Resuelve { firstName, lastName, role, imageUrl, institutionName }, o null si no hay sesión iniciada.
    getCurrentUser: () => ipcRenderer.invoke('auth:get-current-user'),
    // También descarta un login que quedó a la espera de elegir la institución.
    logout: () => ipcRenderer.invoke('auth:logout'),
    // Resuelve el email recordado, o null si no hay ninguno.
    getRememberedEmail: () => ipcRenderer.invoke('auth:get-remembered-email'),
    forgetRememberedEmail: () => ipcRenderer.invoke('auth:forget-remembered-email'),
  },
  // Si la cuenta de la sesión fue suspendida o dada de baja, las operaciones de users, de courses, de
  // grades y de teacherAssignments resuelven { ok: false, error: { code: 'ACCOUNT_SUSPENDED', message } }
  // y el proceso principal cierra la sesión y vuelve al login.
  users: {
    // Solo ADMIN. Resuelve { ok: true, users } con los demás usuarios de su institución, vigentes y dados de
    // baja, ordenados por apellido y nombre ({ id, firstName, lastName, dni, email, birthDate, isActive, role,
    // imageUrl, deletedAt }, con birthDate 'AAAA-MM-DD' o null, imageUrl la URL de su foto,
    // profile-image://avatars/<archivo>, o null, y deletedAt el instante de su baja en ISO 8601, o null si
    // está vigente), o { ok: false, error: { code, message } }.
    list: () => ipcRenderer.invoke('users:list'),
    // Solo ADMIN. Crea un usuario en su institución, siempre activo. `data` tiene los campos de update
    // sin isActive y con password obligatoria: viaja en texto plano y el proceso principal guarda solo
    // su hash. `image` null lo crea sin foto y `removeImage` no quita nada (no puede ser true junto con
    // image). Resuelve { ok: true, user } con el usuario creado (mismos campos que list) o
    // { ok: false, error: { code, message, fieldErrors } }, como update: DUPLICATE_VALUE indica un dni
    // o un email ya registrados.
    create: (data) => ipcRenderer.invoke('users:create', data),
    // Solo ADMIN. Guarda los datos del usuario con ese id (usuario_id) de su institución. `data` es
    // { firstName, lastName, dni, email, birthDate, role, isActive, password, image, removeImage }, con
    // birthDate 'AAAA-MM-DD', isActive false para suspenderlo (sigue en el listado, pero no puede
    // iniciar sesión) y password null para conservar la actual. `image` es el recorte de una foto nueva
    // (Uint8Array con un PNG de 512 × 512), o null para no cambiarla; `removeImage` true quita la foto
    // actual y no puede venir junto con image. Resuelve { ok: true, user } con el usuario como quedó
    // (mismos campos que list) o { ok: false, error: { code, message, fieldErrors } }: fieldErrors
    // ({ campo: mensaje }) llega con DUPLICATE_VALUE (dni o email de otro usuario) y con los campos
    // inválidos; una foto inválida da INVALID_INPUT sin fieldErrors y USER_NOT_FOUND indica que ya no
    // está vigente.
    update: (userId, data) => ipcRenderer.invoke('users:update', userId, data),
    // Solo ADMIN. Baja lógica del usuario con ese id (usuario_id) de su institución, que queda además
    // suspendido. Resuelve { ok: true, user } con el usuario como quedó (mismos campos que list, con su
    // deletedAt) o { ok: false, error: { code, message } }; USER_NOT_FOUND y USER_ALREADY_DELETED indican
    // que ya no está vigente.
    delete: (userId) => ipcRenderer.invoke('users:delete', userId),
    // Solo ADMIN. Restaura al usuario dado de baja con ese id (usuario_id) de su institución: vuelve a
    // estar vigente y queda activo, con la contraseña que tenía. Resuelve { ok: true, user } con el
    // usuario como quedó (mismos campos que list, con deletedAt null) o
    // { ok: false, error: { code, message } }; USER_NOT_FOUND y USER_NOT_DELETED indican que ya no está
    // dado de baja.
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
});
