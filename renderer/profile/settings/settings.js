// Vista Configuración de perfil, compartida por los tres roles (la abre "Configuración", en el menú
// del perfil de sidebar.js). Puramente visual: los campos no traen los datos del usuario y
// ni "Guardar cambios" ni "Eliminar mi cuenta" guardan nada.
// La foto de perfil es el componente compartido avatar-editor.component.js y las máscaras y los
// errores de los campos, field-validation.component.js.

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('profileForm');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Con algún campo inválido, el foco queda en el primero. Vista puramente visual: el guardado
    // real se conecta acá cuando exista la capa de servicios/IPC.
    validateFields(form);
  });

  // ---------- Modal: Eliminar cuenta ----------

  // Componente compartido confirm-modal.component.js. Vista puramente visual: la baja real de la
  // cuenta se conecta con onConfirm cuando exista la capa de servicios/IPC.
  setupConfirmModal(document.getElementById('deleteUserOverlay'), { triggerSelector: '#deleteAccountBtn' });
});
