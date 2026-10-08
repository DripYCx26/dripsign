# The app secrets: one vault, data plane open to the apps subnet only, one reader grant per
# (identity, secret). Generated values are ephemeral and operator values are ephemeral inputs;
# both are written through the control plane and never enter state, plan or log.

resource "azurerm_key_vault" "main" {
  name                = "ds-${var.code}-${local.suffix}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = true

  network_acls {
    default_action             = "Deny"
    bypass                     = "None"
    virtual_network_subnet_ids = [azurerm_subnet.apps.id]
  }
}

resource "azurerm_monitor_diagnostic_setting" "vault" {
  name                       = "audit"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AuditEvent"
  }
}

ephemeral "random_password" "admin" {
  length  = 48
  special = false
}

ephemeral "random_password" "login" {
  for_each = toset(["dripsign_app", "dripsign_migrator"])

  length  = 48
  special = false
}

ephemeral "random_password" "auth_secret" {
  length  = 64
  special = false
}

locals {
  database_secret_names = toset(["database-admin-url", "database-app-password", "database-migrator-password", "database-url", "migration-database-url"])

  # The release jobs' psql connects inside the VNet with `require`; the Node runtimes verify the
  # server certificate and host name.
  database_secret_values = {
    "database-admin-url"         = "postgres://dripsign_admin:${ephemeral.random_password.admin.result}@${local.server_fqdn}:5432/postgres?sslmode=require"
    "database-app-password"      = ephemeral.random_password.login["dripsign_app"].result
    "database-migrator-password" = ephemeral.random_password.login["dripsign_migrator"].result
    "database-url"               = "postgres://dripsign_app:${ephemeral.random_password.login["dripsign_app"].result}@${local.server_fqdn}:5432/dripsign?sslmode=verify-full"
    "migration-database-url"     = "postgres://dripsign_migrator:${ephemeral.random_password.login["dripsign_migrator"].result}@${local.server_fqdn}:5432/dripsign?sslmode=verify-full"
  }

  operator_secret_fields = {
    "staff-memberships" = "staff_memberships"
    "bridge-issuers"    = "bridge_issuers"
    "anthropic-api-key" = "anthropic_api_key"
    "host-event-url"    = "host_event_url"
    "host-event-secret" = "host_event_secret"
  }
}

resource "azapi_resource" "database_secret" {
  for_each = local.database_secret_names

  type      = "Microsoft.KeyVault/vaults/secrets@2024-11-01"
  name      = each.key
  parent_id = azurerm_key_vault.main.id

  body = {
    properties = {
      contentType = "text/plain"
      attributes  = { enabled = true }
    }
  }

  sensitive_body         = { properties = { value = local.database_secret_values[each.key] } }
  sensitive_body_version = { "properties.value" = tostring(var.db_credential_version) }
}

resource "azapi_resource" "auth_secret" {
  type      = "Microsoft.KeyVault/vaults/secrets@2024-11-01"
  name      = "auth-secret"
  parent_id = azurerm_key_vault.main.id

  body = {
    properties = {
      contentType = "text/plain"
      attributes  = { enabled = true }
    }
  }

  sensitive_body         = { properties = { value = ephemeral.random_password.auth_secret.result } }
  sensitive_body_version = { "properties.value" = tostring(var.auth_secret_version) }
}

resource "azapi_resource" "operator_secret" {
  for_each = local.operator_secret_fields

  type      = "Microsoft.KeyVault/vaults/secrets@2024-11-01"
  name      = each.key
  parent_id = azurerm_key_vault.main.id

  body = {
    properties = {
      contentType = "text/plain"
      attributes  = { enabled = true }
    }
  }

  sensitive_body         = var.operator_secrets == null ? null : { properties = { value = var.operator_secrets[each.value] } }
  sensitive_body_version = { "properties.value" = tostring(var.operator_secrets_version) }
}

locals {
  secret_ids = merge(
    { for name, secret in azapi_resource.database_secret : name => secret.id },
    { for name, secret in azapi_resource.operator_secret : name => secret.id },
    { "auth-secret" = azapi_resource.auth_secret.id },
  )

  secret_grants = flatten([
    for identity, secrets in local.readers : [for secret in secrets : { identity = identity, secret = secret }]
  ])
}

resource "azurerm_role_assignment" "secret" {
  for_each = { for grant in local.secret_grants : "${grant.identity}:${grant.secret}" => grant }

  scope                = local.secret_ids[each.value.secret]
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app[each.value.identity].principal_id
  principal_type       = "ServicePrincipal"
}
