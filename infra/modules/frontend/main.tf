# Frontend (SPEC §7.4): bucket S3 con el sitio estático y el config.json de runtime (SPEC §5.2).
# Los archivos del sitio no los sube Terraform: los sube `deploy:web:local` (y en AWS, el pipeline).

variable "name" {
  type = string
}

variable "runtime_config" {
  description = "Contenido de /config.json: apiUrl, cognito y timezone (SPEC §5.2)."
  type        = any
}

# CloudFront delante del bucket es para AWS real (F7). Sin CloudFront, el bucket sirve el sitio con
# website hosting y lectura pública, como en Floci.
variable "enable_cloudfront" {
  type    = bool
  default = false
  validation {
    condition     = !var.enable_cloudfront
    error_message = "CloudFront se implementa en F7 (SPEC §11.1); por ahora solo se admite false."
  }
}

resource "aws_s3_bucket" "site" {
  bucket        = "${var.name}-site"
  force_destroy = true
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  index_document { suffix = "index.html" }
  error_document { key = "404.html" }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

data "aws_iam_policy_document" "public_read" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "public_read" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.public_read.json
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# Lo escribe Terraform con los outputs del entorno; el build nunca lo incluye (SPEC §5.2)
resource "aws_s3_object" "config" {
  bucket        = aws_s3_bucket.site.id
  key           = "config.json"
  content       = jsonencode(var.runtime_config)
  content_type  = "application/json"
  cache_control = "no-store"
}

output "bucket" {
  value = aws_s3_bucket.site.id
}
