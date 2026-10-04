# Frontend (SPEC §7.4): bucket S3 con el sitio estático y el config.json de runtime (SPEC §5.2).
# Los archivos del sitio no los sube Terraform: los sube `deploy:web:local` (y en AWS, `aws:deploy` o el pipeline).
#   - Sin CloudFront (entorno local, Floci): el bucket sirve el sitio con website hosting y lectura pública.
#   - Con CloudFront (AWS): el bucket es privado y solo lo lee la distribución (OAC). El sitio va por HTTPS,
#     que el login necesita: fuera de un contexto seguro falta crypto.randomUUID (hallazgo A8).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "name" {
  type = string
}

variable "runtime_config" {
  description = "Contenido de /config.json: apiUrl, cognito y timezone (SPEC §5.2)."
  type        = any
}

variable "enable_cloudfront" {
  description = "true en AWS: bucket privado detrás de CloudFront con HTTPS. false en Floci, que sirve el website del bucket."
  type        = bool
  default     = false
}

locals {
  cloudfront = var.enable_cloudfront
}

resource "aws_s3_bucket" "site" {
  bucket        = "${var.name}-site"
  force_destroy = true
}

# Lo escribe Terraform con los outputs del entorno; el build nunca lo incluye (SPEC §5.2)
resource "aws_s3_object" "config" {
  bucket        = aws_s3_bucket.site.id
  key           = "config.json"
  content       = jsonencode(var.runtime_config)
  content_type  = "application/json"
  cache_control = "no-store"
}

# --- Sin CloudFront: website hosting público (entorno local) ---

resource "aws_s3_bucket_website_configuration" "site" {
  count  = local.cloudfront ? 0 : 1
  bucket = aws_s3_bucket.site.id
  index_document { suffix = "index.html" }
  error_document { key = "404.html" }
}

moved {
  from = aws_s3_bucket_website_configuration.site
  to   = aws_s3_bucket_website_configuration.site[0]
}

# Con CloudFront se bloquea todo acceso público; sin CloudFront se permite solo la política de lectura
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = local.cloudfront
  restrict_public_buckets = local.cloudfront
}

data "aws_iam_policy_document" "read" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = local.cloudfront ? "Service" : "*"
      identifiers = local.cloudfront ? ["cloudfront.amazonaws.com"] : ["*"]
    }

    # Con CloudFront, solo esta distribución puede leer el bucket
    dynamic "condition" {
      for_each = local.cloudfront ? [1] : []
      content {
        test     = "StringEquals"
        variable = "AWS:SourceArn"
        values   = [aws_cloudfront_distribution.site[0].arn]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "read" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.read.json
  depends_on = [aws_s3_bucket_public_access_block.site]
}

moved {
  from = aws_s3_bucket_policy.public_read
  to   = aws_s3_bucket_policy.read
}

# --- Con CloudFront: bucket privado, OAC y HTTPS (AWS) ---

resource "aws_cloudfront_origin_access_control" "site" {
  count                             = local.cloudfront ? 1 : 0
  name                              = "${var.name}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# El export estático genera /ruta/index.html y el origen S3 (sin website hosting) no resuelve índices:
# /resources/ → /resources/index.html y /resources → /resources/index.html
resource "aws_cloudfront_function" "index" {
  count   = local.cloudfront ? 1 : 0
  name    = "${var.name}-index"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/index-rewrite.js")
}

# Políticas administradas de AWS: sin cache para el HTML y config.json (cada deploy se ve al instante, sin
# invalidar), y cache larga para los assets de Next, que llevan un hash en el nombre
data "aws_cloudfront_cache_policy" "disabled" {
  count = local.cloudfront ? 1 : 0
  name  = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  count = local.cloudfront ? 1 : 0
  name  = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "site" {
  count               = local.cloudfront ? 1 : 0
  enabled             = true
  comment             = "${var.name} sitio"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # solo Norteamérica y Europa: la más barata
  http_version        = "http2and3"

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site[0].id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.disabled[0].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index[0].arn
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized[0].id
  }

  # Sin permiso de listar, S3 responde 403 a lo que no existe: se muestra la página 404 del sitio
  dynamic "custom_error_response" {
    for_each = [403, 404]
    content {
      error_code            = custom_error_response.value
      response_code         = 404
      response_page_path    = "/404.html"
      error_caching_min_ttl = 0
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

output "bucket" {
  value = aws_s3_bucket.site.id
}

output "website_url" {
  description = "URL pública del sitio: CloudFront (HTTPS) en AWS, o el website del bucket sin CloudFront."
  value = (local.cloudfront
    ? "https://${one(aws_cloudfront_distribution.site[*].domain_name)}"
  : "http://${one(aws_s3_bucket_website_configuration.site[*].website_endpoint)}")
}

output "distribution_id" {
  value = one(aws_cloudfront_distribution.site[*].id)
}
