# Aserciones de infra de SPEC §8.2 sobre el módulo network, con el provider simulado.

mock_provider "aws" {}

variables {
  name = "test"
}

run "la_db_solo_acepta_a_las_lambdas" {
  command = apply

  assert {
    condition     = length(aws_security_group.db.ingress) == 1
    error_message = "El SG de la base tiene una sola regla de entrada."
  }

  assert {
    condition = alltrue([
      for r in aws_security_group.db.ingress :
      # Con el provider simulado, los atributos que no se configuran quedan en null
      r.security_groups == toset([aws_security_group.lambda.id]) && length(coalesce(r.cidr_blocks, [])) == 0
      && length(coalesce(r.ipv6_cidr_blocks, [])) == 0
      && r.from_port == 5432 && r.to_port == 5432 && r.protocol == "tcp"
    ])
    error_message = "El SG de la base solo acepta Postgres (5432) desde el SG lambda, sin rangos de IP."
  }

  assert {
    condition     = length(aws_subnet.private) == 2 && length(toset(aws_subnet.private[*].availability_zone)) == 2
    error_message = "Hay 2 subnets privadas en AZ distintas (RDS lo exige)."
  }

  assert {
    condition     = alltrue([for s in aws_subnet.private : s.map_public_ip_on_launch != true])
    error_message = "Las subnets no asignan IP pública."
  }
}

run "network_egress_solo_none" {
  command = plan

  variables {
    network_egress = "nat"
  }

  # NAT y VPC endpoints llegan en F7 (D-3.1)
  expect_failures = [var.network_egress]
}
