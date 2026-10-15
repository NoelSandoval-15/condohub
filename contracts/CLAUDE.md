# CLAUDE.md — contracts/

Fuente de verdad de todas las interfaces entre repositorios de CondoHub. Vive en el repo raíz `condohub`. Los servicios copian o generan código a partir de aquí; nunca al revés.

```
contracts/
├── graphql/schema.graphql      # Gestión (Aldana)
├── openapi/
│   ├── reservas.yaml           # Erick
│   ├── acceso.yaml             # Erick
│   ├── ia.yaml                 # Luis
│   └── agentes.yaml            # Aldana
└── events/
    ├── _sobre.schema.json      # sobre común (Erick)
    └── <contexto>.<Evento>.schema.json
```

## Reglas

- Un cambio de contrato va en su propio PR al repo `condohub`, **antes** del PR del servicio, y lo revisa quien lo consume.
- Cambios compatibles (agregar campo opcional, nueva query) se permiten en cualquier momento. Cambios que rompen (renombrar, quitar, volver obligatorio) requieren avisar al equipo y subir `version` del evento o deprecar en GraphQL con `@deprecated`.
- Nombres del lenguaje ubicuo (`Unidad`, `Expensa`, `Reserva`...). Dinero como `String` decimal (GraphQL: scalar `Decimal`). Fechas ISO-8601 UTC.
- Toda escritura que pueda venir de una PWA declara el header `Idempotency-Key`.
- Errores REST en `application/problem+json` con `code` = código de regla.
- Sobre de evento: `{ eventId, type, occurredAt, sagaId, version, data }`. Routing key `<contexto>.<Evento>`.

## Estado (14/10/2026)

- `events/`: sobre común + 13 eventos de la saga, pagos y alertas (`reservas.*`, `finanzas.*`, `acceso.*`, `ia.*`). Los campos son una primera versión: Erick (dueño de `contracts/events`) y Aldana deben revisarla antes de implementar productores y consumidores.
- `openapi/ia.yaml` v1 (Luis).
- `graphql/schema.graphql` v1 mínima (`salud`, `estadoDeCuenta`, `pagosPendientes`, scalar `Decimal`), ya implementada en `services/gestion`; Aldana la amplía.
- `openapi/reservas.yaml`, `acceso.yaml` y `agentes.yaml` v1 (propuesta de Luis para Erick y Aldana: roles por endpoint y esquemas derivados de las reglas y de las tablas existentes; revisar antes de implementar). Cada servicio tiene un test que compara sus rutas con su contrato.

## Validación

```bash
npx @graphql-inspector/cli validate graphql/schema.graphql
npx @redocly/cli lint openapi/*.yaml
npx ajv-cli compile -s "events/*.schema.json"
```
