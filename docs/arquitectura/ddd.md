# Arquitectura DDD — CondoHub

Cómo se corta el sistema y cómo se modela cada dominio. Los códigos de regla (F1, R2...) están en [reglas-de-negocio.md](../negocio/reglas-de-negocio.md).

## Dominio y subdominios

| Subdominio | Tipo | Contexto delimitado | Microservicio |
|---|---|---|---|
| Finanzas del condominio (expensas, cargos, pagos, morosidad) | Núcleo | Finanzas | Gestión empresarial |
| Reservas de áreas comunes | Núcleo | Reservas | Reservas |
| Control de acceso en portería | Núcleo | Acceso | Acceso y portería |
| Visión y reportes | Soporte | IA | Servicio IA |
| Automatización de la gestión | Soporte | Agentes | Agentes |
| Identidad y SSO | Genérico | (se compra: Keycloak) | — |
| Notificaciones | Genérico | (n8n + proveedor) | — |

Regla: **un contexto delimitado = un microservicio = una base de datos**. El mismo concepto puede significar cosas distintas en cada contexto (una "Unidad" en Finanzas tiene alícuota y saldo; en Acceso solo es un destino de visita con su número), y eso está bien: no se comparte un modelo común entre servicios.

## Mapa de contextos

| Relación | Tipo | Cómo se implementa |
|---|---|---|
| Reservas → Finanzas | Cliente/Proveedor | Reservas consulta morosidad (R4) y pide cargos vía eventos de la saga; Finanzas publica el contrato GraphQL/eventos |
| Reservas → Acceso | Cliente/Proveedor | Reservas pide emitir/revocar pases vía eventos |
| Acceso → IA | **Capa anticorrupción** (ACL) | Acceso traduce `{embedding, score, model}` de IA a conceptos propios (`ResidenteIdentificado`, `Desconocido`, `PlacaLeida`) |
| Agentes → Finanzas, Reservas, Acceso | Conformista vía MCP | Las herramientas MCP usan los contratos tal como los publican los servicios |
| Todos → Identidad | Conformista | Se usa el token y los roles de Keycloak sin traducir |

**Agregados por contexto** (la raíz es la única entrada; las invariantes se cumplen dentro de una transacción del agregado)

| Contexto | Agregado (raíz) | Contiene | Invariantes que protege |
|---|---|---|---|
| Finanzas | `Unidad` | alícuota, propietario titular, residentes | F1, F2 |
| Finanzas | `CuentaUnidad` | cargos, pagos imputados, saldo a favor | F4–F7, F9 |
| Finanzas | `PeriodoExpensas` | presupuesto mensual, expensas emitidas | F3 |
| Finanzas | `Pago` | comprobante, estado, motivo de rechazo | F8 |
| Reservas | `Reserva` | área, bloque horario, invitados, cargos asociados | R2, R3, R5–R8 |
| Reservas | `AreaComun` | aforo, horario, tarifas | R1 |
| Reservas | `SagaReserva` | pasos, estado, compensaciones | S1–S3 |
| Acceso | `Visita` | pases QR | A1, A2 |
| Acceso | `RegistroAcceso` | tipo, hora, placa/rostro, `idempotency_key` | A3, O3 |
| IA | `PerfilFacial` | consentimiento, embeddings | I1, I2 |
| IA | `ClusterDesconocidos` | apariciones | I3, I4 |
| Agentes | `Mision` | pasos, herramientas usadas, confirmaciones | G1–G3 |
| Agentes | `InformeMonitoreo` | métricas de una lectura, alertas, resumen | G5 |

Entre agregados se referencia **solo por id** (`unidadId`), nunca por objeto. Un caso de uso modifica **un agregado por transacción**; si necesita tocar más, usa eventos de dominio (y la saga si cruza servicios).

**Objetos de valor** (inmutables, se comparan por valor, validan al construirse): `Dinero` (monto + moneda, nunca negativo salvo en notas de crédito), `Alicuota`, `Periodo` (año-mes), `BloqueHorario` (inicio, fin; detecta solapamiento), `Placa`, `CodigoQR`, `IdempotencyKey`, `Confianza` (0..1).

**Eventos de dominio** (en pasado; se publican con Outbox): `ExpensasEmitidas`, `CargoAplicado`, `CargoAnulado`, `PagoRegistrado`, `PagoConfirmado`, `PagoRechazado`, `RecargoPropuesto`, `RecargoConfirmado`, `ReservaSolicitada`, `ReservaConfirmada`, `ReservaFallida`, `ReservaCancelada`, `PaseEmitido`, `PaseRevocado`, `AccesoRegistrado`, `ResidenteIdentificado`, `DesconocidoDetectado`, `VisitanteRecurrenteDetectado`.

**Servicios de dominio** (lógica que no pertenece a un solo agregado): `CalculadoraExpensas` (F3), `ImputadorPagos` (F7), `CalculadoraRecargos` (F5), `VerificadorDisponibilidad` (R2).

## Reglas de código DDD
- La lógica de negocio vive en entidades, objetos de valor y servicios de dominio, nunca en controladores, resolvers GraphQL ni repositorios.
- Prohibido el modelo anémico: nada de `setEstado(...)` público; se usan métodos con intención (`reserva.confirmar()`, `pago.rechazar(motivo)`).
- Un repositorio por agregado raíz, definido como interfaz (puerto) en el dominio.
- El nombre de clases, métodos y eventos sale del lenguaje ubicuo ([lenguaje ubicuo](../negocio/reglas-de-negocio.md#lenguaje-ubicuo)); si aparece un término nuevo, se agrega primero ahí.

