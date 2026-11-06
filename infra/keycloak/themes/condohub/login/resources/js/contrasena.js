// Mostrar u ocultar la contraseña; el texto del botón cambia para los lectores de pantalla.
document.querySelectorAll('.ch-ver').forEach((boton) => {
  const campo = document.getElementById(boton.getAttribute('aria-controls'));
  if (!campo) return;
  boton.addEventListener('click', () => {
    const visible = campo.type === 'password';
    campo.type = visible ? 'text' : 'password';
    boton.setAttribute('aria-pressed', String(visible));
    boton.setAttribute('aria-label', visible ? boton.dataset.ocultar : boton.dataset.mostrar);
  });
});
