// Alumno de una institución: quien pasa a otra tiene una fila en cada una.
// Las consultas que solo necesitan identificarlo (p. ej., las inscripciones) traen el nombre, el
// apellido y el dni: los campos que no se seleccionan quedan undefined.
class Student {
  constructor({ id, institutionId, firstName, lastName, dni, email, phone, street, streetNumber, birthDate, status }) {
    this.id = id;
    this.institutionId = institutionId;
    this.firstName = firstName;
    this.lastName = lastName;
    // Solo los dígitos (7 u 8).
    this.dni = dni;
    this.email = email;
    // Tal como se guarda: con el formato del formulario (379 412-3456).
    this.phone = phone;
    // Dirección: la calle (alumno.direccion_calle) y la altura (alumno.direccion_altura), por separado.
    this.street = street;
    this.streetNumber = streetNumber;
    this.birthDate = birthDate;
    // ACTIVE o GRADUATED.
    this.status = status;
  }
}

module.exports = { Student };
