// Pasos de interfaz que comparten las pruebas de la capa ui, siempre con mouse y teclado reales.
const HOME_BY_ROLE = {
  ADMIN: 'admin/dashboard/index.html',
  SECRETARIO: 'secretary/dashboard/index.html',
  PROFESOR: 'teacher/assignments/index.html',
};

// Inicia sesión desde la vista del login. `choose` ({ institutionId, role }) elige la cuenta si las
// credenciales tienen varias. Espera la vista inicial del rol.
async function loginViaUi(t, { email, password, role }, { remember = false, choose, expectHome = true } = {}) {
  const { ui } = t;
  if (ui.view() !== 'auth/login/index.html') await ui.navigate('auth/login/index.html');
  await ui.idle();
  await ui.fill('#loginEmail', email);
  await ui.fill('#loginPassword', password);
  const checked = await ui.js(`document.getElementById('rememberAccount').checked`);
  if (checked !== remember) await ui.click('.login-remember');
  await ui.press('Enter');
  if (choose) {
    await ui.waitFor(`!document.getElementById('institutionStep').hidden`, { message: 'No apareció la elección de la cuenta' });
    await ui.click(`.institution-option[data-institution-id="${choose.institutionId}"][data-role="${choose.role}"]`);
  }
  if (!expectHome) return;
  const home = HOME_BY_ROLE[choose?.role ?? role];
  t.require(await ui.waitForView(home, { timeoutMs: 10000 }), `El login no abrió la vista inicial ${home}`, ui.view());
  await ui.idle();
}

// Cierra la sesión desde el menú del perfil del menú lateral.
async function logoutViaUi(t) {
  const { ui } = t;
  await ui.dismissToasts();
  await ui.click('.sidebar-profile .profile-button');
  await ui.waitFor(`document.getElementById('profilePanel').classList.contains('is-open')`, { message: 'No se abrió el menú del perfil' });
  await ui.click('#profilePanel [data-action="logout"]');
  t.require(await ui.waitForView('auth/login/index.html'), 'Cerrar sesión no volvió al login', ui.view());
  await ui.idle();
}

// Abre una vista desde el menú lateral, como el usuario. `viewPath` es la ruta dentro de renderer/
// ('admin/courses/index.html').
async function openFromSidebar(t, viewPath) {
  const { ui } = t;
  await ui.dismissToasts();
  await ui.click(`.sidebar-nav a.nav-item[href$="/${viewPath}"]`);
  t.require(await ui.waitForView(viewPath), `El menú lateral no abrió ${viewPath}`, ui.view());
  await ui.idle();
}

// Elige una opción de un desplegable simple (.dropdown) de un modal.
async function pickDropdown(t, dropdownSelector, value) {
  await t.ui.click(`${dropdownSelector} .dropdown-toggle`, { scroll: false });
  await t.ui.chooseOption(`${dropdownSelector} .dropdown-option[data-value="${value}"]`);
}

// Elige una opción de un buscador (.dropdown-searchable): abre la lista, escribe `search` (si llega)
// y hace clic en la opción con ese data-value.
async function pickSearchable(t, rootSelector, value, search) {
  await t.ui.click(`${rootSelector} .searchable-chevron`, { scroll: false });
  if (search) await t.ui.type(search);
  await t.ui.chooseOption(`${rootSelector} .dropdown-option[data-value="${value}"]`);
}

async function waitEnabled(t, selector, label) {
  await t.ui.waitFor(`document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`, { message: `${label} no se habilitó` });
}

module.exports = { HOME_BY_ROLE, loginViaUi, logoutViaUi, openFromSidebar, pickDropdown, pickSearchable, waitEnabled };
