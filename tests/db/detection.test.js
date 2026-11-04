// Capa de base de datos: la suite detecta lo que tiene que detectar. Cada prueba provoca a
// propósito una falla y comprueba que el monitor la registra y que, sin declararla, haría fallar la
// prueba en la que ocurre.
const { group, test } = require('../lib/framework');
const { classify } = require('../lib/runner-core');
const { TestContext } = require('../lib/context');
const invariants = require('../lib/invariants');

// Lo que informaría una prueba que no declaró los eventos.
function failuresOf(events) {
  const bare = new TestContext({ id: 'deteccion', meta: {} });
  return classify(events, bare, '2000-01-01').failures;
}

group('db.safety', 'La suite nunca opera sobre la base del .env', { db: 'none' }, () => {
  test('guards', 'Las operaciones de la suite se niegan a usar la base del .env o una sin el prefijo de prueba', async (t) => {
    const { userDbName, assertTestDbName, pgConfig } = require('../lib/env');
    const pgAdmin = require('../lib/pg-admin');
    const { pointAppConnection } = require('../lib/group-db');
    const userDb = userDbName();
    const refuses = async (label, fn) => {
      try {
        await fn();
        t.fail(`${label}: no se negó`);
      } catch (error) {
        t.check(/no es una base de prueba|es la base del \.env/.test(error.message), `${label}: se negó por otro motivo`, error.message);
      }
    };
    await refuses('assertTestDbName con la base del .env', () => assertTestDbName(userDb));
    await refuses('pgConfig con la base del .env', () => pgConfig(userDb));
    await refuses('cloneDb hacia la base del .env', () => pgAdmin.cloneDb(t.args.template, userDb));
    await refuses('dropDb de la base del .env', () => pgAdmin.dropDb(userDb));
    await refuses('runSqlFile sobre la base del .env', () => pgAdmin.runSqlFile(userDb, 'x.sql'));
    await refuses('conexión de la aplicación a la base del .env', () => pointAppConnection(userDb));
    await refuses('una base sin el prefijo', () => pgAdmin.dropDb('postgres'));
  });
});

group('db.detection', 'La suite detecta fallas silenciosas en la base', () => {
  test('pg-notice', 'Un aviso de PostgreSQL se registra y hace fallar la prueba que no lo declara', async (t) => {
    t.allow('pg-notice', /aviso provocado por la suite/, 'provocado a propósito');
    const events = await t.detect(() => t.db.query(`DO $$ BEGIN RAISE NOTICE 'aviso provocado por la suite'; END $$`));
    const notices = events.filter((event) => event.type === 'pg-notice');
    t.check(notices.length === 1, 'El aviso no se registró', events);
    t.check(failuresOf(notices).length === 1, 'El aviso no haría fallar una prueba que no lo declara');
  });

  test('invariant-violation', 'Una invariante incumplida se informa (con los triggers apagados solo en una transacción que se deshace)', async (t) => {
    const course = await t.fixtures.createCourse();
    const student = await t.fixtures.createStudent();
    await t.db.query('BEGIN');
    try {
      await t.db.query('SET LOCAL session_replication_role = replica');
      for (let i = 0; i < 2; i += 1) {
        await t.db.query(`INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id)
                          VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'ACTIVA'))`,
        [student.id, course.id]);
      }
      const violations = await invariants.findViolations(t.db);
      t.check(violations.some((violation) => violation.id === 'inscripcion-una-activa'), 'La invariante de una sola activa no detectó dos activas', violations);
    } finally {
      await t.db.query('ROLLBACK');
    }
  });

  test('console-error', 'Un error en la consola del proceso se registra y hace fallar la prueba que no lo declara', async (t) => {
    t.allow('console', /error provocado por la suite/, 'provocado a propósito');
    const events = await t.detect(async () => console.error('error provocado por la suite'));
    const errors = events.filter((event) => event.type === 'console');
    t.check(errors.length === 1, 'El error de consola no se registró', events);
    t.check(failuresOf(errors).length === 1, 'El error de consola no haría fallar una prueba que no lo declara');
  });
});
