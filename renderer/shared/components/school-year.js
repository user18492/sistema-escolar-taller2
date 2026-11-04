// Script compartido, sin componente: el ciclo lectivo actual, según la base de datos
// (window.api.schoolYears.getCurrent), nunca según el reloj de la PC. Los ciclos anteriores al
// actual están cerrados: lo suyo se sigue viendo, pero es de solo lectura, y el proceso principal
// rechaza su edición y su baja (SCHOOL_YEAR_CLOSED). Las vistas lo muestran con Editar y Eliminar
// deshabilitados (read-only-title de row-actions.component.js).
//   - loadCurrentSchoolYear(): resuelve el ciclo lectivo actual, { year, today }, con year su año y
//     today la fecha del día ('AAAA-MM-DD'), o null si no se pudo obtener.
//   - closedSchoolYearTitle(year): el texto que explica por qué lo de ese ciclo, cerrado, no se
//     edita ni se elimina; el mismo mensaje de SCHOOL_YEAR_CLOSED.

(() => {
  window.loadCurrentSchoolYear = async () => {
    let response;
    try {
      response = await window.api?.schoolYears?.getCurrent();
    } catch (error) {
      console.error('Error al obtener el ciclo lectivo actual:', error);
    }
    return response?.ok ? response.schoolYear : null;
  };

  window.closedSchoolYearTitle = (year) => `El ciclo lectivo ${year} está cerrado: sus datos son de solo lectura.`;
})();
