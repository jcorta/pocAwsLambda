# tflint (SPEC §8.1): reglas del ruleset de Terraform que viene incluido, sin plugins que descargar.
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
