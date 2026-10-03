# API (SPEC §7.4): HTTP API con JWT authorizer, una ruta por endpoint (sin {proxy+}),
# Lambdas por dominio más el migrator, un rol IAM por Lambda y log groups.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.0" }
  }
}

variable "name" {
  type = string
}

variable "lambda_dist_dir" {
  description = "Carpeta con un subdirectorio por Lambda, generada por `pnpm build` (SPEC §6.5)."
  type        = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "db_secret_arn" {
  type = string
}

variable "db_ssl" {
  description = "disable en Floci, require en AWS (SPEC §6.5)."
  type        = string
}

variable "timezone" {
  type    = string
  default = "America/Argentina/Buenos_Aires"
}

variable "cognito_issuer_url" {
  type = string
}

variable "cognito_client_id" {
  type = string
}

variable "cors_origins" {
  type = list(string)
}

variable "lambda_architecture" {
  type    = string
  default = "x86_64"
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "notifications_queue_url" {
  type = string
}

variable "notifications_queue_arn" {
  type = string
}

variable "ses_from" {
  type = string
}

locals {
  api_lambdas = toset(["me", "resources", "bookings", "admin"])
  # Valores iniciales de SPEC §6.6
  lambdas = {
    me        = { memory = 512, timeout = 10 }
    resources = { memory = 512, timeout = 10 }
    bookings  = { memory = 512, timeout = 10 }
    admin     = { memory = 512, timeout = 10 }
    migrator  = { memory = 512, timeout = 60 }
    notifier  = { memory = 256, timeout = 30 }
  }
  # Variables propias de cada Lambda, además de las comunes
  extra_env = {
    bookings = { NOTIFICATIONS_QUEUE_URL = var.notifications_queue_url } # la única que publica (SPEC §6.7)
    notifier = { SES_FROM = var.ses_from }
  }
}

# --- Código: Terraform comprime la carpeta que deja el build (SPEC §7.4) ---

data "archive_file" "lambda" {
  for_each    = local.lambdas
  type        = "zip"
  source_dir  = "${var.lambda_dist_dir}/${each.key}"
  output_path = "${path.root}/.build/${each.key}.zip"
}

# --- IAM: un rol por Lambda con los permisos de SPEC §6.7 ---

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  for_each           = local.lambdas
  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

# Logs e interfaces de red en la VPC
resource "aws_iam_role_policy_attachment" "vpc_access" {
  for_each   = local.lambdas
  role       = aws_iam_role.lambda[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "read_db_secret" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_secret_arn]
  }
}

resource "aws_iam_role_policy" "read_db_secret" {
  for_each = local.lambdas
  name     = "read-db-secret"
  role     = aws_iam_role.lambda[each.key].id
  policy   = data.aws_iam_policy_document.read_db_secret.json
}

# Solo `bookings` publica en la cola (el admin cancela por la ruta de bookings, SPEC §6.7)
data "aws_iam_policy_document" "publish_notifications" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [var.notifications_queue_arn]
  }
}

resource "aws_iam_role_policy" "publish_notifications" {
  name   = "publish-notifications"
  role   = aws_iam_role.lambda["bookings"].id
  policy = data.aws_iam_policy_document.publish_notifications.json
}

# Solo `notifier` consume la cola y envía emails
data "aws_iam_policy_document" "notifier" {
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.notifications_queue_arn]
  }
  statement {
    actions   = ["ses:SendEmail"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "notifier" {
  name   = "consume-and-send"
  role   = aws_iam_role.lambda["notifier"].id
  policy = data.aws_iam_policy_document.notifier.json
}

# --- Lambdas ---

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambdas
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each         = local.lambdas
  function_name    = "${var.name}-${each.key}"
  role             = aws_iam_role.lambda[each.key].arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  architectures    = [var.lambda_architecture]
  filename         = data.archive_file.lambda[each.key].output_path
  source_code_hash = data.archive_file.lambda[each.key].output_base64sha256
  memory_size      = each.value.memory
  timeout          = each.value.timeout

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.security_group_id]
  }

  environment {
    variables = merge({
      APP_TIMEZONE            = var.timezone
      DB_SECRET_ARN           = var.db_secret_arn
      DB_SSL                  = var.db_ssl
      NODE_OPTIONS            = "--enable-source-maps"
      POWERTOOLS_SERVICE_NAME = "${var.name}-${each.key}"
      POWERTOOLS_LOG_LEVEL    = "INFO"
    }, lookup(local.extra_env, each.key, {}))
  }

  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy_attachment.vpc_access]
}

# SQS → notifier, en lotes de 10 y con respuesta parcial: solo se reintentan los mensajes fallidos (SPEC §6.4)
resource "aws_lambda_event_source_mapping" "notifications" {
  event_source_arn        = var.notifications_queue_arn
  function_name           = aws_lambda_function.fn["notifier"].arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
  depends_on              = [aws_iam_role_policy.notifier]
}

# --- HTTP API ---

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins  = var.cors_origins
    allow_methods  = ["GET", "POST", "PUT", "OPTIONS"]
    allow_headers  = ["authorization", "content-type"]
    expose_headers = ["x-request-id"]
    max_age        = 300
  }
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  name             = "cognito"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.cognito_issuer_url
    audience = [var.cognito_client_id]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  for_each               = local.api_lambdas
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "2.0"
}

# Una ruta por endpoint (routes.tf.json), todas con el JWT authorizer
resource "aws_apigatewayv2_route" "route" {
  for_each           = local.routes
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.lambda[each.value].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

# Access logs del stage (SPEC §7.4): una línea JSON por request. `lambdaRequestId` es el id que la Lambda
# devuelve en x-request-id y escribe en sus logs: así se cruzan los logs de API Gateway con los de la Lambda.
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      lambdaRequestId    = "$context.integration.requestId"
      requestTime        = "$context.requestTime"
      routeKey           = "$context.routeKey"
      status             = "$context.status"
      responseLatency    = "$context.responseLatency"
      integrationStatus  = "$context.integrationStatus"
      integrationError   = "$context.integrationErrorMessage"
      authorizerError    = "$context.authorizer.error"
      sourceIp           = "$context.identity.sourceIp"
      userAgent          = "$context.identity.userAgent"
      integrationLatency = "$context.integrationLatency"
    })
  }
}

resource "aws_lambda_permission" "apigw" {
  for_each      = local.api_lambdas
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "api_id" {
  value = aws_apigatewayv2_api.http.id
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "access_log_group" {
  value = aws_cloudwatch_log_group.access.name
}

output "function_names" {
  value = { for k, f in aws_lambda_function.fn : k => f.function_name }
}

output "routes" {
  value = local.routes
}
