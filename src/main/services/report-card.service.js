const courseRepository = require('../repositories/course.repository');
const enrollmentRepository = require('../repositories/enrollment.repository');
const institutionRepository = require('../repositories/institution.repository');
const scoreRepository = require('../repositories/score.repository');
const subjectRepository = require('../repositories/subject.repository');
const { toListedCourse } = require('./course.service');
const { openHtmlAsPdf } = require('./pdf.service');
const { ReportError } = require('./report.service');
const { getCurrentSchoolYear } = require('./school-year.service');
const { toListedAverages } = require('./score.service');
const { buildReportCardsHtml } = require('../templates/report-card.template');

const MAX_ID = 2 ** 31 - 1;
const isId = (value) => Number.isInteger(value) && value > 0 && value <= MAX_ID;
const NO_AVERAGES = toListedAverages({
  termAverages: [null, null, null],
  closedTerms: [],
  annualAverage: null,
  isAnnualFinal: false,
});

async function getReportCardCourses({ institutionId }) {
  const [{ year }, courses] = await Promise.all([
    getCurrentSchoolYear(),
    courseRepository.findByInstitution(institutionId),
  ]);
  return {
    currentSchoolYear: year,
    courses: courses.filter((course) => course.schoolYear <= year).map(toListedCourse),
  };
}

async function getCourseEnrollments({ institutionId }, courseId) {
  if (!isId(courseId)) throw new ReportError('INVALID_INPUT', 'Elegí un curso válido.');
  const course = await courseRepository.findActiveById(courseId, institutionId);
  if (!course) throw new ReportError('COURSE_NOT_FOUND', 'No se encontró el curso seleccionado.');
  const enrollments = await enrollmentRepository.findActiveOrFinishedByCourse(course.id);
  return { course, enrollments };
}

async function getReportCardStudents(currentUser, { courseId }) {
  const { course, enrollments } = await getCourseEnrollments(currentUser, courseId);
  return {
    course: toListedCourse(course),
    students: enrollments.map(({ id, student: { firstName, lastName, dni } }) => ({
      enrollmentId: id, firstName, lastName, dni,
    })),
  };
}

// Un id abre el boletín de esa inscripción dentro del curso. Sin id se incluye todo el curso.
async function openReportCards(currentUser, { courseId, enrollmentId = null }) {
  if (enrollmentId !== null && !isId(enrollmentId)) {
    throw new ReportError('INVALID_INPUT', 'No se pudo identificar la inscripción.');
  }
  const { course, enrollments } = await getCourseEnrollments(currentUser, courseId);
  const selected = enrollmentId === null ? enrollments : enrollments.filter(({ id }) => id === enrollmentId);
  if (!selected.length) {
    throw enrollmentId === null
      ? new ReportError('NO_ENROLLMENTS', 'El curso no tiene alumnos para emitir boletines.')
      : new ReportError('ENROLLMENT_NOT_FOUND', 'La inscripción ya no está disponible en este curso.');
  }

  const [institution, plan, averages] = await Promise.all([
    institutionRepository.findById(currentUser.institutionId),
    subjectRepository.findPlanByGrade(course.gradeId),
    scoreRepository.findAverages(selected.map(({ id }) => id), null, { requireRecordedGrade: true }),
  ]);
  const averagesBySubject = new Map(averages.map((row) => [
    `${row.enrollmentId}:${row.gradeSubjectId}`, toListedAverages(row),
  ]));
  const reportCards = selected.map(({ id, student }) => ({
    student,
    subjects: plan.map(({ gradeSubjectId, name }) => ({
      name, ...(averagesBySubject.get(`${id}:${gradeSubjectId}`) ?? NO_AVERAGES),
    })),
  }));

  const fileName = enrollmentId === null
    ? `Boletines ${course.schoolYear} - Curso ${courseId}.pdf`
    : `Boletín ${course.schoolYear} - Inscripción ${enrollmentId}.pdf`;
  await openHtmlAsPdf(buildReportCardsHtml({ institution, course, reportCards }), fileName);
  return { count: reportCards.length };
}

module.exports = { getReportCardCourses, getReportCardStudents, openReportCards };
