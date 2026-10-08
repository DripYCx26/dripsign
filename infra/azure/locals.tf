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

  # One identity per runtime. `release` runs the manual database, migration and staff jobs.
  identities = toset(["web", "jobs", "release"])

  # Which identity reads which secret; an app can hold no secret its row does not name.
  readers = {
    web     = ["database-url", "auth-secret", "staff-memberships", "bridge-issuers"]
    jobs    = ["database-url", "anthropic-api-key", "host-event-url", "host-event-secret"]
    release = ["database-admin-url", "database-app-password", "database-migrator-password", "migration-database-url", "database-url", "staff-memberships"]
  }

  # Environment variable to secret, per runtime.
  web_secret_env = {
    DRIPSIGN_DATABASE_URL      = "database-url"
    DRIPSIGN_AUTH_SECRET       = "auth-secret"
    DRIPSIGN_STAFF_MEMBERSHIPS = "staff-memberships"
    DRIPSIGN_BRIDGE_ISSUERS    = "bridge-issuers"
  }
  jobs_secret_env = {
    DRIPSIGN_DATABASE_URL      = "database-url"
    ANTHROPIC_API_KEY          = "anthropic-api-key"
    DRIPSIGN_HOST_EVENT_URL    = "host-event-url"
    DRIPSIGN_HOST_EVENT_SECRET = "host-event-secret"
  }

  # Provider selection and the non-secret settings both runtimes read.
  shared_env = {
    NODE_ENV                    = "production"
    DRIPSIGN_PUBLIC_ORIGIN      = local.public_origin
    DRIPSIGN_STORAGE_PROVIDER   = "azure"
    DRIPSIGN_BLOB_ENDPOINT      = trimsuffix(azurerm_storage_account.documents.primary_blob_endpoint, "/")
    DRIPSIGN_DOCUMENT_CONTAINER = azurerm_storage_container.documents.name
  }
  # The staff session bridge's public settings, when a host app frames the staff workspace.
  web_bridge_env = var.staff_bridge == null ? {} : {
    DRIPSIGN_BRIDGE_HOST_ORIGIN = var.staff_bridge.host_origin
    DRIPSIGN_BRIDGE_PUBLIC_KEY  = var.staff_bridge.public_key
  }
  # A test mailbox replaces sending entirely: messages land as files the test reads (variables.tf).
  jobs_env = var.test_mailbox == null ? {
    DRIPSIGN_MAIL_PROVIDER  = "azure"
    DRIPSIGN_EMAIL_ENDPOINT = "https://${azurerm_communication_service.main.hostname}"
    DRIPSIGN_EMAIL_FROM     = local.mail_sender
    } : {
    DRIPSIGN_MAIL_PROVIDER  = "directory"
    DRIPSIGN_MAIL_DIRECTORY = local.test_mailbox_path
    DRIPSIGN_EMAIL_FROM     = local.mail_sender
  }

  # The mailbox mount: private to the image's user (node, uid 1000), as the directory adapter expects.
  test_mailbox_path    = "/mail"
  test_mailbox_options = "dir_mode=0700,file_mode=0600,uid=1000,gid=1000"
}
