# Lista de tareas

Se tilda cada tarea al completarla, y la fase cuando se cumple su **definición de terminado** (SPEC §12).
Referencia: [`docs/SPEC.md`](SPEC.md).

**Progreso:** F0 ✔ · F1 ✔ · F2 ✔ · F3 ✔ · F4 ✔ · F5 ✔ · F6 ✔ · F7 ☐

---

## [x] F0 — Spike de viabilidad en Floci
> Terminado cuando: los 7 puntos de §7.6 están verificados en Windows **y** en el runner de GitHub.

- [x] `docker-compose.yml` con Floci 2.1.0 y Terraform en contenedor
- [x] Terraform mínimo: Cognito, HTTP API con JWT authorizer, Lambda en VPC, RDS, Secrets Manager, SQS con ESM y DLQ, SES y sitio S3
- [x] `verify.mjs`: 29/29 chequeos OK en Windows
- [x] Informe `docs/spikes/floci.md` y hallazgos A1 a A7 incorporados a la spec
- [x] Repo privado en GitHub con `main` sincronizada
- [x] Workflow que ejecuta el spike en `ubuntu-latest` y verificarlo en verde (29/29, [run 37043661160](https://github.com/jcorta/pocAwsLambda/actions/runs/37043661160))

## [x] F1 — Base del monorepo
> Terminado cuando: `npm run doctor` y `pnpm test` pasan, y la CI corre en los PR.

- [x] `package.json` raíz con `packageManager` (pnpm) y `engines`, `pnpm-workspace.yaml` y `.nvmrc`
- [x] Paquetes `apps/web`, `services/api` y `packages/shared` (esqueleto)
- [x] TypeScript base (`tsconfig.base.json`) compartido por los paquetes
- [x] ESLint y Prettier
- [x] Vitest en cada paquete, con un test de humo
- [x] `scripts/doctor.mjs` y `npm run doctor` (§10)
- [x] `docker-compose.yml` definitivo: Floci con la configuración A1, perfil `ui` (Floci UI) y Terraform en contenedor
- [x] `.env.example` y `.terraform-version`
- [x] Hook de pre-commit con `gitleaks`
- [x] `ci.yml` con los jobs `changes`, `lint` (con `gitleaks`) y `unit`
- [x] Primer PR con la CI en verde (#7)

## [x] F2 — Dominio y base de datos
> Terminado cuando: los casos de §8.2 de dominio e integración están en verde, con cobertura del dominio ≥ 90 %.

- [x] Esquema Drizzle: `users`, `resources`, `resource_opening_hours`, `bookings`, `settings` y `notification_log`
- [x] Migración inicial con SQL manual: `btree_gist`, exclusion constraint, CHECKs y fila de `settings`
- [x] Dominio: generación de turnos con zona horaria (`now` y `timezone` inyectados)
- [x] Dominio: reglas RN-02, RN-03, RN-05 y RN-06 (además: estado de turnos de CU-03 y validación de horario de CU-07)
- [x] Tests unitarios de dominio, en dos zonas horarias y con los casos de borde de §8.2 (56 tests, cobertura 100 %)
- [x] Repositorios
- [x] Servicios: reservar (transacción de §3.3), cancelar, gestionar recursos y configuración (además: disponibilidad de CU-03)
- [x] Setup de Testcontainers con `postgres:16`
- [x] Tests de integración: migraciones, concurrencia RN-01 (20 usuarios) y RN-05 (6 de 3), RN-08 y "cancelar libera el turno" (37 tests; los del notifier van en F4)
- [x] Job `integration` en la CI

## [x] F3 — API e infraestructura
> Terminado cuando: el flujo de reserva completo funciona por API en Floci, en local y en CI.

- [x] `packages/shared`: esquemas Zod, tipos y catálogo de errores (§4.3)
- [x] Capa de handlers: router por `routeKey`, parser de roles (array o string), chequeo de `token_use = id` y mapeo de errores (además: handlers de las 12 rutas, listados paginados por cursor)
- [x] Lambdas `me`, `resources`, `bookings` y `admin`
- [x] Lambda `migrator`
- [x] Build con esbuild a `dist/lambdas/<nombre>/` (el zip lo arma Terraform con `archive_file`), con smoke test de los bundles
- [x] Módulos de Terraform `network`, `database`, `auth` y `api` (61 recursos aplicados en Floci)
- [x] Root `infra/envs/local`: provider de Floci, `api_url` y `cognito_issuer_url`
- [x] Seed: usuarios de Cognito y recursos de ejemplo (`settings` lo crea la migración)
- [x] Comandos `local:up`, `deploy:local`, `local:logs`, `local:down` y `local:reset` (además: `local:seed`)
- [x] Tests unitarios de handlers (más 19 tests de integración de la pila completa, que validan las respuestas contra el contrato)
- [x] Test de consistencia entre las rutas de Terraform y los handlers
- [x] E2E de la API: auth, reservas, límites y cancelación (12 tests)
- [x] Jobs `build` y `e2e-local` en la CI (el build corre dentro de `unit` y de `e2e-local`; el job `build` con artifacts va en F6)

## [x] F4 — Notificaciones
> Terminado cuando: el E2E verifica en `/_aws/ses` los emails de confirmación y de cancelación.

- [x] Módulo `notifications`: SQS con visibility de 180 s, DLQ tras 3 intentos e identidad SES
- [x] Publicación después del commit en `bookings` (`useQueueUrlAsEndpoint: false`, log `notification_publish_failed`)
- [x] Lambda `notifier` idempotente, con plantillas en español
- [x] Tests de integración del notifier
- [x] E2E de emails en `/_aws/ses`
- [x] Perfil de Floci UI con la bandeja de emails de SES (hecho en F1; Mailpit descartado)

## [x] F5 — Frontend
> Terminado cuando: los recorridos E2E de UI de §8.2 están en verde en la CI.

- [x] Next.js con export estático, Tailwind y TanStack Query
- [x] Carga de `config.json` en tiempo de ejecución
- [x] Auth con Cognito y tokens en memoria: login, registro, confirmación, refresh, logout y `?next=`
- [x] Páginas de usuario: recursos, detalle con disponibilidad y mis reservas
- [x] Páginas de admin: recursos, edición, reservas y configuración
- [x] Mensajes para cada código de error, y estados de carga, vacío y error
- [x] Módulo de Terraform `frontend`: sitio S3 y `config.json`
- [x] `deploy:web:local` (`s3 sync --exclude config.json`)
- [x] Proxy local del mismo origen para Cognito (hallazgo A8: Cognito de Floci no soporta CORS), con `pnpm dev` y `pnpm local:site`
- [x] Tests unitarios de la web (38 tests)
- [x] E2E de UI con Playwright, también en la CI (5 recorridos, incluido el registro con el código real)

## [x] F6 — Endurecimiento
> Terminado cuando: un desarrollador nuevo levanta todo siguiendo solo el README.

- [x] `terraform test` con las aserciones de §8.2 y `tflint` (job `infra-test`; tflint con el ruleset de Terraform incluido)
- [x] Umbrales de cobertura aplicados en la CI (§8.4)
- [x] `infra/envs/aws` e `infra/bootstrap` completos, sin aplicar (CloudFront y la salida de red quedan para F7)
- [x] Access logs del stage `$default` de API Gateway (SPEC §7.4), Floci acepta la configuración (lo verifica un E2E) pero no los escribe (hallazgo A10)
- [x] `deploy-aws.yml` preparado y deshabilitado (plan, apply con aprobación, migrator, sitio y smoke tests)
- [x] Job `build` que sube los bundles como artifacts para `deploy-aws.yml` (solo en `main`)
- [x] README con guía de inicio, verificada desde un clon limpio en Windows el 2026-10-03: `local:up` en 145 s, login y API por el proxy de `pnpm dev`, E2E de la API (15) y de la UI (5) en verde
- [x] Checklist para hacer público el repo (§9.3): ver abajo

### Checklist para hacer público el repo (SPEC §9.3)
Revisada el 2026-10-03. Lo que queda abierto lo hace el dueño del repo en GitHub, cuando decida publicarlo.

- [x] CI en verde en `main` y fases F0 a F6 completas
- [x] README con guía de inicio verificada desde un clon limpio
- [x] Licencia: MIT, en `LICENSE`
- [x] `gitleaks` sobre todo el historial (`pnpm secrets:history`): sin hallazgos
- [x] Issues, ramas y artifacts: sin issues abiertos, solo la rama `main` y un único artifact (`build`, 7,9 MB, vence a los 14 días)
- [ ] Al publicar: proteger `main` (PR obligatorio con los checks de `ci.yml` en verde) y crear el environment `aws` con aprobación manual, limitado a `main`
- [ ] Al publicar: volver a correr `pnpm secrets:history` justo antes de cambiar la visibilidad

## [ ] F7 — Despliegue en AWS *(el objetivo del proyecto)*
> Terminado cuando: los smoke tests están en verde en AWS y `deploy-aws.yml` está habilitado y probado.

**Código (PR F7-A, sin tocar AWS):**
- [x] D-3.1 resuelta: interface endpoints de Secrets Manager, SQS y SES en 1 AZ (`network_egress = "endpoints"`)
- [x] CloudFront en el módulo `frontend`: bucket privado con OAC, HTTPS, función de índices y cache sin invalidaciones
- [x] Bootstrap borrable y `envs/aws` con endpoints y CloudFront
- [x] `pnpm aws:deploy`, `pnpm aws:admin` y `pnpm aws:destroy` (borra en orden y verifica por tags antes de tocar el bootstrap)
- [x] `deploy-aws.yml` usa los mismos pasos posteriores al apply (`scripts/aws/post-apply.mjs`)

**Sesión en AWS (§11.1):**
- [x] Prerequisitos: AWS CLI v2 con sesión iniciada (SSO), alerta de Budgets y `terraform.tfvars`
- [x] Verificación de la cuenta para CloudFront: falló en el primer intento (`Your account must be verified`) y se resolvió sin abrir un caso (probablemente al actualizar el medio de pago)
- [x] RDS: el `InsufficientDBInstanceCapacity` del primer intento era una clase que la cuenta no podía pedir; ahora el valor por defecto es `db.t3.micro`
- [x] `pnpm aws:deploy`: 85 recursos desplegados en 14 min, migraciones y 5 smoke tests en verde (2026-10-05)
- [x] Verificación del remitente de SES, registro real con código de verificación y `aws:admin`
- [x] Recorrido manual: crear un recurso y reservar un turno, con el notifier enviando por SES. **El email no se vio en Gmail**: SES lo aceptó sin rebotes, y se atribuye al remitente `@gmail.com` (SPEC §11.3)
- [ ] Cancelar la reserva y los demás recorridos de §8.2 a mano
- [x] Repo público
- [ ] Environment `aws`, variables del repo y `AWS_DEPLOY_ENABLED=true`
- [ ] Un cambio de lógica en una Lambda desplegado por PR y `deploy-aws.yml`
- [ ] `pnpm aws:destroy` (todo, incluido el bootstrap) y borrar `AWS_DEPLOY_ENABLED`. La primera sesión ya se borró entera (2026-10-06): este ítem es el cierre de la sesión del pipeline

**Pendientes de la primera sesión en AWS:**
- [ ] Scripts: `aws:deploy` y `aws:destroy` revisan cuánto le queda a la sesión SSO antes de empezar y se detienen con un aviso claro. El primer `destroy` se cortó a mitad porque las credenciales (1 h) vencieron: Terraform no pudo guardar el state ni liberar el lock, y hubo que borrar `terraform.tfstate.tflock` de S3 a mano
- [ ] Scripts: con `--ignore-tag-index`, no esperar los 3 minutos de reintentos del índice de tags
- [ ] Subir la duración de la sesión del permission set de Identity Center a 8 h (se hace en la consola de AWS)
- [ ] Opcional: un remitente de otro dominio para ver los emails de las reservas (con `@gmail.com`, Gmail no los muestra: SPEC §11.3)
- [ ] Opcional: el primer `plan` del pipeline puede marcar todas las Lambdas como cambiadas, porque los bundles armados en Linux pueden diferir byte a byte de los de Windows. No es un error: desde el segundo cambio en adelante, el `plan` solo toca la Lambda modificada

---

## Extensiones futuras *(fuera de la v1, §13)*
- [ ] E-01 Transactional outbox para notificaciones
- [ ] E-02 Frontend en contenedores (Kubernetes)
- [ ] E-03 Sesión persistente con cookies `httpOnly`
