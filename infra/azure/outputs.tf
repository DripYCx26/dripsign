output "public_origin" {
  description = "DRIPSIGN_PUBLIC_ORIGIN as the apps receive it."
  value       = local.public_origin
}

output "front_door_endpoint_host" {
  description = "The Front Door endpoint; the custom host's CNAME points here."
  value       = azurerm_cdn_frontdoor_endpoint.main.host_name
}

output "dns_records" {
  description = "Every record the operator writes: the host's CNAME and `_dnsauth` TXT, and the mail domain's verification records."
  value = {
    host = var.host == null ? null : {
      cname       = { name = var.host, value = azurerm_cdn_frontdoor_endpoint.main.host_name }
      dnsauth_txt = { name = "_dnsauth.${var.host}", value = azurerm_cdn_frontdoor_custom_domain.host[0].validation_token }
    }
    mail = var.mail_domain == null ? null : azurerm_email_communication_service_domain.sender.verification_records
  }
}

output "egress_ip" {
  description = "The one address outbound traffic leaves from; what a host allowlists for executed events."
  value       = azurerm_public_ip.egress.ip_address
}

output "mail_sender" {
  description = "DRIPSIGN_EMAIL_FROM as the jobs app receives it."
  value       = local.mail_sender
}

output "key_vault_id" {
  description = "The app secret vault."
  value       = azurerm_key_vault.main.id
}

output "documents_account" {
  description = "The document storage account."
  value       = azurerm_storage_account.documents.name
}

output "database_server_fqdn" {
  description = "The database host; resolves only inside the VNet."
  value       = local.server_fqdn
}

output "release_jobs" {
  description = "Manual jobs, started with `az containerapp job start --resource-group <name> --name <job>`."
  value       = { for name, job in azurerm_container_app_job.release : name => job.name }
}
