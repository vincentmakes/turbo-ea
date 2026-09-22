# Offline tests: both providers are mocked, so these prove the values the
# chart receives — not that a cluster would accept them (the chart's own CI
# installs it on kind).

mock_provider "kubernetes" {}
mock_provider "helm" {}

variables {
  chart_version = "2.141.0"
  public_url    = "https://ea.example.com"
  db_host       = "db.internal"
  secret_key    = "0123456789abcdef0123456789abcdef0123456789abcdef"
  db_password   = "correct horse battery staple"
}

run "defaults" {
  assert {
    condition     = helm_release.this.repository == "oci://ghcr.io/vincentmakes/turbo-ea/charts" && helm_release.this.chart == "turbo-ea" && helm_release.this.version == "2.141.0"
    error_message = "the release installs the published OCI chart at the requested version"
  }

  assert {
    condition     = helm_release.this.namespace == "turbo-ea" && length(kubernetes_namespace_v1.this) == 1
    error_message = "the namespace is created and used"
  }

  assert {
    condition     = length(helm_release.this.values) == 1
    error_message = "one generated values document by default"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).publicUrl == "https://ea.example.com"
    error_message = "publicUrl is passed through"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).existingSecret == kubernetes_secret_v1.credentials[0].metadata[0].name
    error_message = "the chart reads the module-owned Secret"
  }

  assert {
    condition     = !contains(keys(yamldecode(helm_release.this.values[0])), "secretKey") && !contains(keys(yamldecode(helm_release.this.values[0]).postgresql), "password")
    error_message = "secrets never travel through values"
  }

  assert {
    condition     = sort(keys(nonsensitive(kubernetes_secret_v1.credentials[0].data))) == tolist(["POSTGRES_PASSWORD", "SECRET_KEY"])
    error_message = "the Secret carries the chart's default key names"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).postgresql.host == "db.internal" && yamldecode(helm_release.this.values[0]).postgresql.pool.size == 20
    error_message = "database settings are passed through"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).mcp.enabled == false && !contains(keys(yamldecode(helm_release.this.values[0])), "image")
    error_message = "no MCP server and no image override by default"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).ingress.enabled == false
    error_message = "ingress is off by default"
  }
}

run "existing_secret" {
  variables {
    existing_secret = "turbo-ea-credentials"
    existing_secret_keys = {
      secret_key        = "secretKey"
      postgres_password = "pgPassword"
    }
    secret_key  = null
    db_password = null
    image_tag   = "2.141.1"
    deploy_mcp  = true
  }

  assert {
    condition     = length(kubernetes_secret_v1.credentials) == 0
    error_message = "no Secret is created when one is named"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).existingSecret == "turbo-ea-credentials"
    error_message = "the named Secret is passed to the chart"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).existingSecretKeys == { secretKey = "secretKey", postgresPassword = "pgPassword" }
    error_message = "custom key names propagate"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).image.tag == "2.141.1" && yamldecode(helm_release.this.values[0]).mcp.enabled == true
    error_message = "image tag override and MCP toggle propagate"
  }
}

run "ingress_and_extra_values" {
  variables {
    create_namespace = false
    ingress = {
      enabled    = true
      class_name = "nginx"
      annotations = {
        "nginx.ingress.kubernetes.io/proxy-body-size" = "2g"
      }
      hosts = [{ host = "ea.example.com" }]
      tls   = [{ secret_name = "turbo-ea-tls", hosts = ["ea.example.com"] }]
    }
    extra_values = ["seed:\n  demo: true\n"]
  }

  assert {
    condition     = length(kubernetes_namespace_v1.this) == 0 && helm_release.this.namespace == "turbo-ea"
    error_message = "an existing namespace is used as given"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).ingress.enabled == true && yamldecode(helm_release.this.values[0]).ingress.className == "nginx"
    error_message = "ingress settings are renamed to the chart's keys"
  }

  assert {
    condition     = yamldecode(helm_release.this.values[0]).ingress.hosts[0].paths[0].pathType == "Prefix" && yamldecode(helm_release.this.values[0]).ingress.tls[0].secretName == "turbo-ea-tls"
    error_message = "hosts and tls are renamed to the chart's keys"
  }

  assert {
    condition     = length(helm_release.this.values) == 2 && yamldecode(helm_release.this.values[1]).seed.demo == true
    error_message = "extra values documents are appended"
  }
}
