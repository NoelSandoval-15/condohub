# Guía de arranque del equipo — CondoHub

Estado real de la base sobre la que se construye (14/10/2026) y cómo continuar. Las reglas siguen en `CLAUDE.md` y `docs/negocio/reglas-de-negocio.md`; el plan en `docs/PLAN_4_SEMANAS.md`.

## 1. Qué está listo y verificado

| Pieza | Qué hay | Verificado |
|---|---|---|
| Keycloak | Realm `condohub`, roles `ADMIN`/`RESIDENTE`/`GUARDIA`, 3 usuarios de prueba, clientes `condohub-spa` (PKCE) y `condohub-servicios` | Tokens de los 3 usuarios; login por código + PKCE |
| Gateway (Kong) | Valida el JWT y enruta `/gestion`, `/reservas`, `/acceso`, `/ia`, `/agentes`; CORS | 401 sin token, 200 con token, reenvío de `Authorization` |
| RabbitMQ | Exchange `condohub.events`, colas de la saga y n8n, DLQ (nombres en `infra/CLAUDE.md`) | Ruteo de un evento de prueba |
| n8n | En el compose, con su base en Postgres | `healthz` |
| Contratos | `events/` (sobre + 13 eventos), `openapi/` (`ia`, `agentes`, `reservas`, `acceso`), `graphql/schema.graphql` (v1 mínima) | Esquemas compilados y probados con mensajes válidos e inválidos; lint de OpenAPI |
| Gestión | Spring Boot + Hexagonal; `salud`, `estadoDeCuenta` (F1), `pagosPendientes` | 22 tests, ArchUnit, Testcontainers; probado por el gateway |
| IA | FastAPI + Clean; endpoints de `ia.yaml` protegidos por rol (501 hasta tener lógica) | 38 tests, ruff, mypy; probado por el gateway |
| Acceso | Next.js + Clean; endpoints protegidos por rol (501) | 35 tests, lint, build; probado por el gateway |
| Agentes | FastAPI + Clean; misiones y confirmaciones solo para ADMIN (501 hasta tener lógica) | 26 tests, ruff, mypy; probado por el gateway |
| Reservas | Laravel 12 + Clean; endpoints protegidos por rol (501); esquema SQL existente migrado y sus pruebas de BD en verde | 31 tests (Pest), PHPStan nivel 8, Pint; probado por el gateway |
| Shell | React + Vite; login OIDC real, menú por rol, host de remotos | 13 tests, build; flujo PKCE probado |

**Todavía no existe:** frontends `admin`, `residente` y `guardia`, el servidor MCP y el LLM de Agentes, flujos de n8n, y cualquier lógica de negocio más allá de lo de la tabla. Los esqueletos responden `501 NO_IMPLEMENTADO` en lo que falta.

## 2. Levantar todo

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres keycloak rabbitmq gateway n8n
```

Si un puerto ya está ocupado en tu máquina (5432 con un PostgreSQL local, 8080 con otro programa), no lo apagues: usa `POSTGRES_PORT=5433` y/o `GATEWAY_PORT=8090` (ver `infra/CLAUDE.md`). Cada servicio se corre desde su carpeta (comandos y estado en su `CLAUDE.md`). Los servicios corren en el host y el gateway los alcanza por `host.docker.internal`.

Para comprobar en 30 s que puedes loguearte y llegar a cada servicio: `node infra/humo.mjs` (usa `GATEWAY_PORT` si cambiaste el puerto). Muestra una tabla servicio × rol y marca «no levantado» lo que aún no arrancaste.

Un token para probar a mano:

```bash
curl -s -X POST http://localhost:8180/realms/condohub/protocol/openid-connect/token \
  -d grant_type=password -d client_id=condohub-spa \
  -d username=residente@condohub.test -d 'password=Condohub123!' | jq -r .access_token
```

## 3. El patrón de seguridad (igual en todos los servicios)

1. **Autenticar**: validar el JWT (firma RS256 con el JWKS del realm, `exp`, `iss`). Sin token o inválido → `401` con `application/problem+json`.
2. **Autorizar por rol**: los roles están en `realm_access.roles`. Cada endpoint declara qué roles lo usan; rol no permitido → `403`.
3. **Autorizar por dato** cuando la regla lo pide (ejemplo F1: un residente solo ve su unidad). Va en el **dominio**, no en el controlador. El vínculo usuario → persona es `persona.keycloak_sub` en Gestión.
4. Si Keycloak no responde → `503`, no un `401` engañoso.

Dónde mirarlo implementado, para copiarlo en el stack que toque:

| Stack | Archivos |
|---|---|
| Spring Boot (Gestión) | `adapter/config/SeguridadConfig.java`, `domain/service/PoliticaVisibilidad.java`, `adapter/in/graphql/FinanzasQueryController.java` |
| FastAPI (IA) | `app/infrastructure/keycloak.py`, `app/api/seguridad.py` (`requiere_rol`), `app/api/problemas.py` |
| Next.js (Acceso) | `src/infrastructure/keycloak/jose-verificador.ts`, `src/infrastructure/http/proteger.ts` |
| React (Shell) | `src/auth/AuthProvider.tsx`, `src/auth/RutaProtegida.tsx` (solo UI: no es seguridad) |
| Laravel (Reservas) | `src/Infrastructure/Security/KeycloakJwtVerificador.php`, `src/Infrastructure/Http/Middleware/ProtegerConJwt.php` (`jwt:RESIDENTE,ADMIN` en `routes/api.php`) |

Cada esqueleto trae una **matriz rol × endpoint** en sus tests; cuando agregues un endpoint, agrega su fila.

## 4. Siguiente paso de cada quien

**Erick**
1. Reservas (Laravel 12, ya con login y roles): R1–R8 con test de dominio por regla (`it('R3 ...')`), apoyándote en la restricción `EXCLUDE` que ya existe en `database/sql`. Confirmar el ADR de Laravel 12.
2. `contracts/events/`: revisar los 13 eventos propuestos (nombres y campos) **antes** de escribir productores y consumidores; confirmar las colas de `infra/rabbitmq/definitions.json`.
3. Contratos `contracts/openapi/reservas.yaml` y `acceso.yaml` (v1 propuesta, con roles y esquemas): revisarlos y ajustarlos **antes** de implementar; luego A1–A3 con DynamoDB. Resolver el `TODO(regla)` de `pases/validar` (¿consume el uso del pase?).
4. Shell: cargar remotos reales cuando existan; renovación silenciosa del token.

**Aldana**
1. Gestión: ampliar `schema.graphql` (Unidad, Expensa, Cargo, `morosos`, mutations) y la rebanada `estadoDeCuenta` → resto de F1–F10. Outbox y consumidores de la saga (`finanzas.reservas`).
2. Frontends `admin` (Angular) y `residente` (React PWA): contra el shell, que pasa `getToken` y `user` a `mount()`.
3. Agentes: revisar `contracts/openapi/agentes.yaml` (v1 propuesta) y construir el servidor MCP, el LLM y MongoDB sobre el esqueleto.

**Luis**
1. IA Fase 1: pipeline MTCNN → FaceNet, línea base con métricas, datasets con consentimiento. Instalar PyTorch (no está aún).
2. Flujos de n8n (el compose ya los espera en `infra/n8n/flows/`).
3. Quitar el `501` de cada endpoint de IA al implementarlo y actualizar `ia.yaml` si cambia algo.

## 5. Decisiones abiertas (alguien tiene que cerrarlas)

| Tema | Detalle | Quién |
|---|---|---|
| Laravel 12 (cerrada, a confirmar) | Composer bloquea todas las versiones de Laravel 11 por avisos de seguridad. Se usó Laravel 12 (PHP 8.2+), registrado en `docs/adr/0001-laravel-12.md`. Erick debe confirmar el ADR | Erick |
| Eventos | Los 13 esquemas de `contracts/events/` son una primera propuesta derivada de las reglas | Erick y Aldana |
| Cola de pases | La saga usa los comandos `reservas.EmitirPasesReserva`/`RevocarPasesReserva` según `services/reservas/CLAUDE.md`; confirmar | Erick |
| `TODO(regla)` IA | Cómo enlazar `sub` del token con `residenteId` para que el RESIDENTE solo retire **su** consentimiento (I1) | Luis y Aldana |
| Clave de firma | El realm usa una clave RSA fija **de desarrollo** (está en el repo, a propósito, para que el gateway valide siempre). No usar fuera de desarrollo | todos |
| Almacén S3 (cerrada, a confirmar) | La imagen de MinIO ya no se puede descargar, así que el servicio `minio` del compose es ahora **SeaweedFS** con API S3 (`docs/adr/0002-almacen-s3.md`). Verificado: subir/bajar archivos y rechazo de credenciales falsas. Faltan por probar las URLs firmadas. Erick debe confirmar el ADR | Erick |
| Git | Nada está commiteado: el espacio de trabajo aún no es un repo. Crear los 10 repos (tarea del jueves 15 del plan) | todos |

## 6. Convenciones que ya se aplican

Contrato primero; test de dominio con el código de la regla en el nombre (`F1_residente_no_ve_otra_unidad`); errores `application/problem+json` con `code`; dinero como string decimal; el dominio no importa frameworks (lo verifican ArchUnit, ESLint `no-restricted-imports` y un test de dependencias). No reescribir código funcional: se extiende.