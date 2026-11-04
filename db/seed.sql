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

-- Usuarios: 15 cuentas por institución, 30 en total, con los mismos casos en las dos: 2
-- administradores, 4 secretarios (2 activos, 1 suspendido y 1 dado de baja) y 9 profesores (7
-- activos, 1 suspendido y 1 dado de baja). Uno de los secretarios activos también es profesor.
-- Una persona con dos roles en una institución, o que trabaja en las dos, tiene una cuenta por cada
-- una, con el mismo dni, el mismo email y la misma contraseña: al iniciar sesión elige con cuál
-- ingresar. Lo permiten los índices únicos de usuario, que solo impiden repetir el dni o el email
-- dentro de una institución y un rol.
-- Silvia Gómez, Nicolás Aguirre y Gabriela Ojeda son profesores en las dos instituciones; nadie más
-- está en las dos.
-- Los secretarios suspendidos y dados de baja se cargan así en el INSERT. Los profesores suspendidos
-- y dados de baja se cargan activos y cambian de estado después de sus asignaciones docentes (más
-- abajo): un profesor recibe asignaciones solo si está activo, y uno con asignaciones vigentes no se
-- da de baja.

-- Usuarios del Instituto San Martin.
-- Credenciales de acceso (email / contraseña en texto plano):
--   mariana.sosa@institucion.edu.ar          / 7$4GhQ4yd9WZ$pyE  (ADMIN)
--   hernan.acosta@institucion.edu.ar         / SUs&LVqS3AbKnq6x  (ADMIN)
--   valeria.benitez@institucion.edu.ar       / B@cC5iimsQJHXQ5d  (SECRETARIO)
--   julian.romero@institucion.edu.ar         / 6!y$GWY*7qYjVp%9  (SECRETARIO y PROFESOR)
--   ricardo.medina@institucion.edu.ar        / pzvg3&4JpNWM#e*#  (SECRETARIO, suspendido)
--   marta.quiroga@institucion.edu.ar         / 94yS!pdcW4Dg%T5f  (SECRETARIO, dada de baja)
--   silvia.gomez@institucion.edu.ar          / 5i#aTSG@#u!y@NZF  (PROFESOR, también en el Colegio Manuel Belgrano)
--   nicolas.aguirre@institucion.edu.ar       / i#EyS6Z&H4AbNU*z  (PROFESOR, también en el Colegio Manuel Belgrano)
--   gabriela.ojeda@institucion.edu.ar        / L$KPrw7ym3!Lreq$  (PROFESOR, también en el Colegio Manuel Belgrano)
--   lorena.martinez@institucion.edu.ar       / &2q2pmAiRq6vQhnf  (PROFESOR)
--   pablo.fernandez@institucion.edu.ar       / BaeU6Qw4#ZeP#EmW  (PROFESOR)
--   diego.gonzalez@institucion.edu.ar        / K8JB!HZ6tp5*wGy3  (PROFESOR)
--   carolina.vallejos@institucion.edu.ar     / Ffdc4Ry*Jw*c$nN5  (PROFESOR, suspendida)
--   roberto.sanchez@institucion.edu.ar       / #2cPN9n$Af3XN$x!  (PROFESOR, dado de baja)
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
     FALSE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Ricardo', 'Medina', 'ricardo.medina@institucion.edu.ar',
     -- Email: ricardo.medina@institucion.edu.ar / Contraseña: pzvg3&4JpNWM#e*#
     '$2b$10$oidAwnRpgD4EJEyZXBFWv.l7acqqs/c/Ds.a8JIFgrNqlOvciILm2', '22648390', '1971-06-17'),

    -- Profesores. Los tres primeros también son profesores en el Colegio Manuel Belgrano
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Silvia', 'Gómez', 'silvia.gomez@institucion.edu.ar',
     -- Email: silvia.gomez@institucion.edu.ar / Contraseña: 5i#aTSG@#u!y@NZF
     '$2b$10$oA/cHInu9hbZeEDoGTjRFeAC/EeGLt982QphE64ytc1qnJcVxUGym', '20473158', '1968-09-28'),

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
     'Lorena', 'Martínez', 'lorena.martinez@institucion.edu.ar',
     -- Email: lorena.martinez@institucion.edu.ar / Contraseña: &2q2pmAiRq6vQhnf
     '$2b$10$zP1soIkq1hXRnsRR2Xdq.e738DWr5QoZVYSIttVpqTHk7QTiEchja', '29158473', '1981-11-30'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Pablo', 'Fernández', 'pablo.fernandez@institucion.edu.ar',
     -- Email: pablo.fernandez@institucion.edu.ar / Contraseña: BaeU6Qw4#ZeP#EmW
     '$2b$10$K9mIpAu9XGp9dp/M0cqV7elhVr2Hz5tCAcyh0hj/I7hu9LHi9rdVG', '31742806', '1985-04-11'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Diego', 'González', 'diego.gonzalez@institucion.edu.ar',
     -- Email: diego.gonzalez@institucion.edu.ar / Contraseña: K8JB!HZ6tp5*wGy3
     '$2b$10$WnVWJaHEBXa0.Q31kJUUQu9cwqcaJQ9cwh4xpFokePiRhMgxvO8US', '34926051', '1989-07-05'),

    -- Se suspende después de sus asignaciones docentes
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Carolina', 'Vallejos', 'carolina.vallejos@institucion.edu.ar',
     -- Email: carolina.vallejos@institucion.edu.ar / Contraseña: Ffdc4Ry*Jw*c$nN5
     '$2b$10$YbLO0tIckpTS4VriOs1Rv.CDNJMXEfLyDfVhQhsREbhDAS.TSqdv2', '35460918', '1990-10-19'),

    -- Se da de baja después de dar de baja su asignación docente
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
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

-- Secretaria dada de baja del Instituto San Martin, en un INSERT aparte porque carga
-- fecha_eliminacion. Como toda cuenta dada de baja, queda además suspendida
-- (ck_usuario_baja_suspendido). No cuenta para la unicidad del dni y del email, y un alta con su
-- dni y su rol propone restaurarla en lugar de crear otra cuenta.
-- La fecha de baja es del ciclo lectivo actual y no futura, la misma que la de los profesores dados
-- de baja (más abajo): el 2 de marzo o, si se carga antes, el día de la carga.
INSERT INTO usuario (usuario_rol_id, estado, institucion_id, nombre, apellido, email, password_hash, dni, fecha_nacimiento, fecha_eliminacion) VALUES
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     FALSE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
     'Marta', 'Quiroga', 'marta.quiroga@institucion.edu.ar',
     -- Email: marta.quiroga@institucion.edu.ar / Contraseña: 94yS!pdcW4Dg%T5f
     '$2b$10$kHQoz41VopLxfkRP6IcBEO/0gjeomRKvFOy6x4Pd7vUVHlHU0HA06', '21904736', '1970-04-08',
     LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 3, 2), fn_fecha_actual())::TIMESTAMPTZ);

-- Usuarios del Colegio Manuel Belgrano: los mismos casos que en el Instituto San Martin. Silvia
-- Gómez, Nicolás Aguirre y Gabriela Ojeda repiten el dni, el email, la fecha de nacimiento y la
-- contraseña de su cuenta del Instituto San Martin.
-- Credenciales de acceso (email / contraseña en texto plano):
--   claudia.ramirez@colegiobelgrano.edu.ar    / yLG*B4FfvR#&7h8W  (ADMIN)
--   gustavo.leiva@colegiobelgrano.edu.ar      / x8zjKX@3@mLqDZzm  (ADMIN)
--   patricia.baez@colegiobelgrano.edu.ar      / zV7NhpwBth!3Q6Fr  (SECRETARIO)
--   andres.caceres@colegiobelgrano.edu.ar     / H2y5wPr6Y@dGm9LL  (SECRETARIO y PROFESOR)
--   susana.robledo@colegiobelgrano.edu.ar     / *Z8A%!urV3yvrEXZ  (SECRETARIO, suspendida)
--   hector.galarza@colegiobelgrano.edu.ar     / rANbZ!thr##MWq7k  (SECRETARIO, dado de baja)
--   silvia.gomez@institucion.edu.ar           / 5i#aTSG@#u!y@NZF  (PROFESOR, también en el Instituto San Martin)
--   nicolas.aguirre@institucion.edu.ar        / i#EyS6Z&H4AbNU*z  (PROFESOR, también en el Instituto San Martin)
--   gabriela.ojeda@institucion.edu.ar         / L$KPrw7ym3!Lreq$  (PROFESOR, también en el Instituto San Martin)
--   natalia.fleitas@colegiobelgrano.edu.ar    / kNxwBF!#gy5mvyc$  (PROFESOR)
--   martin.sotelo@colegiobelgrano.edu.ar      / V&Z8x4pSpAtxQ29i  (PROFESOR)
--   veronica.almiron@colegiobelgrano.edu.ar   / ngcreT%aYt3dC4aP  (PROFESOR)
--   esteban.montiel@colegiobelgrano.edu.ar    / 9wHPuRG&@ebgS%q&  (PROFESOR, suspendido)
--   alicia.insaurralde@colegiobelgrano.edu.ar / gCK5j*nb8DrvBgm7  (PROFESOR, dada de baja)
INSERT INTO usuario (usuario_rol_id, estado, institucion_id, nombre, apellido, email, password_hash, dni, fecha_nacimiento) VALUES
    -- Administradores
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'ADMIN'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Claudia', 'Ramírez', 'claudia.ramirez@colegiobelgrano.edu.ar',
     -- Email: claudia.ramirez@colegiobelgrano.edu.ar / Contraseña: yLG*B4FfvR#&7h8W
     '$2b$10$KNNZUhJSlMYpbphT/.IYUuih1ecwN12grgR0TU/Q7NrjKnaGVZSei', '24613875', '1975-03-19'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'ADMIN'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Gustavo', 'Leiva', 'gustavo.leiva@colegiobelgrano.edu.ar',
     -- Email: gustavo.leiva@colegiobelgrano.edu.ar / Contraseña: x8zjKX@3@mLqDZzm
     '$2b$10$4FkHIvLQ4tVXXekV1vMWW.GpaHmKGXDNqTpKFuXeyK5BTMXkr0m/6', '23158640', '1972-07-22'),

    -- Secretarios
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Patricia', 'Báez', 'patricia.baez@colegiobelgrano.edu.ar',
     -- Email: patricia.baez@colegiobelgrano.edu.ar / Contraseña: zV7NhpwBth!3Q6Fr
     '$2b$10$8eWeEtHmkIAbNLFx/NcPp.UvfjKRCz3vW3wQVJr/Gd./TiTiCyckm', '30914827', '1984-03-09'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Andrés', 'Cáceres', 'andres.caceres@colegiobelgrano.edu.ar',
     -- Email: andres.caceres@colegiobelgrano.edu.ar / Contraseña: H2y5wPr6Y@dGm9LL
     '$2b$10$qG/fQCwVbEajKnRsWoi2peK1mLOWAx2XITeQGLQObsvawQbQ2ok/i', '35287416', '1990-11-15'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     FALSE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Susana', 'Robledo', 'susana.robledo@colegiobelgrano.edu.ar',
     -- Email: susana.robledo@colegiobelgrano.edu.ar / Contraseña: *Z8A%!urV3yvrEXZ
     '$2b$10$U.kD9MDghC/jfd6sE8Dvk.X7gKeQJL.6HHpVGVLAG30OsQ3a1whqa', '18452973', '1967-05-03'),

    -- Profesores. Los tres primeros también son profesores en el Instituto San Martin
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Silvia', 'Gómez', 'silvia.gomez@institucion.edu.ar',
     -- Email: silvia.gomez@institucion.edu.ar / Contraseña: 5i#aTSG@#u!y@NZF
     '$2b$10$oA/cHInu9hbZeEDoGTjRFeAC/EeGLt982QphE64ytc1qnJcVxUGym', '20473158', '1968-09-28'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Nicolás', 'Aguirre', 'nicolas.aguirre@institucion.edu.ar',
     -- Email: nicolas.aguirre@institucion.edu.ar / Contraseña: i#EyS6Z&H4AbNU*z
     '$2b$10$1eFgBEB8k6vj92v0qwsgzOeNznCMJLA2AUVFEcCNFELvOBrahJK0e', '40183527', '1997-01-27'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Gabriela', 'Ojeda', 'gabriela.ojeda@institucion.edu.ar',
     -- Email: gabriela.ojeda@institucion.edu.ar / Contraseña: L$KPrw7ym3!Lreq$
     '$2b$10$v/3k5RatlbsuDRRWBbrYp.4LC5piRaHI.2a5H7hbFWLaNLtgTeBeq', '23796405', '1973-12-08'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Natalia', 'Fleitas', 'natalia.fleitas@colegiobelgrano.edu.ar',
     -- Email: natalia.fleitas@colegiobelgrano.edu.ar / Contraseña: kNxwBF!#gy5mvyc$
     '$2b$10$uh0JNQHaeNf93t9/DVJYOOYMrtZEHOBUbvz7RnieqflaqVtjCUL5W', '33670592', '1988-01-18'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Martín', 'Sotelo', 'martin.sotelo@colegiobelgrano.edu.ar',
     -- Email: martin.sotelo@colegiobelgrano.edu.ar / Contraseña: V&Z8x4pSpAtxQ29i
     '$2b$10$mSu3zQw2a4Ewd1cvH3xpFuVJJN/kLAsyubdUcDHU1Zf7tnx0zc2hy', '30258164', '1983-06-25'),

    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Verónica', 'Almirón', 'veronica.almiron@colegiobelgrano.edu.ar',
     -- Email: veronica.almiron@colegiobelgrano.edu.ar / Contraseña: ngcreT%aYt3dC4aP
     '$2b$10$mvWloiOLV8bHsihV2y4NEOycjcqv2n8TiVythmrqrKthEkaicFNZW', '39184756', '1995-10-04'),

    -- Se suspende después de sus asignaciones docentes
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Esteban', 'Montiel', 'esteban.montiel@colegiobelgrano.edu.ar',
     -- Email: esteban.montiel@colegiobelgrano.edu.ar / Contraseña: 9wHPuRG&@ebgS%q&
     '$2b$10$U9OjidzLLP/nZKDemvhA8.08RAoA8WXLOhjXaRHqli6nzUUGo0tOC', '27563019', '1979-12-12'),

    -- Se da de baja después de dar de baja su asignación docente
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Alicia', 'Insaurralde', 'alicia.insaurralde@colegiobelgrano.edu.ar',
     -- Email: alicia.insaurralde@colegiobelgrano.edu.ar / Contraseña: gCK5j*nb8DrvBgm7
     '$2b$10$1VvsiJvBrr1xwo50sWeEK.EBpWFOgUztYuNIoh8PQjnXyAOLGemwu', '16825347', '1962-04-20'),

    -- Segunda cuenta de Andrés Cáceres, que también es secretario
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Andrés', 'Cáceres', 'andres.caceres@colegiobelgrano.edu.ar',
     -- Email: andres.caceres@colegiobelgrano.edu.ar / Contraseña: H2y5wPr6Y@dGm9LL
     '$2b$10$qG/fQCwVbEajKnRsWoi2peK1mLOWAx2XITeQGLQObsvawQbQ2ok/i', '35287416', '1990-11-15');

-- Secretario dado de baja del Colegio Manuel Belgrano, como Marta Quiroga en el Instituto San
-- Martin
INSERT INTO usuario (usuario_rol_id, estado, institucion_id, nombre, apellido, email, password_hash, dni, fecha_nacimiento, fecha_eliminacion) VALUES
    ((SELECT usuario_rol_id FROM usuario_rol WHERE nombre = 'SECRETARIO'),
     FALSE,
     (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
     'Héctor', 'Galarza', 'hector.galarza@colegiobelgrano.edu.ar',
     -- Email: hector.galarza@colegiobelgrano.edu.ar / Contraseña: rANbZ!thr##MWq7k
     '$2b$10$LcaLC6ct/8/yIqaLoADJzeQ0moKl9nppMXM8tFGMJiGzw8S8RGOBK', '17039584', '1964-09-27',
     LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 3, 2), fn_fecha_actual())::TIMESTAMPTZ);

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

-- Cursos: 14 por institución, 28 en total, todos vigentes y del ciclo lectivo actual
-- (fn_anio_ciclo_lectivo_actual()), el único cargado: el seed no usa un año fijo, porque los datos
-- de un ciclo cerrado no se pueden cargar (trg_curso_ciclo_lectivo y los de las demás tablas).
-- Cada institución tiene los 12 grados con una división A y, además, una división B en 1° de cada
-- nivel, en el otro turno que la A de su nivel. Cada INSERT cruza los grados con sus divisiones.

-- Instituto San Martin: la primaria cursa a la mañana y la secundaria a la tarde; las dos B, al
-- revés (1° B de primaria a la tarde y 1° B de secundaria a la mañana)
INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
SELECT (SELECT institucion_id FROM institucion WHERE cuit = '30-71234567-8'),
       g.grado_id, d.division,
       CASE WHEN (g.nivel_educativo = 'PRIMARIA') = (d.division = 'A') THEN 'MAÑANA' ELSE 'TARDE' END,
       fn_anio_ciclo_lectivo_actual()
FROM grado g
CROSS JOIN (VALUES ('A'), ('B')) AS d(division)
WHERE d.division = 'A' OR g.nombre = '1°'
ORDER BY g.grado_id, d.division;

-- Colegio Manuel Belgrano: los mismos cursos con los turnos invertidos. La primaria cursa a la tarde
-- y la secundaria a la mañana; las dos B, al revés (1° B de primaria a la mañana y 1° B de
-- secundaria a la tarde)
INSERT INTO curso (institucion_id, grado_id, division, turno, anio_ciclo_lectivo)
SELECT (SELECT institucion_id FROM institucion WHERE cuit = '30-69854321-5'),
       g.grado_id, d.division,
       CASE WHEN (g.nivel_educativo = 'PRIMARIA') = (d.division = 'A') THEN 'TARDE' ELSE 'MAÑANA' END,
       fn_anio_ciclo_lectivo_actual()
FROM grado g
CROSS JOIN (VALUES ('A'), ('B')) AS d(division)
WHERE d.division = 'A' OR g.nombre = '1°'
ORDER BY g.grado_id, d.division;

-- Asignaciones docentes: 29 por institución, 58 en total: 28 vigentes (dos materias en cada curso)
-- y 1 dada de baja, la del profesor dado de baja. Las dos instituciones tienen las mismas: la misma
-- materia de cada curso la dicta el profesor equivalente (Natalia Fleitas por Lorena Martínez,
-- Martín Sotelo por Pablo Fernández, Verónica Almirón por Diego González, Andrés Cáceres por Julián
-- Romero, Esteban Montiel por Carolina Vallejos y Alicia Insaurralde por Roberto Sánchez) o el mismo
-- profesor, si trabaja en las dos.
-- Cada fila de VALUES nombra al profesor por su email (el de su cuenta vigente de profesor: el
-- mismo email puede tener en la institución otra cuenta, con otro rol), al curso por los datos que
-- lo identifican dentro de la institución en el ciclo lectivo actual (el JOIN completa el año) y a
-- la materia por su nombre; los LEFT JOIN los traducen a sus ids. Son LEFT JOIN para que un dato
-- que no existe (por ejemplo, una materia que no es del plan de estudios del grado) deje su id en
-- NULL y el INSERT falle por NOT NULL: con un JOIN, la fila se saltearía sin avisar.
-- En cada institución se cargan primero las vigentes, con todos los profesores activos (solo un
-- profesor activo recibe asignaciones: trg_asignacion_docente_coherencia); después, la del profesor
-- que se da de baja, que se da de baja antes que él (uno con asignaciones vigentes no se da de baja:
-- trg_usuario_asignaciones_vigentes), y por último se suspende al profesor suspendido, que conserva
-- sus dos asignaciones vigentes.
-- Las bajas llevan la fecha de la de los secretarios dados de baja: el 2 de marzo del ciclo actual
-- o, si se carga antes, el día de la carga.

-- Instituto San Martin: las 28 vigentes
INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
SELECT u.usuario_id, c.curso_id, gm.grado_materia_id
FROM (VALUES
    -- Primaria
    ('lorena.martinez@institucion.edu.ar', 'PRIMARIA', '1°', 'A', 'MAÑANA', 'Lengua'),
    ('lorena.martinez@institucion.edu.ar', 'PRIMARIA', '1°', 'A', 'MAÑANA', 'Matemática'),
    ('carolina.vallejos@institucion.edu.ar', 'PRIMARIA', '1°', 'B', 'TARDE', 'Lengua'),
    ('julian.romero@institucion.edu.ar', 'PRIMARIA', '1°', 'B', 'TARDE', 'Matemática'),
    ('pablo.fernandez@institucion.edu.ar', 'PRIMARIA', '2°', 'A', 'MAÑANA', 'Lengua'),
    ('pablo.fernandez@institucion.edu.ar', 'PRIMARIA', '2°', 'A', 'MAÑANA', 'Matemática'),
    ('julian.romero@institucion.edu.ar', 'PRIMARIA', '3°', 'A', 'MAÑANA', 'Matemática'),
    ('lorena.martinez@institucion.edu.ar', 'PRIMARIA', '3°', 'A', 'MAÑANA', 'Ciencias Naturales'),
    ('pablo.fernandez@institucion.edu.ar', 'PRIMARIA', '4°', 'A', 'MAÑANA', 'Lengua'),
    ('diego.gonzalez@institucion.edu.ar', 'PRIMARIA', '4°', 'A', 'MAÑANA', 'Inglés'),
    ('pablo.fernandez@institucion.edu.ar', 'PRIMARIA', '5°', 'A', 'MAÑANA', 'Matemática'),
    ('diego.gonzalez@institucion.edu.ar', 'PRIMARIA', '5°', 'A', 'MAÑANA', 'Inglés'),
    ('julian.romero@institucion.edu.ar', 'PRIMARIA', '6°', 'A', 'MAÑANA', 'Ciencias Sociales'),
    ('diego.gonzalez@institucion.edu.ar', 'PRIMARIA', '6°', 'A', 'MAÑANA', 'Inglés'),

    -- Secundaria
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '1°', 'A', 'TARDE', 'Matemática'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '1°', 'A', 'TARDE', 'Historia'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '1°', 'B', 'MAÑANA', 'Matemática'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '1°', 'B', 'MAÑANA', 'Biología'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '2°', 'A', 'TARDE', 'Matemática'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '2°', 'A', 'TARDE', 'Biología'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '3°', 'A', 'TARDE', 'Lengua'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '3°', 'A', 'TARDE', 'Fisicoquímica'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '4°', 'A', 'TARDE', 'Literatura'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '4°', 'A', 'TARDE', 'Física'),
    ('diego.gonzalez@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'TARDE', 'Inglés'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'TARDE', 'Química'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '6°', 'A', 'TARDE', 'Literatura'),
    ('carolina.vallejos@institucion.edu.ar', 'SECUNDARIA', '6°', 'A', 'TARDE', 'Filosofía')
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

-- Instituto San Martin: la asignación de Roberto Sánchez, que se da de baja, y después él
INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
SELECT u.usuario_id, c.curso_id, gm.grado_materia_id
FROM (VALUES
    ('roberto.sanchez@institucion.edu.ar', 'PRIMARIA', '2°', 'A', 'MAÑANA', 'Educación Física')
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
LEFT JOIN grado_materia gm ON gm.grado_id = g.grado_id AND gm.materia_id = m.materia_id;

UPDATE asignacion_docente
   SET fecha_eliminacion = LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 3, 2), fn_fecha_actual())::TIMESTAMPTZ
 WHERE usuario_id = (SELECT u.usuario_id
                       FROM usuario u
                       JOIN institucion i ON i.institucion_id = u.institucion_id
                       JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
                      WHERE i.cuit = '30-71234567-8'
                        AND u.email = 'roberto.sanchez@institucion.edu.ar'
                        AND r.nombre = 'PROFESOR');

UPDATE usuario u
   SET estado = FALSE,
       fecha_eliminacion = LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 3, 2), fn_fecha_actual())::TIMESTAMPTZ
  FROM institucion i, usuario_rol r
 WHERE i.institucion_id = u.institucion_id
   AND r.usuario_rol_id = u.usuario_rol_id
   AND i.cuit = '30-71234567-8'
   AND u.email = 'roberto.sanchez@institucion.edu.ar'
   AND r.nombre = 'PROFESOR';

-- Instituto San Martin: se suspende a Carolina Vallejos
UPDATE usuario u
   SET estado = FALSE
  FROM institucion i, usuario_rol r
 WHERE i.institucion_id = u.institucion_id
   AND r.usuario_rol_id = u.usuario_rol_id
   AND i.cuit = '30-71234567-8'
   AND u.email = 'carolina.vallejos@institucion.edu.ar'
   AND r.nombre = 'PROFESOR';

-- Colegio Manuel Belgrano: las 28 vigentes
INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
SELECT u.usuario_id, c.curso_id, gm.grado_materia_id
FROM (VALUES
    -- Primaria
    ('natalia.fleitas@colegiobelgrano.edu.ar', 'PRIMARIA', '1°', 'A', 'TARDE', 'Lengua'),
    ('natalia.fleitas@colegiobelgrano.edu.ar', 'PRIMARIA', '1°', 'A', 'TARDE', 'Matemática'),
    ('esteban.montiel@colegiobelgrano.edu.ar', 'PRIMARIA', '1°', 'B', 'MAÑANA', 'Lengua'),
    ('andres.caceres@colegiobelgrano.edu.ar', 'PRIMARIA', '1°', 'B', 'MAÑANA', 'Matemática'),
    ('martin.sotelo@colegiobelgrano.edu.ar', 'PRIMARIA', '2°', 'A', 'TARDE', 'Lengua'),
    ('martin.sotelo@colegiobelgrano.edu.ar', 'PRIMARIA', '2°', 'A', 'TARDE', 'Matemática'),
    ('andres.caceres@colegiobelgrano.edu.ar', 'PRIMARIA', '3°', 'A', 'TARDE', 'Matemática'),
    ('natalia.fleitas@colegiobelgrano.edu.ar', 'PRIMARIA', '3°', 'A', 'TARDE', 'Ciencias Naturales'),
    ('martin.sotelo@colegiobelgrano.edu.ar', 'PRIMARIA', '4°', 'A', 'TARDE', 'Lengua'),
    ('veronica.almiron@colegiobelgrano.edu.ar', 'PRIMARIA', '4°', 'A', 'TARDE', 'Inglés'),
    ('martin.sotelo@colegiobelgrano.edu.ar', 'PRIMARIA', '5°', 'A', 'TARDE', 'Matemática'),
    ('veronica.almiron@colegiobelgrano.edu.ar', 'PRIMARIA', '5°', 'A', 'TARDE', 'Inglés'),
    ('andres.caceres@colegiobelgrano.edu.ar', 'PRIMARIA', '6°', 'A', 'TARDE', 'Ciencias Sociales'),
    ('veronica.almiron@colegiobelgrano.edu.ar', 'PRIMARIA', '6°', 'A', 'TARDE', 'Inglés'),

    -- Secundaria
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '1°', 'A', 'MAÑANA', 'Matemática'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '1°', 'A', 'MAÑANA', 'Historia'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '1°', 'B', 'TARDE', 'Matemática'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '1°', 'B', 'TARDE', 'Biología'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '2°', 'A', 'MAÑANA', 'Matemática'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '2°', 'A', 'MAÑANA', 'Biología'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '3°', 'A', 'MAÑANA', 'Lengua'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '3°', 'A', 'MAÑANA', 'Fisicoquímica'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '4°', 'A', 'MAÑANA', 'Literatura'),
    ('silvia.gomez@institucion.edu.ar', 'SECUNDARIA', '4°', 'A', 'MAÑANA', 'Física'),
    ('veronica.almiron@colegiobelgrano.edu.ar', 'SECUNDARIA', '5°', 'A', 'MAÑANA', 'Inglés'),
    ('nicolas.aguirre@institucion.edu.ar', 'SECUNDARIA', '5°', 'A', 'MAÑANA', 'Química'),
    ('gabriela.ojeda@institucion.edu.ar', 'SECUNDARIA', '6°', 'A', 'MAÑANA', 'Literatura'),
    ('esteban.montiel@colegiobelgrano.edu.ar', 'SECUNDARIA', '6°', 'A', 'MAÑANA', 'Filosofía')
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

-- Colegio Manuel Belgrano: la asignación de Alicia Insaurralde, que se da de baja, y después ella
INSERT INTO asignacion_docente (usuario_id, curso_id, grado_materia_id)
SELECT u.usuario_id, c.curso_id, gm.grado_materia_id
FROM (VALUES
    ('alicia.insaurralde@colegiobelgrano.edu.ar', 'PRIMARIA', '2°', 'A', 'TARDE', 'Educación Física')
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
LEFT JOIN grado_materia gm ON gm.grado_id = g.grado_id AND gm.materia_id = m.materia_id;

UPDATE asignacion_docente
   SET fecha_eliminacion = LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 3, 2), fn_fecha_actual())::TIMESTAMPTZ
 WHERE usuario_id = (SELECT u.usuario_id
                       FROM usuario u
                       JOIN institucion i ON i.institucion_id = u.institucion_id
                       JOIN usuario_rol r ON r.usuario_rol_id = u.usuario_rol_id
                      WHERE i.cuit = '30-69854321-5'
                        AND u.email = 'alicia.insaurralde@colegiobelgrano.edu.ar'
                        AND r.nombre = 'PROFESOR');

UPDATE usuario u
   SET estado = FALSE,
       fecha_eliminacion = LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 3, 2), fn_fecha_actual())::TIMESTAMPTZ
  FROM institucion i, usuario_rol r
 WHERE i.institucion_id = u.institucion_id
   AND r.usuario_rol_id = u.usuario_rol_id
   AND i.cuit = '30-69854321-5'
   AND u.email = 'alicia.insaurralde@colegiobelgrano.edu.ar'
   AND r.nombre = 'PROFESOR';

-- Colegio Manuel Belgrano: se suspende a Esteban Montiel
UPDATE usuario u
   SET estado = FALSE
  FROM institucion i, usuario_rol r
 WHERE i.institucion_id = u.institucion_id
   AND r.usuario_rol_id = u.usuario_rol_id
   AND i.cuit = '30-69854321-5'
   AND u.email = 'esteban.montiel@colegiobelgrano.edu.ar'
   AND r.nombre = 'PROFESOR';

-- Estados de alumno
INSERT INTO alumno_estado (nombre) VALUES
    ('ACTIVO'),
    ('EGRESADO');

-- Estados de inscripción
INSERT INTO inscripcion_estado (nombre) VALUES
    ('ACTIVA'),
    ('CANCELADA'),
    ('FINALIZADA');

-- Alumnos, inscripciones, evaluaciones y calificaciones: las dos instituciones tienen los mismos
-- casos, con las mismas fechas y notas, así las cantidades coinciden en cualquier fecha. Por
-- institución: 391 alumnos, 388 inscripciones y 113 evaluaciones. Ningún alumno está en las dos.
-- Cada alumno tiene un ordinal n (de 1 a 391, el mismo en las dos instituciones) del que salen sus
-- datos, sus fechas y sus notas. Los datos se arman en tablas temporales, que se borran con el
-- COMMIT.
-- Todas las fechas son del ciclo lectivo actual y ninguna inscripción es futura: cada fecha es la
-- del día y mes indicados o, si se carga antes, el día de la carga. Solo se califican las
-- evaluaciones con fecha de hoy o anterior.

-- Cursos, con las inscripciones activas y vigentes que tiene cada uno al terminar el seed (de 20 a
-- 35, 381 en total, todas distintas). Los alumnos regulares (una sola inscripción, activa) de cada
-- curso son las inscripciones activas menos las de los casos especiales que terminan activos en él
-- (1° B de primaria, 1° A de secundaria y 3° A de primaria, uno cada uno): 378 en total. Sus n son
-- consecutivos, en el orden de la tabla, de n_desde a n_hasta. La edad es la de sus alumnos al 30 de
-- junio
CREATE TEMP TABLE seed_curso ON COMMIT DROP AS
SELECT c.*,
       (SUM(c.regulares) OVER (ORDER BY c.orden) - c.regulares + 1)::INT AS n_desde,
       (SUM(c.regulares) OVER (ORDER BY c.orden))::INT AS n_hasta
FROM (VALUES
    (1, 'PRIMARIA', '1°', 'A', 28, 28, 6),
    (2, 'PRIMARIA', '1°', 'B', 22, 21, 6),
    (3, 'PRIMARIA', '2°', 'A', 31, 31, 7),
    (4, 'PRIMARIA', '3°', 'A', 26, 25, 8),
    (5, 'PRIMARIA', '4°', 'A', 34, 34, 9),
    (6, 'PRIMARIA', '5°', 'A', 24, 24, 10),
    (7, 'PRIMARIA', '6°', 'A', 29, 29, 11),
    (8, 'SECUNDARIA', '1°', 'A', 33, 32, 12),
    (9, 'SECUNDARIA', '1°', 'B', 21, 21, 12),
    (10, 'SECUNDARIA', '2°', 'A', 30, 30, 13),
    (11, 'SECUNDARIA', '3°', 'A', 25, 25, 14),
    (12, 'SECUNDARIA', '4°', 'A', 35, 35, 15),
    (13, 'SECUNDARIA', '5°', 'A', 23, 23, 16),
    (14, 'SECUNDARIA', '6°', 'A', 20, 20, 17)
) AS c(orden, nivel_educativo, grado, division, activas, regulares, edad);

-- Alumnos: los 378 regulares (n de 1 a 378) y los 13 de los casos especiales (n = 378 + caso):
--   1 y 2: cambio de división; 3: abandono con notas; 4: abandono sin notas; 5: dado de baja con
--   notas; 6: dado de baja sin notas; 7: inscripción cargada por error; 8 a 11: egresados; 12 y
--   13: activos sin inscripción.
-- n = 40·q + r da el nombre r y el apellido (r + q) mod 40 de las listas, sin repetir pares. En el
-- Colegio Manuel Belgrano el nombre y el apellido salen de n + 400, así no repiten los del
-- Instituto San Martin. El email lleva el nombre y el apellido sin tildes. El dni de cada
-- institución tiene su propio rango. La fecha de nacimiento da la edad del grado al 30 de junio
-- del ciclo actual, con el mes y el día según n: así la edad queda entre 5 y 25 años (la que
-- acepta el formulario) en cualquier fecha del año
CREATE TEMP TABLE seed_alumno ON COMMIT DROP AS
WITH listas AS (
    SELECT ARRAY['Sofía', 'Mateo', 'Valentina', 'Benjamín', 'Martina', 'Thiago', 'Catalina', 'Joaquín',
                 'Emilia', 'Lautaro', 'Lucía', 'Santiago', 'Camila', 'Tomás', 'Agustina', 'Facundo',
                 'Milagros', 'Bautista', 'Julieta', 'Ramiro', 'Florencia', 'Ignacio', 'Abril', 'Máximo',
                 'Delfina', 'Gonzalo', 'Morena', 'Franco', 'Renata', 'Agustín', 'Victoria', 'Iván',
                 'Antonella', 'Simón', 'Guadalupe', 'Ezequiel', 'Zoe', 'Valentín', 'Malena', 'Nahuel'] AS nombres,
           ARRAY['sofia', 'mateo', 'valentina', 'benjamin', 'martina', 'thiago', 'catalina', 'joaquin',
                 'emilia', 'lautaro', 'lucia', 'santiago', 'camila', 'tomas', 'agustina', 'facundo',
                 'milagros', 'bautista', 'julieta', 'ramiro', 'florencia', 'ignacio', 'abril', 'maximo',
                 'delfina', 'gonzalo', 'morena', 'franco', 'renata', 'agustin', 'victoria', 'ivan',
                 'antonella', 'simon', 'guadalupe', 'ezequiel', 'zoe', 'valentin', 'malena', 'nahuel'] AS nombres_email,
           ARRAY['Acuña', 'Barrios', 'Cabrera', 'Duarte', 'Escobar', 'Figueroa', 'Giménez', 'Herrera',
                 'Ibáñez', 'Juárez', 'Ledesma', 'Maidana', 'Núñez', 'Ortiz', 'Paredes', 'Quintana',
                 'Ríos', 'Silva', 'Torres', 'Vera', 'Zárate', 'Aquino', 'Coronel', 'Domínguez',
                 'Espíndola', 'Gauna', 'Lezcano', 'Molina', 'Navarro', 'Peralta', 'Retamozo', 'Saucedo',
                 'Toledo', 'Villalba', 'Alegre', 'Brítez', 'Cardozo', 'Encina', 'Morínigo', 'Pereyra'] AS apellidos,
           ARRAY['acuna', 'barrios', 'cabrera', 'duarte', 'escobar', 'figueroa', 'gimenez', 'herrera',
                 'ibanez', 'juarez', 'ledesma', 'maidana', 'nunez', 'ortiz', 'paredes', 'quintana',
                 'rios', 'silva', 'torres', 'vera', 'zarate', 'aquino', 'coronel', 'dominguez',
                 'espindola', 'gauna', 'lezcano', 'molina', 'navarro', 'peralta', 'retamozo', 'saucedo',
                 'toledo', 'villalba', 'alegre', 'britez', 'cardozo', 'encina', 'morinigo', 'pereyra'] AS apellidos_email,
           ARRAY['San Juan', 'Junín', 'Mendoza', 'Carlos Pellegrini', 'Bolívar', 'La Rioja', 'Córdoba',
                 'Catamarca', 'Salta', 'Tucumán', 'Santa Fe', 'Av. Independencia', 'Av. Maipú',
                 'Rivadavia', 'Moreno', 'Hipólito Yrigoyen'] AS calles
),
ordinales AS (
    -- Regulares
    SELECT n, NULL::INT AS caso, sc.edad, 'ACTIVO' AS estado
    FROM seed_curso sc
    CROSS JOIN generate_series(sc.n_desde, sc.n_hasta) AS n
    UNION ALL
    -- Casos especiales
    SELECT 378 + e.caso, e.caso, e.edad, e.estado
    FROM (VALUES
        (1, 6, 'ACTIVO'), (2, 12, 'ACTIVO'), (3, 15, 'ACTIVO'), (4, 10, 'ACTIVO'), (5, 13, 'ACTIVO'),
        (6, 9, 'ACTIVO'), (7, 8, 'ACTIVO'), (8, 18, 'EGRESADO'), (9, 18, 'EGRESADO'),
        (10, 19, 'EGRESADO'), (11, 19, 'EGRESADO'), (12, 6, 'ACTIVO'), (13, 12, 'ACTIVO')
    ) AS e(caso, edad, estado)
),
datos AS (
    SELECT inst.cuit, o.n, o.caso, o.estado, inst.dominio, inst.dni_base, inst.telefono_base,
           inst.calle_base,
           (o.n + inst.desplazamiento) % 40 AS r,
           (o.n + inst.desplazamiento) / 40 AS q,
           1 + (o.n * 7) % 12 AS mes_nacimiento,
           1 + (o.n * 11) % 28 AS dia_nacimiento,
           o.edad
    FROM ordinales o
    CROSS JOIN (VALUES
        ('30-71234567-8', 'institucion.edu.ar', 0, 47000000, 0, 0),
        ('30-69854321-5', 'colegiobelgrano.edu.ar', 400, 49000000, 500000, 5)
    ) AS inst(cuit, dominio, desplazamiento, dni_base, telefono_base, calle_base)
)
SELECT d.cuit, d.n, d.caso, d.estado,
       l.nombres[d.r + 1] AS nombre,
       l.apellidos[(d.r + d.q) % 40 + 1] AS apellido,
       l.nombres_email[d.r + 1] || '.' || l.apellidos_email[(d.r + d.q) % 40 + 1] || '@' || d.dominio AS email,
       '3794' || lpad(((d.n * 7331 + d.telefono_base) % 1000000)::TEXT, 6, '0') AS telefono,
       l.calles[(d.n + d.calle_base) % 16 + 1] AS direccion_calle,
       (1 + (d.n * 389) % 4999)::TEXT AS direccion_altura,
       (d.dni_base + (d.n * 7919) % 1000000)::TEXT AS dni,
       make_date(fn_anio_ciclo_lectivo_actual() - d.edad
                     - CASE WHEN d.mes_nacimiento > 6 THEN 1 ELSE 0 END,
                 d.mes_nacimiento, d.dia_nacimiento) AS fecha_nacimiento
FROM datos d
CROSS JOIN listas l;

INSERT INTO alumno (institucion_id, alumno_estado_id, nombre, apellido, email, telefono, direccion_calle, direccion_altura, dni, fecha_nacimiento)
SELECT i.institucion_id, e.alumno_estado_id, s.nombre, s.apellido, s.email, s.telefono,
       s.direccion_calle, s.direccion_altura, s.dni, s.fecha_nacimiento
FROM seed_alumno s
JOIN institucion i ON i.cuit = s.cuit
JOIN alumno_estado e ON e.nombre = s.estado
ORDER BY i.institucion_id, s.apellido, s.nombre;

-- Inscripciones de cada alumno, con su curso y su fecha. tipo: 'error' (la del caso 7, que se da de
-- baja), 'inicial' (la primera, activa) o 'cambio' (la del curso nuevo en un cambio de división).
-- Los regulares se inscriben entre el 2 y el 26 de febrero, según n. califica_hasta: solo se
-- califican las evaluaciones de la inscripción con fecha anterior. Los LEFT JOIN dejan el curso
-- en NULL si no existe, y el INSERT falla por NOT NULL
CREATE TEMP TABLE seed_inscripcion ON COMMIT DROP AS
SELECT i.institucion_id, s.n, s.caso, x.tipo, a.alumno_id, c.curso_id,
       LEAST(make_date(fn_anio_ciclo_lectivo_actual(), x.mes, x.dia), fn_fecha_actual()) AS fecha,
       make_date(fn_anio_ciclo_lectivo_actual(), x.hasta_mes, x.hasta_dia) AS califica_hasta
FROM (
    -- Regulares
    SELECT n, 'inicial' AS tipo, sc.nivel_educativo, sc.grado, sc.division,
           2 AS mes, 2 + (n * 7) % 25 AS dia, NULL::INT AS hasta_mes, NULL::INT AS hasta_dia
    FROM seed_curso sc
    CROSS JOIN generate_series(sc.n_desde, sc.n_hasta) AS n
    UNION ALL
    -- Casos especiales
    SELECT 378 + e.caso, e.tipo, e.nivel_educativo, e.grado, e.division, e.mes, e.dia,
           e.hasta_mes, e.hasta_dia
    FROM (VALUES
        -- 1 y 2: cambio de división el 20 de abril; la inscripción vieja se cancela
        (1, 'inicial', 'PRIMARIA', '1°', 'A', 2, 2, 4, 20),
        (1, 'cambio', 'PRIMARIA', '1°', 'B', 4, 20, NULL, NULL),
        (2, 'inicial', 'SECUNDARIA', '1°', 'B', 2, 2, 4, 20),
        (2, 'cambio', 'SECUNDARIA', '1°', 'A', 4, 20, NULL, NULL),
        -- 3 y 4: abandono, con notas y sin notas; la inscripción se cancela y el alumno sigue ACTIVO
        (3, 'inicial', 'SECUNDARIA', '4°', 'A', 2, 2, 6, 1),
        (4, 'inicial', 'PRIMARIA', '5°', 'A', 2, 2, 3, 1),
        -- 5 y 6: alumno dado de baja, con notas y sin notas (sp_alumno_dar_de_baja cancela la
        -- inscripción)
        (5, 'inicial', 'SECUNDARIA', '2°', 'A', 2, 2, 7, 1),
        (6, 'inicial', 'PRIMARIA', '4°', 'A', 2, 2, 3, 1),
        -- 7: inscripción cargada por error en 2° A, dada de baja, y la correcta en 3° A
        (7, 'error', 'PRIMARIA', '2°', 'A', 2, 16, NULL, NULL),
        (7, 'inicial', 'PRIMARIA', '3°', 'A', 2, 16, NULL, NULL)
    ) AS e(caso, tipo, nivel_educativo, grado, division, mes, dia, hasta_mes, hasta_dia)
) AS x
JOIN seed_alumno s ON s.n = x.n
JOIN institucion i ON i.cuit = s.cuit
JOIN alumno a ON a.institucion_id = i.institucion_id AND a.dni = s.dni
LEFT JOIN grado g ON g.nombre = x.grado AND g.nivel_educativo = x.nivel_educativo
LEFT JOIN curso c ON c.institucion_id = i.institucion_id AND c.grado_id = g.grado_id
                 AND c.division = x.division
                 AND c.anio_ciclo_lectivo = fn_anio_ciclo_lectivo_actual()
                 AND c.fecha_eliminacion IS NULL;

-- Evaluaciones: las cuatro de cada asignación vigente y, además, un recuperatorio en Matemática de
-- 2° A de primaria, que se da de baja. k interviene en la nota
CREATE TEMP TABLE seed_evaluacion ON COMMIT DROP AS
SELECT *
FROM (VALUES
    ('Evaluación diagnóstica', 3, 20, 1, FALSE),
    ('Recuperatorio', 4, 10, 5, TRUE),
    ('Trabajo práctico 1', 5, 15, 2, FALSE),
    ('Evaluación escrita 1', 8, 21, 3, FALSE),
    ('Trabajo práctico 2', 11, 13, 4, FALSE)
) AS e(titulo, mes, dia, k, recuperatorio);

-- Caso 7: la inscripción cargada por error, que se da de baja al día siguiente. Una dada de baja ya
-- no cuenta para la regla de una sola inscripción activa por alumno
INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion)
SELECT si.alumno_id, si.curso_id, e.inscripcion_estado_id, si.fecha
FROM seed_inscripcion si
JOIN inscripcion_estado e ON e.nombre = 'ACTIVA'
WHERE si.tipo = 'error'
ORDER BY si.institucion_id, si.fecha, si.n;

UPDATE inscripcion i
   SET fecha_eliminacion = LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 2, 17), fn_fecha_actual())::TIMESTAMPTZ
  FROM seed_inscripcion si
 WHERE si.tipo = 'error'
   AND i.alumno_id = si.alumno_id
   AND i.curso_id = si.curso_id;

-- Las inscripciones iniciales, todas activas
INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion)
SELECT si.alumno_id, si.curso_id, e.inscripcion_estado_id, si.fecha
FROM seed_inscripcion si
JOIN inscripcion_estado e ON e.nombre = 'ACTIVA'
WHERE si.tipo = 'inicial'
ORDER BY si.institucion_id, si.fecha, si.n;

INSERT INTO evaluacion (asignacion_docente_id, titulo, fecha_evaluacion)
SELECT a.asignacion_docente_id, se.titulo, make_date(c.anio_ciclo_lectivo, se.mes, se.dia)
FROM asignacion_docente a
JOIN curso c ON c.curso_id = a.curso_id
JOIN grado g ON g.grado_id = c.grado_id
JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
JOIN materia m ON m.materia_id = gm.materia_id
JOIN seed_evaluacion se ON NOT se.recuperatorio
                        OR (g.nivel_educativo = 'PRIMARIA' AND g.nombre = '2°'
                            AND c.division = 'A' AND m.nombre = 'Matemática')
WHERE a.fecha_eliminacion IS NULL
ORDER BY c.institucion_id, c.curso_id, gm.grado_materia_id, se.mes, se.dia;

-- Calificaciones de cada inscripción activa y vigente en las evaluaciones vigentes de su curso con
-- fecha de hoy o anterior, a partir de su fecha de inscripción y antes de su califica_hasta, si no
-- tiene ninguna en esa evaluación. Se ejecuta ahora y otra vez después de los cambios de división.
-- Nota de 4,50 a 10, en pasos de 0,25 (unas 14 % menores que 6).
-- Excepción: en Lengua de 2° A de primaria, los 3 regulares de mayor n quedan sin calificar en la
-- Evaluación escrita 1
PREPARE seed_calificar AS
INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota)
SELECT e.evaluacion_id, i.inscripcion_id,
       LEAST(10, 4.5 + (si.n * 5 % 7) * 0.75 + ((si.n + 3 * se.k) % 5) * 0.5)
FROM seed_inscripcion si
JOIN inscripcion i ON i.alumno_id = si.alumno_id AND i.curso_id = si.curso_id
JOIN inscripcion_estado ie ON ie.inscripcion_estado_id = i.inscripcion_estado_id
JOIN asignacion_docente a ON a.curso_id = i.curso_id
JOIN grado_materia gm ON gm.grado_materia_id = a.grado_materia_id
JOIN materia m ON m.materia_id = gm.materia_id
JOIN evaluacion e ON e.asignacion_docente_id = a.asignacion_docente_id
JOIN seed_evaluacion se ON se.titulo = e.titulo
WHERE ie.nombre = 'ACTIVA'
  AND i.fecha_eliminacion IS NULL
  AND a.fecha_eliminacion IS NULL
  AND e.fecha_eliminacion IS NULL
  AND e.fecha_evaluacion <= fn_fecha_actual()
  AND e.fecha_evaluacion >= i.fecha_inscripcion
  AND (si.califica_hasta IS NULL OR e.fecha_evaluacion < si.califica_hasta)
  AND NOT EXISTS (SELECT 1
                    FROM calificacion x
                   WHERE x.evaluacion_id = e.evaluacion_id
                     AND x.inscripcion_id = i.inscripcion_id)
  AND NOT EXISTS (SELECT 1
                    FROM seed_curso sc
                   WHERE sc.nivel_educativo = 'PRIMARIA' AND sc.grado = '2°' AND sc.division = 'A'
                     AND si.n BETWEEN sc.n_hasta - 2 AND sc.n_hasta
                     AND m.nombre = 'Lengua'
                     AND e.titulo = 'Evaluación escrita 1')
ORDER BY si.institucion_id, e.evaluacion_id, i.inscripcion_id;

EXECUTE seed_calificar;

-- Calificación dada de baja: en Lengua de 2° A de primaria, la de la Evaluación diagnóstica del
-- regular de menor n se da de baja y se carga otra, con un punto más (hasta 10). Si todavía no se
-- tomó, no hace nada
WITH baja AS (
    UPDATE calificacion ca
       SET fecha_eliminacion = LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 3, 27), fn_fecha_actual())::TIMESTAMPTZ
      FROM seed_curso sc, seed_inscripcion si, inscripcion i, evaluacion e, asignacion_docente a,
           grado_materia gm, materia m
     WHERE sc.nivel_educativo = 'PRIMARIA' AND sc.grado = '2°' AND sc.division = 'A'
       AND si.n = sc.n_desde
       AND i.alumno_id = si.alumno_id AND i.curso_id = si.curso_id
       AND ca.inscripcion_id = i.inscripcion_id
       AND e.evaluacion_id = ca.evaluacion_id
       AND e.titulo = 'Evaluación diagnóstica'
       AND a.asignacion_docente_id = e.asignacion_docente_id
       AND gm.grado_materia_id = a.grado_materia_id
       AND m.materia_id = gm.materia_id
       AND m.nombre = 'Lengua'
       AND ca.fecha_eliminacion IS NULL
    RETURNING ca.evaluacion_id, ca.inscripcion_id, ca.nota
)
INSERT INTO calificacion (evaluacion_id, inscripcion_id, nota)
SELECT evaluacion_id, inscripcion_id, LEAST(10, nota + 1)
FROM baja
ORDER BY inscripcion_id;

-- El recuperatorio se da de baja, y con él sus calificaciones (trg_evaluacion_baja_calificaciones)
UPDATE evaluacion
   SET fecha_eliminacion = LEAST(make_date(fn_anio_ciclo_lectivo_actual(), 4, 13), fn_fecha_actual())::TIMESTAMPTZ
 WHERE titulo = 'Recuperatorio';

-- Casos 1 a 4: la inscripción inicial pasa a CANCELADA, con sus calificaciones
UPDATE inscripcion i
   SET inscripcion_estado_id = (SELECT inscripcion_estado_id FROM inscripcion_estado WHERE nombre = 'CANCELADA')
  FROM seed_inscripcion si
 WHERE si.tipo = 'inicial'
   AND si.caso BETWEEN 1 AND 4
   AND i.alumno_id = si.alumno_id
   AND i.curso_id = si.curso_id;

-- Casos 5 y 6: el alumno se da de baja, y sp_alumno_dar_de_baja cancela su inscripción. Dentro de un
-- DO, porque un CALL suelto escribe su resultado
DO $$
DECLARE
    v_alumno      RECORD;
    v_canceladas  INT;
BEGIN
    FOR v_alumno IN
        SELECT si.alumno_id, si.institucion_id
          FROM seed_inscripcion si
         WHERE si.tipo = 'inicial'
           AND si.caso IN (5, 6)
         ORDER BY si.institucion_id, si.caso
    LOOP
        CALL sp_alumno_dar_de_baja(v_alumno.alumno_id, v_alumno.institucion_id, v_canceladas);
    END LOOP;
END
$$;

-- Casos 1 y 2: la inscripción en el curso nuevo, activa, y sus calificaciones
INSERT INTO inscripcion (alumno_id, curso_id, inscripcion_estado_id, fecha_inscripcion)
SELECT si.alumno_id, si.curso_id, e.inscripcion_estado_id, si.fecha
FROM seed_inscripcion si
JOIN inscripcion_estado e ON e.nombre = 'ACTIVA'
WHERE si.tipo = 'cambio'
ORDER BY si.institucion_id, si.fecha, si.n;

EXECUTE seed_calificar;

DEALLOCATE seed_calificar;

COMMIT;
