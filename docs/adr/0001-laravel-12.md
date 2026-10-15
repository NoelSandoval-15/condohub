# ADR 0001 — Reservas usa Laravel 12 en vez de Laravel 11

- **Fecha**: 14/10/2026
- **Estado**: propuesta (pendiente de confirmación de Erick, dueño de `services/reservas`)

## Contexto

El stack acordado para Reservas era PHP 8.3 y Laravel 11. Al crear el servicio, `composer create-project laravel/laravel:^11.0` falló:
Composer bloquea **todas** las versiones 11.x de `laravel/framework` (hasta la 11.57) por avisos de seguridad publicados en Packagist.
Tampoco se puede instalar `firebase/php-jwt` 6.x por el mismo motivo (aviso `PKSA-y2cr-5h3j-g3ys`).

Reservas gestiona reservas y los cargos de la saga; no conviene lanzarlo con vulnerabilidades conocidas.

## Decisión

- Usar **Laravel 12** (instalado: 12.70.0) y **`firebase/php-jwt` 7** (7.2.1).
- Requerir **PHP 8.2 o superior** (`"php": "^8.2"`). Laravel 12 corre en PHP 8.2, 8.3 y 8.4; el PHP 8.3 sigue siendo recomendable pero no obligatorio.
- No desactivar la política de avisos de seguridad de Composer (`audit.block-insecure`).

## Consecuencias

- `composer audit` no reporta avisos con las dependencias actuales.
- El resto del stack de Reservas no cambia: Clean, PostgreSQL, php-amqplib, Pest, PHPStan nivel 8, Pint.
- Cambios de documentación: `CLAUDE.md` raíz (mapa del espacio de trabajo) y `services/reservas/CLAUDE.md` (stack).
- Si Erick prefiere otra cosa (por ejemplo fijar PHP 8.3 en el entorno de despliegue), basta con cambiar el estado de este ADR.
