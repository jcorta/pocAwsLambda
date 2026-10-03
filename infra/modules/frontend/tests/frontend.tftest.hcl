# Aserciones de infra de SPEC §8.2 sobre el módulo frontend, con el provider simulado.
# Hoy el módulo no declara ninguna distribución de CloudFront: con enable_cloudfront = false el plan se arma
# sin ella y `true` se rechaza. Cuando F7 la agregue, se suma acá `length(aws_cloudfront_distribution.site) == 0`.

mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
}

variables {
  name           = "test"
  runtime_config = { apiUrl = "https://api.example.com", timezone = "America/Argentina/Buenos_Aires" }
}

run "sin_cloudfront" {
  command = apply

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

run "cloudfront_todavia_no" {
  command = plan

  variables {
    enable_cloudfront = true
  }

  expect_failures = [var.enable_cloudfront]
}
