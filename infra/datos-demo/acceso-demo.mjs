#!/usr/bin/env node
// Datos sintéticos de portería para la demo: bitácora de siete días (ingresos y salidas de residentes con placa, visitas con
// pase QR y visitas rechazadas), pases vigentes para los días de la defensa y una corrección (A3).
// Solo agrega (A3): cada ítem se escribe con attribute_not_exists, así que correrlo dos veces no duplica.
//
//   Local:  DYNAMODB_ENDPOINT=http://localhost:8000 node infra/datos-demo/acceso-demo.mjs
//   AWS:    copiar a la VM y ejecutar dentro del contenedor de Acceso (usa el rol de IAM, sin claves):
//             docker cp acceso-demo.mjs aws-acceso-1:/app/acceso-demo.mjs && docker exec aws-acceso-1 node /app/acceso-demo.mjs
import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLA = process.env.TABLA_ACCESO ?? 'condohub-acceso';
const local = Boolean(process.env.DYNAMODB_ENDPOINT);
const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(local && { endpoint: process.env.DYNAMODB_ENDPOINT, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }),
  }),
);
const GUARDIA = '00000000-0000-0000-0000-00000000a003';

const uuid = (n) => {
  const h = createHash('sha1').update(`condohub-demo-acceso:${n}`).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};
// Generador pseudoaleatorio con semilla fija: los mismos datos en cada corrida y en cada entorno.
let semilla = 20261106;
const azar = () => ((semilla = (semilla * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const elegir = (l) => l[Math.floor(azar() * l.length)];

let escritos = 0;
async function agregar(item) {
  try {
    await doc.send(new PutCommand({ TableName: TABLA, Item: item, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' }));
    escritos++;
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException') throw e;
  }
}

const placa = (n) => `${1000 + n}ABC`;
const unidadDe = (n) => `A-${100 + n}`;
const hora = (dia, h, m) => `${dia}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const dias = (desde, cantidad) => Array.from({ length: cantidad }, (_, i) => new Date(Date.parse(`${desde}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));

// 1) Placas de residentes (A4): las mismas 50 de la semilla de Acceso, por si la tabla no las tiene
for (let n = 1; n <= 50; n++) {
  await agregar({ PK: `PLACA#${placa(n)}`, SK: 'META', tipo: 'Vehiculo', placa: placa(n), unidadCodigo: unidadDe(n), activa: true,
                  GSI1PK: `UNIDAD#${unidadDe(n)}`, GSI1SK: `PLACA#${placa(n)}` });
}

// 2) Visitas con pase QR (A1) para los días de la defensa (10 y 11 de noviembre) y para la semana que pasó
const NOMBRES = ['Carlos Mamani', 'Lucía Quispe', 'Pedro Condori', 'Rosa Flores', 'Jorge Vargas', 'Marta Choque', 'Luis Ticona', 'Ana Gutiérrez'];
const pases = []; // los de la semana pasada se usaron en la bitácora
let visitaNro = 0;
async function visita(dia, n, estado) {
  const unidadCodigo = unidadDe(n);
  const visitaId = uuid(`visita:${++visitaNro}`);
  const codigo = `QR-DEMO-${String(visitaNro).padStart(3, '0')}`;
  const nombre = NOMBRES[visitaNro % NOMBRES.length];
  await agregar({ PK: `UNIDAD#${unidadCodigo}`, SK: `VISITA#${dia}#${visitaId}`, tipo: 'Visita', visitaId, nombre,
                  documento: `CI-${7000000 + visitaNro * 137}`, registradaPor: GUARDIA, creadaEn: `${dia}T12:00:00.000Z` });
  const usado = estado === 'USADO';
  await agregar({ PK: `PASE#${codigo}`, SK: 'META', tipo: 'Pase', codigo, visitaId, unidadCodigo, estado, usos: usado ? 1 : 0, usosMaximos: 1,
                  validoDesde: `${dia}T07:00:00-04:00`, validoHasta: `${dia}T23:59:59-04:00`, origen: 'VISITA',
                  GSI1PK: `PASES#${dia}`, GSI1SK: `PASE#${codigo}` });
  return { codigo, unidadCodigo, dia };
}
for (const dia of ['2026-11-10', '2026-11-11']) for (let i = 0; i < 6; i++) await visita(dia, entre(1, 50), 'VIGENTE');
const semana = dias('2026-10-31', 7);
for (const dia of semana) for (let i = 0; i < 2; i++) pases.push(await visita(dia, entre(1, 50), 'USADO'));

// 3) Bitácora de portería (A3, append-only): entre 9 y 14 movimientos por día
let registros = 0;
async function registro(r) {
  const registroId = uuid(`registro:${++registros}`);
  const ts = r.hora;
  await agregar({ PK: `DIA#${ts.slice(0, 10)}`, SK: `ACCESO#${ts}#${registroId}`, tipo: 'RegistroAcceso', registroId,
                  horaDispositivo: ts, horaServidor: ts, guardiaSub: GUARDIA, resultado: 'PERMITIDO', ...r.campos,
                  ...(r.campos.unidadCodigo ? { GSI2PK: `UNIDAD#${r.campos.unidadCodigo}`, GSI2SK: `ACCESO#${ts}` } : {}) });
  return registroId;
}
for (const dia of semana) {
  const movimientos = entre(9, 14);
  for (let i = 0; i < movimientos; i++) {
    const h = entre(6, 22), m = entre(0, 59);
    const tipo = azar();
    if (tipo < 0.55) { // residente con vehículo registrado (A4, confianza alta)
      const n = entre(1, 50);
      const sentido = h < 13 ? elegir(['SALIDA', 'SALIDA', 'INGRESO']) : elegir(['INGRESO', 'INGRESO', 'SALIDA']);
      await registro({ hora: hora(dia, h, m), campos: { sentido, categoria: 'VEHICULO', placa: placa(n), unidadCodigo: unidadDe(n),
                                                          confianzaPlaca: Number((0.86 + azar() * 0.13).toFixed(3)) } });
    } else if (tipo < 0.8) { // visita con pase QR
      const p = pases.filter((x) => x.dia === dia)[entre(0, 1)] ?? pases[0];
      await registro({ hora: hora(dia, h, m), campos: { sentido: 'INGRESO', categoria: 'PEATON', paseCodigo: p.codigo, unidadCodigo: p.unidadCodigo } });
    } else if (tipo < 0.92) { // visita sin pase: el guardia decide y registra la unidad que autoriza (A2)
      const n = entre(1, 50);
      await registro({ hora: hora(dia, h, m), campos: { sentido: 'INGRESO', categoria: 'PEATON', unidadCodigo: unidadDe(n), motivo: 'Visita sin pase autorizada por el residente' } });
    } else { // vehículo no registrado: el guardia lo rechaza con motivo (A4)
      await registro({ hora: hora(dia, h, m), campos: { sentido: 'INGRESO', categoria: 'VEHICULO', placa: `${entre(2000, 9999)}XYZ`, confianzaPlaca: Number((0.4 + azar() * 0.3).toFixed(3)),
                                                          resultado: 'RECHAZADO', motivo: 'Placa no registrada y sin autorización del residente' } });
    }
  }
}
// Un error del guardia se corrige con otro registro que lo referencia (A3), nunca se edita el original
const errado = await registro({ hora: hora('2026-11-05', 9, 5), campos: { sentido: 'INGRESO', categoria: 'VEHICULO', placa: placa(7), unidadCodigo: unidadDe(7), confianzaPlaca: 0.91 } });
await registro({ hora: hora('2026-11-05', 9, 7), campos: { sentido: 'SALIDA', categoria: 'VEHICULO', placa: placa(7), unidadCodigo: unidadDe(7), corrigeA: errado,
                                                            motivo: 'Corrección: el vehículo salía, no ingresaba' } });

console.log(`Acceso (${local ? 'local' : 'AWS'}): ${escritos} ítems nuevos, ${registros} movimientos y ${visitaNro} visitas con pase`);
