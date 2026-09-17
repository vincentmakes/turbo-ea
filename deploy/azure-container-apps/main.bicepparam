// Parameters for main.bicep. Secrets are read from the environment so they
// never sit in a file:
//   export TURBO_EA_SECRET_KEY="$(openssl rand -base64 48)"
//   export TURBO_EA_POSTGRES_PASSWORD='…'
//   export TURBO_EA_STORAGE_KEY="$(az storage account keys list -n <account> --query '[0].value' -o tsv)"
//   az deployment group create -g <rg> -f main.bicep -p main.bicepparam
using 'main.bicep'

param name = 'turbo-ea'
param publicUrl = 'https://ea.example.com'
param imageTag = '2.141.0'

param postgresHost = 'turbo-ea.postgres.database.azure.com'
param postgresDatabase = 'turboea'
param postgresUser = 'turboea'
param postgresPassword = readEnvironmentVariable('TURBO_EA_POSTGRES_PASSWORD', '')
param secretKey = readEnvironmentVariable('TURBO_EA_SECRET_KEY', '')

param storageAccountName = 'turboeadata'
param storageAccountKey = readEnvironmentVariable('TURBO_EA_STORAGE_KEY', '')
param fileShareName = 'turbo-ea-data'

// Resource ID of the /27 subnet delegated to Microsoft.App/environments, or ''.
param infrastructureSubnetId = ''

param deployMcp = false
