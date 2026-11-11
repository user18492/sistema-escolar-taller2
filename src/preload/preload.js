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
  // Cierre de la aplicación con cambios sin guardar en la vista ("Salir" de la bandeja o el apagado,
  // el reinicio o el cierre de sesión de Windows). No piden sesión.
  app: {
    // La vista informa si tiene cambios sin guardar (true o false) cada vez que cambia: con cambios,
    // el proceso principal no cierra la aplicación y le pide la confirmación con onQuitRequested.
    // Resuelve { ok: true }, o { ok: false, error: { code: 'INVALID_INPUT', message } } si value no
    // es un booleano.
    setUnsavedChanges: (value) => ipcRenderer.invoke('app:set-unsaved-changes', value),
    // Cierra la aplicación sin volver a preguntar ("Salir sin guardar").
    quit: () => ipcRenderer.invoke('app:quit'),
    // El proceso principal pide confirmar el cierre, ya con la ventana visible. Devuelve la función
    // que deja de escucharlo.
    onQuitRequested: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('app:quit-requested', handler);
      return () => ipcRenderer.removeListener('app:quit-requested', handler);
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
  // courses, de grades, de schoolYears, de teacherAssignments, de students, de enrollments, de
  // evaluations, de scores, de dashboard, de reports y de backups resuelven
  // { ok: false, error: { code: 'ACCOUNT_SUSPENDED', message } } y el proceso principal cierra la
  // sesión y vuelve al login.
  // Lo de un ciclo lectivo cerrado (uno anterior al actual, el de schoolYears.getCurrent) es de solo
  // lectura: las operaciones que lo editarían o lo darían de baja resuelven
  // { ok: false, error: { code: 'SCHOOL_YEAR_CLOSED', message } } sin cambiar nada (cada una lo
  // indica abajo), antes que los errores de los datos enviados.
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
    // USER_HAS_TEACHER_ASSIGNMENTS, que tiene asignaciones docentes vigentes del ciclo lectivo actual.
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
    // que ya no está vigente, USER_HAS_TEACHER_ASSIGNMENTS, que tiene asignaciones docentes vigentes del
    // ciclo lectivo actual (hay que reasignarlas o darlas de baja antes), y LAST_ADMIN, que es el único
    // administrador activo y vigente de la institución.
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
    // schoolYear, hasTeacherAssignments, hasEnrollments }, con gradeName el nombre del grado, 1° a 6°,
    // educationLevel 'PRIMARY' o 'SECONDARY', division una letra mayúscula, shift 'MORNING' o
    // 'AFTERNOON', schoolYear el año del ciclo lectivo, hasTeacherAssignments true si tiene asignaciones
    // docentes vigentes y hasEnrollments true si tiene inscripciones vigentes, en cualquier estado: con
    // alguno en true, no se edita ni se da de baja), o { ok: false, error: { code, message } }. Llegan
    // siempre en el mismo orden: ciclo lectivo (el más reciente primero), nivel educativo (primaria
    // antes que secundaria), grado, división y turno.
    list: () => ipcRenderer.invoke('courses:list'),
    // Solo ADMIN. Crea un curso en su institución, para el ciclo lectivo del año en curso. `data` es
    // { gradeId, division, shift }, con gradeId el id de un grado de grades.list (define también el
    // nivel educativo), division una letra (se guarda en mayúscula) y shift 'MORNING' o 'AFTERNOON'.
    // Resuelve { ok: true, course } con el curso creado (mismos campos que list, con
    // hasTeacherAssignments y hasEnrollments en false) o
    // { ok: false, error: { code, message, fieldErrors } }: fieldErrors ({ campo: mensaje }) llega si
    // la división no es válida, DUPLICATE_VALUE indica que la institución ya tiene ese curso vigente
    // en el ciclo lectivo y GRADE_NOT_FOUND, que el grado no está en el catálogo.
    create: (data) => ipcRenderer.invoke('courses:create', data),
    // Solo ADMIN. Guarda el grado, la división y el turno del curso vigente con ese id (curso_id) de su
    // institución; el ciclo lectivo no cambia. `data` es { gradeId, division, shift }, como en create.
    // Resuelve { ok: true, course } con el curso como quedó (mismos campos que list, con
    // hasTeacherAssignments y hasEnrollments en false) o
    // { ok: false, error: { code, message, fieldErrors } }: fieldErrors llega si la división no es
    // válida, DUPLICATE_VALUE indica que la institución ya tiene otro curso vigente igual en ese ciclo
    // lectivo, GRADE_NOT_FOUND, que el grado no está en el catálogo, COURSE_NOT_FOUND y
    // COURSE_ALREADY_DELETED, que el curso ya no está vigente, SCHOOL_YEAR_CLOSED, que es de un
    // ciclo lectivo cerrado, y COURSE_IN_USE (sin fieldErrors), que tiene asignaciones docentes o
    // inscripciones vigentes, aunque se guarde sin cambios.
    update: (courseId, data) => ipcRenderer.invoke('courses:update', courseId, data),
    // Solo ADMIN. Baja lógica del curso con ese id (curso_id) de su institución: deja de listarse y su
    // grado, división y turno se pueden volver a crear en ese ciclo lectivo. La baja es definitiva: el
    // curso ya no se modifica ni se restaura. Resuelve { ok: true, course } con el curso dado de baja
    // (mismos campos que list, con hasTeacherAssignments y hasEnrollments en false) o
    // { ok: false, error: { code, message } }; COURSE_NOT_FOUND y COURSE_ALREADY_DELETED indican que ya
    // no está vigente, SCHOOL_YEAR_CLOSED, que es de un ciclo lectivo cerrado, y COURSE_IN_USE, que
    // tiene asignaciones docentes o inscripciones vigentes.
    delete: (courseId) => ipcRenderer.invoke('courses:delete', courseId),
  },
  grades: {
    // Solo ADMIN. Resuelve { ok: true, grades } con el catálogo de grados, común a todas las
    // instituciones ({ id, name, educationLevel }, con name el nombre del grado, 1° a 6°, que se repite
    // entre niveles, y educationLevel 'PRIMARY' o 'SECONDARY'), o { ok: false, error: { code, message } }.
    // Llegan siempre en el mismo orden: nivel educativo (primaria antes que secundaria) y grado.
    list: () => ipcRenderer.invoke('grades:list'),
  },
  schoolYears: {
    // ADMIN, SECRETARIO y PROFESOR. Resuelve { ok: true, schoolYear } con el ciclo lectivo actual, el
    // mismo para todas las instituciones ({ year, today }, con year el año del ciclo lectivo y today
    // la fecha del día, 'AAAA-MM-DD', los dos según la base de datos y no según el reloj de la PC),
    // o { ok: false, error: { code, message } }. Los ciclos anteriores a `year` están cerrados: lo
    // suyo es de solo lectura (SCHOOL_YEAR_CLOSED, más arriba).
    getCurrent: () => ipcRenderer.invoke('school-years:get-current'),
  },
  teacherAssignments: {
    // Solo ADMIN. Resuelve { ok: true, teacherAssignments } con las asignaciones docentes vigentes de su
    // institución (sin las dadas de baja), de todos los ciclos lectivos ({ id, teacher, course, subject,
    // hasEvaluations }, con teacher { id, firstName, lastName, email, imageUrl }, el profesor, e imageUrl
    // la URL de su foto, profile-image://avatars/<archivo>, o null; course { id, gradeName,
    // educationLevel, division, shift, schoolYear }, con los mismos valores que en courses.list; subject
    // { id, name }, la materia, y hasEvaluations true si tiene evaluaciones vigentes: así no se da de baja
    // ni cambia de curso ni de materia, aunque sí de profesor), o
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
    // create; el curso que la asignación ya tiene se puede conservar aunque no esté en
    // listAssignableCourses, el profesor es uno de listAssignableTeachers (aunque sea el que ya tiene) y
    // la materia es una de listAssignableSubjects para ese curso y esa asignación. Resuelve { ok: true, teacherAssignment } con la asignación como
    // quedó (mismos campos que list) o { ok: false, error: { code, message, fieldErrors } }, sin
    // guardar nada, con los códigos de create: DUPLICATE_VALUE indica que la materia ya tiene un
    // profesor en ese curso con otra asignación (guardarla sin cambios no es un duplicado). Además,
    // TEACHER_ASSIGNMENT_NOT_FOUND y TEACHER_ASSIGNMENT_ALREADY_DELETED indican que ya no está vigente,
    // SCHOOL_YEAR_CLOSED, que su curso es de un ciclo lectivo cerrado, y
    // TEACHER_ASSIGNMENT_HAS_EVALUATIONS (sin fieldErrors), que tiene evaluaciones vigentes y no puede
    // cambiar de curso ni de materia (el profesor sí cambia, y el nuevo hereda las evaluaciones).
    update: (teacherAssignmentId, data) => ipcRenderer.invoke('teacher-assignments:update', teacherAssignmentId, data),
    // Solo ADMIN. Baja lógica de la asignación docente con ese id (asignacion_docente_id) de su
    // institución: deja de listarse y su materia vuelve a estar entre las de listAssignableSubjects
    // para ese curso. Resuelve { ok: true, teacherAssignment } con la asignación dada de baja (mismos
    // campos que list) o { ok: false, error: { code, message } }; TEACHER_ASSIGNMENT_NOT_FOUND y
    // TEACHER_ASSIGNMENT_ALREADY_DELETED indican que ya no está vigente, SCHOOL_YEAR_CLOSED, que su
    // curso es de un ciclo lectivo cerrado, y TEACHER_ASSIGNMENT_HAS_EVALUATIONS, que tiene evaluaciones
    // vigentes.
    delete: (teacherAssignmentId) => ipcRenderer.invoke('teacher-assignments:delete', teacherAssignmentId),
  },
  students: {
    // Solo SECRETARIO. Resuelve { ok: true, students } con los alumnos de su institución, vigentes y
    // dados de baja, activos y egresados ({ id, firstName, lastName, dni, email, phone, street,
    // streetNumber, birthDate, status, deletedAt, hasActiveEnrollment }, con dni y phone solo los
    // dígitos, street y streetNumber la calle y la altura de la dirección, birthDate 'AAAA-MM-DD',
    // status 'ACTIVE' o 'GRADUATED', deletedAt el instante de su baja en ISO 8601, o null si está
    // vigente, y hasActiveEnrollment true si tiene una inscripción vigente y activa: con ella no pasa
    // a egresado), o { ok: false, error: { code, message } }.
    // Llegan siempre en el mismo orden: por apellido y nombre.
    list: () => ipcRenderer.invoke('students:list'),
    // Solo SECRETARIO. Registra un alumno en su institución, siempre activo: el estado no se elige en
    // el alta. `data` es { firstName, lastName, dni, email, phone, street, streetNumber, birthDate },
    // con dni y phone solo los dígitos (un phone con otro carácter se rechaza), street y streetNumber
    // la calle y la altura de la dirección y birthDate 'AAAA-MM-DD'. Resuelve { ok: true, student }
    // con el alumno creado (mismos campos que list, con hasActiveEnrollment false) o
    // { ok: false, error: { code, message, fieldErrors } }, sin crear nada: fieldErrors
    // ({ campo: mensaje }) llega con INVALID_INPUT (campos inválidos) y con DUPLICATE_VALUE (dni o
    // email de otro alumno vigente de la institución), y DELETED_STUDENT_EXISTS (sin fieldErrors)
    // indica que son de un alumno dado de baja: en lugar de registrarlo otra vez, hay que
    // restaurarlo desde Eliminados; el mensaje lo nombra.
    create: (data) => ipcRenderer.invoke('students:create', data),
    // Solo SECRETARIO. Guarda los cambios del alumno vigente con ese id (alumno_id) de su
    // institución. `data` trae los mismos campos que create y además status ('ACTIVE' o
    // 'GRADUATED'). Resuelve { ok: true, student } con el alumno como quedó (mismos campos que list,
    // también hasActiveEnrollment) o { ok: false, error: { code, message, fieldErrors } }, sin
    // guardar nada, con los códigos de create: DUPLICATE_VALUE indica que el dni o el email son de
    // otro alumno de la institución (conservar los suyos no es un duplicado), e INVALID_INPUT llega
    // sin fieldErrors si el estado no es válido. Además, STUDENT_NOT_FOUND indica que el alumno ya no
    // está vigente, y STUDENT_HAS_ACTIVE_ENROLLMENT (sin fieldErrors), que se lo quiso pasar a
    // egresado y tiene una inscripción vigente y activa.
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
    // quedó (mismos campos que list, con deletedAt null y hasActiveEnrollment false) o
    // { ok: false, error: { code, message } }, sin cambiar nada: STUDENT_NOT_FOUND indica que no
    // existe en la institución, STUDENT_NOT_DELETED, que ya estaba vigente, y DUPLICATE_VALUE (sin
    // fieldErrors), que otro alumno vigente de la institución ya tiene su dni o su email; el mensaje
    // dice cuál.
    restore: (studentId) => ipcRenderer.invoke('students:restore', studentId),
  },
  enrollments: {
    // Solo SECRETARIO. Resuelve { ok: true, enrollments, total, page } con la página `page` (1 la
    // primera; de `pageSize` inscripciones, hasta 100) de las inscripciones vigentes de su
    // institución (sin las dadas de baja), de todos los ciclos lectivos y en cualquier estado, que
    // pasan `filters`. Las de un alumno dado de baja no se listan, ninguna; al restaurarlo vuelven
    // todas. Filtrar y paginar se hace sobre todas, en el proceso principal. `filters` es
    // { enrollmentIds, studentIds, grades, divisions, shifts, statuses }, cada uno un arreglo, vacío
    // si no filtra:
    // ids de inscripciones y de alumnos (de listFilterOptions), grados { educationLevel, gradeName }
    // ('PRIMARY' o 'SECONDARY' y el nombre del grado, 1° a 6°), divisiones (letras mayúsculas),
    // turnos ('MORNING' o 'AFTERNOON') y estados ('ACTIVE', 'COMPLETED' o 'CANCELLED'). Una
    // inscripción pasa un filtro si coincide con alguno de sus valores, y tiene que pasarlos todos.
    // Cada inscripción es { id, number, enrollmentDate, status, student, course, hasScores }, con
    // number y enrollmentDate como en listByOwnAssignment, status uno de los estados, student
    // { firstName, lastName }, course como en courses.list y hasScores true si tiene calificaciones
    // vigentes: así no se elimina (delete, más abajo). `total` es cuántas pasan los filtros y
    // `page`, la página devuelta: si la pedida ya no existe, la última (con ninguna, la 1). Con
    // `enrollmentId` (el id de una inscripción, p. ej. la que devolvió create), se devuelve en cambio
    // la página donde está, si pasa los filtros; si no, la página `page`. Llegan siempre en el mismo
    // orden: por alumno (apellido y nombre). Resuelve { ok: false, error: { code, message } } si no:
    // INVALID_INPUT indica filtros, página o enrollmentId inválidos.
    list: (filters, page, pageSize, enrollmentId = null) =>
      ipcRenderer.invoke('enrollments:list', filters, page, pageSize, enrollmentId),
    // Solo SECRETARIO. Las opciones de los filtros Número de inscripción y Alumno, las del ciclo
    // lectivo que muestra la tabla: resuelve { ok: true, enrollments, students } con las
    // inscripciones que lista list filtrando solo por el año `schoolYear` (un entero de 0 a 9999) de
    // la fecha de inscripción, que es el ciclo lectivo del curso, también sin las de alumnos dados de
    // baja ({ id, number, student }, con number como en list y student { firstName, lastName }), y
    // sus alumnos, una vez cada uno ({ id, firstName, lastName, email }), las dos listas en el orden
    // de list, o { ok: false, error: { code, message } }: INVALID_INPUT indica un año inválido.
    listFilterOptions: (schoolYear) => ipcRenderer.invoke('enrollments:list-filter-options', schoolYear),
    // Solo SECRETARIO. Lo que ofrece el formulario de alta en Alumno: resuelve { ok: true, students }
    // con los alumnos vigentes y activos de su institución que no tienen una inscripción vigente y
    // activa (sin los dados de baja, los egresados ni los ya inscriptos: un alumno solo puede tener
    // una, y una inscripción dada de baja no cuenta), por apellido y nombre
    // ({ id, firstName, lastName, dni }, con dni solo los dígitos), o
    // { ok: false, error: { code, message } }.
    listEnrollableStudents: () => ipcRenderer.invoke('enrollments:list-enrollable-students'),
    // Solo SECRETARIO. Lo que ofrece el formulario de alta en Curso: resuelve { ok: true, courses }
    // con los cursos vigentes de su institución del ciclo lectivo del año en curso (mismos campos que
    // courses.list, por nivel educativo, grado, división y turno), o
    // { ok: false, error: { code, message } }. El formulario muestra los del nivel educativo elegido.
    listEnrollableCourses: () => ipcRenderer.invoke('enrollments:list-enrollable-courses'),
    // Solo SECRETARIO. Inscribe a un alumno en un curso de su institución. `data` es
    // { studentId, educationLevel, courseId }: el id de un alumno de listEnrollableStudents, 'PRIMARY'
    // o 'SECONDARY' y el id de un curso de listEnrollableCourses de ese nivel. La inscripción nace
    // siempre activa, con la fecha del día y su número (INS-XXXXXX) armado con el id que le da la
    // base: ni el estado ni la fecha se eligen. Resuelve { ok: true, enrollment } con la inscripción
    // creada (mismos campos que list, sin hasScores) o { ok: false, error: { code, message } }, sin
    // crear nada: INVALID_INPUT indica datos o un nivel educativo inválidos; STUDENT_NOT_FOUND,
    // STUDENT_DELETED y STUDENT_NOT_ACTIVE, que el alumno no existe en la institución, fue eliminado
    // o no está activo; COURSE_NOT_FOUND, COURSE_DELETED y COURSE_LEVEL_MISMATCH, que el curso no
    // existe en la institución, fue eliminado o es de otro nivel educativo; STUDENT_ALREADY_ENROLLED,
    // que el alumno ya tiene una inscripción vigente y activa (solo puede tener una; el mensaje da su
    // número), y COURSE_OUT_OF_SCHOOL_YEAR, que el curso no es del ciclo lectivo del año en curso.
    create: (data) => ipcRenderer.invoke('enrollments:create', data),
    // Solo SECRETARIO. Resuelve { ok: true, enrollment } con la inscripción vigente con ese id
    // (inscripcion_id) de su institución, de cualquier ciclo lectivo y en cualquier estado (mismos
    // campos que list, sin hasScores), o { ok: false, error: { code, message } }:
    // ENROLLMENT_NOT_FOUND indica que no existe en la institución y ENROLLMENT_DELETED, que fue
    // eliminada.
    get: (enrollmentId) => ipcRenderer.invoke('enrollments:get', enrollmentId),
    // Solo SECRETARIO. Cambia el estado de la inscripción vigente con ese id (inscripcion_id) de su
    // institución. `data` es { status }, con status 'ACTIVE' o 'CANCELLED': solo se edita el estado;
    // el número, el alumno, el curso y la fecha no cambian. Resuelve
    // { ok: true, enrollment, changed } con la inscripción como quedó (mismos campos que list, sin
    // hasScores) y changed false si ya tenía ese estado, en cuyo caso no se modificó nada, o
    // { ok: false, error: { code, message } }, sin cambiar nada: INVALID_INPUT indica datos o un
    // estado inválidos, también 'COMPLETED' (una inscripción pasa a finalizada solo con el cierre del
    // ciclo lectivo); ENROLLMENT_NOT_FOUND y ENROLLMENT_DELETED, lo mismo que en get;
    // STUDENT_ALREADY_ENROLLED, que se la quiso activar y el alumno ya tiene otra inscripción vigente
    // y activa (solo puede tener una; el mensaje da su número); STUDENT_DELETED y STUDENT_NOT_ACTIVE,
    // que se la quiso activar y el alumno fue eliminado o es egresado, y SCHOOL_YEAR_CLOSED, que es
    // de un ciclo lectivo cerrado, en cualquier estado y aunque se guarde con el que ya tiene.
    update: (enrollmentId, data) => ipcRenderer.invoke('enrollments:update', enrollmentId, data),
    // Solo SECRETARIO. Baja lógica de la inscripción vigente con ese id (inscripcion_id) de su
    // institución, si no tiene calificaciones vigentes: deja de listarse, y su estado, su alumno, su
    // curso y su fecha no cambian. La baja es definitiva: no se restaura. Resuelve
    // { ok: true, enrollment } con la inscripción dada de baja (mismos campos que list, sin
    // hasScores) o { ok: false, error: { code, message } }, sin cambiar nada: INVALID_INPUT indica un
    // id inválido; ENROLLMENT_NOT_FOUND, que no existe en la institución;
    // ENROLLMENT_ALREADY_DELETED, que ya había sido eliminada (p. ej., desde otra sesión);
    // SCHOOL_YEAR_CLOSED, que es de un ciclo lectivo cerrado, y ENROLLMENT_HAS_SCORES, que tiene
    // calificaciones vigentes (las dadas de baja no cuentan): lo decide la base al guardar, así que
    // también llega si list la mostró con hasScores false y después se le cargó una nota.
    delete: (enrollmentId) => ipcRenderer.invoke('enrollments:delete', enrollmentId),
    // Solo SECRETARIO. Genera el comprobante en PDF de la inscripción vigente con ese id
    // (inscripcion_id) de su institución, de cualquier ciclo lectivo y en cualquier estado, y lo abre
    // con el visor de PDF predeterminado del sistema, desde donde se imprime o se guarda: la
    // aplicación no abre ventanas ni diálogos propios. Resuelve { ok: true } cuando se abrió el visor
    // (sin un programa para los PDF, Windows muestra su diálogo para elegir uno y también resuelve
    // así), o { ok: false, error: { code, message } }: INVALID_INPUT indica un id inválido;
    // ENROLLMENT_NOT_FOUND y ENROLLMENT_DELETED, lo mismo que en get, y PDF_VIEWER_UNAVAILABLE, que
    // el sistema no pudo abrir el PDF.
    openReceipt: (enrollmentId) => ipcRenderer.invoke('enrollments:open-receipt', enrollmentId),
    // Solo SECRETARIO. Resuelve { ok: true, enrollment, subjects } con los promedios de la
    // inscripción vigente con ese id (inscripcion_id) de su institución, activa o finalizada, de
    // cualquier ciclo lectivo. `enrollment` es { id, number, status, student, course }: number el
    // número de inscripción, status ACTIVE o COMPLETED, student { firstName, lastName } y course,
    // con los campos de courses.list (schoolYear, su ciclo lectivo). `subjects` son las materias con
    // una asignación docente vigente en su curso (solo esas), por nombre ({ subjectName, terms,
    // annual }, con terms y annual como en scores.listAveragesByOwnAssignment: una materia sin
    // evaluaciones tomadas va con todo en null). O { ok: false, error: { code, message } }:
    // INVALID_INPUT indica un id inválido; ENROLLMENT_NOT_FOUND y ENROLLMENT_DELETED, lo mismo que en
    // get, y ENROLLMENT_CANCELLED, que está cancelada: no tiene promedios.
    getAverages: (enrollmentId) => ipcRenderer.invoke('enrollments:get-averages', enrollmentId),
    // Solo PROFESOR. Resuelve { ok: true, enrollments } con las inscripciones del curso de la
    // asignación docente vigente con ese id (asignacion_docente_id), si está a su cargo: las
    // vigentes, activas y finalizadas, del curso, sin las canceladas ni las dadas de baja
    // ({ id, number, enrollmentDate, student }, con number el número de inscripción, 'INS-' y el id con al menos seis dígitos, INS-000012;
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
    // cargo ({ id, title, evaluationDate, term, isTermClosed, scoreCount }, con evaluationDate el
    // día de la evaluación, 'AAAA-MM-DD'; term su trimestre, 1, 2 o 3, con los cortes de los
    // promedios (fn_trimestre); isTermClosed true si ese trimestre está cerrado, con la fecha de
    // la base: la evaluación y sus calificaciones son de solo lectura, y scoreCount cuántas
    // calificaciones vigentes tiene, solo de las inscripciones que lista scores.listByOwnEvaluation:
    // vigentes, activas o finalizadas, inscriptas a más tardar el día de la evaluación; 0 si
    // ninguna), o
    // { ok: false, error: { code, message } }: TEACHER_ASSIGNMENT_NOT_FOUND indica que la
    // asignación no existe, que fue dada de baja o que es de otro profesor, sin distinguir entre esos
    // casos. Llegan siempre en el mismo orden: por fecha (la más antigua primero) y título.
    listByOwnAssignment: (teacherAssignmentId) =>
      ipcRenderer.invoke('evaluations:list-by-own-assignment', teacherAssignmentId),
    // Solo PROFESOR. Crea una evaluación vigente en la asignación docente vigente con ese id
    // (asignacion_docente_id), si está a su cargo. `data` es { title, evaluationDate }, con
    // evaluationDate el día de la evaluación, 'AAAA-MM-DD'. Resuelve { ok: true, evaluation } con la
    // evaluación creada (mismos campos que listByOwnAssignment, sin scoreCount) o
    // { ok: false, error: { code, message, fieldErrors } }, sin guardar nada: fieldErrors
    // ({ campo: mensaje }, con los nombres de `data`) llega con INVALID_INPUT si el título está
    // vacío o no tiene letras ni números, o si la fecha no existe en el calendario, no es del ciclo
    // lectivo de la asignación o es de un trimestre cerrado, y con DUPLICATE_VALUE (la asignación ya tiene una evaluación
    // vigente con ese título, en fieldErrors.title); TEACHER_ASSIGNMENT_NOT_FOUND, como en
    // listByOwnAssignment, y SCHOOL_YEAR_CLOSED, que el curso de la asignación es de un ciclo
    // lectivo cerrado.
    create: (teacherAssignmentId, data) => ipcRenderer.invoke('evaluations:create', teacherAssignmentId, data),
    // Solo PROFESOR. Guarda el título y la fecha de la evaluación vigente con ese id
    // (evaluacion_id), si es de la asignación docente vigente con ese id (asignacion_docente_id) y
    // esa asignación está a su cargo; la evaluación conserva su asignación. `data` es
    // { title, evaluationDate }, como en create, y se valida igual. Resuelve
    // { ok: true, evaluation } con la evaluación como quedó (mismos campos que listByOwnAssignment,
    // sin scoreCount) o { ok: false, error: { code, message, fieldErrors } }, sin guardar nada:
    // fieldErrors llega con INVALID_INPUT, como en create y también en fieldErrors.evaluationDate si
    // la evaluación tiene calificaciones vigentes y la fecha nueva es futura (posterior a hoy, con
    // la fecha de la base) o anterior a la fecha de inscripción de un alumno calificado, y con
    // DUPLICATE_VALUE (la asignación ya tiene otra evaluación vigente con ese título, en
    // fieldErrors.title; guardarla sin cambios no es un duplicado); TEACHER_ASSIGNMENT_NOT_FOUND y
    // SCHOOL_YEAR_CLOSED, como en create; TERM_CLOSED, que la evaluación es de un trimestre cerrado
    // (solo lectura, también el título; llega después de SCHOOL_YEAR_CLOSED y antes de los errores
    // del formulario), y EVALUATION_NOT_FOUND indica que la evaluación no existe, que fue dada de baja o que es de otra
    // asignación, sin distinguir entre esos casos.
    update: (teacherAssignmentId, evaluationId, data) =>
      ipcRenderer.invoke('evaluations:update', teacherAssignmentId, evaluationId, data),
    // Solo PROFESOR. Baja lógica de la evaluación vigente con ese id (evaluacion_id), si es de la
    // asignación docente vigente con ese id (asignacion_docente_id) y esa asignación está a su
    // cargo: deja de listarse en listByOwnAssignment y su título se puede volver a usar en la
    // asignación; en la misma operación se dan de baja también todas sus calificaciones vigentes.
    // Resuelve { ok: true, evaluation } con la evaluación dada de baja (mismos campos que
    // listByOwnAssignment, sin scoreCount) o { ok: false, error: { code, message } }, sin modificar
    // nada: TEACHER_ASSIGNMENT_NOT_FOUND y SCHOOL_YEAR_CLOSED, como en create, TERM_CLOSED, como en
    // update, EVALUATION_HAS_COMPLETED_SCORES, que la evaluación tiene calificaciones vigentes de
    // inscripciones finalizadas (solo de respaldo: una finalizada es de un ciclo lectivo cerrado,
    // donde llega antes SCHOOL_YEAR_CLOSED), y EVALUATION_NOT_FOUND indica que la evaluación no
    // existe, que ya estaba dada de baja o que es de otra asignación, sin distinguir entre esos casos.
    delete: (teacherAssignmentId, evaluationId) =>
      ipcRenderer.invoke('evaluations:delete', teacherAssignmentId, evaluationId),
  },
  scores: {
    // Solo PROFESOR. Resuelve { ok: true, evaluation, scores } con la evaluación vigente con ese id
    // (evaluacion_id), si es de la asignación docente vigente con ese id (asignacion_docente_id) y
    // esa asignación está a su cargo ({ id, title, evaluationDate, term, isTermClosed }, como en
    // evaluations.listByOwnAssignment, sin scoreCount; con isTermClosed, las calificaciones son de
    // solo lectura), y con sus calificaciones: una por cada inscripción del curso de la asignación,
    // vigente, activa o finalizada (sin las canceladas ni las dadas de baja) e inscripta a más tardar
    // el día de la evaluación (a las posteriores no se las califica en ella), tenga o no una nota
    // cargada ({ enrollmentId, student, value, isEnrollmentActive }, con
    // enrollmentId el id de la inscripción, que identifica la fila; student
    // { firstName, lastName, dni }, el alumno, con dni solo los dígitos; value la nota, un número de 0 a 10 con hasta dos decimales, o null si
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
    // ENROLLMENT_NOT_FOUND, que la inscripción no existe, no es del curso de la asignación o es
    // posterior a la fecha de la evaluación (no está en listByOwnEvaluation);
    // ENROLLMENT_DELETED, que fue dada de baja (ya no está en listByOwnEvaluation, que quedó
    // vieja), y ENROLLMENT_NOT_ACTIVE, que fue finalizada o cancelada; SCHOOL_YEAR_CLOSED, que la
    // evaluación es de un curso de un ciclo lectivo cerrado; TERM_CLOSED, que es de un trimestre
    // cerrado (con la fecha de la base); EVALUATION_IN_FUTURE, que la fecha de
    // la evaluación todavía no llegó (con la fecha de la base: se califica a partir de ese día), y
    // además, TEACHER_ASSIGNMENT_NOT_FOUND y EVALUATION_NOT_FOUND, como en listByOwnEvaluation.
    save: (teacherAssignmentId, evaluationId, data) =>
      ipcRenderer.invoke('scores:save', teacherAssignmentId, evaluationId, data),
    // Solo PROFESOR. Guarda de una vez los cambios en las calificaciones de esa evaluación de esa
    // asignación (los mismos ids que en listByOwnEvaluation): todos o ninguno. `changes` es
    // [{ enrollmentId, value }], no vacío y con cada inscripción (una de listByOwnEvaluation, activa)
    // una sola vez: con value una nota (de 0 a 10 con hasta dos decimales) se carga o se corrige,
    // como en save, y con value null se da de baja su calificación, como en delete; si ya no tenía
    // una, no es un error. Resuelve { ok: true, scores } con las notas como quedaron guardadas
    // ([{ enrollmentId, value }], una por cambio, null en las bajas) o
    // { ok: false, error: { code, message, enrollmentId? } }, sin guardar ninguno: enrollmentId es
    // la inscripción del cambio rechazado, en los errores de un cambio (INVALID_SCORE,
    // ENROLLMENT_NOT_FOUND, ENROLLMENT_DELETED y ENROLLMENT_NOT_ACTIVE, como en save); los de la
    // evaluación (SCHOOL_YEAR_CLOSED, TERM_CLOSED, EVALUATION_IN_FUTURE, TEACHER_ASSIGNMENT_NOT_FOUND
    // y EVALUATION_NOT_FOUND), como en save, no lo llevan.
    saveMany: (teacherAssignmentId, evaluationId, changes) =>
      ipcRenderer.invoke('scores:save-many', teacherAssignmentId, evaluationId, changes),
    // Solo PROFESOR. Baja lógica de la calificación de un alumno en esa evaluación de esa asignación
    // (los mismos ids que en listByOwnEvaluation). `enrollmentId` es el id de la inscripción del
    // alumno (una de listByOwnEvaluation, activa y con nota). El alumno sigue en
    // listByOwnEvaluation, con value null, y se le puede cargar otra nota con save. Resuelve
    // { ok: true, score } con la calificación del alumno como quedó ({ enrollmentId, value: null })
    // o { ok: false, error: { code, message } }, sin modificar nada: SCORE_NOT_FOUND indica
    // que el alumno no tiene una calificación en la evaluación (nunca la tuvo, ya se dio de baja o
    // la inscripción no existe o no es del curso de la asignación, sin distinguir entre esos casos);
    // ENROLLMENT_DELETED, que la inscripción fue dada de baja, tenga o no una calificación (como en
    // save), y ENROLLMENT_NOT_ACTIVE, que fue finalizada o cancelada; SCHOOL_YEAR_CLOSED y
    // TERM_CLOSED, como en save, y además, TEACHER_ASSIGNMENT_NOT_FOUND y EVALUATION_NOT_FOUND, como en listByOwnEvaluation.
    delete: (teacherAssignmentId, evaluationId, enrollmentId) =>
      ipcRenderer.invoke('scores:delete', teacherAssignmentId, evaluationId, enrollmentId),
    // Solo PROFESOR. Resuelve { ok: true, averages } con los promedios, en la materia de la
    // asignación docente vigente con ese id (asignacion_docente_id), si está a su cargo, de las
    // mismas inscripciones que enrollments.listByOwnAssignment y en su mismo orden
    // ({ enrollmentId, terms, annual }: enrollmentId el id de la inscripción; terms los tres
    // trimestres en orden, { term, value, isFinal } con term 1, 2 o 3, y annual el anual,
    // { value, isFinal }). `value` es el promedio, un número de 0 a 10 redondeado a dos decimales,
    // o null si no hay evaluaciones tomadas (desde la inscripción y hasta hoy, con la fecha de la
    // base; una evaluación sin nota cuenta 0); el anual es el promedio de los trimestres con valor.
    // `isFinal` indica que es definitivo: en un trimestre, que está cerrado (pasó su plazo de carga
    // o su ciclo lectivo cerró); en el anual, que el ciclo lectivo está cerrado o la inscripción
    // está finalizada; sin valor es false. O { ok: false, error: { code, message } }:
    // TEACHER_ASSIGNMENT_NOT_FOUND, como en enrollments.listByOwnAssignment.
    listAveragesByOwnAssignment: (teacherAssignmentId) =>
      ipcRenderer.invoke('scores:list-averages-by-own-assignment', teacherAssignmentId),
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
    // institución ({ activeEnrollmentCount }, un entero: las inscripciones vigentes y activas del
    // ciclo lectivo del año en curso, sin las dadas de baja ni las de años anteriores; 0 si ese año
    // todavía no tiene ninguna), o
    // { ok: false, error: { code, message } }.
    getSecretarySummary: () => ipcRenderer.invoke('dashboard:get-secretary-summary'),
  },
  reports: {
    // Solo ADMIN. Reporte Materias sin docente por curso de su institución. `filters` es
    // { schoolYear, educationLevel, shift }: schoolYear, el año del ciclo lectivo (un entero de
    // 2000 a 2100); educationLevel, 'PRIMARY' o 'SECONDARY', y shift, 'MORNING' o 'AFTERNOON' (null
    // para todos). Resuelve { ok: true, report } con { schoolYear, courses }: por cada curso
    // incompleto de ese ciclo (vigente, con alguna de las dos listas de abajo no vacía), por nivel
    // educativo, grado, división y turno, { id, gradeName, educationLevel,
    // division, shift, subjectCount, assignedCount, unassignedSubjects, suspendedSubjects }, con los
    // mismos valores que en courses.list. subjectCount son las materias del plan de estudios de su
    // grado; unassignedSubjects, { subjectId, subjectName } de las que no tienen docente (sin
    // asignación vigente o con un profesor dado de baja, posible en un ciclo cerrado);
    // suspendedSubjects, { teacherAssignmentId, subjectId, subjectName, teacher: { id, firstName,
    // lastName }, teacherName } de las que tienen la asignación vigente de un profesor suspendido
    // (teacherAssignmentId, el id de esa asignación; teacherName, "Nombre Apellido"), y
    // assignedCount, subjectCount menos las que no tienen docente; courses vacío si no hay cursos
    // incompletos. O
    // { ok: false, error: { code, message } }: INVALID_INPUT indica filtros inválidos.
    getSubjectCoverage: (filters) => ipcRenderer.invoke('reports:get-subject-coverage', filters),
    // Solo ADMIN. Reporte Carga docente por profesor de su institución. `filters` es
    // { schoolYear, educationLevel, shift }, como en getSubjectCoverage. Resuelve
    // { ok: true, report } con { schoolYear, summary, teachers }: por cada profesor que no está dado
    // de baja (activo o suspendido, también sin asignaciones), de más a menos asignaciones y por
    // apellido y nombre, { id, firstName, lastName, suspended, assignmentCount, assignments }, con
    // assignmentCount sus asignaciones vigentes de cursos vigentes de ese ciclo (con ese nivel y
    // ese turno) y assignments { id, courseId, educationLevel, gradeName, division, shift,
    // subjectId, subjectName } de cada una (id, el de la asignación; educationLevel, como en
    // courses.list). summary es
    // { average, aboveCount, belowCount, withoutAssignmentsCount }: el promedio de assignmentCount
    // de todos ellos redondeado al entero (null si no hay ninguno), los que tienen más y los que
    // tienen menos que ese entero (sin contar los que no tienen ninguna) y los que no tienen
    // ninguna. En un ciclo pasado lista a los profesores no dados de baja hoy. O
    // { ok: false, error: { code, message } }: INVALID_INPUT indica filtros inválidos.
    getTeacherWorkload: (filters) => ipcRenderer.invoke('reports:get-teacher-workload', filters),
    // Solo ADMIN. Reporte Regularidad de los backups de su institución. `filters` es
    // { schoolYear }, como en getSubjectCoverage. Resuelve { ok: true, report } con
    // { schoolYear, lastBackup, months }: lastBackup, el último backup de la institución, de
    // cualquier ciclo ({ createdAt, daysAgo }, con createdAt en ISO 8601 y daysAgo los días desde
    // su fecha hasta hoy, 0 si es de hoy), o null si no hay ninguno; months, los 12 meses de ese
    // año, { month (1 a 12), count, future }, con count los backups del mes (0 si no hay) y future
    // true en los meses que todavía no llegaron (en el ciclo actual, los posteriores al de hoy; en
    // uno futuro, todos). O { ok: false, error: { code, message } }: INVALID_INPUT indica filtros
    // inválidos.
    getBackupRegularity: (filters) => ipcRenderer.invoke('reports:get-backup-regularity', filters),
    // Solo SECRETARIO. Reporte Inscripciones activas por curso de su institución, siempre del ciclo
    // lectivo actual. `filters` es { educationLevel, grades, divisions, shifts }: educationLevel,
    // 'PRIMARY' o 'SECONDARY' (null para todos), y, del filtro Curso, grades
    // ({ educationLevel, gradeName }), divisions (letras mayúsculas) y shifts ('MORNING' o
    // 'AFTERNOON'), cada uno un arreglo, vacío si no filtra, como en enrollments.list. Resuelve
    // { ok: true, report } con { schoolYear, hasCourses, courses }: schoolYear, el ciclo actual;
    // hasCourses, si la institución tiene algún curso vigente de ese ciclo (sin mirar los filtros), y
    // courses, por cada curso vigente del ciclo que pasa los filtros, por nivel educativo, grado,
    // división y turno, { id, gradeName, educationLevel, division, shift, schoolYear,
    // activeEnrollmentCount } (como en courses.list), con activeEnrollmentCount sus inscripciones
    // vigentes y activas (0 si no tiene). O { ok: false, error: { code, message } }: INVALID_INPUT
    // indica filtros inválidos.
    getActiveEnrollmentsByCourse: (filters) => ipcRenderer.invoke('reports:get-active-enrollments-by-course', filters),
    // Solo SECRETARIO. Reporte Alumnos activos sin inscripción de su institución: los alumnos
    // vigentes y activos sin una inscripción vigente y activa en un curso del ciclo lectivo actual,
    // por apellido y nombre. Sin filtros: la vista los aplica sobre la lista completa. Resuelve
    // { ok: true, report } con { schoolYear, students }: schoolYear, el ciclo actual, y students, cada
    // uno con los campos de students.list y lastEnrollment, su última inscripción vigente de
    // cualquier ciclo (la de fecha de inscripción más reciente): { id, status, course }, con status
    // 'ACTIVE', 'COMPLETED' o 'CANCELLED' y course { id, gradeName, educationLevel, division, shift,
    // schoolYear }, o null si nunca tuvo una. O { ok: false, error: { code, message } }.
    getStudentsWithoutEnrollment: () => ipcRenderer.invoke('reports:get-students-without-enrollment', {}),

    getReportCardCourses: () => ipcRenderer.invoke('reports:get-report-card-courses', {}),
    getReportCardStudents: (filters) => ipcRenderer.invoke('reports:get-report-card-students', filters),
    openReportCards: (filters) => ipcRenderer.invoke('reports:open-report-cards', filters),
    // Solo PROFESOR. Reporte Calificaciones pendientes de carga de sus asignaciones, siempre del ciclo
    // lectivo actual. Sin filtros: la vista los aplica sobre la lista completa. Resuelve
    // { ok: true, report } con { schoolYear, assignments, evaluations }: schoolYear, el ciclo actual;
    // assignments, sus asignaciones vigentes de ese ciclo ({ id, course, subject }, como en
    // teacherAssignments.listOwn), de donde salen las opciones de los filtros, y evaluations, sus
    // evaluaciones vigentes de esas asignaciones ya tomadas (de hoy o anteriores) de un trimestre
    // abierto con al menos un alumno pendiente: { id, title, evaluationDate ('AAAA-MM-DD'), term
    // (1, 2 o 3), teacherAssignmentId, course { id, gradeName, educationLevel, division, shift,
    // schoolYear }, subject { id, name }, pendingCount, studentCount, closingDate ('AAAA-MM-DD'),
    // daysLeft }. studentCount son los alumnos que deben tener nota en esa evaluación: inscripciones
    // vigentes y activas del curso con fecha de inscripción no posterior a la de la evaluación (las
    // finalizadas no se pueden calificar y no cuentan); pendingCount, los de esos sin calificación
    // vigente. closingDate es el último día en que todavía se puede cargar en su trimestre (07/06,
    // 07/09 o 31/12) y daysLeft, los días que faltan hasta esa fecha (0 si es hoy), los dos con la
    // fecha de la base. Ordenadas por el cierre más próximo y, después, la fecha de la evaluación, el
    // curso (nivel educativo, grado, división y turno), la materia, el título y el id; vacía si no
    // tiene pendientes. O { ok: false, error: { code, message } }.
    getPendingScores: () => ipcRenderer.invoke('reports:get-pending-scores', {}),

    // PROFESOR. Recibe { schoolYear } y devuelve la nota de aprobación y los conteos por
    // evaluación tomada de sus asignaciones vigentes. La vista aplica el criterio de revisión.
    getEvaluationFailureRates: (filters) => ipcRenderer.invoke('reports:get-evaluation-failure-rates', filters),
    getStudentFollowUp: (filters = {}) => ipcRenderer.invoke('reports:get-student-follow-up', filters),
    setStudentFollowUpAttended: (change) => ipcRenderer.invoke('reports:set-student-follow-up-attended', change),
  },
  backups: {
    // Solo ADMIN. Resuelve { ok: true, backups } con el historial de backups de su institución
    // ({ id, userName, createdAt }, con userName el nombre y el apellido de quien lo realizó, como
    // eran al realizarlo, y createdAt la fecha y la hora en ISO 8601), del más nuevo al más viejo, o
    // { ok: false, error: { code, message } }.
    list: () => ipcRenderer.invoke('backups:list'),
    // Solo ADMIN. Realiza un backup completo de los datos de su institución (usuarios, alumnos,
    // cursos, asignaciones docentes, inscripciones, evaluaciones y calificaciones, también los dados
    // de baja; sin las fotos de perfil) en un archivo comprimido de la carpeta de backups de su
    // institución, y lo registra en el historial. `format` es 'zip' o 'tar.gz'. Resuelve
    // { ok: true, backup } con el backup registrado (mismos campos que list, más fileName, el nombre
    // del archivo) o { ok: false, error: { code, message } }, sin dejar ningún archivo ni registro:
    // INVALID_INPUT indica un formato inválido; BACKUP_IN_PROGRESS, que ya hay un backup o una
    // restauración en curso; BACKUP_FILE_EXISTS, que ya hay un backup con ese nombre (dos en el mismo
    // segundo), y BACKUP_WRITE_FAILED, que no se pudo escribir el archivo en la carpeta.
    create: (format) => ipcRenderer.invoke('backups:create', format),
    // Solo ADMIN. Primer paso del restore: abre el diálogo del sistema para elegir un backup (.zip o
    // .tar.gz), en la carpeta de backups de su institución, y lo lee y lo valida sin cambiar ningún
    // dato. La ruta la elige el proceso principal: la vista no la envía ni la recibe. Resuelve
    // { ok: true, file: null } si se cancela; { ok: true, file } con el backup elegido
    // ({ fileName, createdAt, userName }: el nombre del archivo, la fecha y la hora en ISO 8601 y el
    // nombre y el apellido de quien lo realizó), que queda listo para restore, o
    // { ok: false, error: { code, message } }: BACKUP_INVALID_FILE indica que el archivo no es un
    // backup del sistema que se pueda leer (o no tiene ningún administrador activo);
    // BACKUP_OTHER_INSTITUTION, que es de otra institución (el mensaje no la nombra);
    // BACKUP_INCOMPATIBLE, que es de otra versión del sistema o de otra base de datos, y
    // BACKUP_IN_PROGRESS, que ya hay un backup o una restauración en curso. Cada elección, aunque se
    // cancele o falle, descarta la anterior.
    selectFile: () => ipcRenderer.invoke('backups:select-file'),
    // Solo ADMIN. Reemplaza todos los datos de su institución (los mismos que guarda create) por los
    // del backup elegido con selectFile, en una sola operación: si falla, no cambia nada. Resuelve
    // { ok: true } con la sesión ya cerrada: el proceso principal abre el login, que avisa que se
    // restauró el sistema. Si no, { ok: false, error: { code, message } }: BACKUP_NO_SELECTION indica
    // que no hay un backup elegido (hay que elegirlo otra vez); BACKUP_BUSY, que la base está en uso
    // y conviene reintentar en unos segundos; BACKUP_IN_PROGRESS, y los de selectFile (el backup se
    // vuelve a validar al restaurarlo). El restore no se registra en el historial.
    restore: () => ipcRenderer.invoke('backups:restore'),
  },
});
