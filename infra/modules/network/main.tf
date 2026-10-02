# Red (SPEC §7.4): VPC con 2 subnets privadas en AZ distintas y security groups.
# Floci acepta estos recursos aunque no los aplique (hallazgo del spike F0, punto 5).

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

# Salida de las Lambdas hacia los servicios de AWS (decisión D-3.1, diferida a F7).
# En Floci no hace falta: Docker conecta todo. "nat" y "endpoints" se implementan en F7.
variable "network_egress" {
  type    = string
  default = "none"
  validation {
    condition     = var.network_egress == "none"
    error_message = "Por ahora solo se admite \"none\": NAT y VPC endpoints se implementan en F7 (D-3.1)."
  }
}

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
