// Invariantes de datos que nunca deben violarse, pase lo que pase en la aplicación: cada una es una
// consulta que devuelve las filas que la incumplen (ninguna si se cumple). Se comprueban al final de
// cada grupo de pruebas, sobre la base que el grupo usó, y sobre el seed recién cargado.
// Son reglas que ya rige hoy la base o la aplicación y que ninguna restricción pendiente afloja: un
// plan puede sumar invariantes nuevas, pero no quitar ni relajar estas sin citarse en el README.
module.exports = [
  {
    id: 'usuario-baja-suspendido',
    description: 'Todo usuario dado de baja está suspendido',
    sql: `SELECT usuario_id FROM usuario WHERE fecha_eliminacion IS NOT NULL AND estado`,
  },
  {
    id: 'usuario-email-dni-unicos-vigentes',
    description: 'El dni y el email de un usuario vigente no se repiten en su institución y su rol',
    sql: `SELECT institucion_id, usuario_rol_id, dni FROM usuario WHERE fecha_eliminacion IS NULL
           GROUP BY institucion_id, usuario_rol_id, dni HAVING COUNT(*) > 1
          UNION ALL
          SELECT institucion_id, usuario_rol_id, email FROM usuario WHERE fecha_eliminacion IS NULL
           GROUP BY institucion_id, usuario_rol_id, email HAVING COUNT(*) > 1`,
  },
  {
    id: 'institucion-con-administrador',
    description: 'Toda institución con administradores tiene al menos uno activo y vigente',
    sql: `SELECT i.institucion_id FROM institucion i
           WHERE EXISTS (SELECT 1 FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
                          WHERE u.institucion_id = i.institucion_id AND r.nombre = 'ADMIN')
             AND NOT EXISTS (SELECT 1 FROM usuario u JOIN usuario_rol r USING (usuario_rol_id)
                              WHERE u.institucion_id = i.institucion_id AND r.nombre = 'ADMIN'
                                AND u.estado AND u.fecha_eliminacion IS NULL)`,
  },
  {
    id: 'usuario-password-bcrypt',
    description: 'Toda contraseña se guarda como hash bcrypt, nunca en texto plano',
    sql: `SELECT usuario_id FROM usuario WHERE password_hash !~ '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$'`,
  },
  {
    id: 'curso-vigente-unico',
    description: 'Un curso vigente no se repite en su institución y su ciclo lectivo',
    sql: `SELECT institucion_id, grado_id, division, turno, anio_ciclo_lectivo FROM curso
           WHERE fecha_eliminacion IS NULL
           GROUP BY institucion_id, grado_id, division, turno, anio_ciclo_lectivo HAVING COUNT(*) > 1`,
  },
  {
    id: 'asignacion-coherente',
    description: 'Toda asignación vigente es de un profesor de la institución del curso, con una materia del grado del curso; el profesor está vigente salvo en las de un ciclo lectivo cerrado',
    // Relajada por plans/administrador-usuarios.md: las de un ciclo cerrado quedan en el histórico
    // con el profesor eliminado
    sql: `SELECT a.asignacion_docente_id FROM asignacion_docente a
           JOIN usuario u ON u.usuario_id = a.usuario_id
           JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
           JOIN curso c ON c.curso_id = a.curso_id
           JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
          WHERE a.fecha_eliminacion IS NULL
            AND (r.nombre <> 'PROFESOR'
                 OR (u.fecha_eliminacion IS NOT NULL AND c.anio_ciclo_lectivo >= EXTRACT(YEAR FROM fn_fecha_actual()))
                 OR u.institucion_id <> c.institucion_id OR gm.grado_id <> c.grado_id)`,
  },
  {
    id: 'asignacion-materia-unica',
    description: 'Una materia de un curso tiene una sola asignación vigente',
    sql: `SELECT curso_id, grado_materia_id FROM asignacion_docente WHERE fecha_eliminacion IS NULL
           GROUP BY curso_id, grado_materia_id HAVING COUNT(*) > 1`,
  },
  {
    id: 'inscripcion-misma-institucion',
    description: 'El alumno y el curso de una inscripción son de la misma institución',
    sql: `SELECT i.inscripcion_id FROM inscripcion i JOIN alumno a USING (alumno_id) JOIN curso c USING (curso_id)
           WHERE a.institucion_id <> c.institucion_id`,
  },
  {
    id: 'inscripcion-fecha-del-ciclo',
    description: 'El año de la fecha de una inscripción es el ciclo lectivo de su curso',
    sql: `SELECT i.inscripcion_id FROM inscripcion i JOIN curso c USING (curso_id)
           WHERE EXTRACT(YEAR FROM i.fecha_inscripcion) <> c.anio_ciclo_lectivo`,
  },
  {
    id: 'inscripcion-una-activa',
    description: 'Un alumno tiene a lo sumo una inscripción activa y vigente',
    sql: `SELECT i.alumno_id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
           WHERE e.nombre = 'ACTIVA' AND i.fecha_eliminacion IS NULL
           GROUP BY i.alumno_id HAVING COUNT(*) > 1`,
  },
  {
    id: 'alumno-baja-sin-activa',
    description: 'Un alumno dado de baja no tiene inscripciones activas y vigentes',
    sql: `SELECT i.inscripcion_id FROM inscripcion i JOIN inscripcion_estado e USING (inscripcion_estado_id)
           JOIN alumno a USING (alumno_id)
           WHERE a.fecha_eliminacion IS NOT NULL AND e.nombre = 'ACTIVA' AND i.fecha_eliminacion IS NULL`,
  },
  {
    id: 'evaluacion-fecha-del-ciclo',
    description: 'El año de la fecha de una evaluación vigente es el ciclo lectivo del curso de su asignación',
    sql: `SELECT e.evaluacion_id FROM evaluacion e JOIN asignacion_docente a USING (asignacion_docente_id)
           JOIN curso c ON c.curso_id = a.curso_id
           WHERE e.fecha_eliminacion IS NULL AND EXTRACT(YEAR FROM e.fecha_evaluacion) <> c.anio_ciclo_lectivo`,
  },
  {
    id: 'evaluacion-titulo-unico',
    description: 'El título de una evaluación vigente no se repite en su asignación',
    sql: `SELECT asignacion_docente_id, titulo FROM evaluacion WHERE fecha_eliminacion IS NULL
           GROUP BY asignacion_docente_id, titulo HAVING COUNT(*) > 1`,
  },
  {
    id: 'calificacion-mismo-curso',
    description: 'La inscripción de una calificación es del curso de la asignación de su evaluación',
    sql: `SELECT c.calificacion_id FROM calificacion c
           JOIN evaluacion e USING (evaluacion_id)
           JOIN asignacion_docente a USING (asignacion_docente_id)
           JOIN inscripcion i ON i.inscripcion_id = c.inscripcion_id
           WHERE i.curso_id <> a.curso_id`,
  },
  {
    id: 'calificacion-unica-vigente',
    description: 'Una inscripción tiene a lo sumo una calificación vigente por evaluación',
    sql: `SELECT evaluacion_id, inscripcion_id FROM calificacion WHERE fecha_eliminacion IS NULL
           GROUP BY evaluacion_id, inscripcion_id HAVING COUNT(*) > 1`,
  },
  {
    id: 'calificacion-rango',
    description: 'Toda nota está entre 0 y 10 con hasta dos decimales',
    sql: `SELECT calificacion_id FROM calificacion WHERE nota < 0 OR nota > 10 OR nota <> round(nota, 2)`,
  },
  {
    id: 'calificacion-fecha-pasada',
    description: 'Una calificación vigente es de una evaluación con fecha de hoy o anterior',
    // Se califica a partir de la fecha de la evaluación, y una calificada no pasa a una fecha futura
    // (plans/profesor-calificaciones.md)
    sql: `SELECT c.calificacion_id FROM calificacion c JOIN evaluacion e USING (evaluacion_id)
           WHERE c.fecha_eliminacion IS NULL AND e.fecha_evaluacion > fn_fecha_actual()`,
  },
  {
    id: 'inscripcion-baja-sin-calificaciones',
    description: 'Una inscripción dada de baja no tiene calificaciones vigentes',
    // La baja se rechaza con calificaciones vigentes y, después de la baja, no se pueden cargar
    sql: `SELECT c.calificacion_id FROM calificacion c JOIN inscripcion i USING (inscripcion_id)
           WHERE i.fecha_eliminacion IS NOT NULL AND c.fecha_eliminacion IS NULL`,
  },
];

// Devuelve las invariantes incumplidas en la base de `client`: [{ id, description, rows }].
async function findViolations(client) {
  const violations = [];
  for (const invariant of module.exports) {
    const { rows } = await client.query(invariant.sql);
    if (rows.length) violations.push({ id: invariant.id, description: invariant.description, rows: rows.slice(0, 10) });
  }
  return violations;
}

module.exports.findViolations = findViolations;
