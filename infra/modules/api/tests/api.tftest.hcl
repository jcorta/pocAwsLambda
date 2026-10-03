# Aserciones de infra de SPEC §8.2 sobre el módulo api, con providers simulados: no crea nada ni necesita Floci.
# `command = apply` con mocks para que los ids existan y se puedan comparar referencias entre recursos.

mock_provider "aws" {
  # Los documentos de política se validan por sus argumentos; el JSON simulado solo tiene que ser JSON
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  # El provider valida el formato de los ARN que se pasan entre recursos
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::000000000000:role/test" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-1:000000000000:function:test"
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:test/invocations"
    }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = { execution_arn = "arn:aws:execute-api:us-east-1:000000000000:test" }
  }
}

mock_provider "archive" {}

variables {
  name                    = "test"
  lambda_dist_dir         = "dist"
  subnet_ids              = ["subnet-a", "subnet-b"]
  security_group_id       = "sg-lambda"
  db_secret_arn           = "arn:aws:secretsmanager:us-east-1:000000000000:secret:test-db"
  db_ssl                  = "require"
  cognito_issuer_url      = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test"
  cognito_client_id       = "client"
  cors_origins            = ["https://example.com"]
  notifications_queue_url = "https://sqs.us-east-1.amazonaws.com/000000000000/test-notifications"
  notifications_queue_arn = "arn:aws:sqs:us-east-1:000000000000:test-notifications"
  ses_from                = "no-reply@example.com"
}

run "rutas" {
  command = apply

  assert {
    # Las 12 rutas de SPEC §4.5, ni una más
    condition = toset(keys(aws_apigatewayv2_route.route)) == toset([
      "GET /v1/me",
      "GET /v1/resources",
      "GET /v1/resources/{id}",
      "GET /v1/resources/{id}/availability",
      "POST /v1/bookings",
      "GET /v1/bookings/me",
      "POST /v1/bookings/{id}/cancel",
      "POST /v1/admin/resources",
      "PUT /v1/admin/resources/{id}",
      "GET /v1/admin/bookings",
      "GET /v1/admin/settings",
      "PUT /v1/admin/settings",
    ])
    error_message = "Las rutas del plan no coinciden con las de SPEC §4.5."
  }

  assert {
    condition     = alltrue([for k in keys(aws_apigatewayv2_route.route) : !strcontains(k, "{proxy+}") && !startswith(k, "ANY ") && k != "$default"])
    error_message = "No puede haber rutas {proxy+}, ANY ni $default: cada endpoint tiene su ruta."
  }

  assert {
    condition     = alltrue([for r in aws_apigatewayv2_route.route : r.authorization_type == "JWT" && r.authorizer_id == aws_apigatewayv2_authorizer.jwt.id])
    error_message = "Todas las rutas tienen que pasar por el JWT authorizer."
  }

  assert {
    condition     = alltrue([for k, r in aws_apigatewayv2_route.route : r.target == "integrations/${aws_apigatewayv2_integration.lambda[local.routes[k]].id}"])
    error_message = "Cada ruta tiene que apuntar a la integración de su Lambda (routes.tf.json)."
  }
}

run "permisos_de_sqs_y_ses" {
  command = apply

  assert {
    condition     = aws_iam_role_policy.publish_notifications.role == aws_iam_role.lambda["bookings"].id
    error_message = "El permiso de publicar en la cola es solo del rol de bookings."
  }

  assert {
    condition     = aws_iam_role_policy.notifier.role == aws_iam_role.lambda["notifier"].id
    error_message = "El permiso de consumir la cola y enviar emails es solo del rol de notifier."
  }

  assert {
    condition = alltrue([
      for s in data.aws_iam_policy_document.publish_notifications.statement :
      alltrue([for a in s.actions : startswith(a, "sqs:")]) && s.resources == toset([var.notifications_queue_arn])
    ])
    error_message = "La política de bookings solo puede tener acciones de SQS sobre la cola de notificaciones."
  }

  assert {
    # La política que comparten todas las Lambdas no da permisos de SQS ni de SES
    condition = alltrue(flatten([
      for s in data.aws_iam_policy_document.read_db_secret.statement :
      [for a in s.actions : !startswith(a, "sqs:") && !startswith(a, "ses:")]
    ]))
    error_message = "La política común de las Lambdas no puede tener permisos de SQS ni de SES."
  }

  assert {
    condition = alltrue([
      for p in values(aws_iam_role_policy_attachment.vpc_access) :
      p.policy_arn == "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
    ])
    error_message = "Las Lambdas solo tienen adjunta la política administrada de VPC y logs."
  }

  assert {
    condition = (
      alltrue(flatten([for s in data.aws_iam_policy_document.publish_notifications.statement : [for a in s.actions : !startswith(a, "ses:")]]))
      && anytrue(flatten([for s in data.aws_iam_policy_document.notifier.statement : [for a in s.actions : a == "ses:SendEmail"]]))
    )
    error_message = "Solo notifier puede enviar emails por SES."
  }

  assert {
    condition     = [for k, f in aws_lambda_function.fn : k if contains(keys(f.environment[0].variables), "NOTIFICATIONS_QUEUE_URL")] == ["bookings"]
    error_message = "Solo bookings recibe la URL de la cola."
  }
}
