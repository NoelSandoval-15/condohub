# ADR 0003 — Documentos de la gestión en S3 real de AWS

- **Fecha**: 06/11/2026
- **Estado**: aceptada (decidida por Luis; Aldana y Erick siguen esta decisión)

## Contexto

El docente pidió usar S3 para guardar la documentación importante de la gestión empresarial. Hasta hoy el único «S3» es SeaweedFS en la VM de
Google Cloud (ADR 0002), usado solo por el Servicio IA, y Gestión no guarda ningún archivo: `pago.comprobante_key`, `recibo.archivo_key` y
`egreso.comprobante_key` existen en el esquema pero no se usan, y la foto del comprobante se pierde después del OCR.

## Decisión

Usar **S3 real de AWS** (región us-east-1) como almacén de documentos, en pasos, de menor a mayor riesgo:

1. **IA → AWS** (solo configuración): reportes, modelos y fotos de rostros pasan a buckets de AWS. El cliente S3 de IA ya firma con SigV4; solo
   cambian el endpoint, las claves y los nombres de bucket (`S3_AWS_*`, `S3_BUCKET_*` en el `.env` de la VM de Google).
2. **Comprobantes de pago en Gestión** (F8): se guardan en un bucket propio de Gestión; el residente sube la foto con una URL prefirmada y el
   ADMIN la ve al conciliar. Contrato primero.
3. **Respaldos nocturnos** de las bases a S3 (scripts en `infra/`).

Criterios: un bucket por tipo de documento y un usuario IAM por servicio con permisos solo sobre sus buckets; buckets privados con bloqueo de
acceso público y cifrado por defecto; versionado en los documentos (reportes, modelos, comprobantes), pero **no** en las fotos de rostros, para
que el borrado de I1 (menos de 24 h) sea real; sin permiso de borrado salvo en rostros.

## Consecuencias

- Los nombres de bucket de AWS son globales: llevan un sufijo propio (`condohub-reportes-<sufijo>`).
- El servicio IA llama a `crear_bucket` antes del primer uso: el usuario IAM necesita `s3:CreateBucket` **solo** sobre sus tres buckets (que ya
  existen; en us-east-1 responde 200).
- Lo que ya estaba en SeaweedFS (5 reportes de prueba, fotos de 3 perfiles) no se migra: las claves antiguas no existen en AWS. Los perfiles
  siguen identificando (los embeddings están en MongoDB) y retirar el consentimiento es idempotente.
- Los modelos `.onnx` hay que volver a publicarlos en el bucket de AWS (`publicar_modelo`).
- SeaweedFS puede quedar en la VM como respaldo hasta la entrega; `almacen.<dominio>` deja de usarse para los reportes.
- Verificación sin exponer claves: `docker exec -i gcp-ia-1 python - < infra/nube/probar-s3.py`.
