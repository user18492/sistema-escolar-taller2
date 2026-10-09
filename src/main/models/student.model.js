// Alumno de una institución: quien pasa a otra tiene una fila en cada una.
class Student {
  constructor({ id, firstName, lastName, dni }) {
    this.id = id;
    this.firstName = firstName;
    this.lastName = lastName;
    // Solo los dígitos (7 u 8).
    this.dni = dni;
  }
}

module.exports = { Student };
