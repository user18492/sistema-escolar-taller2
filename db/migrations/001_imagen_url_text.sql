-- Correr esto si se uso el schema antes de cambiar la columna imagen_url a TEXT. Esto es para que no rompa el schema.sql.
-- Parado desde la carpeta raiz del proyecto:
-- Comando: psql -U tu_user -d nombre_db -f db/migrations/001_imagen_url_text.sql

-- db/migrations/001_imagen_url_text.sql
-- La columna imagen_url guardaba VARCHAR(255), pero un avatar en base64
-- (dataURL) supera ese límite fácilmente. La pasamos a TEXT.

ALTER TABLE usuarios
    ALTER COLUMN imagen_url TYPE TEXT;
