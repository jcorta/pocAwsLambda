# Aserciones sobre el bootstrap de AWS, con el provider simulado: el state no es público y el rol de deploy
# solo lo asume este repo desde main o desde el environment de deploy.

mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "000000000000" }
  }
}

run "bootstrap" {
  command = apply

  assert {
    condition = (
      aws_s3_bucket_public_access_block.state.block_public_acls && aws_s3_bucket_public_access_block.state.block_public_policy
      && aws_s3_bucket_public_access_block.state.ignore_public_acls && aws_s3_bucket_public_access_block.state.restrict_public_buckets
    )
    error_message = "El bucket del state bloquea todo acceso público."
  }

  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "El bucket del state tiene versionado, para recuperar un state roto."
  }

  assert {
    condition = toset(flatten([
      for s in data.aws_iam_policy_document.github_trust.statement : [
        for c in s.condition : c.values if c.variable == "token.actions.githubusercontent.com:sub"
      ]
    ])) == toset(["repo:jcorta/pocAwsLambda:ref:refs/heads/main", "repo:jcorta/pocAwsLambda:environment:aws"])
    error_message = "El rol de deploy solo lo asume este repo, desde main o desde el environment aws."
  }

  assert {
    condition = alltrue([
      for s in data.aws_iam_policy_document.github_trust.statement :
      alltrue([for c in s.condition : c.test == "StringEquals"])
    ])
    error_message = "Las condiciones del rol de deploy son exactas: sin comodines (StringLike)."
  }

  assert {
    condition = alltrue(flatten([
      for s in data.aws_iam_policy_document.deploy_iam.statement : [for r in s.resources : endswith(r, ":role/reservas-aws-*")]
    ]))
    error_message = "Los permisos de IAM del deploy se limitan a los roles del entorno aws."
  }
}
