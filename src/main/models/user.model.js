// Cuenta de usuario del sistema en una institución, con un rol: quien pertenece a varias instituciones, o
// tiene más de un rol en una misma, tiene una cuenta por cada uno.
// `role` es el nombre registrado en usuario_rol (ADMIN, SECRETARIO, PROFESOR): no cambia después del alta.
// Incluye `passwordHash`: el servicio decide qué datos salen del proceso principal.
class User {
  constructor({
    id,
    role,
    isActive,
    institutionId,
    institutionName,
    firstName,
    lastName,
    email,
    passwordHash,
    dni,
    birthDate,
    imageFileName,
    deletedAt,
  }) {
    this.id = id;
    this.role = role;
    // false = suspendido.
    this.isActive = isActive;
    this.institutionId = institutionId;
    // Nombre de la institución (institucion.nombre), para mostrarlo sin otra consulta.
    this.institutionName = institutionName;
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.passwordHash = passwordHash;
    this.dni = dni;
    this.birthDate = birthDate;
    // Nombre del archivo de la foto de perfil (usuario.imagen_url), no una URL: profile-image.service.js
    // lo convierte en la URL que muestra la interfaz.
    this.imageFileName = imageFileName;
    // Fecha de la baja lógica (usuario.fecha_eliminacion); null = vigente.
    this.deletedAt = deletedAt;
  }
}

module.exports = { User };
