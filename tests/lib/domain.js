// Correspondencia entre los valores de la base (en español) y los de la API del preload (en
// inglés), para armar los resultados esperados con consultas propias.
const LEVEL = { PRIMARIA: 'PRIMARY', SECUNDARIA: 'SECONDARY' };
const SHIFT = { 'MAÑANA': 'MORNING', TARDE: 'AFTERNOON' };
const ENROLLMENT_STATUS = { ACTIVA: 'ACTIVE', FINALIZADA: 'COMPLETED', CANCELADA: 'CANCELLED' };
const STUDENT_STATUS = { ACTIVO: 'ACTIVE', EGRESADO: 'GRADUATED' };

// Número visible de una inscripción: 'INS-' y el id con al menos seis dígitos.
const enrollmentNumber = (id) => `INS-${String(id).padStart(6, '0')}`;

const sortedIds = (items) => items.map((item) => item.id).sort((a, b) => a - b);
const sortedNumbers = (rows, key = 'id') => rows.map((row) => Number(row[key])).sort((a, b) => a - b);

module.exports = { LEVEL, SHIFT, ENROLLMENT_STATUS, STUDENT_STATUS, enrollmentNumber, sortedIds, sortedNumbers };
