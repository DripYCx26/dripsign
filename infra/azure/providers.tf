# One isolated DripSign deployment. Authentication is the operator's `az login` session or a CI
# identity's federated token; nothing here holds a credential.

provider "azurerm" {
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
  storage_use_azuread             = true

  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    postgresql_flexible_server {
      restart_server_on_configuration_value_change = true
    }
  }
}

# Secrets are written through the control plane (`sensitive_body`), so a vault whose data plane
# admits only the apps subnet still takes them from the operator, and no value enters state.
provider "azapi" {
  subscription_id = var.subscription_id
}

data "azurerm_client_config" "current" {}
