resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

locals {
  suffix = random_string.suffix.result

  apps_prefix = cidrsubnet(var.address_space, 7, 0) # .0.0/23: Container Apps infrastructure
  data_prefix = cidrsubnet(var.address_space, 8, 2) # .2.0/24: Flexible Server private access

  server_name = "${var.name}-pg"
  server_fqdn = "${local.server_name}.postgres.database.azure.com"

  public_host   = var.host == null ? azurerm_cdn_frontdoor_endpoint.main.host_name : var.host
  public_origin = "https://${local.public_host}"

  # One identity per runtime. `release` runs the manual database, migrate and staff jobs.
  identities = toset(["web", "worker", "release"])

  # Operator secrets exist only for the features that are switched on.
  ai_enabled                = var.ai_enabled
  completion_export_enabled = var.host_event_url != null

  # Which identity reads which secret; an app can hold no secret its row does not name.
  readers = {
    web = concat(
      ["database-url", "auth-secret"],
      local.ai_enabled ? ["anthropic-api-key"] : [],
    )
    worker = concat(
      ["database-url", "auth-secret"],
      local.ai_enabled ? ["anthropic-api-key"] : [],
      local.completion_export_enabled ? ["completion-keys"] : [],
    )
    release = ["database-admin-url", "database-app-password", "database-migrator-password", "migration-database-url", "database-url", "auth-secret"]
  }

  # Environment variable to secret, per runtime.
  ai_secret_env = local.ai_enabled ? { DRIPSIGN_ANTHROPIC_API_KEY = "anthropic-api-key" } : {}
  web_secret_env = merge(
    {
      DRIPSIGN_DATABASE_URL = "database-url"
      DRIPSIGN_AUTH_SECRET  = "auth-secret"
    },
    local.ai_secret_env,
  )
  worker_secret_env = merge(
    {
      DRIPSIGN_DATABASE_URL = "database-url"
      DRIPSIGN_AUTH_SECRET  = "auth-secret"
    },
    local.ai_secret_env,
    local.completion_export_enabled ? { DRIPSIGN_COMPLETION_KEYS = "completion-keys" } : {},
  )

  # What every process parses at startup (packages/core/src/config.ts); the web and the worker
  # also receive the identity variable Container Apps resolves for them.
  shared_env = {
    NODE_ENV                      = "production"
    DRIPSIGN_PUBLIC_ORIGIN        = local.public_origin
    DRIPSIGN_TRUSTED_PROXY_HOPS   = tostring(var.trusted_proxy_hops)
    DRIPSIGN_STORAGE              = "azure"
    DRIPSIGN_AZURE_BLOB_ENDPOINT  = trimsuffix(azurerm_storage_account.documents.primary_blob_endpoint, "/")
    DRIPSIGN_AZURE_BLOB_CONTAINER = azurerm_storage_container.documents.name
    DRIPSIGN_EMAIL_TRANSPORT      = "azure"
    DRIPSIGN_AZURE_EMAIL_ENDPOINT = "https://${azurerm_communication_service.main.hostname}"
    DRIPSIGN_EMAIL_FROM           = local.mail_sender
  }

  # The Dreach host integration: public settings, so a plain value. Off while null.
  host_env = var.host_integration == null ? {} : { DRIPSIGN_HOST = jsonencode(var.host_integration) }

  # The executed-event destination belongs to the worker, which delivers it.
  worker_env = merge(
    local.shared_env,
    local.host_env,
    local.completion_export_enabled ? { DRIPSIGN_HOST_EVENT_URL = var.host_event_url } : {},
  )
  web_env = merge(local.shared_env, local.host_env, { PORT = "3000" })
}
