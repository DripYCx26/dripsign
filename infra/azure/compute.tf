# The Container Apps environment, one identity per runtime, the web and worker apps, and the manual
# release jobs. Every secret is a Key Vault reference read with the runtime's own identity.

resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.name}-logs"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
}

resource "azurerm_container_app_environment" "main" {
  name                = "cae-${var.name}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name

  logs_destination                   = "log-analytics"
  log_analytics_workspace_id         = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id           = azurerm_subnet.apps.id
  infrastructure_resource_group_name = "${var.name}-managed"
  internal_load_balancer_enabled     = false

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  depends_on = [azurerm_subnet_nat_gateway_association.apps]
}

resource "azurerm_user_assigned_identity" "app" {
  for_each = local.identities

  name                = "${var.name}-${each.key}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_role_assignment" "pull" {
  for_each = var.registry == null ? toset([]) : local.identities

  scope                = var.registry.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app[each.key].principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_container_app" "web" {
  count = var.web_replicas > 0 ? 1 : 0

  name                         = "${var.name}-web"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app["web"].id]
  }

  dynamic "registry" {
    for_each = var.registry == null ? [] : [var.registry]

    content {
      server   = registry.value.server
      identity = azurerm_user_assigned_identity.app["web"].id
    }
  }

  dynamic "secret" {
    for_each = toset(local.readers.web)

    content {
      name                = secret.key
      key_vault_secret_id = "${azurerm_key_vault.main.vault_uri}secrets/${secret.key}"
      identity            = azurerm_user_assigned_identity.app["web"].id
    }
  }

  ingress {
    external_enabled           = true
    target_port                = 3000
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.web_replicas
    max_replicas = var.web_replicas

    container {
      name    = "web"
      image   = var.image
      command = ["pnpm"]
      args    = ["--filter", "@dripsign/web", "start"]
      cpu     = 0.5
      memory  = "1Gi"

      dynamic "env" {
        for_each = merge(local.web_env, { AZURE_CLIENT_ID = azurerm_user_assigned_identity.app["web"].client_id })

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.app_secret_env

        content {
          name        = env.key
          secret_name = env.value
        }
      }

      readiness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/api/health"
      }
    }
  }

  depends_on = [azurerm_role_assignment.secret, azurerm_role_assignment.documents, azurerm_role_assignment.pull]
}

resource "azurerm_container_app" "worker" {
  count = var.worker_replicas > 0 ? 1 : 0

  name                         = "${var.name}-worker"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app["worker"].id]
  }

  dynamic "registry" {
    for_each = var.registry == null ? [] : [var.registry]

    content {
      server   = registry.value.server
      identity = azurerm_user_assigned_identity.app["worker"].id
    }
  }

  dynamic "secret" {
    for_each = toset(local.readers.worker)

    content {
      name                = secret.key
      key_vault_secret_id = "${azurerm_key_vault.main.vault_uri}secrets/${secret.key}"
      identity            = azurerm_user_assigned_identity.app["worker"].id
    }
  }

  template {
    min_replicas = var.worker_replicas
    max_replicas = var.worker_replicas

    # The worker drains in-flight jobs on SIGTERM (25 s bound); leases recover anything cut short.
    termination_grace_period_seconds = 60

    container {
      name    = "worker"
      image   = var.image
      command = ["pnpm"]
      args    = ["--filter", "@dripsign/core", "worker"]
      cpu     = 0.5
      memory  = "1Gi"

      dynamic "env" {
        for_each = merge(local.worker_env, { AZURE_CLIENT_ID = azurerm_user_assigned_identity.app["worker"].client_id })

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.app_secret_env

        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  depends_on = [azurerm_role_assignment.secret, azurerm_role_assignment.documents, azurerm_role_assignment.worker_mail, azurerm_role_assignment.pull]
}

# Release jobs run only when the operator starts them (`az containerapp job start`), inside the
# VNet that alone reaches the database, under the `release` identity.
locals {
  # The DripSign image parses the whole production configuration even for the CLI, so its jobs
  # take the shared settings and the session secret beside their database URL.
  release_jobs = {
    # Creates the roles and the database once (infra/database.sql), then sets both login
    # passwords from the vault; rerun it after bumping db_credential_version.
    database = {
      image   = var.postgres_client_image
      command = ["/bin/sh", "-c"]
      args = [<<-EOT
        set -eu
        if [ "$(psql "$ADMIN_URL" -XAtc "SELECT 1 FROM pg_roles WHERE rolname = 'dripsign_migrator'")" != "1" ]; then
          printf '%s\n' "$BOOTSTRAP_SQL" | psql "$ADMIN_URL" -X --quiet -f -
        fi
        psql "$ADMIN_URL" -X --quiet -v ON_ERROR_STOP=1 -v app="$APP_PASSWORD" -v migrator="$MIGRATOR_PASSWORD" -f - <<'SQL'
        ALTER ROLE dripsign_app PASSWORD :'app';
        ALTER ROLE dripsign_migrator PASSWORD :'migrator';
        SQL
      EOT
      ]
      secrets = { ADMIN_URL = "database-admin-url", APP_PASSWORD = "database-app-password", MIGRATOR_PASSWORD = "database-migrator-password" }
      env = {
        BOOTSTRAP_SQL = file("${path.module}/../database.sql")
        # PostgreSQL 16 and later grant a role's creator only ADMIN by default; the bootstrap also
        # needs SET and INHERIT on dripsign_migrator to make it the database owner.
        PGOPTIONS = "-c createrole_self_grant=set,inherit"
      }
    }
    # Applies schema.sql as the database owner; a current schema is a no-op, a stale one fails.
    migrate = {
      image   = var.image
      command = ["pnpm"]
      args    = ["--filter", "@dripsign/core", "cli", "migrate"]
      secrets = { DRIPSIGN_DATABASE_URL = "migration-database-url", DRIPSIGN_AUTH_SECRET = "auth-secret" }
      env     = merge(local.shared_env, { AZURE_CLIENT_ID = azurerm_user_assigned_identity.app["release"].client_id })
    }
    # Adds one staff member; start it with the person's arguments (README: Commands).
    staff = {
      image   = var.image
      command = ["pnpm"]
      args    = ["--filter", "@dripsign/core", "cli", "add-staff"]
      secrets = { DRIPSIGN_DATABASE_URL = "database-url", DRIPSIGN_AUTH_SECRET = "auth-secret" }
      env     = merge(local.shared_env, { AZURE_CLIENT_ID = azurerm_user_assigned_identity.app["release"].client_id })
    }
  }
}

resource "azurerm_container_app_job" "release" {
  for_each = local.release_jobs

  name                         = "${var.name}-${each.key}"
  location                     = var.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 900
  replica_retry_limit          = 0

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app["release"].id]
  }

  dynamic "registry" {
    for_each = var.registry == null ? [] : [var.registry]

    content {
      server   = registry.value.server
      identity = azurerm_user_assigned_identity.app["release"].id
    }
  }

  dynamic "secret" {
    for_each = toset(values(each.value.secrets))

    content {
      name                = secret.key
      key_vault_secret_id = "${azurerm_key_vault.main.vault_uri}secrets/${secret.key}"
      identity            = azurerm_user_assigned_identity.app["release"].id
    }
  }

  template {
    container {
      name    = each.key
      image   = each.value.image
      command = each.value.command
      args    = each.value.args
      cpu     = 0.5
      memory  = "1Gi"

      dynamic "env" {
        for_each = each.value.env

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = each.value.secrets

        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  depends_on = [azurerm_role_assignment.secret, azurerm_role_assignment.pull]
}
