# Consentimiento para el reconocimiento facial — CondoHub

**Versión del texto: `v1-borrador`.** Cada persona cuyas fotos se usen debe aceptar este texto antes de tomarle ninguna foto (regla I1).
Se guarda junto a sus fotos un archivo `consentimiento.json` con la fecha y la versión: `{"fecha": "2026-10-16", "version": "v1-borrador"}`.
Si el texto cambia, se sube la versión y se vuelve a pedir el consentimiento.

> **Borrador, no es asesoría legal.** Lo debe revisar el equipo (y el docente, si corresponde) y contrastarse con la normativa de protección de
> datos aplicable. Completar los campos `[entre corchetes]` antes de usarlo.

## 1. Texto para la persona

**¿De qué se trata?** CondoHub es un proyecto universitario (Software 2) de un sistema para administrar un condominio. Una de sus funciones es el
reconocimiento facial en la portería, que **ayuda al guardia** a ver quién llega. El sistema nunca abre una puerta por sí solo.

**¿Qué datos se usan?** Fotos de tu rostro. De cada foto se calcula una «huella facial»: una lista de números que representa tu cara. No es una foto.

**¿Para qué?** Solo para (1) entrenar y evaluar el modelo, como parte del trabajo académico, y (2) reconocerte en la demostración del sistema.
No se usarán para publicidad, para venderlas ni para ningún otro fin.

**¿Cómo se cuidan?**
- Las fotos y huellas se guardan en un almacenamiento privado del equipo [integrantes con acceso: Luis, Aldana y Erick].
- Para entrenar y evaluar, las fotos se procesan de forma temporal en servicios en la nube (Google Colab / Google Drive).
- No se publican ni se suben a repositorios de código.

**¿Hasta cuándo?** Mientras dure el proyecto, hasta [fecha de fin del proyecto]. Después se borran.

**Es voluntario.** Puedes negarte sin ninguna consecuencia. Puedes **retirar tu consentimiento cuando quieras** escribiendo a [correo o teléfono de contacto];
borraremos tus fotos y huellas en **menos de 24 horas**.

**Menores de edad:** no se toman fotos sin la autorización de su madre, padre o tutor.

**Declaración.** Yo, ____________________, mayor de edad, he leído este texto y acepto que se usen mis fotos para lo indicado.

Fecha: ____ / ____ / ______    Firma o aceptación por escrito (mensaje): ____________________

## 2. Cómo tomar las fotos (protocolo)

| Tema | Indicación |
|---|---|
| Cuántas | De 30 a 50 por persona (mínimo 15) |
| Sesiones | Al menos **3 sesiones**: días, ropa y fondos distintos. Varias fotos de una misma sesión se parecen mucho entre sí |
| Evitar | Ráfagas: producen fotos casi idénticas y no aportan variedad |
| Pose | De frente y girando la cabeza hasta unos 30° a cada lado |
| Luz | Alta, baja y a contraluz; guarda las difíciles (borrosas o con reflejo), no las borres |
| Detalles | Con y sin lentes si los usas; a 0,5 m, 1 m y 2 m; algunas con la cámara que se usará en la portería |
| Calidad | Sin filtros ni «modo belleza»; el rostro completo visible |
| Desconocidos | Las mismas reglas, pero 1 a 5 fotos por persona y **al menos 15 personas distintas**, incluidas algunas de aspecto parecido a los residentes |

**Estructura de carpetas** (una carpeta por persona, una subcarpeta por sesión):

```
<persona>/
    consentimiento.json
    2026-10-16_luz-alta/foto1.jpg
    2026-10-16_luz-baja/foto2.jpg
```

**Antes de subirlas a Colab:** reducirlas a 1280 px y quitarles los metadatos (ubicación GPS y datos del teléfono). Ver `services/ia/ml/README.md`.

**Almacenamiento:** en un lugar privado; nunca en git ni en una carpeta pública. Si alguien retira su consentimiento, se borran sus fotos y huellas (de la
base de datos y de cualquier copia) en menos de 24 horas.