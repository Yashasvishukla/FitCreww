@description('Short environment name, for example staging or production.')
param environmentName string
param location string = resourceGroup().location
param alertActionGroupId string = ''

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'fitcrew-${environmentName}-logs'
  location: location
  properties: {
    retentionInDays: 35
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
    sku: { name: 'PerGB2018' }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'fitcrew-${environmentName}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    DisableIpMasking: false
    RetentionInDays: 90
  }
}

resource failedRequests 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'fitcrew-${environmentName}-failed-requests'
  location: 'global'
  properties: {
    description: 'Alert when server failures indicate an outage or regression.'
    severity: 1
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{
        name: 'serverFailures'
        criterionType: 'StaticThresholdCriterion'
        metricName: 'requests/failed'
        metricNamespace: 'Microsoft.Insights/components'
        operator: 'GreaterThan'
        threshold: 5
        timeAggregation: 'Total'
      }]
    }
    autoMitigate: true
    actions: empty(alertActionGroupId) ? [] : [alertActionGroupId]
  }
}

resource dependencyFailures 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'fitcrew-${environmentName}-dependency-failures'
  location: 'global'
  properties: {
    description: 'Alert when database or external dependency calls fail.'
    severity: 2
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{
        name: 'dependencyFailures'
        criterionType: 'StaticThresholdCriterion'
        metricName: 'dependencies/failed'
        metricNamespace: 'Microsoft.Insights/components'
        operator: 'GreaterThan'
        threshold: 3
        timeAggregation: 'Total'
      }]
    }
    autoMitigate: true
    actions: empty(alertActionGroupId) ? [] : [alertActionGroupId]
  }
}

output connectionString string = appInsights.properties.ConnectionString
