#!/bin/bash
# Se ejecuta primero (orden alfabético) en el initdb del contenedor PostGIS.
# Crea los roles de aplicación con contraseñas tomadas del entorno del contenedor
# (definirlas en infra/.env: ENELEJE_APP_DB_PASSWORD / ENELEJE_MIGRATOR_DB_PASSWORD).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Rol de la aplicación: solo DML, sin DDL ni superusuario. La RLS lo restringe fila a fila.
    DO \$\$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eneleje_app') THEN
            CREATE ROLE eneleje_app LOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eneleje_migrator') THEN
            CREATE ROLE eneleje_migrator LOGIN;
        END IF;
    END \$\$;

    ALTER ROLE eneleje_app PASSWORD '${ENELEJE_APP_DB_PASSWORD:-cambiar_esta_clave}';
    ALTER ROLE eneleje_migrator PASSWORD '${ENELEJE_MIGRATOR_DB_PASSWORD:-cambiar_esta_clave}';

    -- endurecer esquema: nada de crear objetos en public para roles sin permiso explícito
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
EOSQL

echo "Roles de aplicación creados."
