# Entorno local sobre Floci (SPEC §7). Las diferencias con AWS viven solo acá:
# provider con endpoints, issuer de Cognito, URL de la API, DB_SSL y CORS (SPEC §7.3).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.0" }
    random  = { source = "hashicorp/random", version = "~> 3.0" }
  }
  # Floci es efímero: el state local se descarta cuando se recrea el contenedor (SPEC §7.7)
  backend "local" {}
}

variable "floci_endpoint" {
  description = "Cómo llega Terraform a Floci: http://floci:4566 desde el contenedor de Terraform."
  type        = string
  default     = "http://localhost:4566"
}

variable "public_floci_url" {
  description = "Cómo se ve Floci desde el navegador y desde Cognito: emisor de los tokens (hallazgo del spike F0)."
  type        = string
  default     = "http://localhost:4566"
}

variable "timezone" {
  type    = string
  default = "America/Argentina/Buenos_Aires"
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

  default_tags {
    tags = { project = "reservas", env = "local", "managed-by" = "terraform" }
  }
}

locals {
  name = "reservas-local"
  # URL del sitio en Floci (verificado en el spike F0). Se arma con el nombre del bucket, que es conocido,
  # así puede entrar en el CORS de la API sin crear un ciclo entre módulos.
  site_url = "http://${local.name}-site.s3-website.localhost.floci.io:4566"
  api_url  = "http://${module.api.api_id}.execute-api.localhost.floci.io:4566"
}

module "network" {
  source = "../../modules/network"
  name   = local.name
}

module "database" {
  source            = "../../modules/database"
  name              = local.name
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.db_security_group_id
}

module "auth" {
  source = "../../modules/auth"
  name   = local.name
}

module "notifications" {
  source = "../../modules/notifications"
  name   = local.name
  # Floci verifica la identidad al instante (SPEC §7.3)
  ses_from = "no-reply@example.com"
}

module "api" {
  source            = "../../modules/api"
  name              = local.name
  lambda_dist_dir   = "${path.root}/../../../services/api/dist/lambdas"
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.lambda_security_group_id
  db_secret_arn     = module.database.secret_arn
  db_ssl            = "disable"
  timezone          = var.timezone
  # En Floci el emisor es la URL de Floci + el id del pool (SPEC §7.3)
  cognito_issuer_url = "${var.public_floci_url}/${module.auth.user_pool_id}"
  cognito_client_id  = module.auth.client_id
  # El navegador entra siempre por el proxy del mismo origen (hallazgo A8): :3000 (`pnpm dev`) y :3002 (sitio en S3).
  # El website de S3 directo queda permitido por si se abre sin proxy, aunque ahí el login falla por CORS de Cognito.
  cors_origins = ["http://localhost:3000", "http://localhost:3002", local.site_url]

  notifications_queue_url = module.notifications.queue_url
  notifications_queue_arn = module.notifications.queue_arn
  ses_from                = module.notifications.ses_from
}

module "frontend" {
  source = "../../modules/frontend"
  name   = local.name
  runtime_config = {
    # Ruta del mismo origen: la HTTP API de Floci no devuelve CORS en las respuestas (hallazgo A9)
    apiUrl = "/_floci/api"
    cognito = {
      region     = "us-east-1"
      userPoolId = module.auth.user_pool_id
      clientId   = module.auth.client_id
      # Ruta del mismo origen: la atiende el proxy local, porque Cognito de Floci no soporta CORS (hallazgo A8)
      endpoint = "/_floci/cognito"
    }
    timezone = var.timezone
  }
}

# --- Outputs (SPEC §7.5): los leen los scripts de deploy, seed y tests con `terraform output -json` ---

output "api_url" {
  # En Floci, api_endpoint devuelve una URL con formato de AWS que no sirve (hallazgo A5)
  value = local.api_url
}

output "frontend_bucket" {
  value = module.frontend.bucket
}

output "frontend_url" {
  description = "URL para el navegador: el sitio en S3 a través del proxy del mismo origen (`pnpm local:site`)."
  value       = "http://localhost:3002/"
}

output "frontend_s3_url" {
  description = "Website de S3 directo (sin proxy: el login con Cognito no funciona por CORS)."
  value       = "${local.site_url}/"
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "user_pool_client_id" {
  value = module.auth.client_id
}

output "cognito_issuer_url" {
  value = "${var.public_floci_url}/${module.auth.user_pool_id}"
}

output "migrator_function_name" {
  value = module.api.function_names["migrator"]
}

output "function_names" {
  value = module.api.function_names
}

output "notifications_queue_url" {
  value = module.notifications.queue_url
}

output "dlq_url" {
  value = module.notifications.dlq_url
}

output "api_access_log_group" {
  value = module.api.access_log_group
}

output "db_secret_arn" {
  value = module.database.secret_arn
}

output "db_port" {
  description = "Desde el host: localhost:<db_port> (proxy de RDS de Floci)."
  value       = module.database.port
}
