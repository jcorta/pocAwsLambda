# AGENTS.md

Instrucciones para agentes de código que trabajen en este repositorio.

## Qué es este proyecto
POC de un **sistema de reservas de recursos por turnos**, que garantiza que no haya dobles reservas.
- **Stack:** API Gateway HTTP API, Lambdas en Node.js/TypeScript, RDS PostgreSQL, Cognito, SQS, SES y frontend Next.js estático en S3.
- **Infra:** Terraform. Corre en **Floci** (emulador local de AWS) y está diseñada para migrar a AWS real sin cambiar los módulos.

## Fuentes de verdad (leer antes de cambiar algo)
| Archivo | Qué contiene |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Especificación: reglas de negocio (RN-xx), casos de uso (CU-xx), contrato de API, arquitectura, infra, tests y fases |
| [`docs/TASKS.md`](docs/TASKS.md) | Lista de tareas por fase, con casillas |
| [`docs/spikes/floci.md`](docs/spikes/floci.md) | Qué funciona en Floci y los hallazgos A1 a A7 |

Si la implementación y la spec no coinciden, **no elijas una en silencio**: señala la diferencia y pregunta.

### La spec siempre refleja lo implementado
Si una tarea necesita cambiar algo de lo especificado (una regla, un endpoint, un esquema, la infra, un comando, etc.):
1. **Antes de implementar**, se propone el cambio en `docs/SPEC.md` y se espera la aprobación del usuario.
2. Una vez aprobado, se actualiza la spec **en el mismo PR** que el código, incluidas las referencias cruzadas (casos de uso, catálogo de errores, tests de §8, fases de §12).
3. Nunca queda código que contradiga la spec, ni una spec desactualizada respecto del código.

## Estado actual
- Hecho: la fase F0 (spike de Floci en `spikes/f0-floci/`), verificada en Windows y en el runner de GitHub (workflow `spike-f0`).
- En curso: F1, la base del monorepo. Ya existe el esqueleto de los paquetes; su contenido llega en F2 a F5.
- La estructura del monorepo está en SPEC §1.5 y §6.5:
  ```
  apps/web/          Next.js (export estático)
  services/api/      Lambdas: handlers/, domain/, services/, repositories/, infra/
  packages/shared/   Esquemas Zod, tipos y códigos de error compartidos
  infra/             Terraform: modules/, envs/local, envs/aws, bootstrap/
  scripts/           doctor.mjs y scripts de entorno local
  ```

## Comandos
pnpm se habilita con `corepack enable`, que lee la versión del campo `packageManager`.

| Comando | Qué hace |
|---|---|
| `npm run doctor` | Verifica los prerequisitos (Node, pnpm, Docker, Compose, socket de Docker, puertos y versión de Terraform). Termina con un código distinto de 0 si falta algo obligatorio |
| `pnpm install` | Instala las dependencias del monorepo |
| `docker compose up -d floci` | Levanta Floci. Con `--profile ui` suma Floci UI (`:4500`), que incluye la bandeja de emails de SES |
| `docker compose --profile ui down -v` | Baja el entorno y borra el volumen de datos de Floci (es efímero) |
| `docker compose run --rm terraform <args>` | Terraform en contenedor (perfil `tools`), con la versión de `.terraform-version` |
| `pnpm typecheck` | `tsc --noEmit` en cada paquete |
| `pnpm lint` | ESLint en todo el repo |
| `pnpm format` / `pnpm format:check` | Formatea con Prettier, o solo verifica el formato |
| `pnpm test` | Tests unitarios (Vitest) de cada paquete |
| `pnpm secrets:staged` / `pnpm secrets:history` | gitleaks (en Docker) sobre lo que está por commitearse, o sobre todo el historial |

- El resto de los comandos (`npm run doctor`, `pnpm local:up`, etc.) están definidos en SPEC §10.1 y se agregan a esta tabla a medida que existan.
- Para el spike F0, ver la sección "Cómo reproducirlo" en `docs/spikes/floci.md`.

## CI (GitHub Actions)
- **`ci.yml`** corre en cada PR y en cada push a `main`. Jobs:
  - `changes`: detecta si el cambio toca algo más que `docs/` y `*.md`.
  - `lint`: ESLint, Prettier, typecheck, `terraform fmt` y gitleaks sobre los commits del PR.
  - `unit`: tests unitarios.
- **`spike-f0.yml`** corre el spike de Floci cuando cambia `spikes/f0-floci/**`, o a mano.
- **Un job nuevo que sea pesado** (integración, build, E2E) se condiciona con `if: needs.changes.outputs.code == 'true'`, así se saltea en los PRs que solo tocan documentación sin quedar pendiente.
- **Antes de pedir un merge**, la CI del PR tiene que estar en verde. Se sigue con `gh pr checks <n> --watch`.
- **Hook de pre-commit (Lefthook):** `pnpm install` lo instala con el script `prepare`; si no quedó instalado, se corre `pnpm run prepare`. Ejecuta gitleaks sobre lo que está por commitearse, así que **commitear requiere Docker corriendo**. Si Docker no está disponible, el hook falla y bloquea el commit: es intencional.
- **pnpm bloquea los scripts de instalación de las dependencias.** Cada excepción se declara en `allowBuilds` (`pnpm-workspace.yaml`) y requiere aprobación. Por ahora la única entrada es `lefthook: false`: su script no hace falta, porque los hooks los instala `prepare`.
- **pnpm aplica `minimumReleaseAge`:** rechaza versiones publicadas hace muy poco, como protección contra la cadena de suministro. Si una instalación falla por eso, se usa una versión anterior. **No** se agregan excepciones (`minimumReleaseAgeExclude`) sin aprobación.

## Convenciones

### Idioma
- **En español:** documentación, mensajes de commit, descripciones de PR, comentarios de código y textos de la UI.
- **En inglés:** identificadores de código (variables, funciones, tipos, archivos, tablas y columnas), códigos de error (`SLOT_TAKEN`) y nombres de recursos de infra.

### Git
- **Una rama y un PR por tarea** de `docs/TASKS.md`, **o por un grupo chico de tareas relacionadas de la misma fase** cuando por separado no se pueden probar o serían triviales. El PR indica qué tareas cubre. La rama sale de `main` con un prefijo según el tipo: `feat/`, `fix/`, `chore/`, `docs/`, `test/` o `refactor/`. Ejemplo: `feat/doctor-script`.
- Nunca commitear directo a `main`. Se mergea solo con la CI en verde.
- **Commits con Conventional Commits** y la descripción en español: `tipo(alcance): descripción`. Ejemplo: `feat(api): validar alineación de turnos`.
  - Alcances habituales: `api`, `web`, `shared`, `infra`, `ci`, `docs` y `spike`.

### Código
- **El dominio es puro.** `services/api/src/domain` no importa AWS, la base de datos ni el reloj del sistema: `now` y `timezone` se reciben como parámetros.
- **Las fechas se calculan con una librería que entienda zonas horarias**, nunca con offsets fijos. Se guardan en UTC y la API las devuelve con el offset de `APP_TIMEZONE` (SPEC §4.1).
- **Las reglas de concurrencia viven en la base de datos**: exclusion constraint y `FOR UPDATE` (SPEC §3.3). No reemplazarlas por chequeos en código.
- **Los esquemas Zod se definen una sola vez**, en `packages/shared`.
- **Los errores** usan los códigos del catálogo de SPEC §4.3. Para agregar uno, primero se agrega a la spec.

### Particularidades de Floci (no las "corrijas")
- El cliente de SQS se crea con `useQueueUrlAsEndpoint: false` (hallazgo A2).
- Los clientes de AWS se crean **sin endpoint explícito**: Floci inyecta `AWS_ENDPOINT_URL` en cada Lambda.
- La Lambda rechaza los tokens con `token_use` distinto de `id` (A3).
- `cognito:groups` llega a la Lambda como string `"[admin]"`. El parser acepta un array o un string.
- La configuración obligatoria de Floci está en SPEC §10 (A1). La imagen va fijada en `floci/floci:2.1.0`; actualizarla implica volver a correr el spike.

### Tests
- **Todo comportamiento nuevo lleva tests en el nivel que corresponde** (SPEC §8): las reglas en unit de dominio, la base de datos y la concurrencia en integración, y los flujos en E2E.
- **Antes de abrir un PR** se corren localmente los tests afectados. Si no se pudieron correr, se dice en el PR.
- No se debilita ni se borra un test para que pase. Si el test está mal, se explica por qué en el PR.

### Seguridad
- **Ningún secreto en el repo**, ni siquiera en una rama temporal: el repo se va a hacer público con todo su historial (SPEC §9.3).
- Solo se versionan `.env.example` y `*.tfvars.example`.
- Nunca se registran en los logs tokens, contraseñas ni el contenido de los secretos.
- **Nunca usar `git commit --no-verify`** para saltear el hook de gitleaks. Si marca un falso positivo, se agrega a `.gitleaksignore` con aprobación, explicando por qué no es un secreto.

## Qué consultar antes de hacer
Preguntar al usuario **antes** de:
- Agregar una dependencia (npm, provider de Terraform, imagen Docker o GitHub Action).
- Modificar `docs/SPEC.md`, aunque sea para registrar un hallazgo ya verificado (ver "La spec siempre refleja lo implementado").
- Hacer push o abrir un PR.
- Levantar, resetear o bajar el entorno local (`local:up`, `local:reset`, `docker compose up/down`) o borrar volúmenes de Docker.

## Al terminar una tarea
1. Verificar que `docs/SPEC.md` refleje lo implementado. Si cambió algo, la actualización ya tiene que estar aprobada e incluida en el PR.
2. Tildar la tarea en `docs/TASKS.md`. Si se cumplió la definición de terminado de la fase, tildar también la fase y actualizar la línea de progreso.
3. Si aparecieron comandos nuevos, actualizar la sección "Comandos" de este archivo.
4. Resumir qué se hizo, qué tests se corrieron con su resultado, y qué quedó pendiente.

## Entorno de desarrollo
- **El proyecto es agnóstico del sistema operativo:** funciona igual en Windows, macOS y Linux, y la CI corre en Linux.
- **Prerequisitos:** Docker (con Compose v2) y Node.js. Todo lo demás corre en contenedores (Floci y Terraform) o se instala con el repo.
- **Scripts en Node.js.** No usar scripts que dependan de bash, PowerShell ni de herramientas propias de un sistema operativo.
- **Rutas y comandos portables:** usar `path.join` y evitar separadores fijos, finales de línea propios de un sistema o rutas absolutas.
- Terraform corre en contenedor. No hace falta instalarlo.
