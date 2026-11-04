// Capa ui: recorrido de todas las vistas de cada rol (cargan sin errores de consola, IPC, recursos ni
// estados de error visibles, y sus tablas muestran filas cuando la base las tiene) y bloqueo de las
// vistas de otro rol y sin sesión. Usa los usuarios y las filas del seed sin modificarlos.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { group, test } = require('../lib/framework');
const { SEED_USERS } = require('../lib/fixtures');
const { PATHS } = require('../config');
const views = require('./views.table');

function rendererViews() {
  const found = [];
  for (const area of fs.readdirSync(PATHS.renderer, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const view of fs.readdirSync(path.join(PATHS.renderer, area.name), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      if (fs.existsSync(path.join(PATHS.renderer, area.name, view.name, 'index.html'))) found.push(`${area.name}/${view.name}/index.html`);
    }
  }
  return found.sort();
}

// Ids que necesitan las vistas, leídos del seed para el usuario de la sesión.
async function contextFor(t, key) {
  const account = SEED_USERS[key];
  const user = await t.sqlOne(`
    SELECT u.usuario_id, u.institucion_id FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
     WHERE u.email = $1 AND r.nombre = $2 AND u.fecha_eliminacion IS NULL`, [account.email, account.role]);
  const ctx = { userId: user.usuario_id, institutionId: user.institucion_id };
  if (account.role === 'PROFESOR') {
    const assignment = await t.sqlOne(`
      SELECT a.asignacion_docente_id AS id, MIN(e.evaluacion_id) AS evaluation
        FROM asignacion_docente a JOIN evaluacion e ON e.asignacion_docente_id = a.asignacion_docente_id AND e.fecha_eliminacion IS NULL
       WHERE a.usuario_id = $1 AND a.fecha_eliminacion IS NULL
         AND EXISTS (SELECT 1 FROM inscripcion i JOIN inscripcion_estado ie USING (inscripcion_estado_id)
                      WHERE i.curso_id = a.curso_id AND i.fecha_eliminacion IS NULL AND ie.nombre IN ('ACTIVA', 'FINALIZADA'))
       GROUP BY a.asignacion_docente_id ORDER BY a.asignacion_docente_id LIMIT 1`, [ctx.userId]);
    t.require(assignment, 'El seed no tiene una asignación del profesor con evaluaciones y alumnos para recorrer sus vistas');
    Object.assign(ctx, { assignmentId: assignment.id, evaluationId: assignment.evaluation });
  }
  return ctx;
}

const withQuery = (viewPath, query) => (query ? `${viewPath}?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}` : viewPath);

async function walk(t, key) {
  const { ui } = t;
  const role = SEED_USERS[key].role;
  await t.login(key);
  const ctx = await contextFor(t, key);
  const visited = [];
  for (const [viewPath, spec] of Object.entries(views)) {
    if (!spec.roles?.includes(role)) continue;
    await t.step(viewPath, async () => {
      const landed = await ui.navigate(withQuery(viewPath, spec.query?.(ctx)));
      t.check(landed === viewPath, `${viewPath}: la guardia no dejó abrir la vista del propio rol (quedó en ${landed})`);
      visited.push(viewPath);
      if (spec.rows) {
        const [sql, params] = spec.rows.sql(ctx);
        const expected = (await t.sql(sql, params)).length;
        if (expected > 0) {
          const shown = await ui.waitFor(`document.querySelectorAll(${JSON.stringify(spec.rows.selector)}).length > 0`, { timeoutMs: 6000 });
          t.check(shown, `${viewPath}: la tabla quedó vacía y la base tiene ${expected} filas para mostrar`);
        }
      }
      const links = await ui.js(`Array.from(document.querySelectorAll('a[href]'), (a) => a.href).filter((href) => href.startsWith('file:'))`);
      for (const href of links) {
        const file = fileURLToPath(href.split(/[?#]/)[0]);
        t.check(fs.existsSync(file), `${viewPath}: el enlace a ${path.relative(PATHS.root, file)} no lleva a ningún archivo`);
      }
      await ui.dismissToasts();
    });
  }
  t.check(visited.length > 0, `${role} no tiene vistas en views.table.js`);
  await t.logout();
}

group('ui.views', 'Recorrido de las vistas y bloqueo por rol', () => {
  test('table-matches-renderer', 'views.table.js tiene una fila por cada vista de renderer/', async (t) => {
    t.equal(Object.keys(views).sort(), rendererViews(), 'Vistas de renderer/ y de views.table.js');
  });

  test('walk-anonymous', 'Sin sesión, el login carga sin errores', async (t) => {
    const landed = await t.ui.navigate('auth/login/index.html');
    t.equal(landed, 'auth/login/index.html', 'El login abre sin sesión');
  });

  test('walk-admin', 'Todas las vistas del Administrador cargan sin errores y con sus datos', async (t) => walk(t, 'admin'));
  test('walk-secretary', 'Todas las vistas del Secretario cargan sin errores y con sus datos', async (t) => walk(t, 'secretary'));
  test('walk-teacher', 'Todas las vistas del Profesor cargan sin errores y con sus datos', async (t) => walk(t, 'teacher'));

  test('blocked-views', 'Ningún rol abre las vistas de otro, y sin sesión solo se abre el login', async (t) => {
    const { ui } = t;
    const privateViews = Object.entries(views).filter(([, spec]) => spec.roles);
    await t.logout();
    await ui.navigate('auth/login/index.html');
    for (const [viewPath] of privateViews) {
      const result = await ui.tryNavigate(viewPath);
      t.check(result.view === 'auth/login/index.html', `Sin sesión se abrió ${viewPath}`, result);
    }
    const outsideViews = ['shared/styles/base.css', 'shared/components/sidebar.js'];
    for (const key of ['admin', 'secretary', 'teacher']) {
      const role = SEED_USERS[key].role;
      await t.login(key);
      const ctx = await contextFor(t, key);
      const home = { ADMIN: 'admin/dashboard/index.html', SECRETARIO: 'secretary/dashboard/index.html', PROFESOR: 'teacher/assignments/index.html' }[role];
      await ui.navigate(home);
      for (const [viewPath, spec] of privateViews.filter(([, candidate]) => !candidate.roles.includes(role))) {
        const result = await ui.tryNavigate(withQuery(viewPath, spec.query?.(ctx)));
        t.check(result.view === home && result.sameDocument, `${role} pudo abrir ${viewPath}`, result);
      }
      for (const outside of outsideViews) {
        const result = await ui.tryNavigate(outside);
        t.check(result.view === home && result.sameDocument, `${role} pudo abrir ${outside} como vista`, result);
      }
      await t.logout();
    }
  });
});
