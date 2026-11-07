// Capa main: backups del Administrador por la API del preload (plans/backups/01-backup.md). Inicia
// sesión con el administrador del seed (solo lo lee), realiza backups en la carpeta userData de la
// suite y comprueba el archivo, su contenido y el historial con consultas independientes: las tablas
// sin institucion_id se filtran por otra cadena que la del repositorio (el profesor o el alumno, no
// el curso).
// El restore (plans/backups/02-restore.md) se prueba igual, por la API del preload: el diálogo para
// elegir el archivo lo responde la prueba (t.chooseFile), con backups reales o modificados a mano.
const fs = require('node:fs');
const path = require('node:path');
const { group, test } = require('../lib/framework');
const { SEED_INSTITUTIONS } = require('../lib/fixtures');
const { PATHS } = require('../config');

const AdmZip = require(require.resolve('adm-zip', { paths: [PATHS.root] }));
const tar = require(require.resolve('tar', { paths: [PATHS.root] }));

const SM = SEED_INSTITUTIONS.SM;
const MB = SEED_INSTITUTIONS.MB;
const EXTENSIONS = { zip: '.zip', 'tar.gz': '.tar.gz' };

// Cada tabla del backup con su clave primaria y la condición independiente que la deja en la
// institución $1.
const TABLES = [
  ['usuario', 'usuario_id', 't.institucion_id = $1'],
  ['alumno', 'alumno_id', 't.institucion_id = $1'],
  ['curso', 'curso_id', 't.institucion_id = $1'],
  ['asignacion_docente', 'asignacion_docente_id', 't.usuario_id IN (SELECT usuario_id FROM usuario WHERE institucion_id = $1)'],
  ['inscripcion', 'inscripcion_id', 't.alumno_id IN (SELECT alumno_id FROM alumno WHERE institucion_id = $1)'],
  ['evaluacion', 'evaluacion_id', `EXISTS (SELECT 1 FROM asignacion_docente a JOIN usuario u ON u.usuario_id = a.usuario_id
                                            WHERE a.asignacion_docente_id = t.asignacion_docente_id AND u.institucion_id = $1)`],
  ['calificacion', 'calificacion_id', `t.inscripcion_id IN (SELECT i.inscripcion_id FROM inscripcion i JOIN alumno al ON al.alumno_id = i.alumno_id
                                                             WHERE al.institucion_id = $1)`],
];
const CATALOGS = [
  ['usuario_rol', 'usuario_rol_id'], ['grado', 'grado_id'], ['materia', 'materia_id'],
  ['grado_materia', 'grado_materia_id'], ['alumno_estado', 'alumno_estado_id'], ['inscripcion_estado', 'inscripcion_estado_id'],
];

// La carpeta de backups (userData/backups) o, con `institutionId`, la subcarpeta de esa institución.
const backupsRoot = (t) => path.join(t.harness.userData, 'backups');
const backupsDir = (t, institutionId) => path.join(backupsRoot(t), String(institutionId));
const listBackupFiles = (t, institutionId) => {
  const directory = backupsDir(t, institutionId);
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
};

// El nombre de un backup de la institución `institutionId` realizado por el usuario `userId` en la
// fecha `iso` (<institucion_id>_<usuario_id>_<fecha>_<hora>), con la hora local de este proceso (el
// mismo que el principal de la aplicación).
function expectedFileName(institutionId, userId, iso, format) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${institutionId}_${userId}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}${EXTENSIONS[format]}`;
}

// Descomprime el backup y devuelve los nombres de sus entradas y el contenido de backup.json.
async function readArchive(t, file, format) {
  if (format === 'zip') {
    const zip = new AdmZip(file);
    const entries = zip.getEntries();
    const json = entries.find((entry) => entry.entryName === 'backup.json');
    return { entries: entries.map((entry) => entry.entryName), content: json ? JSON.parse(json.getData().toString('utf8')) : null };
  }
  const directory = fs.mkdtempSync(path.join(path.dirname(t.harness.userData), 'backup-extract-'));
  try {
    await tar.x({ file, cwd: directory });
    const entries = fs.readdirSync(directory);
    const json = path.join(directory, 'backup.json');
    return { entries, content: fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, 'utf8')) : null };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const rowsOf = async (t, table, idColumn, where, params = []) =>
  (await t.sql(`SELECT row_to_json(t) AS r FROM ${table} t ${where ? `WHERE ${where}` : ''} ORDER BY t.${idColumn}`, params)).map((row) => row.r);

const respaldoCount = async (t) => (await t.sqlOne(`SELECT COUNT(*)::INT AS count FROM respaldo`)).count;

group('main.admin.backups', 'Administrador: backups', {
  async setup({ fixtures }) {
    // Datos propios de la institución, con filas dadas de baja en cada tabla que lo admite
    const course = await fixtures.createCourse();
    const deletedCourse = await fixtures.createCourse({ deleted: true });
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const deletedUser = await fixtures.createUser({ role: 'SECRETARIO', deleted: true });
    const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    const student = await fixtures.createStudent();
    const deletedStudent = await fixtures.createStudent({ deleted: true });
    const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
    const otherStudent = await fixtures.createStudent();
    const deletedEnrollmentId = await fixtures.enroll({ studentId: otherStudent.id, courseId: course.id, deleted: true });
    const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
    const scoreId = await fixtures.score({ evaluationId, enrollmentId, value: 7.5 });
    return {
      deleted: { usuario: deletedUser.id, alumno: deletedStudent.id, curso: deletedCourse.id, inscripcion: deletedEnrollmentId },
      own: { evaluacion: evaluationId, calificacion: scoreId },
      adminId: await fixtures.seedUserId('admin'),
      institutionId: await fixtures.institutionId(SM),
      otherInstitutionId: await fixtures.institutionId(MB),
    };
  },
}, () => {
  test('invalid-format', 'Un formato que no es zip ni tar.gz se rechaza con INVALID_INPUT, sin escribir nada', {
    history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'La carpeta de backups es la subcarpeta de la institución' }],
  }, async (t) => {
    await t.login('admin');
    const filesBefore = listBackupFiles(t, t.data.institutionId);
    const countBefore = await respaldoCount(t);
    for (const format of ['rar', 'ZIP', '', null, 7]) await t.rejects('INVALID_INPUT', 'backups.create', format);
    t.equal(listBackupFiles(t, t.data.institutionId), filesBefore, 'La carpeta de backups no cambió');
    t.equal(await respaldoCount(t), countBefore, 'El historial no cambió');
    await t.logout();
  });

  for (const format of ['zip', 'tar.gz']) {
    test(`create-${format.replace('.', '-')}`, `El backup ${format.toUpperCase()} guarda todas las filas de la institución, sus columnas y los catálogos, y queda en el historial`, {
      history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'El archivo queda en la subcarpeta de la institución y el nombre es <institucion_id>_<usuario_id>_<fecha>_<hora>, sin el CUIT' }],
    }, async (t) => {
      await t.login('admin');
      const countBefore = await respaldoCount(t);
      const { backup } = await t.ok('backups.create', format);
      t.require(backup?.fileName, 'La respuesta no trae el backup', backup);

      // El archivo
      const institution = await t.sqlOne(`SELECT institucion_id, cuit, nombre FROM institucion WHERE institucion_id = $1`, [t.data.institutionId]);
      const file = path.join(backupsDir(t, t.data.institutionId), backup.fileName);
      t.require(fs.existsSync(file), `No existe el archivo ${backup.fileName} en userData/backups/${t.data.institutionId}`);
      t.check(!listBackupFiles(t, t.data.institutionId).some((name) => name.endsWith('.tmp')), 'Quedó un archivo .tmp en la carpeta', listBackupFiles(t, t.data.institutionId));
      t.check(!fs.existsSync(path.join(backupsRoot(t), backup.fileName)), 'El archivo quedó suelto en userData/backups, fuera de la subcarpeta de la institución');
      const { entries, content } = await readArchive(t, file, format);
      t.equal(entries, ['backup.json'], 'El archivo tiene una sola entrada, backup.json');
      t.require(content, 'backup.json no se pudo leer');

      // Encabezado
      t.equal(content.formatVersion, 1, 'formatVersion');
      t.equal(content.institution, { id: institution.institucion_id, cuit: institution.cuit, name: institution.nombre }, 'La institución del backup es la de la sesión');
      const admin = await t.sqlOne(`SELECT nombre, apellido FROM usuario WHERE usuario_id = $1`, [t.data.adminId]);
      t.equal(content.createdBy, { id: t.data.adminId, firstName: admin.nombre, lastName: admin.apellido }, 'createdBy es el administrador de la sesión');
      t.equal(backup.fileName, expectedFileName(t.data.institutionId, t.data.adminId, content.createdAt, format), 'El nombre del archivo sigue <institucion_id>_<usuario_id>_<fecha>_<hora> con la hora local de createdAt');
      t.check(!backup.fileName.includes(institution.cuit), 'El nombre del archivo no incluye el CUIT de la institución', backup.fileName);

      // Filas de las 7 tablas: las de la institución, con todas sus columnas, también las dadas de baja
      t.equal(Object.keys(content.tables).sort(), TABLES.map(([name]) => name).sort(), 'Tablas del backup');
      for (const [name, idColumn, where] of TABLES) {
        const expected = await rowsOf(t, name, idColumn, where, [t.data.institutionId]);
        const ids = (content.tables[name] ?? []).map((row) => row[idColumn]);
        t.equal(ids, expected.map((row) => row[idColumn]), `${name}: los ids del backup son los de la institución en la base`);
        t.equal(content.tables[name], expected, `${name}: las filas del backup coinciden con la base, columna por columna`);
        const others = await rowsOf(t, name, idColumn, where, [t.data.otherInstitutionId]);
        const otherIds = new Set(others.map((row) => row[idColumn]));
        t.check(ids.every((id) => !otherIds.has(id)), `${name}: el backup trae filas de la otra institución`);
        // Sin filas de la otra institución, no se comprobaría el filtro (calificacion puede quedar
        // vacía en el seed: ver db.schema.seed-content)
        if (name !== 'calificacion') t.check(others.length > 0, `La otra institución del seed no tiene filas en ${name}`);
      }
      for (const [name, id] of Object.entries(t.data.deleted)) {
        t.check(content.tables[name].some((row) => row[`${name}_id`] === id && row.fecha_eliminacion !== null), `${name}: falta la fila dada de baja ${id}`);
      }
      for (const [name, id] of Object.entries(t.data.own)) {
        t.check(content.tables[name].some((row) => row[`${name}_id`] === id), `${name}: falta la fila ${id} creada por la prueba`);
      }

      // Columnas y catálogos
      for (const [name] of TABLES) {
        const columns = (await t.sql(`SELECT attname::TEXT AS name FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`, [name])).map((row) => row.name);
        t.equal(content.columns[name], columns, `${name}: columns coincide con la base`);
      }
      t.equal(Object.keys(content.catalogs).sort(), CATALOGS.map(([name]) => name).sort(), 'Catálogos del backup');
      for (const [name, idColumn] of CATALOGS) t.equal(content.catalogs[name], await rowsOf(t, name, idColumn), `${name}: el catálogo coincide con la base`);

      // Historial
      t.equal(await respaldoCount(t), countBefore + 1, 'El backup agrega una fila a respaldo');
      const row = await t.sqlOne(`
        SELECT institucion_id, usuario_id, usuario_nombre, usuario_apellido, fecha = $2::TIMESTAMPTZ AS same_date
          FROM respaldo WHERE respaldo_id = $1`, [backup.id, content.createdAt]);
      t.equal(row, { institucion_id: t.data.institutionId, usuario_id: t.data.adminId, usuario_nombre: admin.nombre, usuario_apellido: admin.apellido, same_date: true },
        'La fila de respaldo es de la institución y del administrador, con la fecha de createdAt');
      const { backups } = await t.ok('backups.list');
      t.equal(backups[0], { id: backup.id, userName: backup.userName, createdAt: backup.createdAt }, 'backups.list trae primero el backup nuevo, con los datos de la respuesta');
      t.equal(backup.userName, `${admin.nombre} ${admin.apellido}`, 'userName es el nombre y el apellido del administrador');
      t.check(Math.abs(new Date(backup.createdAt) - new Date(content.createdAt)) < 1, 'createdAt de la respuesta es el del archivo', { response: backup.createdAt, file: content.createdAt });
      const listed = await t.sql(`SELECT respaldo_id AS id FROM respaldo WHERE institucion_id = $1 ORDER BY fecha DESC, respaldo_id DESC`, [t.data.institutionId]);
      t.equal(backups.map((item) => item.id), listed.map((item) => item.id), 'backups.list trae los backups de la institución, del más nuevo al más viejo');
      await t.logout();
    });
  }

  test('file-exists', 'Si ya existe un archivo con el nombre del backup (dos en el mismo segundo), responde BACKUP_FILE_EXISTS sin reemplazarlo ni registrar nada', {
    history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'Los nombres ocupados siguen el formato nuevo, en la subcarpeta de la institución' }],
  }, async (t) => {
    await t.login('admin');
    const { now } = await t.sqlOne(`SELECT to_json(NOW()) #>> '{}' AS now`);
    const directory = backupsDir(t, t.data.institutionId);
    // Los nombres de los próximos segundos ya están ocupados
    fs.mkdirSync(directory, { recursive: true });
    const taken = [];
    for (let second = -2; second <= 15; second += 1) {
      const name = expectedFileName(t.data.institutionId, t.data.adminId, new Date(new Date(now).getTime() + second * 1000).toISOString(), 'zip');
      if (fs.existsSync(path.join(directory, name))) continue;
      fs.writeFileSync(path.join(directory, name), 'ocupado');
      taken.push(name);
    }
    const countBefore = await respaldoCount(t);
    try {
      await t.rejects('BACKUP_FILE_EXISTS', 'backups.create', 'zip');
      t.equal(await respaldoCount(t), countBefore, 'No se registró ningún backup');
      t.check(taken.every((name) => fs.readFileSync(path.join(directory, name), 'utf8') === 'ocupado'), 'El archivo existente no se reemplazó');
      t.check(!listBackupFiles(t, t.data.institutionId).some((name) => name.endsWith('.tmp')), 'Quedó un archivo .tmp en la carpeta', listBackupFiles(t, t.data.institutionId));
    } finally {
      for (const name of taken) fs.rmSync(path.join(directory, name), { force: true });
    }
    await t.logout();
  });

  test('one-at-a-time', 'Mientras corre un backup, otro se rechaza con BACKUP_IN_PROGRESS', {
    history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'Los archivos se buscan en la subcarpeta de la institución' }],
  }, async (t) => {
    await t.login('admin');
    // Sin los archivos de las pruebas anteriores, que pueden ser del mismo segundo
    fs.rmSync(backupsRoot(t), { recursive: true, force: true });
    const countBefore = await respaldoCount(t);
    // El primero se demora al empezar a leer los datos, ya dentro de la operación; mientras tanto
    // llega el segundo
    const fault = t.injectFault({ match: /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/i, action: 'delay', ms: 800 });
    const first = t.call('backups.create', 'zip');
    const deadline = Date.now() + 5000;
    while (fault.hits < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    t.check(fault.hits === 1, 'El primer backup no llegó a leer los datos', { hits: fault.hits });
    await t.rejects('BACKUP_IN_PROGRESS', 'backups.create', 'tar.gz');
    const firstResult = await first;
    t.check(firstResult?.ok === true, 'El primer backup se realizó', firstResult);
    t.equal(await respaldoCount(t), countBefore + 1, 'Solo se registró el que se realizó');
    t.equal(listBackupFiles(t, t.data.institutionId), firstResult?.ok ? [firstResult.backup.fileName] : [], 'Solo quedó el archivo del que se realizó');
    await t.logout();
  });
});

// ---------- Restore (plans/backups/02-restore.md) ----------

const { replaceTodaySql } = require('../lib/clock');
const { tableHashes, changedTables } = require('../lib/db-snapshot');

const TABLE_NAMES = TABLES.map(([name]) => name);

// Las filas de la institución en cada una de las 7 tablas, con todas sus columnas y por id.
async function institutionRows(t, institutionId) {
  const rows = {};
  for (const [name, idColumn, where] of TABLES) rows[name] = await rowsOf(t, name, idColumn, where, [institutionId]);
  return rows;
}

const respaldoRows = (t) => rowsOf(t, 'respaldo', 'respaldo_id');

// Los triggers de usuario de las 7 tablas que no quedaron habilitados (tgenabled distinto de 'O'),
// y cuántos hay en total.
async function triggersState(t) {
  const rows = await t.sql(`
    SELECT c.relname AS table, tg.tgname AS trigger, tg.tgenabled AS enabled
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE NOT tg.tgisinternal AND c.relname = ANY($1)`, [TABLE_NAMES]);
  return { total: rows.length, notEnabled: rows.filter((row) => row.enabled !== 'O') };
}

// Archivos de prueba para elegir en el diálogo, en la carpeta de la corrida (fuera de userData).
function restoreFilePath(t, name) {
  const directory = path.join(path.dirname(t.harness.userData), 'restore-files');
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}

function writeRaw(t, name, bytes) {
  const file = restoreFilePath(t, name);
  fs.writeFileSync(file, bytes);
  return file;
}

// Un ZIP con `entries` ({ nombre: contenido }); un contenido que no es Buffer se guarda como JSON.
function writeZip(t, name, entries) {
  const file = restoreFilePath(t, name);
  const zip = new AdmZip();
  for (const [entryName, content] of Object.entries(entries)) {
    zip.addFile(entryName, Buffer.isBuffer(content) ? content : Buffer.from(JSON.stringify(content), 'utf8'));
  }
  zip.writeZip(file);
  return file;
}

// Elige `file` en el diálogo (respondido por la prueba) y devuelve la respuesta de selectFile.
async function selectFile(t, file) {
  t.chooseFile(file);
  return t.call('backups.selectFile');
}

// Restaura el backup ya elegido desde la vista Backup y restauración: la respuesta tiene que ser ok
// y la ventana tiene que volver al login con el aviso.
async function restoreAndWaitLogin(t) {
  await t.ui.navigate('admin/backups/index.html');
  const value = await t.call('backups.restore');
  t.require(value?.ok === true, 'backups.restore no se realizó', value);
  await t.ui.waitFor(`location.pathname.endsWith('/auth/login/index.html') && location.search.includes('notice=system-restored')`,
    { timeoutMs: 10000, message: 'La ventana no volvió al login con ?notice=system-restored' });
}

const deepCopy = (value) => JSON.parse(JSON.stringify(value));

// Borra los backups de la institución que dejaron las pruebas anteriores: uno del mismo segundo
// haría fallar el siguiente con BACKUP_FILE_EXISTS.
const clearBackups = (t, institutionId) => fs.rmSync(backupsDir(t, institutionId), { recursive: true, force: true });

group('main.admin.restore', 'Administrador: restore de un backup', {
  async setup({ fixtures }) {
    const institutionId = await fixtures.institutionId(SM);
    const otherInstitutionId = await fixtures.institutionId(MB);
    // Datos propios de la institución en las 7 tablas, con filas dadas de baja
    const course = await fixtures.createCourse();
    const emptyCourse = await fixtures.createCourse();
    await fixtures.createCourse({ deleted: true });
    const teacher = await fixtures.createUser({ role: 'PROFESOR' });
    const secretary = await fixtures.createUser({ role: 'SECRETARIO' });
    await fixtures.createUser({ role: 'SECRETARIO', deleted: true });
    const assignment = await fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    const student = await fixtures.createStudent();
    await fixtures.createStudent({ deleted: true });
    const enrollmentId = await fixtures.enroll({ studentId: student.id, courseId: course.id });
    const evaluationId = await fixtures.createEvaluation({ assignmentId: assignment.id });
    await fixtures.score({ evaluationId, enrollmentId, value: 8.25 });
    // Otro administrador de la institución y uno de la otra
    const otherAdmin = await fixtures.createUser({ role: 'ADMIN' });
    const foreignAdmin = await fixtures.createUser({ role: 'ADMIN', institutionId: otherInstitutionId });
    return { institutionId, otherInstitutionId, emptyCourse, secretary, student, otherAdmin, foreignAdmin };
  },
}, () => {
  test('restore-roundtrip', 'Backup, cambios y restore: las 7 tablas de la institución quedan como en el backup (con sus ids), la otra institución y el historial no cambian, la sesión se cierra y las altas siguientes no chocan', {
    history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'El diálogo abre en la subcarpeta de la institución' }],
  }, async (t) => {
    clearBackups(t, t.data.institutionId);
    await t.login('admin');
    const { backup } = await t.ok('backups.create', 'zip');
    t.require(backup?.fileName, 'No se realizó el backup', backup);
    const file = path.join(backupsDir(t, t.data.institutionId), backup.fileName);
    const { content } = await readArchive(t, file, 'zip');
    const atBackup = await institutionRows(t, t.data.institutionId);

    // Cambios en el ciclo actual: altas, una edición y bajas lógicas
    const newStudent = await t.fixtures.createStudent();
    const newCourse = await t.fixtures.createCourse();
    await t.db.query(`UPDATE alumno SET nombre = 'Editado' WHERE alumno_id = $1`, [t.data.student.id]);
    await t.db.query(`UPDATE curso SET fecha_eliminacion = now() WHERE curso_id = $1`, [t.data.emptyCourse.id]);
    await t.db.query(`UPDATE usuario SET estado = false, fecha_eliminacion = now() WHERE usuario_id = $1`, [t.data.secretary.id]);
    const changed = await institutionRows(t, t.data.institutionId);
    t.check(JSON.stringify(changed) !== JSON.stringify(atBackup), 'Los cambios no se ven en la base');

    const otherBefore = await institutionRows(t, t.data.otherInstitutionId);
    const respaldoBefore = await respaldoRows(t);
    const dialogsBefore = t.harness.dialogs.length;

    const selected = await selectFile(t, file);
    t.require(selected?.ok === true, 'backups.selectFile no aceptó el backup', selected);
    t.equal(selected.file, { fileName: backup.fileName, createdAt: content.createdAt, userName: backup.userName },
      'selectFile devuelve el nombre del archivo, la fecha del backup y quién lo realizó');
    const dialog = t.harness.dialogs[dialogsBefore];
    t.equal(dialog?.kind, 'showOpenDialog', 'Se abrió el diálogo para elegir el archivo');
    t.equal(dialog?.options?.defaultPath, backupsDir(t, t.data.institutionId), 'El diálogo abre en la carpeta de backups de la institución');
    t.equal(dialog?.options?.properties, ['openFile'], 'El diálogo elige un solo archivo');
    t.equal(dialog?.options?.filters, [{ name: 'Backups', extensions: ['zip', 'gz'] }], 'El diálogo filtra los backups');
    t.equal(await institutionRows(t, t.data.institutionId), changed, 'Elegir el archivo no cambia los datos');

    await restoreAndWaitLogin(t);

    t.equal(await institutionRows(t, t.data.institutionId), atBackup, 'Las 7 tablas de la institución quedaron idénticas a las del backup, ids incluidos');
    t.equal(await institutionRows(t, t.data.otherInstitutionId), otherBefore, 'Las filas de la otra institución no cambiaron');
    t.equal(await respaldoRows(t), respaldoBefore, 'La tabla respaldo no cambió (el restore no se registra)');
    t.check(!(await t.sqlOne(`SELECT 1 AS found FROM alumno WHERE alumno_id = $1`, [newStudent.id])), 'El alumno creado después del backup ya no está');
    t.check(!(await t.sqlOne(`SELECT 1 AS found FROM curso WHERE curso_id = $1`, [newCourse.id])), 'El curso creado después del backup ya no está');
    const triggers = await triggersState(t);
    t.check(triggers.total > 0, 'No se encontraron los triggers de las tablas');
    t.equal(triggers.notEnabled, [], 'Los triggers quedaron habilitados después del restore');
    t.equal(await t.call('auth.getCurrentUser'), null, 'La sesión quedó cerrada');
    await t.rejects('UNAUTHENTICATED', 'backups.list');

    // Las altas siguientes toman ids nuevos en las 7 tablas
    const maxIds = Object.fromEntries(TABLES.map(([name, idColumn]) => [name, Math.max(0, ...content.tables[name].map((row) => row[idColumn]))]));
    const teacher = await t.fixtures.createUser({ role: 'PROFESOR' });
    const student = await t.fixtures.createStudent();
    const course = await t.fixtures.createCourse();
    const assignment = await t.fixtures.assign({ teacherId: teacher.id, courseId: course.id });
    const enrollmentId = await t.fixtures.enroll({ studentId: student.id, courseId: course.id });
    const evaluationId = await t.fixtures.createEvaluation({ assignmentId: assignment.id });
    const scoreId = await t.fixtures.score({ evaluationId, enrollmentId });
    const created = { usuario: teacher.id, alumno: student.id, curso: course.id, asignacion_docente: assignment.id, inscripcion: enrollmentId, evaluacion: evaluationId, calificacion: scoreId };
    for (const [name, id] of Object.entries(created)) t.check(id > maxIds[name], `${name}: el alta nueva tomó un id del backup`, { id, max: maxIds[name] });

    // Y se puede volver a iniciar sesión con una cuenta del backup
    await t.login('admin');
    await t.ok('backups.list');
    await t.logout();
  });

  test('restore-closed-school-year', 'Un backup TAR.GZ hecho en un ciclo y restaurado en el siguiente se carga, y sus inscripciones activas de ese ciclo quedan FINALIZADA', {
    history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'El archivo se lee de la subcarpeta de la institución' }],
  }, async (t) => {
    const previousYear = t.year - 1;
    const closed = await t.fixtures.inSchoolYear(previousYear, async () => {
      const course = await t.fixtures.createCourse();
      const student = await t.fixtures.createStudent();
      return { course, enrollmentId: await t.fixtures.enroll({ studentId: student.id, courseId: course.id }) };
    });
    await t.login('admin');

    // El backup se hace con el reloj de la base en el ciclo anterior
    const { definition } = await t.sqlOne(`SELECT pg_get_functiondef('fn_fecha_actual()'::regprocedure) AS definition`);
    let backup;
    await t.db.query(replaceTodaySql(`${previousYear}-11-20`));
    try {
      ({ backup } = await t.ok('backups.create', 'tar.gz'));
    } finally {
      await t.db.query(definition);
    }
    t.require(backup?.fileName, 'No se realizó el backup', backup);
    const file = path.join(backupsDir(t, t.data.institutionId), backup.fileName);
    const { content } = await readArchive(t, file, 'tar.gz');
    const activeId = (await t.sqlOne(`SELECT inscripcion_estado_id AS id FROM inscripcion_estado WHERE nombre = 'ACTIVA'`)).id;
    const finishedId = (await t.sqlOne(`SELECT inscripcion_estado_id AS id FROM inscripcion_estado WHERE nombre = 'FINALIZADA'`)).id;
    t.equal(content.tables.inscripcion.find((row) => row.inscripcion_id === closed.enrollmentId)?.inscripcion_estado_id, activeId,
      'En el backup, la inscripción del ciclo anterior está activa');

    // Con el reloj en el ciclo siguiente, como al iniciar la aplicación, el ciclo del backup ya cerró
    await t.db.query(`CALL sp_inscripcion_finalizar_ciclos_cerrados(NULL)`);
    const selected = await selectFile(t, file);
    t.require(selected?.ok === true, 'backups.selectFile no aceptó el backup TAR.GZ', selected);
    await restoreAndWaitLogin(t);

    const enrollment = await t.sqlOne(`SELECT inscripcion_estado_id FROM inscripcion WHERE inscripcion_id = $1`, [closed.enrollmentId]);
    t.equal(enrollment?.inscripcion_estado_id, finishedId, 'La inscripción activa del ciclo cerrado quedó FINALIZADA');
    const stillActive = await t.sql(`
      SELECT i.inscripcion_id FROM inscripcion i JOIN curso c ON c.curso_id = i.curso_id
       WHERE c.institucion_id = $1 AND c.anio_ciclo_lectivo < $2 AND i.fecha_eliminacion IS NULL AND i.inscripcion_estado_id = $3`,
    [t.data.institutionId, t.year, activeId]);
    t.equal(stillActive, [], 'No quedan inscripciones activas en ciclos cerrados');

    // El resto, como en el backup: solo cambian las inscripciones activas de ciclos cerrados
    const closedCourses = new Set(content.tables.curso.filter((row) => row.anio_ciclo_lectivo < t.year).map((row) => row.curso_id));
    const expected = deepCopy(content.tables);
    for (const row of expected.inscripcion) {
      if (closedCourses.has(row.curso_id) && row.fecha_eliminacion === null && row.inscripcion_estado_id === activeId) row.inscripcion_estado_id = finishedId;
    }
    t.equal(await institutionRows(t, t.data.institutionId), expected, 'Las filas son las del backup, con esas inscripciones finalizadas');
    t.equal((await triggersState(t)).notEnabled, [], 'Los triggers quedaron habilitados');
  });

  test('restore-errors', 'Archivo dañado, de otra institución, de otro esquema o sin administrador activo, y restore sin backup elegido: cada uno con su código y sin cambiar la base', {
    history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'El backup ajeno queda en la subcarpeta de su institución y se rechaza con "El backup pertenece a otra institución.", sin su nombre ni su CUIT' }],
  }, async (t) => {
    clearBackups(t, t.data.institutionId);
    clearBackups(t, t.data.otherInstitutionId);
    // Un backup de la otra institución, realizado por su administrador
    await t.login(t.data.foreignAdmin);
    const { backup: foreign } = await t.ok('backups.create', 'zip');
    await t.logout();
    await t.login('admin');
    const { backup } = await t.ok('backups.create', 'zip');
    t.require(foreign?.fileName && backup?.fileName, 'No se realizaron los backups', { foreign, backup });
    // Cada uno en la subcarpeta de su institución, con el id de la institución y del usuario en el nombre
    const foreignFile = path.join(backupsDir(t, t.data.otherInstitutionId), foreign.fileName);
    t.check(fs.existsSync(foreignFile), 'El backup de la otra institución no está en su subcarpeta', foreign.fileName);
    t.check(foreign.fileName.startsWith(`${t.data.otherInstitutionId}_${t.data.foreignAdmin.id}_`), 'El nombre empieza con los ids de la otra institución y de su administrador', foreign.fileName);
    t.check(!listBackupFiles(t, t.data.institutionId).includes(foreign.fileName), 'El backup de la otra institución quedó en la carpeta de esta');
    const valid = path.join(backupsDir(t, t.data.institutionId), backup.fileName);
    const { content } = await readArchive(t, valid, 'zip');

    const before = await tableHashes(t.db);
    const adminRoleId = (await t.sqlOne(`SELECT usuario_rol_id AS id FROM usuario_rol WHERE nombre = 'ADMIN'`)).id;
    const withoutAdmins = deepCopy(content);
    for (const row of withoutAdmins.tables.usuario) if (row.usuario_rol_id === adminRoleId) row.estado = false;
    const reorderedColumns = deepCopy(content);
    reorderedColumns.columns.alumno = [...reorderedColumns.columns.alumno].reverse();
    const changedCatalog = deepCopy(content);
    changedCatalog.catalogs.grado[0].nombre = `${changedCatalog.catalogs.grado[0].nombre} (otro)`;
    const missingTable = deepCopy(content);
    delete missingTable.tables.calificacion;

    const cases = [
      ['un archivo que no es un ZIP', writeRaw(t, 'danado.zip', 'esto no es un zip'), 'BACKUP_INVALID_FILE'],
      ['un TAR.GZ dañado', writeRaw(t, 'danado.tar.gz', Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03])), 'BACKUP_INVALID_FILE'],
      ['otra extensión', writeRaw(t, 'backup.json', JSON.stringify(content)), 'BACKUP_INVALID_FILE'],
      ['un ZIP sin backup.json', writeZip(t, 'sin-json.zip', { 'otro.json': content }), 'BACKUP_INVALID_FILE'],
      ['un backup.json que no es JSON', writeZip(t, 'no-json.zip', { 'backup.json': Buffer.from('{ "formatVersion": 1, ') }), 'BACKUP_INVALID_FILE'],
      ['otra versión del formato', writeZip(t, 'version.zip', { 'backup.json': { ...deepCopy(content), formatVersion: 2 } }), 'BACKUP_INVALID_FILE'],
      ['una tabla de menos', writeZip(t, 'sin-tabla.zip', { 'backup.json': missingTable }), 'BACKUP_INVALID_FILE'],
      ['sin administradores activos', writeZip(t, 'sin-admin.zip', { 'backup.json': withoutAdmins }), 'BACKUP_INVALID_FILE'],
      ['de la otra institución', foreignFile, 'BACKUP_OTHER_INSTITUTION'],
      ['las columnas en otro orden', writeZip(t, 'columnas.zip', { 'backup.json': reorderedColumns }), 'BACKUP_INCOMPATIBLE'],
      ['un catálogo distinto', writeZip(t, 'catalogo.zip', { 'backup.json': changedCatalog }), 'BACKUP_INCOMPATIBLE'],
    ];
    for (const [label, file, code] of cases) {
      // Antes, una elección válida: la fallida la descarta
      t.check((await selectFile(t, valid))?.ok === true, 'El backup válido no se aceptó');
      t.allowRejection('backups:select-file', code, label);
      const value = await selectFile(t, file);
      t.check(value?.ok === false && value.error?.code === code, `${label}: selectFile tenía que responder ${code}`, value);
      await t.rejects('BACKUP_NO_SELECTION', 'backups.restore');
    }

    // El rechazo del backup ajeno no nombra a la otra institución ni da su CUIT
    const foreignInstitution = await t.sqlOne(`SELECT cuit, nombre FROM institucion WHERE institucion_id = $1`, [t.data.otherInstitutionId]);
    t.allowRejection('backups:select-file', 'BACKUP_OTHER_INSTITUTION', 'mensaje del backup ajeno');
    const foreignValue = await selectFile(t, foreignFile);
    t.equal(foreignValue?.error, { code: 'BACKUP_OTHER_INSTITUTION', message: 'El backup pertenece a otra institución.' },
      'El backup de la otra institución se rechaza con el mensaje genérico');
    const foreignMessage = foreignValue?.error?.message ?? '';
    t.check(!foreignMessage.includes(foreignInstitution.nombre) && !foreignMessage.includes(foreignInstitution.cuit),
      'El mensaje no incluye el nombre ni el CUIT de la otra institución', foreignMessage);

    // Cancelar el diálogo: sin archivo, y descarta la elección anterior
    t.check((await selectFile(t, valid))?.ok === true, 'El backup válido no se aceptó');
    t.allow('dialog', /^showOpenDialog:/, 'diálogo cancelado');
    t.equal(await t.call('backups.selectFile'), { ok: true, file: null }, 'Si se cancela el diálogo, selectFile devuelve file: null');
    await t.rejects('BACKUP_NO_SELECTION', 'backups.restore');

    // El backup elegido por un administrador no lo restaura otro
    t.check((await selectFile(t, valid))?.ok === true, 'El backup válido no se aceptó');
    await t.logout();
    await t.login(t.data.otherAdmin);
    await t.rejects('BACKUP_NO_SELECTION', 'backups.restore');
    t.check((await t.call('auth.getCurrentUser'))?.role === 'ADMIN', 'La sesión sigue abierta');
    await t.logout();

    t.equal(changedTables(before, await tableHashes(t.db)), [], 'La base quedó igual');
    t.equal((await triggersState(t)).notEnabled, [], 'Los triggers siguen habilitados');
  });

  test('restore-rolled-back', 'Si la carga falla a mitad (un id del backup ya es de la otra institución), responde BACKUP_INCOMPATIBLE, no cambia nada, los triggers quedan habilitados y la sesión sigue abierta', {
    history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'El archivo se lee de la subcarpeta de la institución' }],
  }, async (t) => {
    clearBackups(t, t.data.institutionId);
    await t.login('admin');
    const { backup } = await t.ok('backups.create', 'zip');
    const { content } = await readArchive(t, path.join(backupsDir(t, t.data.institutionId), backup.fileName), 'zip');
    // Un usuario sin referencias en el backup pasa a tener el id de uno de la otra institución
    const foreignUser = await t.sqlOne(`SELECT usuario_id FROM usuario WHERE institucion_id = $1 ORDER BY usuario_id LIMIT 1`, [t.data.otherInstitutionId]);
    const tampered = deepCopy(content);
    tampered.tables.usuario.find((row) => row.usuario_id === t.data.secretary.id).usuario_id = foreignUser.usuario_id;
    const file = writeZip(t, 'id-ocupado.zip', { 'backup.json': tampered });

    const before = await tableHashes(t.db);
    t.check((await selectFile(t, file))?.ok === true, 'El backup modificado se tenía que aceptar al elegirlo');
    await t.ui.navigate('admin/backups/index.html');
    await t.rejects('BACKUP_INCOMPATIBLE', 'backups.restore');
    t.equal(changedTables(before, await tableHashes(t.db)), [], 'La base quedó igual');
    t.equal((await triggersState(t)).notEnabled, [], 'Los triggers quedaron habilitados después del restore fallido');
    t.check((await t.call('auth.getCurrentUser'))?.role === 'ADMIN', 'La sesión sigue abierta');
    t.equal(t.ui.view(), 'admin/backups/index.html', 'La ventana sigue en la vista');
    await t.logout();
  });

  test('one-at-a-time', 'Mientras corre un backup, elegir un archivo o restaurar se rechaza con BACKUP_IN_PROGRESS, sin abrir el diálogo', {
    history: [{ plan: 'plans/backups/03-carpeta-por-institucion.md', date: '2026-11-07', change: 'Los archivos se buscan en la subcarpeta de la institución' }],
  }, async (t) => {
    await t.login('admin');
    // Sin los archivos de las pruebas anteriores, que pueden ser del mismo segundo
    fs.rmSync(backupsRoot(t), { recursive: true, force: true });
    const fault = t.injectFault({ match: /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/i, action: 'delay', ms: 800 });
    const first = t.call('backups.create', 'zip');
    const deadline = Date.now() + 5000;
    while (fault.hits < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    t.check(fault.hits === 1, 'El backup no llegó a leer los datos', { hits: fault.hits });
    const dialogsBefore = t.harness.dialogs.length;
    await t.rejects('BACKUP_IN_PROGRESS', 'backups.selectFile');
    await t.rejects('BACKUP_IN_PROGRESS', 'backups.restore');
    t.equal(t.harness.dialogs.length, dialogsBefore, 'No se abrió el diálogo');
    t.check((await first)?.ok === true, 'El backup se realizó');
    await t.logout();
  });
});
