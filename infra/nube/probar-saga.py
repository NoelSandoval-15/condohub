#!/usr/bin/env python3
"""Prueba de punta a punta de la saga de reserva con los servicios desplegados en las tres nubes.

Reservas (Google) -> Gestión (Azure, cargos) -> Acceso (AWS, pases de los invitados) -> reserva CONFIRMADA.
Uso: python3 probar-saga.py [dominio-azure]   (por omisión 68-211-120-83.sslip.io). La contraseña se pide sin mostrarla.
Opcional: al final ofrece cancelar la reserva, que revoca los pases y anula los cargos (compensación).
"""
import getpass
import json
import sys
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

DOMINIO = sys.argv[1] if len(sys.argv) > 1 else "68-211-120-83.sslip.io"
API = f"https://api.{DOMINIO}"
KEYCLOAK = f"https://auth.{DOMINIO}/realms/condohub/protocol/openid-connect/token"


def pedir(url, token=None, cuerpo=None, clave=None):
    cabeceras = {"content-type": "application/json"}
    if token:
        cabeceras["authorization"] = f"Bearer {token}"
    if clave:
        cabeceras["idempotency-key"] = clave
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    peticion = urllib.request.Request(url, data=datos, headers=cabeceras, method="POST" if datos else "GET")
    try:
        with urllib.request.urlopen(peticion, timeout=40) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null") if e.headers.get_content_type() == "application/json" else None


def login(usuario, clave):
    formulario = urllib.parse.urlencode(
        {"grant_type": "password", "client_id": "condohub-spa", "username": usuario, "password": clave}
    ).encode()
    with urllib.request.urlopen(urllib.request.Request(KEYCLOAK, data=formulario), timeout=40) as r:
        return json.loads(r.read())["access_token"]


def lista(cuerpo):
    return cuerpo.get("data", cuerpo) if isinstance(cuerpo, dict) else cuerpo


def main():
    clave = getpass.getpass("Contraseña de residente@condohub.test: ")
    token = login("residente@condohub.test", clave)
    print("login: ok")

    _, perfil = pedir(f"{API}/gestion/graphql", token, {"query": "{ miPerfil { unidades { unidadId codigo } } }"})
    unidad = perfil["data"]["miPerfil"]["unidades"][0]
    print("unidad:", unidad["codigo"])

    _, areas = pedir(f"{API}/reservas/api/areas", token)
    area = next(a for a in lista(areas) if "sal" in a["nombre"].lower())
    print("area:", area["nombre"])

    dia = (datetime.now(timezone.utc) + timedelta(days=12)).strftime("%Y-%m-%d")
    reserva = {
        "areaId": area["id"], "unidadId": unidad["unidadId"],
        "inicio": f"{dia}T14:00:00Z", "fin": f"{dia}T18:00:00Z",
        "invitados": [{"nombre": "Invitado Uno"}, {"nombre": "Invitado Dos"}],
    }
    estado, creada = pedir(f"{API}/reservas/api/reservas", token, reserva, str(uuid.uuid4()))
    print("crear reserva:", estado)
    if estado >= 300:
        print(json.dumps(creada, indent=2, ensure_ascii=False))
        return 1
    reserva_id = creada["id"]
    final = "SOLICITADA"
    for _ in range(45):
        time.sleep(2)
        _, todas = pedir(f"{API}/reservas/api/reservas", token)
        final = next(r["estado"] for r in lista(todas) if r["id"] == reserva_id)
        if final != "SOLICITADA":
            break
    print("estado final de la saga:", final)
    if final != "CONFIRMADA":
        print("La saga no llegó a CONFIRMADA: revisa los registros de reservas-saga (Google), acceso-saga (AWS) y gestion (Azure).")
        return 1

    if input("Cancelar la reserva para probar la compensación (revoca pases y anula cargos)? [s/N] ").strip().lower() == "s":
        _, todas = pedir(f"{API}/reservas/api/reservas", token)
        version = next(r["version"] for r in lista(todas) if r["id"] == reserva_id)
        estado, _ = pedir(f"{API}/reservas/api/reservas/{reserva_id}/cancelar", token,
                          {"version": version, "motivo": "prueba de la saga"}, str(uuid.uuid4()))
        print("cancelar:", estado)
        for _ in range(30):
            time.sleep(2)
            _, todas = pedir(f"{API}/reservas/api/reservas", token)
            final = next(r["estado"] for r in lista(todas) if r["id"] == reserva_id)
            if final == "CANCELADA":
                break
        print("estado tras cancelar:", final)
    return 0


if __name__ == "__main__":
    sys.exit(main())
