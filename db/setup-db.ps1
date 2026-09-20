# Prepara la base de datos del proyecto en un entorno local:
#   1) Lee la configuración de conexión desde el archivo .env de la raíz.
#   2) Se conecta a la base administrativa "postgres" y crea la base DB_NAME.
#   3) Ejecuta sobre esa base db/schema.sql y luego db/seed.sql.
#
# Si la base ya existe, el script aborta sin modificar nada: schema.sql no
# contiene sentencias DROP, así que volver a ejecutarlo fallaría. Para
# reinicializar, borrar la base manualmente y volver a correr este script.
#
# Requisitos:
#   - psql accesible desde el PATH (carpeta bin de PostgreSQL).
#   - Un archivo .env válido (copiar .env.example a .env).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File db\setup-db.ps1
#   powershell -ExecutionPolicy Bypass -File db\setup-db.ps1 -EnvFile C:\ruta\.env

[CmdletBinding()]
param(
    # Ruta al archivo .env. Por defecto, el de la raíz del proyecto.
    [string]$EnvFile
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

if (-not $EnvFile) {
    $EnvFile = Join-Path $projectRoot '.env'
}

# Base administrativa desde la que se crea la base del proyecto.
$adminDatabase = 'postgres'

# --- Utilidades -------------------------------------------------------------

# Lee un archivo .env y devuelve sus pares clave/valor como hashtable.
function Read-EnvFile {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "No se encontró el archivo de configuración '$Path'. Copiá .env.example a .env y ajustá los valores."
    }

    $settings = @{}

    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $trimmed = $line.Trim()

        # Ignora líneas vacías y comentarios.
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }

        $separatorIndex = $trimmed.IndexOf('=')
        if ($separatorIndex -lt 1) { continue }

        $key = $trimmed.Substring(0, $separatorIndex).Trim()
        $value = $trimmed.Substring($separatorIndex + 1).Trim()

        # Admite valores entre comillas simples o dobles.
        if ($value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        $settings[$key] = $value
    }

    return $settings
}

# Devuelve el valor de una variable obligatoria del .env.
function Get-RequiredSetting {
    param(
        [Parameter(Mandatory)][hashtable]$Settings,
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][string]$Path
    )

    $value = $Settings[$Key]
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Falta la variable '$Key' en '$Path'."
    }

    return $value
}

# Escapa un texto para usarlo como literal SQL.
function ConvertTo-SqlLiteral {
    param([Parameter(Mandatory)][string]$Value)

    return "'" + $Value.Replace("'", "''") + "'"
}

# Ejecuta psql contra la base indicada. Corta la ejecución si psql falla.
function Invoke-Psql {
    param(
        [Parameter(Mandatory)][string]$Database,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$ErrorMessage
    )

    $connectionArgs = @(
        '--host', $script:dbHost,
        '--port', $script:dbPort,
        '--username', $script:dbUser,
        '--dbname', $Database,
        '--no-password',
        '--set', 'ON_ERROR_STOP=1'
    )

    $output = & psql @connectionArgs @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw $ErrorMessage
    }

    return $output
}

# --- Script principal -------------------------------------------------------

$previousPassword = $env:PGPASSWORD
$previousClientEncoding = $env:PGCLIENTENCODING

try {
    foreach ($tool in @('psql', 'createdb')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "No se encontró '$tool' en el PATH. Agregá la carpeta bin de PostgreSQL a la variable de entorno PATH."
        }
    }

    $schemaFile = Join-Path $scriptDir 'schema.sql'
    $seedFile = Join-Path $scriptDir 'seed.sql'

    foreach ($sqlFile in @($schemaFile, $seedFile)) {
        if (-not (Test-Path -LiteralPath $sqlFile -PathType Leaf)) {
            throw "No se encontró el archivo SQL '$sqlFile'."
        }
    }

    $settings = Read-EnvFile -Path $EnvFile

    $dbHost = Get-RequiredSetting -Settings $settings -Key 'DB_HOST' -Path $EnvFile
    $dbPort = Get-RequiredSetting -Settings $settings -Key 'DB_PORT' -Path $EnvFile
    $dbName = Get-RequiredSetting -Settings $settings -Key 'DB_NAME' -Path $EnvFile
    $dbUser = Get-RequiredSetting -Settings $settings -Key 'DB_USER' -Path $EnvFile
    $dbPassword = Get-RequiredSetting -Settings $settings -Key 'DB_PASSWORD' -Path $EnvFile

    # psql toma la contraseña de PGPASSWORD; los .sql están en UTF-8.
    $env:PGPASSWORD = $dbPassword
    $env:PGCLIENTENCODING = 'UTF8'

    Write-Host "Configuración: $dbUser@${dbHost}:$dbPort/$dbName" -ForegroundColor Cyan

    # 1) Verifica contra la base administrativa si la base del proyecto ya existe.
    $existsQuery = "SELECT 1 FROM pg_database WHERE datname = $(ConvertTo-SqlLiteral $dbName);"
    $existing = Invoke-Psql -Database $adminDatabase `
        -Arguments @('--tuples-only', '--no-align', '--command', $existsQuery) `
        -ErrorMessage "No se pudo conectar a la base administrativa '$adminDatabase' como '$dbUser'. Revisá que PostgreSQL esté en ejecución y que las credenciales del .env sean correctas."

    if (($existing | Out-String).Trim() -eq '1') {
        throw "La base '$dbName' ya existe. Borrala manualmente (DROP DATABASE) antes de volver a ejecutar este script."
    }

    # 2) Crea la base del proyecto. Se usa createdb (y no un CREATE DATABASE por
    # línea de comandos) porque Windows PowerShell descarta las comillas dobles
    # al pasar argumentos a un ejecutable nativo y el nombre de la base lleva
    # guiones, así que necesita ir comillado como identificador.
    Write-Host "Creando la base '$dbName'..." -ForegroundColor Cyan
    & createdb --host $dbHost --port $dbPort --username $dbUser --no-password --maintenance-db $adminDatabase $dbName
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo crear la base '$dbName'."
    }

    # 3) Aplica el esquema y los datos de prueba, en ese orden.
    Write-Host "Ejecutando schema.sql..." -ForegroundColor Cyan
    Invoke-Psql -Database $dbName `
        -Arguments @('--quiet', '--file', $schemaFile) `
        -ErrorMessage "Falló la ejecución de 'schema.sql'. La base '$dbName' quedó creada pero incompleta: borrala antes de reintentar."

    Write-Host "Ejecutando seed.sql..." -ForegroundColor Cyan
    Invoke-Psql -Database $dbName `
        -Arguments @('--quiet', '--file', $seedFile) `
        -ErrorMessage "Falló la ejecución de 'seed.sql'. La base '$dbName' quedó creada pero incompleta: borrala antes de reintentar."

    Write-Host "Listo: la base '$dbName' quedó creada con el esquema y los datos de prueba." -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    $env:PGPASSWORD = $previousPassword
    $env:PGCLIENTENCODING = $previousClientEncoding
}
