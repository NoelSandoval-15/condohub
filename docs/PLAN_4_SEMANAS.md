# Plan de 4 semanas — CondoHub

Del **jueves 15 de octubre** al **miércoles 11 de noviembre de 2026**. Tres desarrolladores: Aldana, Erick y Luis. Reglas de negocio en `docs/negocio/reglas-de-negocio.md`; manual del agente en `CLAUDE.md` de la raíz y de cada repo.

## Criterio del reparto

- Cada persona es dueña de módulos completos (backend + su frontend cuando se puede), así se bloquean poco entre sí.
- **Luis** se dedica al Servicio IA: lo más incierto es el entrenamiento, por eso empieza el día 1 con datos y un modelo base, sin esperar a nadie.
- **Aldana** lleva todo lo financiero: Gestión (GraphQL), la consola Angular, el portal del residente (que paga) y el agente de morosidad, que usa sus propias consultas.
- **Erick** lleva la plataforma y la operación: infraestructura, Reservas con la saga, Acceso con DynamoDB y la PWA offline de portería.
- Lo que cruza a dos personas está marcado con 🔗 y tiene fecha de entrega del contrato.

Carga estimada (puntos relativos): Aldana 34 · Erick 35 · Luis 33.

## Hitos

| Fecha | Hito | Se demuestra |
|---|---|---|
| Mié 21 oct | **H1 Esqueleto** | `docker compose up` levanta todo; login SSO con los 3 roles; un endpoint "hola" por servicio detrás del gateway; contratos v1 en `contracts/`; modelo facial base con métricas |
| Mié 28 oct | **H2 Dominio** | Expensas emitidas y estado de cuenta por GraphQL; reserva simple; registro de acceso; reconocimiento facial y de placas por API |
| Mié 4 nov | **H3 Integración** | Saga completa con compensación; pago offline sin duplicados; agente con MCP; IA conectada a portería; reportes por voz |
| Lun 9 nov | **Congelamiento** | Solo correcciones, sin funciones nuevas |
| Mié 11 nov | **H4 Entrega** | Demo guionada, informe, diagramas, video de respaldo |

---

## Fase 1 · Cimientos y contratos (15–21 oct)

Objetivo: que nadie quede bloqueado por otro desde la semana 2.

| Quién | Tareas |
|---|---|
| **Todos** (jue 15) | Reunión de 1 h: leer los `CLAUDE.md`, crear los 10 repos y el espacio de trabajo, proteger `main` en cada uno, tablero de tareas. Acordar contratos 🔗 |
| **Todos** (vie 16) | Sesión DDD de 1,5 h (event storming): validar subdominios, mapa de contextos, agregados y eventos de `docs/arquitectura/ddd.md`; dibujar el mapa de contextos para el informe en `docs/` |
| **Erick** | `infra/docker-compose.yml` con PostgreSQL, MongoDB, DynamoDB Local, RabbitMQ, Keycloak, MinIO, n8n y gateway · Realm `condohub` con roles `ADMIN`, `RESIDENTE`, `GUARDIA` y 3 usuarios de prueba · Esqueletos Laravel (Reservas) y Next.js (Acceso) en Clean con validación JWT · Shell React con login OIDC y Module Federation vacío · `contracts/events/` con el sobre común y los eventos de la saga 🔗 |
| **Aldana** | Esqueleto Spring Boot en Hexagonal (módulos `domain`, `application`, `adapters`) · `contracts/schema.graphql` v1: Unidad, Propietario, Expensa, Cargo, Pago, estadoDeCuenta, morosos 🔗 · Modelo de datos PostgreSQL y migraciones Flyway · Esqueleto Angular con login vía shell |
| **Luis** | Esqueleto FastAPI del Servicio IA · Datasets: público para evaluar (LFW o subconjunto de VGGFace2) + fotos propias con consentimiento del equipo y amigos (≥ 10 personas, ≥ 15 fotos c/u) · Pipeline: detección (MTCNN) → alineación → embedding con FaceNet preentrenado (`facenet-pytorch`) · **Línea base**: k-NN/SVM sobre embeddings, accuracy y curva ROC en `ml/README.md` · Dataset público de placas para YOLO · `contracts/openapi/ia.yaml` v1 🔗 |

Riesgo de la fase: Keycloak + gateway suele tomar más de lo previsto. Si el viernes 16 no está, Erick avisa y Aldana valida JWT con un token fijo mientras tanto.

## Fase 2 · Núcleo de dominio (22–28 oct)

Objetivo: cada servicio cumple sus reglas por sí solo, con tests.

| Quién | Tareas |
|---|---|
| **Aldana** | Reglas F1–F7 y F10 en el dominio con tests · Queries `estadoDeCuenta`, `morosos`; mutations `emitirExpensas`, `registrarPago`, `confirmarPago`, `proponerRecargo`, `confirmarRecargo` · Outbox + publicación de `CargoAplicado` · Consumidor idempotente de "aplicar cargos de reserva" (paso 2 de la saga) 🔗 Erick · Consola Angular: unidades, expensas, conciliación de pagos |
| **Erick** | Reservas: reglas R1–R8, restricción anti-solapamiento en BD, consulta de morosidad a Gestión (R4) 🔗 Aldana · Acceso: visitas, pases QR (A1–A3), registros append-only en DynamoDB con escritura condicional (O3) · Endpoint de sincronización con `Idempotency-Key` |
| **Luis** | **Entrenamiento facial**: fine-tuning de la cabeza de FaceNet con triplet loss sobre el dataset propio; comparar contra la línea base (accuracy, FAR/FRR, matriz de confusión); calibrar el umbral (I2) · **Placas**: fine-tuning de YOLOv8n + OCR (EasyOCR o PaddleOCR); medir precisión por carácter · Endpoints `/rostros/identificar`, `/rostros/registrar`, `/placas/leer` con modelo, versión y confianza (I5) · Guardar embeddings y resultados en MongoDB |

## Fase 3 · Integración (29 oct – 4 nov)

Objetivo: los requisitos transversales funcionando de punta a punta. Es la semana más cargada; las tareas marcadas 🔗 tienen prioridad sobre las individuales.

| Quién | Tareas |
|---|---|
| **Erick** | **Saga** de reserva del salón: orquestador con estado persistido (S1), reintentos y compensaciones en orden inverso (S2–S3), Outbox (S4) · Paso 3: emitir y revocar pases · App de portería PWA: cola IndexedDB, Background Sync, validación de QR offline (O1–O6) · Integrar modelo de placas ONNX en el navegador 🔗 Luis · Capa anticorrupción Acceso ↔ IA 🔗 Luis |
| **Aldana** | Portal del residente PWA: estado de cuenta, reservas, visitas, **OCR local con Tesseract.js** del comprobante y envío offline idempotente (F8–F9) · Servicio de Agentes: misión de morosidad (G1–G3) con servidor MCP sobre GraphQL, Reservas y Acceso; confirmación del `ADMIN` en la consola antes de aplicar cargos · Pantalla "sagas que requieren revisión" en la consola |
| **Luis** | **DBSCAN** sobre embeddings de desconocidos (I3–I4): ajustar `eps` y `min_samples` con gráfico k-distance, medir silhouette; job nocturno y alerta al guardia · Exportar modelo de placas a **ONNX** cuantizado para la PWA 🔗 Erick · **CNN de lectura de placas en TensorFlow/Keras** exportada a TFLite y probada en el navegador (requisito E.4: Deep Learning con TensorFlow sobre imágenes) · Reportes por voz: Whisper → LLM → GraphQL de solo lectura → Excel (openpyxl) y PDF (G4) 🔗 Aldana para el esquema · Flujos n8n: recordatorio de cuotas vencidas, comprobante recibido → conciliación → recibo, alerta de cámara al guardia, informe mensual |

## Fase 4 · Endurecimiento y entrega (5–11 nov)

| Quién | Tareas |
|---|---|
| **Todos** | Jue 5: ensayo completo de la demo y lista de fallos · Corregir solo lo que rompe la demo · Lun 9: congelamiento |
| **Erick** | Prueba de caos de la saga (apagar Acceso a mitad y mostrar la compensación) · Prueba offline (modo avión, reconexión, sin duplicados) · Datos semilla de 200 unidades · Diagrama de despliegue |
| **Aldana** | Tests de reglas F/R pendientes · Pulido de consola y portal · Sección del informe: DDD, Hexagonal, GraphQL, agente y MCP |
| **Luis** | Informe de ML: datasets, arquitectura, entrenamiento, métricas antes/después, umbral elegido, consentimiento y retención (I1, I3) · Demo de reconocimiento en vivo con cámara · Sección del informe: IA, n8n y reportes por voz |
| **Todos** (mar 10) | Grabar video de respaldo de la demo · Revisar que cada requisito del enunciado tenga su evidencia |

## Guion de la demo (para ensayar desde el 5 nov)

1. El administrador entra por SSO y pasa a la consola sin volver a loguearse.
2. Emite expensas de noviembre; un residente ve su estado de cuenta (GraphQL).
3. El residente, en modo avión, fotografía su comprobante: el OCR llena los datos, queda pendiente; al volver la red se envía una sola vez aunque se reintente. n8n concilia y envía el recibo.
4. El residente reserva el salón: saga exitosa. Luego se apaga Acceso y se repite: se ve la compensación.
5. El guardia, offline, lee una placa en el dispositivo y registra el ingreso; al reconectar, sincroniza sin duplicados.
6. La cámara reconoce a un residente y marca a un desconocido; se muestra el clúster de un visitante recurrente.
7. El administrador lanza al agente "Gestiona la morosidad del mes"; el agente propone recargos y espera su confirmación.
8. El administrador pide por voz "morosidad por bloque del último trimestre en Excel" y descarga el archivo.

## Rutina del equipo

- Daily de 15 min por chat a una hora fija: qué hice, qué haré, qué me bloquea.
- Revisión de PR en menos de 24 h; si un 🔗 se retrasa, el dueño avisa ese mismo día.
- Cada miércoles (hito), 30 min de integración juntos sobre `main`.

## Plan B por si falta tiempo

Se recorta en este orden, sin dejar ningún requisito sin evidencia: (1) churrasqueras y piscina, queda solo el salón; (2) el informe mensual de n8n; (3) el PDF de reportes, queda solo Excel; (4) fine-tuning de placas, se usa YOLO preentrenado + OCR. El entrenamiento facial con métricas, DBSCAN, la saga y el offline idempotente **no se recortan**.
