// Inventario del esquema: tablas, columnas, restricciones, índices, triggers, funciones y
// procedimientos del esquema public, cada uno con una huella de su definición. La línea base guarda
// el inventario sobre el que se tomó; la capa de base de datos lo compara para que un plan no quite
// una regla sin que se note.
const QUERIES = {
  tables: `
    SELECT c.relname AS name, md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum)) AS def
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     GROUP BY c.relname`,
  columns: `
    SELECT table_name || '.' || column_name AS name,
           md5(concat_ws('|', data_type, character_maximum_length, numeric_precision, numeric_scale,
                         is_nullable, column_default, is_identity)) AS def
      FROM information_schema.columns WHERE table_schema = 'public'`,
  // PostgreSQL 18 lista también los NOT NULL (contype 'n'): ya están en columns
  constraints: `
    SELECT con.conname AS name, md5(rel.relname || ':' || pg_get_constraintdef(con.oid)) AS def
      FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE n.nspname = 'public' AND con.contype <> 'n'`,
  indexes: `SELECT indexname AS name, md5(indexdef) AS def FROM pg_indexes WHERE schemaname = 'public'`,
  triggers: `
    SELECT t.tgname AS name, md5(pg_get_triggerdef(t.oid)) AS def
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
  // pg_get_functiondef conserva los CR del archivo: se normalizan
  functions: `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
           md5(replace(pg_get_functiondef(p.oid), chr(13), '')) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'`,
  procedures: `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
           md5(replace(pg_get_functiondef(p.oid), chr(13), '')) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'p'`,
};

async function readInventory(client) {
  const inventory = {};
  for (const [kind, sql] of Object.entries(QUERIES)) {
    const { rows } = await client.query(sql);
    inventory[kind] = Object.fromEntries(rows.map((row) => [row.name, row.def]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return inventory;
}

// Diferencias de `current` respecto de `baseline`: { kind: { added, removed, changed } }.
function diffInventory(baseline, current) {
  const diff = {};
  for (const kind of Object.keys(QUERIES)) {
    const before = baseline?.[kind] ?? {};
    const after = current[kind] ?? {};
    const added = Object.keys(after).filter((name) => !(name in before));
    const removed = Object.keys(before).filter((name) => !(name in after));
    const changed = Object.keys(after).filter((name) => name in before && before[name] !== after[name]);
    if (added.length || removed.length || changed.length) diff[kind] = { added, removed, changed };
  }
  return diff;
}

// Triggers con su tabla, función y momento, para las comprobaciones de convenciones.
async function readTriggerDetails(client) {
  const { rows } = await client.query(`
    SELECT t.tgname AS trigger, c.relname AS "table", p.proname AS function
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY 1`);
  return rows;
}

module.exports = { readInventory, diffInventory, readTriggerDetails };
