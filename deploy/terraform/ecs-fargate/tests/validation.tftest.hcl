mock_provider "aws" {}

variables {
  region             = "eu-west-1"
  public_url         = "https://ea.example.com"
  image_tag          = "2.141.0"
  secret_key         = "0123456789abcdef0123456789abcdef0123456789abcdef"
  vpc_id             = "vpc-0123456789abcdef0"
  public_subnet_ids  = ["subnet-0aaaaaaaaaaaaaaa1", "subnet-0aaaaaaaaaaaaaaa2"]
  private_subnet_ids = ["subnet-0bbbbbbbbbbbbbbb1", "subnet-0bbbbbbbbbbbbbbb2"]
  certificate_arn    = "arn:aws:acm:eu-west-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
}

run "byo_without_host" {
  command = plan

  variables {
    create_database = false
    db_password     = "pw"
  }

  expect_failures = [var.db_host]
}

run "byo_without_password" {
  command = plan

  variables {
    create_database = false
    db_host         = "db.internal"
  }

  expect_failures = [var.db_password]
}

run "latest_tag" {
  command = plan

  variables {
    image_tag = "latest"
  }

  expect_failures = [var.image_tag]
}

run "public_url_with_path" {
  command = plan

  variables {
    public_url = "https://ea.example.com/"
  }

  expect_failures = [var.public_url]
}

run "one_private_subnet" {
  command = plan

  variables {
    private_subnet_ids = ["subnet-0bbbbbbbbbbbbbbb1"]
  }

  expect_failures = [var.private_subnet_ids]
}

run "short_secret_key" {
  command = plan

  variables {
    secret_key = "too-short"
  }

  expect_failures = [var.secret_key]
}
