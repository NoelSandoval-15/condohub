# CLAUDE.md

Manual de trabajo para el agente de código en el **espacio de trabajo de CondoHub**: la carpeta raíz que reúne todos los repositorios del sistema para que el agente vea el conjunto completo (contratos, reglas y el código de todos los servicios) y pueda implementar con precisión. Este archivo contiene lo que aplica a todo el sistema. Cada repositorio tiene su propio `CLAUDE.md` autosuficiente con su arquitectura interna, comandos y las reglas que le tocan; léelo antes de tocar esa carpeta.

## Espacio de trabajo y repositorios

Cada carpeta de servicio y de frontend es **un repositorio git independiente**, con su propio historial, CI y despliegue. La raíz es el repositorio `condohub` (este `CLAUDE.md`, `docs/`, `contracts/` e `infra/`), que ignora en su `.gitignore` las carpetas de los demás repos.

| Carpeta | Repositorio |
|---|---|
| `.` (raíz: `docs/`, `contracts/`, `infra/`) | `condohub` |
| `services/gestion` | `condohub-gestion` |
| `services/reservas` | `condohub-reservas` |
| `services/acceso` | `condohub-acceso` |
| `services/ia` (incluye `ml/`) | `condohub-ia` |
| `services/agentes` | `condohub-agentes` |
| `frontends/shell` | `condohub-shell` |
| `frontends/admin` | `condohub-admin` |
| `frontends/residente` | `condohub-residente` |
| `frontends/guardia` | `condohub-guardia` |

Montar el espacio de trabajo: clonar `condohub` y luego cada repo en su carpeta (`git clone <url>/condohub-gestion services/gestion`, etc.).

Consecuencias para el agente:
- **Un commit y un PR por repositorio.** Si una tarea toca varios servicios, haz un cambio por repo, empezando por `condohub` (contratos), y lista en el resumen los PRs en orden de merge.
- Ejecuta `git` **dentro** de la carpeta del repo que cambias, nunca en la raíz para código de un servicio.
- Ningún repo importa código de otro por ruta relativa (`../../`). Lo único compartido son los contratos de `contracts/`, que cada servicio copia o genera en su build.
- Si trabajas con un repo abierto solo (sin la raíz), su `CLAUDE.md` basta; ante la duda sobre una regla o un contrato, pide ver `condohub`.

@docs/negocio/reglas-de-negocio.md
@docs/arquitectura/ddd.md

## Proyecto

Plataforma de gestión de un condominio horizontal (~200 unidades): expensas y pagos, reservas de áreas comunes, control de acceso en portería, visión artificial y reportes por voz. Proyecto universitario (Software 2, segundo parcial) con entrega el **11/11/2026**. Equipo: Aldana, Erick y Luis.

**Principio rector: el sistema más pequeño que cumpla todos los requisitos.** Antes de crear un servicio, endpoint, tabla, librería o pantalla, comprueba que lo exige un requisito o una regla de `docs/negocio/reglas-de-negocio.md`. Si no, no lo hagas y pregunta.

Actores: solo `ADMIN`, `RESIDENTE` y `GUARDIA` (roles del realm `condohub` en Keycloak). No agregues roles, módulos de mantenimiento ni flujos de aprobación de gastos.

## Mapa del espacio de trabajo

```
.
├── CLAUDE.md                  # este archivo (repo condohub)
├── contracts/                 # FUENTE DE VERDAD de las interfaces entre servicios (ver contracts/CLAUDE.md)
│   ├── graphql/schema.graphql # API de Gestión (único GraphQL del sistema)
│   ├── openapi/               # reservas.yaml, acceso.yaml, ia.yaml, agentes.yaml
│   └── events/                # JSON Schema de cada evento de dominio + sobre común
├── services/                  # microservicios de negocio; cada uno con su BD exclusiva
│   ├── gestion/               # Spring Boot 3 · Java 21 · PostgreSQL · GraphQL · Hexagonal   (Aldana)
│   ├── reservas/              # Laravel 12 · PHP 8.2+ · PostgreSQL · REST · Clean · orquestador saga (Erick)
│   ├── acceso/                # Next.js 14 · TypeScript · DynamoDB · REST · Clean · sync offline (Erick)
│   ├── ia/                    # FastAPI · Python 3.11 · PyTorch + TensorFlow/Keras · Whisper · MongoDB + MinIO · Clean (Luis)
│   └── agentes/               # Python 3.11 · MongoDB · REST + servidor MCP · Clean           (Aldana)
├── frontends/                 # micro frontends con Module Federation; cada uno es su propio repo
│   ├── shell/                 # React + Vite · login OIDC y host de remotos                  (Erick)
│   ├── admin/                 # Angular 18 · consola del ADMIN                                (Aldana)
│   ├── residente/             # React PWA · OCR local de comprobantes · offline               (Aldana)
│   └── guardia/               # React PWA · lectura de placas ONNX en el dispositivo · offline (Erick)
│                              # (ml/ vive dentro de services/ia: entrenamiento de rostros, placas, DBSCAN)
├── infra/                     # docker-compose, Keycloak realm, gateway, RabbitMQ, n8n flows (Erick)
└── docs/
    ├── negocio/reglas-de-negocio.md   # lenguaje ubicuo + reglas con código (F, R, S, A, O, I, G)
    ├── arquitectura/ddd.md            # subdominios, mapa de contextos, agregados, eventos
    ├── datos/modelo-de-datos.md       # bases por servicio, diagramas y qué regla protege cada restricción
    ├── adr/                           # decisiones de arquitectura (NNNN-titulo.md)
    └── PLAN_4_SEMANAS.md              # fases, tareas y responsables
```

## Arquitectura: reglas no negociables

1. **DDD manda en los cortes**: un contexto delimitado = un microservicio = una base de datos. Ningún servicio lee ni escribe la base de otro. Un dato ajeno se obtiene por API o por evento.
2. **Arquitectura interna**: Gestión usa **Hexagonal** (puertos y adaptadores); los demás servicios usan **Clean**. En ambos casos, el dominio no importa frameworks, ORM, HTTP ni SDKs de nube. Las dependencias apuntan siempre hacia el dominio.
3. **GraphQL solo en Gestión.** Todo lo demás es REST documentado en OpenAPI 3.
4. **Comunicación asíncrona** por RabbitMQ (exchange `condohub.events`, topic, routing key `<contexto>.<Evento>`), siempre con patrón **Outbox** y consumidores **idempotentes** (guardan `eventId`).
5. **Transacciones entre servicios = saga orquestada** desde Reservas, con compensación por paso. Nunca transacciones distribuidas (2PC) ni llamadas síncronas encadenadas para escribir en varios servicios.
6. **Seguridad**: todo endpoint valida el JWT de Keycloak y autoriza por rol del token. No hay usuarios ni contraseñas propias en ningún servicio.
7. **Idempotencia**: toda escritura que pueda venir de una PWA acepta el header `Idempotency-Key` (UUID v4) y ante un repetido devuelve la misma respuesta que la primera vez.
8. **Dinero** nunca en `float`/`double`: `BigDecimal`, `NUMERIC(12,2)`, string decimal en JSON. Fechas en UTC.

## Regla de oro: no reescribir código que funciona

Código **funcional** = código que ya está en `main` con sus tests en verde. Ese código está protegido:

1. **No se reescribe, refactoriza, renombra, reordena ni reformatea** si la tarea no lo pide de forma explícita. "Ya que estoy" no es motivo: ni limpiezas, ni cambios de estilo, ni "mejoras" no solicitadas.
2. **Se extiende, no se modifica.** Lo nuevo va en clases, métodos, archivos o casos de uso nuevos que usan lo existente. Ejemplo: una regla nueva de reservas es un validador nuevo que se suma, no una reescritura de `SolicitarReserva`.
3. **Si es inevitable tocar código funcional** (un bug real, una regla de negocio que cambió, un contrato que lo exige), el agente **se detiene antes de editar** y explica: qué archivo y qué líneas, por qué no basta con extender y qué tests lo cubren. Solo continúa con la confirmación del desarrollador, y el cambio es el **mínimo diff** posible.
4. **Los tests existentes no se modifican para que pase código nuevo.** Si un test existente falla, el que está mal es el código nuevo, salvo que la regla de negocio haya cambiado en `docs/negocio/reglas-de-negocio.md` en el mismo PR.
5. **Antes y después**: correr los tests del servicio antes de empezar (línea base) y al terminar. Todos los que pasaban deben seguir pasando.
6. **Interfaces públicas congeladas**: endpoints, queries/mutations GraphQL, eventos y firmas usadas por otro módulo no cambian de forma incompatible (ver `contracts/CLAUDE.md`).
7. En el resumen final, el agente lista **cada archivo existente que modificó** y por qué.

Desde el congelamiento (09/11/2026) la regla es más estricta: solo se toca código funcional para corregir un fallo que rompe la demo.

## Cómo trabajar (flujo del agente)

Sigue este orden en toda tarea que cambie código:

1. **Ubica**: identifica el servicio y el contexto afectados y lee su `CLAUDE.md`. Busca las reglas implicadas por código (ej. `R4`) en `docs/negocio/reglas-de-negocio.md`.
2. **Contrato primero**: si la tarea cambia una interfaz entre servicios (GraphQL, OpenAPI, evento), modifica `contracts/` antes que el código y avísalo en el resumen: otro integrante consume ese contrato.
3. **Planifica** en pocas líneas qué archivos tocarás por capa (dominio → aplicación → adaptadores). Si la tarea toca más de un servicio, divídela en un cambio por repositorio.
4. **Test primero en el dominio**: escribe el test de la regla con su código en el nombre (`R4_unidad_morosa_no_puede_reservar`), luego la implementación.
5. **Implementa** de adentro hacia afuera: entidades y objetos de valor → casos de uso → adaptadores (BD, HTTP, mensajería).
6. **Verifica**: corre los tests y el lint del servicio (comandos en su `CLAUDE.md`). No declares la tarea terminada si algo falla; reporta la salida.
7. **Resume**: qué cambiaste, qué reglas cubre, qué contratos tocaste y qué quedó pendiente.

Cuando falte información:
- Si falta una regla de negocio, **no la inventes**: deja `TODO(regla): <pregunta>` y menciónalo en el resumen.
- Si dos reglas chocan o la tarea contradice este archivo, detente y pregunta.
- Si un cambio pertenece al módulo de otra persona (ver responsables), hazlo mínimo y señálalo para su revisión.

## Comandos globales

```bash
cp .env.example infra/.env                              # primera vez (Compose lee infra/.env)
docker compose -f infra/docker-compose.yml up -d       # toda la infraestructura
docker compose -f infra/docker-compose.yml ps          # estado
docker compose -f infra/docker-compose.yml logs -f <servicio>
docker compose -f infra/docker-compose.yml down        # apagar (agrega -v solo si quieres borrar datos)
```

Puertos locales:

| Componente | Puerto | Componente | Puerto |
|---|---|---|---|
| Gateway | 8080 | Shell | 5173 |
| Keycloak | 8180 | Consola admin | 4200 |
| Gestión | 8081 | Portal residente | 5174 |
| Reservas | 8082 | App guardia | 5175 |
| Acceso | 3001 | PostgreSQL | 5432 |
| Servicio IA | 8083 | MongoDB | 27017 |
| Agentes | 8084 | DynamoDB Local | 8000 |
| n8n | 5678 | RabbitMQ / panel | 5672 / 15672 |
| Almacén S3 / panel | 9000 / 9333 | | |

Usuarios de prueba (realm `condohub`): `admin@condohub.test`, `residente@condohub.test`, `guardia@condohub.test`. Contraseñas en `.env.example`, solo para desarrollo.

## Convenciones

- **Idioma**: conceptos de dominio en español y tal cual el lenguaje ubicuo (`Unidad`, `Expensa`, `reserva.confirmar()`); infraestructura técnica en inglés (`Repository`, `Controller`, `Adapter`, `Config`). Comentarios, commits, PRs y documentación en español.
- **Ramas**: `main` protegida. `feat/<servicio>-<tema>`, `fix/<servicio>-<tema>`, `docs/<tema>`.
- **Commits**: Conventional Commits con alcance = servicio. `feat(reservas): bloquear horario al iniciar saga (R2, S1)`.
- **PR**: pequeño, de un solo servicio cuando se pueda, revisado por otro integrante. La descripción lista las reglas cubiertas y los contratos tocados.
- **Tests**: el dominio se prueba sin infraestructura. Cada regla de `reglas-de-negocio.md` tiene al menos un test con su código en el nombre. Integración con Testcontainers o el Compose de `infra/`.
- **Errores HTTP**: formato RFC 7807 (`application/problem+json`) con `code` = código de regla violada cuando aplique (ej. `"code": "R3"`).
- **Logs**: JSON estructurado con `traceId`, `sagaId` cuando exista, y nunca datos sensibles (tokens, comprobantes, embeddings, fotos).
- **Configuración**: variables de entorno; parámetros de negocio (porcentaje de recargo, día de vencimiento, umbrales de IA) en configuración o tabla de parámetros, nunca hardcodeados.
- **Decisiones**: una decisión de arquitectura nueva se registra como ADR en `docs/adr/`.

## Definición de terminado

- [ ] Contrato en `contracts/` actualizado si cambió una interfaz.
- [ ] Tests de dominio de las reglas afectadas, en verde.
- [ ] Todos los tests que ya pasaban siguen pasando, sin haberlos editado.
- [ ] Ningún archivo funcional modificado sin confirmación; los modificados, listados en el resumen.
- [ ] Lint y build del servicio en verde.
- [ ] Probado contra el Compose de `infra/` (al menos el camino feliz).
- [ ] `README.md` del servicio al día si cambió cómo se corre o se configura.
- [ ] Si cambió una regla de negocio: actualizada primero en `docs/negocio/reglas-de-negocio.md`, en el mismo PR.

## Nunca

- Reescribir, refactorizar o reformatear código funcional sin que la tarea lo pida (ver "Regla de oro").
- Editar tests existentes para que pase código nuevo.
- Compartir base de datos entre servicios o crear una "librería de modelos compartida" con entidades de dominio.
- Poner lógica de negocio en controladores, resolvers, repositorios o componentes de UI.
- Aplicar cargos o recargos sin confirmación del `ADMIN` (reglas F5 y G2), ni confirmar pagos offline (F9).
- Editar o borrar registros de acceso o cargos (A3, F6): se corrigen con un registro nuevo.
- Subir secretos, `.env`, datasets, fotos de personas ni pesos de modelos. Usa `.gitignore`, MinIO o el Drive del equipo.
- Desactivar o saltar tests para ponerse en verde.
- Agregar dependencias pesadas sin justificarlo en el resumen; prefiere la librería estándar o lo que el servicio ya usa.

## Responsables

| Área | Responsable |
|---|---|
| `services/gestion`, `services/agentes`, `frontends/admin`, `frontends/residente`, `contracts/graphql` | Aldana |
| `infra/`, `services/reservas`, `services/acceso`, `frontends/shell`, `frontends/guardia`, `contracts/events` | Erick |
| `services/ia` (con `ml/`), `infra/n8n`, `contracts/openapi/ia.yaml` | Luis |

Plan, fases e hitos: `docs/PLAN_4_SEMANAS.md`.
