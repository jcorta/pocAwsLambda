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
- Hecho: F1, la base del monorepo (pnpm, TypeScript, lint, tests, `doctor`, compose, hook de gitleaks y CI).
- Hecho: F2, dominio y base de datos (esquema, migraciones, dominio, repositorios y servicios de `services/api`).
- Próximo: F3, API e infraestructura (handlers, Lambdas, Terraform en Floci y E2E).
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
| `docker compose run --rm terraform -chdir=infra/envs/local apply` | Aplica la infra en Floci, con Floci levantado y después de `pnpm build`. Tarda unos 2 minutos la primera vez (RDS) |
| `pnpm typecheck` | `tsc --noEmit` en cada paquete |
| `pnpm lint` | ESLint en todo el repo |
| `pnpm format` / `pnpm format:check` | Formatea con Prettier, o solo verifica el formato |
| `pnpm test` | Tests unitarios (Vitest) de cada paquete |
| `pnpm build` | Bundles de las Lambdas con esbuild en `services/api/dist/lambdas/<nombre>/` |
| `pnpm --filter @reservas/api check:bundles` | Carga cada bundle y verifica que las Lambdas de la API respondan 401 sin ID token (detecta problemas de ESM o CommonJS) |
| `pnpm test:integration` | Tests de integración contra Postgres 16 real (Testcontainers). **Requiere Docker** |
| `pnpm --filter @reservas/api db:generate` | Genera una migración SQL a partir de los cambios en `src/infra/db/schema.ts`. Lo que Drizzle no expresa (exclusion constraints, extensiones, datos) va en una migración manual (`drizzle-kit generate --custom`) |
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
- **pnpm bloquea los scripts de instalación de las dependencias.** Cada excepción se declara en `allowBuilds` (`pnpm-workspace.yaml`) y requiere aprobación. Por ahora todas las entradas son `false`, es decir, no se ejecutan:
  - `lefthook`: los hooks los instala `prepare`.
  - `esbuild`: el binario llega como dependencia opcional por plataforma.
  - `ssh2` y `cpu-features`: conexión a Docker por SSH, que no se usa (Testcontainers usa el socket local).
  - `protobufjs`.

  Si una herramienta falla porque le falta su script de instalación, se consulta antes de habilitarlo.
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
- **Terraform:**
  - Los módulos (`infra/modules/*`) no saben en qué entorno corren; las diferencias van en `infra/envs/*`.
  - Las rutas de la API se declaran en `infra/modules/api/routes.tf.json`. Una ruta nueva va **ahí y** en `handlers/routes/<lambda>.ts`; el test `routes.test.ts` falla si no coinciden.
  - El lockfile de providers (`.terraform.lock.hcl`) se versiona.
- **Floci deja volúmenes propios** (los de RDS, con la etiqueta `floci=true`) que `docker compose down -v` no borra. Se limpian con `docker volume rm` sobre `docker volume ls -q --filter label=floci=true`.
- **Migraciones:** solo hacia adelante. Nunca se edita una migración ya mergeada; los cambios van en una migración nueva.
- **El dominio es puro.** `services/api/src/domain` no importa AWS, la base de datos ni el reloj del sistema: `now` y `timezone` se reciben como parámetros.
- **Las fechas se calculan con Temporal** (`temporal-polyfill`), nunca con `Date` ni con offsets fijos. Los turnos se generan en tiempo absoluto (regla de los días de cambio de hora en SPEC §2.2).
- **Las reglas devuelven `RuleResult`** (`{ ok: true }` o `{ ok: false, code, details }`, en `src/domain/types.ts`) en lugar de lanzar excepciones. Los códigos salen de `ERROR_CODES` en `@reservas/shared`.
- **Servicios** (`src/services`): reciben `ServiceDeps` (`db`, `now()` y `timezone`) y un `Actor`, y devuelven `ServiceResult`. Dentro de una transacción, una regla que falla se corta con `fail(...)`, que revierte la transacción, y `catchFailure` la convierte en resultado. Los errores de Postgres se traducen por SQLSTATE (`pgErrorCode`): `23P01` → `SLOT_TAKEN` y `23505` → `RESOURCE_NAME_TAKEN`.
- **Handlers** (`src/handlers`):
  - Cada Lambda tiene su mapa de rutas en `handlers/routes/<lambda>.ts`, y `handlers/routes/index.ts` (`LAMBDA_ROUTES`) es el registro que Terraform debe reflejar.
  - `createLambdaHandler` resuelve el actor (con `token_use = id`), aplica `requireAdmin`, rutea y convierte las excepciones en `500 INTERNAL_ERROR`.
  - Los handlers solo validan con Zod (`parseBody`, `parseQuery` y `pathId`), llaman al servicio y serializan con `serializers.ts`. La lógica va en los servicios.
  - Un `{id}` que no es UUID responde 404 sin consultar la base.
- **Entrypoints** (`src/lambdas/<nombre>.ts`):
  - Cada uno importa **solo** las rutas de su dominio, para que el bundle no incluya los demás. Nunca importar `handlers/routes/index.ts` desde un entrypoint.
  - Las dependencias (pool de pg con `max: 1` y secreto de la DB) se crean una vez por contenedor con `lazyServiceDeps`, que reintenta si la inicialización falla.
  - Los clientes del AWS SDK se crean **sin endpoint**.
- **Repositorios** (`src/repositories`): aceptan `DbOrTx`, así funcionan dentro o fuera de una transacción. Las fechas se convierten en el borde con `toDate` y `toInstant`.
- **Cobertura:** `pnpm test` en `services/api` mide la cobertura y falla si `src/domain/**` baja del 90 % de líneas. Se guardan en UTC y la API las devuelve con el offset de `APP_TIMEZONE` (SPEC §4.1).
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
