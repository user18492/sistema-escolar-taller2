// Grado escolar del catálogo global: el año de cursado dentro de un nivel educativo. No es una
// división concreta: eso es un curso.
class Grade {
  constructor({ id, name, educationLevel }) {
    this.id = id;
    // grado.nombre: 1°, 2°, ... 6°. Se repite entre niveles educativos.
    this.name = name;
    // PRIMARY o SECONDARY.
    this.educationLevel = educationLevel;
  }
}

module.exports = { Grade };
