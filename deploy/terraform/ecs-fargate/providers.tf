provider "aws" {
  region = var.region

  default_tags {
    tags = merge({ "turbo-ea" = var.name }, var.tags)
  }
}
