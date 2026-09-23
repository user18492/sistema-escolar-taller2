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
INSERT INTO usuario_roles (nombre) VALUES
    ('ADMIN'),
    ('SECRETARIO'),
    ('PROFESOR');

-- Institucion de prueba
INSERT INTO instituciones (nombre, direccion_calle, direccion_altura, email, telefono, cuit) VALUES
    ('Instituto San Martin', 'Av. Belgrano', '1234', 'contacto@institucion.edu.ar', '+54 379 4123456', '30-71234567-8');

-- Usuarios: 20 (2 administradores, 4 secretarios, 14 profesores).
-- Credenciales de acceso (email / contraseña en texto plano):
--   mariana.sosa@institucion.edu.ar          / 7$4GhQ4yd9WZ$pyE  (ADMIN)
--   hernan.acosta@institucion.edu.ar         / SUs&LVqS3AbKnq6x  (ADMIN)
--   valeria.benitez@institucion.edu.ar       / B@cC5iimsQJHXQ5d  (SECRETARIO)
--   julian.romero@institucion.edu.ar         / 6!y$GWY*7qYjVp%9  (SECRETARIO)
--   mariajose.duarte@institucion.edu.ar      / b6@m3cSRn!Vpmcg!  (SECRETARIO)
--   ricardo.medina@institucion.edu.ar        / pzvg3&4JpNWM#e*#  (SECRETARIO, inactivo)
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
--   carolina.vallejos@institucion.edu.ar     / Ffdc4Ry*Jw*c$nN5  (PROFESOR, inactivo)
--   roberto.sanchez@institucion.edu.ar       / #2cPN9n$Af3XN$x!  (PROFESOR, inactivo)
INSERT INTO usuarios (usuario_rol_id, usuario_estado, institucion_id, nombre, apellido, email, password_hash, dni, fecha_nacimiento) VALUES
    -- Administradores
    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'ADMIN'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Mariana', 'Sosa', 'mariana.sosa@institucion.edu.ar',
     -- Email: mariana.sosa@institucion.edu.ar / Contraseña: 7$4GhQ4yd9WZ$pyE
     '$2b$10$iSIAeLFah7Eb89LHyuYk8.B3PfeXhRCwtN3bjpGojJSbMzP8boKOu', '25841307', '1976-05-14'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'ADMIN'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Hernán', 'Acosta', 'hernan.acosta@institucion.edu.ar',
     -- Email: hernan.acosta@institucion.edu.ar / Contraseña: SUs&LVqS3AbKnq6x
     '$2b$10$sMThNnKrJB2Q6cgX1PoFj.aekloIzxdVOy0zONvBcQ/xsT0LK1rWy', '28376912', '1980-10-02'),

    -- Secretarios
    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Valeria', 'Benítez', 'valeria.benitez@institucion.edu.ar',
     -- Email: valeria.benitez@institucion.edu.ar / Contraseña: B@cC5iimsQJHXQ5d
     '$2b$10$MUgHY4TXNtYkAgNTVrTMGOkl1z6nf3J3HrUQ6SlvVoVbjLoLpcCSi', '33215648', '1987-08-21'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Julián', 'Romero', 'julian.romero@institucion.edu.ar',
     -- Email: julian.romero@institucion.edu.ar / Contraseña: 6!y$GWY*7qYjVp%9
     '$2b$10$oQGJbmkjCELqXwZrN5T0PuoF24xC24TToDIjoy6nAoKZnu0OI2YEq', '36904127', '1992-01-09'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'SECRETARIO'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'María José', 'Duarte', 'mariajose.duarte@institucion.edu.ar',
     -- Email: mariajose.duarte@institucion.edu.ar / Contraseña: b6@m3cSRn!Vpmcg!
     '$2b$10$c6iYlyXR7.ZTuQTDcTkFF.nxsMKWGGiPGEzhH9bZVsHl5SXunde/q', '30587214', '1983-12-03'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'SECRETARIO'),
     FALSE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Ricardo', 'Medina', 'ricardo.medina@institucion.edu.ar',
     -- Email: ricardo.medina@institucion.edu.ar / Contraseña: pzvg3&4JpNWM#e*#
     '$2b$10$oidAwnRpgD4EJEyZXBFWv.l7acqqs/c/Ds.a8JIFgrNqlOvciILm2', '22648390', '1971-06-17'),

    -- Profesores
    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Silvia', 'Gómez', 'silvia.gomez@institucion.edu.ar',
     -- Email: silvia.gomez@institucion.edu.ar / Contraseña: 5i#aTSG@#u!y@NZF
     '$2b$10$oA/cHInu9hbZeEDoGTjRFeAC/EeGLt982QphE64ytc1qnJcVxUGym', '20473158', '1968-09-28'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Pablo', 'Fernández', 'pablo.fernandez@institucion.edu.ar',
     -- Email: pablo.fernandez@institucion.edu.ar / Contraseña: BaeU6Qw4#ZeP#EmW
     '$2b$10$K9mIpAu9XGp9dp/M0cqV7elhVr2Hz5tCAcyh0hj/I7hu9LHi9rdVG', '31742806', '1985-04-11'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Lorena', 'Martínez', 'lorena.martinez@institucion.edu.ar',
     -- Email: lorena.martinez@institucion.edu.ar / Contraseña: &2q2pmAiRq6vQhnf
     '$2b$10$zP1soIkq1hXRnsRR2Xdq.e738DWr5QoZVYSIttVpqTHk7QTiEchja', '29158473', '1981-11-30'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Diego', 'González', 'diego.gonzalez@institucion.edu.ar',
     -- Email: diego.gonzalez@institucion.edu.ar / Contraseña: K8JB!HZ6tp5*wGy3
     '$2b$10$WnVWJaHEBXa0.Q31kJUUQu9cwqcaJQ9cwh4xpFokePiRhMgxvO8US', '34926051', '1989-07-05'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'María', 'González', 'maria.gonzalez@institucion.edu.ar',
     -- Email: maria.gonzalez@institucion.edu.ar / Contraseña: %DyUVMWL%txf7P&X
     '$2b$10$SEQZzb1K0fq/y4VPcqjf2./8MmpQiX5jPKiU0actrOKQ/o3PcH5iq', '27315894', '1979-02-22'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Federico', 'Ruiz Díaz', 'federico.ruizdiaz@institucion.edu.ar',
     -- Email: federico.ruizdiaz@institucion.edu.ar / Contraseña: 9m3vyf3r&XW7Hy!R
     '$2b$10$Ua1SFVAr4DKIupz0LU0VXe6eiZfJnE8PvdghSoipDMV86N2Gkqr0a', '38207649', '1994-03-16'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Nicolás', 'Aguirre', 'nicolas.aguirre@institucion.edu.ar',
     -- Email: nicolas.aguirre@institucion.edu.ar / Contraseña: i#EyS6Z&H4AbNU*z
     '$2b$10$1eFgBEB8k6vj92v0qwsgzOeNznCMJLA2AUVFEcCNFELvOBrahJK0e', '40183527', '1997-01-27'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Gabriela', 'Ojeda', 'gabriela.ojeda@institucion.edu.ar',
     -- Email: gabriela.ojeda@institucion.edu.ar / Contraseña: L$KPrw7ym3!Lreq$
     '$2b$10$v/3k5RatlbsuDRRWBbrYp.4LC5piRaHI.2a5H7hbFWLaNLtgTeBeq', '23796405', '1973-12-08'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Sebastián', 'Cabrera', 'sebastian.cabrera@institucion.edu.ar',
     -- Email: sebastian.cabrera@institucion.edu.ar / Contraseña: tD2ti8JxngfedD*Y
     '$2b$10$da23fLqokz5sR5yTaKGKOOp97aEx2hjh4mfVRraK97bmFNs62Qz3q', '32051736', '1986-05-24'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Florencia', 'Núñez', 'florencia.nunez@institucion.edu.ar',
     -- Email: florencia.nunez@institucion.edu.ar / Contraseña: j9dJDaabPnTL@Q#%
     '$2b$10$n0v64UVebOuQEfy1SbHE.ezmfMS.NE6OhekwwXnvoHfIe1Tlz4Zx.', '37629184', '1993-08-13'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Juan Pablo', 'De la Fuente', 'juanpablo.delafuente@institucion.edu.ar',
     -- Email: juanpablo.delafuente@institucion.edu.ar / Contraseña: jbWhcR7p$68b%N5$
     '$2b$10$lOyrlEGRGD1vTeU4lilgH..KA3LnM7EX1i3DylZZRzQypUBSn/XJq', '26504372', '1977-09-01'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     TRUE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Camila', 'Ortiz', 'camila.ortiz@institucion.edu.ar',
     -- Email: camila.ortiz@institucion.edu.ar / Contraseña: Xn9h33Tt8%V@QTfG
     '$2b$10$i9BMM7Y3fv5AAl0rK5xfSudaHQzL362Hq9Ed.kubAk3E06J7CH7O.', '43518270', '2001-06-29'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     FALSE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Carolina', 'Vallejos', 'carolina.vallejos@institucion.edu.ar',
     -- Email: carolina.vallejos@institucion.edu.ar / Contraseña: Ffdc4Ry*Jw*c$nN5
     '$2b$10$YbLO0tIckpTS4VriOs1Rv.CDNJMXEfLyDfVhQhsREbhDAS.TSqdv2', '35460918', '1990-10-19'),

    ((SELECT usuario_rol_id FROM usuario_roles WHERE nombre = 'PROFESOR'),
     FALSE,
     (SELECT institucion_id FROM instituciones WHERE cuit = '30-71234567-8'),
     'Roberto', 'Sánchez', 'roberto.sanchez@institucion.edu.ar',
     -- Email: roberto.sanchez@institucion.edu.ar / Contraseña: #2cPN9n$Af3XN$x!
     '$2b$10$Kn0NtD.Ba.daKJ8vOI6kKekNbVDU9IJVJrlKyp9M3/FBRPxFGH4oa', '14382509', '1961-02-14');

COMMIT;
