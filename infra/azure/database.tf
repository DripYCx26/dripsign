# The record: one Flexible Server with private access only and DripSign's own database and logins.
# `infra/database.sql`, run by the database job, creates the roles and the database; Terraform
# never holds a database object. Parameters keep statement text and parameters out of server logs.

locals {
  server_parameters = {
    "require_secure_transport"          = "ON"
    "ssl_min_protocol_version"          = "TLSv1.2"
    "password_encryption"               = "SCRAM-SHA-256"
    "log_statement"                     = "none"
    "log_min_duration_statement"        = "-1"
    "log_parameter_max_length"          = "0"
    "log_parameter_max_length_on_error" = "0"
    "pg_qs.query_capture_mode"          = "none"
  }
}

resource "azurerm_postgresql_flexible_server" "db" {
  name                = local.server_name
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  version             = "18"

  sku_name                     = var.db_sku
  storage_mb                   = var.db_storage_mb
  auto_grow_enabled            = true
  backup_retention_days        = var.db_backup_days
  geo_redundant_backup_enabled = var.db_geo_backup

  delegated_subnet_id           = azurerm_subnet.data.id
  private_dns_zone_id           = azurerm_private_dns_zone.postgres.id
  public_network_access_enabled = false

  administrator_login               = "dripsign_admin"
  administrator_password_wo         = ephemeral.random_password.admin.result
  administrator_password_wo_version = var.db_credential_version

  authentication {
    password_auth_enabled         = true
    active_directory_auth_enabled = false
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [zone]
  }

  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}

resource "azurerm_postgresql_flexible_server_configuration" "param" {
  for_each = local.server_parameters

  name      = each.key
  server_id = azurerm_postgresql_flexible_server.db.id
  value     = each.value
}

resource "azurerm_management_lock" "db" {
  name       = "database-cannot-delete"
  scope      = azurerm_postgresql_flexible_server.db.id
  lock_level = "CanNotDelete"
  notes      = "Agreement, signature and audit records. Deleting the server deletes its backups."
}
