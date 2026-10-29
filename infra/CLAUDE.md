# CLAUDE.md — infra/

Infraestructura local de CondoHub, en el repo raíz `condohub`. Responsable: **Erick** (flujos n8n: **Luis**).

```
infra/
├── docker-compose.yml        # postgres, mongo, dynamodb-local, rabbitmq, keycloak, minio, n8n, gateway
├── docker-compose.apps.yml   # opcional: levanta también los servicios desde sus imágenes
├── postgres/init/            # crea una base por servicio: gestion, reservas, keycloak (usuarios distintos)
├── keycloak/realm-condohub.json   # realm, roles ADMIN/RESIDENTE/GUARDIA, clientes y usuarios de prueba
├── gateway/                  # configuración del API Gateway (rutas /gestion, /reservas, /acceso, /ia, /agentes)
├── rabbitmq/definitions.json # exchange condohub.events, colas de la saga y DLQ
└── n8n/flows/                # flujos exportados en JSON
```

## Reglas

- Cada servicio tiene su base y su usuario; ningún usuario de BD tiene permisos sobre la base de otro servicio.
- El realm de Keycloak se importa al arrancar; cualquier cambio en la consola de Keycloak se exporta de vuelta a `realm-condohub.json`.
- Secretos solo en `.env` (ignorado). `.env.example` con valores de desarrollo.
- Healthchecks en todos los contenedores; los servicios dependen con `condition: service_healthy`.
- El gateway valida el JWT y reenvía el header `Authorization` a los servicios (que vuelven a validarlo).

## Keycloak (SSO)

Servicio `keycloak` (imagen 25.0.6, `start-dev --import-realm`, base `keycloak` en PostgreSQL). Consola: <http://localhost:8180> (`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`). Verificado el 14/10/2026: el realm se importa al arrancar y los tokens salen con el rol esperado.

- **Issuer**: `http://localhost:8180/realms/condohub` (fijo por `KC_HOSTNAME`). Los servicios dentro de Docker piden las claves en `http://keycloak:8080/realms/condohub/protocol/openid-connect/certs` (`KC_HOSTNAME_BACKCHANNEL_DYNAMIC`), pero validan el `iss` contra el de arriba.
- **Roles** (realm): `ADMIN`, `RESIDENTE`, `GUARDIA`. Van en el claim `realm_access.roles` del access token.
- **Usuarios de prueba** (contraseña `USUARIOS_PRUEBA_PASSWORD`, por defecto `Condohub123!`; `sub` fijo, lo usa el seed de datos):

  | Usuario | Rol | `sub` |
  |---|---|---|
  | `admin@condohub.test` | `ADMIN` | `00000000-0000-0000-0000-00000000a001` |
  | `residente@condohub.test` | `RESIDENTE` | `00000000-0000-0000-0000-00000000a002` |
  | `guardia@condohub.test` | `GUARDIA` | `00000000-0000-0000-0000-00000000a003` |

- **Clientes**: `condohub-spa` (público, Authorization Code + PKCE S256, redirect a los puertos 5173/5174/5175/4200; tiene `directAccessGrantsEnabled` solo para pruebas con curl) y `condohub-servicios` (confidencial, `client_credentials`, secreto `CONDOHUB_SERVICIOS_SECRET`) para n8n, agentes y reportes. Su cuenta de servicio tiene el rol `ADMIN` para poder leer `morosos` en Gestión (decisión del 16/10/2026: no se agregan roles nuevos; G2 sigue exigiendo confirmación humana para todo lo que cree cargos). Si ya tenías el realm importado, el cambio no se aplica solo: asigna el rol `ADMIN` a `service-account-condohub-servicios` en la consola de Keycloak y activa «Full scope allowed» del cliente.
- Clave de firma: RSA fija de desarrollo (ver "Gateway"); los tokens se validan con ella en el gateway y en los servicios (vía JWKS del realm).
- Access token: 15 min. Sesión inactiva: 30 min.

Obtener un token para probar un endpoint:

```bash
curl -s -X POST http://localhost:8180/realms/condohub/protocol/openid-connect/token \
  -d grant_type=password -d client_id=condohub-spa \
  -d username=admin@condohub.test -d 'password=Condohub123!' | jq -r .access_token
```

Token de servicio (`condohub-servicios`): mismo endpoint con `grant_type=client_credentials`, `client_id=condohub-servicios` y `client_secret`.

### Crear cuentas reales y enlazarlas con su persona

`node infra/keycloak/crear-cuenta.mjs --email <correo> --rol RESIDENTE|ADMIN|GUARDIA --nombre "<nombre>" [--persona <personaId>]` crea la cuenta en el realm (si no existe), le da el rol y, con `--persona`, la enlaza en Gestión con la mutation `enlazarCuenta` (solo `ADMIN`; usa `GATEWAY_PORT`). Es idempotente. El `personaId` sale de la base de Gestión o de `miPerfil`. Cada usuario ve sus unidades con la query `miPerfil` de Gestión. Solo desarrollo: usa el usuario `admin@condohub.test` y el admin maestro de Keycloak.

## Puertos ocupados en tu máquina

Si un puerto del compose ya lo usa otro programa (en la máquina de Luis: 5432 por un PostgreSQL de Windows y 8080 por `AgentService`), no lo apagues: cambia el puerto del host con `POSTGRES_PORT` y `GATEWAY_PORT` (variables de entorno o `infra/.env`). Dentro de Docker los puertos no cambian.

## Gateway (Kong DB-less)

Kong 3.7 con `gateway/kong.yml` (sin base de datos). Puerto host **8080** (`GATEWAY_PORT` lo cambia; en una máquina de Luis el 8080 lo ocupa un proceso `AgentService` ajeno, ahí se usa `GATEWAY_PORT=8090`).

- Plugin `jwt` global: valida firma RS256, `exp` y que el `iss` sea `http://localhost:8180/realms/condohub`. Sin token o con token inválido → **401**. El gateway **no** autoriza por rol: eso lo hace cada servicio con los roles del token.
- Rutas (con `strip_path`, así `/gestion/graphql` llega como `/graphql`): `/gestion`→8081, `/reservas`→8082, `/acceso`→3001, `/ia`→8083, `/agentes`→8084. Los upstreams son `host.docker.internal:<puerto>` porque en desarrollo los servicios corren en el host; cuando haya `docker-compose.apps.yml` pasan a nombre de servicio.
- Plugin `cors` global para 5173, 5174, 5175 y 4200; permite `Authorization` e `Idempotency-Key`.
- **Clave RSA fija de desarrollo**: el realm instala la clave `rsa-desarrollo-fija` (componente `KeyProvider` en `realm-condohub.json`) y su parte pública está pegada en `kong.yml`. Así el gateway sigue validando aunque se recree la base de Keycloak. Es solo de desarrollo; si se cambia la clave del realm, hay que actualizar `rsa_public_key` en `kong.yml`.
- Verificado el 14/10/2026 contra un eco temporal: sin token 401, token basura 401, tokens de `ADMIN`/`RESIDENTE`/`GUARDIA` 200, `Authorization` reenviado intacto, ruta inexistente 404, preflight CORS correcto. Cuando un servicio no está levantado, el gateway responde 502 (la autenticación ya pasó).
- Cambiar `kong.yml` requiere `docker compose -f infra/docker-compose.yml restart gateway`.

## Almacén S3 (servicio `minio`, hoy SeaweedFS)

Guarda fotos, audio, comprobantes y pesos de modelos (I6). La imagen de MinIO ya no se puede descargar, por lo que el servicio usa
`chrislusf/seaweedfs:3.85` con su API S3 (ver `docs/adr/0002-almacen-s3.md`). El nombre `minio` del servicio y las variables `MINIO_*` se conservan.

- Endpoint S3: `http://localhost:9000` (desde Docker: `http://minio:9000`). Panel del maestro: `http://localhost:9333` (no hay consola en el 9001).
- Credenciales de desarrollo: `infra/seaweedfs/s3.json` (access key `condohub`, secreta `condohub123`); deben coincidir con `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` de `.env`. Sin firma o con claves falsas el acceso se rechaza.
- Los buckets los crea el cliente S3 (ej. `aws --endpoint-url http://localhost:9000 s3 mb s3://modelos`).

## RabbitMQ

Imagen `rabbitmq:3.13-management`; panel <http://localhost:15672> (usuario `condohub` / contraseña `condohub`, solo desarrollo; el usuario y su hash viven en `rabbitmq/definitions.json`, que se carga al arrancar). Para cambiar la topología: editar `definitions.json` y recrear el volumen (`down -v` o `docker volume rm condohub_rabbit_data`), porque las definiciones solo se importan al crear el broker.

- Exchange `condohub.events` (topic, durable), routing key `<contexto>.<Evento>`. Lo que se rechaza o expira va por `condohub.events.dlx` a la cola `condohub.dlq`.
- Colas y bindings (nombres tomados de `services/reservas/CLAUDE.md`; el contexto de Gestión es `finanzas`). Los eventos están definidos en `contracts/events/`:

  | Cola | Consumidor | Bindings |
  |---|---|---|
  | `finanzas.reservas` | Gestión (saga, paso 2) | `reservas.AplicarCargosReserva`, `reservas.AnularCargosReserva` |
  | `acceso.reservas` | Acceso (saga, paso 3) | `reservas.EmitirPasesReserva`, `reservas.RevocarPasesReserva` |
  | `reservas.saga` | orquestador de Reservas | `finanzas.CargoAplicado`, `finanzas.CargoAnulado`, `acceso.PaseEmitido`, `acceso.PaseRevocado` |
  | `n8n.eventos` | flujos n8n | `finanzas.PagoRegistrado`, `finanzas.PagoConfirmado`, `ia.VisitanteRecurrenteDetectado`, `reservas.ReservaConfirmada`, `reservas.ReservaFallida` |
  | `condohub.dlq` | revisión manual | todo lo que llega al DLX |

- Cada servicio declara/valida sus colas al arrancar con las mismas definiciones; no cambiar nombres sin avisar.
- Para aplicar un cambio de `definitions.json` sin borrar el volumen: `POST /api/definitions` en el panel (solo agrega) y borrar a mano colas o bindings obsoletos por la API.
## n8n

Imagen `n8nio/n8n:1.64.0`, editor en <http://localhost:5678>, estado en la base `n8n` de PostgreSQL (usuario `n8n`). La primera vez que entras te pide crear la cuenta de propietario (es local, no usa Keycloak). Las credenciales de los flujos se cifran con `N8N_ENCRYPTION_KEY`; si se cambia, hay que volver a crearlas.

- Para consumir eventos, los flujos leen de RabbitMQ la cola `n8n.eventos` (usuario `condohub`, host `rabbitmq`, puerto 5672).
- Para llamar a Gestión o a los demás servicios, los flujos piden un token con el cliente `condohub-servicios` (`client_credentials`, ver Keycloak) y llaman por el gateway o directo (`http://host.docker.internal:<puerto>`).
- Exporta cada flujo a `infra/n8n/flows/<nombre>.json` sin credenciales dentro.

## Flujos n8n (Luis)

| Flujo | Disparo | Hace |
|---|---|---|
| Recordatorio de cuotas vencidas | diario 09:00 | consulta morosos (GraphQL) y envía recordatorio |
| Comprobante recibido | evento `PagoRegistrado` | compara con el extracto, deja sugerencia de conciliación al `ADMIN`; al `PagoConfirmado` envía el recibo |
| Alerta de cámara | evento `VisitanteRecurrenteDetectado` | notifica al guardia |
| Informe mensual | día 1 a las 08:00 | resumen de morosidad por bloque y pagos por conciliar, solo al `ADMIN` (`morosos` y `pagosPendientes`; el envío a propietarios exigiría una consulta nueva en Gestión) |
| Notificación de reserva | `ReservaConfirmada` / `ReservaFallida` | avisa al residente |
| Push al guardia | webhook `POST /webhook/push-guardia` con `{titulo, cuerpo}` (`push-guardia.json`) | envía una notificación FCM al tema `guardia` de la app móvil. Firma el token con la cuenta de servicio de `infra/secrets/firebase-sa.json` (fuera de git, montada en solo lectura; n8n con `NODE_FUNCTION_ALLOW_BUILTIN=fs,crypto`). Probado el 28/10/2026: FCM devuelve el id del mensaje |
| Alertas del agente de monitoreo | webhook `POST /webhook/agente-alertas` (lo llama el servicio Agentes, G5) | correo al `ADMIN_EMAIL` con las anomalías |
| Recordatorio pedido por el agente | webhook `POST /webhook/agente-recordatorio` (tras la aprobación del ADMIN, G2) | busca al titular en Gestión y le envía el mensaje; sin correo, al ADMIN |

Exporta cada flujo a `n8n/flows/<nombre>.json` después de editarlo en la UI; sin credenciales dentro del JSON.

**Demostración:** `node infra/n8n/publicar-evento.mjs [tipo]` publica un evento de ejemplo con un `eventId` nuevo (por omisión `VisitanteRecurrenteDetectado`; también `PagoRegistrado`, `PagoConfirmado`, `ReservaConfirmada`, `ReservaFallida`) para ver el flujo en n8n → Executions, el correo y el push al guardia. Al importar flujos con `importar.mjs` n8n los deja **inactivos**: reactivar los que correspondan con `n8n update:workflow --id=<id> --active=true` y reiniciar; el «Recordatorio de morosos» debe seguir apagado mientras el SMTP sea real.

**Estado**: implementado y probado el flujo **«Eventos de CondoHub»** (`n8n/flows/eventos-condohub.json`), que cubre las filas 2, 3 y 5 de la tabla (comprobante/recibo, alerta de cámara y reserva). Es un solo flujo porque los consumidores de una misma cola compiten: uno por evento, enrutado por tipo. El flujo **«Recordatorio de morosos»** (`n8n/flows/recordatorio-morosos.json`, fila 1) también está hecho y verificado el 16/10/2026: cada día a las 09:00 (hora de La Paz) pide un token con `condohub-servicios` (`CONDOHUB_SERVICIOS_SECRET`), consulta `morosos` a Gestión por el gateway (`http://gateway:8000/gestion/graphql`) y envía un correo por unidad al propietario titular; sin correo registrado va al `ADMIN`. La moneda sale de `MONEDA` (por defecto `BOB`). Se puede probar sin esperar al reloj: `docker compose -f infra/docker-compose.yml exec -T n8n n8n execute --id=recordatorioMorosos01` y ver los correos en Mailpit. Solo **recuerda**: no aplica recargos (F5, G2). El flujo **«Informe mensual»** (`n8n/flows/informe-mensual.json`, fila 4) está hecho y verificado el 28/10/2026: el día 1 a las 08:00 (La Paz) pide el token de servicio, consulta `morosos` y `pagosPendientes`, suma en centavos enteros (F10) y envía un correo al `ADMIN_EMAIL` con la morosidad por bloque y los pagos por conciliar. Solo resume: no crea cargos ni confirma pagos. Prueba: `docker compose -f infra/docker-compose.yml exec -T n8n n8n execute --id=informeMensual01`.

- **Correo**: Mailpit (`mailpit`, SMTP 1025, bandeja <http://localhost:8025>) hace de proveedor SMTP en desarrollo. Destinos: `GUARDIA_EMAIL` y `ADMIN_EMAIL`; el residente sale de `CONTACTOS_UNIDADES` (`{"<unidadId>":"correo"}`) y, sin entrada, el aviso va al ADMIN. `TODO(regla)`: sustituirlo por los contactos de Gestión cuando los exponga.
- **Idempotencia (S5)**: se procesa un evento a la vez (`parallelMessages: 1`) y se guarda el `eventId` solo tras enviar el correo; un repetido no genera otro aviso.
- **Fallos**: si el correo no sale, el evento original va a `condohub.dlq` con el motivo (puede tardar ~2 min si el SMTP está caído); reenviar el evento a mano lo entrega.
- **Cargar y probar**: `node n8n/importar.mjs` (credenciales desde el entorno, importa y activa los flujos), `node n8n/probar.mjs` (5 correos + repetido) y `node n8n/probar-fallo.mjs` (SMTP caído). Si usas `CONTACTOS_UNIDADES` en el compose, pásalo también a `probar.mjs`.

## Aplicaciones en contenedores (17/10/2026)

Cada servicio y frontend tiene su `Dockerfile` en su repo. `docker-compose.apps.yml` los levanta sobre la infraestructura, con el gateway apuntando por nombre (`gateway/kong.apps.yml`, copia de `kong.yml`: si cambias uno, cambia el otro):

```bash
# apaga antes lo que corras en el host (mismos puertos)
docker compose -f infra/docker-compose.yml -f infra/docker-compose.apps.yml up -d --build
```

Verificado: los 5 servicios responden por el gateway (`node infra/humo.mjs`), los frontends se sirven con nginx, Reservas migra al arrancar, y un reporte por voz completo (Whisper → LLM → Gestión → PDF en S3) se descarga desde fuera de Docker. Notas: `RESERVAS_APP_KEY`, `GEMINI_API_KEY`/`GROQ_API_KEY` (+ `LLM_PROVEEDOR`) y `S3_ENDPOINT_PUBLICO` por entorno; los frontends llevan las URL públicas compiladas (build args del compose); `ia-agrupamiento` corre el DBSCAN a las 02:00 (La Paz); `reservas-outbox` (misma imagen que Reservas) publica el outbox de Reservas en RabbitMQ (S4) con `php artisan outbox:publicar`; `reservas-saga` (misma imagen) es el orquestador de la saga (S1–S3) con `php artisan saga:consumir`; `acceso-saga` (misma imagen que Acceso) atiende el paso 3 de la saga y publica sus respuestas desde el stream de DynamoDB con `npm run saga`; Gestión arranca con `SPRING_PROFILES_ACTIVE=dev` (datos de demostración) salvo que definas `GESTION_PERFIL`. Los secretos por defecto del compose son solo de desarrollo.

## Despliegue en la nube (multi-nube, 29/10/2026)

Requisito del docente: los microservicios se despliegan en Azure, Google Cloud y AWS. Reparto: **Azure** = Keycloak, gateway, Gestión (con su Postgres), RabbitMQ y los 4 frontends estáticos, detrás de Caddy con HTTPS; **AWS** = Acceso y `acceso-saga` con DynamoDB real, Servicio IA con su Mongo y S3 real; **Google Cloud** = Reservas (con `reservas-outbox` y `reservas-saga`), su Postgres, n8n y Agentes con su Mongo. Cada nube es una VM con Docker (la misma receta en las tres); las llamadas entre nubes van por HTTPS público. Dominio gratuito `<servicio>.<ip-con-guiones>.sslip.io` (si Let's Encrypt lo limita, DuckDNS). Cada VM lleva una IP pública **fija**, y se apaga desde el panel (Stop/deallocate) cuando no se usa. El `iss` de los tokens es siempre `https://auth.<dominio>/realms/condohub`.

Azure (`infra/nube/azure/`): `preparar-vm.sh` (Docker y clonado de los repos en `~/condohub`), `azure.env.example` (se copia a `infra/.env` de la VM), `desplegar.sh` (genera en `generado/` el `kong.yml` con los upstreams de las otras nubes y el realm con la URL pública, y levanta los servicios con `docker-compose.azure.yml`), `Caddyfile` y `docker-compose.azure.yml`. El grupo de seguridad de la VM deja pasar solo 22, 80 y 443; RabbitMQ se abrirá al resto de las nubes solo por IP y con otra contraseña cuando Reservas y Acceso lo necesiten. Estado (29/10/2026): **Azure desplegado y verificado** (VM `condohub-azure`, Chile Central, B2als_v2, IP 68.211.120.83, dominio `68-211-120-83.sslip.io`; login, cierre de sesión, gateway, Gestión y frontends). El `.env` de la VM define `ACCESO_URL`/`IA_URL`/`RESERVAS_URL`/`AGENTES_URL` y `desplegar.sh` reinicia el gateway (Kong solo lee su archivo al arrancar). La suscripción de estudiante solo permite las regiones westus, northcentralus, chilecentral, spaincentral y francecentral, y Mexico Central no tiene auto-apagado: apagar con Stop (deallocated) desde el portal.

AWS (`infra/nube/aws/`): **Acceso con DynamoDB real, verificado** (VM `condohub-aws`, us-east-1, t3.small, IP 23.23.173.175). La tabla se creó con `db/tabla-acceso.json` (stream y TTL sobre `expiraEn`) y la VM usa el rol de IAM `condohub-acceso-ec2` (sin claves en archivos; hop limit 2 para los contenedores). `acceso-saga` queda detrás del perfil `saga` hasta abrir RabbitMQ de Azure (5672) a esta IP. Por el saldo de AWS (~20 USD) esta nube lleva solo Acceso.

Google Cloud (`infra/nube/gcp/`): **Reservas con su outbox, su saga y su Postgres, verificado** (VM `condohub-gcp`, us-central1-a, e2-standard-2, IP 35.232.160.36, proyecto `condohub-513107`, prueba gratuita de 300 USD hasta el 28/01/2027). Reservas llega a RabbitMQ de Azure: el 5672 de la VM de Azure solo está abierto a las IP de Google y AWS (regla `rabbitmq` del grupo `condohub-azure-nsg`, credenciales por defecto del realm de desarrollo). `infra/nube/probar-saga.py` recorre la saga completa (crear una reserva con invitados, esperar `CONFIRMADA` y cancelar para probar la compensación) y pasó el 29/10/2026 con Reservas en Google, Gestión en Azure y Acceso en AWS. Pendiente en Google: Servicio IA (con su Mongo y S3), n8n y Agentes.

## CI/CD (GitHub Actions)

Cada repo tiene `.github/workflows/ci.yml`: pruebas (lo mismo que se corre a mano; ver el `CLAUDE.md` del repo) en cada PR y push a `main`, y luego la imagen Docker, que se **publica en GHCR** (`ghcr.io/<cuenta>/<repo>:latest` y `:<sha>`) solo en push a `main`. La raíz tiene `contratos.yml`: valida el esquema GraphQL, los 14 esquemas de eventos, el lint de OpenAPI, el compose y los JSON de n8n, Keycloak y RabbitMQ. Los workflows se validaron con `actionlint`. El CI de IA instala sin PyTorch (los tests usan dobles; el modelo real se valida en Colab). Fuera del espacio de trabajo completo, los tests de contrato de cada servicio se omiten solos.

## Comandos

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml down       # -v borra datos
docker compose -f infra/docker-compose.yml logs -f keycloak
node infra/humo.mjs        # prueba de humo: login de los 3 usuarios + "hola" de cada servicio por el gateway (GATEWAY_PORT si no usas el 8080)
```
