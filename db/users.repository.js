// db/users.repository.js
const bcrypt = require('bcryptjs');
const { query } = require('./connection');

// Hardcodeado hasta que exista login real / selección de institución.
const INSTITUCION_ID_DEFAULT = 1;

async function crearUsuario({ nombre, apellido, email, dni, fechaNacimiento, rol, passwordPlano, imagenUrl }) {
    const passwordHash = await bcrypt.hash(passwordPlano, 10);

    const sql = `
        INSERT INTO usuarios (
            usuario_rol_id,
            usuario_estado_id,
            institucion_id,
            nombre,
            apellido,
            email,
            password_hash,
            dni,
            fecha_nacimiento,
            imagen_url
        )
        VALUES (
            (SELECT usuario_rol_id FROM usuario_roles WHERE nombre = $1),
            (SELECT usuario_estado_id FROM usuario_estados WHERE nombre = 'ACTIVE'),
            $2, $3, $4, $5, $6, $7, $8, $9
        )
        RETURNING usuario_id, nombre, apellido, email, dni, fecha_nacimiento, imagen_url;
    `;

    const values = [
        rol,
        INSTITUCION_ID_DEFAULT,
        nombre,
        apellido,
        email,
        passwordHash,
        dni,
        fechaNacimiento,
        imagenUrl || null,
    ];

    const { rows } = await query(sql, values);
    return rows[0];
}

async function listarUsuarios() {
    const sql = `
        SELECT
            u.usuario_id,
            u.nombre,
            u.apellido,
            u.dni,
            u.email,
            r.nombre AS rol,
            e.nombre AS estado
        FROM usuarios u
        JOIN usuario_roles r ON r.usuario_rol_id = u.usuario_rol_id
        JOIN usuario_estados e ON e.usuario_estado_id = u.usuario_estado_id
        ORDER BY u.apellido, u.nombre;
    `;

    const { rows } = await query(sql);
    return rows;
}

module.exports = { crearUsuario, listarUsuarios };
