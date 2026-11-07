# ADR 0003 — Documentos de la gestión en S3 real de AWS

- **Fecha**: 06/11/2026
- **Estado**: aceptada y aplicada en producción (decidida por Luis; Aldana y Erick siguen esta decisión)

## Contexto

El docente pidió usar S3 para guardar documentación importante de la gestión empresarial. Hasta entonces el único «S3» era SeaweedFS en la VM de
Google Cloud (ADR 0002), usado solo por el Servicio IA.

## Decisión

Un **solo bucket privado de AWS** (`condohub-documentos-<sufijo>`, us-east-1, con versionado, bloqueo de acceso público y cifrado por defecto) con una
carpeta por tipo de documento:

| Carpeta | Contenido | Quién escribe |
|---|---|---|
| `reportes/` | Excel y PDF de los reportes por voz o texto (G4) | Servicio IA (`S3_PREFIJO_REPORTES=reportes/`) |
| `placas/` | Modelos de IA (detector de placas) | Servicio IA (`publicar_modelo`) |
| `respaldos/<vm>/<fecha>/` | Respaldos nocturnos de las bases (PostgreSQL y MongoDB) | `infra/respaldo/respaldar.sh` con cron en Azure y Google |

El servicio IA solo cambia de configuración (`S3_AWS_*`, `S3_BUCKET_*` en el `.env` de la VM de Google; sin ellas todo sigue como antes). Las **fotos de
rostros no van a AWS**: siguen en el SeaweedFS de la VM mediante un almacén propio (`S3_ROSTROS_*`), de modo que el borrado de I1 sigue alcanzando también las
fotos ya registradas. Los respaldos se prueban restaurándolos en una base nueva (`infra/respaldo/restaurar.sh`).

Criterios: cada servicio usa un usuario IAM con permiso solo sobre su carpeta (IA sobre reportes y modelos, los respaldos solo sobre `respaldos/*`, sin
permiso de borrado) y una regla de ciclo de vida expira los respaldos a los 30 días.

## Consecuencias

- Los nombres de bucket de AWS son globales: llevan un sufijo propio. Un solo bucket no cuesta más que varios: S3 cobra por lo almacenado y por las
  peticiones, y lo nuestro son megabytes.
- IA llama a `crear_bucket` antes del primer uso: el usuario necesita `s3:CreateBucket` solo sobre ese bucket (que ya existe).
- Lo que ya estaba en SeaweedFS (reportes de prueba) no se migra. El modelo de placas hay que republicarlo en el bucket.
- Verificación sin exponer claves: `docker exec -i gcp-ia-1 python - < infra/nube/probar-s3.py`.
- Probado el 07/11/2026: reportes y modelos contra AWS (subida, descarga y URL firmada), fotos de rostros contra la VM con borrado real, respaldos de
  Azure y Google en `respaldos/` y restauración del respaldo de Gestión desde AWS en una base de prueba: 200 unidades, 624 cargos, 493 pagos y
  80 morosos, idénticos a la base real.
- **No aprobado todavía** (cada uno requiere su propia decisión): fotos de comprobantes de pago en Gestión (`comprobantes/`) y copia del informe mensual de n8n.

## Lo aprendido al implementarla

- El servicio IA usaba un solo endpoint y un solo par de claves para reportes, modelos y fotos: mover los reportes arrastraba las fotos y dejaba sin alcance el
  borrado de I1 para los perfiles ya registrados. Por eso las fotos tienen ahora su propio almacén.
- Al volver atrás o cambiar la configuración, Docker Compose da prioridad a las variables exportadas en la sesión SSH sobre el `.env`: hay que hacer `unset`
  (o abrir una sesión nueva) antes de recrear los contenedores.
- El `curl` del sistema firma las peticiones a S3 (`--aws-sigv4`): los respaldos no necesitan instalar el cliente de AWS.
