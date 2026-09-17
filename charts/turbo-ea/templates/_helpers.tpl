{{/*
Chart name, truncated to the 63-character label limit.
*/}}
{{- define "turbo-ea.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Release-qualified name. Component resources append "-backend", "-frontend",
"-nginx", "-mcp" to it, so it is capped at 54 characters to stay within 63.
*/}}
{{- define "turbo-ea.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 54 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 54 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 54 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "turbo-ea.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels. Takes the root context.
*/}}
{{- define "turbo-ea.labels" -}}
helm.sh/chart: {{ include "turbo-ea.chart" . }}
app.kubernetes.io/name: {{ include "turbo-ea.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: turbo-ea
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels for one component. Takes (dict "root" $ "component" "backend").
*/}}
{{- define "turbo-ea.selectorLabels" -}}
app.kubernetes.io/name: {{ include "turbo-ea.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Labels for one component: common labels plus the component label.
Takes (dict "root" $ "component" "backend").
*/}}
{{- define "turbo-ea.componentLabels" -}}
{{ include "turbo-ea.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Fully-qualified image reference for one component.
Takes (dict "root" $ "image" .Values.backend.image).
Registry precedence: component > global.imageRegistry > image.registry.
Tag precedence: component > image.tag > Chart.AppVersion.
*/}}
{{- define "turbo-ea.image" -}}
{{- $registry := coalesce .image.registry .root.Values.global.imageRegistry .root.Values.image.registry }}
{{- $repository := coalesce .image.repository .root.Values.image.repository }}
{{- $tag := coalesce .image.tag .root.Values.image.tag .root.Chart.AppVersion }}
{{- printf "%s/%s/%s:%s" $registry $repository .image.name $tag }}
{{- end }}

{{/*
Pull policy for one component. Takes (dict "root" $ "image" .Values.backend.image).
*/}}
{{- define "turbo-ea.imagePullPolicy" -}}
{{- coalesce .image.pullPolicy .root.Values.image.pullPolicy }}
{{- end }}

{{- define "turbo-ea.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{- define "turbo-ea.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "turbo-ea.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the Secret carrying SECRET_KEY and POSTGRES_PASSWORD.
*/}}
{{- define "turbo-ea.secretName" -}}
{{- default (include "turbo-ea.fullname" .) .Values.existingSecret }}
{{- end }}

{{/*
Origin of publicUrl: scheme://host[:port], no path, no trailing slash.
*/}}
{{- define "turbo-ea.publicOrigin" -}}
{{- regexFind "^https?://[^/]+" .Values.publicUrl }}
{{- end }}

{{/*
Hostname of publicUrl, without scheme or port.
*/}}
{{- define "turbo-ea.publicHost" -}}
{{- $origin := include "turbo-ea.publicOrigin" . }}
{{- $authority := regexReplaceAll "^https?://" $origin "" }}
{{- regexReplaceAll ":[0-9]+$" $authority "" }}
{{- end }}

{{/*
Comma-separated CORS allow-list for the backend.
*/}}
{{- define "turbo-ea.allowedOrigins" -}}
{{- if .Values.allowedOrigins }}
{{- join "," .Values.allowedOrigins }}
{{- else }}
{{- include "turbo-ea.publicOrigin" . }}
{{- end }}
{{- end }}

{{/*
Fully-qualified in-cluster hostname of one component's Service.
Takes (dict "root" $ "component" "backend"). The edge nginx resolves upstreams
through its own `resolver`, which ignores the pod's DNS search list, so a bare
Service name would not resolve.
*/}}
{{- define "turbo-ea.serviceFQDN" -}}
{{- printf "%s-%s.%s.svc.%s" (include "turbo-ea.fullname" .root) .component .root.Release.Namespace .root.Values.clusterDomain }}
{{- end }}

{{/*
Container security context for one component: the chart-wide default with the
component's own map merged over it. Takes (dict "root" $ "override" .Values.backend.containerSecurityContext).
*/}}
{{- define "turbo-ea.containerSecurityContext" -}}
{{- toYaml (mergeOverwrite (deepCopy .root.Values.containerSecurityContext) (.override | default dict)) }}
{{- end }}

{{/*
Fail early with a readable message when a required value is missing. JSON
schema cannot express "existingSecret OR (secretKey AND password)".
*/}}
{{- define "turbo-ea.validate" -}}
{{- if not (regexMatch "^https?://[^/]+" .Values.publicUrl) }}
{{- fail "publicUrl is required and must look like https://ea.example.com (set it with --set publicUrl=...)" }}
{{- end }}
{{- if not .Values.postgresql.host }}
{{- fail "postgresql.host is required: the chart does not run PostgreSQL itself, point it at an existing server" }}
{{- end }}
{{- if not .Values.existingSecret }}
{{- if not .Values.secretKey }}
{{- fail "secretKey is required unless existingSecret names a Secret carrying it (generate one with: openssl rand -base64 48)" }}
{{- end }}
{{- if not .Values.postgresql.password }}
{{- fail "postgresql.password is required unless existingSecret names a Secret carrying it" }}
{{- end }}
{{- end }}
{{- end }}
