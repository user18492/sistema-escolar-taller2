// Tabla de permisos de los canales IPC, como datos: qué roles pueden llamar cada canal que expone el
// preload ('public': sin sesión). La matriz de permissions.test.js la recorre con cada rol y sin
// sesión. Un canal nuevo del preload sin fila acá hace fallar main.permissions.table-matches-preload.
//
// `args`: argumentos inofensivos para la matriz: ids que no existen o datos vacíos, para que un rol
// con permiso reciba un rechazo de validación o "no existe" y nada cambie en la base.
// `matrix: false`: el canal no se llama en la matriz con sesión (cambiaría la sesión o la ventana);
// se prueba en su propio caso de uso.
const ROLES = ['ADMIN', 'SECRETARIO', 'PROFESOR'];
const NO_ID = 2147483000;

module.exports = {
  ROLES,
  NO_ID,
  channels: {
    'auth:login': { roles: 'public', args: [], matrix: false },
    'auth:select-institution': { roles: 'public', args: [], matrix: false },
    'auth:get-current-user': { roles: 'public', args: [] },
    'auth:logout': { roles: 'public', args: [], matrix: false },
    'auth:get-remembered-email': { roles: 'public', args: [] },
    'auth:forget-remembered-email': { roles: 'public', args: [] },
    'window:is-maximized': { roles: 'public', args: [] },
    'window:minimize': { roles: 'public', args: [], matrix: false },
    'window:toggle-maximize': { roles: 'public', args: [], matrix: false },
    'window:close': { roles: 'public', args: [], matrix: false },

    'profile:get': { roles: ROLES, args: [] },
    'profile:update': { roles: ROLES, args: [{}] },
    'profile:delete': { roles: ROLES, args: [], destructive: true },

    'users:list': { roles: ['ADMIN'], args: [] },
    'users:create': { roles: ['ADMIN'], args: [{}] },
    'users:update': { roles: ['ADMIN'], args: [NO_ID, {}] },
    'users:delete': { roles: ['ADMIN'], args: [NO_ID] },
    'users:restore': { roles: ['ADMIN'], args: [NO_ID] },

    'courses:list': { roles: ['ADMIN'], args: [] },
    'courses:create': { roles: ['ADMIN'], args: [{}] },
    'courses:update': { roles: ['ADMIN'], args: [NO_ID, {}] },
    'courses:delete': { roles: ['ADMIN'], args: [NO_ID] },
    'grades:list': { roles: ['ADMIN'], args: [] },

    'teacher-assignments:list': { roles: ['ADMIN'], args: [] },
    'teacher-assignments:list-assignable-teachers': { roles: ['ADMIN'], args: [] },
    'teacher-assignments:list-assignable-courses': { roles: ['ADMIN'], args: [] },
    'teacher-assignments:list-assignable-subjects': { roles: ['ADMIN'], args: [NO_ID] },
    'teacher-assignments:create': { roles: ['ADMIN'], args: [{}] },
    'teacher-assignments:update': { roles: ['ADMIN'], args: [NO_ID, {}] },
    'teacher-assignments:delete': { roles: ['ADMIN'], args: [NO_ID] },
    'teacher-assignments:list-own': { roles: ['PROFESOR'], args: [] },
    'teacher-assignments:get-own': { roles: ['PROFESOR'], args: [NO_ID] },

    'students:list': { roles: ['SECRETARIO'], args: [] },
    'students:create': { roles: ['SECRETARIO'], args: [{}] },
    'students:update': { roles: ['SECRETARIO'], args: [NO_ID, {}] },
    'students:delete': { roles: ['SECRETARIO'], args: [NO_ID] },
    'students:restore': { roles: ['SECRETARIO'], args: [NO_ID] },

    'enrollments:list': { roles: ['SECRETARIO'], args: [{}, 1, 10] },
    'enrollments:list-filter-options': { roles: ['SECRETARIO'], args: [] },
    'enrollments:list-enrollable-students': { roles: ['SECRETARIO'], args: [] },
    'enrollments:list-enrollable-courses': { roles: ['SECRETARIO'], args: [] },
    'enrollments:create': { roles: ['SECRETARIO'], args: [{}] },
    'enrollments:get': { roles: ['SECRETARIO'], args: [NO_ID] },
    'enrollments:update': { roles: ['SECRETARIO'], args: [NO_ID, {}] },
    'enrollments:delete': { roles: ['SECRETARIO'], args: [NO_ID] },
    'enrollments:open-receipt': { roles: ['SECRETARIO'], args: [NO_ID] },
    'enrollments:list-by-own-assignment': { roles: ['PROFESOR'], args: [NO_ID] },

    'evaluations:list-by-own-assignment': { roles: ['PROFESOR'], args: [NO_ID] },
    'evaluations:create': { roles: ['PROFESOR'], args: [NO_ID, {}] },
    'evaluations:update': { roles: ['PROFESOR'], args: [NO_ID, NO_ID, {}] },
    'evaluations:delete': { roles: ['PROFESOR'], args: [NO_ID, NO_ID] },

    'scores:list-by-own-evaluation': { roles: ['PROFESOR'], args: [NO_ID, NO_ID] },
    'scores:save': { roles: ['PROFESOR'], args: [NO_ID, NO_ID, {}] },
    'scores:delete': { roles: ['PROFESOR'], args: [NO_ID, NO_ID, NO_ID] },

    'dashboard:get-admin-summary': { roles: ['ADMIN'], args: [] },
    'dashboard:get-secretary-summary': { roles: ['SECRETARIO'], args: [] },
  },
};
