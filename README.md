# sistema-escolar-taller2
Sistema escolar de primaria y secundaria

## Requisitos
- Windows con PowerShell (`npm run db:setup` ejecuta `db/setup-db.ps1`).
- [Node.js](https://nodejs.org/), que incluye `npm`.
- [PostgreSQL](https://www.postgresql.org/download/), con su carpeta `bin` en la variable de entorno `PATH`, para que `psql`, `createdb` y `dropdb` se reconozcan desde la terminal.

## Preparación
Desde la raíz del proyecto:

1. `Copy-Item .env.example .env`: crea el archivo de configuración. Ajustar `DB_USER` y `DB_PASSWORD` si no coinciden con los de la instalación local de PostgreSQL.
2. `npm install`: instala las dependencias.
3. `npm run db:setup`: crea la base `DB_NAME` y ejecuta `db/schema.sql` y `db/seed.sql`. Si la base ya existe, no realiza cambios.
4. `npm start`: inicia la aplicación. Si no puede conectarse a la base, muestra el motivo y se cierra.

## Reinicialización de la base
`npm run db:setup` no modifica una base que ya existe. Si cambian `db/schema.sql` o `db/seed.sql`, borrar la base y volver a crearla:

```powershell
dropdb -U postgres sistema-escolar-taller2-db
npm run db:setup
```

- El comando usa los valores de `.env.example`; si el `.env` tiene otros, reemplazar el usuario (`DB_USER`) y el nombre de la base (`DB_NAME`).
- Antes de borrarla, salir de la aplicación desde el ícono de la bandeja del sistema: cerrar la ventana solo la oculta, y PostgreSQL no borra una base con conexiones abiertas.
