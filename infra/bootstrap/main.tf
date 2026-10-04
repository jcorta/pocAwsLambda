# Bootstrap de AWS (SPEC §7.7, §11.1.1): se aplica una sola vez y a mano, con credenciales de administrador.
# Crea el bucket del state de envs/aws y el rol que asume GitHub Actions por OIDC, sin claves de larga duración.
# Usa state local (en .gitignore): si se pierde, se importan los recursos o se recrean.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "local" {}
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_repository" {
  description = "owner/repo que puede asumir el rol de deploy."
  type        = string
  default     = "jcorta/pocAwsLambda"
}

variable "github_environment" {
  description = "Environment de GitHub de deploy-aws.yml (SPEC §9.2). Se configura para aceptar solo la rama main."
  type        = string
  default     = "aws"
}

variable "env_name" {
  description = "Prefijo de los recursos de envs/aws (`local.name`): limita los roles IAM que puede administrar el deploy."
  type        = string
  default     = "reservas-aws"
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "reservas", env = "bootstrap", "managed-by" = "terraform" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

# --- Bucket del state de envs/aws ---

# Sin prevent_destroy: el POC se despliega, se prueba y se borra entero (SPEC §11.1). Que no se borre el state
# mientras queden recursos lo garantiza `pnpm aws:destroy`, que destruye envs/aws y verifica antes de llegar acá.
resource "aws_s3_bucket" "state" {
  bucket        = "reservas-tfstate-${local.account_id}"
  force_destroy = true # el state tiene versionado: sin esto, el destroy no puede vaciar el bucket
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "state_tls_only" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket     = aws_s3_bucket.state.id
  policy     = data.aws_iam_policy_document.state_tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.state]
}

# --- OIDC de GitHub Actions ---

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Solo este repo, y solo desde main o desde el environment de deploy (que a su vez solo acepta main).
# Con environment, GitHub firma el token con `environment:<nombre>` en lugar de la rama.
data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:ref:refs/heads/main",
        "repo:${var.github_repository}:environment:${var.github_environment}",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "reservas-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600
}

# PowerUserAccess cubre todos los servicios del proyecto salvo IAM
resource "aws_iam_role_policy_attachment" "deploy_power_user" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# IAM acotado a los roles de las Lambdas del entorno (`<env_name>-<lambda>`), que crea el módulo api
data "aws_iam_policy_document" "deploy_iam" {
  statement {
    sid = "ManageLambdaRoles"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole", "iam:TagRole", "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.env_name}-*"]
  }
  statement {
    sid       = "PassLambdaRoles"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.env_name}-*"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "deploy_iam" {
  name   = "manage-lambda-roles"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_iam.json
}

# --- Outputs: van a envs/aws/backend.hcl y a la variable AWS_DEPLOY_ROLE_ARN del repo ---

output "state_bucket" {
  value = aws_s3_bucket.state.id
}

output "region" {
  value = var.region
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}
