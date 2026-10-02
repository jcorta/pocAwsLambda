# Lista de tareas

Se tilda cada tarea al completarla, y la fase cuando se cumple su **definición de terminado** (SPEC §12).
Referencia: [`docs/SPEC.md`](SPEC.md).

**Progreso:** F0 ✔ · F1 ✔ · F2 ✔ · F3 ✔ · F4 ☐ · F5 ☐ · F6 ☐ · F7 ☐

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

## [ ] F4 — Notificaciones
> Terminado cuando: el E2E verifica en `/_aws/ses` los emails de confirmación y de cancelación.

- [ ] Módulo `notifications`: SQS con visibility de 180 s, DLQ tras 3 intentos e identidad SES
- [ ] Publicación después del commit en `bookings` (`useQueueUrlAsEndpoint: false`, log `notification_publish_failed`)
- [ ] Lambda `notifier` idempotente, con plantillas en español
- [ ] Tests de integración del notifier
- [ ] E2E de emails en `/_aws/ses`
- [x] Perfil de Floci UI con la bandeja de emails de SES (hecho en F1; Mailpit descartado)

## [ ] F5 — Frontend
> Terminado cuando: los recorridos E2E de UI de §8.2 están en verde en la CI.

- [ ] Next.js con export estático, Tailwind y TanStack Query
- [ ] Carga de `config.json` en tiempo de ejecución
- [ ] Auth con Cognito y tokens en memoria: login, registro, confirmación, refresh, logout y `?next=`
- [ ] Páginas de usuario: recursos, detalle con disponibilidad y mis reservas
- [ ] Páginas de admin: recursos, edición, reservas y configuración
- [ ] Mensajes para cada código de error, y estados de carga, vacío y error
- [ ] Módulo de Terraform `frontend`: sitio S3 y `config.json`
- [ ] `deploy:web:local` (`s3 sync --exclude config.json`)
- [ ] Tests unitarios de la web
- [ ] E2E de UI con Playwright, también en la CI

## [ ] F6 — Endurecimiento
> Terminado cuando: un desarrollador nuevo levanta todo siguiendo solo el README.

- [ ] `terraform test` con las aserciones de §8.2 y `tflint` (job `infra-test`)
- [ ] Umbrales de cobertura aplicados en la CI (§8.4)
- [ ] `infra/envs/aws` e `infra/bootstrap` completos, sin aplicar
- [ ] Access logs del stage `$default` de API Gateway (SPEC §7.4), verificando que Floci los acepte
- [ ] `deploy-aws.yml` preparado y deshabilitado
- [ ] Job `build` que sube los bundles como artifacts para `deploy-aws.yml` (requiere aprobar `actions/upload-artifact` y `download-artifact`)
- [ ] README con guía de inicio, verificada en una máquina limpia
- [ ] Checklist para hacer público el repo (§9.3)

## [ ] F7 — Migración a AWS real *(opcional)*
> Terminado cuando: los smoke tests están en verde en AWS real.

- [ ] Decidir D-3.1 (NAT o VPC endpoints) e implementarlo en el módulo `network` (hoy solo admite `network_egress = "none"`)
- [ ] Aplicar `infra/bootstrap` (bucket del state y rol OIDC)
- [ ] SES: dominio verificado, salida del sandbox y Cognito enviando por SES
- [ ] Primer deploy manual, migrator y web
- [ ] Habilitar `AWS_DEPLOY_ENABLED` y probar `deploy-aws.yml`
- [ ] Smoke tests y registro real con código de verificación
- [ ] `terraform destroy` cuando ya no se use

---

## Extensiones futuras *(fuera de la v1, §13)*
- [ ] E-01 Transactional outbox para notificaciones
- [ ] E-02 Frontend en contenedores (Kubernetes)
- [ ] E-03 Sesión persistente con cookies `httpOnly`
