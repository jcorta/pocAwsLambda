# Spike F0: viabilidad de Floci

- **Fecha:** 2026-10-02
- **Código:** `spikes/f0-floci/` (docker compose, Terraform, Lambdas de diagnóstico y `verify.mjs`)
- **Entorno:**
  - Windows 11 con Docker Desktop 29.8.1 (WSL2) y Compose v5.5.1.
  - Floci `floci/floci:2.1.0`, Terraform 1.16.4 (contenedor), provider AWS 6.67.0 y Node 24 en el host.
  - Runtime de las Lambdas: `nodejs22.x`.
- **Resultado:** **29/29 chequeos OK** en Windows y en el runner de GitHub (`ubuntu-latest`). La arquitectura de la spec es viable en Floci, con los ajustes que se listan más abajo.

## Cómo reproducirlo
```powershell
cd spikes/f0-floci
npm install --prefix lambda --omit=dev
npm install
docker compose up -d floci
docker compose run --rm terraform init
docker compose run --rm terraform apply -auto-approve
docker compose run --rm -T terraform output -json | Set-Content -Encoding ascii outputs.json
node verify.mjs
docker compose down   # limpia todo: Floci es efímero
```

## Resultados por punto (SPEC §7.6)

| # | Punto | Resultado | Detalle |
|---|---|---|---|
| 1 | Emisor de los tokens y JWT authorizer | ✔ | `iss = http://localhost:4566/<poolId>`. El authorizer valida firma, emisor y audiencia: sin token o con firma inválida responde `401`. **Requiere** `FLOCI_SECURITY_ALLOW_PRIVATE_JWT_TARGETS=true` |
| 2 | Lambda → otros servicios de Floci | ✔ (con un ajuste) | Floci inyecta solo `AWS_ENDPOINT_URL=http://localhost.floci.io:4566`. Secrets Manager y SES funcionan sin configurar nada. **SQS falla** si no se usa `useQueueUrlAsEndpoint: false` (ver ajuste A2) |
| 3 | Lambda → Postgres de RDS | ✔ | Con `FLOCI_SERVICES_RDS_ENDPOINT_HOST=floci`, `aws_db_instance.address = floci` y el puerto es `7001`. PostgreSQL 16.15 con `btree_gist` 1.7 disponible. Desde el host se conecta por `localhost:7001`, publicando los puertos del proxy |
| 4 | Formato de `cognito:groups` | ✔ | En el **ID token** y en el access token va como array (`["admin"]`). En `requestContext.authorizer.jwt.claims` llega como **string** `"[admin]"`, como anticipaba la spec |
| 5 | Recursos de red | ✔ | Floci acepta VPC, subnets, security groups, el subnet group de RDS y `vpc_config` de Lambda, y devuelve el `vpc_id` |
| 6 | Socket de Docker en Windows | ✔ | Un contenedor con `/var/run/docker.sock` montado accede al daemon de Docker Desktop |
| 7 | URLs de invocación y CORS | ✔ | API: `http://<apiId>.execute-api.localhost.floci.io:4566/...`. Sitio: `http://<bucket>.s3-website.localhost.floci.io:4566/`. El preflight CORS devuelve `allow-origin` solo para el origen configurado |

### Chequeos adicionales
| Chequeo | Resultado |
|---|---|
| `email` y `email_verified` en el ID token (usuario creado con `AdminCreateUser` + `SUPPRESS`) | ✔ |
| `USER_PASSWORD_AUTH` y `REFRESH_TOKEN_AUTH` | ✔ |
| `GlobalSignOut` con access token revoca el refresh token | ✔ |
| Emails de SES capturados en `/_aws/ses` | ✔ |
| SQS dispara una Lambda (event source mapping) | ✔ |
| `ReportBatchItemFailures` con redrive a la DLQ después de 3 intentos | ✔ |

## Hallazgos que ajustan la spec

| ID | Hallazgo | Ajuste en SPEC |
|---|---|---|
| **A1** | Configuración obligatoria de Floci: `FLOCI_SERVICES_DOCKER_NETWORK` (red compartida con Lambdas y RDS), `FLOCI_SERVICES_RDS_ENDPOINT_HOST=floci`, `FLOCI_SECURITY_ALLOW_PRIVATE_JWT_TARGETS=true` y publicar el rango de puertos de RDS (`7001-7010`) | §10 |
| **A2** | Dentro de la Lambda, el SDK de SQS usa por defecto el host de `QueueUrl` (`localhost:4566`), que en el contenedor no es Floci. Hay que crear el cliente con `useQueueUrlAsEndpoint: false`, que en AWS funciona igual | §6.5 |
| **A3** | **El JWT authorizer acepta también el access token**, en Floci y en AWS: si el token no trae `aud`, compara `client_id` con la audiencia. Como la API depende del claim `email`, que solo trae el ID token, la Lambda debe rechazar cualquier token con `token_use` distinto de `id` | §4.1, §4.3 y §6.2 |
| **A4** | No hace falta `lambda_extra_env`: Floci inyecta `AWS_ENDPOINT_URL` por su cuenta | §7.3 |
| **A5** | En Floci, el output `api_endpoint` devuelve una URL con formato de AWS que no sirve localmente. `envs/local` arma la URL con `api_id` | §7.3 y §7.5 |
| **A6** | Las URLs `*.localhost.floci.io` dependen de un DNS público que resuelve a `127.0.0.1`. Sin conexión a Internet, la API y el sitio no resuelven desde el host | §11.3 |
| **A7** | Crear la instancia RDS tarda unos 90 s: es el paso más lento de `local:up` y del job `e2e-local` | §9.1 y §10.1 |
| **A8** *(F5)* | **Cognito de Floci no soporta CORS**: el preflight `OPTIONS` responde 405 sin headers, y no hay opción de configuración para cambiarlo. El navegador no puede llamar a Cognito desde el origen del sitio, y el spike no lo detectó porque todo corría desde Node. Además, el website de S3 (`http` en un host que no es `localhost`) no es un contexto seguro: falta `crypto.randomUUID`. **Solución: proxy local en el mismo origen** (`scripts/local/web-proxy.mjs`), en `localhost`, que reenvía `/_floci/cognito` a Floci. En AWS real no hace falta, porque Cognito soporta CORS | §5.2, §7.3 y §10 |
| **A9** *(F5)* | **La HTTP API de Floci responde el preflight CORS, pero no agrega `Access-Control-Allow-Origin` a las respuestas reales** de la integración con Lambda. En AWS, con `cors_configuration`, API Gateway lo agrega en todas. El spike solo había probado el preflight. **Solución: la API también pasa por el proxy del mismo origen** (`/_floci/api`). El proxy se conecta a Floci por `localhost` con el `Host` de `execute-api`, así que tampoco depende del DNS público (A6) | §5.2 y §10 |
| **A10** *(F6)* | **La HTTP API de Floci acepta y devuelve los `accessLogSettings` del stage, pero no escribe access logs** en CloudWatch Logs: el log group queda vacío. Así lo muestra el código de `ApiGatewayV2Service`, que solo guarda la configuración, y lo confirmó el E2E en la CI. **Consecuencia:** el E2E verifica la configuración del stage (GetStage) en lugar de las líneas de log, y `pnpm local:logs api` en local no muestra nada. En AWS sí se escriben | §7.4 y §8.2 |

## Ejecución en GitHub Actions
- **29/29 chequeos OK en `ubuntu-latest`** el 2026-10-02, en 2 min 57 s ([run 37043661160](https://github.com/jcorta/pocAwsLambda/actions/runs/37043661160)), con el workflow `.github/workflows/spike-f0.yml`.
- Se comportó igual que en Windows, sin cambios de configuración: la arquitectura es la misma en los dos sistemas.
- **Aviso de GitHub:** `ubuntu-latest` pasa a Ubuntu 26 desde el 19 de octubre de 2026. Si algo se rompe después de esa fecha, la primera sospecha es el cambio de imagen. Se puede fijar `ubuntu-24.04` temporalmente.
