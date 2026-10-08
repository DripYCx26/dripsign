# Communication Services Email. With no `mail_domain` it sends from the Azure-managed domain, whose
# low volume suits a trial; a domain the operator controls needs the records `dns_records` names.

resource "azurerm_email_communication_service" "main" {
  name                = "${var.name}-email"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = var.mail_data_location
}

resource "azurerm_email_communication_service_domain" "sender" {
  name             = var.mail_domain == null ? "AzureManagedDomain" : var.mail_domain
  email_service_id = azurerm_email_communication_service.main.id

  domain_management                = var.mail_domain == null ? "AzureManaged" : "CustomerManaged"
  user_engagement_tracking_enabled = false
}

resource "azurerm_communication_service" "main" {
  name                = "${var.name}-comms"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = var.mail_data_location
}

resource "azurerm_communication_service_email_domain_association" "sender" {
  communication_service_id = azurerm_communication_service.main.id
  email_service_domain_id  = azurerm_email_communication_service_domain.sender.id
}

locals {
  mail_sender = "DoNotReply@${azurerm_email_communication_service_domain.sender.mail_from_sender_domain}"
}

# Sending with a managed identity needs a write role on the Communication Services resource. No
# narrower built-in role is documented, so the grant is Contributor on this one resource, for the
# jobs identity alone.
resource "azurerm_role_assignment" "jobs_mail" {
  scope                = azurerm_communication_service.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.app["jobs"].principal_id
  principal_type       = "ServicePrincipal"
}
