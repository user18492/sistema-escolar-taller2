class FollowUpBadge extends HTMLElement {
  static observedAttributes = ['count'];

  attributeChangedCallback(_name, _oldValue, value) {
    const count = Number(value);
    this.hidden = count === 0;
    this.textContent = count || '';
    this.setAttribute('role', 'img');
    const label = count === 1 ? '1 alerta de seguimiento pendiente' : `${count} alertas de seguimiento pendientes`;
    this.setAttribute('aria-label', label);
    this.title = label;
  }
}

customElements.define('follow-up-badge', FollowUpBadge);
