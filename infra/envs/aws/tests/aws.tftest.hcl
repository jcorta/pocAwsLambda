# Aserciones sobre el root de AWS, con los providers simulados (no necesita cuenta de AWS): que cablee los
# valores de SPEC §7.3 que lo distinguen de envs/local.

mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::000000000000:role/test" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-1:000000000000:function:test"
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:test/invocations"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:000000000000:log-group:test" }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      execution_arn = "arn:aws:execute-api:us-east-1:000000000000:abc123"
      api_endpoint  = "https://abc123.execute-api.us-east-1.amazonaws.com"
    }
  }
  mock_resource "aws_sqs_queue" {
    defaults = { arn = "arn:aws:sqs:us-east-1:000000000000:test" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-east-1:000000000000:secret:test" }
  }
  mock_resource "aws_cognito_user_pool" {
    defaults = { id = "us-east-1_test" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn         = "arn:aws:cloudfront::000000000000:distribution/EXAMPLE"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::000000000000:function/reservas-aws-index" }
  }
  mock_data "aws_cloudfront_cache_policy" {
    defaults = { id = "cache-policy" }
  }
  mock_data "aws_region" {
    defaults = { region = "us-east-1" }
  }
}

mock_provider "archive" {}
mock_provider "random" {}

variables {
  ses_from = "no-reply@example.com"
}

run "valores_de_aws" {
  command = apply

  assert {
    condition     = output.cognito_issuer_url == "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test"
    error_message = "El emisor de los tokens es el de Cognito en AWS."
  }

  assert {
    condition     = module.api.function_names["me"] == "reservas-aws-me"
    error_message = "Los recursos se nombran reservas-aws-<recurso> (SPEC §7.1)."
  }

  assert {
    condition     = output.api_url == "https://abc123.execute-api.us-east-1.amazonaws.com"
    error_message = "En AWS la URL de la API es el api_endpoint (en Floci no sirve, hallazgo A5)."
  }

  assert {
    condition     = output.frontend_url == "https://d111111abcdef8.cloudfront.net"
    error_message = "El sitio se sirve por CloudFront, con HTTPS."
  }

  assert {
    condition = (
      var.db_deletion_protection && var.db_backup_retention_days == 7 && var.lambda_architecture == "arm64"
      && var.db_instance_class == "db.t4g.micro" && var.network_egress == "endpoints" && var.enable_cloudfront
    )
    error_message = "Los valores por defecto son los de AWS en SPEC §7.3."
  }
}
