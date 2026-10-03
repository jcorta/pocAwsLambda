# Aserciones de infra de SPEC §8.2 sobre el módulo database, con los providers simulados.

mock_provider "aws" {}
mock_provider "random" {}

variables {
  name              = "test"
  subnet_ids        = ["subnet-a", "subnet-b"]
  security_group_id = "sg-db"
}

run "rds_privada" {
  command = apply

  assert {
    condition     = !aws_db_instance.main.publicly_accessible
    error_message = "RDS no puede ser públicamente accesible."
  }

  assert {
    # El SG que recibe es el `db` del módulo network, que solo acepta al SG lambda (tests de network)
    condition     = aws_db_instance.main.vpc_security_group_ids == toset([var.security_group_id])
    error_message = "RDS usa solo el security group que recibe."
  }

  assert {
    condition     = aws_db_instance.main.storage_encrypted
    error_message = "El almacenamiento de RDS va cifrado."
  }

  assert {
    condition     = aws_db_subnet_group.main.subnet_ids == toset(var.subnet_ids)
    error_message = "RDS vive en las subnets privadas que recibe."
  }
}
