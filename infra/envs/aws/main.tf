# Entorno en AWS real (SPEC §7, §11). Preparado en F6 y **sin aplicar**: se aplica por primera vez en F7.
# Usa los mismos módulos que envs/local; las diferencias son el provider, el backend y los valores de §7.3.
# Pendiente de F7 (los módulos todavía rechazan otros valores):
#   - network_egress: NAT o VPC endpoints (D-3.1). Con "none" las Lambdas no llegan a Secrets Manager ni a SQS.
#   - enable_cloudfront: sin CloudFront el sitio se sirve por HTTP desde el website del bucket.
#   - SES con dominio verificado y Cognito enviando por SES (SPEC §11.1.3).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.0" }
    random  = { source = "hashicorp/random", version = "~> 3.0" }
  }
  # Bucket y región salen de infra/bootstrap: `terraform init -backend-config=backend.hcl` (ver backend.hcl.example).
  # Bloqueo nativo de S3, sin DynamoDB (SPEC §7.7)
  backend "s3" {
    key          = "reservas/aws/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "timezone" {
  type    = string
  default = "America/Argentina/Buenos_Aires"
}

variable "ses_from" {
  description = "Remitente de los emails, de un dominio verificado en SES (SPEC §11.1.3)."
  type        = string
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "lambda_architecture" {
  description = "arm64 es más barato en AWS (SPEC §7.3). Los bundles son JavaScript puro."
  type        = string
  default     = "arm64"
}

variable "network_egress" {
  description = "Salida de las Lambdas a los servicios de AWS (D-3.1, se decide en F7)."
  type        = string
  default     = "none"
}

variable "enable_cloudfront" {
  description = "CloudFront delante del bucket (F7)."
  type        = bool
  default     = false
}

provider "aws" {
  region = var.region
  # Credenciales: OIDC en la CI (rol de infra/bootstrap) o el perfil local del desarrollador

  default_tags {
    tags = { project = "reservas", env = "aws", "managed-by" = "terraform" }
  }
}

locals {
  name = "reservas-aws"
}

module "network" {
  source         = "../../modules/network"
  name           = local.name
  network_egress = var.network_egress
}

module "database" {
  source                = "../../modules/database"
  name                  = local.name
  subnet_ids            = module.network.private_subnet_ids
  security_group_id     = module.network.db_security_group_id
  instance_class        = var.db_instance_class
  deletion_protection   = var.db_deletion_protection
  backup_retention_days = var.db_backup_retention_days
}

module "auth" {
  source = "../../modules/auth"
  name   = local.name
}

module "notifications" {
  source   = "../../modules/notifications"
  name     = local.name
  ses_from = var.ses_from
}

module "api" {
  source              = "../../modules/api"
  name                = local.name
  lambda_dist_dir     = "${path.root}/../../../services/api/dist/lambdas"
  lambda_architecture = var.lambda_architecture
  subnet_ids          = module.network.private_subnet_ids
  security_group_id   = module.network.lambda_security_group_id
  db_secret_arn       = module.database.secret_arn
  db_ssl              = "require"
  timezone            = var.timezone
  cognito_issuer_url  = "https://cognito-idp.${var.region}.amazonaws.com/${module.auth.user_pool_id}"
  cognito_client_id   = module.auth.client_id
  # El dominio del sitio: hoy el website del bucket; con CloudFront (F7), el de la distribución
  cors_origins = [module.frontend.website_url]

  notifications_queue_url = module.notifications.queue_url
  notifications_queue_arn = module.notifications.queue_arn
  ses_from                = module.notifications.ses_from
}

module "frontend" {
  source            = "../../modules/frontend"
  name              = local.name
  enable_cloudfront = var.enable_cloudfront
  runtime_config = {
    apiUrl = module.api.api_endpoint
    # Sin `endpoint`: el SDK usa el de AWS (SPEC §5.2)
    cognito = {
      region     = var.region
      userPoolId = module.auth.user_pool_id
      clientId   = module.auth.client_id
    }
    timezone = var.timezone
  }
}

# --- Outputs (SPEC §7.5): los mismos nombres que envs/local, para que los scripts sirvan en los dos ---

output "api_url" {
  value = module.api.api_endpoint
}

output "frontend_bucket" {
  value = module.frontend.bucket
}

output "frontend_url" {
  value = module.frontend.website_url
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "user_pool_client_id" {
  value = module.auth.client_id
}

output "cognito_issuer_url" {
  value = "https://cognito-idp.${var.region}.amazonaws.com/${module.auth.user_pool_id}"
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
