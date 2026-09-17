plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "azurerm" {
  enabled = true
  version = "0.32.0"
  source  = "github.com/terraform-linters/tflint-ruleset-azurerm"
}

# Data-bearing resources are protected by CanNotDelete locks toggled through
# db_deletion_protection / storage_deletion_protection; a literal
# prevent_destroy would make `terraform destroy` need a code edit.
rule "azurerm_resources_missing_prevent_destroy" {
  enabled = false
}
