locals {
  namespace   = var.create_namespace ? kubernetes_namespace_v1.this[0].metadata[0].name : var.namespace
  secret_name = var.existing_secret != "" ? var.existing_secret : kubernetes_secret_v1.credentials[0].metadata[0].name

  # The chart's own keys (charts/turbo-ea/values.yaml). Secrets never travel
  # through values: the chart reads them from the Secret named below.
  values = merge(
    {
      publicUrl      = var.public_url
      existingSecret = local.secret_name
      existingSecretKeys = {
        secretKey        = var.existing_secret_keys.secret_key
        postgresPassword = var.existing_secret_keys.postgres_password
      }
      postgresql = {
        host     = var.db_host
        port     = var.db_port
        database = var.db_name
        username = var.db_user
        pool = {
          size        = var.db_pool_size
          maxOverflow = var.db_max_overflow
        }
      }
      allowedOrigins      = var.allowed_origins
      embedAllowedOrigins = var.embed_allowed_origins
      mcp                 = { enabled = var.deploy_mcp }
      backend = {
        persistence = {
          storageClass  = var.storage_class
          size          = var.storage_size
          existingClaim = var.existing_claim
        }
      }
      ingress = {
        enabled     = var.ingress.enabled
        className   = var.ingress.class_name
        annotations = var.ingress.annotations
        hosts = [
          for h in var.ingress.hosts : {
            host  = h.host
            paths = [for p in h.paths : { path = p.path, pathType = p.path_type }]
          }
        ]
        tls = [
          for t in var.ingress.tls : { secretName = t.secret_name, hosts = t.hosts }
        ]
      }
    },
    var.image_tag == null ? {} : { image = { tag = var.image_tag } },
  )
}

resource "kubernetes_namespace_v1" "this" {
  count = var.create_namespace ? 1 : 0

  metadata {
    name = var.namespace
  }
}

resource "kubernetes_secret_v1" "credentials" {
  count = var.existing_secret == "" ? 1 : 0

  metadata {
    name      = "${var.release_name}-credentials"
    namespace = local.namespace
  }

  type = "Opaque"

  data = {
    (var.existing_secret_keys.secret_key)        = var.secret_key
    (var.existing_secret_keys.postgres_password) = var.db_password
  }
}

resource "helm_release" "this" {
  name       = var.release_name
  namespace  = local.namespace
  repository = var.chart_repository
  chart      = "turbo-ea"
  version    = var.chart_version

  create_namespace = false
  wait             = var.helm_wait
  timeout          = var.helm_timeout
  atomic           = var.helm_atomic

  values = concat([yamlencode(local.values)], var.extra_values)

  depends_on = [kubernetes_secret_v1.credentials]
}
