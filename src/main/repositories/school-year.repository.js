const { query } = require('../database/connection');

// El año del ciclo lectivo actual y la fecha del día, de fn_anio_ciclo_lectivo_actual y
// fn_fecha_actual (db/schema.sql): la única fuente de la fecha y del ciclo lectivo, la misma que usan
// los triggers que dejan en solo lectura lo de un ciclo cerrado. La fecha sale como texto, así no la
// convierte la zona horaria del proceso.
const FIND_CURRENT_SQL = `
  SELECT fn_anio_ciclo_lectivo_actual() AS school_year,
         to_char(fn_fecha_actual(), 'YYYY-MM-DD') AS today
`;

// El ciclo lectivo actual según la base: { year, today }, con year el año del ciclo lectivo y today
// la fecha del día ('AAAA-MM-DD').
async function findCurrent() {
  const { rows } = await query(FIND_CURRENT_SQL);
  return { year: rows[0].school_year, today: rows[0].today };
}

module.exports = { findCurrent };
