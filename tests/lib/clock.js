// "Hoy" para la suite. Hoy la fecha sale de tres relojes: la base (CURRENT_DATE, en las
// restricciones, el alta de inscripciones y los cursos que se ofrecen), el proceso principal (año de
// un curso nuevo o de una asignación, edad de usuarios y alumnos) y el renderer (año que anuncian
// los formularios, validación de fechas). El seed además tiene un año fijo (2026).
//
// Mientras no exista una única fuente, las pruebas toman la fecha de la base y la suite comprueba
// antes de empezar que los relojes coinciden. Por eso la línea base vale solo para el año en que se
// tomó: con otro año, las filas del seed quedan en un ciclo cerrado (ver README).
//
// Preparado para congelar la fecha: cuando notas/restricciones/ciclo-lectivo.txt se implemente con
// una única función de la base que dé la fecha y el año actuales, completar SINGLE_SOURCE con su
// nombre. Con TEST_TODAY=AAAA-MM-DD, la suite reemplazará esa función en cada base de prueba (nunca
// en la del .env) para que devuelva esa fecha, y las pruebas dejarán de depender del día en que
// corren.
const SINGLE_SOURCE = null; // p. ej. { today: 'fn_fecha_actual' }

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

// Aplica la fecha congelada a una base de prueba recién clonada. Hoy no hace nada (ver arriba).
async function applyToDatabase(client) {
  const value = frozenDate();
  if (!value) return;
  await client.query(
    `CREATE OR REPLACE FUNCTION ${SINGLE_SOURCE.today}() RETURNS DATE LANGUAGE sql STABLE AS $$ SELECT DATE '${value}' $$`
  );
}

function localIsoDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// La fecha de hoy según la base (la que validan las restricciones), 'AAAA-MM-DD'.
async function today(client) {
  const frozen = frozenDate();
  if (frozen) return frozen;
  const { rows } = await client.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`);
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

module.exports = { SINGLE_SOURCE, frozenDate, applyToDatabase, today, year, readClocks, localIsoDate, toDayMonth };
