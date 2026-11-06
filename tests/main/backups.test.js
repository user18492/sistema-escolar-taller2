// Capa main: backups del Administrador por la API del preload (plans/backups/01-backup.md). Inicia
// sesión con el administrador del seed (solo lo lee), realiza backups en la carpeta userData de la
// suite y comprueba el archivo, su contenido y el historial con consultas independientes: las tablas
// sin institucion_id se filtran por otra cadena que la del repositorio (el profesor o el alumno, no
// el curso).
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

const backupsDir = (t) => path.join(t.harness.userData, 'backups');
const listBackupFiles = (t) => (fs.existsSync(backupsDir(t)) ? fs.readdirSync(backupsDir(t)).sort() : []);

// El nombre que plans/backups/01-backup.md fija para un backup de `institution` en la fecha `iso`,
// con la hora local de este proceso (el mismo que el principal de la aplicación).
function expectedFileName(institution, iso, format) {
  const slug = institution.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${slug}_${institution.cuit}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}${EXTENSIONS[format]}`;
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
  test('invalid-format', 'Un formato que no es zip ni tar.gz se rechaza con INVALID_INPUT, sin escribir nada', async (t) => {
    await t.login('admin');
    const filesBefore = listBackupFiles(t);
    const countBefore = await respaldoCount(t);
    for (const format of ['rar', 'ZIP', '', null, 7]) await t.rejects('INVALID_INPUT', 'backups.create', format);
    t.equal(listBackupFiles(t), filesBefore, 'La carpeta de backups no cambió');
    t.equal(await respaldoCount(t), countBefore, 'El historial no cambió');
    await t.logout();
  });

  for (const format of ['zip', 'tar.gz']) {
    test(`create-${format.replace('.', '-')}`, `El backup ${format.toUpperCase()} guarda todas las filas de la institución, sus columnas y los catálogos, y queda en el historial`, async (t) => {
      await t.login('admin');
      const countBefore = await respaldoCount(t);
      const { backup } = await t.ok('backups.create', format);
      t.require(backup?.fileName, 'La respuesta no trae el backup', backup);

      // El archivo
      const institution = await t.sqlOne(`SELECT institucion_id, cuit, nombre FROM institucion WHERE institucion_id = $1`, [t.data.institutionId]);
      const file = path.join(backupsDir(t), backup.fileName);
      t.require(fs.existsSync(file), `No existe el archivo ${backup.fileName} en userData/backups`);
      t.check(!listBackupFiles(t).some((name) => name.endsWith('.tmp')), 'Quedó un archivo .tmp en la carpeta', listBackupFiles(t));
      const { entries, content } = await readArchive(t, file, format);
      t.equal(entries, ['backup.json'], 'El archivo tiene una sola entrada, backup.json');
      t.require(content, 'backup.json no se pudo leer');

      // Encabezado
      t.equal(content.formatVersion, 1, 'formatVersion');
      t.equal(content.institution, { id: institution.institucion_id, cuit: institution.cuit, name: institution.nombre }, 'La institución del backup es la de la sesión');
      const admin = await t.sqlOne(`SELECT nombre, apellido FROM usuario WHERE usuario_id = $1`, [t.data.adminId]);
      t.equal(content.createdBy, { id: t.data.adminId, firstName: admin.nombre, lastName: admin.apellido }, 'createdBy es el administrador de la sesión');
      t.equal(backup.fileName, expectedFileName(institution, content.createdAt, format), 'El nombre del archivo sigue <slug>_<cuit>_<fecha>_<hora> con la hora local de createdAt');

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

  test('file-exists', 'Si ya existe un archivo con el nombre del backup (dos en el mismo segundo), responde BACKUP_FILE_EXISTS sin reemplazarlo ni registrar nada', async (t) => {
    await t.login('admin');
    const institution = await t.sqlOne(`SELECT cuit, nombre FROM institucion WHERE institucion_id = $1`, [t.data.institutionId]);
    const { now } = await t.sqlOne(`SELECT to_json(NOW()) #>> '{}' AS now`);
    // Los nombres de los próximos segundos ya están ocupados
    fs.mkdirSync(backupsDir(t), { recursive: true });
    const taken = [];
    for (let second = -2; second <= 15; second += 1) {
      const name = expectedFileName(institution, new Date(new Date(now).getTime() + second * 1000).toISOString(), 'zip');
      if (fs.existsSync(path.join(backupsDir(t), name))) continue;
      fs.writeFileSync(path.join(backupsDir(t), name), 'ocupado');
      taken.push(name);
    }
    const countBefore = await respaldoCount(t);
    try {
      await t.rejects('BACKUP_FILE_EXISTS', 'backups.create', 'zip');
      t.equal(await respaldoCount(t), countBefore, 'No se registró ningún backup');
      t.check(taken.every((name) => fs.readFileSync(path.join(backupsDir(t), name), 'utf8') === 'ocupado'), 'El archivo existente no se reemplazó');
      t.check(!listBackupFiles(t).some((name) => name.endsWith('.tmp')), 'Quedó un archivo .tmp en la carpeta', listBackupFiles(t));
    } finally {
      for (const name of taken) fs.rmSync(path.join(backupsDir(t), name), { force: true });
    }
    await t.logout();
  });

  test('one-at-a-time', 'Mientras corre un backup, otro se rechaza con BACKUP_IN_PROGRESS', async (t) => {
    await t.login('admin');
    // Sin los archivos de las pruebas anteriores, que pueden ser del mismo segundo
    fs.rmSync(backupsDir(t), { recursive: true, force: true });
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
    t.equal(listBackupFiles(t), firstResult?.ok ? [firstResult.backup.fileName] : [], 'Solo quedó el archivo del que se realizó');
    await t.logout();
  });
});
