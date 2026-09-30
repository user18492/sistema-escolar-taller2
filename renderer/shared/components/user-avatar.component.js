// Componente global: avatar de un usuario, con sus iniciales y, si tiene, su foto de perfil encima.
// Uso: fillAvatar(elemento, { firstName, lastName, imageUrl }) sobre un .avatar-circle (tablas y
// desplegables, base.css) o el .profile-avatar de la barra lateral. Reemplaza el contenido del
// elemento. `imageUrl` es la URL que informa el proceso principal (profile-image://avatars/…) o
// null; si la foto no carga (p. ej., se subió desde otra PC), se quita y quedan las iniciales.
// Los datos se asignan siempre con textContent, nunca como HTML.

(() => {
  const initialsOf = ({ firstName, lastName }) =>
    [firstName, lastName].map((name) => name?.trim().charAt(0) ?? '').join('').toUpperCase();

  window.fillAvatar = (element, user) => {
    element.textContent = initialsOf(user);
    if (!user.imageUrl) return;

    const image = document.createElement('img');
    image.className = 'avatar-image';
    image.alt = '';
    // Las opciones de los filtros cerrados no piden su foto hasta que se muestran
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => image.remove());
    image.src = user.imageUrl;
    element.append(image);
  };
})();
