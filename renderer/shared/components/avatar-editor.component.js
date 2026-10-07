// Componente reutilizable: campo "Foto de perfil" de los formularios de usuario (alta y edición) y de
// la vista Configuración de perfil.
// Uso: <avatar-editor heading="Foto de perfil (opcional)"></avatar-editor> genera el título, el
// círculo con la vista previa y, a su lado, "Subir imagen" y "Quitar imagen". El diálogo "Ajustar
// foto de perfil", donde se elige el encuadre, se agrega al final de <body>. Los estilos están en
// avatar-editor.css.
// "Subir imagen" pide un archivo JPG, PNG o WebP de hasta 5 MB y abre el diálogo con esa imagen.
// "Usar encuadre" deja el recorte en la vista previa y muestra el lápiz, que vuelve a abrir el
// diálogo con ese encuadre, y "Quitar imagen", que vuelve al ícono.
// API para la vista:
//   - reset(): vuelve al ícono, sin foto guardada ni cambios pendientes.
//   - showSavedImage(url): muestra la foto que el usuario ya tiene guardada. Sin el archivo original
//     no se puede reencuadrar (sin lápiz), pero sí quitar o reemplazar. "Quitar imagen" se ofrece
//     aunque no cargue la vista previa (p. ej., se subió desde otra PC): la base la tiene registrada.
//   - cancel(): descarta la imagen que se estaba abriendo y cierra el diálogo; el recorte ya
//     confirmado se conserva. La vista lo llama al cerrar su modal.
//   - isCropOpen: true con el diálogo abierto, que se cierra solo con su propio Escape.
//   - readChange(): promesa de { image, removeImage }, lo que la vista tiene que guardar. `image` es
//     el recorte confirmado (Uint8Array con un PNG del tamaño de #avatarCropCanvas), o null si no se
//     eligió una foto nueva; `removeImage` indica que se quitó la foto guardada.
// Solo arma el recorte: guardarlo le corresponde a la vista.
// Sin shadow DOM y con ids (el <label> del zoom, aria-labelledby del diálogo): una sola instancia
// por página.
// El script se carga sin defer en <head>, así el marcado existe antes de que la vista lo use en
// DOMContentLoaded.

(() => {
  // Mismos tipos que admite el atributo accept del selector de archivos.
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  // Tamaño máximo del archivo elegido. Solo se guarda el recorte, que es más liviano.
  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  class AvatarEditor extends HTMLElement {
    #preview;
    #uploadButton;
    #editButton;
    #removeButton;
    #fileInput;
    #error;
    #dialog;
    #canvas;
    #context;
    #zoom;
    #zoomValue;

    // Encuadre confirmado con "Usar encuadre" y el que se ajusta en el diálogo: { image, zoom, x, y }
    #savedCrop = null;
    #draftCrop = null;
    // Cambia con cada imagen que se empieza a cargar: las cargas anteriores se descartan
    #loadId = 0;
    #drag = null;
    // Foto guardada del usuario (showSavedImage), o null
    #savedImageUrl = null;
    // Recorte confirmado con "Usar encuadre": promesa del PNG (Uint8Array), o null
    #pendingImage = null;
    // Se pulsó "Quitar imagen" sobre la foto guardada
    #isImageRemoved = false;

    connectedCallback() {
      // Se genera una sola vez: los listeners quedan sobre estos nodos
      if (this.rendered) return;
      this.rendered = true;
      this.innerHTML = `<div class="avatar-section">
        <span class="avatar-title"></span>
        <div class="avatar-row">
          <div class="avatar-preview-wrapper">
            <div class="avatar-preview" id="avatarPreview">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
              </svg>
            </div>
            <button type="button" class="avatar-edit-btn" id="editAvatarBtn" aria-label="Ajustar encuadre" title="Ajustar encuadre" hidden>
              <!-- resources/Pencil.svg -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
              </svg>
            </button>
          </div>
          <div class="avatar-info">
            <!-- "Quitar imagen" se muestra cuando hay una foto, elegida o guardada -->
            <div class="avatar-actions">
              <button type="button" class="link-btn" id="uploadAvatarBtn">Subir imagen</button>
              <button type="button" class="link-btn" id="removeAvatarBtn" hidden>Quitar imagen</button>
            </div>
            <input type="file" accept="${IMAGE_TYPES.join(',')}" id="avatarFileInput" hidden />
            <p id="avatarError" role="alert" hidden></p>
          </div>
        </div>
      </div>`;
      this.querySelector('.avatar-title').textContent = this.getAttribute('heading');

      // Fuera del formulario que contiene al campo: un <dialog> modal no depende de dónde esté
      const dialog = document.createElement('dialog');
      dialog.className = 'avatar-crop-dialog';
      dialog.id = 'avatarCropDialog';
      dialog.setAttribute('aria-labelledby', 'avatarCropTitle');
      dialog.setAttribute('aria-describedby', 'avatarCropHelp');
      dialog.innerHTML = `<div class="modal-header">
        <h2 id="avatarCropTitle">Ajustar foto de perfil</h2>
        <p id="avatarCropHelp">Mueve la imagen para elegir el encuadre y utiliza la barra para ajustar el zoom.</p>
      </div>
      <div class="avatar-crop-body">
        <canvas id="avatarCropCanvas" width="512" height="512" tabindex="0" role="img" aria-label="Encuadre del avatar. Usa las flechas para mover la foto."></canvas>
        <label class="avatar-zoom-label" for="avatarZoom">Zoom <output id="avatarZoomValue" for="avatarZoom">100%</output></label>
        <input id="avatarZoom" type="range" min="1" max="4" step="0.01" value="1" />
        <button type="button" class="link-btn" id="resetAvatarCropBtn">Restablecer encuadre</button>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelAvatarCropBtn">Cancelar</button>
        <button type="button" class="btn btn-primary" id="saveAvatarCropBtn">Usar encuadre</button>
      </div>`;
      document.body.append(dialog);

      this.#preview = this.querySelector('#avatarPreview');
      this.#uploadButton = this.querySelector('#uploadAvatarBtn');
      this.#editButton = this.querySelector('#editAvatarBtn');
      this.#removeButton = this.querySelector('#removeAvatarBtn');
      this.#fileInput = this.querySelector('#avatarFileInput');
      this.#error = this.querySelector('#avatarError');
      this.#dialog = dialog;
      this.#canvas = dialog.querySelector('#avatarCropCanvas');
      this.#context = this.#canvas.getContext('2d');
      this.#zoom = dialog.querySelector('#avatarZoom');
      this.#zoomValue = dialog.querySelector('#avatarZoomValue');

      this.#uploadButton.addEventListener('click', () => this.#fileInput.click());
      this.#fileInput.addEventListener('change', () => this.#openFile());
      this.#editButton.addEventListener('click', () => this.#openCrop(this.#savedCrop));

      // Vuelve al ícono: descarta el recorte elegido y, si el usuario tenía una foto guardada, pide
      // quitarla. El foco pasa a "Subir imagen", porque este botón se oculta.
      this.#removeButton.addEventListener('click', () => {
        this.#loadId += 1;
        this.#pendingImage = null;
        this.#savedCrop = null;
        this.#isImageRemoved = Boolean(this.#savedImageUrl);
        this.#setPreview(null);
        this.#error.hidden = true;
        this.#uploadButton.focus();
        this.#editButton.hidden = true;
        this.#removeButton.hidden = true;
      });

      this.#zoom.addEventListener('input', () => {
        if (!this.#draftCrop) return;
        const zoom = Number(this.#zoom.value);
        const ratio = zoom / this.#draftCrop.zoom;
        this.#draftCrop.x *= ratio;
        this.#draftCrop.y *= ratio;
        this.#draftCrop.zoom = zoom;
        this.#renderCrop();
      });

      this.#canvas.addEventListener('pointerdown', (event) => {
        if (!this.#draftCrop || !event.isPrimary || event.button !== 0) return;
        this.#canvas.focus();
        this.#canvas.setPointerCapture(event.pointerId);
        this.#drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      this.#canvas.addEventListener('pointermove', (event) => {
        const drag = this.#drag;
        if (!drag || event.pointerId !== drag.id || !this.#draftCrop) return;
        const ratio = this.#canvas.width / this.#canvas.getBoundingClientRect().width;
        this.#draftCrop.x += (event.clientX - drag.x) * ratio;
        this.#draftCrop.y += (event.clientY - drag.y) * ratio;
        drag.x = event.clientX;
        drag.y = event.clientY;
        this.#renderCrop();
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
        this.#canvas.addEventListener(type, () => { this.#drag = null; });
      });
      this.#canvas.addEventListener('keydown', (event) => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction || !this.#draftCrop) return;
        event.preventDefault();
        const step = event.shiftKey ? 24 : 6;
        this.#draftCrop.x += direction[0] * step;
        this.#draftCrop.y += direction[1] * step;
        this.#renderCrop();
      });

      dialog.querySelector('#resetAvatarCropBtn').addEventListener('click', () => {
        Object.assign(this.#draftCrop, { zoom: 1, x: 0, y: 0 });
        this.#renderCrop();
      });
      dialog.querySelector('#cancelAvatarCropBtn').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => {
        if (dialog.open) return;
        this.#draftCrop = null;
        this.#drag = null;
      });
      dialog.querySelector('#saveAvatarCropBtn').addEventListener('click', () => {
        this.#savedCrop = { ...this.#draftCrop };
        this.#pendingImage = this.#exportCrop();
        this.#isImageRemoved = false;
        this.#setPreview(this.#canvas.toDataURL('image/png'));
        this.#editButton.hidden = false;
        this.#removeButton.hidden = false;
        dialog.close();
      });
    }

    get isCropOpen() {
      return this.#dialog.open;
    }

    reset() {
      this.#loadId += 1;
      this.#savedCrop = null;
      this.#savedImageUrl = null;
      this.#pendingImage = null;
      this.#isImageRemoved = false;
      this.#fileInput.value = '';
      this.#setPreview(null);
      this.#editButton.hidden = true;
      this.#removeButton.hidden = true;
      this.#error.hidden = true;
    }

    // Si la foto no carga, queda el ícono.
    async showSavedImage(url) {
      const loadId = ++this.#loadId;
      this.#savedImageUrl = url;
      this.#removeButton.hidden = false;
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        return;
      }
      if (loadId === this.#loadId) this.#setPreview(url);
    }

    cancel() {
      this.#loadId += 1;
      if (this.#dialog.open) this.#dialog.close();
    }

    async readChange() {
      return {
        image: this.#pendingImage ? await this.#pendingImage : null,
        removeImage: this.#isImageRemoved,
      };
    }

    // Vista previa: la foto de `url` o, con null, el ícono
    #setPreview(url) {
      this.#preview.style.backgroundImage = url ? `url("${url}")` : '';
      this.#preview.classList.toggle('has-image', Boolean(url));
    }

    #showError(message) {
      this.#error.textContent = message;
      this.#error.hidden = false;
    }

    // Abre el diálogo con el archivo elegido en el selector, si es una imagen válida
    async #openFile() {
      const file = this.#fileInput.files[0];
      this.#fileInput.value = '';
      if (!file) return;
      const loadId = ++this.#loadId;
      this.#error.hidden = true;
      if (file.size > MAX_FILE_BYTES) {
        this.#showError('La imagen supera los 5 MB. Selecciona una más liviana.');
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        if (!IMAGE_TYPES.includes(file.type)) throw new Error('Formato inválido');
        const image = new Image();
        image.src = url;
        await image.decode();
        if (loadId !== this.#loadId) return;
        this.#openCrop({ image, zoom: 1, x: 0, y: 0 });
      } catch (error) {
        if (loadId !== this.#loadId) return;
        this.#showError('No se pudo abrir la imagen. Selecciona un archivo JPG, PNG o WebP válido.');
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    #openCrop(crop) {
      this.#draftCrop = { ...crop };
      this.#renderCrop();
      this.#dialog.showModal();
      this.#canvas.focus();
    }

    #renderCrop() {
      const crop = this.#draftCrop;
      if (!crop) return;
      const { image, zoom } = crop;
      const size = this.#canvas.width;
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      // Limitar el movimiento para que nunca queden espacios vacíos en el avatar.
      crop.x = Math.max((size - width) / 2, Math.min((width - size) / 2, crop.x));
      crop.y = Math.max((size - height) / 2, Math.min((height - size) / 2, crop.y));
      this.#context.clearRect(0, 0, size, size);
      this.#context.drawImage(image, (size - width) / 2 + crop.x, (size - height) / 2 + crop.y, width, height);
      this.#zoom.value = String(zoom);
      this.#zoomValue.value = `${Math.round(zoom * 100)}%`;
    }

    // PNG del recorte, del tamaño de #avatarCropCanvas: su width y su height deben coincidir con
    // PROFILE_IMAGE_SIZE (profile-image.service.js), que rechaza otro tamaño. El proceso principal lo
    // guarda como JPEG, sin transparencia: el fondo blanco evita que lo transparente quede negro.
    #exportCrop() {
      const canvas = document.createElement('canvas');
      canvas.width = this.#canvas.width;
      canvas.height = this.#canvas.height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(this.#canvas, 0, 0);
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo exportar el recorte.'))), 'image/png');
      }).then(async (blob) => new Uint8Array(await blob.arrayBuffer()));
    }
  }

  customElements.define('avatar-editor', AvatarEditor);
})();
