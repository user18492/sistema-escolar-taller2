// Backup registrado en el historial de una institución (tabla respaldo): quién lo realizó y cuándo.
// El archivo no se describe acá: su nombre, su tamaño y su formato se ven en la carpeta de backups.
class Backup {
  constructor({ id, institutionId, userId, userFirstName, userLastName, createdAt }) {
    this.id = id;
    this.institutionId = institutionId;
    // Quien lo realizó: su usuario_id y su nombre y apellido copiados al registrarlo, que se
    // conservan aunque ese usuario ya no exista.
    this.userId = userId;
    this.userFirstName = userFirstName;
    this.userLastName = userLastName;
    // Fecha y hora (Date): la de la instantánea de los datos, que también lleva el archivo.
    this.createdAt = createdAt;
  }
}

module.exports = { Backup };
