# Aserciones de infra de SPEC §8.2 sobre el módulo frontend, con el provider simulado.

mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_data "aws_cloudfront_cache_policy" {
    defaults = { id = "cache-policy" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn         = "arn:aws:cloudfront::000000000000:distribution/EXAMPLE"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::000000000000:function/test-index" }
  }
  mock_resource "aws_s3_bucket_website_configuration" {
    defaults = { website_endpoint = "test-site.s3-website-us-east-1.amazonaws.com" }
  }
}

variables {
  name           = "test"
  runtime_config = { apiUrl = "https://api.example.com", timezone = "America/Argentina/Buenos_Aires" }
}

run "sin_cloudfront" {
  command = apply

  assert {
    condition     = length(aws_cloudfront_distribution.site) == 0 && length(aws_s3_bucket_website_configuration.site) == 1
    error_message = "Con enable_cloudfront = false no se crea ninguna distribución y el bucket sirve el website (SPEC §8.2)."
  }

  assert {
    condition     = output.website_url == "http://test-site.s3-website-us-east-1.amazonaws.com"
    error_message = "Sin CloudFront, la URL del sitio es la del website del bucket."
  }

  assert {
    condition     = aws_s3_object.config.key == "config.json" && aws_s3_object.config.cache_control == "no-store"
    error_message = "config.json se publica sin cache (SPEC §5.2)."
  }

  assert {
    condition     = jsondecode(aws_s3_object.config.content) == var.runtime_config
    error_message = "config.json tiene la configuración de runtime que recibe el módulo."
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.site.block_public_acls && aws_s3_bucket_public_access_block.site.ignore_public_acls
    error_message = "El bucket no acepta ACLs públicas: la lectura pública es solo por la política."
  }
}

run "con_cloudfront" {
  command = apply

  variables {
    enable_cloudfront = true
  }

  assert {
    condition     = length(aws_cloudfront_distribution.site) == 1 && length(aws_s3_bucket_website_configuration.site) == 0
    error_message = "Con CloudFront, el bucket no tiene website hosting: lo sirve la distribución."
  }

  assert {
    condition = (
      aws_s3_bucket_public_access_block.site.block_public_acls && aws_s3_bucket_public_access_block.site.ignore_public_acls
      && aws_s3_bucket_public_access_block.site.block_public_policy && aws_s3_bucket_public_access_block.site.restrict_public_buckets
    )
    error_message = "Con CloudFront, el bucket bloquea todo acceso público."
  }

  assert {
    condition = alltrue([
      for s in data.aws_iam_policy_document.read.statement :
      alltrue([for p in s.principals : p.type == "Service" && toset(p.identifiers) == toset(["cloudfront.amazonaws.com"])])
      && anytrue([for c in s.condition : c.variable == "AWS:SourceArn" && toset(c.values) == toset([aws_cloudfront_distribution.site[0].arn])])
    ])
    error_message = "Solo esta distribución de CloudFront puede leer el bucket (OAC)."
  }

  assert {
    condition = (
      aws_cloudfront_distribution.site[0].default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
      && alltrue([for b in aws_cloudfront_distribution.site[0].ordered_cache_behavior : b.viewer_protocol_policy == "redirect-to-https"])
    )
    error_message = "El sitio se sirve solo por HTTPS (el login lo necesita, hallazgo A8)."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site[0].default_cache_behavior[0].function_association).function_arn == aws_cloudfront_function.index[0].arn
    error_message = "La función que resuelve los índices del export estático corre en cada request."
  }

  assert {
    condition     = output.website_url == "https://d111111abcdef8.cloudfront.net"
    error_message = "Con CloudFront, la URL del sitio es la de la distribución, con HTTPS."
  }
}
