# Aserciones de infra de SPEC §8.2 sobre el módulo network, con el provider simulado.

mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
}

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

run "sin_salida_en_local" {
  command = apply

  assert {
    condition     = length(aws_vpc_endpoint.interface) == 0 && length(aws_security_group.endpoints) == 0
    error_message = "Con network_egress = \"none\" no se crea ningún endpoint (entorno local)."
  }
}

run "endpoints_en_aws" {
  command = apply

  variables {
    network_egress = "endpoints"
  }

  assert {
    condition = toset([for e in aws_vpc_endpoint.interface : e.service_name]) == toset([
      "com.amazonaws.us-east-1.secretsmanager",
      "com.amazonaws.us-east-1.sqs",
      "com.amazonaws.us-east-1.email",
    ])
    error_message = "Hay un endpoint por servicio que usan las Lambdas: Secrets Manager, SQS y SES (D-3.1)."
  }

  assert {
    condition = alltrue([
      for e in aws_vpc_endpoint.interface :
      e.vpc_endpoint_type == "Interface" && e.private_dns_enabled && e.subnet_ids == toset([aws_subnet.private[0].id])
    ])
    error_message = "Los endpoints son interface, con DNS privado y en una sola AZ."
  }

  assert {
    condition = alltrue([
      for r in aws_security_group.endpoints[0].ingress :
      r.security_groups == toset([aws_security_group.lambda.id]) && r.from_port == 443 && r.to_port == 443
      && length(coalesce(r.cidr_blocks, [])) == 0
    ])
    error_message = "Los endpoints solo aceptan HTTPS desde el SG lambda."
  }

  assert {
    condition     = length(aws_security_group.endpoints[0].ingress) == 1
    error_message = "El SG de los endpoints tiene una sola regla de entrada."
  }
}

run "nat_no_se_implementa" {
  command = plan

  variables {
    network_egress = "nat"
  }

  # D-3.1 se resolvió con endpoints: NAT no está implementado
  expect_failures = [var.network_egress]
}
