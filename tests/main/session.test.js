// Capa main: flujos comunes a los tres roles por la API del preload, comprobando el resultado en la
// base. Login con elección de cuenta, cuenta recordada, cierre de sesión, corte de la sesión de una
// cuenta suspendida o dada de baja y Configuración de perfil.
const fs = require('node:fs');
const path = require('node:path');
const { group, test } = require('../lib/framework');
const { SEED_USERS, SEED_INSTITUTIONS } = require('../lib/fixtures');
const { PATHS } = require('../config');

const bcrypt = require(require.resolve('bcrypt', { paths: [PATHS.root] }));
const SESSION_USER_KEYS = ['firstName', 'imageUrl', 'institutionName', 'lastName', 'role'];

group('main.session', 'Sesión: login, cuentas, cuenta recordada y corte de sesión', {
  async setup({ fixtures }) {
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const secretary = await fixtures.createUser({ role: 'SECRETARIO' });
    return { teacher, secretary };
  },
}, () => {
  test('login-single-account', 'Cada rol inicia sesión con una cuenta, la sesión informa sus datos sin ids ni email, y el cierre la termina', async (t) => {
    for (const key of ['admin', 'secretary', 'teacher']) {
      const account = SEED_USERS[key];
      const user = await t.login(key);
      const row = await t.sqlOne(`
        SELECT u.nombre, u.apellido, r.nombre AS rol, i.nombre AS institucion FROM usuario u
          JOIN usuario_rol r USING (usuario_rol_id) JOIN institucion i USING (institucion_id)
         WHERE u.email = $1 AND r.nombre = $2 AND u.fecha_eliminacion IS NULL`, [account.email, account.role]);
      t.equal({ firstName: user.firstName, lastName: user.lastName, role: user.role, institutionName: user.institutionName },
        { firstName: row.nombre, lastName: row.apellido, role: row.rol, institutionName: row.institucion }, `${key}: datos de la sesión`);
      t.equal(Object.keys(user).sort(), SESSION_USER_KEYS, `${key}: la sesión expone solo los datos de la interfaz`);
      t.equal(await t.call('auth.getCurrentUser'), user, `${key}: getCurrentUser informa la sesión`);
      await t.logout();
      t.equal(await t.call('auth.getCurrentUser'), null, `${key}: sin sesión después de cerrarla`);
    }
  });

  test('login-account-choice', 'Con varias cuentas, el login las ofrece y la sesión se inicia con la elegida', async (t) => {
    const twoRoles = await t.call('auth.login', SEED_USERS.twoRoles.email, SEED_USERS.twoRoles.password, false);
    t.require(twoRoles?.ok && Array.isArray(twoRoles.institutions), 'Con dos roles, el login ofrece elegir la cuenta', twoRoles);
    t.equal(twoRoles.institutions.map((option) => option.role).sort(), ['PROFESOR', 'SECRETARIO'], 'Ofrece una cuenta por rol');
    t.equal(new Set(twoRoles.institutions.map((option) => option.id)).size, 1, 'Las dos cuentas son de la misma institución');
    t.equal(await t.call('auth.getCurrentUser'), null, 'Mientras no elige, no hay sesión');
    const teacherOption = twoRoles.institutions.find((option) => option.role === 'PROFESOR');
    const chosen = await t.ok('auth.selectInstitution', teacherOption.id, 'PROFESOR', false);
    t.equal(chosen.user?.role, 'PROFESOR', 'La sesión es la de la cuenta elegida');
    await t.rejects('NO_PENDING_LOGIN', 'auth.selectInstitution', teacherOption.id, 'SECRETARIO', false);
    await t.logout();

    const twoInstitutions = await t.call('auth.login', SEED_USERS.twoInstitutions.email, SEED_USERS.twoInstitutions.password, false);
    t.require(twoInstitutions?.ok && twoInstitutions.institutions?.length === 2, 'En dos instituciones, el login ofrece las dos', twoInstitutions);
    const mb = await t.sqlOne(`SELECT institucion_id, nombre FROM institucion WHERE cuit = $1`, [SEED_INSTITUTIONS.MB]);
    const option = twoInstitutions.institutions.find((candidate) => candidate.id === mb.institucion_id);
    t.require(option, 'Una de las opciones es el Colegio Manuel Belgrano', twoInstitutions);
    const selected = await t.ok('auth.selectInstitution', option.id, option.role, false);
    t.equal(selected.user?.institutionName, mb.nombre, 'La sesión es de la institución elegida');
    await t.logout();
  });

  test('logout-discards-pending', 'Cerrar sesión descarta un login a la espera de elegir la cuenta', async (t) => {
    const pending = await t.call('auth.login', SEED_USERS.twoRoles.email, SEED_USERS.twoRoles.password, false);
    t.require(pending?.institutions, 'El login quedó a la espera de la elección', pending);
    await t.logout();
    await t.rejects('NO_PENDING_LOGIN', 'auth.selectInstitution', pending.institutions[0].id, pending.institutions[0].role, false);
  });

  test('login-rejections', 'Credenciales inválidas, cuenta suspendida y cuenta dada de baja no inician sesión', async (t) => {
    await t.rejects('INVALID_CREDENTIALS', 'auth.login', SEED_USERS.admin.email, 'Clave-Incorrecta-123', false);
    await t.rejects('INVALID_CREDENTIALS', 'auth.login', 'nadie.registrado@prueba.edu.ar', 'Clave-Incorrecta-123', false);
    await t.rejects('INVALID_INPUT', 'auth.login', 'no-es-un-email', 'Clave-Incorrecta-123', false);
    await t.rejects('INACTIVE_USER', 'auth.login', SEED_USERS.suspended.email, SEED_USERS.suspended.password, false);
    await t.rejects('INVALID_CREDENTIALS', 'auth.login', SEED_USERS.deleted.email, SEED_USERS.deleted.password, false);
    t.equal(await t.call('auth.getCurrentUser'), null, 'Ningún intento dejó una sesión');
  });

  test('remembered-account', 'La cuenta recordada guarda solo el email en los datos de la aplicación, sobrevive al cierre de sesión y se olvida', async (t) => {
    const file = path.join(t.harness.userData, 'remembered-account.json');
    t.equal(await t.call('auth.getRememberedEmail'), null, 'Al empezar no hay cuenta recordada');
    await t.login('secretary', { remember: true });
    t.equal(await t.call('auth.getRememberedEmail'), SEED_USERS.secretary.email, 'Recuerda el email');
    t.equal(JSON.parse(fs.readFileSync(file, 'utf8')), { email: SEED_USERS.secretary.email }, 'El archivo guarda solo el email');
    await t.logout();
    t.equal(await t.call('auth.getRememberedEmail'), SEED_USERS.secretary.email, 'Cerrar sesión no la olvida');
    await t.login('admin', { remember: false });
    t.equal(await t.call('auth.getRememberedEmail'), null, 'Un acceso sin "Recordar" la olvida');
    await t.logout();
    await t.login('teacher', { remember: true });
    await t.call('auth.forgetRememberedEmail');
    t.equal(await t.call('auth.getRememberedEmail'), null, 'forgetRememberedEmail la olvida');
    t.check(!fs.existsSync(file), 'El archivo de la cuenta recordada se borró');
    await t.logout();
  });

  test('suspended-session-cut', 'La sesión de una cuenta suspendida o dada de baja desde otra PC se corta en la próxima operación', async (t) => {
    for (const [key, change] of [['teacher', 'estado = false'], ['secretary', 'estado = false, fecha_eliminacion = now()']]) {
      const user = t.data[key];
      await t.login(user);
      await t.ui.navigate(user.role === 'PROFESOR' ? 'teacher/assignments/index.html' : 'secretary/dashboard/index.html');
      await t.db.query(`UPDATE usuario SET ${change} WHERE usuario_id = $1`, [user.id]);
      const apiPath = user.role === 'PROFESOR' ? 'teacherAssignments.listOwn' : 'students.list';
      t.allowRejection(t.channelOf(apiPath), 'ACCOUNT_SUSPENDED', 'la cuenta se suspendió desde otra PC');
      const value = await t.call(apiPath);
      t.check(value?.error?.code === 'ACCOUNT_SUSPENDED', `${key}: la operación responde ACCOUNT_SUSPENDED`, value);
      await t.ui.waitForView('auth/login/index.html');
      t.check(t.ui.url().includes('notice=account-suspended'), `${key}: la ventana volvió al login con el aviso`, t.ui.url());
      t.equal(await t.call('auth.getCurrentUser'), null, `${key}: la sesión quedó cerrada`);
      if (change.includes('fecha_eliminacion')) continue;
      await t.db.query(`UPDATE usuario SET estado = true WHERE usuario_id = $1`, [user.id]);
    }
  });
});

group('main.profile', 'Configuración de perfil de cada rol', {
  async setup({ fixtures }) {
    const users = {};
    for (const role of ['ADMIN', 'SECRETARIO', 'PROFESOR']) users[role] = await fixtures.createUser({ role });
    const institution = await fixtures.createInstitution();
    const onlyAdmin = await fixtures.createUser({ institutionId: institution.id, role: 'ADMIN' });
    const assignedTeacher = await fixtures.createUser({ role: 'PROFESOR' });
    const course = await fixtures.createCourse();
    await fixtures.assign({ teacherId: assignedTeacher.id, courseId: course.id });
    const otherSecretary = await fixtures.createUser({ role: 'SECRETARIO' });
    return { users, onlyAdmin, assignedTeacher, otherSecretary };
  },
}, () => {
  test('get-and-update', 'Cada rol lee su perfil de la base y guarda nombre, apellido y contraseña', async (t) => {
    for (const [role, user] of Object.entries(t.data.users)) {
      await t.login(user);
      const { profile } = await t.ok('profile.get');
      t.equal(profile, { firstName: user.firstName, lastName: user.lastName, dni: user.dni, email: user.email, birthDate: user.birthDate, imageUrl: null },
        `${role}: profile.get devuelve los datos de la base`);
      const newPassword = `Nueva#${role}Clave7`;
      const data = { ...profile, firstName: 'Cambiado', lastName: `Perfil${role === 'ADMIN' ? 'a' : role === 'SECRETARIO' ? 'b' : 'c'}`, newPassword, repeatPassword: newPassword, image: null, removeImage: false };
      delete data.imageUrl;
      const updated = await t.ok('profile.update', data);
      const row = await t.sqlOne(`SELECT nombre, apellido, password_hash FROM usuario WHERE usuario_id = $1`, [user.id]);
      t.equal({ nombre: row.nombre, apellido: row.apellido }, { nombre: data.firstName, apellido: data.lastName }, `${role}: la base guardó el nombre`);
      t.check(await bcrypt.compare(newPassword, row.password_hash), `${role}: la base guardó el hash de la contraseña nueva`);
      t.equal(updated.profile?.firstName, data.firstName, `${role}: la respuesta trae el perfil como quedó`);
      t.equal((await t.call('auth.getCurrentUser'))?.firstName, data.firstName, `${role}: la sesión informa el nombre nuevo`);
      await t.logout();
      await t.login({ email: user.email, password: newPassword });
      await t.logout();
      user.password = newPassword;
    }
  });

  test('update-duplicate', 'El email de otro usuario vigente con el mismo rol se rechaza sin guardar nada', async (t) => {
    const user = t.data.users.SECRETARIO;
    await t.login(user);
    const { profile } = await t.ok('profile.get');
    const before = await t.sqlOne(`SELECT email FROM usuario WHERE usuario_id = $1`, [user.id]);
    const data = { ...profile, email: t.data.otherSecretary.email, newPassword: '', repeatPassword: '', image: null, removeImage: false };
    delete data.imageUrl;
    const value = await t.rejects('DUPLICATE_VALUE', 'profile.update', data);
    t.check(value?.error?.fieldErrors?.email, 'El rechazo marca el campo email', value);
    t.equal(await t.sqlOne(`SELECT email FROM usuario WHERE usuario_id = $1`, [user.id]), before, 'El email no cambió');
    await t.logout();
  });

  test('delete-guards', 'El único administrador activo y un profesor con asignaciones del ciclo actual no pueden darse de baja', async (t) => {
    await t.login(t.data.onlyAdmin);
    await t.rejects('LAST_ADMIN', 'profile.delete');
    t.check((await t.call('auth.getCurrentUser')) !== null, 'La sesión sigue abierta');
    await t.logout();
    await t.login(t.data.assignedTeacher);
    await t.rejects('USER_HAS_TEACHER_ASSIGNMENTS', 'profile.delete');
    await t.logout();
    const rows = await t.sql(`SELECT estado, fecha_eliminacion FROM usuario WHERE usuario_id IN ($1, $2)`, [t.data.onlyAdmin.id, t.data.assignedTeacher.id]);
    t.check(rows.every((row) => row.estado && !row.fecha_eliminacion), 'Ninguna de las dos cuentas cambió', rows);
  });

  test('delete-own-account', 'La baja de la propia cuenta la deja suspendida y dada de baja, y cierra la sesión', async (t) => {
    const user = t.data.otherSecretary;
    await t.login(user);
    await t.ok('profile.delete');
    t.equal(await t.sqlOne(`SELECT estado, fecha_eliminacion IS NOT NULL AS baja FROM usuario WHERE usuario_id = $1`, [user.id]), { estado: false, baja: true }, 'Cuenta suspendida y dada de baja');
    t.equal(await t.call('auth.getCurrentUser'), null, 'La sesión quedó cerrada');
    await t.rejects('INVALID_CREDENTIALS', 'auth.login', user.email, user.password, false);
  });
});
