#!/usr/bin/env python3
"""Verifica el almacén S3 configurado en el contenedor de IA (AWS real o SeaweedFS) sin exponer las claves.

Se ejecuta DENTRO del contenedor, que ya tiene las variables S3_*:
    docker exec -i gcp-ia-1 python - < infra/nube/probar-s3.py

Comprueba, para los tres buckets de IA (reportes, modelos y rostros): que se pueda «crear» (idempotente; en AWS el bucket ya existe y
el usuario IAM solo puede nombrar esos tres), subir un objeto, bajarlo, descargarlo por una URL firmada como lo haría el navegador y,
solo en el bucket de rostros (I1: borrado real), borrarlo. Imprime OK o el error de cada paso; nunca las credenciales.
"""

import os
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from urllib.parse import urlsplit

from app.infrastructure.s3_cliente import ClienteS3
from app.infrastructure.sigv4 import url_firmada

ENDPOINT = os.environ["S3_ENDPOINT"]
PUBLICO = os.environ.get("S3_ENDPOINT_PUBLICO") or ENDPOINT
REGION = os.environ.get("S3_REGION", "us-east-1")
ACCESO = os.environ.get("S3_ACCESS_KEY", "")
SECRETO = os.environ.get("S3_SECRET_KEY", "")
BUCKETS = {
    "reportes": os.environ.get("S3_BUCKET_REPORTES", "reportes"),
    "modelos": os.environ.get("S3_BUCKET_MODELOS", "modelos"),
    "rostros": os.environ.get("S3_BUCKET_ROSTROS", "rostros"),
}
CLAVE = "_prueba/verificacion.txt"
CONTENIDO = b"CondoHub: verificacion del almacen S3\n"

cliente = ClienteS3(ENDPOINT, ACCESO, SECRETO, REGION)
fallos = 0


class Omitido(Exception):
    """Un paso que no se puede comprobar desde aquí; se avisa pero no cuenta como fallo."""


def paso(nombre: str, accion) -> bool:
    global fallos
    try:
        accion()
        print(f"  OK     {nombre}")
        return True
    except Omitido as e:
        print(f"  OMITIDO {nombre}: {e}")
        return True
    except Exception as e:  # noqa: BLE001 - se informa y se sigue con el resto
        fallos += 1
        print(f"  ERROR  {nombre}: {e}")
        return False


def descargar_con_la_api(bucket: str) -> None:
    if cliente.descargar(bucket, CLAVE) != CONTENIDO:
        raise RuntimeError("el contenido descargado no coincide con el subido")


def descargar_por_url_firmada(bucket: str) -> None:
    partes = urlsplit(PUBLICO)
    url = url_firmada(
        metodo="GET", esquema=partes.scheme, host=partes.netloc, ruta=f"/{bucket}/{CLAVE}",
        acceso=ACCESO, secreto=SECRETO, region=REGION, ahora=datetime.now(UTC), vigencia_s=120,
    )
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            cuerpo = r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} al abrir la URL firmada") from e
    except (urllib.error.URLError, OSError) as e:
        # Un endpoint solo para el navegador (p. ej. localhost:9000) no existe dentro del contenedor: no es un fallo del almacén.
        raise Omitido(f"el endpoint público no se alcanza desde el contenedor ({e})") from e
    if cuerpo != CONTENIDO:
        raise RuntimeError("el contenido descargado por la URL firmada no coincide")


print(f"Almacén: {ENDPOINT}  (región {REGION}; URLs firmadas hacia {PUBLICO})")
print(f"Credenciales configuradas: {'sí' if ACCESO and SECRETO else 'NO'}")
for nombre, bucket in BUCKETS.items():
    print(f"\nBucket de {nombre}: {bucket}")
    paso("crear/confirmar el bucket (idempotente)", lambda b=bucket: cliente.crear_bucket(b))
    if not paso("subir un objeto", lambda b=bucket: cliente.subir(b, CLAVE, CONTENIDO, "text/plain")):
        continue
    paso("descargarlo con la API", lambda b=bucket: descargar_con_la_api(b))
    paso("descargarlo por una URL firmada (como el navegador)", lambda b=bucket: descargar_por_url_firmada(b))
    if nombre == "rostros":
        paso("borrarlo de verdad (I1)", lambda b=bucket: cliente.borrar(b, CLAVE))

print("\nRESULTADO:", "todo en orden" if fallos == 0 else f"{fallos} paso(s) con error")
sys.exit(1 if fallos else 0)
