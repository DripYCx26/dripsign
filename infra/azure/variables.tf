variable "subscription_id" {
  description = "The subscription that holds this deployment."
  type        = string
}

variable "location" {
  description = "The Azure region, for example westus3."
  type        = string
}

variable "name" {
  description = "The deployment name: the resource group and the prefix of every resource, for example dripsign-staging."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,22}[a-z0-9]$", var.name))
    error_message = "Four to twenty-four lowercase letters, digits and hyphens."
  }
}

variable "code" {
  description = "A short code inside globally unique names (storage account, Key Vault): two to five lowercase alphanumerics."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{2,5}$", var.code))
    error_message = "Two to five lowercase alphanumerics."
  }
}

variable "address_space" {
  description = "The deployment's private /16; never peered."
  type        = string
  default     = "10.80.0.0/16"

  validation {
    condition     = can(cidrhost(var.address_space, 0)) && endswith(var.address_space, "/16")
    error_message = "An IPv4 /16."
  }
}

variable "image" {
  description = "The DripSign web and jobs image, pinned by digest."
  type        = string

  validation {
    condition     = can(regex("^[^@[:space:]]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "An image reference ending in @sha256:<digest>."
  }
}

variable "postgres_client_image" {
  description = "A PostgreSQL 18 client image (psql) for the release jobs, pinned by digest."
  type        = string

  validation {
    condition     = can(regex("^[^@[:space:]]+@sha256:[a-f0-9]{64}$", var.postgres_client_image))
    error_message = "An image reference ending in @sha256:<digest>."
  }
}

variable "registry" {
  description = "A private Azure Container Registry the images come from, pulled with each app's identity; null pulls anonymously."
  type = object({
    server = string
    id     = string
  })
  default = null
}

variable "host" {
  description = "The public host, for example sign.example.com; null serves on the Front Door endpoint host until a domain is chosen."
  type        = string
  default     = null

  validation {
    condition     = var.host == null || can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.host))
    error_message = "A lowercase DNS name."
  }
}

variable "mail_domain" {
  description = "The sending domain: null uses the Azure-managed domain (trial volume only); a domain the operator controls needs its verification, SPF and DKIM records."
  type        = string
  default     = null
}

variable "mail_data_location" {
  description = "Where Communication Services stores mail data at rest."
  type        = string
  default     = "United States"
}

variable "web_replicas" {
  description = "Web replicas. Zero creates no web app, so nothing serves before the database is prepared."
  type        = number
  default     = 0

  validation {
    condition     = var.web_replicas >= 0 && var.web_replicas <= 10 && floor(var.web_replicas) == var.web_replicas
    error_message = "An integer from 0 to 10."
  }
}

variable "jobs_replicas" {
  description = "Jobs replicas. Zero creates no jobs app; durable admission in the database bounds the work across replicas."
  type        = number
  default     = 0

  validation {
    condition     = var.jobs_replicas >= 0 && var.jobs_replicas <= 4 && floor(var.jobs_replicas) == var.jobs_replicas
    error_message = "An integer from 0 to 4."
  }
}

variable "db_sku" {
  description = "Flexible Server compute, for example B_Standard_B1ms (trial) or GP_Standard_D2ds_v5."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "db_storage_mb" {
  description = "Provisioned storage in MiB; autogrow raises it."
  type        = number
  default     = 32768
}

variable "db_backup_days" {
  description = "Point-in-time restore window in days, 7 to 35."
  type        = number
  default     = 35
}

variable "db_geo_backup" {
  description = "Geo-redundant backup in the paired region; settable only when the server is created."
  type        = bool
  default     = false
}

variable "db_credential_version" {
  description = "Bumping it generates new administrator and login passwords and rewrites their secrets; then run the database job."
  type        = number
  default     = 1
}

variable "auth_secret_version" {
  description = "Bumping it generates a new session signing secret; every session ends."
  type        = number
  default     = 1
}

variable "storage_replication" {
  description = "Document account replication: ZRS where the region offers zones, LRS otherwise, GZRS for a second region."
  type        = string
  default     = "ZRS"
}

variable "log_retention_days" {
  description = "Log Analytics retention for app output, vault audit and storage access logs."
  type        = number
  default     = 30
}

variable "operator_secrets" {
  description = "Values only the operator holds. Supply them on the first apply and whenever operator_secrets_version changes; they are written once through the control plane and never stored in state."
  type = object({
    staff_memberships = string
    bridge_issuers    = string
    anthropic_api_key = string
    host_event_url    = string
    host_event_secret = string
  })
  default   = null
  ephemeral = true
  sensitive = true
}

variable "operator_secrets_version" {
  description = "Bumping it rewrites every operator secret from operator_secrets."
  type        = number
  default     = 1
}

variable "test_mailbox" {
  description = "Test environments only: the name of a Container Apps environment storage (an Azure Files share) that the jobs app writes every message into as an .eml file instead of sending it, so an automated test can read sign-in codes. While it is set, nothing is sent. Never set it in production."
  type        = string
  default     = null
}
