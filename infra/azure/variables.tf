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
  description = "The DripSign image, run as the web and as the worker, pinned by digest."
  type        = string

  validation {
    condition     = can(regex("^[^@[:space:]]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "An image reference ending in @sha256:<digest>."
  }
}

variable "postgres_client_image" {
  description = "A PostgreSQL 18 client image (psql) for the database job, pinned by digest."
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

variable "worker_replicas" {
  description = "Worker replicas. Zero creates no worker app. The outbox leases jobs in the database, so replicas share the work."
  type        = number
  default     = 0

  validation {
    condition     = var.worker_replicas >= 0 && var.worker_replicas <= 4 && floor(var.worker_replicas) == var.worker_replicas
    error_message = "An integer from 0 to 4."
  }
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

variable "trusted_proxy_hops" {
  description = "How many proxies append to X-Forwarded-For before the web app: Front Door and the Container Apps ingress make two. Verify it after the first deployment; a wrong value lets a caller pick the address the rate limits see."
  type        = number
  default     = 2

  validation {
    condition     = var.trusted_proxy_hops >= 0 && var.trusted_proxy_hops <= 10 && floor(var.trusted_proxy_hops) == var.trusted_proxy_hops
    error_message = "An integer from 0 to 10."
  }
}

variable "ai_enabled" {
  description = "Create the Anthropic API key secret and give it to the web and worker; supply the key in operator_secrets. Off hides the drafting assistant."
  type        = bool
  default     = false
}

variable "host_integration" {
  description = "The DRIPSIGN_HOST value for a Dreach host app: its origin, the entry assertion issuer, audience and public keys, and the firm-to-tenant map. All public; null turns the bridge entry off."
  type = object({
    origin = string
    entry = object({
      issuer   = string
      audience = string
      keys     = list(object({ kid = string, publicKey = string }))
    })
    tenants = list(object({ firm = string, tenantId = string }))
  })
  default = null
}

variable "operator_secrets" {
  description = "Values only the operator holds, needed for the features that are on: anthropic_api_key with ai_enabled. They are written once through the control plane and never stored in state."
  type = object({
    anthropic_api_key = optional(string)
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
