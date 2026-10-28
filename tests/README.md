# Suite de pruebas

Pruebas generales y compartidas del sistema. Cada plan de `plans/` (las restricciones pendientes de
`notas/restricciones/`) se ejecuta en una sesión distinta, y esta suite es lo único que comparten
todas: **se corre al empezar y al terminar cada plan**, para confirmar que la aplicación sigue
funcionando como antes y no solo lo que el plan modificó. Su objetivo es detectar los bugs
invisibles: los controladores convierten los errores inesperados en una respuesta genérica y un log,
la vista muestra un aviso y nada se rompe a la vista. La suite registra todo eso y hace fallar la
prueba en la que ocurre.

## Cómo correrla

Desde la raíz del proyecto, en PowerShell o en Git Bash:

```
npm test                              # toda la suite (unos 2 a 3 minutos)
npm test -- --layer db                # una sola capa: db, main, ui o startup (o varias: db,main)
npm test -- --minimal                 # solo el flujo general mínimo (los tres roles encadenados)
npm test -- --grep enrollments        # solo las pruebas cuyo id contiene el texto (se puede repetir)
npm test -- --plan secretario-inscripciones   # informa aparte las fallas esperables de ese plan
npm test -- --keep-db                 # conserva las bases de prueba para depurar
npm test -- --list                    # lista las pruebas, con su tipo y sus etiquetas
npm test -- --update-baseline         # guarda la línea base (corrida completa y sin fallas)
```

Requisitos: los mismos de la aplicación (README.md de la raíz): `npm install`, un `.env` válido y
PostgreSQL en ejecución con `psql` en el `PATH`. La suite **no usa la base del `.env`**: solo su
servidor y su usuario, para crear bases propias. Las capas `main`, `ui` y `startup` abren la ventana
de la aplicación (y, en `startup`, su ícono en la bandeja) durante la corrida; no necesitan el foco,
así que se puede seguir usando la PC, pero no hay que cerrar esa ventana.

Código de salida: `0` todo bien; `1` alguna falla (de una prueba, de una capa que se cortó, una
prueba eliminada o modificada sin citar un plan, una falla conocida vencida); `2` el entorno no está
listo o la suite misma falló.

### Qué hace una corrida

1. **Comprueba el entorno**: Node, dependencias, `.env`, `psql`, que PostgreSQL responda y deje
   crear bases, que el reloj de la base y el de la PC den la misma fecha, que no sea cerca de la
   medianoche y que no haya otra corrida en curso.
2. **Crea la base de la corrida** (`sistema_escolar_suite_<id>_tpl`) desde `db/schema.sql` y
   `db/seed.sql`, igual que `db/setup-db.ps1` (psql con `ON_ERROR_STOP` y `PGCLIENTENCODING=UTF8`).
   Con `TEST_TODAY`, congela la fecha entre los dos (ver "Fecha y ciclo lectivo").
3. **Corre cada capa en su propio proceso** (node o Electron) con un tiempo máximo: si se cuelga, lo
   corta y las pruebas que faltaban se informan como "sin resultado".
4. **Cada grupo de pruebas trabaja sobre una copia limpia** de esa base (`CREATE DATABASE … TEMPLATE`),
   crea sus propios datos (`lib/fixtures.js`) y solo lee las filas del seed. Al cerrar el grupo se
   comprueban las invariantes de datos (`lib/invariants.js`). `plans/administrador-usuarios.md`
   relajó `asignacion-coherente`: el profesor vigente se exige solo en las asignaciones de un
   ciclo que no está cerrado, porque las de uno cerrado quedan en el histórico con el profesor
   eliminado.
5. **Borra todas las bases** al terminar (salvo `--keep-db`), muestra el resumen, guarda los
   resultados en `tests/results/` y los compara con la línea base.

Lo que genera cada corrida queda fuera de git (`tests/.gitignore`): `tests/results/` (el último
informe en `latest.txt` y `latest.json`) y `tests/.tmp/` (datos de usuario, temporales, registros de
cada capa y capturas de la ventana cuando una prueba falla; se conservan hasta la próxima corrida si
hubo fallas). La línea base (`tests/baseline/baseline.json`) sí se versiona.

## Capas

| Capa | Proceso | Qué cubre |
|---|---|---|
| `db` | node | El esquema y el seed cargan sin errores ni avisos; convenciones de nombres; toda restricción que nombra `src/main` existe; inventario de tablas, columnas, restricciones, índices, triggers, funciones y procedimientos; reglas de triggers y restricciones (cada intento en una transacción que se deshace); bloqueos con dos sesiones; guardas de seguridad de la suite. |
| `main` | Electron con `src/main` real | Cada función de `window.api` tiene su canal y su handler; matriz de permisos de todos los canales por rol y sin sesión (`main/permissions.table.js`); un caso de uso completo de cada rol por la API del preload, comprobado en la base; flujo mínimo por IPC; controles de la ventana; pruebas que provocan fallas para confirmar la detección. |
| `ui` | Electron con `src/main` real | Pocos flujos con mouse y teclado reales: el flujo mínimo, el login (elección de cuenta, cuenta recordada, credenciales inválidas, sesión cortada); recorrido de todas las vistas de cada rol (`ui/views.table.js`) y bloqueo de las vistas de otro rol; lo de un ciclo lectivo cerrado en solo lectura; la edición en Docencia de una asignación de un profesor suspendido, que hay que reemplazar; en Docencia, una asignación con evaluaciones, con Eliminar deshabilitado y el curso y la materia bloqueados al editarla; en Cursos, un curso con asignaciones docentes o inscripciones, con Editar y Eliminar deshabilitados; en Alumnos, un alumno con una inscripción activa, con Egresado deshabilitado al editarlo; en Inscripciones, Editar ofrece solo Activa y Cancelada, y una inscripción con calificaciones tiene Eliminar deshabilitado; Calificaciones de una evaluación con fecha futura en solo lectura; la advertencia al eliminar una evaluación calificada, con la cantidad de calificaciones; bugs conocidos. |
| `startup` | node, que lanza `main.js` real | Arranque con la base caída o inexistente (diálogo y cierre), arranque normal (ventana, ✕ que oculta, bandeja y Salir), cierre de los ciclos lectivos vencidos al arrancar y base que deja de responder con la app abierta. |

El **flujo general mínimo** (`--minimal`) encadena los tres roles, por IPC (`main/minimal-flow.test.js`)
y con la interfaz (`ui/minimal-flow.test.js`): el administrador crea un curso del ciclo actual y le
asigna un profesor activo; el secretario crea un alumno, lo inscribe en ese curso e imprime el
comprobante; el profesor ve la asignación y al alumno, crea una evaluación con fecha de hoy y le carga
una nota que persiste. Usa solo operaciones que ninguna restricción pendiente prohíbe, así que tiene
que pasar igual antes y después de todos los planes.

## Fallas silenciosas que se detectan

Mientras corre cada prueba, la suite registra (`lib/monitor.js`, `lib/electron/app-harness.js`):

- cada llamada IPC con su resultado: excepciones en un handler, `UNEXPECTED_ERROR`, rechazos que la
  prueba no declaró, `INVALID_INPUT` (datos inválidos enviados por la interfaz) y llamadas que no
  responden en 10 s; las que tardan más de 1,5 s generan un **aviso** sin hacer fallar la prueba;
- errores y advertencias de consola del proceso principal y del renderer;
- excepciones y promesas rechazadas sin capturar, en los dos procesos;
- recursos que no cargan, caídas o bloqueos del renderer, diálogos del proceso principal;
- estados de error visibles (`lib/electron/page-probe.js`): toasts de error, mensajes de carga
  fallida y "No se pudo guardar"; el recorrido de vistas además falla si una tabla queda vacía cuando
  la base tiene filas para mostrar;
- avisos de PostgreSQL (NOTICE, WARNING) de las conexiones de la aplicación y de la suite.

**Cada prueba declara los errores que espera**; cualquier otro hace fallar la prueba:

```js
await t.rejects('DUPLICATE_VALUE', 'users.create', datos);      // llama y comprueba el código
t.allowRejection('auth:login', 'INVALID_CREDENTIALS', 'motivo'); // la interfaz va a recibir ese rechazo
t.allow('console', /mensaje esperado/, 'motivo');                // otro evento esperado
```

`allowRejection` nunca tapa un `UNEXPECTED_ERROR`. Una demora esperada se declara con
`t.allow('ipc-slow', /canal/)`; sin declarar, solo queda como aviso. El ruido que todavía no se corrigió y aparece en
muchas pruebas (por ejemplo, el aviso de Electron por la falta de Content-Security-Policy) está en
`known-issues.js`, con motivo y vencimiento; el informe lo cuenta aparte.

Las pruebas `*.detection.*` provocan cada tipo de falla a propósito (inyectándola en la biblioteca
`pg` o en Electron, nunca cambiando la aplicación) y comprueban que la detección funciona.

## Aislamiento

- **Base**: bases con el prefijo `sistema_escolar_suite_`. La suite se niega a crear, clonar, borrar
  o conectarse a cualquier otra, y nunca a la del `.env` (`lib/env.js`, `lib/pg-admin.js`); antes de
  que un grupo escriba, comprueba desde la propia conexión de la aplicación (`connection.js`) que está
  en la base de prueba, y si no, aborta toda la corrida. Las bases de corridas cortadas se borran en
  la próxima.
- **Datos de usuario de Electron** (cuenta recordada, fotos de perfil): una carpeta propia en
  `tests/.tmp`, que se vacía entre grupos.
- **Archivos temporales** (los PDF del comprobante): carpeta temporal propia (`app.setPath('temp')`).
- **Visor de PDF**: `shell.openPath` reemplazado; la prueba recibe la ruta del PDF generado.
- **Portapapeles**: el del renderer se reemplaza en cada vista; al final se comprueba que el del
  sistema no cambió.
- **Diálogos**: se registran sin mostrarse.

## Fecha y ciclo lectivo

La base toma la fecha de una única función, `fn_fecha_actual()` (`db/schema.sql`): la usan las reglas
del ciclo lectivo (lo de un ciclo cerrado queda en solo lectura y en uno futuro no se carga nada), la
fecha de inscripción por defecto y el seed, que carga siempre el ciclo lectivo actual. Las pruebas
toman la fecha de la base (`lib/clock.js`) y crean sus propios cursos del ciclo actual. El ciclo
lectivo sale siempre de `fn_fecha_actual()`, también en el proceso principal y en el renderer
(`school-years:get-current`, el rechazo `SCHOOL_YEAR_CLOSED`, el cierre de los ciclos al arrancar y lo
de un ciclo cerrado en solo lectura en las vistas, `plans/ciclo-lectivo/`). Solo las edades de
usuarios y alumnos y las validaciones de fecha del renderer siguen con el reloj del proceso, así que
la corrida no empieza si el reloj de la base y el de la PC no dan la misma fecha.

`TEST_TODAY=AAAA-MM-DD npm test` congela la fecha: reemplaza `fn_fecha_actual()` en la plantilla de la
corrida, antes de cargar el seed (que así carga el ciclo de esa fecha), y en cada copia, nunca en la
base del `.env`. Con ella quedan afuera solo las edades y las validaciones de fecha del renderer, que
siguen con el reloj del proceso (en PowerShell, `$env:TEST_TODAY = 'AAAA-MM-DD'` antes de correrla).

**La línea base vale para el año en que se tomó**, y el informe advierte cuando la corrida es de otro:
el seed ya no queda en un ciclo cerrado, porque carga el de la fecha de la corrida, pero cambian los
resultados que dependen del día (por ejemplo, cuántas evaluaciones del seed ya tienen calificaciones).

## Escribir y mantener pruebas

Cada archivo `*.test.js` de `db/`, `main/`, `ui/` o `startup/` define grupos y pruebas:

```js
const { group, test } = require('../lib/framework');

group('main.secretary.enrollments', 'Secretario: inscripciones', {
  async setup({ fixtures }) { return { course: await fixtures.createCourse() }; },
}, () => {
  test('create', 'El alta inscribe al alumno activo', async (t) => { /* … */ });
  test('update-to-completed', 'Hoy la edición acepta pasar a finalizada', {
    kind: 'current',
    affectedBy: ['secretario-inscripciones'],
  }, async (t) => { /* … */ });
});
```

- **Ids estables**: el id completo (`grupo.prueba`) es lo que se compara con la línea base. No se
  renombra; el título sí se puede cambiar.
- **Estables y actuales**: una prueba `stable` (por defecto) comprueba algo que ningún plan cambia:
  si falla, es una regresión. Una `current` refleja un comportamiento de hoy que una restricción
  pendiente va a cambiar y lleva `affectedBy` con la nota (`config.js`, `RESTRICTION_NOTES`) o el plan
  (`'plans/x.md'`). Con `--plan`, sus fallas se informan como esperables del plan en curso.
- **Caja negra**: los flujos pasan por `window.api` (`t.ok`, `t.rejects`, `t.call`) o por la interfaz
  (`t.ui`), y el resultado se comprueba en la base (`t.sql`, `t.sqlOne`). Las funciones internas solo
  se reemplazan para inyectar fallas, y mejor en `pg` (`t.injectFault`) que en la aplicación.
- **Lo que no cambia de un plan a otro**: el resultado de la operación, el código de error y el
  estado de la base. No se comprueban textos, posiciones, orden ni cantidades fijas del seed.
- **Resultados esperados con consultas propias**, distintas de las del repositorio; las reglas en
  forma de tabla van como datos (`main/permissions.table.js`, `ui/views.table.js`).
- **Datos propios**: todo lo que una prueba crea, edita o da de baja sale de `lib/fixtures.js` o de la
  propia prueba; del seed solo se leen catálogos, instituciones y los usuarios para iniciar sesión.
- **Fechas**: siempre `t.today` y `t.year` (de la base), nunca `new Date()`; en SQL, `fn_fecha_actual()`
  y no `CURRENT_DATE`, que no respeta `TEST_TODAY`.
- **Otros ciclos lectivos**: la base solo acepta datos del ciclo actual, así que los de un ciclo
  cerrado se crean con `fixtures.inSchoolYear(año, () => …)`, que los carga como en ese año y
  confirma. Los de un ciclo futuro no deben quedar: se crean con `fixtures.asOfSchoolYear` dentro de
  una transacción que la prueba deshace (`db/school-year.test.js`).

### Reglas para los planes

1. **Cada plan lista en su `.md` las pruebas que modifica** (por id) y las que agrega.
2. **Nunca se borra una prueba para que pase.** Si un plan cambia el comportamiento que comprueba, se
   cambia su expectativa y se agrega una entrada en `history` citando el plan:
   ```js
   history: [{ plan: 'plans/08-secretario-inscripciones.md', date: '2026-11-02', change: 'Finalizada ya no se acepta en el ciclo actual: ahora espera INVALID_STATUS' }],
   ```
   Si deja de tener sentido, se retira con `retired: { plan, reason }`: queda en la suite sin correr.
   El informe señala toda prueba eliminada, o modificada respecto de la línea base sin una entrada
   nueva en `history`, y la corrida termina con código 1.
3. **Las pruebas nuevas de cada restricción quedan en la suite**, como estables (o `current` si otro
   plan pendiente las va a cambiar).
4. **Las fallas conocidas se marcan, no se registran como correctas**: la prueba comprueba el
   comportamiento correcto y lleva `knownFailure: { reason, until: 'AAAA-MM-DD', ref }`. Mientras
   falle se informa como falla conocida; si deja de fallar, el informe pide quitar la marca; vencida
   la fecha, cuenta como falla.
5. **Los cambios de cada plan en `tests/` van en un commit propio dentro de la rama**, separado del de
   la aplicación, para revisarlos aparte. Ese commit incluye la línea base actualizada.

Recorrido de una sesión: `npm test -- --plan <nota>` al empezar (tiene que dar OK o solo fallas
conocidas); implementar el plan; ajustar o agregar pruebas según las reglas; `npm test -- --plan
<nota>` hasta que no queden fallas; `npm test -- --update-baseline`; commit de la aplicación y commit
aparte de `tests/`.

## Línea base

`tests/baseline/baseline.json` guarda el commit sobre el que se tomó (y los archivos sin commitear
fuera de `tests/`, si los había), la fecha y el año, el resultado y la huella de cada prueba, la
cobertura de canales IPC y el inventario del esquema. Solo se actualiza con una corrida completa y
sin fallas (`--update-baseline`). El informe compara cada corrida con ella: regresiones, fallas
conocidas que ya no ocurren, pruebas nuevas, eliminadas o modificadas, cambios de estado y objetos
del esquema agregados, quitados o cambiados.

## Depurar

- `npm test -- --grep <id> --keep-db`: corre solo esa prueba y conserva su base (el nombre sale al
  final; la próxima corrida normal no la borra: borrarla a mano o quitar su marca de
  `tests/.tmp/kept-dbs`).
- `tests/results/latest.json`: cada prueba con sus fallas, pasos, eventos esperados y avisos.
- `tests/.tmp/run-<id>/`: salida de error de cada capa y capturas de la ventana de las pruebas que
  fallaron (se conservan hasta la próxima corrida si hubo fallas).

## Fallas conocidas al tomar la línea base

| Prueba | Bug |
|---|---|
| `ui.known-bugs.column-filter-enter` | Enter en el campo de texto de un filtro de columna lo vuelve a abrir. |
| `ui.known-bugs.grade-filter-keyboard` | Marcar un nivel del filtro de grado con el teclado no filtra la tabla. |
| `ui.known-bugs.enrollment-edit-refreshes-create-list` | Después de editar una inscripción, el alta ofrece una lista vieja de alumnos. |
| `ui.known-bugs.modal-resize-console` | `modal-resize.js` deja "ResizeObserver loop…" en la consola. |
| `startup.app.login-db-hang` | Con la base colgada y una conexión abierta en el pool, el login no responde nunca. |

Ruido conocido (`known-issues.js`): el aviso de Electron por la falta de Content-Security-Policy en
las vistas y el error de `modal-resize.js`.

## Lo que no cubre

- Una segunda instancia de la aplicación (`main.js` no pide instancia única: hallazgo previo) ni el
  foco al reabrir la ventana desde la bandeja.
- La foto de perfil (subida y recorte en `avatar-editor`): solo se usa sin foto.
- La vista Reportes del Secretario y los botones sin función todavía (solo se comprueba que cargan).
- La apariencia (medidas, colores, capturas comparadas): las capturas solo se guardan para depurar.
- El cambio de año con la aplicación abierta: el cierre de los ciclos corre al arrancar. Tampoco las
  edades de usuarios y alumnos ni las validaciones de fecha del renderer con `TEST_TODAY`, que siguen
  con el reloj del proceso. Los datos de un ciclo cerrado sí se prueban, con `fixtures.inSchoolYear`,
  en todas las capas.
