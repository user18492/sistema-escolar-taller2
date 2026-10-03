// Cuenta de usuario del sistema en una institución: quien pertenece a varias tiene una cuenta en cada una.
// `role` es el nombre registrado en usuario_rol (ADMIN, SECRETARIO, PROFESOR).
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
  }) {
    this.id = id;
    this.role = role;
    // false = suspendido.
    this.isActive = isActive;
    this.institutionId = institutionId;
    // Nombre de la institución (institucion.nombre, que puede ser null), para mostrarlo sin otra consulta.
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
  }
}

module.exports = { User };
