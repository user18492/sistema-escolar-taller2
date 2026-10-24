// Institución educativa: los usuarios, los alumnos y los cursos son siempre de una.
class Institution {
  constructor({ id, name, street, streetNumber, email, phone, cuit }) {
    this.id = id;
    this.name = name;
    // Dirección: la calle (institucion.direccion_calle) y la altura (institucion.direccion_altura),
    // por separado. Puede faltar: null.
    this.street = street;
    this.streetNumber = streetNumber;
    // null si no tiene.
    this.email = email;
    // Solo los dígitos (10 a 13); null si no tiene.
    this.phone = phone;
    // Con guiones: XX-XXXXXXXX-X.
    this.cuit = cuit;
  }
}

module.exports = { Institution };
