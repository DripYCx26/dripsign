# The Container Apps environment, one identity per runtime, the web and jobs apps, and the manual
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
        for_each = merge(local.shared_env, local.web_bridge_env, { PORT = "3000", AZURE_CLIENT_ID = azurerm_user_assigned_identity.app["web"].client_id })

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.web_secret_env

        content {
          name        = env.key
          secret_name = env.value
        }
      }

      readiness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/health"
      }
    }
  }

  depends_on = [azurerm_role_assignment.secret, azurerm_role_assignment.documents, azurerm_role_assignment.pull]
}

resource "azurerm_container_app" "jobs" {
  count = var.jobs_replicas > 0 ? 1 : 0

  name                         = "${var.name}-jobs"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app["jobs"].id]
  }

  dynamic "registry" {
    for_each = var.registry == null ? [] : [var.registry]

    content {
      server   = registry.value.server
      identity = azurerm_user_assigned_identity.app["jobs"].id
    }
  }

  dynamic "secret" {
    for_each = toset(local.readers.jobs)

    content {
      name                = secret.key
      key_vault_secret_id = "${azurerm_key_vault.main.vault_uri}secrets/${secret.key}"
      identity            = azurerm_user_assigned_identity.app["jobs"].id
    }
  }

  template {
    min_replicas = var.jobs_replicas
    max_replicas = var.jobs_replicas

    # The worker drains in-flight jobs on SIGTERM; leases recover anything cut short.
    termination_grace_period_seconds = 60

    container {
      name    = "jobs"
      image   = var.image
      command = ["pnpm"]
      args    = ["--filter", "@dripsign/jobs", "start"]
      cpu     = 0.5
      memory  = "1Gi"

      dynamic "env" {
        for_each = merge(local.shared_env, local.jobs_env, { AZURE_CLIENT_ID = azurerm_user_assigned_identity.app["jobs"].client_id })

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.jobs_secret_env

        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  depends_on = [azurerm_role_assignment.secret, azurerm_role_assignment.documents, azurerm_role_assignment.jobs_mail, azurerm_role_assignment.pull]
}

# Release jobs run only when the operator starts them (`az containerapp job start`), inside the
# VNet that alone reaches the database, under the `release` identity.
locals {
  release_jobs = {
    # Creates the roles and the database once (infra/database.sql), then sets both login
    # passwords from the vault; rerun it after bumping db_credential_version.
    database = {
      secrets = { ADMIN_URL = "database-admin-url", APP_PASSWORD = "database-app-password", MIGRATOR_PASSWORD = "database-migrator-password" }
      env = {
        BOOTSTRAP_SQL = file("${path.module}/../database.sql")
        # PostgreSQL 16 and later grant a role's creator only ADMIN by default; the bootstrap also
        # needs SET and INHERIT on dripsign_owner to create its database and revoke on its schema.
        PGOPTIONS = "-c createrole_self_grant=set,inherit"
      }
      init    = null
      command = <<-EOT
        set -eu
        if [ "$(psql "$ADMIN_URL" -XAtc "SELECT 1 FROM pg_roles WHERE rolname = 'dripsign_owner'")" != "1" ]; then
          printf '%s\n' "$BOOTSTRAP_SQL" | psql "$ADMIN_URL" -X --quiet -f -
        fi
        psql "$ADMIN_URL" -X --quiet -v ON_ERROR_STOP=1 -v app="$APP_PASSWORD" -v migrator="$MIGRATOR_PASSWORD" -f - <<'SQL'
        ALTER ROLE dripsign_app PASSWORD :'app';
        ALTER ROLE dripsign_migrator PASSWORD :'migrator';
        SQL
      EOT
    }
    # Applies migrations with the owner-capable login, then revokes the runtime's ledger access
    # (infra/aws/README.md, migration identity and ledger).
    migrate = {
      secrets = { DRIPSIGN_MIGRATION_DATABASE_URL = "migration-database-url" }
      env     = {}
      init    = ["--filter", "@dripsign/db", "migrate"]
      command = <<-EOT
        set -eu
        psql "$${DRIPSIGN_MIGRATION_DATABASE_URL%%\?*}?sslmode=require" -X --quiet -v ON_ERROR_STOP=1 \
          -c 'SET ROLE dripsign_owner' \
          -c 'REVOKE ALL PRIVILEGES ON TABLE dripsign.schema_migration FROM PUBLIC, dripsign_app'
      EOT
    }
    # Records the configured staff memberships; it sends no email.
    staff = {
      secrets = { DRIPSIGN_DATABASE_URL = "database-url", DRIPSIGN_STAFF_MEMBERSHIPS = "staff-memberships" }
      env     = {}
      init    = null
      command = null
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
    dynamic "init_container" {
      for_each = each.value.init == null ? [] : [each.value.init]

      content {
        name    = "dripsign"
        image   = var.image
        command = ["pnpm"]
        args    = init_container.value
        cpu     = 0.5
        memory  = "1Gi"

        dynamic "env" {
          for_each = each.value.secrets

          content {
            name        = env.key
            secret_name = env.value
          }
        }
      }
    }

    container {
      name    = each.key
      image   = each.value.command == null ? var.image : var.postgres_client_image
      command = each.value.command == null ? ["pnpm"] : ["/bin/sh", "-c"]
      args    = each.value.command == null ? ["--filter", "@dripsign/db", "bootstrap-staff"] : [each.value.command]
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
