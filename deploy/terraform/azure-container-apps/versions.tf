terraform {
  # >= 1.9 for cross-variable validation. No write-only arguments, no
  # provider-defined functions: the configuration should also run on OpenTofu,
  # although only Terraform is exercised in CI.
  required_version = ">= 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}
