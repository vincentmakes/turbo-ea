// Turbo EA on Azure Container Apps + Azure Database for PostgreSQL Flexible Server.
// Guide: https://docs.turbo-ea.org/admin/managed-containers/#azure-container-apps
//
// One container app runs the whole stack as sidecars sharing localhost: the edge
// nginx (ingress, port 8920) in front of the frontend (8080), the backend (8000)
// and the optional MCP server (8001). The backend is ONE replica, never scaled
// and never scaled to zero (minReplicas = maxReplicas = 1): it holds in-process
// state and runs migrations at boot. During an update Container Apps briefly
// runs the old and the new replica side by side; the backend's PostgreSQL
// advisory lock keeps the two from migrating at once.
//
// Prerequisites (created outside this template): a Flexible Server reachable
// from the environment (private access in the same VNet, or a private endpoint),
// a storage account with a file share for /app/data, and — optionally — a
// subnet (/27, delegated to Microsoft.App/environments) for VNet integration.
//
//   az deployment group create -g <rg> -f main.bicep -p main.bicepparam

targetScope = 'resourceGroup'

@description('Name prefix for every resource.')
param name string = 'turbo-ea'

param location string = resourceGroup().location

@description('Public origin users open, e.g. https://ea.example.com — no path, no trailing slash. Use the default FQDN output on the first deploy, then switch to the custom domain.')
param publicUrl string

@description('Turbo EA release to run; chart, images and docs share one version number.')
param imageTag string

param imageRepository string = 'ghcr.io/vincentmakes/turbo-ea'

param postgresHost string
param postgresPort int = 5432
param postgresDatabase string = 'turboea'
param postgresUser string = 'turboea'

@secure()
param postgresPassword string

@description('HMAC + Fernet key. Generate with: openssl rand -base64 48. Losing it invalidates every session and encrypted setting.')
@secure()
param secretKey string

@description('Storage account holding the file share mounted at /app/data.')
param storageAccountName string

@secure()
param storageAccountKey string

param fileShareName string = 'turbo-ea-data'

@description('Resource ID of a /27 subnet delegated to Microsoft.App/environments. Empty = no VNet integration (the database must then be publicly reachable).')
param infrastructureSubnetId string = ''

@description('Also run the MCP server at <publicUrl>/mcp.')
param deployMcp bool = false

@description('Comma-separated CORS allow-list; empty = the origin of publicUrl.')
param allowedOrigins string = ''

@description('Sites allowed to embed published diagrams, comma-separated.')
param embedAllowedOrigins string = ''

param logRetentionDays int = 30

var mcpPublicUrl = '${publicUrl}/mcp'

var backendContainer = {
  name: 'backend'
  image: '${imageRepository}/backend:${imageTag}'
  resources: {
    cpu: json('1.0')
    memory: '2Gi'
  }
  env: [
    { name: 'POSTGRES_HOST', value: postgresHost }
    { name: 'POSTGRES_PORT', value: string(postgresPort) }
    { name: 'POSTGRES_DB', value: postgresDatabase }
    { name: 'POSTGRES_USER', value: postgresUser }
    { name: 'POSTGRES_PASSWORD', secretRef: 'postgres-password' }
    { name: 'SECRET_KEY', secretRef: 'secret-key' }
    { name: 'ENVIRONMENT', value: 'production' }
    { name: 'ALLOWED_ORIGINS', value: empty(allowedOrigins) ? publicUrl : allowedOrigins }
    { name: 'DB_POOL_SIZE', value: '10' }
    { name: 'DB_MAX_OVERFLOW', value: '5' }
    { name: 'SEED_DEMO', value: 'false' }
    { name: 'HOME', value: '/tmp' }
    { name: 'PYTHONDONTWRITEBYTECODE', value: '1' }
  ]
  volumeMounts: [
    { volumeName: 'data', mountPath: '/app/data' }
  ]
  probes: [
    {
      // Migrations and seeding run before /api/health answers. Container Apps
      // caps failureThreshold at 10, so a 30 s period gives a 5-minute budget.
      type: 'Startup'
      httpGet: { path: '/api/health', port: 8000 }
      periodSeconds: 30
      failureThreshold: 10
      timeoutSeconds: 5
    }
    {
      type: 'Readiness'
      httpGet: { path: '/api/health', port: 8000 }
      periodSeconds: 10
      failureThreshold: 3
    }
    {
      type: 'Liveness'
      httpGet: { path: '/api/health', port: 8000 }
      periodSeconds: 30
      failureThreshold: 3
    }
  ]
}

var frontendContainer = {
  name: 'frontend'
  image: '${imageRepository}/frontend:${imageTag}'
  resources: {
    cpu: json('0.25')
    memory: '0.5Gi'
  }
  probes: [
    { type: 'Startup', tcpSocket: { port: 8080 }, periodSeconds: 5, failureThreshold: 10 }
    { type: 'Liveness', tcpSocket: { port: 8080 }, periodSeconds: 30, failureThreshold: 3 }
  ]
}

var nginxContainer = {
  name: 'nginx'
  image: '${imageRepository}/nginx:${imageTag}'
  resources: {
    cpu: json('0.25')
    memory: '0.5Gi'
  }
  env: [
    { name: 'TURBO_EA_PUBLIC_URL', value: publicUrl }
    // TLS terminates on the Container Apps ingress; the https:// public URL is
    // what marks the session cookie secure.
    { name: 'TURBO_EA_TLS_ENABLED', value: 'false' }
    { name: 'TURBO_EA_EMBED_ALLOWED_ORIGINS', value: embedAllowedOrigins }
    // The frontend sidecar owns 8080 on this replica, so the edge listens on 8920.
    { name: 'NGINX_HTTP_PORT', value: '8920' }
    { name: 'NGINX_BACKEND_UPSTREAM', value: 'http://127.0.0.1:8000' }
    { name: 'NGINX_FRONTEND_UPSTREAM', value: 'http://127.0.0.1:8080' }
    { name: 'NGINX_MCP_UPSTREAM', value: 'http://127.0.0.1:8001' }
  ]
  probes: [
    // Through the proxy to the backend, so "ready" means the app answers.
    { type: 'Startup', httpGet: { path: '/api/health', port: 8920 }, periodSeconds: 30, failureThreshold: 10 }
    { type: 'Readiness', httpGet: { path: '/api/health', port: 8920 }, periodSeconds: 10, failureThreshold: 3 }
    { type: 'Liveness', tcpSocket: { port: 8920 }, periodSeconds: 30, failureThreshold: 3 }
  ]
}

var mcpContainer = {
  name: 'mcp-server'
  image: '${imageRepository}/mcp-server:${imageTag}'
  resources: {
    cpu: json('0.5')
    memory: '1Gi'
  }
  env: [
    { name: 'TURBO_EA_URL', value: 'http://127.0.0.1:8000' }
    { name: 'TURBO_EA_PUBLIC_URL', value: publicUrl }
    { name: 'MCP_PUBLIC_URL', value: mcpPublicUrl }
    { name: 'MCP_PORT', value: '8001' }
    { name: 'HOME', value: '/tmp' }
  ]
  probes: [
    { type: 'Startup', httpGet: { path: '/health', port: 8001 }, periodSeconds: 5, failureThreshold: 10 }
    { type: 'Liveness', httpGet: { path: '/health', port: 8001 }, periodSeconds: 30, failureThreshold: 3 }
  ]
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
  }
}

resource env 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
    vnetConfiguration: empty(infrastructureSubnetId) ? null : {
      infrastructureSubnetId: infrastructureSubnetId
      internal: false
    }
  }
}

// Azure Files share for /app/data (installed extensions, uploads, transfer
// bundles). SMB permissions are fixed at mount time, hence uid/gid 1000 — the
// user every Turbo EA image runs as.
resource dataStorage 'Microsoft.App/managedEnvironments/storages@2025-01-01' = {
  parent: env
  name: 'data'
  properties: {
    azureFile: {
      accountName: storageAccountName
      accountKey: storageAccountKey
      shareName: fileShareName
      accessMode: 'ReadWrite'
    }
  }
}

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: name
  location: location
  properties: {
    managedEnvironmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      // Single mode = zero-downtime updates, which means the old and new
      // replica overlap for a moment. For strict stop-then-start semantics
      // switch to 'Multiple' and deactivate the old revision before updating
      // (see the guide).
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8920
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        { name: 'secret-key', value: secretKey }
        { name: 'postgres-password', value: postgresPassword }
        // Key Vault alternative (needs identity: { type: 'SystemAssigned' } on
        // the app and "Key Vault Secrets User" on the vault):
        //   { name: 'secret-key', keyVaultUrl: 'https://<vault>.vault.azure.net/secrets/turbo-ea-secret-key', identity: 'system' }
      ]
    }
    template: {
      containers: concat([backendContainer, frontendContainer, nginxContainer], deployMcp ? [mcpContainer] : [])
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
      volumes: [
        {
          name: 'data'
          storageType: 'AzureFile'
          storageName: dataStorage.name
          mountOptions: 'dir_mode=0777,file_mode=0777,uid=1000,gid=1000,mfsymlinks,nobrl,cache=none'
        }
      ]
    }
  }
}

@description('Default FQDN of the app. Set publicUrl to https://<this> on the first deploy, or bind a custom domain.')
output fqdn string = app.properties.configuration.ingress.fqdn
output containerAppName string = app.name
output environmentName string = env.name
