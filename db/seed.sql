-- Datos de prueba.
-- Lo ejecuta db/setup-db.ps1 (npm run db:setup) después de schema.sql.
--
-- Contraseñas: los valores de password_hash son hashes bcrypt (algoritmo $2b$,
-- costo 10), generados con hashPassword (src/main/services/password.service.js).
-- Las contraseñas tienen el formato del generador de la UI
-- (renderer/shared/components/password-generator.component.js): 16 caracteres con al
-- menos una mayúscula, una minúscula, un dígito y un símbolo de !@#$%&*, sin 0 O 1 l I.
-- La contraseña en texto plano de cada usuario se indica en el comentario de su fila;
-- son solo para desarrollo/pruebas locales.

BEGIN;

-- Roles del sistema
INSERT INTO usuario_rol (nombre) VALUES
    ('ADMIN'),
    ('SECRETARIO'),
    ('PROFESOR');

-- Instituciones de prueba
INSERT INTO institucion (nombre, direccion_calle, direccion_altura, email, telefono, cuit) VALUES
    ('Instituto San Martin', 'Av. Belgrano', '1234', 'contacto@institucion.edu.ar', '543794123456', '30-71234567-8'),
    ('Colegio Manuel Belgrano', 'Av. 3 de Abril', '845', 'contacto@colegiobelgrano.edu.ar', '543794467890', '30-69854321-5');

-- Usuarios del Instituto San Martin: 22 (2 administradores, 5 secretarios, 15 profesores), 21
-- vigentes y 1 dada de baja.
-- Julián Romero tiene dos cuentas, una de secretario y otra de profesor, con el mismo dni, el mismo
-- email y la misma contraseña: al iniciar sesión elige con cuál ingresar. Lo permiten los índices
-- únicos de usuario, que solo impiden repetir el dni o el email dentro de una institución y un rol.
-- Credenciales de acceso (email / contraseña en texto plano):
--   mariana.sosa@institucion.edu.ar          / 7$4GhQ4yd9WZ$pyE  (ADMIN)
--   hernan.acosta@institucion.edu.ar         / SUs&LVqS3AbKnq6x  (ADMIN)
--   valeria.benitez@institucion.edu.ar       / B@cC5iimsQJHXQ5d  (SECRETARIO)
--   julian.romero@institucion.edu.ar         / 6!y$GWY*7qYjVp%9  (SECRETARIO y PROFESOR)
--   mariajose.duarte@institucion.edu.ar      / b6@m3cSRn!Vpmcg!  (SECRETARIO)
--   ricardo.medina@institucion.edu.ar        / pzvg3&4JpNWM#e*#  (SECRETARIO, suspendido)
--   marta.quiroga@institucion.edu.ar         / 94yS!pdcW4Dg%T5f  (SECRETARIO, dada de baja)
--   silvia.gomez@institucion.edu.ar          / 5i#aTSG@#u!y@NZF  (PROFESOR)
--   pablo.fernandez@institucion.edu.ar       / BaeU6Qw4#ZeP#EmW  (PROFESOR)
--   lorena.martinez@institucion.edu.ar       / &2q2pmAiRq6vQhnf  (PROFESOR)
--   diego.gonzalez@institucion.edu.ar        / K8JB!HZ6tp5*wGy3  (PROFESOR)
--   maria.gonzalez@institucion.edu.ar        / %DyUVMWL%txf7P&X  (PROFESOR)
--   federico.ruizdiaz@institucion.edu.ar     / 9m3vyf3r&XW7Hy!R  (PROFESOR)
--   nicolas.aguirre@institucion.edu.ar       / i#EyS6Z&H4AbNU*z  (PROFESOR)
--   gabriela.ojeda@institucion.edu.ar        / L$KPrw7ym3!Lreq$  (PROFESOR)
--   sebastian.cabrera@institucion.edu.ar     / tD2ti8JxngfedD*Y  (PROFESOR)
--   florencia.nunez@institucion.edu.ar       / j9dJDaabPnTL@Q#%  (PROFESOR)
--   juanpablo.delafuente@institucion.edu.ar  / jbWhcR7p$68b%N5$  (PROFESOR)
--   camila.ortiz@institucion.edu.ar          / Xn9h33Tt8%V@QTfG  (PROFESOR)
--   carolina.vallejos@institucion.edu.ar     / Ffdc4Ry*Jw*c$nN5  (PROFESOR, suspendido)
--   roberto.sanchez@institucion.edu.ar       / #2cPN9n$Af3XN$x!  (PROFESOR, suspendido)
INSERT INTO usuario (usuario_rol_id, estado, institucion_id, nombre, apellido, email, password_hash, dni, fecha_nacimiento) VALUES
    -- Administradores
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'ADMIN'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Mariana', 'Sosa', 'mariana.sosa@institucion.edu.ar',
     -- Email: mariana.sosa@institucion.edu.ar / Contraseña: 7$4GhQ4yd9WZ$pyE
     '$2b$10$iSIAeLFah7Eb89LHyuYk8.B3PfeXhRCwtN3bjpGojJSbMzP8boKOu', '25841307', '1976-05-14'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'ADMIN'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Hernán', 'Acosta', 'hernan.acosta@institucion.edu.ar',
     -- Email: hernan.acosta@institucion.edu.ar / Contraseña: SUs&LVqS3AbKnq6x
     '$2b$10$sMThNnKrJB2Q6cgX1PoFj.aekloIzxdVOy0zONvBcQ/xsT0LK1rWy', '28376912', '1980-10-02'),

    -- Secretarios
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Valeria', 'Benítez', 'valeria.benitez@institucion.edu.ar',
     -- Email: valeria.benitez@institucion.edu.ar / Contraseña: B@cC5iimsQJHXQ5d
     '$2b$10$MUgHY4TXNtYkAgNTVrTMGOkl1z6nf3J3HrUQ6SlvVoVbjLoLpcCSi', '33215648', '1987-08-21'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Julián', 'Romero', 'julian.romero@institucion.edu.ar',
     -- Email: julian.romero@institucion.edu.ar / Contraseña: 6!y$GWY*7qYjVp%9
     '$2b$10$oQGJbmkjCELqXwZrN5T0PuoF24xC24TToDIjoy6nAoKZnu0OI2YEq', '36904127', '1992-01-09'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'María José', 'Duarte', 'mariajose.duarte@institucion.edu.ar',
     -- Email: mariajose.duarte@institucion.edu.ar / Contraseña: b6@m3cSRn!Vpmcg!
     '$2b$10$c6iYlyXR7.ZTuQTDcTkFF.nxsMKWGGiPGEzhH9bZVsHl5SXunde/q', '30587214', '1983-12-03'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     FALSE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Ricardo', 'Medina', 'ricardo.medina@institucion.edu.ar',
     -- Email: ricardo.medina@institucion.edu.ar / Contraseña: pzvg3&4JpNWM#e*#
     '$2b$10$oidAwnRpgD4EJEyZXBFWv.l7acqqs/c/Ds.a8JIFgrNqlOvciILm2', '22648390', '1971-06-17'),

    -- Profesores
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Silvia', 'Gómez', 'silvia.gomez@institucion.edu.ar',
     -- Email: silvia.gomez@institucion.edu.ar / Contraseña: 5i#aTSG@#u!y@NZF
     '$2b$10$oA/cHInu9hbZeEDoGTjRFeAC/EeGLt982QphE64ytc1qnJcVxUGym', '20473158', '1968-09-28'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Pablo', 'Fernández', 'pablo.fernandez@institucion.edu.ar',
     -- Email: pablo.fernandez@institucion.edu.ar / Contraseña: BaeU6Qw4#ZeP#EmW
     '$2b$10$K9mIpAu9XGp9dp/M0cqV7elhVr2Hz5tCAcyh0hj/I7hu9LHi9rdVG', '31742806', '1985-04-11'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Lorena', 'Martínez', 'lorena.martinez@institucion.edu.ar',
     -- Email: lorena.martinez@institucion.edu.ar / Contraseña: &2q2pmAiRq6vQhnf
     '$2b$10$zP1soIkq1hXRnsRR2Xdq.e738DWr5QoZVYSIttVpqTHk7QTiEchja', '29158473', '1981-11-30'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Diego', 'González', 'diego.gonzalez@institucion.edu.ar',
     -- Email: diego.gonzalez@institucion.edu.ar / Contraseña: K8JB!HZ6tp5*wGy3
     '$2b$10$WnVWJaHEBXa0.Q31kJUUQu9cwqcaJQ9cwh4xpFokePiRhMgxvO8US', '34926051', '1989-07-05'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'María', 'González', 'maria.gonzalez@institucion.edu.ar',
     -- Email: maria.gonzalez@institucion.edu.ar / Contraseña: %DyUVMWL%txf7P&X
     '$2b$10$SEQZzb1K0fq/y4VPcqjf2./8MmpQiX5jPKiU0actrOKQ/o3PcH5iq', '27315894', '1979-02-22'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Federico', 'Ruiz Díaz', 'federico.ruizdiaz@institucion.edu.ar',
     -- Email: federico.ruizdiaz@institucion.edu.ar / Contraseña: 9m3vyf3r&XW7Hy!R
     '$2b$10$Ua1SFVAr4DKIupz0LU0VXe6eiZfJnE8PvdghSoipDMV86N2Gkqr0a', '38207649', '1994-03-16'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Nicolás', 'Aguirre', 'nicolas.aguirre@institucion.edu.ar',
     -- Email: nicolas.aguirre@institucion.edu.ar / Contraseña: i#EyS6Z&H4AbNU*z
     '$2b$10$1eFgBEB8k6vj92v0qwsgzOeNznCMJLA2AUVFEcCNFELvOBrahJK0e', '40183527', '1997-01-27'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Gabriela', 'Ojeda', 'gabriela.ojeda@institucion.edu.ar',
     -- Email: gabriela.ojeda@institucion.edu.ar / Contraseña: L$KPrw7ym3!Lreq$
     '$2b$10$v/3k5RatlbsuDRRWBbrYp.4LC5piRaHI.2a5H7hbFWLaNLtgTeBeq', '23796405', '1973-12-08'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Sebastián', 'Cabrera', 'sebastian.cabrera@institucion.edu.ar',
     -- Email: sebastian.cabrera@institucion.edu.ar / Contraseña: tD2ti8JxngfedD*Y
     '$2b$10$da23fLqokz5sR5yTaKGKOOp97aEx2hjh4mfVRraK97bmFNs62Qz3q', '32051736', '1986-05-24'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Florencia', 'Núñez', 'florencia.nunez@institucion.edu.ar',
     -- Email: florencia.nunez@institucion.edu.ar / Contraseña: j9dJDaabPnTL@Q#%
     '$2b$10$n0v64UVebOuQEfy1SbHE.ezmfMS.NE6OhekwwXnvoHfIe1Tlz4Zx.', '37629184', '1993-08-13'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Juan Pablo', 'De la Fuente', 'juanpablo.delafuente@institucion.edu.ar',
     -- Email: juanpablo.delafuente@institucion.edu.ar / Contraseña: jbWhcR7p$68b%N5$
     '$2b$10$lOyrlEGRGD1vTeU4lilgH..KA3LnM7EX1i3DylZZRzQypUBSn/XJq', '26504372', '1977-09-01'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Camila', 'Ortiz', 'camila.ortiz@institucion.edu.ar',
     -- Email: camila.ortiz@institucion.edu.ar / Contraseña: Xn9h33Tt8%V@QTfG
     '$2b$10$i9BMM7Y3fv5AAl0rK5xfSudaHQzL362Hq9Ed.kubAk3E06J7CH7O.', '43518270', '2001-06-29'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     FALSE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Carolina', 'Vallejos', 'carolina.vallejos@institucion.edu.ar',
     -- Email: carolina.vallejos@institucion.edu.ar / Contraseña: Ffdc4Ry*Jw*c$nN5
     '$2b$10$YbLO0tIckpTS4VriOs1Rv.CDNJMXEfLyDfVhQhsREbhDAS.TSqdv2', '35460918', '1990-10-19'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     FALSE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Roberto', 'Sánchez', 'roberto.sanchez@institucion.edu.ar',
     -- Email: roberto.sanchez@institucion.edu.ar / Contraseña: #2cPN9n$Af3XN$x!
     '$2b$10$Kn0NtD.Ba.daKJ8vOI6kKekNbVDU9IJVJrlKyp9M3/FBRPxFGH4oa', '14382509', '1961-02-14'),

    -- Segunda cuenta de Julián Romero, que también es secretario
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Julián', 'Romero', 'julian.romero@institucion.edu.ar',
     -- Email: julian.romero@institucion.edu.ar / Contraseña: 6!y$GWY*7qYjVp%9
     '$2b$10$oQGJbmkjCELqXwZrN5T0PuoF24xC24TToDIjoy6nAoKZnu0OI2YEq', '36904127', '1992-01-09');

-- Usuaria dada de baja del Instituto San Martin, en un INSERT aparte porque es la única fila que
-- carga fecha_eliminacion. Como toda cuenta dada de baja, queda además suspendida
-- (ck_usuario_baja_suspendido). No cuenta para la unicidad del dni y del email, y un alta con su
-- dni y su rol propone restaurarla en lugar de crear otra cuenta.
INSERT INTO usuario (usuario_rol_id, estado, institucion_id, nombre, apellido, email, password_hash, dni, fecha_nacimiento, fecha_eliminacion) VALUES
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     FALSE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Marta', 'Quiroga', 'marta.quiroga@institucion.edu.ar',
     -- Email: marta.quiroga@institucion.edu.ar / Contraseña: 94yS!pdcW4Dg%T5f
     '$2b$10$kHQoz41VopLxfkRP6IcBEO/0gjeomRKvFOy6x4Pd7vUVHlHU0HA06', '21904736', '1970-04-08',
     '2026-08-14 12:00:00-03');

-- Usuarios del Colegio Manuel Belgrano: 2 (1 administrador, 1 profesor).
-- Silvia Gómez pertenece a las dos instituciones: tiene una fila en cada una, con el mismo dni, el
-- mismo email y la misma contraseña. Lo permiten los índices únicos de usuario, que solo impiden
-- repetirlos dentro de una misma institución y un mismo rol.
-- Credenciales de acceso (email / contraseña en texto plano):
--   claudia.ramirez@colegiobelgrano.edu.ar   / yLG*B4FfvR#&7h8W  (ADMIN)
--   silvia.gomez@institucion.edu.ar          / 5i#aTSG@#u!y@NZF  (PROFESOR, también en el Instituto San Martin)
INSERT INTO usuario (usuario_rol_id, estado, institucion_id, nombre, apellido, email, password_hash, dni, fecha_nacimiento) VALUES
    -- Administradores
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'ADMIN'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Claudia', 'Ramírez', 'claudia.ramirez@colegiobelgrano.edu.ar',
     -- Email: claudia.ramirez@colegiobelgrano.edu.ar / Contraseña: yLG*B4FfvR#&7h8W
     '$2b$10$KNNZUhJSlMYpbphT/.IYUuih1ecwN12grgR0TU/Q7NrjKnaGVZSei', '24613875', '1975-03-19'),

    -- Profesores
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Silvia', 'Gómez', 'silvia.gomez@institucion.edu.ar',
     -- Email: silvia.gomez@institucion.edu.ar / Contraseña: 5i#aTSG@#u!y@NZF
     '$2b$10$oA/cHInu9hbZeEDoGTjRFeAC/EeGLt982QphE64ytc1qnJcVxUGym', '20473158', '1968-09-28');

-- Materias: catálogo global. Ninguna depende de un grado ni de un nivel educativo: en cuáles se
-- dicta cada una lo define grado_materia
INSERT INTO materia (nombre) VALUES
    ('Lengua'),
    ('Matemática'),
    ('Ciencias Sociales'),
    ('Ciencias Naturales'),
    ('Inglés'),
    ('Educación Física'),
    ('Educación Artística'),
    ('Educación Tecnológica'),
    ('Formación Ética y Ciudadana'),
    ('Literatura'),
    ('Historia'),
    ('Geografía'),
    ('Biología'),
    ('Fisicoquímica'),
    ('Física'),
    ('Química'),
    ('Filosofía'),
    ('Psicología'),
    ('Economía');

-- Grados: de 1° a 6° en cada nivel educativo
INSERT INTO grado (nombre, nivel_educativo) VALUES
    ('1°', 'PRIMARIA'),
    ('2°', 'PRIMARIA'),
    ('3°', 'PRIMARIA'),
    ('4°', 'PRIMARIA'),
    ('5°', 'PRIMARIA'),
    ('6°', 'PRIMARIA'),
    ('1°', 'SECUNDARIA'),
    ('2°', 'SECUNDARIA'),
    ('3°', 'SECUNDARIA'),
    ('4°', 'SECUNDARIA'),
    ('5°', 'SECUNDARIA'),
    ('6°', 'SECUNDARIA');

-- Plan de estudios: las materias de cada grado. Los grados de un mismo ciclo comparten el plan,
-- así que cada INSERT cruza los grados de un ciclo con sus materias: 123 asociaciones en total.

-- Primaria, primer ciclo (1° a 3°): 8 materias por grado
INSERT INTO grado_materia (grado_id, materia_id)
SELECT g.grado_id, m.materia_id
FROM grado g
CROSS JOIN materia m
WHERE g.nivel_educativo = 'PRIMARIA'
  AND g.nombre IN ('1°', '2°', '3°')
  AND m.nombre IN ('Lengua', 'Matemática', 'Ciencias Sociales', 'Ciencias Naturales',
                   'Educación Física', 'Educación Artística', 'Educación Tecnológica',
                   'Formación Ética y Ciudadana')
ORDER BY g.grado_id, m.materia_id;

-- Primaria, segundo ciclo (4° a 6°): 9 materias por grado. Se suma Inglés
INSERT INTO grado_materia (grado_id, materia_id)
SELECT g.grado_id, m.materia_id
FROM grado g
CROSS JOIN materia m
WHERE g.nivel_educativo = 'PRIMARIA'
  AND g.nombre IN ('4°', '5°', '6°')
  AND m.nombre IN ('Lengua', 'Matemática', 'Ciencias Sociales', 'Ciencias Naturales', 'Inglés',
                   'Educación Física', 'Educación Artística', 'Educación Tecnológica',
                   'Formación Ética y Ciudadana')
ORDER BY g.grado_id, m.materia_id;

-- Secundaria, ciclo básico (1° a 3°): 11 materias por grado. Las ciencias sociales y naturales
-- de primaria se abren en Historia, Geografía, Biología y Fisicoquímica
INSERT INTO grado_materia (grado_id, materia_id)
SELECT g.grado_id, m.materia_id
FROM grado g
CROSS JOIN materia m
WHERE g.nivel_educativo = 'SECUNDARIA'
  AND g.nombre IN ('1°', '2°', '3°')
  AND m.nombre IN ('Lengua', 'Matemática', 'Inglés', 'Educación Física', 'Educación Artística',
                   'Educación Tecnológica', 'Formación Ética y Ciudadana', 'Historia',
                   'Geografía', 'Biología', 'Fisicoquímica')
ORDER BY g.grado_id, m.materia_id;

-- Secundaria, ciclo orientado (4° a 6°): 13 materias por grado. Literatura reemplaza a Lengua,
-- Fisicoquímica se separa en Física y Química, y se suman Filosofía, Psicología y Economía
INSERT INTO grado_materia (grado_id, materia_id)
SELECT g.grado_id, m.materia_id
FROM grado g
CROSS JOIN materia m
WHERE g.nivel_educativo = 'SECUNDARIA'
  AND g.nombre IN ('4°', '5°', '6°')
  AND m.nombre IN ('Matemática', 'Inglés', 'Educación Física', 'Formación Ética y Ciudadana',
                   'Literatura', 'Historia', 'Geografía', 'Biología', 'Física', 'Química',
                   'Filosofía', 'Psicología', 'Economía')
ORDER BY g.grado_id, m.materia_id;

-- Cursos: 18 por institución, 36 en total, todos del ciclo lectivo actual
-- (fn_anio_ciclo_lectivo_actual()), el único cargado: el seed no usa un año fijo, porque los datos
-- de un ciclo cerrado no se pueden cargar (trg_curso_ciclo_lectivo y los de las demás tablas). Cada
-- institución tiene los 12 grados con una división A y, en dos grados de cada nivel, más
-- divisiones; cada INSERT cruza los grados con sus divisiones.

-- Instituto San Martin: los 12 grados, con la división A. Primaria cursa a la mañana y secundaria
-- a la tarde
INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
SELECT (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
       g.grado_id, 'A',
       CASE g.nivel_educativo WHEN 'PRIMARIA' THEN 'MAÑANA' ELSE 'TARDE' END,
       fn_anio_ciclo_lectivo_actual()
FROM grado g
ORDER BY g.grado_id;

-- Instituto San Martin: 1° y 2° de cada nivel suman una división A a la mañana y una B a la
-- tarde. La A de primaria no se repite: es la del INSERT anterior, que ya cursa a la mañana. En
-- secundaria queda una división A en cada turno: son cursos distintos, porque el turno también
-- los identifica
INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
SELECT (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
       g.grado_id, d.division, d.turno, fn_anio_ciclo_lectivo_actual()
FROM grado g
CROSS JOIN (VALUES ('A', 'MAÑANA'), ('B', 'TARDE')) AS d(division, turno)
WHERE g.nombre IN ('1°', '2°')
  AND NOT (g.nivel_educativo = 'PRIMARIA' AND d.division = 'A')
ORDER BY g.grado_id, d.division;

-- Colegio Manuel Belgrano: los 12 grados, con la división A. Al revés que en el Instituto San
-- Martin, primaria cursa a la tarde y secundaria a la mañana
INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
SELECT (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
       g.grado_id, 'A',
       CASE g.nivel_educativo WHEN 'PRIMARIA' THEN 'TARDE' ELSE 'MAÑANA' END,
       fn_anio_ciclo_lectivo_actual()
FROM grado g
ORDER BY g.grado_id;

-- Colegio Manuel Belgrano: 5° y 6° de cada nivel suman una división A a la mañana y una B a la
-- tarde. La A de secundaria no se repite: es la del INSERT anterior, que ya cursa a la mañana. En
-- primaria queda una división A en cada turno
INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
SELECT (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
       g.grado_id, d.division, d.turno, fn_anio_ciclo_lectivo_actual()
FROM grado g
CROSS JOIN (VALUES ('A', 'MAÑANA'), ('B', 'TARDE')) AS d(division, turno)
WHERE g.nombre IN ('5°', '6°')
  AND NOT (g.nivel_educativo = 'SECUNDARIA' AND d.division = 'A')
ORDER BY g.grado_id, d.division;

-- Asignaciones docentes: 10 en el Instituto San Martin y 9 en el Colegio Manuel Belgrano, 19 en
-- total, todas vigentes y de profesores activos.
-- Cada fila de VALUES nombra al profesor por su email (el de su cuenta vigente de profesor: el
-- mismo email puede tener en la institución otra cuenta, con otro rol), al curso por los datos que
-- lo identifican dentro de la institución en el ciclo lectivo actual (el JOIN completa el año) y a
-- la materia por su nombre; los LEFT JOIN los traducen a sus ids. Son LEFT JOIN para que un dato
-- que no existe (por ejemplo, una materia que no es del plan de estudios del grado) deje su id en
-- NULL y el INSERT falle por NOT NULL: con un JOIN, la fila se saltearía sin avisar.

-- Instituto San Martin: 8 profesores. Pablo Fernández tiene dos materias de un mismo curso y Diego
-- González, una misma materia en dos cursos
INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
SELECT u.usuario_id, c.curso_id, gm.grado_materia_id
FROM (VALUES
    -- Primaria
    ('pablo.fernandez@institucion.edu.ar', 'PRIMARIA', '2°', 'A', 'MAÑANA', 'Lengua'),
    ('pablo.fernandez@institucion.edu.ar', 'PRIMARIA', '2°', 'A', 'MAÑANA', 'Matemática'),
    ('lorena.martinez@institucion.edu.ar', 'PRIMARIA', '3°', 'A', 'MAÑANA', 'Ciencias Naturales'),
    ('diego.gonzalez@institucion.edu.ar', 'PRIMARIA', '5°', 'A', 'MAÑANA', 'Inglés'),
    ('diego.gonzalez@institucion.edu.ar', 'PRIMARIA', '6°', 'A', 'MAÑANA', 'Inglés'),

    -- Secundaria
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '1°', 'A', 'TARDE', 'Matemática'),
    ('maria.gonzalez@institucion.edu.ar', 'SECUNDARIA', '2°', 'A', 'TARDE', 'Historia'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '2°', 'B', 'TARDE', 'Biología'),
    ('federico.ruizdiaz@institucion.edu.ar', 'SECUNDARIA', '4°', 'A', 'TARDE', 'Física'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '6°', 'A', 'TARDE', 'Literatura')
) AS a(email, nivel_educativo, grado, division, turno, materia)
LEFT JOIN institucion i ON i.cuit = '30-71234567-8'
LEFT JOIN usuario u ON u.institucion_id = i.institucion_id AND u.email = a.email
                   AND u.usuario_rol_id = (SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR')
                   AND u.fecha_eliminacion IS NULL
LEFT JOIN grado g ON g.nombre = a.grado AND g.nivel_educativo = a.nivel_educativo
LEFT JOIN curso c ON c.institucion_id = i.institucion_id AND c.grado_id = g.grado_id
                 AND c.division = a.division AND c.turno = a.turno
                 AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
LEFT JOIN materia m ON m.nombre = a.materia
LEFT JOIN grado_materia gm ON gm.grado_id = g.grado_id AND gm.materia_id = m.materia_id
ORDER BY c.curso_id, gm.grado_materia_id;

-- Colegio Manuel Belgrano: todas de Silvia Gómez, la única profesora de la institución. Dicta
-- Matemática hasta 3° de secundaria y Física en el ciclo orientado
INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
SELECT u.usuario_id, c.curso_id, gm.grado_materia_id
FROM (VALUES
    -- Primaria
    ('silvia.gomez@institucion.edu.ar', 'PRIMARIA', '5°', 'A', 'TARDE', 'Matemática'),
    ('silvia.gomez@institucion.edu.ar', 'PRIMARIA', '6°', 'A', 'TARDE', 'Matemática'),

    -- Secundaria
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '1°', 'A', 'MAÑANA', 'Matemática'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '2°', 'A', 'MAÑANA', 'Matemática'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '3°', 'A', 'MAÑANA', 'Matemática'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '4°', 'A', 'MAÑANA', 'Física'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'MAÑANA', 'Física'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '6°', 'A', 'MAÑANA', 'Física'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '6°', 'B', 'TARDE', 'Física')
) AS a(email, nivel_educativo, grado, division, turno, materia)
LEFT JOIN institucion i ON i.cuit = '30-69854321-5'
LEFT JOIN usuario u ON u.institucion_id = i.institucion_id AND u.email = a.email
                   AND u.usuario_rol_id = (SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR')
                   AND u.fecha_eliminacion IS NULL
LEFT JOIN grado g ON g.nombre = a.grado AND g.nivel_educativo = a.nivel_educativo
LEFT JOIN curso c ON c.institucion_id = i.institucion_id AND c.grado_id = g.grado_id
                 AND c.division = a.division AND c.turno = a.turno
                 AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
LEFT JOIN materia m ON m.nombre = a.materia
LEFT JOIN grado_materia gm ON gm.grado_id = g.grado_id AND gm.materia_id = m.materia_id
ORDER BY c.curso_id, gm.grado_materia_id;

-- Estados de alumno
INSERT INTO alumno_estado (nombre) VALUES
    ('ACTIVO'),
    ('EGRESADO');

-- Alumnos: 20 por institución, 40 en total: 32 activos y 8 egresados.
-- Cada fila de VALUES nombra el estado por su nombre y el LEFT JOIN lo traduce a su id. Como en las
-- asignaciones docentes, es LEFT JOIN para que un estado que no existe deje su id en NULL y el
-- INSERT falle por NOT NULL: con un JOIN, la fila se saltearía sin avisar.
-- Los datos tienen el formato que deja el formulario de alumnos
-- (renderer/shared/components/field-validation.component.js): dni de 8 dígitos, teléfono de 10 dígitos y
-- una edad de entre 5 y 25 años.
-- Lucía Maidana está en las dos instituciones, con el mismo dni: egresó de la primaria del Colegio
-- Manuel Belgrano y cursa la secundaria en el Instituto San Martin. Lo permite la restricción
-- UNIQUE (institucion_id, dni), que solo impide repetirlo dentro de una misma institución.

-- Instituto San Martin: 16 activos y 4 egresados
INSERT INTO alumno (institucion_id, alumno_estado_id, nombre, apellido, email, telefono,
                    direccion_calle, direccion_altura, dni, fecha_nacimiento)
SELECT i.institucion_id, e.alumno_estado_id, a.nombre, a.apellido, a.email, a.telefono,
       a.direccion_calle, a.direccion_altura, a.dni, a.fecha_nacimiento::date
FROM (VALUES
    -- Activos
    ('ACTIVO', 'Camila', 'Álvarez', 'camila.alvarez@institucion.edu.ar',
     '3794123456', 'Av. Belgrano', '1245', '48123456', '2010-03-12'),
    ('ACTIVO', 'Tomás', 'Benítez', 'tomas.benitez@institucion.edu.ar',
     '3794157821', 'Junín', '830', '47982310', '2009-07-25'),
    ('ACTIVO', 'Julieta', 'Cabrera', 'julieta.cabrera@institucion.edu.ar',
     '3794219034', 'Rivadavia', '2570', '49204775', '2011-11-08'),
    ('ACTIVO', 'Martina', 'Escobar', 'martina.escobar@institucion.edu.ar',
     '3794456602', 'Córdoba', '1880', '48556941', '2010-05-17'),
    ('ACTIVO', 'Lautaro', 'Ferreyra', 'lautaro.ferreyra@institucion.edu.ar',
     '3794523388', 'Mendoza', '640', '47331408', '2009-09-02'),
    ('ACTIVO', 'Valentina', 'Gauna', 'valentina.gauna@institucion.edu.ar',
     '3794607715', 'La Rioja', '1120', '49617882', '2011-12-21'),
    ('ACTIVO', 'Delfina', 'Ibarra', 'delfina.ibarra@institucion.edu.ar',
     '3794805563', 'Salta', '755', '48998127', '2010-02-09'),
    ('ACTIVO', 'Thiago', 'Juárez', 'thiago.juarez@institucion.edu.ar',
     '3794948871', 'Catamarca', '1460', '47145690', '2009-10-26'),
    -- También en el Colegio Manuel Belgrano, como egresada
    ('ACTIVO', 'Lucía', 'Maidana', 'lucia.maidana@institucion.edu.ar',
     '3794273184', 'San Juan', '1432', '53412768', '2013-09-14'),
    ('ACTIVO', 'Benjamín', 'Navarro', 'benjamin.navarro@institucion.edu.ar',
     '3794389105', 'Santa Fe', '968', '54876213', '2014-08-19'),
    ('ACTIVO', 'Emma', 'Pereyra', 'emma.pereyra@institucion.edu.ar',
     '3794492376', 'Tucumán', '1715', '55930472', '2016-01-27'),
    ('ACTIVO', 'Joaquín', 'Quiroga', 'joaquin.quiroga@institucion.edu.ar',
     '3794536048', 'Av. Maipú', '2310', '56704189', '2017-06-05'),
    ('ACTIVO', 'Sofía', 'Ramírez', 'sofia.ramirez@institucion.edu.ar',
     '3794621897', 'Bolívar', '540', '57318642', '2018-10-11'),
    ('ACTIVO', 'Mateo', 'Sandoval', 'mateo.sandoval@institucion.edu.ar',
     '3794745529', '9 de Julio', '1390', '58260715', '2019-03-30'),
    ('ACTIVO', 'Isabella', 'Torres', 'isabella.torres@institucion.edu.ar',
     '3794863740', 'Pellegrini', '1127', '59047386', '2020-07-16'),
    ('ACTIVO', 'Agustín', 'Vera', 'agustin.vera@institucion.edu.ar',
     '3794186653', 'Hipólito Yrigoyen', '2085', '51539027', '2012-05-23'),

    -- Egresados
    ('EGRESADO', 'Facundo', 'Duarte', 'facundo.duarte@institucion.edu.ar',
     '3794331120', 'San Martín', '415', '46870223', '2008-01-30'),
    ('EGRESADO', 'Bautista', 'Herrera', 'bautista.herrera@institucion.edu.ar',
     '3794712049', 'Entre Ríos', '2035', '46204559', '2008-06-14'),
    ('EGRESADO', 'Ignacio', 'Villalba', 'ignacio.villalba@institucion.edu.ar',
     '3794295071', 'Av. 3 de Abril', '1203', '44917560', '2006-11-19'),
    ('EGRESADO', 'Milagros', 'Zárate', 'milagros.zarate@institucion.edu.ar',
     '3794079412', '25 de Mayo', '1658', '45382974', '2007-04-08')
) AS a(estado, nombre, apellido, email, telefono, direccion_calle, direccion_altura, dni,
       fecha_nacimiento)
LEFT JOIN institucion i ON i.cuit = '30-71234567-8'
LEFT JOIN alumno_estado e ON e.nombre = a.estado
ORDER BY a.apellido, a.nombre;

-- Colegio Manuel Belgrano: 16 activos y 4 egresados
INSERT INTO alumno (institucion_id, alumno_estado_id, nombre, apellido, email, telefono,
                    direccion_calle, direccion_altura, dni, fecha_nacimiento)
SELECT i.institucion_id, e.alumno_estado_id, a.nombre, a.apellido, a.email, a.telefono,
       a.direccion_calle, a.direccion_altura, a.dni, a.fecha_nacimiento::date
FROM (VALUES
    -- Activos
    ('ACTIVO', 'Morena', 'Acuña', 'morena.acuna@colegiobelgrano.edu.ar',
     '3794518203', 'Perú', '1139', '50794158', '2011-08-25'),
    ('ACTIVO', 'Renata', 'Aguilar', 'renata.aguilar@colegiobelgrano.edu.ar',
     '3794317742', 'Lavalle', '1175', '50218436', '2011-02-18'),
    ('ACTIVO', 'Felipe', 'Barrios', 'felipe.barrios@colegiobelgrano.edu.ar',
     '3794428916', 'Av. Independencia', '3240', '52607981', '2013-06-07'),
    ('ACTIVO', 'Abril', 'Cardozo', 'abril.cardozo@colegiobelgrano.edu.ar',
     '3794553027', 'Quintana', '892', '54139865', '2014-12-02'),
    ('ACTIVO', 'Bruno', 'Domínguez', 'bruno.dominguez@colegiobelgrano.edu.ar',
     '3794635108', 'Mariano Moreno', '1536', '49873214', '2010-09-29'),
    ('ACTIVO', 'Catalina', 'Espinoza', 'catalina.espinoza@colegiobelgrano.edu.ar',
     '3794782691', 'Paraguay', '1048', '56381702', '2017-03-15'),
    ('ACTIVO', 'Dante', 'Franco', 'dante.franco@colegiobelgrano.edu.ar',
     '3794849350', 'Av. Armenia', '2765', '57692043', '2018-08-22'),
    ('ACTIVO', 'Olivia', 'Giménez', 'olivia.gimenez@colegiobelgrano.edu.ar',
     '3794924673', 'Uruguay', '674', '58945127', '2020-01-10'),
    ('ACTIVO', 'Simón', 'Gutiérrez', 'simon.gutierrez@colegiobelgrano.edu.ar',
     '3794673945', 'Necochea', '1582', '52093671', '2012-12-09'),
    ('ACTIVO', 'Francisco', 'López', 'francisco.lopez@colegiobelgrano.edu.ar',
     '3794091835', 'Chaco', '1921', '55406398', '2015-11-04'),
    ('ACTIVO', 'Jazmín', 'Meza', 'jazmin.meza@colegiobelgrano.edu.ar',
     '3794731068', 'Plácido Martínez', '936', '48371925', '2009-01-20'),
    ('ACTIVO', 'Guadalupe', 'Molina', 'guadalupe.molina@colegiobelgrano.edu.ar',
     '3794167204', 'Santiago del Estero', '1367', '48735019', '2009-04-26'),
    ('ACTIVO', 'Ramiro', 'Peralta', 'ramiro.peralta@colegiobelgrano.edu.ar',
     '3794235586', 'Jujuy', '805', '51264870', '2012-07-13'),
    ('ACTIVO', 'Mía', 'Rojas', 'mia.rojas@colegiobelgrano.edu.ar',
     '3794376419', 'Brasil', '1490', '53850746', '2014-05-31'),
    ('ACTIVO', 'Lorenzo', 'Silva', 'lorenzo.silva@colegiobelgrano.edu.ar',
     '3794460952', 'San Lorenzo', '2218', '47508263', '2008-10-03'),
    ('ACTIVO', 'Valentín', 'Vargas', 'valentin.vargas@colegiobelgrano.edu.ar',
     '3794887531', 'Av. Pujol', '2407', '55183409', '2015-06-18'),

    -- Egresados
    ('EGRESADO', 'Micaela', 'Bravo', 'micaela.bravo@colegiobelgrano.edu.ar',
     '3794026497', 'Buenos Aires', '1763', '45126834', '2007-02-11'),
    ('EGRESADO', 'Nahuel', 'Correa', 'nahuel.correa@colegiobelgrano.edu.ar',
     '3794149728', 'Don Bosco', '1294', '45673092', '2007-09-05'),
    -- También en el Instituto San Martin, como activa
    ('EGRESADO', 'Lucía', 'Maidana', 'lucia.maidana@colegiobelgrano.edu.ar',
     '3794273184', 'San Juan', '1432', '53412768', '2013-09-14'),
    ('EGRESADO', 'Aldana', 'Ríos', 'aldana.rios@colegiobelgrano.edu.ar',
     '3794263815', 'Las Heras', '517', '44305718', '2006-03-28')
) AS a(estado, nombre, apellido, email, telefono, direccion_calle, direccion_altura, dni,
       fecha_nacimiento)
LEFT JOIN institucion i ON i.cuit = '30-69854321-5'
LEFT JOIN alumno_estado e ON e.nombre = a.estado
ORDER BY a.apellido, a.nombre;

-- Estados de inscripción
INSERT INTO inscripcion_estado (nombre) VALUES
    ('ACTIVA'),
    ('CANCELADA'),
    ('FINALIZADA');

-- Inscripciones: 15 por institución, 30 en total: 16 activas y 14 canceladas. Ninguna está
-- finalizada: una inscripción sigue activa durante todo su ciclo lectivo, y solo el cierre del ciclo
-- (sp_inscripcion_finalizar_ciclos_cerrados) la pasa a finalizada.
-- Cada fila de VALUES nombra el estado por su nombre, al alumno por su email y al curso por los
-- datos que lo identifican dentro de la institución en el ciclo lectivo actual (el JOIN completa el
-- año); los LEFT JOIN los traducen a sus ids. Como en las asignaciones docentes, son LEFT JOIN para
-- que un dato que no existe deje su id en NULL y el INSERT falle por NOT NULL: con un JOIN, la fila
-- se saltearía sin avisar.
-- Las activas son de alumnos activos, y ningún alumno tiene más de una: lo exige
-- trg_inscripcion_coherencia. Las canceladas cubren los dos casos: el alumno que dejó de cursar,
-- que sigue activo y sin inscripción activa, y el cambio de curso, que tiene una inscripción
-- posterior del mismo alumno, activa, en el curso al que pasó.
-- VALUES da el mes y el día de cada fecha de inscripción; el año es el del ciclo lectivo actual, el
-- de todos los cursos, como exige trg_inscripcion_fecha_ciclo_lectivo: las inscripciones se hacen
-- durante ese año, a partir de enero. Ese trigger también rechaza una fecha futura, así que si se
-- carga antes de mediados de marzo, la fecha que todavía no llegó queda con el día de la carga
-- (LEAST con fn_fecha_actual()).
-- El ORDER BY las inserta por fecha de inscripción, para que los ids sigan el orden en que se
-- habrían cargado.
-- Quedan alumnos sin ninguna inscripción, algunos de ellos activos.

-- Instituto San Martin: 8 activas y 7 canceladas
INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion)
SELECT a.alumno_id, c.curso_id, e.inscripcion_estado_id, LEAST(make_date(fn_anio_ciclo_lectivo_actual(), ins.mes, ins.dia), fn_fecha_actual())
FROM (VALUES
    -- Activas
    ('ACTIVA', 'camila.alvarez@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'TARDE', 2, 9),
    ('ACTIVA', 'tomas.benitez@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'TARDE', 2, 10),
    ('ACTIVA', 'julieta.cabrera@institucion.edu.ar', 'SECUNDARIA', '3°', 'A', 'TARDE', 1, 13),
    ('ACTIVA', 'valentina.gauna@institucion.edu.ar', 'SECUNDARIA', '3°', 'A', 'TARDE', 1, 15),
    -- Terminó la primaria en el Colegio Manuel Belgrano
    ('ACTIVA', 'lucia.maidana@institucion.edu.ar', 'SECUNDARIA', '1°', 'A', 'TARDE', 2, 20),
    ('ACTIVA', 'joaquin.quiroga@institucion.edu.ar', 'PRIMARIA', '4°', 'A', 'MAÑANA', 3, 4),
    ('ACTIVA', 'sofia.ramirez@institucion.edu.ar', 'PRIMARIA', '2°', 'A', 'MAÑANA', 1, 19),
    ('ACTIVA', 'mateo.sandoval@institucion.edu.ar', 'PRIMARIA', '2°', 'A', 'MAÑANA', 1, 20),

    -- Canceladas porque el alumno dejó de cursar
    ('CANCELADA', 'martina.escobar@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'TARDE', 2, 11),
    ('CANCELADA', 'lautaro.ferreyra@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'TARDE', 2, 12),
    ('CANCELADA', 'thiago.juarez@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'TARDE', 2, 18),
    ('CANCELADA', 'agustin.vera@institucion.edu.ar', 'SECUNDARIA', '3°', 'A', 'TARDE', 1, 22),

    -- Canceladas por cambio de curso: los tres pasaron al grado siguiente, donde tienen la activa
    ('CANCELADA', 'valentina.gauna@institucion.edu.ar', 'SECUNDARIA', '2°', 'A', 'MAÑANA', 1, 5),
    ('CANCELADA', 'mateo.sandoval@institucion.edu.ar', 'PRIMARIA', '1°', 'A', 'MAÑANA', 1, 7),
    ('CANCELADA', 'joaquin.quiroga@institucion.edu.ar', 'PRIMARIA', '3°', 'A', 'MAÑANA', 2, 23)
) AS ins(estado, email, nivel_educativo, grado, division, turno, mes, dia)
LEFT JOIN institucion i ON i.cuit = '30-71234567-8'
LEFT JOIN alumno a ON a.institucion_id = i.institucion_id AND a.email = ins.email
LEFT JOIN grado g ON g.nombre = ins.grado AND g.nivel_educativo = ins.nivel_educativo
LEFT JOIN curso c ON c.institucion_id = i.institucion_id AND c.grado_id = g.grado_id
                 AND c.division = ins.division AND c.turno = ins.turno
                 AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
LEFT JOIN inscripcion_estado e ON e.nombre = ins.estado
ORDER BY ins.mes, ins.dia, a.alumno_id;

-- Colegio Manuel Belgrano: 8 activas y 7 canceladas
INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion)
SELECT a.alumno_id, c.curso_id, e.inscripcion_estado_id, LEAST(make_date(fn_anio_ciclo_lectivo_actual(), ins.mes, ins.dia), fn_fecha_actual())
FROM (VALUES
    -- Activas
    ('ACTIVA', 'renata.aguilar@colegiobelgrano.edu.ar', 'SECUNDARIA', '4°', 'A', 'MAÑANA', 2, 9),
    ('ACTIVA', 'felipe.barrios@colegiobelgrano.edu.ar', 'SECUNDARIA', '2°', 'A', 'MAÑANA', 3, 11),
    ('ACTIVA', 'abril.cardozo@colegiobelgrano.edu.ar', 'PRIMARIA', '6°', 'A', 'TARDE', 2, 11),
    ('ACTIVA', 'catalina.espinoza@colegiobelgrano.edu.ar', 'PRIMARIA', '4°', 'A', 'TARDE', 2, 24),
    ('ACTIVA', 'olivia.gimenez@colegiobelgrano.edu.ar', 'PRIMARIA', '1°', 'A', 'TARDE', 2, 26),
    ('ACTIVA', 'guadalupe.molina@colegiobelgrano.edu.ar', 'SECUNDARIA', '6°', 'A', 'MAÑANA', 1, 14),
    ('ACTIVA', 'mia.rojas@colegiobelgrano.edu.ar', 'SECUNDARIA', '1°', 'A', 'MAÑANA', 1, 21),
    ('ACTIVA', 'lorenzo.silva@colegiobelgrano.edu.ar', 'SECUNDARIA', '6°', 'A', 'MAÑANA', 1, 16),

    -- Canceladas porque el alumno dejó de cursar
    ('CANCELADA', 'morena.acuna@colegiobelgrano.edu.ar', 'SECUNDARIA', '3°', 'A', 'MAÑANA', 2, 13),
    ('CANCELADA', 'simon.gutierrez@colegiobelgrano.edu.ar', 'SECUNDARIA', '2°', 'A', 'MAÑANA', 2, 19),
    ('CANCELADA', 'jazmin.meza@colegiobelgrano.edu.ar', 'SECUNDARIA', '5°', 'A', 'MAÑANA', 1, 9),
    ('CANCELADA', 'valentin.vargas@colegiobelgrano.edu.ar', 'PRIMARIA', '6°', 'A', 'TARDE', 2, 20),

    -- Canceladas por cambio de curso: los tres pasaron al grado siguiente, donde tienen la activa
    ('CANCELADA', 'felipe.barrios@colegiobelgrano.edu.ar', 'SECUNDARIA', '1°', 'A', 'MAÑANA', 2, 27),
    ('CANCELADA', 'mia.rojas@colegiobelgrano.edu.ar', 'PRIMARIA', '6°', 'A', 'MAÑANA', 1, 8),
    ('CANCELADA', 'lorenzo.silva@colegiobelgrano.edu.ar', 'SECUNDARIA', '5°', 'A', 'MAÑANA', 1, 5)
) AS ins(estado, email, nivel_educativo, grado, division, turno, mes, dia)
LEFT JOIN institucion i ON i.cuit = '30-69854321-5'
LEFT JOIN alumno a ON a.institucion_id = i.institucion_id AND a.email = ins.email
LEFT JOIN grado g ON g.nombre = ins.grado AND g.nivel_educativo = ins.nivel_educativo
LEFT JOIN curso c ON c.institucion_id = i.institucion_id AND c.grado_id = g.grado_id
                 AND c.division = ins.division AND c.turno = ins.turno
                 AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
LEFT JOIN inscripcion_estado e ON e.nombre = ins.estado
ORDER BY ins.mes, ins.dia, a.alumno_id;

-- Evaluaciones: 5 por asignación docente, 95 en total, todas vigentes.
-- El INSERT cruza las asignaciones con las cinco evaluaciones de VALUES, así que todas tienen los
-- mismos títulos y las mismas fechas. Un título solo no se puede repetir dentro de una asignación
-- (uq_evaluacion_asignacion_docente_titulo).
-- VALUES da el día y el mes de cada fecha; el año es el ciclo lectivo del curso de la asignación,
-- como exige trg_evaluacion_fecha_ciclo_lectivo: el actual, el único cargado. Las cinco se eligieron
-- como días de clase del ciclo 2026, que no caen en fin de semana ni en feriado; en otro año alguna
-- puede caer en uno. Las fechas no dependen del día de la carga: las posteriores quedan en el futuro.
-- El ORDER BY deja juntas las de cada asignación, en orden de fecha.
INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion)
SELECT a.asignacion_docente_id, e.titulo, make_date(c.anio_ciclo_lectivo, e.mes, e.dia)
FROM asignacion_docente a
JOIN curso c ON c.curso_id = a.curso_id
CROSS JOIN (VALUES
    ('Evaluación diagnóstica', 3, 18),
    ('Trabajo práctico 1', 4, 23),
    ('Evaluación escrita 1', 6, 10),
    ('Trabajo práctico 2', 9, 2),
    ('Evaluación escrita 2', 11, 12)
) AS e(titulo, mes, dia)
ORDER BY a.asignacion_docente_id, e.mes, e.dia;

-- Calificaciones: una por cada evaluación ya tomada y cada inscripción activa del curso de su
-- asignación. Ya tomada es con fecha de hoy o anterior (fn_fecha_actual()): la base también lo
-- exige (trg_calificacion_coherencia), así que el filtro no se puede quitar. La cantidad depende del
-- día de la carga: ninguna antes de la primera fecha de las evaluaciones (18 de marzo) y 55 desde
-- la última (12 de noviembre).
-- El INSERT no las enumera: une cada evaluación con las inscripciones del curso de su asignación,
-- así que ninguna evaluación ya tomada queda con un alumno del curso sin calificar.
-- Solo cuentan las inscripciones activas: trg_calificacion_coherencia rechaza las demás, también
-- al cargarlas. Por eso quedan sin calificaciones las evaluaciones de los cursos que no tienen
-- ninguna inscripción activa.
-- La nota se calcula con los dos ids, para que sea la misma en cada carga: va de 4 a 10 de a 0,25,
-- así que hay enteras y con decimales.
-- El ORDER BY deja juntas las de cada evaluación.
INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota)
SELECT e.evaluacion_id, i.inscripcion_id,
       4 + (e.evaluacion_id * 7 + i.inscripcion_id * 3) % 25 * 0.25
FROM evaluacion e
JOIN asignacion_docente a ON a.asignacion_docente_id = e.asignacion_docente_id
JOIN inscripcion i ON i.curso_id = a.curso_id
JOIN inscripcion_estado s ON s.inscripcion_estado_id = i.inscripcion_estado_id
WHERE s.nombre = 'ACTIVA'
  AND e.fecha_evaluacion <= fn_fecha_actual()
ORDER BY e.evaluacion_id, i.inscripcion_id;

COMMIT;
