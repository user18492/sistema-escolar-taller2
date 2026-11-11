CREATE FUNCTION fn_nota_aprobacion() RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$ SELECT 6::NUMERIC $$;

CREATE TABLE seguimiento_alumno (
    seguimiento_alumno_id  INT GENERATED ALWAYS AS IDENTITY,
    asignacion_docente_id  INT NOT NULL,
    inscripcion_id        INT NOT NULL,
    motivos               TEXT[] NOT NULL,
    evidencia             JSONB NOT NULL,
    pendiente             BOOLEAN NOT NULL DEFAULT TRUE,
    version               INT NOT NULL DEFAULT 1,
    fecha_apertura         TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    fecha_atencion         TIMESTAMPTZ,
    fecha_resolucion       TIMESTAMPTZ,
    CONSTRAINT pk_seguimiento_alumno PRIMARY KEY (seguimiento_alumno_id),
    CONSTRAINT fk_seguimiento_alumno_asignacion_docente FOREIGN KEY (asignacion_docente_id) REFERENCES asignacion_docente(asignacion_docente_id),
    CONSTRAINT fk_seguimiento_alumno_inscripcion FOREIGN KEY (inscripcion_id) REFERENCES inscripcion(inscripcion_id),
    CONSTRAINT ck_seguimiento_alumno_motivos CHECK (cardinality(motivos) > 0 AND motivos <@ ARRAY['LOW', 'DROP']),
    CONSTRAINT ck_seguimiento_alumno_version CHECK (version > 0)
);

CREATE UNIQUE INDEX uq_seguimiento_alumno_abierto
    ON seguimiento_alumno (asignacion_docente_id, inscripcion_id)
    WHERE fecha_resolucion IS NULL;

CREATE INDEX idx_seguimiento_alumno_asignacion ON seguimiento_alumno (asignacion_docente_id);

CREATE FUNCTION fn_actualizar_seguimiento(p_asignacion INT, p_inscripcion INT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_anterior seguimiento_alumno%ROWTYPE;
    v_reciente NUMERIC;
    v_previo NUMERIC;
    v_notas JSONB;
    v_evidencia JSONB;
    v_motivos TEXT[];
BEGIN
    -- Serializa lotes de notas de la misma asignación aunque ordenen a los alumnos de forma distinta.
    PERFORM pg_advisory_xact_lock(741206, p_asignacion);

    IF NOT EXISTS (
        SELECT 1 FROM asignacion_docente a
        JOIN curso c ON c.curso_id = a.curso_id
        JOIN inscripcion i ON i.curso_id = c.curso_id
        WHERE a.asignacion_docente_id = p_asignacion AND i.inscripcion_id = p_inscripcion
          AND a.fecha_eliminacion IS NULL AND c.fecha_eliminacion IS NULL
          AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
    ) THEN
        RETURN;
    END IF;

    SELECT * INTO v_anterior FROM seguimiento_alumno
     WHERE asignacion_docente_id = p_asignacion AND inscripcion_id = p_inscripcion
       AND fecha_resolucion IS NULL
     FOR UPDATE;

    WITH notas AS (
        SELECT e.titulo, e.fecha_evaluacion, c.nota,
               ROW_NUMBER() OVER (ORDER BY e.fecha_evaluacion DESC, e.evaluacion_id DESC) AS posicion
          FROM calificacion c
          JOIN evaluacion e ON e.evaluacion_id = c.evaluacion_id
          JOIN inscripcion i ON i.inscripcion_id = c.inscripcion_id
         WHERE c.inscripcion_id = p_inscripcion AND e.asignacion_docente_id = p_asignacion
           AND c.fecha_eliminacion IS NULL AND e.fecha_eliminacion IS NULL
           AND e.fecha_evaluacion BETWEEN i.fecha_inscripcion AND fn_fecha_actual()
         ORDER BY e.fecha_evaluacion DESC, e.evaluacion_id DESC
         LIMIT 4
    )
    SELECT CASE WHEN COUNT(*) >= 2 THEN AVG(nota) FILTER (WHERE posicion <= 2) END,
           CASE WHEN COUNT(*) = 4 THEN AVG(nota) FILTER (WHERE posicion > 2) END,
           COALESCE(jsonb_agg(jsonb_build_object(
               'title', titulo, 'date', TO_CHAR(fecha_evaluacion, 'YYYY-MM-DD'), 'grade', nota
           ) ORDER BY posicion), '[]'::JSONB)
      INTO v_reciente, v_previo, v_notas FROM notas;

    -- Cuando faltan datos para un motivo vigente, queda abierto hasta poder reevaluarlo.
    v_motivos := array_remove(ARRAY[
        CASE WHEN COALESCE(v_reciente < fn_nota_aprobacion(), 'LOW' = ANY(v_anterior.motivos)) THEN 'LOW' END,
        CASE WHEN COALESCE(v_previo - v_reciente >= 1.5, 'DROP' = ANY(v_anterior.motivos)) THEN 'DROP' END
    ], NULL);
    v_evidencia := jsonb_build_object('recent', v_reciente, 'previous', v_previo, 'scores', v_notas);

    IF cardinality(v_motivos) = 0 THEN
        UPDATE seguimiento_alumno SET fecha_resolucion = statement_timestamp()
         WHERE seguimiento_alumno_id = v_anterior.seguimiento_alumno_id;
    ELSIF v_anterior.seguimiento_alumno_id IS NULL THEN
        INSERT INTO seguimiento_alumno (asignacion_docente_id, inscripcion_id, motivos, evidencia)
        VALUES (p_asignacion, p_inscripcion, v_motivos, v_evidencia);
    ELSIF (v_motivos, v_evidencia) IS DISTINCT FROM (v_anterior.motivos, v_anterior.evidencia) THEN
        UPDATE seguimiento_alumno
           SET motivos = v_motivos, evidencia = v_evidencia,
               pendiente = pendiente OR NOT (v_motivos <@ v_anterior.motivos),
               version = version + 1
         WHERE seguimiento_alumno_id = v_anterior.seguimiento_alumno_id;
    END IF;
END;
$$;

-- Los triggers diferidos calculan con las notas finales de la transacción.
CREATE FUNCTION fn_seguimiento_calificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.evaluacion_id, OLD.inscripcion_id) IS DISTINCT FROM (NEW.evaluacion_id, NEW.inscripcion_id) THEN
        PERFORM fn_actualizar_seguimiento(e.asignacion_docente_id, OLD.inscripcion_id)
          FROM evaluacion e WHERE e.evaluacion_id = OLD.evaluacion_id;
    END IF;

    PERFORM fn_actualizar_seguimiento(e.asignacion_docente_id, NEW.inscripcion_id)
      FROM evaluacion e WHERE e.evaluacion_id = NEW.evaluacion_id;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_seguimiento_calificacion
    AFTER INSERT OR UPDATE ON calificacion DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_seguimiento_calificacion();

CREATE FUNCTION fn_seguimiento_evaluacion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_inscripcion INT;
BEGIN
    FOR v_inscripcion IN
        SELECT c.inscripcion_id FROM calificacion c
         WHERE c.evaluacion_id = NEW.evaluacion_id AND c.fecha_eliminacion IS NULL
         ORDER BY c.inscripcion_id
    LOOP
        PERFORM fn_actualizar_seguimiento(NEW.asignacion_docente_id, v_inscripcion);
        IF OLD.asignacion_docente_id <> NEW.asignacion_docente_id THEN
            PERFORM fn_actualizar_seguimiento(OLD.asignacion_docente_id, v_inscripcion);
        END IF;
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_seguimiento_evaluacion
    AFTER UPDATE ON evaluacion DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN ((OLD.titulo, OLD.fecha_evaluacion, OLD.asignacion_docente_id)
          IS DISTINCT FROM (NEW.titulo, NEW.fecha_evaluacion, NEW.asignacion_docente_id))
    EXECUTE FUNCTION fn_seguimiento_evaluacion();

-- Detecta las alertas de notas que ya existían al actualizar el esquema o restaurar un backup v1.
CREATE FUNCTION fn_iniciar_seguimientos(p_institucion INT DEFAULT NULL) RETURNS VOID
LANGUAGE sql AS $$
    SELECT fn_actualizar_seguimiento(n.asignacion_docente_id, n.inscripcion_id)
      FROM (
        SELECT DISTINCT e.asignacion_docente_id, cal.inscripcion_id
          FROM calificacion cal
          JOIN evaluacion e ON e.evaluacion_id = cal.evaluacion_id
          JOIN asignacion_docente a ON a.asignacion_docente_id = e.asignacion_docente_id
          JOIN curso c ON c.curso_id = a.curso_id
         WHERE cal.fecha_eliminacion IS NULL AND e.fecha_eliminacion IS NULL
           AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
           AND (p_institucion IS NULL OR c.institucion_id = p_institucion)
         ORDER BY e.asignacion_docente_id, cal.inscripcion_id
      ) n
$$;
