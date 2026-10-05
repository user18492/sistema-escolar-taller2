// Materia del catálogo global, común a todas las instituciones. En qué grados se dicta lo define
// el plan de estudios (grado_materia).
class Subject {
  constructor({ id, name }) {
    this.id = id;
    // materia.nombre: Lengua, Matemática, Historia...
    this.name = name;
  }
}

module.exports = { Subject };
