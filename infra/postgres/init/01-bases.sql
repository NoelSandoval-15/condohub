-- Una base y un usuario por servicio (regla: ningún servicio lee la base de otro).
-- Lo ejecuta la imagen oficial de postgres la primera vez que arranca el volumen.
-- Contraseñas solo de desarrollo; en otros entornos vienen de secretos.

CREATE USER gestion  WITH PASSWORD 'gestion_dev';
CREATE USER reservas WITH PASSWORD 'reservas_dev';
CREATE USER keycloak WITH PASSWORD 'keycloak_dev';
CREATE USER n8n      WITH PASSWORD 'n8n_dev';

CREATE DATABASE gestion  OWNER gestion;
CREATE DATABASE reservas OWNER reservas;
CREATE DATABASE keycloak OWNER keycloak;
CREATE DATABASE n8n      OWNER n8n;

-- Nadie entra a una base ajena
REVOKE ALL ON DATABASE gestion  FROM PUBLIC;
REVOKE ALL ON DATABASE reservas FROM PUBLIC;
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
REVOKE ALL ON DATABASE n8n      FROM PUBLIC;

-- Extensiones que necesitan superusuario (las migraciones las usan con IF NOT EXISTS)
\connect gestion
CREATE EXTENSION IF NOT EXISTS pgcrypto;
\connect reservas
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
