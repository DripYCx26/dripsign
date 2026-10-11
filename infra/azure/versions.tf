terraform {
  required_version = "= 1.16.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 5.8.0"
    }
    azapi = {
      source  = "Azure/azapi"
      version = "= 2.13.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.9.1"
    }
  }

  # Partial configuration: the operator's state account, container and key go in a private
  # backend file passed to `terraform init -backend-config=<file>`.
  backend "azurerm" {}
}
