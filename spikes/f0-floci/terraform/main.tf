# Spike F0: infraestructura mínima en Floci para validar docs/SPEC.md §7.6

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.0" }
    random  = { source = "hashicorp/random", version = "~> 3.0" }
  }
}

variable "floci_endpoint" {
  type    = string
  default = "http://localhost:4566"
}

# Emisor que Floci pone en los tokens de Cognito (http://localhost:4566/<poolId>),
# independiente de cómo Terraform llega a Floci.
variable "cognito_issuer_base" {
  type    = string
  default = "http://localhost:4566"
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    apigatewayv2   = var.floci_endpoint
    cognitoidp     = var.floci_endpoint
    ec2            = var.floci_endpoint
    iam            = var.floci_endpoint
    lambda         = var.floci_endpoint
    logs           = var.floci_endpoint
    rds            = var.floci_endpoint
    s3             = var.floci_endpoint
    secretsmanager = var.floci_endpoint
    ses            = var.floci_endpoint
    sqs            = var.floci_endpoint
    sts            = var.floci_endpoint
  }
}

locals {
  name = "f0-spike"
}

# --- Red (punto 5: Floci debe aceptarla aunque no la aplique) ---

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = ["us-east-1a", "us-east-1b"][count.index]
}

resource "aws_security_group" "lambda" {
  name   = "${local.name}-lambda"
  vpc_id = aws_vpc.main.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "${local.name}-db"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
}

# --- Base de datos (punto 3) ---

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "db" {
  length  = 24
  special = false
}

resource "aws_db_instance" "main" {
  identifier             = "${local.name}-db"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  db_name                = "reservas"
  username               = "app"
  password               = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  skip_final_snapshot    = true
}

resource "aws_secretsmanager_secret" "db" {
  name                    = "${local.name}-db"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    username = aws_db_instance.main.username
    password = random_password.db.result
    dbname   = aws_db_instance.main.db_name
  })
}

# --- Auth (punto 1 y 4) ---

resource "aws_cognito_user_pool" "main" {
  name                     = "${local.name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
}

resource "aws_cognito_user_pool_client" "web" {
  name                = "${local.name}-web"
  user_pool_id        = aws_cognito_user_pool.main.id
  generate_secret     = false
  explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.main.id
}

# --- Notificaciones ---

resource "aws_sqs_queue" "notifications" {
  name = "${local.name}-notifications"
  # Corto a propósito para que el test de DLQ del spike no tarde minutos
  visibility_timeout_seconds = 5
}

resource "aws_ses_email_identity" "from" {
  email = "no-reply@example.com"
}

# --- Lambda (punto 2) ---

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda"
  output_path = "${path.module}/.build/lambda.zip"
}

resource "aws_iam_role" "lambda" {
  name = "${local.name}-lambda"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_lambda_function" "probe" {
  function_name    = "${local.name}-probe"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 30
  memory_size      = 512

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_SECRET_ARN = aws_secretsmanager_secret.db.arn
      QUEUE_URL     = aws_sqs_queue.notifications.url
      SES_FROM      = aws_ses_email_identity.from.email
    }
  }

  depends_on = [aws_secretsmanager_secret_version.db]
}

# --- Consumidor SQS (simula el notifier) ---

resource "aws_sqs_queue" "dlq" {
  name = "${local.name}-notifications-dlq"
}

resource "aws_sqs_queue_redrive_policy" "notifications" {
  queue_url      = aws_sqs_queue.notifications.id
  redrive_policy = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 3 })
}

resource "aws_lambda_function" "consumer" {
  function_name    = "${local.name}-consumer"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "consumer.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 5

  environment {
    variables = { SES_FROM = aws_ses_email_identity.from.email }
  }
}

resource "aws_lambda_event_source_mapping" "notifications" {
  event_source_arn        = aws_sqs_queue.notifications.arn
  function_name           = aws_lambda_function.consumer.arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# --- API (puntos 1, 4 y 7) ---

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["http://localhost:3000"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
  }
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  name             = "cognito"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    issuer   = "${var.cognito_issuer_base}/${aws_cognito_user_pool.main.id}"
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

resource "aws_apigatewayv2_integration" "probe" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.probe.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "probe" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "GET /v1/probe"
  target             = "integrations/${aws_apigatewayv2_integration.probe.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.probe.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

# --- Frontend (punto 7) ---

resource "aws_s3_bucket" "site" {
  bucket = "${local.name}-site"
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  index_document { suffix = "index.html" }
}

resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.site.id
  key          = "index.html"
  content      = "<!doctype html><title>spike f0</title><h1>Spike F0 OK</h1>"
  content_type = "text/html"
}

# --- Outputs ---

output "api_id" { value = aws_apigatewayv2_api.http.id }
output "api_endpoint" { value = aws_apigatewayv2_api.http.api_endpoint }
output "user_pool_id" { value = aws_cognito_user_pool.main.id }
output "user_pool_client_id" { value = aws_cognito_user_pool_client.web.id }
output "queue_url" { value = aws_sqs_queue.notifications.url }
output "dlq_url" { value = aws_sqs_queue.dlq.url }
output "site_bucket" { value = aws_s3_bucket.site.id }
output "site_website_endpoint" { value = aws_s3_bucket_website_configuration.site.website_endpoint }
output "db_address" { value = aws_db_instance.main.address }
output "db_port" { value = aws_db_instance.main.port }
output "lambda_vpc_id" { value = aws_lambda_function.probe.vpc_config[0].vpc_id }
