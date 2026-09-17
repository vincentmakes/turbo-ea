# Global external HTTPS load balancer with a Google-managed certificate for the
# host of public_url (create_load_balancer = true). Point the DNS A record at
# load_balancer_ip; the certificate becomes ACTIVE once it resolves.

resource "google_compute_global_address" "lb" {
  count = var.create_load_balancer ? 1 : 0

  name       = "${var.name}-lb"
  depends_on = [google_project_service.this]
}

resource "google_compute_region_network_endpoint_group" "run" {
  count = var.create_load_balancer ? 1 : 0

  name                  = "${var.name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.this.name
  }
}

resource "google_compute_backend_service" "run" {
  count = var.create_load_balancer ? 1 : 0

  name                  = "${var.name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.run[0].id
  }
}

resource "google_compute_url_map" "https" {
  count = var.create_load_balancer ? 1 : 0

  name            = "${var.name}-https"
  default_service = google_compute_backend_service.run[0].id
}

resource "google_compute_managed_ssl_certificate" "this" {
  count = var.create_load_balancer ? 1 : 0

  name = "${var.name}-cert"

  managed {
    domains = [local.public_host]
  }
}

resource "google_compute_target_https_proxy" "this" {
  count = var.create_load_balancer ? 1 : 0

  name             = "${var.name}-https-proxy"
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.this[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count = var.create_load_balancer ? 1 : 0

  name                  = "${var.name}-https"
  target                = google_compute_target_https_proxy.this[0].id
  port_range            = "443"
  ip_address            = google_compute_global_address.lb[0].address
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_url_map" "redirect" {
  count = var.create_load_balancer ? 1 : 0

  name = "${var.name}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count = var.create_load_balancer ? 1 : 0

  name    = "${var.name}-http-proxy"
  url_map = google_compute_url_map.redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count = var.create_load_balancer ? 1 : 0

  name                  = "${var.name}-http"
  target                = google_compute_target_http_proxy.redirect[0].id
  port_range            = "80"
  ip_address            = google_compute_global_address.lb[0].address
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
