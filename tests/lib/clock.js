// "Hoy" para la suite. La base toma la fecha de una única función, fn_fecha_actual() (db/schema.sql),
// que usan las restricciones del ciclo lectivo, el DEFAULT de la fecha de inscripción y el seed, que
// carga siempre el ciclo lectivo actual. El proceso principal y el renderer toman de ella el ciclo
// lectivo (school-years:get-current, plans/ciclo-lectivo); solo las edades de usuarios y alumnos y
// las validaciones de fecha del renderer siguen con el reloj del proceso.
//
// Las pruebas toman la fecha de la base, y la suite comprueba antes de empezar que los relojes
// coinciden.
//
// Con TEST_TODAY=AAAA-MM-DD, la suite reemplaza fn_fecha_actual() en la plantilla de la corrida
// (antes del seed, lib/pg-admin.js) y en cada base de prueba (nunca en la del .env) para que
// devuelva esa fecha, y las pruebas dejan de depender del día en que corren. Quedan afuera las
// edades y las validaciones de fecha del renderer, que siguen con el reloj del proceso.
const SINGLE_SOURCE = { today: 'fn_fecha_actual' };

function frozenDate() {
  const value = process.env.TEST_TODAY;
  if (!value) return null;
  if (!SINGLE_SOURCE) {
    throw new Error(
      'TEST_TODAY no se puede usar todavía: la fecha sale de varios relojes (base, proceso principal y '
      + 'renderer). Ver tests/lib/clock.js y la nota de ciclo lectivo.'
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('TEST_TODAY tiene que ser AAAA-MM-DD');
  return value;
}

// Sentencia que reemplaza la función de la fecha actual para que devuelva `isoDate` ('AAAA-MM-DD').
function replaceTodaySql(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Fecha inválida: ${isoDate}`);
  return `CREATE OR REPLACE FUNCTION ${SINGLE_SOURCE.today}() RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT DATE '${isoDate}' $$`;
}

// Aplica la fecha congelada (TEST_TODAY) a una base de prueba: la plantilla antes del seed o una
// copia recién clonada. Sin TEST_TODAY no hace nada.
async function applyToDatabase(client) {
  const value = frozenDate();
  if (!value) return;
  await client.query(replaceTodaySql(value));
}

function localIsoDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// La fecha de hoy según la base (la que validan las restricciones), 'AAAA-MM-DD'.
async function today(client) {
  const frozen = frozenDate();
  if (frozen) return frozen;
  const { rows } = await client.query(`SELECT to_char(${SINGLE_SOURCE.today}(), 'YYYY-MM-DD') AS today`);
  return rows[0].today;
}

async function year(client) {
  return Number((await today(client)).slice(0, 4));
}

// Los relojes que hoy usa la aplicación, para comprobar que coinciden.
async function readClocks(client) {
  const { rows } = await client.query(
    `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS db_date, to_char(now(), 'HH24:MI:SS') AS db_time,
            current_setting('TimeZone') AS db_timezone`
  );
  return {
    db: rows[0].db_date,
    dbTime: rows[0].db_time,
    dbTimezone: rows[0].db_timezone,
    node: localIsoDate(),
    nodeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// 'AAAA-MM-DD' -> 'DD/MM' (lo que se escribe en el campo de fecha de una evaluación).
function toDayMonth(isoDate) {
  const [, month, day] = isoDate.split('-');
  return `${day}/${month}`;
}

module.exports = { SINGLE_SOURCE, frozenDate, replaceTodaySql, applyToDatabase, today, year, readClocks, localIsoDate, toDayMonth };
