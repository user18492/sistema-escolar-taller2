const { query } = require('../database/connection');

// El año del ciclo lectivo actual y la fecha del día, de fn_anio_ciclo_lectivo_actual y
// fn_fecha_actual (db/schema.sql): la única fuente de la fecha y del ciclo lectivo, la misma que usan
// los triggers que dejan en solo lectura lo de un ciclo cerrado. La fecha sale como texto, así no la
// convierte la zona horaria del proceso.
const FIND_CURRENT_SQL = `
  SELECT fn_anio_ciclo_lectivo_actual() AS school_year,
         to_char(fn_fecha_actual(), 'YYYY-MM-DD') AS today
`;

// Si el trimestre de una fecha está cerrado, con fn_trimestre y fn_trimestre_cerrado (db/schema.sql):
// los cortes de los trimestres y el plazo de carga están solo en la base, la misma regla con la que
// sus triggers rechazan las escrituras en un trimestre cerrado.
const IS_TERM_CLOSED_SQL = `
  SELECT fn_trimestre_cerrado(EXTRACT(YEAR FROM $1::DATE)::INT, fn_trimestre($1::DATE)) AS is_closed
`;

// El ciclo lectivo actual según la base: { year, today }, con year el año del ciclo lectivo y today
// la fecha del día ('AAAA-MM-DD').
async function findCurrent() {
  const { rows } = await query(FIND_CURRENT_SQL);
  return { year: rows[0].school_year, today: rows[0].today };
}

// true si el trimestre de la fecha `isoDate` ('AAAA-MM-DD', una fecha válida) está cerrado, con la
// fecha de la base.
async function isTermClosed(isoDate) {
  const { rows } = await query(IS_TERM_CLOSED_SQL, [isoDate]);
  return rows[0].is_closed;
}

module.exports = { findCurrent, isTermClosed };
