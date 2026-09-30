// Cuenta de usuario del sistema. `role` es el nombre registrado en usuario_roles (ADMIN, SECRETARIO, PROFESOR).
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
    // Nombre de la institución (instituciones.nombre), para mostrarlo sin otra consulta.
    this.institutionName = institutionName;
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.passwordHash = passwordHash;
    this.dni = dni;
    this.birthDate = birthDate;
    // Nombre del archivo de la foto de perfil (usuarios.imagen_url), no una URL: profile-image.service.js
    // lo convierte en la URL que muestra la interfaz.
    this.imageFileName = imageFileName;
  }
}

module.exports = { User };
