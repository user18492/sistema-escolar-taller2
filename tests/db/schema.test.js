// Capa de base de datos (sin Electron): el esquema y el seed cargan limpios, las convenciones de
// nombres que usa la aplicación para traducir los errores, el inventario de objetos y las filas del
// seed de las que dependen las demás capas.
const fs = require('node:fs');
const path = require('node:path');
const { group, test } = require('../lib/framework');
const { PATHS } = require('../config');
const { readInventory, readTriggerDetails, diffInventory } = require('../lib/inventory');
const { SEED_USERS } = require('../lib/fixtures');

const bcrypt = require(require.resolve('bcrypt', { paths: [PATHS.root] }));

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

group('db.schema', 'Esquema y seed', () => {
  test('load-clean', 'db/schema.sql y db/seed.sql cargan sin errores ni avisos, como setup-db.ps1', async (t) => {
    const output = JSON.parse(fs.readFileSync(path.join(t.runDir, 'template.json'), 'utf8'));
    for (const file of ['schema', 'seed']) {
      t.check(!output[file].stderr.trim(), `${file}.sql escribió avisos o errores en psql`, output[file].stderr);
      t.check(!output[file].stdout.trim(), `${file}.sql escribió salida en psql (con --quiet solo salen los avisos)`, output[file].stdout);
    }
  });

  test('naming-conventions', 'Restricciones, índices, triggers y procedimientos siguen las convenciones de db/schema.sql', async (t) => {
    const constraints = await t.sql(`
      SELECT con.conname AS name, con.contype AS type, rel.relname AS "table"
        FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = con.connamespace
       WHERE n.nspname = 'public' AND con.contype IN ('p', 'f', 'u', 'c')`);
    const prefixes = { p: 'pk_', f: 'fk_', u: 'uq_', c: 'ck_' };
    for (const c of constraints) {
      const expected = c.type === 'p' ? `pk_${c.table}` : `${prefixes[c.type]}${c.table}_`;
      t.check(c.type === 'p' ? c.name === expected : c.name.startsWith(expected), `La restricción ${c.name} no sigue la convención ${expected}…`);
    }
    const indexes = await t.sql(`
      SELECT i.relname AS name, t.relname AS "table", ix.indisunique AS "unique",
             EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid) AS of_constraint
        FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public'`);
    for (const index of indexes.filter((ix) => !ix.of_constraint)) {
      const expected = index.unique ? `uq_${index.table}_` : `idx_${index.table}_`;
      t.check(index.name.startsWith(expected), `El índice ${index.name} no sigue la convención ${expected}…`);
    }
    for (const trigger of await readTriggerDetails(t.db)) {
      t.check(trigger.trigger.startsWith(`trg_${trigger.table}_`), `El trigger ${trigger.trigger} no empieza con trg_${trigger.table}_`);
      t.check(trigger.function === `fn_${trigger.trigger.slice(4)}`, `El trigger ${trigger.trigger} usa ${trigger.function} y no fn_${trigger.trigger.slice(4)}`);
    }
    const procedures = await t.sql(`
      SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'p'`);
    for (const procedure of procedures) t.check(procedure.name.startsWith('sp_'), `El procedimiento ${procedure.name} no empieza con sp_`);
  });

  test('app-constraint-names', 'Toda restricción que el código del proceso principal nombra existe en la base', async (t) => {
    // Los repositorios traducen los errores de PostgreSQL por el nombre de la restricción: si un
    // plan la renombra o la quita, la operación devolvería un error genérico sin que nada se rompa a
    // la vista.
    const referenced = new Map();
    for (const file of listJsFiles(path.join(PATHS.root, 'src', 'main'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/['"`]((?:uq|ck|fk|pk)_[a-z0-9_]+)['"`]/g)) {
        if (!referenced.has(match[1])) referenced.set(match[1], path.relative(PATHS.root, file));
      }
    }
    const known = new Set((await t.sql(`
      SELECT conname AS name FROM pg_constraint
      UNION SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).map((row) => row.name));
    const raised = (await t.sql(`
      SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'`)).flatMap((row) => [...row.def.matchAll(/CONSTRAINT\s*=\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));
    raised.forEach((name) => known.add(name));
    t.check(referenced.size > 0, 'No se encontró ningún nombre de restricción en src/main (¿cambió la forma de traducir los errores?)');
    for (const [name, file] of referenced) t.check(known.has(name), `${file} nombra ${name}, que no existe en la base`);
  });

  test('inventory', 'Inventario del esquema: tablas, columnas, restricciones, índices, triggers, funciones y procedimientos', async (t) => {
    const inventory = await readInventory(t.db);
    t.emit({ type: 'inventory', inventory });
    for (const kind of ['tables', 'constraints', 'triggers', 'functions', 'procedures']) {
      t.check(Object.keys(inventory[kind]).length > 0, `El inventario no tiene ${kind}`);
    }
  });

  test('inventory-no-removals', 'Ninguna restricción, índice, trigger, función ni procedimiento de la línea base desapareció', {
    kind: 'current',
    affectedBy: ['*'],
  }, async (t) => {
    // Un plan puede reemplazar o renombrar una regla: entonces esta falla es esperable, se revisa y
    // se actualiza la línea base. Sin un plan que lo explique, una regla que falta es una regresión.
    if (!fs.existsSync(PATHS.baseline)) return t.warn('No hay línea base: no se comparó el inventario');
    const baseline = JSON.parse(fs.readFileSync(PATHS.baseline, 'utf8'));
    const diff = diffInventory(baseline.inventory, await readInventory(t.db));
    for (const kind of ['tables', 'columns', 'constraints', 'indexes', 'triggers', 'functions', 'procedures']) {
      for (const name of diff[kind]?.removed ?? []) t.fail(`Falta ${kind}: ${name} (estaba en la línea base del commit ${baseline.commit})`);
    }
  });

  test('seed-users', 'Los usuarios del seed con los que inician sesión las demás capas existen con su contraseña y su estado', async (t) => {
    const expectations = [
      ['admin', { active: true, role: 'ADMIN' }],
      ['secretary', { active: true, role: 'SECRETARIO' }],
      ['teacher', { active: true, role: 'PROFESOR' }],
      ['twoRoles', { accounts: ['PROFESOR', 'SECRETARIO'] }],
      ['twoInstitutions', { institutions: 2 }],
      ['suspended', { active: false, deleted: false }],
      ['deleted', { deleted: true }],
    ];
    for (const [key, expected] of expectations) {
      const user = SEED_USERS[key];
      const rows = await t.sql(`
        SELECT u.estado, u.fecha_eliminacion IS NOT NULL AS deleted, u.password_hash, r.nombre AS role, u.institucion_id
          FROM usuario u JOIN usuario_rol r USING (usuario_rol_id) WHERE u.email = $1 ORDER BY r.nombre`, [user.email]);
      if (!t.check(rows.length > 0, `No existe ${user.email} en el seed`)) continue;
      for (const row of rows) t.check(await bcrypt.compare(user.password, row.password_hash), `La contraseña de ${user.email} (${row.role}) no es la de tests/lib/fixtures.js`);
      if (expected.role) t.check(rows.some((row) => row.role === expected.role && row.estado === expected.active), `${user.email} no tiene una cuenta ${expected.role} ${expected.active ? 'activa' : 'suspendida'}`);
      if (expected.accounts) t.equal(rows.map((row) => row.role), expected.accounts, `${user.email} no tiene las cuentas esperadas`);
      if (expected.institutions) t.equal(new Set(rows.map((row) => row.institucion_id)).size, expected.institutions, `${user.email} no está en dos instituciones`);
      if (expected.active === false) t.check(rows.every((row) => !row.estado && row.deleted === expected.deleted), `${user.email} no está suspendido`);
      if (expected.deleted) t.check(rows.every((row) => row.deleted), `${user.email} no está dado de baja`);
    }
  });

  test('seed-content', 'Cada tabla del seed tiene filas y los catálogos están completos', async (t) => {
    const tables = (await t.sql(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).map((row) => row.tablename);
    for (const table of tables) {
      const { count } = await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM ${table}`);
      t.check(count > 0, `La tabla ${table} quedó vacía después del seed`);
    }
    const roles = (await t.sql(`SELECT nombre FROM usuario_rol ORDER BY 1`)).map((row) => row.nombre);
    t.equal(roles, ['ADMIN', 'PROFESOR', 'SECRETARIO'], 'Roles del seed');
    const levels = (await t.sql(`SELECT DISTINCT nivel_educativo FROM grado ORDER BY 1`)).map((row) => row.nivel_educativo);
    t.equal(levels, ['PRIMARIA', 'SECUNDARIA'], 'El catálogo de grados tiene los dos niveles educativos');
    const gradesWithoutSubjects = await t.sql(`SELECT g.grado_id FROM grado g WHERE NOT EXISTS (SELECT 1 FROM grado_materia gm WHERE gm.grado_id = g.grado_id)`);
    t.equal(gradesWithoutSubjects, [], 'Todo grado tiene materias en su plan de estudios');
  });
});
