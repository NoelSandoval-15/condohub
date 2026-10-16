# Guía de arranque del equipo — CondoHub

Estado real de la base sobre la que se construye (15/10/2026) y cómo continuar. Las reglas siguen en `CLAUDE.md` y `docs/negocio/reglas-de-negocio.md`; el plan en `docs/PLAN_4_SEMANAS.md`.

## 1. Qué está listo y verificado

| Pieza | Qué hay | Verificado |
|---|---|---|
| Keycloak | Realm `condohub`, roles `ADMIN`/`RESIDENTE`/`GUARDIA`, 3 usuarios de prueba, clientes `condohub-spa` (PKCE) y `condohub-servicios` | Tokens de los 3 usuarios; login por código + PKCE |
| Gateway (Kong) | Valida el JWT y enruta `/gestion`, `/reservas`, `/acceso`, `/ia`, `/agentes`; CORS | 401 sin token, 200 con token, reenvío de `Authorization` |
| RabbitMQ | Exchange `condohub.events`, colas de la saga y n8n, DLQ (nombres en `infra/CLAUDE.md`) | Ruteo de un evento de prueba |
| n8n | En el compose, con su base en Postgres | `healthz` |
| Contratos | `events/` (sobre + 13 eventos), `openapi/` (`ia`, `agentes`, `reservas`, `acceso`), `graphql/schema.graphql` (v1 mínima) | Esquemas compilados y probados con mensajes válidos e inválidos; lint de OpenAPI |
| Gestión | Spring Boot + Hexagonal; `salud`, `estadoDeCuenta` (F1), `pagosPendientes` | 22 tests, ArchUnit, Testcontainers; probado por el gateway |
| IA | FastAPI + Clean; endpoints de `ia.yaml` protegidos por rol (501 hasta tener lógica). ML en Colab (`services/ia/ml/README.md`): línea base facial, registro con fotos propias y ajuste fino, ya ejecutados | 88 tests (servicio + ML), ruff, mypy; probado por el gateway |
| Acceso | Next.js + Clean; endpoints protegidos por rol (501) | 35 tests, lint, build; probado por el gateway |
| Agentes | FastAPI + Clean; misiones y confirmaciones solo para ADMIN (501 hasta tener lógica) | 26 tests, ruff, mypy; probado por el gateway |
| Reservas | Laravel 12 + Clean; endpoints protegidos por rol (501); esquema SQL existente migrado y sus pruebas de BD en verde | 31 tests (Pest), PHPStan nivel 8, Pint; probado por el gateway |
| Shell | React + Vite; login OIDC real, menú por rol, host de remotos | 13 tests, build; flujo PKCE probado |

**Actualización 16/10/2026:** Gestión ya tiene `miPerfil` y `enlazarCuenta`; el shell renueva el token en silencio; `admin`, `residente` y `guardia` tienen esqueleto (React, muestran el perfil). Cómo levantarlo todo y entrar: sección 6.

**Todavía no existe:** el servidor MCP y el LLM de Agentes, los flujos de n8n de cron, las pantallas de negocio de los tres frontends, y cualquier lógica de negocio más allá de lo de la tabla. Los esqueletos responden `501 NO_IMPLEMENTADO` en lo que falta.

## 2. Clonar el espacio de trabajo y levantar todo

Se clona primero la raíz y luego cada repo dentro de su carpeta (git crea `services/` y `frontends/` solo). Siempre se abre la carpeta `condohub` completa.

```bash
git clone https://github.com/NoelSandoval-15/EXAMEN-2---SW-II.git condohub
cd condohub

git clone https://github.com/luisrepo25/condohub-gestion.git    services/gestion
git clone https://github.com/luisrepo25/condohub-reservas.git   services/reservas
git clone https://github.com/luisrepo25/condohub-acceso.git     services/acceso
git clone https://github.com/luisrepo25/condohub-ia.git         services/ia
git clone https://github.com/luisrepo25/condohub-agentes.git    services/agentes

git clone https://github.com/luisrepo25/condohub-shell.git      frontends/shell
git clone https://github.com/luisrepo25/condohub-admin.git      frontends/admin
git clone https://github.com/luisrepo25/condohub-residente.git  frontends/residente
git clone https://github.com/luisrepo25/condohub-guardia.git    frontends/guardia
```

Requisitos: Git, Docker Desktop y Node 20+; Java 21 y Maven (Gestión); Python 3.11 (IA y Agentes); PHP 8.2+ con `pdo_pgsql` y Composer (Reservas). Después:

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
Hecho: pipeline MTCNN → FaceNet, línea base con métricas, registro con fotos propias y ajuste fino (no concluyente; el servicio usa el modelo preentrenado). **Hallazgo:** con LFW el FAR era 0,12 %, pero con amigos reales el modelo aceptó a 2 de 3; el umbral hay que calibrarlo con desconocidos reales (detalle en `services/ia/ml/README.md`).

1. Reunir fotos con consentimiento (`docs/negocio/consentimiento-facial.md`): las de los tres y 10–15 desconocidos; probar otros métodos de comparación y fijar el umbral.
2. Dataset de placas (YOLO + OCR) y DBSCAN con datos reales (I4).
3. Flujos de n8n (el compose ya los espera en `infra/n8n/flows/`).
4. Quitar el `501` de cada endpoint de IA al implementarlo y actualizar `ia.yaml` si cambia algo.

## 5. Decisiones abiertas (alguien tiene que cerrarlas)

| Tema | Detalle | Quién |
|---|---|---|
| Laravel 12 (cerrada, a confirmar) | Composer bloquea todas las versiones de Laravel 11 por avisos de seguridad. Se usó Laravel 12 (PHP 8.2+), registrado en `docs/adr/0001-laravel-12.md`. Erick debe confirmar el ADR | Erick |
| Eventos | Los 13 esquemas de `contracts/events/` son una primera propuesta derivada de las reglas | Erick y Aldana |
| Cola de pases | La saga usa los comandos `reservas.EmitirPasesReserva`/`RevocarPasesReserva` según `services/reservas/CLAUDE.md`; confirmar | Erick |
| Enlace `sub` ↔ `residenteId` (cerrada, a confirmar) | `registrar` recibe `residenteId` y `residenteSub`; el perfil guarda ambos y el RESIDENTE solo retira el perfil cuyo `residenteSub` es su `sub`. Aldana debe confirmar que la consola admin los envía | Luis y Aldana |
| Clave de firma | El realm usa una clave RSA fija **de desarrollo** (está en el repo, a propósito, para que el gateway valide siempre). No usar fuera de desarrollo | todos |
| Almacén S3 (cerrada, a confirmar) | La imagen de MinIO ya no se puede descargar, así que el servicio `minio` del compose es ahora **SeaweedFS** con API S3 (`docs/adr/0002-almacen-s3.md`). Verificado: subir/bajar archivos y rechazo de credenciales falsas. Faltan por probar las URLs firmadas. Erick debe confirmar el ADR | Erick |
| `pases/validar` (regla A1/A2) | ¿Validar un pase consume su único uso, o lo consume el registro de ingreso (`POST /api/accesos`)? Propuesta: lo consume el registro; validar solo consulta. Escribirlo en `reglas-de-negocio.md` antes del código | Erick (decide con el equipo) |
| Umbral facial en tres zonas (regla I2, escrita, a confirmar) | Alto 0.70 = reconocido, entre 0.50 y 0.70 = «dudoso, decide el guardia», bajo 0.50 = desconocido. Ya está en `reglas-de-negocio.md` e `ia.yaml` (`DUDOSO`); Acceso debe mostrar el candidato y no abrir (A5). Los valores se calibran con desconocidos reales | Luis, Erick |
| Fotos y consentimiento | Cada integrante aporta 30–50 fotos (3 sesiones) y 10–15 desconocidos con permiso. Completar los campos `[entre corchetes]` de `docs/negocio/consentimiento-facial.md` y definir dónde se guardan (privado, nunca en git) | todos |
| Dónde viven los repos (cerrada) | Las URLs reales están en la sección 2 («Clonar el espacio de trabajo»). La raíz está en la cuenta de Erick y los otros 9 en la de Luis, con los demás integrantes como colaboradores | — |

## 6. Trabajar logueado (checklist para cada integrante)

**1. Infraestructura.** Con Docker Desktop abierto (si `docker ps` dice que no encuentra el motor, espera a que arranque):

```powershell
docker compose -f infra/docker-compose.yml up -d
# con 5432 u 8080 ocupados: $env:POSTGRES_PORT='5433'; $env:GATEWAY_PORT='8090'   (antes del comando anterior)
```

Keycloak tarda ~40 s. Está listo cuando <http://localhost:8180/realms/condohub/.well-known/openid-configuration> responde.

**2. Servicios** (cada uno en su carpeta; solo los que vayas a usar). Si cambiaste `POSTGRES_PORT`, pásalo a Gestión y Reservas:

| Servicio | Comando | Puerto |
|---|---|---|
| Gestión | `$env:GESTION_DB_URL='jdbc:postgresql://localhost:5433/gestion'; mvn spring-boot:run "-Dspring-boot.run.profiles=dev"` | 8081 |
| Reservas | `$env:DB_PORT='5433'; php artisan serve --port=8082` | 8082 |
| Acceso | `npm run dev` | 3001 |
| IA | `.venv\Scripts\python -m uvicorn app.main:app --port 8083` | 8083 |
| Agentes | `.venv\Scripts\python -m uvicorn app.main:app --port 8084` | 8084 |

Gestión con el perfil `dev` carga las 200 unidades de demostración. Comprobación rápida de todo: `$env:GATEWAY_PORT='8090'; node infra/humo.mjs`.

**3. Frontends.** Cada remoto se compila y se sirve con `npm install` (una vez) y `npm run dev`. Si tu gateway no está en el 8080, crea antes en la carpeta del remoto un `.env` con `VITE_GATEWAY_URL=http://localhost:8090` (el `.env` no se sube). Después, el shell:

| Frontend | Carpeta | URL |
|---|---|---|
| Shell (entra por aquí) | `frontends/shell` (`npm run dev`) | <http://localhost:5173> |
| Remoto admin | `frontends/admin` | 4200 |
| Remoto residente | `frontends/residente` | 5174 |
| Remoto guardia | `frontends/guardia` | 5175 |

**4. Usuarios** (contraseña `Condohub123!`; solo desarrollo):

| Usuario | Rol | Qué ves |
|---|---|---|
| `admin@condohub.test` | `ADMIN` | consola admin; sin unidades propias |
| `residente@condohub.test` | `RESIDENTE` | portal del residente; titular de la unidad A-101 |
| `guardia@condohub.test` | `GUARDIA` | app de portería |
| `vecino.b101@condohub.test` | `RESIDENTE` | titular de B-101 (cuenta de ejemplo creada con el script) |

**5. Crear más cuentas.** Cada persona de Gestión puede tener su cuenta de Keycloak enlazada (F1). El `personaId` sale de `miPerfil` o de la tabla `persona` de Gestión:

```powershell
node infra/keycloak/crear-cuenta.mjs --email ana@vecinos.condohub.test --rol RESIDENTE --nombre "Ana Pérez" --persona <personaId>
```

**6. Llamar a un servicio a mano con tu token:**

```powershell
$t = (Invoke-RestMethod -Method Post http://localhost:8180/realms/condohub/protocol/openid-connect/token -Body @{grant_type='password';client_id='condohub-spa';username='residente@condohub.test';password='Condohub123!'}).access_token
Invoke-RestMethod -Method Post http://localhost:8090/gestion/graphql -Headers @{Authorization="Bearer $t"} -ContentType 'application/json' -Body '{"query":"{ miPerfil { roles nombre unidades { codigo titular } } }"}'
```

**Para agregar tu parte al login:** valida el JWT y los roles como en la sección 3; si necesitas saber la unidad o persona del usuario, pide `miPerfil` a Gestión con el mismo token (no leas su base).

**Problemas frecuentes:** `502` en el gateway = el servicio no está levantado (el login sí pasó); `401` = token vencido (dura 15 min; el shell lo renueva solo); pantalla del remoto con error de red = `VITE_GATEWAY_URL` no coincide con tu gateway (recompila el remoto); `directAccessGrantsEnabled` del cliente `condohub-spa` sigue activo porque `humo.mjs` y los `curl` lo usan: desactivarlo antes de la demo del 11/11.

## 7. Convenciones que ya se aplican

Contrato primero; test de dominio con el código de la regla en el nombre (`F1_residente_no_ve_otra_unidad`); errores `application/problem+json` con `code`; dinero como string decimal; el dominio no importa frameworks (lo verifican ArchUnit, ESLint `no-restricted-imports` y un test de dependencias). No reescribir código funcional: se extiende.

**Git:** el módulo que toca una sola persona puede trabajarse directo en `main` (siempre `git pull` antes de `push`). Lo que tocan varios (`contracts/`, `infra/`, `docs/`) va por rama y PR revisado por otra persona, y los cambios de contrato primero. Nunca se suben `.env`, fotos de personas, datasets ni pesos de modelos.