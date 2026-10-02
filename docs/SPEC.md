# Especificación — Sistema de reservas de recursos (POC AWS Lambda)

> Estado: **Especificación v1 completa** (secciones 1–13), ajustada con los resultados del spike F0 ([`docs/spikes/floci.md`](spikes/floci.md)). Única decisión diferida: D-3.1 (red en AWS real, se decide en F7).
> Documento de idea de origen: decisiones técnicas cerradas (ver §1.5).

---

## 1. Problema, objetivos y alcance

### 1.1 Problema
Una organización tiene recursos compartidos (salas, equipos, canchas, vehículos… el modelo es genérico) y sus miembros necesitan reservarlos por turnos. Hoy esto suele resolverse con planillas o mensajes, lo que produce **dobles reservas**, uso acaparado por pocas personas y cancelaciones de último momento.

### 1.2 Objetivos
1. Permitir a los usuarios ver la disponibilidad de un recurso y reservar un turno en pocos pasos.
2. **Garantizar que nunca existan dos reservas confirmadas que se solapen sobre el mismo recurso**, incluso bajo concurrencia.
3. Aplicar reglas de uso justo: límite de reservas activas por usuario, horizonte máximo de reserva y cancelación con anticipación mínima.
4. Notificar por email las confirmaciones y cancelaciones sin demorar la respuesta al usuario.
5. Objetivo técnico (POC): ejercitar una arquitectura serverless en AWS (API Gateway, Lambda, RDS, Cognito, SQS, SES, S3), con infraestructura en Terraform, tests en varios niveles y CI/CD, ejecutable en Floci y migrable a AWS real sin cambiar los módulos.

### 1.3 Alcance v1
- Registro e inicio de sesión con email y contraseña.
- Dos roles: `admin` y `user`.
- Administración de recursos, con horario de apertura semanal y duración de turno por recurso.
- Consulta de disponibilidad por recurso y fecha.
- Crear, listar y cancelar reservas de **un turno por reserva**.
- Configuración global de reglas, editable por el admin.
- Notificaciones por email (confirmación y cancelación).

### 1.4 Fuera de alcance v1
- Pagos.
- Reservas recurrentes, reservas de varios turnos consecutivos en una sola operación y listas de espera.
- Múltiples organizaciones (tenants).
- Múltiples zonas horarias: el sistema usa una única zona horaria configurable.
- Feriados y excepciones de horario por fecha.
- Login social y MFA.
- Recuperación de contraseña desde la app. En la v1, el admin la resetea con `AdminSetUserPassword` (AWS CLI o Floci UI).
- Kubernetes (extensión E-02, §13).

### 1.5 Decisiones técnicas cerradas (resumen)
| Tema | Decisión |
|---|---|
| Frontend | Next.js con export estático en S3 (más CloudFront solo en AWS real) |
| API | API Gateway v2 (HTTP API) con Lambdas en Node.js/TypeScript |
| Auth | Cognito User Pool (email y contraseña), grupo `admin`, JWT authorizer en API Gateway |
| Persistencia | RDS PostgreSQL 16, Drizzle ORM, migraciones versionadas |
| Notificaciones | SQS, Lambda notificadora y SES |
| Repo | Monorepo pnpm: `apps/web`, `services/api`, `packages/shared`, `infra/` |
| Infra | Terraform con módulos compartidos y roots `infra/envs/local` (Floci) e `infra/envs/aws` |
| CI/CD | GitHub Actions: deploy a Floci y E2E en CI, job a AWS real preparado (OIDC) y deshabilitado |

---

## 2. Actores, casos de uso y reglas de negocio

### 2.1 Actores
| Actor | Identificación | Capacidades |
|---|---|---|
| **Visitante** | Sin token | Registrarse e iniciar sesión |
| **Usuario** (`user`) | JWT válido de Cognito, sin el grupo `admin` | Ver recursos activos y disponibilidad, reservar, ver y cancelar **sus** reservas |
| **Admin** (`admin`) | JWT válido de Cognito con `admin` en `cognito:groups` | Todo lo del usuario, y además gestionar recursos, ver y cancelar **todas** las reservas, editar la configuración |

- Todo usuario registrado es `user` por defecto. El rol `admin` se asigna agregando al usuario al grupo `admin` de Cognito (en v1, por seed o manualmente; no hay endpoint para hacerlo).
- La identidad del usuario es el claim `sub` del token. El email se toma del claim `email`.

### 2.2 Conceptos
- **Turno (slot):** intervalo `[inicio, fin)` de un recurso, con una duración igual a `slot_minutes` del recurso, alineado al horario de apertura del día. Ejemplo: horario de 08:00 a 12:00 con turnos de 60 minutos genera 08:00, 09:00, 10:00 y 11:00.
- **Reserva activa:** reserva en estado `confirmed` cuyo inicio es posterior al instante actual.
- **Zona horaria del sistema:** `APP_TIMEZONE`, por defecto `America/Argentina/Buenos_Aires`. Es configurable por despliegue y acepta cualquier zona IANA.
  - Se usa para tres cosas: interpretar los horarios de apertura, determinar dónde empieza y termina "el día" (disponibilidad, RN-03) y mostrar horas en los emails.
  - En la base de datos todo se guarda en UTC (`timestamptz`).
  - El cálculo de turnos debe ser correcto también en zonas con horario de verano, donde hay días de 23 o 25 horas. Para eso se usa una librería que entienda zonas horarias, nunca offsets fijos.

### 2.3 Reglas de negocio

| ID | Regla | Valor por defecto |
|---|---|---|
| **RN-01** | No pueden existir dos reservas `confirmed` del mismo recurso con intervalos solapados. Se garantiza **en la base de datos**, no solo en el código. | — |
| **RN-02** | Una reserva debe coincidir exactamente con un turno válido: alineado a `slot_minutes` desde la apertura del día y completamente dentro del horario de apertura. | — |
| **RN-03** | Solo se puede reservar un turno futuro, dentro del horizonte de reserva. El horizonte se cuenta en **días calendario** de `APP_TIMEZONE`: se puede reservar cualquier turno cuyo día local sea anterior o igual a hoy + N, sin importar la hora. | `booking_horizon_days = 30` |
| **RN-04** | Solo se pueden reservar recursos activos. | — |
| **RN-05** | Un usuario no puede tener más de N reservas activas. El límite es **global**: cuenta las reservas en todos los recursos, no por recurso. También se respeta bajo concurrencia. Los admins no tienen este límite. | `max_active_bookings_per_user = 3` |
| **RN-06** | Un usuario solo puede cancelar su reserva si faltan **al menos** X horas para el inicio. El admin puede cancelar cualquier reserva futura sin esta restricción. Nadie puede cancelar una reserva que ya empezó. | `cancellation_min_hours = 2` |
| **RN-07** | Al confirmar o cancelar una reserva, se envía un email al titular. El envío es asincrónico: si falla, no revierte ni demora la operación. | — |
| **RN-08** | Cambiar el horario o la duración de turno de un recurso no modifica las reservas existentes. Los nuevos turnos que se solapen con reservas existentes se muestran como no disponibles (RN-01 lo garantiza). | — |
| **RN-09** | Desactivar un recurso impide nuevas reservas y lo oculta a los usuarios, pero **no** cancela las reservas existentes. Los recursos no se borran físicamente. | — |

### 2.4 Casos de uso y criterios de aceptación

Los códigos de error (`SLOT_TAKEN`, etc.) son identificadores estables que se detallan en el contrato de API (§4).

#### CU-01 Registrarse e iniciar sesión
- **Dado** un visitante, **cuando** se registra con un email válido y una contraseña que cumple la política de Cognito, **entonces** recibe un código de verificación por email y, al confirmarlo, queda habilitado con el rol `user`.
- **Dado** un usuario confirmado, **cuando** inicia sesión con credenciales correctas, **entonces** obtiene un ID token y un access token de Cognito.
- **Dado** un request a cualquier endpoint de la API sin token, o con un token inválido o vencido, **entonces** API Gateway responde `401` sin invocar la Lambda.

#### CU-02 Consultar recursos
- **Dado** un usuario autenticado, **cuando** lista los recursos, **entonces** ve solo los recursos activos, con nombre, descripción, atributos, duración de turno y horario semanal.
- **Dado** un admin, **cuando** lista los recursos con `includeInactive=true`, **entonces** también ve los inactivos, con su estado.

#### CU-03 Consultar disponibilidad
- **Dado** un recurso activo y una fecha dentro del horizonte, **cuando** el usuario consulta la disponibilidad, **entonces** recibe todos los turnos del día con estado `available`, `booked` o `past`.
- **Dado** un día sin horario de apertura para ese recurso, **entonces** la lista de turnos está vacía.
- **Dado** una fecha anterior a hoy o posterior al horizonte, **entonces** se responde `400 DATE_OUT_OF_RANGE`.
- **Dado** un turno reservado por el usuario que consulta, **entonces** el turno indica `booked` y `mine: true`. Para turnos de otros usuarios no se expone quién reservó.
- **Dado** un turno cuyo inicio ya pasó, **entonces** su estado es `past`, aunque esté reservado. `past` tiene prioridad sobre `booked`, pero `mine` se sigue informando.

#### CU-04 Reservar un turno
- **Dado** un turno `available` y un usuario por debajo de su límite, **cuando** reserva, **entonces** se crea la reserva `confirmed`, se responde `201` y se encola la notificación de confirmación.
- **Dado** un turno ya reservado, **cuando** otro usuario intenta reservarlo, **entonces** se responde `409 SLOT_TAKEN`.
- **Dado** un turno libre, **cuando** dos usuarios lo reservan **en simultáneo**, **entonces** exactamente uno recibe `201` y el otro `409 SLOT_TAKEN`. *(Hay un test de integración obligatorio con N requests concurrentes.)*
- **Dado** un usuario con `max_active_bookings_per_user` reservas activas, **cuando** intenta reservar otra, **entonces** se responde `409 BOOKING_LIMIT_REACHED`. Esto también vale si las reservas que superarían el límite llegan en simultáneo.
- **Dado** un inicio que no coincide con un turno válido (desalineado, fuera de horario o en un día sin apertura), **entonces** se responde `400 INVALID_SLOT`.
- **Dado** un turno en el pasado o más allá del horizonte, **entonces** se responde `400 DATE_OUT_OF_RANGE`.
- **Dado** un recurso inexistente o inactivo, **entonces** se responde `404 RESOURCE_NOT_FOUND`. También para un admin: un recurso inactivo no se puede reservar (RN-04).
- **Dado** un admin, **cuando** reserva, **entonces** no se le aplica el límite de RN-05. Las demás reglas sí.

#### CU-05 Ver mis reservas
- **Dado** un usuario autenticado, **cuando** lista sus reservas, **entonces** ve solo las suyas, ordenadas por inicio, y puede filtrar por `upcoming` (activas) o `past` (pasadas o canceladas).

#### CU-06 Cancelar una reserva
- **Dado** una reserva propia que empieza en 2 horas o más, **cuando** el usuario la cancela, **entonces** pasa a `cancelled`, se registra quién y cuándo canceló, el turno vuelve a estar disponible, se responde `200` y se encola la notificación de cancelación.
- **Dado** una reserva propia que empieza en menos de `cancellation_min_hours`, **entonces** se responde `409 CANCELLATION_WINDOW_CLOSED`. *(Borde: si falta exactamente ese tiempo, se permite cancelar.)*
- **Dado** una reserva de otro usuario, **cuando** un `user` intenta cancelarla, **entonces** se responde `404 BOOKING_NOT_FOUND`, sin revelar que existe.
- **Dado** cualquier reserva futura, **cuando** un admin la cancela, **entonces** se cancela sin importar la anticipación y el titular recibe el email.
- **Dado** una reserva ya iniciada o pasada, **entonces** se responde `409 BOOKING_ALREADY_STARTED`.
- **Dado** una reserva ya cancelada, **entonces** se responde `409 BOOKING_ALREADY_CANCELLED`.

#### CU-07 Gestionar recursos (admin)
- **Dado** un admin, **cuando** crea un recurso con nombre, `slot_minutes` y horario semanal válidos, **entonces** se crea activo y se responde `201`.
- **Dado** `slot_minutes` fuera de {15, 30, 45, 60, 90, 120}, o una franja del horario cuya duración no es múltiplo de `slot_minutes`, o un cierre igual o anterior a la apertura, **entonces** se responde `400 VALIDATION_ERROR` con el detalle por campo.
- **Dado** un admin, **cuando** edita o desactiva un recurso, **entonces** se aplican RN-08 y RN-09.
- **Dado** un `user`, **cuando** invoca cualquier operación de administración, **entonces** se responde `403 FORBIDDEN`.

#### CU-08 Ver todas las reservas (admin)
- **Dado** un admin, **cuando** lista las reservas, **entonces** puede filtrar por recurso, rango de fechas, estado y usuario. El resultado está paginado e incluye el email del titular.

#### CU-09 Configurar reglas (admin)
- **Dado** un admin, **cuando** consulta o modifica `max_active_bookings_per_user`, `cancellation_min_hours` o `booking_horizon_days` con valores enteros válidos (≥ 1 para el límite y el horizonte, ≥ 0 para la cancelación), **entonces** se guardan y aplican a las operaciones siguientes, sin afectar las reservas existentes.

#### CU-10 Notificación por email
- **Dado** una reserva confirmada o cancelada, **entonces** el titular recibe en minutos un email con el recurso, la fecha y la hora en `APP_TIMEZONE`, y la acción realizada.
- **Dado** un fallo temporal al enviar, **entonces** el mensaje se reintenta, y tras 3 intentos fallidos pasa a una dead-letter queue (DLQ) para inspección.
- **Dado** un mismo evento entregado más de una vez, **entonces** el email no debe duplicarse. *(Idempotencia por id de evento, ver §3.)*

> **Cómo se prueba en local:** Floci no entrega los emails, los guarda en memoria. Los tests verifican el envío con `GET http://localhost:4566/_aws/ses`, y antes de cada suite vacían la bandeja con `DELETE /_aws/ses`. Los tests **no** dependen de Mailpit (ver §10).

> **Usuarios en local y CI:** el seed y los tests crean usuarios ya confirmados, sin depender del email con el código de verificación:
> - `AdminCreateUser` con `MessageAction=SUPPRESS` (sin email de invitación) y `email_verified=true`.
> - `AdminSetUserPassword` con `Permanent=true`.
>
> Si un test necesita recorrer el registro (`SignUp`), lo confirma con `AdminConfirmSignUp`. Todas son APIs estándar de Cognito, también válidas en AWS. El flujo con el código real de CU-01 se valida a mano o, si Floci captura ese email en `/_aws/ses`, también en el E2E.

---

## 3. Modelo de datos y migraciones

### 3.1 Diagrama
```
users 1───* bookings *───1 resources 1───* resource_opening_hours
                                     settings (fila única)
notification_log (idempotencia de emails)
```

### 3.2 Tablas

#### `users`
Espejo mínimo de Cognito, para joins, emails y para bloquear por usuario (RN-05). Se inserta o actualiza (*upsert*) a partir de los claims del token en dos momentos:
- En `GET /v1/me`, que el frontend llama después de cada login.
- En cada request que escribe datos (reservar o cancelar), como garantía.

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `text` | PK. Es el `sub` de Cognito |
| `email` | `text` | NOT NULL |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

#### `resources`
| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `name` | `text` | NOT NULL, de 1 a 100 caracteres, UNIQUE |
| `description` | `text` | NULL, hasta 1000 caracteres |
| `attributes` | `jsonb` | NOT NULL, default `'{}'`. Atributos libres, por ejemplo `{"capacidad": 8}` |
| `slot_minutes` | `smallint` | NOT NULL, CHECK `IN (15,30,45,60,90,120)`, default `60` |
| `is_active` | `boolean` | NOT NULL, default `true` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

#### `resource_opening_hours`
Una franja por día de semana y recurso en v1.

| Columna | Tipo | Restricciones |
|---|---|---|
| `resource_id` | `uuid` | FK a `resources.id`, ON DELETE CASCADE |
| `weekday` | `smallint` | CHECK `BETWEEN 1 AND 7` (ISO: 1 = lunes) |
| `opens_at` | `time` | NOT NULL |
| `closes_at` | `time` | NOT NULL, CHECK `closes_at > opens_at` |
| | | PK (`resource_id`, `weekday`) |

La validación de que la duración de la franja sea múltiplo de `slot_minutes` se hace en la aplicación, porque depende de otra tabla.

#### `bookings`
| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `resource_id` | `uuid` | NOT NULL, FK a `resources.id` |
| `user_id` | `text` | NOT NULL, FK a `users.id` |
| `starts_at` | `timestamptz` | NOT NULL |
| `ends_at` | `timestamptz` | NOT NULL, CHECK `ends_at > starts_at` |
| `status` | `booking_status` (enum: `confirmed`, `cancelled`) | NOT NULL, default `confirmed` |
| `cancelled_at` | `timestamptz` | NULL |
| `cancelled_by` | `text` | NULL, FK a `users.id` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

CHECK de consistencia: `status = 'cancelled'` si y solo si `cancelled_at IS NOT NULL`.

**Garantía de RN-01, sin solapamientos.** Se usa una *exclusion constraint* sobre rangos de tiempo, que requiere la extensión `btree_gist`:
```sql
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'confirmed');
```
> Se prefiere a un índice único sobre `(resource_id, starts_at)` porque, si el admin cambia `slot_minutes` (RN-08), dos reservas con inicios distintos pueden solaparse, y un índice único no lo detecta. La violación (SQLSTATE `23P01`) se traduce a `409 SLOT_TAKEN`.

**Índices:**
- `(user_id, starts_at)`: para "mis reservas" y el conteo de reservas activas.
- `(resource_id, starts_at)`: para la disponibilidad por día y los listados del admin.

#### `settings`
Fila única (`id = 1`, CHECK `id = 1`).

| Columna | Tipo | Default |
|---|---|---|
| `max_active_bookings_per_user` | `smallint`, CHECK ≥ 1 | `3` |
| `cancellation_min_hours` | `smallint`, CHECK ≥ 0 | `2` |
| `booking_horizon_days` | `smallint`, CHECK ≥ 1 | `30` |
| `updated_at` | `timestamptz` | `now()` |

`APP_TIMEZONE` **no** está en esta tabla: es configuración de despliegue (variable de entorno de las Lambdas), porque cambiarla en caliente alteraría la interpretación de los horarios.

#### `notification_log`
Asegura que la Lambda notificadora sea idempotente (CU-10).

| Columna | Tipo | Restricciones |
|---|---|---|
| `event_id` | `uuid` | PK. Id del evento publicado en SQS |
| `booking_id` | `uuid` | NOT NULL, FK a `bookings.id` |
| `type` | `text` | CHECK `IN ('booking_confirmed','booking_cancelled')` |
| `sent_at` | `timestamptz` | NOT NULL, default `now()` |

### 3.3 Transacción de reserva (RN-01 y RN-05 bajo concurrencia)
Dentro de **una** transacción:
1. Upsert del usuario en `users` y `SELECT … FOR UPDATE` de su fila. Esto serializa las reservas concurrentes **del mismo usuario**, para que el conteo de RN-05 sea correcto.
2. Leer `settings` y el recurso, y validar RN-02, RN-03 y RN-04.
3. Contar las reservas activas del usuario y validar RN-05. Este paso se omite si el usuario es admin.
4. `INSERT` en `bookings`. Si la exclusion constraint falla, se responde `409 SLOT_TAKEN`. Esto resuelve la concurrencia **entre usuarios distintos** sin bloqueos explícitos.
5. Commit, y después publicar el evento en SQS (ver nota).

> **Entrega del evento (decisión v1):** se publica en SQS **después del commit**, nunca antes, para no notificar reservas que no existen. Si la publicación falla, la reserva sigue siendo válida (RN-07) y ese email se pierde. La falla se registra como log de error estructurado (`event=notification_publish_failed`, con `booking_id` y `type`) para que se pueda detectar y reenviar a mano. Es un riesgo aceptado para la v1. La solución completa (*transactional outbox*) queda como extensión E-01 (§13).

### 3.4 Datos semilla (entorno local y CI)
- Usuario admin en Cognito (`admin@example.com`, en el grupo `admin`) y un usuario de prueba (`user@example.com`).
- Fila de `settings` con los valores por defecto.
- 3 recursos de ejemplo con horarios de lunes a viernes, de 08:00 a 20:00, con turnos de 30, 60 y 120 minutos.

### 3.5 Migraciones
- Se generan con `drizzle-kit` a partir del esquema TypeScript en `services/api` y se versionan en el repo como SQL.
- La exclusion constraint, la extensión `btree_gist` y los CHECK que Drizzle no exprese se agregan como SQL manual dentro de la migración.
- Se aplican con la Lambda `migrator` (§6.1), que invoca el pipeline o `local:up`, **nunca** en el arranque en frío de las Lambdas de la API. Los tests de integración aplican las mismas migraciones directamente sobre el contenedor de Testcontainers.
- Solo se admiten migraciones hacia adelante. Cada una debe poder aplicarse sobre una base vacía y sobre la versión anterior; esto se verifica en CI.

### 3.6 Decisiones de esta parte
1. ~~Transactional outbox o publicar después del commit~~ → **Resuelta:** en la v1 se publica después del commit (§3.3). El outbox queda como extensión E-01 (§13).
2. ~~Zona horaria por defecto~~ → **Resuelta:** `America/Argentina/Buenos_Aires`, configurable (§2.2).
3. ~~Valores por defecto de las reglas~~ → **Resuelta:** 3 reservas activas (límite global), 2 h de anticipación para cancelar y 30 días calendario de horizonte. Todos son editables por el admin (CU-09).

---

## 4. Contrato de API

### 4.1 Convenciones generales
- **Base:** `{API_URL}/v1`. API Gateway v2 (HTTP API), stage `$default`.
- **Formato:** JSON (`Content-Type: application/json`), propiedades en `camelCase`.
- **Autenticación:** todos los endpoints requieren `Authorization: Bearer <ID token>` de Cognito (decisión D-2.1). El JWT authorizer de API Gateway valida firma (JWKS), emisor (`iss`), audiencia (`aud` = clientId del app client) y vencimiento. Si algo falla, responde `401` sin invocar la Lambda.
  - **El authorizer también deja pasar el access token**, en AWS y en Floci (hallazgo A3 del spike F0). Cuando el token no trae `aud`, compara `client_id` con la audiencia. Por eso **la Lambda rechaza con `401 INVALID_TOKEN_TYPE`** cualquier token cuyo claim `token_use` no sea `id`.
- **Autorización por rol:** la hace la Lambda leyendo el claim `cognito:groups`. Las rutas `/v1/admin/*` exigen el grupo `admin`; si falta, responden `403 FORBIDDEN`.
- **Fechas:**
  - Los instantes se devuelven en ISO 8601 **con el offset** de `APP_TIMEZONE`, por ejemplo `2026-10-05T08:00:00-03:00`, y se aceptan con cualquier offset válido.
  - Las fechas sin hora (`YYYY-MM-DD`) se interpretan en `APP_TIMEZONE`.
  - Las horas de apertura se expresan como `HH:mm` locales.
- **Validación:** los esquemas de request y response se definen una sola vez con **Zod** en `packages/shared` y los usan tanto la API como el frontend.
- **Paginación** (solo en listados que pueden crecer): `?limit=` (por defecto 20, máximo 100) y `?cursor=` opaco. La respuesta trae `{ "items": [...], "nextCursor": "..." | null }`.
- **CORS:** API Gateway permite solo los orígenes configurados por entorno (por ejemplo `http://localhost:3000`, la URL del bucket S3 en Floci y el dominio de CloudFront en AWS).
- **Trazabilidad:** toda respuesta incluye el header `x-request-id`, que también aparece en los logs.

### 4.2 Formato de error
```json
{
  "error": {
    "code": "SLOT_TAKEN",
    "message": "El turno ya fue reservado.",
    "details": { },
    "requestId": "c0a8…"
  }
}
```
- `code` es estable y el frontend lo usa para decidir qué hacer. `message` es orientativo y está en español.
- En `VALIDATION_ERROR`, `details.fields` es una lista de `{ "path": "openingHours[0].closesAt", "message": "..." }`.
- Excepción: los `401` los genera API Gateway, con su propio cuerpo (`{"message":"Unauthorized"}`), que no se puede personalizar. El frontend trata cualquier `401` como sesión inválida.

### 4.3 Catálogo de errores
| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | El body o los parámetros no cumplen el esquema |
| 400 | `INVALID_SLOT` | El inicio no coincide con un turno válido (RN-02) |
| 400 | `DATE_OUT_OF_RANGE` | La fecha está en el pasado o fuera del horizonte (RN-03) |
| 401 | — (lo responde API Gateway) | Falta el token, o es inválido o está vencido |
| 401 | `INVALID_TOKEN_TYPE` | El token es válido pero no es un ID token (`token_use` ≠ `id`). Lo responde la Lambda |
| 403 | `FORBIDDEN` | Un `user` llama a una ruta `/admin` |
| 404 | `RESOURCE_NOT_FOUND` | El recurso no existe, o está inactivo y quien consulta no es admin. Al reservar, un recurso inactivo responde este código a todos, incluido el admin |
| 404 | `BOOKING_NOT_FOUND` | La reserva no existe, o es de otro usuario y quien consulta no es admin |
| 404 | `ROUTE_NOT_FOUND` | La ruta no existe |
| 409 | `SLOT_TAKEN` | El turno está ocupado (RN-01). Si lo ocupa una reserva propia, `details.mine = true` |
| 409 | `BOOKING_LIMIT_REACHED` | Se alcanzó el límite de reservas activas (RN-05). `details.limit` indica el valor |
| 409 | `CANCELLATION_WINDOW_CLOSED` | Falta menos de la anticipación mínima para cancelar (RN-06). `details.minHours` indica el valor |
| 409 | `BOOKING_ALREADY_STARTED` | La reserva ya empezó o ya pasó |
| 409 | `BOOKING_ALREADY_CANCELLED` | La reserva ya está cancelada |
| 409 | `RESOURCE_NAME_TAKEN` | Ya existe un recurso con ese nombre |
| 500 | `INTERNAL_ERROR` | Error no previsto. Se registra en el log con el stack y el `requestId` |

### 4.4 Representaciones

**Resource**
```json
{
  "id": "uuid",
  "name": "Sala Azul",
  "description": "Sala con TV, 8 personas",
  "attributes": { "capacidad": 8 },
  "slotMinutes": 60,
  "openingHours": [ { "weekday": 1, "opensAt": "08:00", "closesAt": "20:00" } ],
  "isActive": true,
  "createdAt": "…",
  "updatedAt": "…"
}
```
`isActive`, `createdAt` y `updatedAt` solo se incluyen en las respuestas a un admin.

**Booking**
```json
{
  "id": "uuid",
  "resource": { "id": "uuid", "name": "Sala Azul" },
  "startsAt": "2026-10-05T10:00:00-03:00",
  "endsAt": "2026-10-05T11:00:00-03:00",
  "status": "confirmed",
  "createdAt": "…",
  "cancelledAt": null,
  "cancelledBy": null
}
```
- `cancelledBy` puede valer `"self"`, `"admin"` o `null`.
- En las vistas de admin se agrega `"user": { "id": "...", "email": "..." }`.

### 4.5 Endpoints

#### Usuario autenticado (`user` o `admin`)

| Método y ruta | Descripción | Respuesta |
|---|---|---|
| `GET /v1/me` | Datos del usuario actual. Hace upsert en `users` | `200 { id, email, roles: ["user"] \| ["admin"] }` |
| `GET /v1/resources` | Lista de recursos activos, ordenada por nombre. Si quien consulta es admin y pasa `?includeInactive=true`, incluye también los inactivos | `200 { items: Resource[] }` (sin paginar, son pocos) |
| `GET /v1/resources/{id}` | Detalle de un recurso | `200 Resource` · `404 RESOURCE_NOT_FOUND` |
| `GET /v1/resources/{id}/availability?date=YYYY-MM-DD` | Turnos del día (CU-03) | `200 Availability` · `400 DATE_OUT_OF_RANGE` · `404` |
| `POST /v1/bookings` | Reservar (CU-04). Body: `{ "resourceId", "startsAt" }`. `endsAt` lo calcula el servidor | `201 Booking` · `400 INVALID_SLOT \| DATE_OUT_OF_RANGE` · `404` · `409 SLOT_TAKEN \| BOOKING_LIMIT_REACHED` |
| `GET /v1/bookings/me?scope=upcoming\|past` | Mis reservas (CU-05). `upcoming` (el valor por defecto) devuelve las activas, ordenadas por inicio ascendente. `past` devuelve las pasadas y las canceladas, ordenadas por inicio descendente. Paginado | `200 { items: Booking[], nextCursor }` |
| `POST /v1/bookings/{id}/cancel` | Cancelar (CU-06). Un `user` solo puede cancelar las propias. Un admin puede cancelar cualquiera | `200 Booking` · `404 BOOKING_NOT_FOUND` · `409 CANCELLATION_WINDOW_CLOSED \| BOOKING_ALREADY_STARTED \| BOOKING_ALREADY_CANCELLED` |

**Availability**
```json
{
  "resourceId": "uuid",
  "date": "2026-10-05",
  "timezone": "America/Argentina/Buenos_Aires",
  "slots": [
    { "startsAt": "2026-10-05T08:00:00-03:00", "endsAt": "2026-10-05T09:00:00-03:00", "status": "available", "mine": false },
    { "startsAt": "2026-10-05T09:00:00-03:00", "endsAt": "2026-10-05T10:00:00-03:00", "status": "booked", "mine": true }
  ]
}
```
`status` puede valer `available`, `booked` o `past`. Un turno ocupado por una reserva solapada (RN-08) figura como `booked`.

> **Cancelar es `POST …/cancel`, no `DELETE`:** cancelar es una transición de estado. La reserva sigue existiendo, con `status = cancelled`, y `DELETE` sugeriría que se borra.

#### Admin (`/v1/admin/*`, requiere el grupo `admin`)

| Método y ruta | Descripción | Respuesta |
|---|---|---|
| `POST /v1/admin/resources` | Crear un recurso (CU-07). Body: `{ name, description?, attributes?, slotMinutes, openingHours[] }` | `201 Resource` · `400 VALIDATION_ERROR` · `409 RESOURCE_NAME_TAKEN` |
| `PUT /v1/admin/resources/{id}` | Reemplazar un recurso completo, incluidos `openingHours` e `isActive`. Desactivar es `isActive: false` (RN-09) | `200 Resource` · `400` · `404` · `409 RESOURCE_NAME_TAKEN` |
| `GET /v1/admin/bookings` | Todas las reservas (CU-08). Filtros: `resourceId`, `from`, `to` (fechas), `status`, `userEmail` (coincidencia exacta). Ordenadas por inicio descendente y paginadas | `200 { items: Booking[], nextCursor }` |
| `GET /v1/admin/settings` | Configuración actual (CU-09) | `200 { maxActiveBookingsPerUser, cancellationMinHours, bookingHorizonDays, updatedAt }` |
| `PUT /v1/admin/settings` | Modificar la configuración. Body: los tres valores | `200 Settings` · `400 VALIDATION_ERROR` |

**Validaciones de `openingHours`:**
- Hay como máximo un elemento por `weekday`, del 1 al 7.
- `closesAt` es posterior a `opensAt`.
- La duración de cada franja es múltiplo de `slotMinutes`.
- Puede estar vacío: en ese caso el recurso no tiene turnos.

---

## 5. Frontend

### 5.1 Enfoque
- Next.js (App Router) con **`output: 'export'`**: genera HTML, JS y CSS estáticos, sin servidor. En local se sirve con `next dev` o desde un bucket S3 de Floci; en AWS, desde S3 con CloudFront.
- **Restricciones del export estático** (son explícitas para no descubrirlas tarde):
  - No hay Server Components con datos dinámicos, API routes, middleware ni `next/image` optimizado.
  - Las rutas con parámetros dinámicos requieren conocerlos al compilar, así que **se usan query params en lugar de segmentos dinámicos**: `/resources/view?id=…` en vez de `/resources/[id]`.
- Todo el acceso a datos ocurre en el cliente: **TanStack Query** para cache y reintentos, y un cliente HTTP tipado sobre `fetch` que usa los esquemas Zod de `packages/shared`.
- Estilos con **Tailwind CSS**. Sin una librería de componentes pesada.

### 5.2 Configuración en tiempo de ejecución ("build once, deploy many")
El mismo build sirve para Floci y para AWS. Al arrancar, la app lee `/config.json`, que **escribe Terraform** en el bucket, con los outputs del entorno:
```json
{
  "apiUrl": "http://localhost:4566/…",
  "cognito": { "region": "us-east-1", "userPoolId": "…", "clientId": "…", "endpoint": "http://localhost:4566" },
  "timezone": "America/Argentina/Buenos_Aires"
}
```
En AWS real `cognito.endpoint` se omite, y el SDK usa el endpoint de AWS.

- **`config.json` nunca forma parte del build:**
  - El archivo `apps/web/public/config.json`, que genera `local:up` para `pnpm dev`, está en `.gitignore` y se excluye del export.
  - El deploy del sitio (`aws s3 sync`) usa `--exclude config.json`, para no pisar ni borrar el que escribió Terraform.

### 5.3 Autenticación en el cliente
- **Pantallas de login y registro propias.** No se usa el Hosted UI de Cognito, porque su soporte en Floci no está confirmado y así el flujo es idéntico en los dos entornos.
- Se usa `@aws-sdk/client-cognito-identity-provider` directamente, sin Amplify, para poder apuntar el endpoint a Floci. Llamadas:
  - `SignUp` para registrarse.
  - `ConfirmSignUp` y `ResendConfirmationCode` para confirmar el registro.
  - `InitiateAuth` con `USER_PASSWORD_AUTH` para iniciar sesión, y con `REFRESH_TOKEN_AUTH` para renovar el token.
  - `GlobalSignOut` para cerrar la sesión.
- **Por qué `USER_PASSWORD_AUTH` y no SRP:** es el flujo más simple y con mayor probabilidad de estar soportado en Floci. La contraseña viaja a Cognito por TLS en AWS real. Pasar a SRP queda como mejora de seguridad para AWS real.
- **Tokens: solo en memoria** (decisión D-2.3).
  - Los tres tokens (ID, access y refresh) viven en el estado de la app (un contexto de React). **Nunca** se escriben en `localStorage`, `sessionStorage` ni cookies.
  - El ID token se envía a la API. El access token se usa solo para `GlobalSignOut`, que lo requiere.
  - Mientras la pestaña está abierta, el ID token se renueva con el refresh token un minuto antes de vencer. Ante un `401`, el cliente intenta un refresh una vez y, si falla, redirige a `/login`.
  - **Consecuencia aceptada:** al recargar la página, abrir otra pestaña o cerrar el navegador, la sesión se pierde y hay que volver a iniciar sesión. Al redirigir a `/login`, la app recuerda la ruta de origen (en un query param `?next=`) y vuelve a ella después de loguearse.
  - Al cerrar sesión se llama a `GlobalSignOut` para revocar el refresh token en Cognito.
- **Después de cada login**, el frontend llama a `GET /v1/me`. Así se registra el usuario en `users` y se obtienen sus `roles`.
- **Visibilidad por rol:** el menú de admin aparece solo si `roles` (de `/v1/me`) incluye `admin`. Esto es solo de UI; la autorización real está en la API.

### 5.4 Páginas
| Ruta | Acceso | Contenido |
|---|---|---|
| `/login` | Pública | Email y contraseña. Enlace a registro. Si el usuario no está confirmado, lleva a `/confirm` |
| `/register` | Pública | Email, contraseña y confirmación de contraseña. Muestra la política de contraseñas |
| `/confirm?email=` | Pública | Código de verificación y botón para reenviarlo |
| `/` | Autenticado | Redirige a `/resources` |
| `/resources` | Autenticado | Tarjetas de recursos activos: nombre, descripción, atributos, duración de turno |
| `/resources/view?id=` | Autenticado | Detalle del recurso, selector de fecha (de hoy al horizonte) y grilla de turnos con sus estados (disponible, ocupado, mío, pasado). Clic en un turno disponible → modal de confirmación → reservar |
| `/bookings` | Autenticado | Mis reservas, en pestañas "Próximas" y "Pasadas". Botón "Cancelar" deshabilitado, con explicación, si se cerró la ventana de cancelación |
| `/admin/resources` | Admin | Tabla de recursos, incluidos los inactivos, con acciones crear, editar y activar o desactivar |
| `/admin/resources/edit?id=` | Admin | Formulario de recurso, con grilla de horario semanal. Sin `id`, crea un recurso nuevo |
| `/admin/bookings` | Admin | Tabla filtrable (recurso, fechas, estado, email) con paginación y acción de cancelar |
| `/admin/settings` | Admin | Formulario con las tres reglas |

### 5.5 Comportamiento transversal
- **Horas:** siempre se muestran en `config.timezone`, sin importar la zona del navegador, y con la zona indicada en pantalla.
- **Errores:** cada `code` de §4.3 tiene un mensaje en español. Además:
  - `SLOT_TAKEN` refresca la grilla de disponibilidad.
  - `VALIDATION_ERROR` marca los campos del formulario usando `details.fields`.
- **Estados:** cada vista tiene estado de carga (skeleton), estado vacío y error con opción de reintentar.
- **Accesibilidad básica:** navegación con teclado en la grilla de turnos, labels en los formularios y contraste AA.

---

## 6. Arquitectura

### 6.1 Vista general
```
                         ┌──────────────┐
  Navegador ── HTTPS ──▶ │ S3 (+ CloudFront en AWS) │  sitio estático + config.json
      │                  └──────────────┘
      │  login / refresh
      ├──────────────────▶ Cognito User Pool (grupo admin)
      │
      │  Bearer JWT
      └──────────────────▶ API Gateway HTTP API ── JWT authorizer (JWKS de Cognito)
                                  │
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
      λ me / λ resources     λ bookings          λ admin         (una por dominio, §6.7)
                └─────────┬───────┴──────────────────┘
                          ▼                     │ SendMessage (después del commit)
                   RDS PostgreSQL 16            ▼
                          ▲               SQS notifications ──(3 intentos)──▶ SQS DLQ
                          │                     │
                          └──── λ notifier ◀────┘ ──▶ SES

   λ migrator: aplica migraciones Drizzle. La invoca el pipeline después del deploy de infra.
   Secrets Manager: credenciales de la DB. CloudWatch Logs: logs de todas las Lambdas.
```

### 6.2 Flujo de autenticación
1. El frontend llama a `InitiateAuth` (`USER_PASSWORD_AUTH`) en Cognito y recibe el ID token, el access token y el refresh token.
2. Cada request a la API lleva `Authorization: Bearer <ID token>`.
3. El JWT authorizer de API Gateway valida firma, `iss`, audiencia y `exp`. Si falla, responde `401`.
4. La Lambda lee los claims en `event.requestContext.authorizer.jwt.claims`: `sub`, `email`, `cognito:groups` y `token_use`.
   > **Verificado en el spike F0:** en el token, `cognito:groups` es un array (`["admin"]`), pero en `requestContext` llega como string (`"[admin]"`). El parser de roles acepta las dos formas, y hay un test unitario para esto.
5. Si `token_use` no es `id`, la Lambda responde `401 INVALID_TOKEN_TYPE` (hallazgo A3).
6. La Lambda hace la autorización por rol y aplica las reglas.

### 6.3 Flujo de una reserva
1. `POST /v1/bookings` llega a la Lambda de reservas.
2. El handler valida el body con Zod y arma el contexto de usuario.
3. El servicio de reservas ejecuta la transacción de §3.3: bloqueo del usuario, reglas RN-02 a RN-05 e insert protegido por la exclusion constraint.
4. Commit y respuesta `201`.
5. Después del commit se publica en SQS:
   ```json
   {
     "eventId": "uuid",
     "type": "booking_confirmed",
     "occurredAt": "…",
     "booking": {
       "id": "uuid",
       "resourceName": "Sala Azul",
       "startsAt": "…",
       "endsAt": "…",
       "userEmail": "…"
     },
     "cancelledBy": null
   }
   ```
   Si la publicación falla, se registra en el log y no afecta la respuesta (§3.3).

### 6.4 Flujo de notificación
1. SQS invoca a la Lambda notificadora con lotes de hasta 10 mensajes y respuesta parcial (`ReportBatchItemFailures`): solo se reintentan los mensajes que fallaron.
2. Por cada mensaje:
   1. `INSERT INTO notification_log … ON CONFLICT (event_id) DO NOTHING`. Si no insertó, el evento ya se procesó y se descarta.
   2. Envía el email con SES, a partir de una plantilla de texto y HTML en español, con la hora en `APP_TIMEZONE`.
   3. Si SES falla, borra la fila de `notification_log` y marca el mensaje como fallido para que se reintente.
3. Después de 3 intentos fallidos, el mensaje pasa a la DLQ.

### 6.5 Estructura del código de una Lambda
Hay tres capas, y la lógica de negocio no depende de AWS:
```
services/api/src/
  handlers/        Adaptador HTTP: parsea el evento, contexto de auth, valida con Zod, mapea errores a §4.3
  domain/          Lógica pura: generación de turnos, reglas RN-xx, cálculo de fechas.
                   Recibe `now` y `timezone` como parámetros para que los tests sean deterministas
  services/        Casos de uso: orquestan el dominio y los repositorios dentro de la transacción
  repositories/    Acceso a datos con Drizzle
  infra/           Clientes compartidos: pool de pg, SQS, SES, logger, config
packages/shared/   Esquemas Zod, tipos y códigos de error compartidos con el frontend
```
- **Conexión a la DB:** un `pg.Pool` con `max: 1`, creado fuera del handler para reutilizarlo entre invocaciones en caliente. `statement_timeout` de 5 s. Las credenciales se leen de Secrets Manager en el arranque en frío y quedan en cache. En AWS real, RDS Proxy queda como mejora (§11).
- **Empaquetado:** `esbuild` genera un bundle por Lambda (un zip). Runtime Node.js 22. Arquitectura configurable por variable (`x86_64` por defecto, por compatibilidad local).
- **Configuración:** por variables de entorno que define Terraform: `APP_TIMEZONE`, `DB_SECRET_ARN`, `NOTIFICATIONS_QUEUE_URL` y `SES_FROM`. CORS no es una variable de las Lambdas: lo resuelve API Gateway (§4.1).
- **Clientes de AWS:** se crean sin endpoint explícito. En Floci, el SDK toma `AWS_ENDPOINT_URL`, que Floci inyecta en cada Lambda; en AWS, usa los endpoints estándar.
  - **SQS:** el cliente se crea con `useQueueUrlAsEndpoint: false` (hallazgo A2). Si no, el SDK envía al host de la `QueueUrl` (`localhost:4566`), que dentro del contenedor de la Lambda no es Floci. En AWS no cambia nada.
- **Logs:** JSON estructurado (Powertools for AWS Lambda: Logger), con `requestId`, `userId`, ruta y duración. Nunca se registran tokens ni contraseñas.

### 6.6 Límites de las Lambdas (valores iniciales)
| Lambda | Memoria | Timeout | Disparador |
|---|---|---|---|
| me, resources, bookings, admin | 512 MB | 10 s | API Gateway |
| notifier | 256 MB | 30 s | SQS (batch de 10) |
| migrator | 512 MB | 60 s | Invocación manual o desde el pipeline |

### 6.7 Distribución de rutas en Lambdas
Cada ruta de §4.5 se declara **por separado** en API Gateway (sin `{proxy+}`), así el contrato queda explícito en Terraform. Varias rutas apuntan a la misma Lambda de su dominio, que tiene un router interno mínimo por `routeKey` (por ejemplo `"POST /v1/bookings"`), sin frameworks.

| Lambda | Rutas | Permisos IAM además de logs y lectura del secreto de la DB |
|---|---|---|
| `me` | `GET /v1/me` | — |
| `resources` | `GET /v1/resources`, `GET /v1/resources/{id}`, `GET /v1/resources/{id}/availability` | — |
| `bookings` | `POST /v1/bookings`, `GET /v1/bookings/me`, `POST /v1/bookings/{id}/cancel` | `sqs:SendMessage` en `notifications` |
| `admin` | `/v1/admin/*` (5 rutas) | — (cuando el admin cancela una reserva, usa `POST /v1/bookings/{id}/cancel`, que atiende la Lambda `bookings`) |
| `notifier` | Disparada por SQS | `sqs:ReceiveMessage`, `DeleteMessage` y `GetQueueAttributes` en `notifications`, y `ses:SendEmail` |
| `migrator` | Invocación directa | — |

Además, todas las Lambdas tienen los permisos de red necesarios para correr en la VPC: crear, describir y borrar interfaces de red (la política administrada `AWSLambdaVPCAccessExecutionRole`).

- El chequeo del grupo `admin` se hace **una sola vez**, en la entrada de la Lambda `admin`, antes de rutear.
- Si llega un `routeKey` que el router no conoce, la Lambda responde `404 ROUTE_NOT_FOUND`. Hay un test que verifica que cada ruta declarada en Terraform tenga su handler.
- Todas las Lambdas de la API comparten el mismo código de `services/api`. El bundle de cada una solo incluye los handlers de su dominio (un entrypoint de esbuild por Lambda).

### 6.8 Decisiones de la Parte 2
- ~~D-2.1 Token que se envía a la API~~ → **Resuelta: ID token.**
  - **Motivo:** incluye `sub`, `email` y `cognito:groups`, así que no hace falta pedir el email a Cognito con llamadas extra ni usar triggers de Cognito con soporte incierto en Floci.
  - **Para pasar después al access token**, alcanza con tres cambios localizados: el token que envía el frontend, la audiencia del authorizer (`client_id`) y de dónde se obtiene el email (`AdminGetUser` o un trigger *pre token generation*). La lógica de negocio no cambia.
- ~~D-2.2 Granularidad de las Lambdas~~ → **Resuelta: una Lambda por dominio** (ver §6.7). Pasar más adelante a una Lambda por endpoint es mecánico, porque los handlers ya están separados por endpoint.
- ~~D-2.3 Dónde guardar los tokens en el navegador~~ → **Resuelta: todo en memoria** (§5.3).
  - **Motivo:** si hay XSS, el atacante solo puede usar los tokens mientras la página está abierta; no puede robar un refresh token persistido que le daría acceso por días.
  - **Costo:** la sesión no sobrevive a recargas ni a pestañas nuevas.
  - Las alternativas descartadas fueron `localStorage`, que expone el refresh token, y la combinación de ID token en memoria con refresh en `localStorage`, que tiene el mismo problema. La solución que mantiene la sesión sin exponer tokens a JS (cookies `httpOnly`) queda como extensión E-03.

## 7. Infraestructura (Terraform)

### 7.1 Estructura
```
infra/
  modules/
    network/        VPC, subnets privadas (2 AZ), security groups
    database/       RDS PostgreSQL, subnet group, secreto con credenciales
    auth/           Cognito User Pool, app client, grupo admin
    notifications/  SQS notifications + DLQ, identidad SES remitente
    api/            HTTP API, JWT authorizer, rutas, Lambdas, roles IAM, log groups
    frontend/       Bucket S3 del sitio, config.json, CloudFront (opcional)
  envs/
    local/          Root para Floci: provider con endpoints, backend local, tfvars
    aws/            Root para AWS real: provider estándar, backend S3, tfvars
  bootstrap/        (solo AWS) Bucket del state y rol OIDC para GitHub Actions
```
- **Regla de transparencia:** los módulos **no saben** en qué entorno corren. Las diferencias entre Floci y AWS viven solo en `envs/*`, como configuración del provider y valores de variables.
- **Nombres de recursos:** `${project}-${env}-<recurso>`, por ejemplo `reservas-local-bookings`.
- **Tags comunes:** `project`, `env` y `managed-by=terraform`.
- **Versiones fijas:** Terraform ≥ 1.10 en `.terraform-version` (corre en el contenedor `hashicorp/terraform` con esa versión) y el provider AWS fijado con `.terraform.lock.hcl` versionado en el repo.

### 7.2 Provider por entorno
**`envs/local`** (Floci):
```hcl
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  s3_use_path_style           = true
  endpoints {
    apigatewayv2 = var.floci_endpoint   # http://localhost:4566, o http://floci:4566 dentro del contenedor de Terraform
    cognitoidp   = var.floci_endpoint
    ec2          = var.floci_endpoint
    iam          = var.floci_endpoint
    lambda       = var.floci_endpoint
    logs         = var.floci_endpoint
    rds          = var.floci_endpoint
    s3           = var.floci_endpoint
    secretsmanager = var.floci_endpoint
    ses          = var.floci_endpoint
    sqs          = var.floci_endpoint
    sts          = var.floci_endpoint
  }
}
```
**`envs/aws`:** provider estándar, sin `endpoints`. Las credenciales vienen de OIDC en CI o del perfil local del desarrollador.

### 7.3 Variables que cambian entre entornos
| Variable | local | aws |
|---|---|---|
| `enable_cloudfront` | `false` | `true` |
| `db_instance_class` | `db.t4g.micro` (Floci lo ignora) | `db.t4g.micro` |
| `db_deletion_protection`, `db_backup_retention_days` | `false`, `0` | `true`, `7` |
| `lambda_architecture` | `x86_64` | `arm64` (más barato) |
| `cognito_issuer_url` | `http://localhost:4566/<poolId>` (verificado en F0) | `https://cognito-idp.<region>.amazonaws.com/<poolId>` |
| `api_url` (lo calcula el root) | `http://<apiId>.execute-api.localhost.floci.io:4566`. En Floci, `api_endpoint` devuelve una URL con formato de AWS que no sirve (hallazgo A5) | `aws_apigatewayv2_api.api_endpoint` |
| `cors_origins` | `http://localhost:3000` y `http://<bucket>.s3-website.localhost.floci.io:4566` | Dominio de CloudFront |
| `ses_from` | `no-reply@example.com` (Floci verifica al instante) | Remitente del dominio verificado |
| `network_egress` | `none` | Decisión D-3.1 |

### 7.4 Recursos por módulo (resumen)
- **network:**
  - VPC con 2 subnets privadas en AZ distintas.
  - SG `lambda`, con egress, y SG `db`, con ingress 5432 **solo** desde el SG `lambda`.
  - La salida a Internet o a servicios AWS se decide en D-3.1.
- **database:**
  - `aws_db_instance` con PostgreSQL 16, en subnets privadas, no accesible públicamente y con almacenamiento cifrado.
  - Contraseña generada con `random_password` y guardada en Secrets Manager (`aws_secretsmanager_secret`). Se usa este mecanismo en lugar del secreto gestionado por RDS, para que sea idéntico en Floci.
- **auth:**
  - User Pool con email como nombre de usuario y verificación de email.
  - Política de contraseñas: mínimo 8 caracteres, con mayúsculas, minúsculas y números.
  - App client público, sin secret, con los flujos `ALLOW_USER_PASSWORD_AUTH` y `ALLOW_REFRESH_TOKEN_AUTH`.
  - ID token de 60 minutos y refresh token de 1 día.
  - Grupo `admin`.
- **notifications:**
  - Cola `notifications` con visibility timeout de 180 s y redrive a la DLQ después de 3 intentos. AWS recomienda que el visibility timeout sea al menos 6 veces el timeout de la Lambda consumidora, que es de 30 s (§6.6).
  - DLQ con retención de 14 días.
  - `aws_ses_email_identity` (o `domain_identity` en AWS) para el remitente.
- **api:**
  - `aws_apigatewayv2_api` HTTP con CORS, JWT authorizer (`issuer = var.cognito_issuer_url`, `audience = [clientId]`) y stage `$default` con auto-deploy y access logs.
  - Una `aws_apigatewayv2_route` por ruta de §4.5, con su integración `AWS_PROXY` a la Lambda del dominio.
  - Lambdas `me`, `resources`, `bookings`, `admin`, `notifier` y `migrator`, en las subnets privadas con el SG `lambda`.
  - Un rol IAM por Lambda, con los permisos de §6.7.
  - Log groups con retención de 14 días.
  - Event source mapping SQS → `notifier` con `ReportBatchItemFailures`.
  - Los zips **los construye el build** (`pnpm build`, que deja `dist/lambdas/<nombre>.zip`). Terraform solo los referencia, con `source_code_hash`.
- **frontend:**
  - Bucket S3 con website hosting en local, y bucket privado con CloudFront (OAC) en AWS.
  - El objeto `config.json` se genera con los outputs de los otros módulos (§5.2).
  - Los archivos del sitio **no** los sube Terraform, sino el script de deploy del frontend, con `aws s3 sync` (§9).

### 7.5 Outputs de los roots
`api_url`, `user_pool_id`, `user_pool_client_id`, `cognito_issuer_url`, `frontend_bucket`, `frontend_url`, `notifications_queue_url`, `dlq_url`, `migrator_function_name`, `db_secret_arn`.

Los scripts de deploy, seed y tests leen estos valores con `terraform output -json`. Nunca se hardcodean.

### 7.6 Puntos de integración con Floci (spike F0)
> **Estado: los 7 verificados ✔** el 2026-10-02 con Floci 2.1.0. Los resultados, los hallazgos A1 a A7 y cómo reproducir el spike están en [`docs/spikes/floci.md`](spikes/floci.md).

Son los puntos donde la "transparencia" puede romperse:
1. **Emisor de los tokens de Cognito en Floci**: qué `iss` ponen y si el JWT authorizer de Floci los valida con la JWKS local.
2. **Cómo llega la Lambda a otros servicios de Floci**: dentro del contenedor de la Lambda, `localhost` no es Floci. Hay que confirmar si Floci inyecta `AWS_ENDPOINT_URL` o si se define con `lambda_extra_env`.
3. **Cómo llega la Lambda al Postgres de RDS**: confirmar que el host y puerto que devuelve `aws_db_instance.address` en Floci son alcanzables **desde el contenedor de la Lambda**.
4. **Formato de `cognito:groups`** en `event.requestContext.authorizer.jwt.claims`.
5. **Recursos de red** (VPC, subnets, SG, `vpc_config` de Lambda, subnet group de RDS): que Floci los acepte, aunque no los aplique.
6. **Socket de Docker en Windows** con Docker Desktop.
7. **URLs de invocación en Floci:** el formato de la URL de la HTTP API (`api_url`) y de la del website del bucket S3, y si el CORS configurado en API Gateway se respeta desde el navegador.

### 7.7 Estado de Terraform
- **local:**
  - Backend `local` (`infra/envs/local/terraform.tfstate`, en `.gitignore`).
  - Floci se trata como **efímero**: si el contenedor de Floci es nuevo, `local:up` descarta el state local antes del `apply`.
- **aws:**
  - Backend `s3` con bloqueo nativo (`use_lockfile = true`), así no hace falta DynamoDB.
  - El bucket del state y el rol OIDC se crean una sola vez desde `infra/bootstrap`, que usa state local y se aplica a mano.

---

## 8. Estrategia de tests

### 8.1 Niveles
| Nivel | Herramienta | Qué cubre | Dependencias | Dónde corre |
|---|---|---|---|---|
| **Unit (dominio)** | Vitest | Generación de turnos, reglas RN-xx, fechas y horizonte, cálculo de la ventana de cancelación | Ninguna: `now` y `timezone` se inyectan | Local y CI |
| **Unit (handlers)** | Vitest | Parseo del evento, rol desde los claims (array o string), validación Zod, mapeo de errores a §4.3, router por `routeKey` | Servicios mockeados | Local y CI |
| **Unit (web)** | Vitest + Testing Library | Grilla de turnos, mapeo de códigos de error a mensajes, manejo de sesión en memoria | Fetch mockeado | Local y CI |
| **Integración** | Vitest + Testcontainers (`postgres:16`) | Repositorios y servicios contra Postgres real: migraciones, constraints, **concurrencia**, idempotencia del notifier | Docker | Local y CI |
| **Infra** | `terraform fmt/validate`, `tflint`, `terraform test` | Sintaxis, buenas prácticas y aserciones sobre el plan | Ninguna (mock providers) | Local y CI |
| **E2E API** | Vitest + `fetch` | Flujos completos contra la API desplegada en Floci, con tokens reales de Cognito y emails en `/_aws/ses` | Entorno local levantado | Local y CI |
| **E2E UI** | Playwright (Chromium) | Recorridos clave en el sitio servido desde S3 de Floci | Entorno local levantado | Local y CI |

### 8.2 Casos obligatorios por nivel
**Unit (dominio):**
- Generación de turnos para `slotMinutes` de 15, 60 y 120, incluido un día sin horario de apertura.
- Turnos en las dos zonas horarias: `America/Argentina/Buenos_Aires`, sin horario de verano, y `America/New_York`, que sí lo tiene, incluidos los días de cambio de hora.
- RN-02: turno desalineado, fuera de horario y en un día cerrado.
- RN-03: ayer (inválido), hoy (válido para los turnos futuros), el último turno del día hoy + 30 (válido) y el primer turno de hoy + 31 (inválido).
- RN-06: falta exactamente `cancellationMinHours` (se permite), y falta un minuto menos (se rechaza).

**Integración:**
- Las migraciones se aplican sobre una base vacía y son idempotentes al re-ejecutarse.
- **Concurrencia entre usuarios (RN-01):** 20 usuarios reservan el mismo turno en paralelo. Debe haber exactamente 1 éxito y 19 `SLOT_TAKEN`.
- **Concurrencia de un mismo usuario (RN-05):** con límite 3, el mismo usuario hace 6 reservas en paralelo sobre turnos distintos. Debe haber exactamente 3 éxitos.
- **Solapamiento después de cambiar `slotMinutes` (RN-08):** una reserva de 10:00 a 11:00 con turnos de 60 minutos impide reservar 10:30 si el recurso pasa a turnos de 30.
- **Cancelar libera el turno:** después de cancelar, otro usuario puede reservarlo.
- **Notifier:**
  - Un evento duplicado produce un solo envío.
  - Si SES falla, se borra la fila de `notification_log` y el mensaje se marca como fallido. SES se mockea con `aws-sdk-client-mock`.

**Infra (`terraform test` con `mock_provider`):**
- Cada ruta de §4.5 existe en el plan y no hay rutas `{proxy+}`.
- Solo los roles de `bookings` y `notifier` tienen permisos sobre SQS, y solo `notifier` tiene permisos sobre SES.
- RDS no es públicamente accesible y su SG solo acepta tráfico desde el SG `lambda`.
- Con `enable_cloudfront = false` no se crea ninguna distribución.

**E2E API:**
- `401` sin token. `401 INVALID_TOKEN_TYPE` con el access token en lugar del ID token. `403` cuando un `user` llama a `/admin`.
- Flujo feliz: el admin crea un recurso, el usuario consulta la disponibilidad, reserva y aparece en `GET /bookings/me`, y llega el email de confirmación a `/_aws/ses` (con espera de hasta 15 s).
- `SLOT_TAKEN` desde dos usuarios distintos y `BOOKING_LIMIT_REACHED`.
- Cancelación del usuario, con email, y cancelación por el admin.
- Los cuerpos de las respuestas validan contra los esquemas Zod de `packages/shared`, que funcionan como test de contrato.

**E2E UI:**
- Login, reserva de un turno y cancelación desde "Mis reservas".
- El admin crea un recurso y lo ve en la lista.
- Recargar la página redirige a `/login` y, después del login, vuelve a la ruta de origen (D-2.3).

### 8.3 Datos y aislamiento
- Los tests E2E no dependen del orden: cada suite crea sus propios recursos con nombres únicos (prefijo y timestamp) y vacía `/_aws/ses` al empezar.
- Los usuarios de prueba (admin y user) los crea el seed (§10). Los tests que necesitan varios usuarios los crean con `AdminCreateUser` y `AdminSetUserPassword`.
- Lo que depende del reloj (por ejemplo la ventana de cancelación) se prueba con exactitud en la capa de dominio e integración, donde `now` se inyecta. El E2E cubre solo el caso general.

### 8.4 Umbrales de cobertura
| Paquete | Mínimo (líneas) |
|---|---|
| `services/api/src/domain` | 90 % |
| `services/api` (total) | 80 % |
| `apps/web` | Sin umbral, solo se reporta |

---

## 9. Pipeline CI/CD (GitHub Actions)

### 9.1 Workflow `ci.yml`
Se dispara en cada pull request y en cada push a `main`. Usa `concurrency` para cancelar las ejecuciones viejas de la misma rama.

```
           ┌─ lint ──────────┐
           ├─ unit ──────────┤
 checkout ─┼─ integration ───┼─▶ e2e-local
           ├─ infra-test ────┤
           └─ build ─────────┘
```
| Job | Qué hace |
|---|---|
| `lint` | `pnpm install` (con cache), ESLint, Prettier `--check`, `tsc --noEmit`, `terraform fmt -check`, `validate`, `tflint` y `gitleaks` |
| `unit` | Tests unitarios de API y web con cobertura. Falla si no se alcanzan los umbrales de §8.4 |
| `integration` | Tests con Testcontainers (el runner `ubuntu-latest` trae Docker) |
| `infra-test` | `terraform test` en los módulos |
| `build` | Zips de las Lambdas y export estático de la web, subidos como artifacts |
| `e2e-local` | 1. `npm run doctor`. 2. `docker compose up -d floci`. 3. Descarga de los artifacts. 4. `terraform apply` en `envs/local`. 5. Invocación del migrator. 6. Seed. 7. E2E API. 8. Deploy de la web al S3 de Floci. 9. E2E UI. Si falla, sube como artifacts los logs de Floci y de las Lambdas y las trazas de Playwright |

- **`e2e-local` corre en cada PR y en cada push a `main`** (decisión D-3.2). Es un check requerido para mergear.
- **Filtros por ruta:** si un PR solo modifica documentación (`docs/**`, `**/*.md`), los jobs `integration`, `infra-test`, `build` y `e2e-local` se saltean. Se implementa con un job inicial `changes` (por ejemplo, con `dorny/paths-filter`) y condiciones `if:` en cada job. **No** se usa `paths-ignore` a nivel workflow: así los checks requeridos quedan como "omitidos" (cuentan como aprobados) en lugar de quedar pendientes para siempre.
- **Versiones fijas:**
  - Node, en `.nvmrc`.
  - pnpm, en el campo `packageManager`.
  - Terraform, en `.terraform-version`.
  - La imagen de Floci, con un tag fijo en `docker-compose.yml`. Nunca `latest`.
- **Protección de `main`:** se requiere un PR con todos los jobs en verde, si el plan de GitHub lo permite (ver §9.3 mientras el repo sea privado).
- **Objetivo de duración:** menos de 15 minutos.

### 9.2 Workflow `deploy-aws.yml` (preparado, deshabilitado)
- Se dispara solo a mano (`workflow_dispatch`) y además requiere la variable de repositorio `AWS_DEPLOY_ENABLED == 'true'`. Hasta la migración (F7) esa variable no existe.
- Usa el environment `aws` de GitHub con aprobación manual requerida.
- Pasos:
  1. Autenticación OIDC (`aws-actions/configure-aws-credentials`) con el rol que crea `infra/bootstrap`, sin claves de larga duración.
  2. `terraform plan` en `envs/aws`, con el plan como artifact.
  3. Aprobación manual.
  4. `terraform apply` del plan guardado.
  5. Migrator.
  6. Deploy de la web (`aws s3 sync` e invalidación de CloudFront).
  7. Smoke tests: el subconjunto de E2E API sin datos destructivos.
- Reutiliza los artifacts de `build` del commit, así no se recompila.

### 9.3 Repositorio y secretos (decisión D-3.3)
- **El repositorio empieza privado** y se hace público cuando el proyecto esté pulido y funcionando (ver la checklist más abajo).
- **Desde el día 1 se trabaja como si fuera público**, porque al liberarlo también se publica **todo el historial de git**:
  - Ningún secreto en el repo. `.env.local`, `*.tfstate*`, `envs/aws/terraform.tfvars` y `apps/web/public/config.json` van en `.gitignore`. Se versionan solo `.env.example` y `terraform.tfvars.example`.
  - **Escaneo de secretos:** `gitleaks` en un hook de pre-commit y como paso del job `lint`.
  - AWS se usa solo con OIDC, sin claves de acceso guardadas en GitHub.
- **Minutos de Actions mientras sea privado** (2.000 por mes en el plan gratuito):
  - `concurrency` con `cancel-in-progress` para cancelar ejecuciones viejas.
  - Filtros por ruta (§9.1) y cache de pnpm, de los providers de Terraform y de las imágenes Docker.
  - Revisión del consumo en *Settings → Billing*. Si se acerca al límite, se aplica temporalmente la variante "UI E2E solo en `main`" (D-3.2).
- **Protección de `main`:** si el plan gratuito no permite rulesets ni protección de ramas en repos privados, la CI corre igual en cada PR y se respeta la regla "no mergear en rojo" por disciplina. La protección se activa al hacer público el repo. `deploy-aws.yml` no se ve afectado, porque está deshabilitado hasta F7.
- **Checklist para hacer público el repo:**
  1. CI en verde en `main` y fases F0 a F6 completas.
  2. README con guía de inicio verificada en una máquina limpia.
  3. Licencia elegida (por ejemplo MIT) y archivo `LICENSE`.
  4. `gitleaks detect` sobre **todo el historial**, sin hallazgos.
  5. Revisión de issues, ramas y artifacts viejos.
  6. Activar la protección de `main` y los environments.

---

## 10. Entorno local
Decisiones de base:
- **Floci va embebido** en el `docker-compose.yml` del repo, no se instala aparte. Se monta el socket de Docker (`/var/run/docker.sock`) para que Floci levante como contenedores hermanos el Postgres de RDS y las Lambdas. En Windows requiere Docker Desktop con WSL2.
  - **Imagen con versión fija:** `floci/floci:2.1.0`, la versión validada en F0.
  - **Configuración obligatoria** (hallazgo A1). Sin estas variables no funcionan la conexión de las Lambdas a RDS ni el JWT authorizer:

    | Variable | Valor | Para qué |
    |---|---|---|
    | `FLOCI_SERVICES_DOCKER_NETWORK` | `floci-net` (red del compose con `name:` fijo) | Lambdas y RDS se levantan en la misma red que Floci |
    | `FLOCI_SERVICES_RDS_ENDPOINT_HOST` | `floci` (nombre del contenedor) | RDS devuelve un host que las Lambdas pueden resolver |
    | `FLOCI_SECURITY_ALLOW_PRIVATE_JWT_TARGETS` | `true` | El JWT authorizer acepta el emisor `http://localhost:4566/...` de Cognito |

  - **Puertos publicados:** `4566` y el rango `7001-7010` del proxy de RDS, para conectarse desde el host (por ejemplo con `psql` o un cliente gráfico) por `localhost:7001`.
- **Terraform corre en un contenedor** con versión fija, así no hace falta instalarlo en la máquina.
- **Prerequisitos:** Docker Desktop (con Compose v2) y Node.js LTS. pnpm se habilita con `corepack enable`, que viene con Node. La AWS CLI es opcional.
- **Comando de verificación de prerequisitos: `npm run doctor`.** Usa npm, que viene con Node, para que funcione antes de tener pnpm. Es un script en Node (`scripts/doctor.mjs`) y funciona en Windows, macOS y Linux.
  - **Chequeos obligatorios** (si alguno falla, el comando termina con un código de salida distinto de 0):
    - Node.js con la versión mínima definida en `.nvmrc` o `engines`.
    - pnpm disponible (si falta, sugiere `corepack enable`).
    - Docker instalado y el daemon corriendo (`docker info`).
    - Docker Compose v2 (`docker compose version`).
    - Acceso al socket de Docker desde un contenedor: lanza un contenedor efímero que monta `/var/run/docker.sock` y ejecuta `docker version`.
    - Puertos libres: 4566 (Floci), 7001-7010 (RDS) y 3000 (web en desarrollo).
  - **Chequeos opcionales** (solo advertencias): puertos 4500 (Floci UI), 8025 y 1025 (Mailpit), AWS CLI instalada, y al menos 4 GB de memoria asignados a Docker.
  - **Salida:** una línea por chequeo con ✔, ⚠ o ✖. Cada falla incluye una sugerencia concreta para resolverla (qué instalar o qué proceso ocupa el puerto).
  - El comando que levanta el entorno (por ejemplo `pnpm local:up`) ejecuta `doctor` antes de arrancar y se detiene si falla algún chequeo obligatorio.
- **Floci UI es opcional**, va en un perfil de docker compose y queda disponible en `http://localhost:4500`. Al implementar, verificar si muestra los emails de SES; si los muestra, se evalúa quitar Mailpit.
- **Mailpit es opcional**, va en un perfil aparte de docker compose (por ejemplo `docker compose --profile mail up`). Si está levantado, Floci le reenvía los emails por SMTP (`FLOCI_SERVICES_SES_SMTP_HOST=mailpit`, puerto 1025) y se ven en `http://localhost:8025`. Si no está, todo funciona igual: los emails quedan en `/_aws/ses` y Floci solo registra en el log el fallo del reenvío.
- El entorno base (Floci, la app y los tests) no requiere Mailpit.

### 10.1 Comandos
| Comando | Qué hace |
|---|---|
| `npm run doctor` | Verifica los prerequisitos (ver arriba) |
| `pnpm install` | Instala las dependencias del monorepo |
| `pnpm local:up [--ui] [--mail]` | `doctor`, levanta Floci (y opcionalmente Floci UI y Mailpit), construye, ejecuta `terraform apply` en `envs/local`, migra, carga el seed y genera `apps/web/public/config.json`. Al final imprime las URLs y las credenciales de prueba. Es idempotente: se puede volver a correr. La primera vez tarda unos 2 minutos, porque crear la instancia RDS lleva unos 90 s (hallazgo A7) |
| `pnpm dev` | Levanta `next dev` en `:3000` contra la API de Floci, con recarga en caliente del frontend |
| `pnpm deploy:local` | Reconstruye las Lambdas y aplica Terraform. Es el ciclo rápido después de cambiar el código del backend |
| `pnpm deploy:web:local` | Construye el export estático y lo sube al bucket de Floci |
| `pnpm test` / `test:integration` / `test:infra` | Tests unitarios, de integración y de infra. No necesitan el entorno levantado |
| `pnpm test:e2e` / `test:e2e:ui` | E2E de la API y de la UI contra el entorno local |
| `pnpm local:logs [lambda]` | Muestra los logs de Floci o de una Lambda |
| `pnpm local:down` | Detiene los contenedores |
| `pnpm local:reset` | Detiene y borra todo: contenedores, volúmenes y el state local de Terraform |

### 10.2 Seed
- Usuarios en Cognito, creados ya confirmados y sin email, como se describe en §2.4 (después de CU-10):
  - `admin@example.com`, en el grupo `admin`.
  - `user@example.com`.
- Las contraseñas vienen de `.env.local`. En el repo se versiona `.env.example`, con valores por defecto aptos solo para local.
- En la base: la fila de `settings` y 3 recursos de ejemplo (§3.4).
- El seed solo existe para `local` y CI. Nunca se ejecuta en `envs/aws`.

### 10.3 Puertos
| Puerto | Servicio |
|---|---|
| 4566 | Floci (todas las APIs de AWS) |
| 3000 | `next dev` |
| 4500 | Floci UI (opcional) |
| 8025 / 1025 | Mailpit, interfaz web y SMTP (opcional) |
| 7001–7010 | Proxy de RDS de Floci. La primera instancia usa el 7001 |

---

## 11. Migración a AWS real y riesgos

### 11.1 Pasos de migración (fase F7)
1. **Cuenta y bootstrap:** aplicar `infra/bootstrap`, que crea el bucket del state y el rol OIDC limitado al repo y a la rama `main`.
2. **Decidir la red** (D-3.1) y completar `envs/aws/terraform.tfvars`.
3. **SES:**
   - Verificar el dominio remitente (DKIM, SPF y DMARC).
   - Pedir salir del *sandbox*. Mientras tanto, solo se puede enviar a direcciones verificadas.
   - Configurar Cognito para que envíe sus emails a través de SES.
4. **Primer deploy:** a mano (`plan` y `apply`), migrator y deploy de la web. Después, habilitar `AWS_DEPLOY_ENABLED`.
5. **Validación:** smoke tests, y E2E manual de registro con código de verificación real (CU-01).
6. **Mejoras opcionales para AWS:**
   - RDS Proxy.
   - SRP en lugar de `USER_PASSWORD_AUTH`.
   - Alarmas de CloudWatch: mensajes en la DLQ, errores 5xx y logs `notification_publish_failed`.
7. **Desmontar:** `terraform destroy` en `envs/aws` cuando ya no se use, para no generar costos.

### 11.2 Costo estimado en AWS (orientativo, uso bajo)
| Recurso | USD/mes aprox. |
|---|---|
| RDS `db.t4g.micro` y 20 GB | 15 |
| Salida de red (D-3.1): NAT Gateway / VPC endpoints | ~35 / ~25–30 |
| Lambda, API Gateway, SQS, SES, S3 y CloudFront | ~0–2 (por uso) |
| Cognito (pocos usuarios activos) | ~0 |

La red es el costo dominante. Por eso conviene desmontar el entorno cuando no se usa.

### 11.3 Riesgos
| Riesgo | Impacto | Mitigación |
|---|---|---|
| Floci se comporta distinto que AWS: no aplica IAM ni la red | Errores que solo aparecen en AWS | Tests de infra sobre el plan (§8.2) y smoke test en AWS al migrar |
| Puntos de integración de §7.6 (emisor de tokens, endpoints dentro de la Lambda, host de RDS) | Bloquea el entorno local | **Spike F0** antes de construir nada más |
| Floci es un proyecto joven | Bugs o cambios que rompen | Imagen con versión fija (2.1.0), actualización deliberada que vuelve a correr el spike F0, y reporte de issues |
| Las URLs `*.localhost.floci.io` dependen de un DNS público que resuelve a `127.0.0.1` (hallazgo A6) | Sin conexión a Internet, la API y el sitio no resuelven desde el host | Documentado en el README. Alternativa sin conexión: una entrada en el archivo `hosts` para el `apiId` |
| Agotar las conexiones de Postgres con muchas Lambdas en paralelo | Errores 5xx con carga | `max: 1` por instancia y concurrencia reservada acotada. RDS Proxy en AWS |
| Arranques en frío de Lambdas en VPC | Latencia en el primer request | Aceptado en el POC. Bundles chicos con esbuild |
| SES sandbox y entregabilidad | Los emails no llegan en AWS | Pasos de §11.1.3 |
| Pérdida de emails si falla SQS (decisión v1) | El usuario no recibe la notificación | Log `notification_publish_failed`. Extensión E-01 |

---

## 12. Fases e hitos
Cada fase termina con algo que funciona y se puede demostrar, con sus tests en verde en CI.

| Fase | Contenido | Definición de terminado |
|---|---|---|
| **F0 Spike de viabilidad en Floci** ✔ *(en Windows; falta ejecutarlo en el runner de GitHub, al inicio de F1)* | docker compose con Floci. Terraform mínimo: Cognito, HTTP API con JWT authorizer, una Lambda Node 22 que consulta RDS (`SELECT 1`), publica en SQS y envía por SES, y un bucket S3 con website | Los 7 puntos de §7.6 verificados en Windows y en el runner de GitHub. Resultados en `docs/spikes/floci.md` y la spec ajustada si algo no funciona |
| **F1 Base del monorepo** | Workspaces de pnpm, TS, ESLint y Prettier, Vitest, `doctor`, `docker-compose.yml`, `ci.yml` con `lint` y `unit` | `npm run doctor` y `pnpm test` pasan, y la CI corre en los PR |
| **F2 Dominio y base de datos** | Esquema de Drizzle y migraciones (incluida la exclusion constraint), dominio puro, repositorios, servicios, tests de integración con concurrencia | Casos de §8.2 (dominio e integración) en verde. Cobertura del dominio ≥ 90 % |
| **F3 API e infra** | Módulos `network`, `database`, `auth` y `api`, Lambdas `me`, `resources`, `bookings`, `admin` y `migrator`, seed, `local:up`, E2E API, job `e2e-local` | Flujo de reserva completo por API en Floci, en local y en CI |
| **F4 Notificaciones** | Módulo `notifications`, publicación después del commit, `notifier` idempotente, plantillas de email, perfiles de Mailpit y Floci UI | Email de confirmación y de cancelación verificado en `/_aws/ses` por el E2E |
| **F5 Frontend** | Páginas de §5.4, auth en memoria, `config.json`, módulo `frontend`, `deploy:web:local`, E2E UI | Recorridos de §8.2 (E2E UI) en verde en CI |
| **F6 Endurecimiento** | `terraform test`, umbrales de cobertura, `envs/aws` e `infra/bootstrap` completos (sin aplicar), `deploy-aws.yml` deshabilitado, README con guía de inicio | Un desarrollador nuevo levanta todo con `npm run doctor`, `pnpm install` y `pnpm local:up` siguiendo solo el README |
| **F7 Migración a AWS** (opcional) | Pasos de §11.1 | Smoke tests en verde en AWS real |

### 12.1 Decisiones de la Parte 3
- ~~D-3.1 Salida de red de las Lambdas en AWS real~~ → **Diferida a F7.**
  - Queda como variable `network_egress = "nat" | "endpoints"` en `envs/aws`, con el valor `none` en local.
  - El módulo `network` implementa las dos opciones.
  - No afecta el código, el entorno local ni la CI.
- ~~D-3.2 Cuándo corre `e2e-local` en CI~~ → **Resuelta: en cada PR y en cada push a `main`**, con filtros por ruta para los cambios que solo tocan documentación (§9.1). Si el tiempo o los minutos molestan, se puede pasar a correr la UI solo en `main`.
- ~~D-3.3 Visibilidad del repositorio de GitHub~~ → **Resuelta: privado hasta que esté pulido, después público** (§9.3). Desde el día 1 no se versionan secretos y se escanean con `gitleaks`.

## 13. Extensiones futuras
Mejoras fuera de la v1. Están diseñadas para sumarse sin romper lo existente.

### E-01 Transactional outbox para notificaciones
**Problema que resuelve:** en la v1, si la publicación en SQS falla después del commit, el email se pierde (§3.3).

**Diseño:**
- Tabla nueva `outbox_events`:

  | Columna | Tipo |
  |---|---|
  | `id` | `uuid`, PK, que se usa como `event_id` |
  | `type` | `text` |
  | `payload` | `jsonb` |
  | `created_at` | `timestamptz` |
  | `published_at` | `timestamptz`, NULL mientras no se publique |

  Índice parcial sobre `created_at` donde `published_at IS NULL`.
- La Lambda de reservas inserta el evento en `outbox_events` **dentro de la misma transacción** que la reserva o la cancelación. Después del commit intenta publicarlo en SQS de inmediato y, si lo logra, marca `published_at`.
- Una Lambda nueva, el **relay**, corre cada minuto (EventBridge Scheduler, o una regla programada si Floci no soporta Scheduler). Publica los eventos pendientes con más de 30 segundos de antigüedad, usando `FOR UPDATE SKIP LOCKED` para que dos ejecuciones concurrentes no tomen el mismo evento, y los marca como publicados.
- La Lambda notificadora no cambia: su idempotencia por `event_id` (`notification_log`) absorbe las publicaciones duplicadas.

**Criterios de aceptación:**
- **Dado** que SQS falla después del commit de una reserva, **entonces** el relay publica el evento en menos de 2 minutos y el titular recibe un solo email.
- **Dado** un evento publicado por la Lambda y también por el relay, **entonces** se envía un solo email.

**Impacto:** una migración, una Lambda y un schedule más en Terraform. El contrato de la API y el consumidor no cambian.

### E-02 Frontend en contenedores (Kubernetes)
Contenerizar Next.js y desplegarlo en k3s (EKS emulado en Floci) en local, y en EKS en AWS real. Se detalla si se decide encararla.

### E-03 Sesión persistente con cookies `httpOnly`
**Problema que resuelve:** con los tokens solo en memoria (§5.3), la sesión se pierde al recargar la página o abrir otra pestaña.

**Diseño a alto nivel:**
- Endpoints de auth propios (`/v1/auth/login`, `/refresh` y `/logout`) que hablan con Cognito y guardan el refresh token en una cookie `httpOnly; Secure; SameSite`, que JavaScript no puede leer.
- Protección CSRF.
- El frontend y la API deben quedar bajo el mismo dominio (por ejemplo, con CloudFront delante de los dos) para evitar cookies cross-site.

**Impacto:** una Lambda de auth, cambios en el login del frontend y en la configuración de CloudFront y CORS.
