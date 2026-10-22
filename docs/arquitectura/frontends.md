# Arquitectura de los frontends — CondoHub

Guía de ingeniería para `shell`, `admin` (Angular), `residente` y `guardia` (React). Complementa [ddd.md](ddd.md): allí se cortan los servicios; aquí se organiza el código de la interfaz. Las reglas de negocio (F, R, A, I...) siguen en [reglas-de-negocio.md](../negocio/reglas-de-negocio.md).

## 1. Arquitectura elegida: Clean por capas dentro de cada feature

Los servicios usan Clean (y Gestión, Hexagonal); los frontends siguen el mismo criterio para que el equipo use un solo modelo mental. **Una feature = una carpeta vertical** con cuatro capas. Las dependencias apuntan siempre hacia el dominio.

```
ui  ──►  application  ──►  domain
              │
              ▼
        infrastructure  (implementa los puertos que declara application)
```

| Capa | Qué contiene | Puede importar | No puede importar |
|---|---|---|---|
| `domain/` | Tipos, objetos de valor y reglas puras (ej. `evaluar` de A4, `Placa`, `Dinero`) | Solo TypeScript | React, Angular, `fetch`, `localStorage`, DOM |
| `application/` | Casos de uso y estado de la pantalla (hooks en React, servicios con signals en Angular); declara los **puertos** (interfaces) | `domain/` | Componentes, detalles de red o navegador |
| `infrastructure/` | Adaptadores: cliente HTTP/GraphQL, cámara, IndexedDB, `localStorage`, modelos ONNX | `domain/`, tipos de los puertos | `ui/` |
| `ui/` | Componentes de presentación | `application/`, `domain/` (solo tipos) | `infrastructure/` directo |

La composición (qué adaptador se entrega a qué caso de uso) ocurre en **un solo lugar por feature**: `index.ts` o el contenedor de la página.

## 2. Estructura de carpetas

```
src/
├── features/
│   └── placas/                  # una carpeta por función de negocio
│       ├── domain/              # decision.ts, placa.ts
│       ├── application/         # usePlacas.ts, puertos.ts
│       ├── infrastructure/      # lectorIa.ts, camara.ts, listaLocal.ts
│       ├── ui/                  # PlacasPage.tsx, VisorCamara.tsx, ResultadoLectura.tsx
│       └── index.ts             # única puerta de entrada de la feature
├── shared/                      # solo lo usado por 2+ features
│   ├── ui/                      # botón, alerta, tarjeta
│   ├── api/                     # cliente con token del shell, errores problem+json
│   └── lib/                     # formateo de moneda y fechas, utilidades puras
├── offline/                     # cola IndexedDB, sincronización (O1–O4)
├── app/                         # mount/unmount, rutas, proveedores
└── entorno.ts                   # configuración (URL del gateway), nunca dentro de componentes
tests/                           # espejo de src/, o *.test.ts junto al archivo
```

Reglas de carpetas:
- Una feature **no importa** de otra feature. Si dos la necesitan, lo común sube a `shared/` (solo cuando ya hay dos usos reales; no antes).
- Se importa una feature solo por su `index.ts`, nunca por rutas internas.
- Ningún frontend importa código de otro por ruta relativa (`../../`): igual que los servicios.
- Un archivo de `shared/` no importa de `features/`.

## 3. Límites de tamaño (obligatorios)

| Elemento | Límite | Si se pasa |
|---|---|---|
| Componente (archivo `.tsx`, o `.ts` + plantilla en Angular) | **100 líneas** | Extraer subcomponentes o mover la lógica a un hook/servicio |
| Función o método | 30 líneas | Dividir; un nombre por intención |
| Archivo que no es componente (hook, servicio, adaptador) | 150 líneas | Dividir por responsabilidad |
| Parámetros de una función | 3 | Agrupar en un objeto tipado |
| Nivel de anidación (`if`/`for`/ternario) | 3 | Retorno temprano o función auxiliar |
| Props de un componente | 6 | Agrupar o revisar si hace demasiado |
| Hoja de estilos de un componente | 80 líneas | Dividir o usar variables compartidas |

Las líneas cuentan sin comentarios ni líneas en blanco. Un archivo de **pruebas** o de **datos** no entra en el límite, pero se divide por tema cuando supera 200 líneas.

## 4. Reglas de componentes

1. **Un componente, una responsabilidad.** Si su nombre necesita «y» (`ListaYFormulario`), son dos.
2. **Presentación sin lógica de negocio.** Recibe datos y eventos por props; no calcula montos, estados ni decisiones. Los cálculos viven en `domain/` (ver «Nunca» del `CLAUDE.md` raíz).
3. **El estado y los efectos van en hooks o servicios**, no en el cuerpo del componente: `usePlacas()` devuelve `{ decision, error, iniciar, detener }` y el componente solo pinta.
4. **Un componente de página (`*Page`) compone**; los de presentación no hacen llamadas de red.
5. **Efectos con limpieza.** Todo `setInterval`, suscripción, cámara o listener se libera al desmontar (el shell monta y desmonta remotos).
6. **Sin `any`.** Los datos externos se validan o se tipan en el adaptador; la UI recibe tipos del dominio.
7. **Estilos con variables del shell** (`--ch-*`) y clases con prefijo `ch-`; nada de colores fijos repetidos.
8. **Accesibilidad mínima:** botones reales (`<button>`), `aria-label` donde no hay texto, `role="alert"` en errores, `role="status"` en resultados que cambian, contraste legible en la caseta.
9. **Texto de interfaz en español**, sin cadenas sueltas repetidas: constantes por feature.

## 5. Reglas de código

- **Dominio puro y probado primero** (test con el código de la regla en el nombre: `A4_placa_no_registrada_nunca_se_permite`).
- **Puertos para todo lo que toca el mundo:** red, cámara, almacenamiento, reloj, UUID. Así el dominio y la aplicación se prueban sin navegador.
- **Dinero:** string decimal; nunca `number` para operar (regla 8 del `CLAUDE.md` raíz). Fechas en UTC y formateo solo en la capa `ui/`.
- **Errores:** los adaptadores traducen errores técnicos a errores de dominio con mensaje comprensible (el cuerpo `problem+json` trae `code` de la regla violada). Un error nunca rompe el shell.
- **Idempotencia y offline:** toda escritura de una PWA lleva `Idempotency-Key` generada una sola vez (O1–O4). Vive en `offline/`, no en componentes.
- **Rendimiento:** carga perezosa de pantallas pesadas; modelos de IA y cámara se inicializan al entrar a la pantalla, no al montar el remoto; trabajo pesado (inferencia) en Web Worker; `memo`/`computed` solo donde se midió un problema.
- **Nombres:** conceptos de dominio en español del lenguaje ubicuo (`Unidad`, `Expensa`, `evaluar`); piezas técnicas en inglés (`Adapter`, `Page`, `use…`). Archivos: componentes `PascalCase.tsx`, el resto `camelCase.ts`.
- **Comentarios:** solo el porqué (una regla, una decisión, un `TODO(regla)`); no repetir lo que dice el código.
- **Sin dependencias nuevas** sin justificarlas en el PR; prefiere la plataforma web y lo que el frontend ya usa.

## 6. Cómo se aplica por tecnología

| Frontend | Casos de uso y estado | Componentes |
|---|---|---|
| React (`shell`, `residente`, `guardia`) | Hooks `use…` en `application/` | Funciones en `ui/`, props tipadas |
| Angular 18 (`admin`) | Servicios `@Injectable` con `signal`/`computed` en `application/` | Componentes standalone con `ChangeDetectionStrategy.OnPush`, plantilla con `@if`/`@for`; plantilla y estilos en archivos aparte cuando pasan de 40 líneas |

El contrato con el shell no cambia: cada remoto exporta `mount(el, { getToken, user })` y `unmount(el)`.

## 7. Cómo se verifica

- Los límites de la sección 3 y la regla de dependencias de la sección 1 se comprueban en el **lint** (reglas `max-lines`, `max-lines-per-function`, `complexity` y `no-restricted-imports` por capa, en ESLint; equivalente en Angular). Hasta que esté configurado, se revisan en el PR.
- Cada feature trae pruebas de `domain/` (sin DOM) y de `application/` (con puertos falsos); la UI se prueba por comportamiento visible, no por detalles internos.
- Definición de terminado de una pantalla: capas respetadas, ningún archivo sobre el límite, pruebas en verde, sin `any`, limpieza de efectos comprobada y sección «Estado» del `CLAUDE.md` del frontend al día.

## 8. Código que ya existe

La regla de oro del `CLAUDE.md` raíz sigue vigente: el código funcional en `main` **no se reorganiza** solo por cumplir esta guía. Esta estructura aplica al código **nuevo** y a lo que se toque por una tarea concreta; una migración de un archivo existente se hace solo cuando la tarea la pide y con confirmación.
