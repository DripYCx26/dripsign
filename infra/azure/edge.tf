# Front Door Standard is the public entry: HTTP redirects to HTTPS, nothing is cached. Until `host`
# is set the deployment serves on the endpoint's own host name; setting it adds the custom domain
# with a managed certificate, which needs the CNAME and `_dnsauth` TXT records from `dns_records`.

resource "azurerm_cdn_frontdoor_profile" "main" {
  name                = "afd-${var.name}"
  resource_group_name = azurerm_resource_group.main.name
  sku_name            = "Standard_AzureFrontDoor"
}

resource "azurerm_cdn_frontdoor_endpoint" "main" {
  name                     = "${var.name}-${local.suffix}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
}

resource "azurerm_cdn_frontdoor_custom_domain" "host" {
  count = var.host == null ? 0 : 1

  name                     = replace(var.host, ".", "-")
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
  host_name                = var.host

  tls {
    certificate_type = "ManagedCertificate"
    minimum_version  = "TLS12"
  }
}

resource "azurerm_cdn_frontdoor_origin_group" "web" {
  name                     = "web"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id

  health_probe {
    interval_in_seconds = 60
    path                = "/health"
    protocol            = "Https"
    request_type        = "GET"
  }

  load_balancing {}
}

resource "azurerm_cdn_frontdoor_origin" "web" {
  count = var.web_replicas > 0 ? 1 : 0

  name                           = "web"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.web.id
  host_name                      = azurerm_container_app.web[0].ingress[0].fqdn
  origin_host_header             = azurerm_container_app.web[0].ingress[0].fqdn
  certificate_name_check_enabled = true
  https_port                     = 443
}

resource "azurerm_cdn_frontdoor_route" "web" {
  count = var.web_replicas > 0 ? 1 : 0

  name                            = "web"
  cdn_frontdoor_endpoint_id       = azurerm_cdn_frontdoor_endpoint.main.id
  cdn_frontdoor_origin_group_id   = azurerm_cdn_frontdoor_origin_group.web.id
  cdn_frontdoor_origin_ids        = [azurerm_cdn_frontdoor_origin.web[0].id]
  cdn_frontdoor_custom_domain_ids = azurerm_cdn_frontdoor_custom_domain.host[*].id
  link_to_default_domain          = true

  patterns_to_match      = ["/*"]
  supported_protocols    = ["Http", "Https"]
  https_redirect_enabled = true
  forwarding_protocol    = "HttpsOnly"
}
