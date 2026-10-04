# Red (SPEC §7.4): VPC con 2 subnets privadas en AZ distintas y security groups.
# Floci acepta estos recursos aunque no los aplique (hallazgo del spike F0, punto 5).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "name" {
  type = string
}

variable "cidr_block" {
  type    = string
  default = "10.0.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

# Salida de las Lambdas hacia los servicios de AWS (decisión D-3.1, SPEC §12.1):
#   "none":      sin salida. En Floci no hace falta, porque Docker conecta todo.
#   "endpoints": interface endpoints (PrivateLink) de los servicios que usan las Lambdas. Sin salida a Internet.
variable "network_egress" {
  type    = string
  default = "none"
  validation {
    condition     = contains(["none", "endpoints"], var.network_egress)
    error_message = "network_egress admite \"none\" (local) o \"endpoints\" (AWS)."
  }
}

variable "endpoint_services" {
  description = "Servicios a los que llaman las Lambdas: el secreto de la DB, la cola de notificaciones y el envío de emails."
  type        = list(string)
  default     = ["secretsmanager", "sqs", "email"]
}

variable "endpoint_az_count" {
  description = "En cuántas AZ se crean los endpoints. Cada endpoint cobra por hora y por AZ: 1 alcanza para el POC (D-3.1)."
  type        = number
  default     = 1
  validation {
    condition     = var.endpoint_az_count >= 1 && var.endpoint_az_count <= length(var.availability_zones)
    error_message = "endpoint_az_count va de 1 a la cantidad de AZ."
  }
}

locals {
  endpoints = var.network_egress == "endpoints" ? toset(var.endpoint_services) : toset([])
}

data "aws_region" "current" {}

resource "aws_vpc" "main" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.cidr_block, 8, count.index)
  availability_zone = var.availability_zones[count.index]
  tags              = { Name = "${var.name}-private-${count.index}" }
}

resource "aws_security_group" "lambda" {
  name        = "${var.name}-lambda"
  description = "Lambdas de la API"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "RDS: solo acepta conexiones desde las Lambdas"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
}

# --- Interface endpoints (network_egress = "endpoints") ---
# Con DNS privado, los SDK de las Lambdas usan los nombres de siempre (secretsmanager.<region>.amazonaws.com, etc.)
# y resuelven a las IP privadas de los endpoints: el código no cambia.

resource "aws_security_group" "endpoints" {
  count       = length(local.endpoints) > 0 ? 1 : 0
  name        = "${var.name}-endpoints"
  description = "Interface endpoints: solo HTTPS desde las Lambdas"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = local.endpoints
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = slice(aws_subnet.private[*].id, 0, var.endpoint_az_count)
  security_group_ids  = [aws_security_group.endpoints[0].id]
  tags                = { Name = "${var.name}-${each.key}" }
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "lambda_security_group_id" {
  value = aws_security_group.lambda.id
}

output "db_security_group_id" {
  value = aws_security_group.db.id
}
