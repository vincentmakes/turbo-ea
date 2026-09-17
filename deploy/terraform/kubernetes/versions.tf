terraform {
  # >= 1.9 for cross-variable validation. No write-only arguments, no
  # provider-defined functions: the configuration should also run on OpenTofu,
  # although only Terraform is exercised in CI.
  required_version = ">= 1.9"

  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.3"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.2"
    }
  }
}
