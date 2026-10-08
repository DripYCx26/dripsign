# Signed documents and their evidence: one private container of content-addressed block blobs.
# Entra-only authorization, reachable only from the apps subnet, versioned, soft-deleted.

resource "azurerm_storage_account" "documents" {
  name                = "ds${var.code}docs${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location

  account_kind             = "StorageV2"
  account_tier             = "Standard"
  account_replication_type = var.storage_replication
  access_tier              = "Hot"

  https_traffic_only_enabled        = true
  min_tls_version                   = "TLS1_2"
  shared_access_key_enabled         = false
  default_to_oauth_authentication   = true
  allow_nested_items_to_be_public   = false
  cross_tenant_replication_enabled  = false
  infrastructure_encryption_enabled = true
  is_hns_enabled                    = false

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 35
    }

    container_delete_retention_policy {
      days = 35
    }
  }

  network_rules {
    default_action             = "Deny"
    bypass                     = ["None"]
    virtual_network_subnet_ids = [azurerm_subnet.apps.id]
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "documents" {
  name                  = "documents"
  storage_account_id    = azurerm_storage_account.documents.id
  container_access_type = "private"
}

resource "azurerm_management_lock" "documents" {
  name       = "documents-cannot-delete"
  scope      = azurerm_storage_account.documents.id
  lock_level = "CanNotDelete"
  notes      = "Signed documents and audit records."
}

# Read and create only: no overwrite (`blobs/write`) and no delete. The application's
# content-addressed keys and `If-None-Match: *` already never replace an object; this makes the
# service refuse it too.
resource "azurerm_role_definition" "documents" {
  name        = "${var.name} document reader and creator"
  scope       = azurerm_resource_group.main.id
  description = "Read blobs and create new blobs; never overwrite or delete."

  permissions {
    data_actions = [
      "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read",
      "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action",
    ]
  }

  assignable_scopes = [azurerm_resource_group.main.id]
}

resource "azurerm_role_assignment" "documents" {
  for_each = toset(["web", "jobs"])

  scope              = "${azurerm_storage_account.documents.id}/blobServices/default/containers/${azurerm_storage_container.documents.name}"
  role_definition_id = azurerm_role_definition.documents.role_definition_resource_id
  principal_id       = azurerm_user_assigned_identity.app[each.key].principal_id
  principal_type     = "ServicePrincipal"
}

resource "azurerm_monitor_diagnostic_setting" "documents" {
  name                       = "access"
  target_resource_id         = "${azurerm_storage_account.documents.id}/blobServices/default"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "StorageRead"
  }

  enabled_log {
    category = "StorageWrite"
  }

  enabled_log {
    category = "StorageDelete"
  }
}
