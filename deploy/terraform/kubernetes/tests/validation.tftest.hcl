mock_provider "kubernetes" {}
mock_provider "helm" {}

variables {
  chart_version = "2.141.0"
  public_url    = "https://ea.example.com"
  db_host       = "db.internal"
  secret_key    = "0123456789abcdef0123456789abcdef0123456789abcdef"
  db_password   = "correct horse battery staple"
}

run "no_secret_key" {
  command = plan

  variables {
    secret_key = null
  }

  expect_failures = [var.secret_key]
}

run "no_db_password" {
  command = plan

  variables {
    db_password = null
  }

  expect_failures = [var.db_password]
}

run "latest_chart" {
  command = plan

  variables {
    chart_version = "latest"
  }

  expect_failures = [var.chart_version]
}

run "public_url_with_path" {
  command = plan

  variables {
    public_url = "https://ea.example.com/app"
  }

  expect_failures = [var.public_url]
}
