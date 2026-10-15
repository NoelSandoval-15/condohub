# ADR 0002 — Almacén de objetos S3: SeaweedFS en lugar de MinIO

- **Fecha**: 14/10/2026
- **Estado**: propuesta (pendiente de confirmación de Erick, dueño de `infra/`)

## Contexto

El diseño pedía MinIO para guardar fotos, audio, comprobantes y pesos de modelos (regla I6: nada de eso va a git ni a las bases de datos).
La imagen fijada en `infra/docker-compose.yml` (`minio/minio:RELEASE.2024-08-17T01-24-54Z`) dejó de poder descargarse: MinIO dejó de publicar
imágenes comunitarias públicas, y tanto Docker Hub como `quay.io` responden con acceso denegado, incluso con `latest`. Con eso,
`docker compose up` fallaba en ese servicio.

## Decisión

Usar **SeaweedFS** (`chrislusf/seaweedfs:3.85`, imagen pública en Docker Hub) con su **API S3** como almacén de objetos.

- Los servicios hablan **S3 estándar** (endpoint `http://localhost:9000` desde el host, `http://minio:9000` dentro de Docker; región cualquiera,
  por ejemplo `us-east-1`). Cualquier cliente S3 sirve: `boto3`, el cliente `minio` de Python, AWS SDK para JS o PHP.
- Se conserva el nombre del servicio `minio` en el compose y las variables `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` en `.env.example`
  para no tocar la documentación ni el código que ya los menciona. El código no debe depender de nada específico de MinIO ni de SeaweedFS.
- Las credenciales de desarrollo están en `infra/seaweedfs/s3.json` y deben coincidir con las de `.env`.
- Buckets previstos: `modelos` (rutas `modelos/<nombre>/<version>/`), y los que necesiten IA y el portal del residente. Se crean desde el cliente S3.

## Consecuencias

- Verificado: crear bucket, subir, listar y bajar con el cliente AWS CLI; el archivo vuelve idéntico; credenciales falsas y accesos sin firma se rechazan.
- No hay consola web en el puerto 9001 (MinIO la traía). SeaweedFS expone un panel del maestro en `http://localhost:9333`.
- Las URLs firmadas (`presigned`) que usa `ia.yaml` para el modelo de placas y los reportes funcionan con firma S3 v4, pero **no se han probado todavía**;
  quien implemente `GET /modelos/placas/actual` debe verificarlas.
- Alternativas descartadas: Garage (requiere inicializar el layout del clúster a mano), RustFS (proyecto muy joven), y construir MinIO desde el código fuente (lento y frágil).
- Si el equipo prefiere otro almacén, basta con cambiar el servicio `minio` del compose; los servicios no se enteran mientras hablen S3.
