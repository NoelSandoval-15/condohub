# CondoHub

Plataforma de gestión de un condominio horizontal (~200 unidades): expensas y pagos, reservas de áreas comunes, control de acceso en portería, visión artificial y reportes por voz.

Proyecto universitario de Software 2 (segundo parcial). Equipo: **Aldana, Erick y Luis**.

Cada servicio y cada frontend es un **repositorio independiente**. Este repositorio (`condohub`) es la raíz: contiene los contratos entre servicios, la documentación y la infraestructura.

## Repositorios

| Repositorio | Qué es | Tecnología |
|---|---|---|
| [condohub](https://github.com/NoelSandoval-15/condohub) (este) | Contratos, documentación e infraestructura | GraphQL · OpenAPI · Docker Compose · Keycloak · n8n |
| [condohub-gestion](https://github.com/luisrepo25/condohub-gestion) | Finanzas: expensas, cargos, pagos y morosidad | Java 21 · Spring Boot · PostgreSQL |
| [condohub-reservas](https://github.com/luisrepo25/condohub-reservas) | Reservas de áreas comunes y saga | PHP · Laravel 12 · PostgreSQL |
| [condohub-acceso](https://github.com/luisrepo25/condohub-acceso) | Visitas, pases QR y registros de portería | Next.js · TypeScript · DynamoDB |
| [condohub-ia](https://github.com/luisrepo25/condohub-ia) | Rostros, placas, DBSCAN y reportes por voz | Python · FastAPI · PyTorch · TensorFlow |
| [condohub-agentes](https://github.com/luisrepo25/condohub-agentes) | Agente con herramientas MCP y monitoreo | Python · FastAPI · MongoDB |
| [condohub-shell](https://github.com/luisrepo25/condohub-shell) | Inicio de sesión y host de los micro frontends | React · Vite |
| [condohub-admin](https://github.com/luisrepo25/condohub-admin) | Consola del administrador | Angular 18 |
| [condohub-residente](https://github.com/luisrepo25/condohub-residente) | Portal del residente | React (PWA) |
| [condohub-guardia](https://github.com/luisrepo25/condohub-guardia) | Tablero web de portería | React |
| [Parcial2MovilSW2](https://github.com/luisrepo25/Parcial2MovilSW2) | App móvil del guardia | Flutter |

## Dónde está cada cosa (en este repositorio)

- [Reglas de negocio](docs/negocio/reglas-de-negocio.md) · [Arquitectura DDD](docs/arquitectura/ddd.md) · [Modelo de datos](docs/datos/modelo-de-datos.md) · [Plan](docs/PLAN_4_SEMANAS.md) · [Decisiones (ADR)](docs/adr)
- [Contrato GraphQL](contracts/graphql/schema.graphql) · [Contratos REST](contracts/openapi) · [Eventos](contracts/events)
- [Docker Compose](infra/docker-compose.yml) · [Keycloak](infra/keycloak/realm-condohub.json) · [Flujos de n8n](infra/n8n/flows) · [Despliegue en la nube](infra/nube) · [Respaldos](infra/respaldo) · [Datos de demostración](infra/datos-demo)
- [Reglas de trabajo del repositorio](CLAUDE.md)

## Clonar todo el sistema

```bash
git clone https://github.com/NoelSandoval-15/condohub.git condohub
cd condohub

git clone https://github.com/luisrepo25/condohub-gestion.git   services/gestion
git clone https://github.com/luisrepo25/condohub-reservas.git  services/reservas
git clone https://github.com/luisrepo25/condohub-acceso.git    services/acceso
git clone https://github.com/luisrepo25/condohub-ia.git        services/ia
git clone https://github.com/luisrepo25/condohub-agentes.git   services/agentes

git clone https://github.com/luisrepo25/condohub-shell.git     frontends/shell
git clone https://github.com/luisrepo25/condohub-admin.git     frontends/admin
git clone https://github.com/luisrepo25/condohub-residente.git frontends/residente
git clone https://github.com/luisrepo25/condohub-guardia.git   frontends/guardia
git clone https://github.com/luisrepo25/Parcial2MovilSW2.git   frontends/movil
```

Para levantar la infraestructura local: `docker compose -f infra/docker-compose.yml up -d` (ver [CLAUDE.md](CLAUDE.md)).
