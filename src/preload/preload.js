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
  // Si la cuenta de la sesión fue suspendida o dada de baja, las operaciones de users y de courses
  // resuelven { ok: false, error: { code: 'ACCOUNT_SUSPENDED', message } } y el proceso principal
  // cierra la sesión y vuelve al login.
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
    // Solo ADMIN. Resuelve { ok: true, courses } con los cursos de su institución, de todos los ciclos
    // lectivos ({ id, gradeName, educationLevel, division, shift, schoolYear }, con gradeName el nombre
    // del grado, 1° a 6°, educationLevel 'PRIMARY' o 'SECONDARY', division una letra mayúscula, shift
    // 'MORNING' o 'AFTERNOON' y schoolYear el año del ciclo lectivo), o
    // { ok: false, error: { code, message } }. Llegan siempre en el mismo orden: ciclo lectivo (el más
    // reciente primero), nivel educativo (primaria antes que secundaria), grado, división y turno.
    list: () => ipcRenderer.invoke('courses:list'),
  },
});
