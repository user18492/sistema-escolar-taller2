// Datos propios de cada grupo de pruebas, cargados por SQL en su copia de la base. Las pruebas leen
// las filas del seed (catálogos, instituciones, usuarios para iniciar sesión) pero no las modifican:
// todo lo que una prueba crea, edita o da de baja sale de acá o de la propia prueba.
// Los datos cumplen las reglas del esquema (los triggers no se desactivan) y las del formulario, con
// fechas calculadas a partir de "hoy" según la base (clock.js), así sirven en cualquier año. Los de
// otro ciclo lectivo, que la base solo acepta en el actual, se crean con inSchoolYear.
const { PATHS } = require('../config');
const { SINGLE_SOURCE, replaceTodaySql } = require('./clock');

const bcrypt = require(require.resolve('bcrypt', { paths: [PATHS.root] }));

// Instituciones del seed, por cuit
const SEED_INSTITUTIONS = { SM: '30-71234567-8', MB: '30-69854321-5' };

// Usuarios del seed que las pruebas usan para iniciar sesión (sin modificarlos). Contraseñas en
// texto plano tomadas de los comentarios de db/seed.sql.
const SEED_USERS = {
  admin: { email: 'mariana.sosa@institucion.edu.ar', password: '7$4GhQ4yd9WZ$pyE', role: 'ADMIN', cuit: SEED_INSTITUTIONS.SM },
  secretary: { email: 'valeria.benitez@institucion.edu.ar', password: 'B@cC5iimsQJHXQ5d', role: 'SECRETARIO', cuit: SEED_INSTITUTIONS.SM },
  teacher: { email: 'pablo.fernandez@institucion.edu.ar', password: 'BaeU6Qw4#ZeP#EmW', role: 'PROFESOR', cuit: SEED_INSTITUTIONS.SM },
  // Dos cuentas en una misma institución (SECRETARIO y PROFESOR), con la misma contraseña
  twoRoles: { email: 'julian.romero@institucion.edu.ar', password: '6!y$GWY*7qYjVp%9' },
  // Una cuenta de profesor en cada institución
  twoInstitutions: { email: 'silvia.gomez@institucion.edu.ar', password: '5i#aTSG@#u!y@NZF' },
  suspended: { email: 'ricardo.medina@institucion.edu.ar', password: 'pzvg3&4JpNWM#e*#' },
  deleted: { email: 'marta.quiroga@institucion.edu.ar', password: '94yS!pdcW4Dg%T5f' },
};

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
let counter = 0;

// Sufijo de letras único en el proceso: los nombres solo admiten letras.
function letters(n) {
  let text = '';
  let value = n;
  do {
    text = LETTERS[value % 26] + text;
    value = Math.floor(value / 26);
  } while (value > 0);
  return text;
}

function next() {
  counter += 1;
  return counter;
}

const BCRYPT_TEST_COST = 4;

class Fixtures {
  // `today` es 'AAAA-MM-DD' según la base.
  constructor(client, { today }) {
    this.db = client;
    this.today = today;
    this.year = Number(today.slice(0, 4));
    this.cache = new Map();
  }

  async one(sql, params) {
    const { rows } = await this.db.query(sql, params);
    return rows[0];
  }

  async cached(key, load) {
    if (!this.cache.has(key)) this.cache.set(key, await load());
    return this.cache.get(key);
  }

  institutionId(cuit = SEED_INSTITUTIONS.SM) {
    return this.cached(`inst:${cuit}`, async () => (await this.one(`SELECT institucion_id FROM institucion WHERE cuit = $1`, [cuit])).institucion_id);
  }

  roleId(role) {
    return this.cached(`role:${role}`, async () => (await this.one(`SELECT usuario_rol_id FROM usuario_rol WHERE nombre = $1`, [role])).usuario_rol_id);
  }

  async seedUserId(key) {
    const user = SEED_USERS[key];
    return (await this.one(
      `SELECT u.usuario_id FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
        WHERE u.email = $1 AND r.nombre = $2 AND u.fecha_eliminacion IS NULL
          AND u.institucion_id = (SELECT institucion_id FROM institucion WHERE cuit = $3)`,
      [user.email, user.role, user.cuit]
    )).usuario_id;
  }

  // Institución nueva, sin usuarios ni cursos.
  async createInstitution() {
    const n = next();
    const cuit = `33-${String(70000000 + n).padStart(8, '0')}-${n % 10}`;
    const name = `Institución de prueba ${letters(n)}`;
    const row = await this.one(
      `INSERT INTO institucion (nombre, direccion_calle, direccion_altura, email, telefono, cuit)
       VALUES ($1, 'Calle de prueba', '100', $2, '3794000000', $3) RETURNING institucion_id`,
      [name, `institucion.${n}@prueba.edu.ar`, cuit]
    );
    return { id: row.institucion_id, cuit, name };
  }

  // Usuario nuevo con contraseña conocida (hash bcrypt de costo bajo: la app compara con cualquiera).
  async createUser({ institutionId, role = 'PROFESOR', active = true, deleted = false, firstName, lastName } = {}) {
    const n = next();
    const user = {
      institutionId: institutionId ?? await this.institutionId(),
      role,
      firstName: firstName ?? 'Prueba',
      lastName: lastName ?? `Suite${letters(n)}`,
      email: `suite.usuario.${n}.${process.pid}@prueba.edu.ar`,
      dni: `9${String(n).padStart(7, '0')}`,
      password: `Suite#${n}Clave9x`,
      birthDate: `${this.year - 35}-05-10`,
    };
    const hash = await bcrypt.hash(user.password, BCRYPT_TEST_COST);
    const row = await this.one(
      `INSERT INTO usuario (institucion_id, usuario_rol_id, estado, nombre, apellido, dni, email, fecha_nacimiento,
                            password_hash, fecha_eliminacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10 THEN now() END) RETURNING usuario_id`,
      [user.institutionId, await this.roleId(role), active && !deleted, user.firstName, user.lastName, user.dni,
        user.email, user.birthDate, hash, deleted]
    );
    return { ...user, id: row.usuario_id };
  }

  async gradeId(level, name) {
    return this.cached(`grade:${level}:${name}`, async () =>
      (await this.one(`SELECT grado_id FROM grado WHERE nivel_educativo = $1 AND nombre = $2`, [level, name])).grado_id);
  }

  // Una división libre (de la Z hacia atrás) para ese grado, turno y ciclo en la institución.
  async freeDivision(institutionId, gradeId, shift, year) {
    const { rows } = await this.db.query(
      `SELECT division FROM curso WHERE institucion_id = $1 AND grado_id = $2 AND turno = $3
          AND anio_ciclo_lectivo = $4 AND fecha_eliminacion IS NULL`,
      [institutionId, gradeId, shift, year]
    );
    const used = new Set(rows.map((row) => row.division));
    const free = [...'ZYXWVUTSRQPONMLKJIHGFEDCBA'].find((letter) => !used.has(letter));
    if (!free) throw new Error('No quedan divisiones libres para el curso de prueba');
    return free;
  }

  // Curso nuevo. Por defecto del ciclo actual, 4° de secundaria a la tarde.
  async createCourse({ institutionId, level = 'SECUNDARIA', grade = '4°', shift = 'TARDE', year = this.year, division, deleted = false } = {}) {
    const inst = institutionId ?? await this.institutionId();
    const gradeId = await this.gradeId(level, grade);
    const letter = division ?? await this.freeDivision(inst, gradeId, shift, year);
    const row = await this.one(
      `INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo, fecha_eliminacion)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END) RETURNING curso_id`,
      [inst, gradeId, letter, shift, year, deleted]
    );
    return { id: row.curso_id, institutionId: inst, gradeId, level, grade, division: letter, shift, year };
  }

  // Materias del plan de estudios del grado, por nombre: [{ subjectId, gradeSubjectId, name }].
  async subjectsOfGrade(gradeId) {
    const { rows } = await this.db.query(
      `SELECT m.materia_id AS "subjectId", gm.grado_materia_id AS "gradeSubjectId", m.nombre AS name
         FROM grado_materia gm JOIN materia m USING (materia_id) WHERE gm.grado_id = $1 ORDER BY m.nombre`,
      [gradeId]
    );
    return rows;
  }

  // Asignación vigente de `teacherId` en `courseId`: la primera materia del grado sin profesor, o
  // la de `subjectName`.
  async assign({ teacherId, courseId, subjectName } = {}) {
    const course = await this.one(`SELECT grado_id FROM curso WHERE curso_id = $1`, [courseId]);
    const subjects = await this.subjectsOfGrade(course.grado_id);
    const { rows: taken } = await this.db.query(
      `SELECT grado_materia_id FROM asignacion_docente WHERE curso_id = $1 AND fecha_eliminacion IS NULL`, [courseId]);
    const takenIds = new Set(taken.map((row) => row.grado_materia_id));
    const subject = subjectName
      ? subjects.find((candidate) => candidate.name === subjectName)
      : subjects.find((candidate) => !takenIds.has(candidate.gradeSubjectId));
    if (!subject) throw new Error('No hay una materia libre para la asignación de prueba');
    const row = await this.one(
      `INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id) VALUES ($1, $2, $3) RETURNING asignacion_docente_id`,
      [teacherId, courseId, subject.gradeSubjectId]
    );
    return { id: row.asignacion_docente_id, teacherId, courseId, ...subject };
  }

  async createStudent({ institutionId, status = 'ACTIVO', deleted = false, lastName } = {}) {
    const n = next();
    const student = {
      institutionId: institutionId ?? await this.institutionId(),
      firstName: 'Alumno',
      lastName: lastName ?? `Suite${letters(n)}`,
      email: `suite.alumno.${n}.${process.pid}@prueba.edu.ar`,
      dni: `9${String(n).padStart(7, '0')}`,
      phone: `3794${String(n).padStart(6, '0')}`,
      street: 'Calle de prueba',
      streetNumber: String(100 + n),
      birthDate: `${this.year - 12}-04-15`,
    };
    const row = await this.one(
      `INSERT INTO alumno (institucion_id, alumno_estado_id, nombre, apellido, email, telefono, direccion_calle,
                           direccion_altura, dni, fecha_nacimiento, fecha_eliminacion)
       VALUES ($1, (SELECT alumno_estado_id FROM alumno_estado WHERE nombre = $2), $3, $4, $5, $6, $7, $8, $9, $10,
               CASE WHEN $11 THEN now() END)
       RETURNING alumno_id`,
      [student.institutionId, status, student.firstName, student.lastName, student.email, student.phone,
        student.street, student.streetNumber, student.dni, student.birthDate, deleted]
    );
    return { ...student, id: row.alumno_id, status };
  }

  // Inscripción con fecha de hoy (o `date`), que tiene que ser del año del ciclo del curso.
  async enroll({ studentId, courseId, status = 'ACTIVA', date = this.today, deleted = false }) {
    const row = await this.one(
      `INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion, fecha_eliminacion)
       VALUES ($1, $2, (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = $3), $4,
               CASE WHEN $5 THEN now() END)
       RETURNING inscripcion_id`,
      [studentId, courseId, status, date, deleted]
    );
    return row.inscripcion_id;
  }

  async setEnrollmentStatus(enrollmentId, status) {
    await this.db.query(
      `UPDATE inscripcion SET inscripcion_estado_id = (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = $2)
        WHERE inscripcion_id = $1`, [enrollmentId, status]);
  }

  async createEvaluation({ assignmentId, title, date = this.today }) {
    const row = await this.one(
      `INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion) VALUES ($1, $2, $3) RETURNING evaluacion_id`,
      [assignmentId, title ?? `Evaluación de prueba ${letters(next())}`, date]
    );
    return row.evaluacion_id;
  }

  async score({ evaluationId, enrollmentId, value = 7 }) {
    const row = await this.one(
      `INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota) VALUES ($1, $2, $3) RETURNING calificacion_id`,
      [evaluationId, enrollmentId, value]
    );
    return row.calificacion_id;
  }

  // Datos de otro ciclo lectivo (`year`) que cumplen todas las reglas, cargados como en ese año: en
  // una transacción del cliente de la suite, corre `create()` con la fecha actual de la base y
  // this.today y this.year en el 15 de junio de `year` (así los métodos de esta clase crean datos de
  // ese ciclo), y después restaura la definición original de la fecha y confirma. Si algo falla, se
  // deshace todo. Ninguna otra sesión ve la fecha cambiada. Devuelve lo que devuelve `create()`.
  // Sirve para los datos de un ciclo cerrado; los de uno futuro no deben quedar: ver asOfSchoolYear.
  async inSchoolYear(year, create) {
    await this.db.query('BEGIN');
    try {
      const result = await this.asOfSchoolYear(year, create);
      await this.db.query('COMMIT');
      return result;
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    }
  }

  // Lo mismo que inSchoolYear, pero dentro de una transacción que abrió quien llama, que decide si se
  // confirma o se deshace (los datos de un ciclo futuro, que se crean y se deshacen). Si `create()`
  // falla, la fecha queda cambiada hasta que esa transacción se deshaga.
  async asOfSchoolYear(year, create) {
    const { definition } = await this.one(
      `SELECT pg_get_functiondef('${SINGLE_SOURCE.today}()'::regprocedure) AS definition`);
    const current = { today: this.today, year: this.year };
    this.today = `${year}-06-15`;
    this.year = year;
    try {
      await this.db.query(replaceTodaySql(this.today));
      const result = await create();
      await this.db.query(definition);
      return result;
    } finally {
      this.today = current.today;
      this.year = current.year;
    }
  }

  // Escenario completo del Profesor: un profesor propio con un curso del ciclo actual, una
  // asignación, un alumno inscripto (activo) y una evaluación de hoy.
  async teacherScenario({ institutionId } = {}) {
    const teacher = await this.createUser({ institutionId, role: 'PROFESOR' });
    const course = await this.createCourse({ institutionId: teacher.institutionId });
    const assignment = await this.assign({ teacherId: teacher.id, courseId: course.id });
    const student = await this.createStudent({ institutionId: teacher.institutionId });
    const enrollmentId = await this.enroll({ studentId: student.id, courseId: course.id });
    const evaluationId = await this.createEvaluation({ assignmentId: assignment.id });
    return { teacher, course, assignment, student, enrollmentId, evaluationId };
  }
}

module.exports = { Fixtures, SEED_INSTITUTIONS, SEED_USERS, letters };
