# Reglas de negocio — CondoHub

Fuente de verdad de las reglas. Cada regla tiene un código (F, R, S, A, O, I, G) que se usa en tests, commits y PRs. Los valores numéricos son parámetros iniciales, no constantes.

## Lenguaje ubicuo

Usa estos términos exactos en código de dominio, eventos, GraphQL y UI. Identificadores de dominio en español (`Unidad`, `Expensa`, `aplicarRecargo`); infraestructura técnica en inglés (`Repository`, `Controller`, `Adapter`).

| Término | Significado |
|---|---|
| Unidad | Casa o departamento. Tiene una alícuota y un propietario titular |
| Alícuota | Porcentaje de participación de la unidad en el presupuesto. La suma de todas = 100 % |
| Presupuesto mensual | Gasto previsto del mes que se reparte entre unidades |
| Expensa | Cuota mensual de una unidad = presupuesto mensual × alícuota |
| Cargo | Cualquier deuda de una unidad: expensa, recargo, uso de área común, garantía |
| Pago | Dinero que entra para una unidad. Estados: `PENDIENTE`, `CONFIRMADO`, `RECHAZADO` |
| Moroso | Unidad con al menos un cargo vencido e impago |
| Recargo | Interés por mora sobre un cargo vencido |
| Área común | Salón de eventos, piscina, churrasquera |
| Reserva | Bloque horario de un área común para una unidad |
| Visita | Persona que un residente anuncia |
| Pase | Credencial QR de una visita, con ventana de validez |
| Registro de acceso | Entrada o salida en portería (solo se agrega, nunca se edita) |
| Desconocido | Rostro captado en portería que no coincide con ningún residente |

## Reglas de negocio

Los valores numéricos son **parámetros** (tabla `parametro` en Gestión o configuración de cada servicio), no constantes en el código. Los valores de aquí son los iniciales.

### 1. Finanzas (Gestión empresarial)

- **F1.** Cada unidad tiene exactamente un propietario titular y cero o más residentes. Solo el titular y sus residentes ven el estado de cuenta de esa unidad.
- **F2.** La suma de alícuotas de todas las unidades activas debe ser 100 %. No se pueden emitir expensas si no cuadra.
- **F3.** Las expensas se emiten el día **1** de cada mes: `expensa = presupuesto_mensual × alícuota`, redondeada a 2 decimales. La diferencia de redondeo va a la unidad de mayor alícuota. Cada periodo se emite una sola vez y solo el mes actual o uno futuro: un mes pasado se rechaza, porque sus expensas nacerían vencidas (F4) y las unidades pasarían a morosas sin haber podido pagar (afectaría R4).
- **F4.** Vencimiento: día **10** del mes. Un cargo impago al día 11 está vencido y la unidad pasa a morosa.
- **F5.** Recargo por mora: **2 % mensual simple** sobre el saldo vencido. El sistema (o el agente) lo **propone**; solo se aplica cuando el `ADMIN` lo confirma. Nunca se aplica un recargo sin esa confirmación.
- **F6.** Los cargos no se borran ni se editan. Una corrección es una nota de crédito o un cargo de ajuste con motivo.
- **F7.** Un pago confirmado se imputa a los cargos vencidos más antiguos primero (FIFO). Si alcanza, sigue con los cargos pendientes aún no vencidos, también del vencimiento más antiguo al más reciente. El excedente queda como saldo a favor.
- **F8.** Ciclo de un pago: el residente sube el comprobante → pago `PENDIENTE` → conciliación (n8n compara con el extracto + el `ADMIN` confirma) → `CONFIRMADO` o `RECHAZADO` con motivo. El recibo se emite solo al confirmar. La fecha del comprobante no puede ser futura: nadie paga en un día que aún no llega.
- **F9.** Un pago **nunca se confirma offline** ni desde el cliente. El OCR del comprobante solo prellena monto, fecha y banco; el residente revisa antes de enviar.
- **F10.** Dinero: `BigDecimal` en Java, `NUMERIC(12,2)` en PostgreSQL, string decimal en JSON. Jamás `float`/`double`. Una sola moneda configurable.
- **F11.** Proveedores y egresos se registran para el presupuesto y los reportes. No hay flujo de aprobación de gastos.

### 2. Reservas

- **R1.** Áreas iniciales: salón de eventos (aforo 80), piscina (aforo 20), churrasquera ×2 (aforo 15 c/u).
- **R2.** Horario reservable 08:00–23:00. Bloques mínimos de 2 h. Dos reservas del mismo área no se solapan (validar en BD con restricción, no solo en código).
- **R3.** Anticipación: mínimo **48 h**, máximo **60 días**. Máximo **2 reservas activas** por unidad.
- **R4.** Una unidad **morosa con 2 o más expensas vencidas** no puede reservar. Reservas lo consulta a Gestión antes de iniciar la saga.
- **R5.** El salón de eventos genera dos cargos: costo de uso y garantía. Las demás áreas solo costo de uso (puede ser 0).
- **R6.** La garantía se devuelve (nota de crédito) cuando el `ADMIN` marca la reserva como `FINALIZADA` sin daños.
- **R7.** Cancelación por el residente hasta 48 h antes: se anulan los cargos. Después: se mantiene el costo de uso, se devuelve la garantía.
- **R8.** Estados: `SOLICITADA → CONFIRMADA → FINALIZADA`, o `SOLICITADA → FALLIDA`, o `CONFIRMADA → CANCELADA`.

### 3. Saga de reserva (transacción distribuida)

Orquestada desde Reservas, comunicación por RabbitMQ:

| Paso | Servicio | Acción | Compensación |
|---|---|---|---|
| 1 | Reservas | Bloquear horario (`SOLICITADA`) | Liberar horario (`FALLIDA`) |
| 2 | Gestión | Aplicar cargos de la reserva (`CargoAplicado`) | Anular cargos (nota de crédito) |
| 3 | Acceso | Emitir pases QR de los invitados (`PaseEmitido`) | Revocar pases |
| 4 | Notificaciones | Avisar al residente | — |

- **S1.** El estado de cada saga se persiste en Reservas (`saga_instancia`); tras un reinicio se retoma.
- **S2.** Cada paso se reintenta 3 veces con espera exponencial. Si falla, se compensan en orden inverso los pasos ya hechos y se avisa al residente.
- **S3.** Las compensaciones se reintentan hasta lograrse. Si una no puede, la saga queda `REQUIERE_REVISION` y aparece en la consola del `ADMIN`.
- **S4.** Patrón **Outbox** en todos los servicios que publican eventos: el cambio y el mensaje se guardan en la misma transacción.
- **S5.** Todo consumidor es **idempotente**: guarda el `eventId` procesado y descarta repetidos.

### 4. Acceso y portería

- **A1.** Un residente registra una visita → se emite un pase QR con ventana de validez (por defecto el día indicado, 07:00–23:59) y **un solo uso** de ingreso.
- **A2.** El guardia valida el QR. Pase vencido, usado o revocado → rechazo con motivo. Sin pase, el guardia registra la visita manualmente indicando la unidad que autoriza.
- **A3.** Los registros de acceso son **append-only**: nunca se editan ni se borran. Un error se corrige con un registro nuevo que referencia al anterior.
- **A4.** Vehículos: placa de residente reconocida con confianza ≥ **0.85** → ingreso permitido. Por debajo o sin coincidencia → el guardia decide y registra manualmente. Formato de placa (Bolivia, desde 1999): **4 dígitos seguidos de 3 letras** (ej. `1234ABC`), en mayúsculas y sin separadores; la letra del departamento impresa arriba a la derecha no forma parte del texto. Una lectura que no cumple el formato no se acepta como placa válida. *(Propuesta del 18/10/2026, pendiente de confirmar con Aldana y Erick.)* Con una cámara en vivo también se **permite** el ingreso si la misma placa registrada se lee, con formato válido y votación entre franjas, en **al menos 3 de los últimos 8 cuadros** (consenso entre cuadros): la confianza de un solo cuadro del OCR rara vez llega a 0.85 (solo 2 de 6 lecturas correctas en las pruebas), y el consenso aporta más evidencia que un cuadro suelto. Una placa no registrada nunca se permite. Como el lector global (modelo preentrenado) lee placas de cualquier formato pero se equivoca a veces por un carácter y su confianza no distingue aciertos de errores, **la placa registrada se compara tal cual contra la lista** (también las de otro formato, extranjeras o antiguas, que se registran explícitamente) y la seguridad sale de exigir varios cuadros coincidentes.
- **A5.** El reconocimiento facial **asiste** al guardia (muestra quién es) pero **nunca abre por sí solo** ni bloquea a nadie.

### 5. Offline e idempotencia

- **O1.** Toda operación creada en una PWA lleva `Idempotency-Key` (UUID v4 generado en el dispositivo) y la hora del dispositivo.
- **O2.** Las operaciones offline van a una cola en IndexedDB y se envían con Background Sync, con reintento exponencial.
- **O3.** El servidor guarda con escritura condicional (`attribute_not_exists(idempotency_key)` en DynamoDB, `UNIQUE` en PostgreSQL). Si la clave existe, responde **lo mismo que la primera vez** (mismo cuerpo y código).
- **O4.** La PWA marca una operación como sincronizada solo al recibir respuesta 2xx.
- **O5.** Datos editables (perfil, reserva) usan número de `version`; el servidor rechaza con 409 una versión vieja.
- **O6.** Offline se permite: registrar ingresos/salidas, validar pases ya descargados, capturar comprobantes. Offline **no** se permite: confirmar pagos, crear reservas.

### 6. IA y datos personales

- **I1.** Solo se reconocen rostros de residentes que dieron **consentimiento** explícito (fecha y versión del texto guardadas). Al retirarlo se borran sus fotos y embeddings en menos de 24 h.
- **I2.** Tres zonas según la similitud coseno con el perfil más parecido, con umbrales calibrados en validación con desconocidos reales (iniciales **alto 0.70** y **bajo 0.50**; documentar los valores finales en `ml/README.md`): ≥ alto = `RECONOCIDO`; entre bajo y alto = `DUDOSO` (se muestra el candidato y **decide el guardia**); < bajo = `DESCONOCIDO`. Solo los `DESCONOCIDO` se guardan para I3/I4; un `DUDOSO` solo queda en la predicción (I5), porque puede ser un residente.
- **I3.** Los embeddings de desconocidos se guardan **30 días** y luego se borran.
- **I4.** DBSCAN corre cada noche sobre los desconocidos de los últimos 30 días (métrica coseno). Un clúster con **≥ 3 apariciones en días distintos** genera una alerta al guardia ("visitante recurrente no registrado"). Cada visitante avisa una sola vez, salvo que se configure el **re-aviso** *(propuesta del 22/10/2026, pendiente de confirmar con Aldana y Erick)*: con `I4_REAVISO_CADA = N` (0 por defecto = nunca) se avisa de nuevo cada vez que el visitante acumula N apariciones más, con un `eventId` por tramo (S5). El mínimo de apariciones y de días y el re-aviso son parámetros (`I4_MIN_APARICIONES`, `I4_MIN_DIAS`, `I4_REAVISO_CADA`); para ensayar la demo se relajan (p. ej. 5 apariciones en 1 día, re-aviso cada 10), pero los valores de la regla son los de arriba.
- **I5.** Toda predicción guarda: modelo, versión, confianza, fecha. Nada de IA se usa sin su confianza.
- **I6.** Datasets, fotos y pesos de modelos **no se suben al repositorio** (usar `.gitignore`, MinIO o Drive del equipo). Solo código, configuración y métricas.

### 7. Agente y reportes por voz

- **G1.** Misión de referencia del agente: "Gestiona la morosidad del mes". El agente consulta morosos, calcula recargos, redacta recordatorios y propone planes de pago.
- **G2.** El agente solo actúa mediante herramientas MCP (`consultar_morosos`, `proponer_recargo`, `enviar_recordatorio`, `crear_reserva`, `registrar_visita`, ...). Cualquier herramienta que **cree cargos o mueva dinero requiere confirmación del `ADMIN`** antes de ejecutarse.
- **G3.** Cada paso del agente queda en su bitácora (MongoDB): herramienta, entrada, salida, quién confirmó.
- **G4.** Reportes por voz: solo `ADMIN`. Audio → Whisper → el LLM arma una consulta GraphQL **de solo lectura** (nunca mutations) → Excel o PDF. Se guarda el texto, la consulta y el archivo generado.
- **G5.** *(Propuesta del 18/10/2026, pendiente de confirmar con Aldana y Erick.)* Agente de monitoreo: **observa y avisa, nunca actúa**. Cada día (o a pedido del `ADMIN`) lee con las herramientas de solo lectura los morosos y los pagos `PENDIENTE`, guarda una lectura de métricas y la compara con el promedio de las últimas 3 lecturas. Genera una **alerta** si: las unidades morosas suben ≥ 20 % (y al menos 2 unidades); la deuda vencida sube ≥ 20 %; o hay ≥ 5 pagos `PENDIENTE` o alguno lleva ≥ 3 días sin conciliar (F8). Es `ALTA` si se supera el doble del umbral. Cada ejecución guarda un **informe** (métricas, alertas y resumen) y, si hay alertas, avisa al `ADMIN` por n8n. Los umbrales son parámetros, no constantes. No crea cargos, ni recargos, ni mueve dinero (F5, G2).

