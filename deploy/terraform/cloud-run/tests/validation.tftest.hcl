mock_provider "google" {}

variables {
  project_id = "my-project"
  region     = "europe-west1"
  public_url = "https://ea.example.com"
  image_tag  = "2.141.0"
  secret_key = "0123456789abcdef0123456789abcdef0123456789abcdef"
  network    = "vpc"
  subnetwork = "subnet"
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
    db_host         = "10.30.0.4"
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

run "bad_connect_mode" {
  command = plan

  variables {
    filestore_connect_mode = "PEERING"
  }

  expect_failures = [var.filestore_connect_mode]
}
