# Base de datos (SPEC §7.4): RDS PostgreSQL 16 en subnets privadas, con las credenciales en Secrets Manager.
# La contraseña se genera con random_password (no con el secreto gestionado por RDS) para que sea igual en Floci.

terraform {
  required_providers {
    aws    = { source = "hashicorp/aws" }
    random = { source = "hashicorp/random" }
  }
}

variable "name" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "backup_retention_days" {
  type    = number
  default = 0
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-db"
  subnet_ids = var.subnet_ids
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  identifier              = "${var.name}-db"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.instance_class
  allocated_storage       = 20
  storage_encrypted       = true
  db_name                 = "reservas"
  username                = "app"
  password                = random_password.db.result
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [var.security_group_id]
  publicly_accessible     = false
  deletion_protection     = var.deletion_protection
  backup_retention_period = var.backup_retention_days
  skip_final_snapshot     = !var.deletion_protection
}

resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.name}-db"
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

output "secret_arn" {
  value = aws_secretsmanager_secret.db.arn
  # La versión del secreto tiene que existir antes de que una Lambda lo lea
  depends_on = [aws_secretsmanager_secret_version.db]
}

output "address" {
  value = aws_db_instance.main.address
}

output "port" {
  value = aws_db_instance.main.port
}
