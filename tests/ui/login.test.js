// Capa ui: el login con mouse y teclado reales. Elección de la cuenta, cuenta recordada, cierre de
// sesión desde el menú del perfil, credenciales inválidas y el aviso de una sesión cortada.
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { loginViaUi, logoutViaUi } = require('./helpers');

group('ui.login', 'Login con la interfaz', {
  async setup({ fixtures }) {
    return { secretary: await fixtures.createUser({ role: 'SECRETARIO' }) };
  },
}, () => {
  test('account-choice-and-remember', 'Con dos cuentas se elige una; "Recordar mi cuenta" deja el email listo después de cerrar sesión', async (t) => {
    const { ui } = t;
    const accounts = await t.sql(`
      SELECT u.institucion_id, r.nombre AS rol FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
       WHERE u.email = $1 AND u.fecha_eliminacion IS NULL`, [SEED_USERS.twoRoles.email]);
    const teacherAccount = accounts.find((account) => account.rol === 'PROFESOR');
    await loginViaUi(t, SEED_USERS.twoRoles, { remember: true, choose: { institutionId: teacherAccount.institucion_id, role: 'PROFESOR' } });
    t.equal((await t.call('auth.getCurrentUser'))?.role, 'PROFESOR', 'La sesión es la de la cuenta elegida');
    await logoutViaUi(t);
    await ui.idle();
    t.equal(await ui.value('#loginEmail'), SEED_USERS.twoRoles.email, 'El login muestra el email recordado');
    t.check(await ui.js(`document.getElementById('rememberAccount').checked`), 'La casilla queda marcada');
    t.check(await ui.js(`document.activeElement === document.getElementById('loginPassword')`), 'El foco queda en la contraseña');
    // Desmarcar la casilla la olvida en el momento
    await ui.click('.login-remember');
    await ui.idle();
    t.equal(await t.call('auth.getRememberedEmail'), null, 'Desmarcar "Recordar mi cuenta" olvida el email');
  });

  test('invalid-credentials', 'Credenciales incorrectas: el login avisa, sigue en la misma vista y deja la contraseña seleccionada', async (t) => {
    const { ui } = t;
    t.allowRejection('auth:login', 'INVALID_CREDENTIALS', 'contraseña incorrecta a propósito');
    await loginViaUi(t, { email: SEED_USERS.admin.email, password: 'Incorrecta#2026x' }, { expectHome: false });
    await ui.waitFor(`!document.getElementById('loginError').hidden`, { message: 'El login no mostró el error' });
    t.equal(ui.view(), 'auth/login/index.html', 'Sigue en el login');
    t.check(await ui.js(`(() => { const p = document.getElementById('loginPassword'); return document.activeElement === p && p.selectionStart === 0 && p.selectionEnd === p.value.length && p.value.length > 0; })()`),
      'La contraseña queda seleccionada para reescribirla');
    t.equal(await t.call('auth.getCurrentUser'), null, 'No hay sesión');
  });

  test('suspended-session-cut', 'Si la cuenta se suspende desde otra PC, la próxima vista vuelve al login con el aviso', async (t) => {
    const { ui } = t;
    const user = t.data.secretary;
    await loginViaUi(t, user);
    await t.db.query(`UPDATE usuario SET estado = false WHERE usuario_id = $1`, [user.id]);
    t.allowRejection('*', 'ACCOUNT_SUSPENDED', 'la cuenta se suspendió desde otra PC');
    await ui.click('.sidebar-nav a.nav-item[href$="/secretary/students/index.html"]');
    t.require(await ui.waitForView('auth/login/index.html'), 'La ventana no volvió al login', ui.view());
    t.check(ui.url().includes('notice=account-suspended'), 'El login recibe el aviso de la suspensión', ui.url());
    await ui.waitFor(`!document.getElementById('loginError').hidden`, { message: 'El login no mostró el aviso' });
    t.equal(await t.call('auth.getCurrentUser'), null, 'La sesión quedó cerrada');
  });
});
