const studentRepository = require('../repositories/student.repository');
const { parsePersonalData, normalizeText, toIsoDate, REQUIRED_MESSAGE, LETTERS } = require('./user.service');

// Error previsto, con un mensaje apto para la UI (como UserError en user.service.js).
// `fieldErrors` ({ campo: mensaje }), si llega, indica qué campos del formulario están mal.
class StudentError extends Error {
  constructor(code, message, fieldErrors) {
    super(message);
    this.name = 'StudentError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

// ---------- Validación de los datos del formulario ----------

// Nombre, apellido, dni, email y fecha de nacimiento se validan como los de un usuario
// (parsePersonalData, user.service.js), con la edad de un alumno. Teléfono, calle y altura siguen las
// mismas reglas que field-validation.component.js (phone, street y street-number). La edad es la de
// los data-min-age y data-max-age del modal de alumno. El proceso principal no puede importar ese
// componente: si cambian allá, hay que cambiarlas acá.
const STUDENT_AGE_RANGE = { minAge: 5, maxAge: 25 };

// El teléfono se guarda solo con dígitos, como el dni: el rango es el de ck_alumno_telefono.
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 13;

// Largo de la columna alumno.direccion_calle.
const STREET_MAX_LENGTH = 150;
const NOT_STREET_CHAR = new RegExp(`[^${LETTERS}\\d .'°º-]`);
const STREET_CONTENT_PATTERN = new RegExp(`[${LETTERS}\\d]`);

// Al editar, el propio alumno no cuenta como duplicado: el que ya tiene el dato es "otro".
const DUPLICATE_MESSAGES = {
  create: {
    message: 'Ya existe un alumno con estos datos.',
    dni: 'Ya existe un alumno con este DNI.',
    email: 'Ya existe un alumno con este email.',
  },
  update: {
    message: 'Ya existe otro alumno con estos datos.',
    dni: 'Ya existe otro alumno con este DNI.',
    email: 'Ya existe otro alumno con este email.',
  },
};

// Estados que se eligen al editar, los de toListedStudent: el alta no elige el estado.
const STUDENT_STATUSES = ['ACTIVE', 'GRADUATED'];

// Recibe el valor tal como llegó, sin normalizar: el campo solo admite dígitos, así que un espacio,
// un guion o un + llegan solo si el renderer no los filtró, y se rechazan en lugar de quitarlos.
function checkPhone(value) {
  if (!value) return REQUIRED_MESSAGE;
  if (!/^\d+$/.test(value)) return 'El teléfono solo admite dígitos, sin espacios, guiones ni otros caracteres.';
  return value.length >= PHONE_MIN_DIGITS && value.length <= PHONE_MAX_DIGITS
    ? ''
    : `El teléfono debe tener entre ${PHONE_MIN_DIGITS} y ${PHONE_MAX_DIGITS} dígitos.`;
}

// El campo descarta al escribir los caracteres que no admite; acá llegan solo si el renderer no
// los filtró.
function checkStreet(value) {
  if (!value) return REQUIRED_MESSAGE;
  if (value.length > STREET_MAX_LENGTH) return `Máximo ${STREET_MAX_LENGTH} caracteres.`;
  if (NOT_STREET_CHAR.test(value)) return 'Solo se admiten letras, números, espacios, puntos, guiones, apóstrofos y °.';
  return STREET_CONTENT_PATTERN.test(value) ? '' : 'La calle debe incluir letras o números.';
}

function checkStreetNumber(value) {
  if (!value) return REQUIRED_MESSAGE;
  return /^[1-9]\d{0,4}$/.test(value) ? '' : 'La altura debe estar entre 1 y 99999.';
}

const CONTACT_FIELD_CHECKS = {
  phone: checkPhone,
  street: checkStreet,
  streetNumber: checkStreetNumber,
};

// Normaliza los datos del formulario de alumno, salvo el teléfono, que se valida tal como llegó (el
// controlador ya verificó que sean strings), y devuelve solo los campos que se guardan.
// `operation` es 'create' o 'update': el estado se elige solo al editar, así que en el alta no se
// lee ni se devuelve. Lanza un StudentError INVALID_INPUT: con los fieldErrors de todos los campos
// de texto que no son válidos, y sin ellos si no lo es el estado, que no tiene un campo de texto
// donde mostrar el error.
function parseStudentData(data, operation) {
  const { values: personalValues, fieldErrors } = parsePersonalData(data, STUDENT_AGE_RANGE);
  const values = {
    ...personalValues,
    phone: data.phone,
    street: normalizeText(data.street),
    streetNumber: data.streetNumber.trim(),
  };
  Object.entries(CONTACT_FIELD_CHECKS).forEach(([field, check]) => {
    const message = check(values[field]);
    if (message) fieldErrors[field] = message;
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new StudentError('INVALID_INPUT', 'Revisá los datos marcados.', fieldErrors);
  }
  if (operation === 'create') return values;
  if (!STUDENT_STATUSES.includes(data.status)) {
    throw new StudentError('INVALID_INPUT', 'Elegí un estado válido.');
  }
  return { ...values, status: data.status };
}

// `operation` es 'create' o 'update'.
function duplicateError(fields, operation) {
  const messages = DUPLICATE_MESSAGES[operation];
  const fieldErrors = Object.fromEntries(fields.map((field) => [field, messages[field]]));
  return new StudentError('DUPLICATE_VALUE', messages.message, fieldErrors);
}

// Lanza un StudentError DUPLICATE_VALUE si el dni o el email de `values` ya son de un alumno
// vigente de la institución distinto de `excludedStudentId` (null en un alta). No cuentan los de
// otra institución: una persona tiene una fila por institución, con el mismo dni y el mismo email.
async function assertNotTaken(institutionId, values, excludedStudentId, operation) {
  const takenFields = await studentRepository.findTakenFields(institutionId, values, excludedStudentId);
  if (takenFields.length > 0) throw duplicateError(takenFields, operation);
}

// Ejecuta `save` (el INSERT o el UPDATE). Si la base lo rechaza por uq_alumno_institucion_dni o
// uq_alumno_institucion_email, se informa como duplicado: pasa si otro alumno tomó el dni o el email
// entre la comprobación y el guardado, y también si son de un alumno dado de baja, que
// assertNotTaken no cuenta.
async function saveUnique(save, operation) {
  try {
    return await save();
  } catch (error) {
    const field = studentRepository.duplicateFieldOf(error);
    if (!field) throw error;
    throw duplicateError([field], operation);
  }
}

function studentNotFoundError() {
  return new StudentError('STUDENT_NOT_FOUND', 'El alumno ya no existe.');
}

// Lista explícita de campos, como toListedUser (user.service.js): lo que muestran la tabla de
// Alumnos del Secretario, sus filtros y el modal de edición, y el id para identificar la fila. `dni`
// y `phone` son solo los dígitos, `street` y `streetNumber` la calle y la altura de la dirección,
// `birthDate` el día de nacimiento ('AAAA-MM-DD') y `status` ACTIVE o GRADUATED. Las vistas del
// Profesor muestran menos datos del alumno: ver toListedStudent (enrollment.service.js).
function toListedStudent(student) {
  return {
    id: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    dni: student.dni,
    email: student.email,
    phone: student.phone,
    street: student.street,
    streetNumber: student.streetNumber,
    birthDate: toIsoDate(student.birthDate),
    status: student.status,
  };
}

// Alumnos vigentes de la institución de `currentUser` (el de la sesión), activos y egresados, en el
// orden del repositorio. Los dados de baja no se listan.
async function listStudents(currentUser) {
  const students = await studentRepository.findByInstitution(currentUser.institutionId);
  return students.map(toListedStudent);
}

// Registra un alumno en la institución de `currentUser` (el de la sesión), siempre activo, y lo
// devuelve con los campos de listStudents. `data` trae firstName, lastName, dni, email, phone,
// street, streetNumber y birthDate ('AAAA-MM-DD'); el estado no se elige en el alta: si llega, no
// se usa.
// El dni y el email no se repiten entre los alumnos de la institución: se comprueban antes contra
// los vigentes y, como respaldo, los rechaza la base, que cuenta también a los dados de baja.
// Lanza un StudentError si algún dato no es válido (INVALID_INPUT) o si el dni o el email ya son de
// un alumno de la institución (DUPLICATE_VALUE), los dos con fieldErrors.
async function createStudent(currentUser, data) {
  const values = parseStudentData(data, 'create');
  await assertNotTaken(currentUser.institutionId, values, null, 'create');
  const student = await saveUnique(() => studentRepository.create(currentUser.institutionId, values), 'create');
  return toListedStudent(student);
}

// Guarda los cambios del alumno vigente con ese id (alumno_id) en la institución de `currentUser` y
// lo devuelve como quedó, con los campos de listStudents. `data` trae los mismos campos que en
// createStudent y además `status` (ACTIVE o GRADUATED). La institución no cambia.
// El dni y el email no se repiten entre los alumnos de la institución, como en el alta: el propio
// alumno no cuenta, así que conservar los suyos no es un duplicado.
// Lanza un StudentError si algún dato no es válido (INVALID_INPUT, con fieldErrors salvo el
// estado), si el alumno no existe en la institución o fue dado de baja (STUDENT_NOT_FOUND) o si el
// dni o el email ya son de otro alumno de la institución (DUPLICATE_VALUE, con fieldErrors).
async function updateStudent(currentUser, studentId, data) {
  const values = parseStudentData(data, 'update');
  if (!(await studentRepository.existsNotDeleted(studentId, currentUser.institutionId))) {
    throw studentNotFoundError();
  }
  await assertNotTaken(currentUser.institutionId, values, studentId, 'update');
  const student = await saveUnique(
    () => studentRepository.update(studentId, currentUser.institutionId, values),
    'update'
  );
  // Se dio de baja entre la comprobación y el guardado.
  if (!student) throw studentNotFoundError();
  return toListedStudent(student);
}

// Baja lógica del alumno vigente con ese id (alumno_id) en la institución de `currentUser`: la fila
// queda con su fecha de baja y su estado, y deja de listarse. Sus inscripciones activas pasan a
// canceladas, así ya no se lo puede calificar. Todo lo hace la base en sp_alumno_dar_de_baja, todo o
// nada: acá solo se lo llama y se traducen sus errores.
// Devuelve { cancelledEnrollmentCount }, cuántas inscripciones activas se cancelaron (0 o 1).
// Lanza un StudentError si el alumno no existe en la institución (STUDENT_NOT_FOUND) o si ya estaba
// dado de baja (STUDENT_ALREADY_DELETED).
async function deleteStudent(currentUser, studentId) {
  try {
    const cancelledEnrollmentCount = await studentRepository.markAsDeleted(studentId, currentUser.institutionId);
    return { cancelledEnrollmentCount };
  } catch (error) {
    if (studentRepository.isNotFoundError(error)) throw studentNotFoundError();
    if (studentRepository.isAlreadyDeletedError(error)) {
      throw new StudentError('STUDENT_ALREADY_DELETED', 'El alumno ya había sido eliminado.');
    }
    throw error;
  }
}

module.exports = { listStudents, createStudent, updateStudent, deleteStudent, StudentError };
