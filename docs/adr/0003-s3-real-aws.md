# ADR 0003 — Reportes y modelos de IA en S3 real de AWS

- **Fecha**: 06/11/2026
- **Estado**: **retirada (06/11/2026)**. Se probó y funcionó (reportes de IA guardados en un bucket real de AWS), pero se decidió no aplicarla: IA sigue
  con el SeaweedFS de la VM de Google para todo. Se conserva como registro de lo probado y de lo aprendido, por si se retoma.

## Contexto

El docente pidió usar S3 para guardar documentación importante de la gestión empresarial. Hasta hoy el único «S3» era SeaweedFS en la VM de
Google Cloud (ADR 0002), usado solo por el Servicio IA.

## Decisión (probada, no aplicada)

Los **reportes** (Excel y PDF del reporte por voz o texto) y los **modelos** de IA pasan a **buckets reales de AWS** (us-east-1), solo con
configuración: el cliente S3 de IA ya firma con SigV4 y cambian únicamente el endpoint, las claves y los nombres de bucket (`S3_AWS_*` y
`S3_BUCKET_*` en el `.env` de la VM de Google; sin ellas todo sigue como antes).

Las **fotos de rostros no se almacenan en ningún sitio** (`ALMACEN_FOTOS=memoria`): IA calcula el embedding, que vive en MongoDB, y descarta la
foto. Ninguna regla pide conservarlas, el reconocimiento y el retiro del consentimiento (I1) funcionan igual y no hay dato biométrico en reposo.
Esto evita además mover esas fotos a AWS, que no estaba aprobado.

Criterios: un bucket por tipo de documento (`condohub-reportes-<sufijo>`, `condohub-modelos-<sufijo>`) y un usuario IAM propio de IA con permiso
solo sobre ellos (Put/Get; `s3:CreateBucket` acotado a esos dos nombres porque IA llama a `crear_bucket`); buckets privados, con bloqueo de acceso
público, cifrado por defecto y versionado.

## Consecuencias

- Los nombres de bucket de AWS son globales: llevan un sufijo propio.
- Lo que ya estaba en SeaweedFS (reportes de prueba y fotos de 3 perfiles) no se migra; los perfiles siguen identificando y retirar el
  consentimiento es idempotente.
- El modelo de placas hay que republicarlo en el bucket de AWS (`publicar_modelo`).
- SeaweedFS puede quedar en la VM; `almacen.<dominio>` deja de usarse para los reportes.
- Verificación sin exponer claves: `docker exec -i gcp-ia-1 python - < infra/nube/probar-s3.py` (usa los buckets configurados).
- **No aprobado todavía** (ideas posibles, cada una requiere su propia decisión): fotos de comprobantes de pago en Gestión, respaldos
  nocturnos de las bases y copia del informe mensual de n8n.

## Qué se aprendió al probarla

- El servicio IA usa **un solo endpoint y un solo par de claves** para reportes, modelos y fotos de rostros: moverlos a AWS arrastraba también las
  fotos, y eso dejaba fuera de alcance el borrado de I1 para los perfiles ya registrados (sus fotos seguían en SeaweedFS). Para separarlos haría
  falta un endpoint propio para las fotos (un cambio pequeño en IA, con pruebas).
- Las variables `S3_AWS_*` del compose y `infra/nube/probar-s3.py` quedan disponibles y no afectan nada si no se definen.
- Al volver atrás, Compose da prioridad a las variables exportadas en la sesión SSH sobre el archivo `.env`: hay que hacer `unset` (o abrir una sesión
  nueva) antes de recrear los contenedores, o no se entera del cambio.
