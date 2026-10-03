# Notificaciones (SPEC §7.4): cola SQS con DLQ e identidad del remitente en SES.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "name" {
  type = string
}

variable "ses_from" {
  description = "Remitente de los emails. En Floci la verificación es instantánea; en AWS hay que verificar el dominio."
  type        = string
}

variable "consumer_timeout_seconds" {
  description = "Timeout de la Lambda notifier. AWS recomienda un visibility timeout de al menos 6 veces ese valor."
  type        = number
  default     = 30
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-notifications-dlq"
  message_retention_seconds = 14 * 24 * 3600
}

resource "aws_sqs_queue" "notifications" {
  name                       = "${var.name}-notifications"
  visibility_timeout_seconds = 6 * var.consumer_timeout_seconds
}

# Tras 3 intentos fallidos, el mensaje pasa a la DLQ para inspección (CU-10)
resource "aws_sqs_queue_redrive_policy" "notifications" {
  queue_url = aws_sqs_queue.notifications.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_ses_email_identity" "from" {
  email = var.ses_from
}

output "queue_url" {
  value = aws_sqs_queue.notifications.url
}

output "queue_arn" {
  value = aws_sqs_queue.notifications.arn
}

output "dlq_url" {
  value = aws_sqs_queue.dlq.url
}

output "ses_from" {
  value = aws_ses_email_identity.from.email
}
