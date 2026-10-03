# Reservas: POC serverless sobre AWS, en local con Floci

Sistema de **reservas de recursos por turnos** (salas, equipos, canchas…) que garantiza que nunca haya dos reservas sobre el mismo turno. Es una prueba de concepto para practicar una arquitectura serverless de AWS de punta a punta, con infraestructura como código, tests en todos los niveles y CI/CD.

Todo corre **en tu máquina**, sobre [Floci](https://github.com/floci-io/floci), un emulador local de AWS. La misma infraestructura está preparada para desplegarse en AWS real (fase F7, opcional).

```
Navegador ──▶ S3 (Next.js estático) ──▶ API Gateway (HTTP API + JWT de Cognito) ──▶ Lambdas (Node.js) ──▶ RDS PostgreSQL
                                                                                       │
                                                                                       └─▶ SQS ──▶ Lambda notifier ──▶ SES
```

| | |
|---|---|
| **Backend** | API Gateway HTTP API, Lambdas en Node.js 22 y TypeScript, Drizzle ORM, Zod, Temporal |
| **Datos** | RDS PostgreSQL 16. Las dobles reservas las impide una *exclusion constraint* de la base |
| **Auth** | Cognito (email y contraseña, grupos `admin` y `user`) |
| **Notificaciones** | SQS, una Lambda idempotente y SES |
| **Frontend** | Next.js 16 con export estático, React 19, Tailwind 4 y TanStack Query |
| **Infra** | Terraform con módulos compartidos y un root por entorno (`envs/local`, `envs/aws`) |
| **Tests** | Vitest (unit e integración con Testcontainers), `terraform test`, E2E de la API y Playwright |
| **CI/CD** | GitHub Actions: lint, tests, build y E2E contra Floci en cada PR. El deploy a AWS está preparado y deshabilitado |

## Prerequisitos

Solo necesitás dos cosas instaladas. Lo demás (Floci, Terraform, Postgres de los tests y gitleaks) corre en contenedores.

- **Docker** con Compose v2: Docker Desktop en Windows y macOS (en Windows, con WSL2), o Docker Engine en Linux. Se recomiendan al menos 4 GB de memoria para Docker.
- **Node.js 24** o superior (ver `.nvmrc`). pnpm viene con Node a través de corepack.

Funciona igual en Windows, macOS y Linux.

## Inicio rápido

```sh
git clone https://github.com/jcorta/pocAwsLambda.git
cd pocAwsLambda

corepack enable       # 1. Habilita pnpm con la versión del repo (en Windows puede pedir una terminal de administrador)
npm run doctor        # 2. Verifica los prerequisitos y sugiere cómo resolver lo que falte
pnpm install          # 3. Instala las dependencias
pnpm local:up         # 4. Levanta todo: Floci, infraestructura, migraciones y datos de ejemplo
```

La primera vez, `pnpm local:up` tarda unos **3 minutos**: descarga las imágenes de Docker y crear la base de datos lleva unos 90 s. Las siguientes veces tarda menos. Es idempotente, así que se puede volver a correr. Al final muestra las URLs y los usuarios de prueba.

Después, para abrir la aplicación:

```sh
pnpm dev              # Frontend en http://localhost:3000
```

Entrá con alguno de los usuarios que crea el seed. Las contraseñas están en `.env.local`, que se crea a partir de `.env.example`:

| Rol | Email | Contraseña |
|---|---|---|
| Admin | `admin@example.com` | `Admin-local-1` |
| Usuario | `user@example.com` | `User-local-1` |

Qué podés probar:
- **Como usuario:** elegir un recurso, ver los turnos disponibles de un día, reservar uno y cancelarlo desde "Mis reservas". Las reglas se aplican: no más de 3 reservas activas, hasta 30 días de anticipación y cancelación hasta 2 h antes.
- **Como admin:** crear y editar recursos con su horario, ver todas las reservas, cancelar la de cualquiera y cambiar la configuración.
- **Registrarte** con un email nuevo. El código de verificación y los emails de cada reserva se ven en la bandeja de Floci UI (`pnpm local:up --ui`, en `http://localhost:4500`).

Para terminar:

```sh
pnpm local:down       # Baja el entorno (Floci es efímero: los datos se pierden)
```

## Comandos frecuentes

| Comando | Qué hace |
|---|---|
| `npm run doctor` | Verifica los prerequisitos |
| `pnpm local:up [--ui]` | Levanta el entorno local completo. Con `--ui` suma Floci UI en `:4500` |
| `pnpm dev` | Frontend con recarga en caliente en `http://localhost:3000` |
| `pnpm deploy:local` | Ciclo rápido después de cambiar el backend: build, Terraform y migraciones |
| `pnpm deploy:web:local` y `pnpm local:site` | Publica el sitio en el S3 de Floci y lo sirve en `http://localhost:3002` |
| `pnpm local:logs [lambda]` | Logs de Floci o de una Lambda (`me`, `resources`, `bookings`, `admin`, `migrator` o `notifier`) |
| `pnpm local:down` / `pnpm local:reset` | Baja el entorno. `reset` además borra el state de Terraform y lo generado |
| `pnpm test` | Tests unitarios, con umbrales de cobertura |
| `pnpm test:integration` | Tests contra un Postgres real (Testcontainers) |
| `pnpm lint:infra` / `pnpm test:infra` | `fmt`, `validate`, `tflint` y `terraform test` de la infraestructura |
| `pnpm test:e2e` / `pnpm test:e2e:ui` | E2E de la API y de la UI contra el entorno levantado |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Calidad de código |

La lista completa y sus detalles están en [`AGENTS.md`](AGENTS.md#comandos).

## Estructura

```
apps/web/          Frontend Next.js (export estático)
services/api/      Lambdas: dominio puro, servicios, repositorios, handlers y migraciones
packages/shared/   Contrato de la API: esquemas Zod y códigos de error
infra/             Terraform: modules/, envs/local (Floci), envs/aws y bootstrap/ (sin aplicar)
scripts/           doctor y scripts del entorno local, todos en Node
docs/              Especificación, tareas y resultados del spike de Floci
```

## Problemas frecuentes

- **`doctor` falla en "Socket de Docker desde contenedores".** Floci levanta las Lambdas y la base como contenedores hermanos, así que necesita el socket de Docker. En Docker Desktop: *Settings → Advanced → Allow the default Docker socket to be used*.
- **Un puerto está ocupado.** El entorno usa 4566, 3000 y 7001–7010. `doctor` dice qué comando usar para ver qué proceso lo tiene.
- **La API o el sitio no resuelven sin conexión a Internet.** Las URLs `*.localhost.floci.io` dependen de un DNS público que responde `127.0.0.1`. Para trabajar sin conexión, agregá una entrada en el archivo `hosts` con el host que muestra `local:up`.
- **El login falla al abrir el sitio directo del bucket o `:3001`.** Cognito de Floci no soporta CORS, así que el navegador tiene que entrar por el proxy local: `http://localhost:3000` (`pnpm dev`) o `http://localhost:3002` (`pnpm local:site`).
- **Algo quedó en un estado raro.** `pnpm local:reset` y después `pnpm local:up` dejan todo como nuevo.
- **En Windows, `pnpm` falla con "El sistema no puede encontrar la ruta especificada".** Las rutas de `node_modules` superan los 260 caracteres. Cloná el repo en una carpeta de ruta corta (por ejemplo `C:\dev\pocAwsLambda`) o habilitá las rutas largas de Windows.
- **No puedo commitear.** El hook de pre-commit corre gitleaks en Docker, así que Docker tiene que estar corriendo.

## Documentación

- [`docs/SPEC.md`](docs/SPEC.md): la especificación completa. Incluye las reglas de negocio, el contrato de la API, la arquitectura, la infra, la estrategia de tests, el CI/CD y la migración a AWS.
- [`docs/TASKS.md`](docs/TASKS.md): las fases de implementación y su avance.
- [`docs/spikes/floci.md`](docs/spikes/floci.md): qué funciona en Floci y las diferencias con AWS encontradas en el camino (hallazgos A1 a A10).
- [`AGENTS.md`](AGENTS.md): convenciones del repo, para personas y para agentes de código.

## AWS real

`infra/envs/aws`, `infra/bootstrap` y `.github/workflows/deploy-aws.yml` están completos y validados con `terraform test`, pero **nunca se aplicaron**. Antes de desplegar falta decidir la salida de red de las Lambdas (NAT Gateway o VPC endpoints), sumar CloudFront y verificar el dominio de SES. Los pasos y el costo estimado están en [SPEC §11](docs/SPEC.md#11-migración-a-aws-real-y-riesgos).

## Licencia

[MIT](LICENSE).
