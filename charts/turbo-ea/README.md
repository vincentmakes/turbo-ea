# Turbo EA Helm chart

Installs [Turbo EA](https://turbo-ea.org) — backend, frontend, edge nginx and
optionally the MCP server — on any Kubernetes ≥ 1.27 cluster, against a
PostgreSQL server you provide.

```bash
helm install turbo-ea oci://ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea \
  --version <X.Y.Z> \
  --namespace turbo-ea --create-namespace \
  --set publicUrl=https://ea.example.com \
  --set postgresql.host=postgres.example.internal \
  --set postgresql.password='…' \
  --set secretKey="$(openssl rand -base64 48)"
```

Chart version and image tag are always the same number as the Turbo EA
release, so `--version 2.141.0` installs the `2.141.0` images.

| Value | Required | Purpose |
|---|---|---|
| `publicUrl` | yes | The origin users open, e.g. `https://ea.example.com` |
| `postgresql.host` | yes | Existing PostgreSQL 14+ server |
| `existingSecret` | one of | Secret carrying `SECRET_KEY` and `POSTGRES_PASSWORD` |
| `secretKey` + `postgresql.password` | one of | Inline alternative to `existingSecret` |
| `ingress.enabled` | no | Route the whole host to the edge nginx Service |
| `mcp.enabled` | no | Deploy the MCP server at `<publicUrl>/mcp` |
| `backend.persistence.*` | no | PVC for `/app/data` (extensions, uploads) |

Cloud starting points: [`examples/values-aws.yaml`](examples/values-aws.yaml),
[`examples/values-azure.yaml`](examples/values-azure.yaml),
[`examples/values-gcp.yaml`](examples/values-gcp.yaml).

The backend runs as **one replica** on purpose (in-process event bus, unlocked
boot-time migrations, ReadWriteOnce data volume); scale `frontend` and `nginx`.
The chart does not run PostgreSQL, Ollama or TLS inside the cluster.

Every published chart is signed with cosign (keyless, GitHub Actions OIDC):

```bash
cosign verify ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<X.Y.Z> \
  --certificate-identity-regexp '^https://github.com/vincentmakes/turbo-ea/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Full guide: <https://docs.turbo-ea.org/admin/kubernetes/>.
