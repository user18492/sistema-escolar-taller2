// Ayudas para probar reglas de la base directamente con SQL: cada intento corre en una transacción
// que siempre se deshace, así la base del grupo queda como estaba.
async function attempt(client, statements) {
  const list = Array.isArray(statements) ? statements : [statements];
  await client.query('BEGIN');
  try {
    let result;
    for (const statement of list) {
      result = typeof statement === 'string' ? await client.query(statement) : await client.query(statement.sql, statement.params);
    }
    return { ok: true, rows: result?.rows, rowCount: result?.rowCount };
  } catch (error) {
    return { ok: false, code: error.code, constraint: error.constraint, message: error.message };
  } finally {
    await client.query('ROLLBACK');
  }
}

// La base rechazó la operación con la restricción `constraint` (los triggers informan un ck_ con el
// código 23514; las claves únicas, 23505).
function rejectedBy(result, constraint) {
  return result.ok === false && result.constraint === constraint;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// true si la promesa sigue pendiente después de `ms` (p. ej., espera un bloqueo de fila).
async function isPending(promise, ms = 600) {
  const marker = Symbol('pending');
  const winner = await Promise.race([promise.then(() => null, () => null), sleep(ms).then(() => marker)]);
  return winner === marker;
}

module.exports = { attempt, rejectedBy, sleep, isPending };
