# Two subnets, one egress address, no peering. The database has no public endpoint; Key Vault and
# storage admit only the apps subnet through service endpoints.

resource "azurerm_resource_group" "main" {
  name     = var.name
  location = var.location
}

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${var.name}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = [var.address_space]
}

resource "azurerm_subnet" "apps" {
  name                 = "snet-apps"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [local.apps_prefix]

  default_outbound_access_enabled = false

  service_endpoint {
    service = "Microsoft.KeyVault"
  }

  service_endpoint {
    service = "Microsoft.Storage"
  }

  delegation {
    name = "container-apps"

    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "data" {
  name                 = "snet-data"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [local.data_prefix]

  default_outbound_access_enabled = false

  delegation {
    name = "flexible-server"

    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# The egress address: static, so a host can allowlist DripSign's executed events.
resource "azurerm_public_ip" "egress" {
  name                = "pip-${var.name}-egress"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Standard"
  allocation_method   = "Static"
}

resource "azurerm_nat_gateway" "egress" {
  name                    = "ng-${var.name}"
  location                = var.location
  resource_group_name     = azurerm_resource_group.main.name
  sku_name                = "Standard"
  idle_timeout_in_minutes = 4
}

resource "azurerm_nat_gateway_public_ip_association" "egress" {
  nat_gateway_id       = azurerm_nat_gateway.egress.id
  public_ip_address_id = azurerm_public_ip.egress.id
}

resource "azurerm_subnet_nat_gateway_association" "apps" {
  subnet_id      = azurerm_subnet.apps.id
  nat_gateway_id = azurerm_nat_gateway.egress.id
}

# Flexible Server private access resolves through this zone; failover rewrites its records.
resource "azurerm_private_dns_zone" "postgres" {
  name                = "${var.name}.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                 = "link-vnet-${var.name}"
  private_dns_zone_id  = azurerm_private_dns_zone.postgres.id
  virtual_network_id   = azurerm_virtual_network.main.id
  registration_enabled = false
}
