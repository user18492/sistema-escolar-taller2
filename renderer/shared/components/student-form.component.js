// Componente global: formulario "Nuevo alumno" / "Editar alumno" (Alumnos del Secretario y su
// reporte Alumnos activos sin inscripción). Genera el encabezado, el cuerpo (los datos del alumno y,
// al editar, su Estado) y el pie de un modal de formulario, y resuelve todo el formulario: el modo,
// los datos del alumno que se edita, el guardado (window.api.students.create y update), los errores
// de cada campo y sus toasts. La vista pone el elemento dentro del .modal de su .modal-overlay y se
// queda con abrir y cerrar el overlay, el foco al cerrar y Escape.
// Marcado: <div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true"
// aria-labelledby="newStudentTitle"><student-form></student-form></div></div>. El elemento es
// display: contents (student-form.css), así sus partes quedan como hijas del .modal; con el atributo
// hidden no se muestra (un modal por pasos, list-modal.component.js). Lleva los ids newStudentTitle,
// newStudentFirstName… (un campo por dato), editStudentStatusField, editStudentStatusHint,
// cancelNewStudentBtn y createStudentBtn, y el desplegable [data-filter="edit-student-status"]: una
// sola vez por vista.
// El script se carga sin defer en <head>: el marcado existe cuando la vista llama a setupDropdowns
// en DOMContentLoaded, que así toma también el desplegable Estado, y cuando field-validation prepara
// los campos con data-validate.
// API del elemento:
//   - setup({ closeAllDropdowns, onSaved, onCancel, onStale, onDeletedMatch }), una vez, después de
//     setupDropdowns (de él viene closeAllDropdowns).
//       - onSaved(student, { isEditing }): se creó o se editó el alumno (como lo devuelven
//         students.create y students.update). La vista actualiza su tabla y cierra el modal;
//         después el componente muestra el toast de éxito.
//       - onCancel(): se pulsó Cancelar (mientras se guarda no responde).
//       - onStale(code): al editar, los datos de la vista quedaron viejos (STALE_EDIT_CODES: otra
//         sesión dio de baja al alumno o lo inscribió y ya no puede pasar a egresado). La vista
//         vuelve a pedir sus datos y cierra el modal; el toast de error lo muestra el componente.
//       - onDeletedMatch(): un alta con el DNI o el email de un alumno dado de baja
//         (DELETED_STUDENT_EXISTS) no se hizo. La vista vuelve a pedir sus datos (Eliminados puede
//         no tenerlo todavía) y el modal sigue abierto; el toast manda a restaurarlo.
//     Si devuelven una promesa, el formulario sigue guardando (inerte, con "Creando…" o
//     "Guardando…") hasta que se resuelve.
//   - open({ student = null }): deja el formulario listo; no abre ningún overlay. Sin `student`, un
//     alta; con él, la edición de ese alumno (con los campos de students.list): el formulario sale
//     de sus datos y, si tiene una inscripción activa (hasActiveEnrollment), Egresado queda
//     deshabilitado, con una aclaración debajo de Estado.
//   - focusFirst(): el foco en Nombre (al abrir el modal).
//   - closeMenus(): cierra los desplegables (al cerrar el modal).
//   - isSaving: si se está esperando la respuesta (la vista no cierra el modal con Escape).
//   - editingStudentId: el id del alumno que se edita; null en un alta.
// Dependencias (scripts sin defer en <head>, antes que este, y sus .css): dropdown.component.js
// (dropdown.css), field-validation.component.js (form-field.css), modal-dropdown.js
// (modal-dropdown.css), modal-resize.js, modal-focus-trap, text-truncate.component.js,
// toast.component.js (toast.css); además buttons.css y student-form.css.

(() => {
  const STATUS_PLACEHOLDER = 'Seleccionar estado';
  const GRADUATED_LOCKED_HINT = 'Tiene una inscripción activa: podrá pasar a egresado cuando la inscripción finalice o se cancele.';

  // Al editar, los datos de la vista quedaron viejos: el alumno ya no está vigente
  // (STUDENT_NOT_FOUND) u otra sesión lo inscribió después de la carga y no puede pasar a egresado
  // (STUDENT_HAS_ACTIVE_ENROLLMENT)
  const STALE_EDIT_CODES = ['STUDENT_NOT_FOUND', 'STUDENT_HAS_ACTIVE_ENROLLMENT'];

  // "Nombre Apellido", como lo nombran los toasts
  const displayName = (student) => `${student.firstName} ${student.lastName}`;
  // La fecha llega como 'AAAA-MM-DD' (o null) y se muestra como DD/MM/AAAA
  const toDisplayDate = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('/') : '');
  // El campo ya validado (DD/MM/AAAA) se envía como 'AAAA-MM-DD'
  const toIsoDate = (displayDate) => displayDate.split('/').reverse().join('-');

  // Descripción de los toasts de error: el mensaje del proceso principal. Sin respuesta, o con
  // UNEXPECTED_ERROR (su mensaje repite el título del toast), queda la genérica.
  const errorDescription = (error) =>
    (error?.code && error.code !== 'UNEXPECTED_ERROR' ? error.message : 'Intentá nuevamente.');

  // Textos del encabezado, del botón principal (en reposo y mientras se espera la respuesta) y de
  // los toasts de éxito y de error, según el modo del formulario
  const MODE_TEXTS = {
    create: {
      title: 'Nuevo alumno',
      description: 'Completa los datos para registrar un nuevo alumno.',
      submit: 'Crear alumno',
      saving: 'Creando…',
      successTitle: 'Alumno creado',
      successDescription: (student) => `Se registró a ${displayName(student)}.`,
      errorTitle: 'No se pudo crear el alumno',
    },
    edit: {
      title: 'Editar alumno',
      description: 'Modifica los datos del alumno.',
      submit: 'Guardar cambios',
      saving: 'Guardando…',
      successTitle: 'Alumno actualizado',
      successDescription: (student) => `Se guardaron los cambios de ${displayName(student)}.`,
      errorTitle: 'No se pudieron guardar los cambios',
    },
  };

  const MARKUP = `<div class="modal-header">
          <h2 id="newStudentTitle">${MODE_TEXTS.create.title}</h2>
          <p>${MODE_TEXTS.create.description}</p>
        </div>

        <div class="modal-body">
          <div class="form-grid">
            <div class="form-field">
              <label for="newStudentFirstName">Nombre</label>
              <div class="field">
                <input type="text" id="newStudentFirstName" placeholder="Camila" data-validate="person-name" required />
              </div>
            </div>
            <div class="form-field">
              <label for="newStudentLastName">Apellido</label>
              <div class="field">
                <input type="text" id="newStudentLastName" placeholder="Álvarez" data-validate="person-name" required />
              </div>
            </div>
            <div class="form-field">
              <label for="newStudentDni">DNI</label>
              <div class="field">
                <input type="text" id="newStudentDni" placeholder="48.123.456" inputmode="numeric" data-validate="dni" required />
              </div>
            </div>
            <div class="form-field">
              <label for="newStudentBirthdate">Fecha de nacimiento</label>
              <div class="field field-date">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <line x1="16" y1="3" x2="16" y2="7" />
                  <line x1="8" y1="3" x2="8" y2="7" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <input type="text" id="newStudentBirthdate" placeholder="DD/MM/AAAA" inputmode="numeric" autocomplete="off" data-validate="birth-date" data-min-age="5" data-max-age="25" required />
              </div>
            </div>
            <div class="form-field">
              <label for="newStudentEmail">Email</label>
              <div class="field">
                <input type="email" id="newStudentEmail" placeholder="camila.alvarez@institucion.edu.ar" data-validate="email" required />
              </div>
            </div>
            <div class="form-field">
              <label for="newStudentPhone">Teléfono</label>
              <div class="field">
                <input type="tel" id="newStudentPhone" placeholder="3794123456" inputmode="numeric" data-validate="phone" required />
              </div>
            </div>
            <div class="form-field">
              <label for="newStudentStreet">Dirección</label>
              <div class="field-pair">
                <div class="field">
                  <input type="text" id="newStudentStreet" placeholder="Av. Belgrano" aria-label="Calle" data-validate="street" required />
                </div>
                <div class="field">
                  <input type="text" id="newStudentStreetNumber" placeholder="1245" inputmode="numeric" aria-label="Altura" data-validate="street-number" required />
                </div>
              </div>
            </div>
            <div class="form-field" id="editStudentStatusField" hidden>
              <label>Estado</label>
              <div class="field field-select dropdown" data-filter="edit-student-status">
                <button type="button" class="dropdown-toggle" aria-haspopup="listbox" aria-expanded="false" aria-describedby="editStudentStatusHint">
                  <span class="dropdown-label text-truncate placeholder">${STATUS_PLACEHOLDER}</span>
                  <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <ul class="dropdown-menu" role="listbox" hidden>
                  <li class="dropdown-option" role="option" data-value="ACTIVE" aria-selected="false">Activo</li>
                  <li class="dropdown-option" role="option" data-value="GRADUATED" aria-selected="false">Egresado</li>
                </ul>
              </div>
              <!-- Se muestra si el alumno tiene una inscripción activa, con Egresado deshabilitado -->
              <p class="field-hint" id="editStudentStatusHint" hidden></p>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="cancelNewStudentBtn">Cancelar</button>
          <button type="button" class="btn btn-primary" id="createStudentBtn" disabled>${MODE_TEXTS.create.submit}</button>
        </div>`;

  class StudentForm extends HTMLElement {
    connectedCallback() {
      // Se genera una sola vez: los listeners de setup quedan sobre estos nodos
      if (this.rendered) return;
      this.rendered = true;
      this.innerHTML = MARKUP;
    }

    // ---------- Estado ----------

    #isSaving = false;
    // alumno_id del alumno que se edita, fijado al abrir el formulario: es el único que se envía al
    // guardar. null en un alta.
    #editingStudentId = null;

    get isSaving() {
      return this.#isSaving;
    }

    get editingStudentId() {
      return this.#editingStudentId;
    }

    // Las funciones que arma setup(), que usan los nodos y los listeners del formulario
    #form = null;

    setup(options) {
      this.#form = this.#createForm(options);
    }

    open(options) {
      this.#form.open(options);
    }

    focusFirst() {
      this.#form.focusFirst();
    }

    closeMenus() {
      this.#form.closeMenus();
    }

    // Toda la lógica del formulario, sobre sus nodos. Devuelve las funciones que usa la API.
    #createForm({ closeAllDropdowns, onSaved, onCancel, onStale, onDeletedMatch }) {
      const modal = this.closest('.modal');
      const modalBody = this.querySelector('.modal-body');
      const title = this.querySelector('#newStudentTitle');
      const description = this.querySelector('.modal-header p');
      const cancelButton = this.querySelector('#cancelNewStudentBtn');
      const submitButton = this.querySelector('#createStudentBtn');

      const textInputs = this.querySelectorAll(
        '.modal-body input[type="text"], .modal-body input[type="email"], .modal-body input[type="tel"]'
      );
      // Estado: el campo solo se muestra al editar; un alta registra siempre un alumno activo.
      const statusField = this.querySelector('#editStudentStatusField');
      const statusDropdown = statusField.querySelector('.dropdown');
      const statusLabel = statusDropdown.querySelector('.dropdown-label');
      const statusOptions = statusDropdown.querySelectorAll('.dropdown-option');
      const graduatedOption = statusDropdown.querySelector('.dropdown-option[data-value="GRADUATED"]');
      const statusHint = this.querySelector('#editStudentStatusHint');

      const firstNameInput = this.querySelector('#newStudentFirstName');
      const lastNameInput = this.querySelector('#newStudentLastName');
      const dniInput = this.querySelector('#newStudentDni');
      const birthdateInput = this.querySelector('#newStudentBirthdate');
      const emailInput = this.querySelector('#newStudentEmail');
      const phoneInput = this.querySelector('#newStudentPhone');
      const streetInput = this.querySelector('#newStudentStreet');
      const streetNumberInput = this.querySelector('#newStudentStreetNumber');

      // Campos que el proceso principal puede marcar (error.fieldErrors), en el orden del formulario
      const FIELD_INPUTS = {
        firstName: firstNameInput,
        lastName: lastNameInput,
        dni: dniInput,
        birthDate: birthdateInput,
        email: emailInput,
        phone: phoneInput,
        street: streetInput,
        streetNumber: streetNumberInput,
      };

      let isEditing = false;
      const modeTexts = () => MODE_TEXTS[isEditing ? 'edit' : 'create'];

      // Máscaras, formato y errores de los campos de texto: componente compartido
      // field-validation.component.js, según el data-validate de cada campo.

      const updateSubmitButtonState = () => {
        const hasAllTextInputs = Array.from(textInputs).every((input) => input.value.trim().length > 0);
        // Al editar llega elegido el estado actual del alumno; en el alta no se elige
        const hasStatus = !isEditing || Boolean(statusDropdown.querySelector('.dropdown-option.selected'));
        submitButton.disabled = !(hasAllTextInputs && hasStatus);
      };

      // Mientras se espera la respuesta, el cuerpo del formulario queda inerte, así lo enviado
      // coincide con lo que se ve. Los botones del pie quedan con aria-disabled y no con disabled:
      // conservan el foco, como en confirm-modal.component.js.
      const setSaving = (saving) => {
        this.#isSaving = saving;
        modalBody.inert = saving;
        modal?.setAttribute('aria-busy', String(saving));
        [cancelButton, submitButton].forEach((button) => button.setAttribute('aria-disabled', String(saving)));
        submitButton.textContent = saving ? modeTexts().saving : modeTexts().submit;
      };

      // Marca la opción de estado con ese data-value (ACTIVE o GRADUATED), replicando lo que hace el
      // listener del dropdown al elegirla con el ratón.
      const selectStatus = (status) => {
        statusOptions.forEach((option) => {
          const selected = option.dataset.value === status;
          option.classList.toggle('selected', selected);
          option.setAttribute('aria-selected', String(selected));
          if (selected) statusLabel.textContent = option.textContent.trim();
        });
        statusLabel.classList.remove('placeholder');
      };

      // Con una inscripción activa, el alumno no pasa a egresado (la base también lo rechaza):
      // Egresado lleva aria-disabled, que dropdown.component.js no deja elegir, y la aclaración
      // debajo del campo dice por qué. Oculta, la aclaración se vacía: así aria-describedby no
      // anuncia una que no se ve.
      const lockGraduated = (locked) => {
        if (locked) graduatedOption.setAttribute('aria-disabled', 'true');
        else graduatedOption.removeAttribute('aria-disabled');
        statusHint.textContent = locked ? GRADUATED_LOCKED_HINT : '';
        statusHint.hidden = !locked;
      };

      // También desbloquea Egresado: el alta y la edición de otro alumno no heredan el bloqueo
      const resetForm = () => {
        textInputs.forEach((input) => (input.value = ''));
        clearFieldErrors(this);
        statusOptions.forEach((option) => {
          option.classList.remove('selected');
          option.setAttribute('aria-selected', 'false');
        });
        statusLabel.textContent = STATUS_PLACEHOLDER;
        statusLabel.classList.add('placeholder');
        lockGraduated(false);
        updateSubmitButtonState();
      };

      // Los datos del formulario salen del alumno cargado de la base (no del texto de una tabla), y
      // también si Egresado se puede elegir (hasActiveEnrollment)
      const open = ({ student = null } = {}) => {
        isEditing = Boolean(student);
        this.#editingStudentId = student?.id ?? null;
        resetForm();

        title.textContent = modeTexts().title;
        description.textContent = modeTexts().description;
        submitButton.textContent = modeTexts().submit;
        statusField.hidden = !isEditing;

        if (student) {
          firstNameInput.value = student.firstName ?? '';
          lastNameInput.value = student.lastName ?? '';
          emailInput.value = student.email ?? '';
          phoneInput.value = student.phone ?? '';
          streetInput.value = student.street ?? '';
          streetNumberInput.value = student.streetNumber ?? '';
          dniInput.value = formatDni(student.dni ?? '');
          birthdateInput.value = toDisplayDate(student.birthDate);
          selectStatus(student.status);
          lockGraduated(Boolean(student.hasActiveEnrollment));
        }

        updateSubmitButtonState();
        closeAllDropdowns();
        if (modal) modal.scrollTop = 0;
      };

      // Solo los datos del formulario: el id va aparte, tomado al abrirlo. El estado va solo al
      // editar: un alta no lo envía. El DNI se envía solo con dígitos, como se guarda.
      const readFormData = () => ({
        firstName: firstNameInput.value,
        lastName: lastNameInput.value,
        dni: dniInput.value.replace(/\D/g, ''),
        email: emailInput.value,
        phone: phoneInput.value,
        street: streetInput.value,
        streetNumber: streetNumberInput.value,
        birthDate: toIsoDate(birthdateInput.value),
        ...(isEditing ? { status: statusDropdown.querySelector('.dropdown-option.selected')?.dataset.value ?? '' } : {}),
      });

      // Marca los campos que rechazó el proceso principal (DNI o email de otro alumno, datos
      // inválidos) y enfoca el primero. Devuelve false si no había ninguno para marcar.
      const showFieldErrors = (fieldErrors = {}) => {
        const invalidFields = Object.entries(FIELD_INPUTS).filter(([field]) => fieldErrors[field]);
        invalidFields.forEach(([field, input]) => setFieldError(input, fieldErrors[field]));
        invalidFields[0]?.[1].focus();
        return invalidFields.length > 0;
      };

      // Registra o guarda según el modo. Si lo hace, se espera onSaved (la vista actualiza su tabla
      // y cierra el modal) y un toast lo avisa. Los errores de un campo se marcan en el formulario y
      // los demás salen en un toast: en ambos casos el formulario sigue abierto con lo que se
      // escribió. Si al editar los datos de la vista habían quedado viejos (STALE_EDIT_CODES), antes
      // se espera onStale, que cierra el modal: al volver a abrir Editar, el formulario sale de los
      // datos nuevos, con Egresado ya deshabilitado si lo inscribieron.
      // Un alta con el DNI o el email de un alumno dado de baja (DELETED_STUDENT_EXISTS) no lo
      // registra: se espera onDeletedMatch y el toast lo nombra y manda a restaurarlo desde
      // Eliminados.
      const saveStudent = async () => {
        const studentId = this.#editingStudentId;
        const wasEditing = isEditing;
        setSaving(true);
        let response;
        try {
          const data = readFormData();
          response = await (wasEditing
            ? window.api?.students?.update(studentId, data)
            : window.api?.students?.create(data));
        } catch (error) {
          console.error('Error al guardar el alumno:', error);
        }

        if (response?.ok) {
          await onSaved?.(response.student, { isEditing: wasEditing });
          setSaving(false);
          showToast({
            type: 'success',
            title: modeTexts().successTitle,
            description: modeTexts().successDescription(response.student),
          });
          return;
        }
        const error = response?.error;
        if (wasEditing && STALE_EDIT_CODES.includes(error?.code)) await onStale?.(error.code);
        else if (!wasEditing && error?.code === 'DELETED_STUDENT_EXISTS') await onDeletedMatch?.();
        setSaving(false);
        if (showFieldErrors(error?.fieldErrors)) return;
        showToast({ type: 'error', title: modeTexts().errorTitle, description: errorDescription(error) });
      };

      textInputs.forEach((input) => {
        input.addEventListener('input', updateSubmitButtonState);
      });

      statusOptions.forEach((option) => {
        option.addEventListener('click', () => {
          statusLabel.classList.remove('placeholder');
          updateSubmitButtonState();
        });
      });

      cancelButton.addEventListener('click', () => {
        if (!this.#isSaving) onCancel?.();
      });

      submitButton.addEventListener('click', () => {
        if (this.#isSaving) return;
        // Con algún campo inválido, el formulario sigue abierto con el foco en el primero.
        if (validateFields(this)) return;
        // El proceso principal vuelve a validar todo.
        saveStudent();
      });

      return {
        open,
        focusFirst: () => firstNameInput.focus(),
        closeMenus: () => closeAllDropdowns(),
      };
    }
  }

  customElements.define('student-form', StudentForm);
})();
