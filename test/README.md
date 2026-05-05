# Test Compose

This folder contains Docker assets used only by automated or local test runs.

## Files

- `docker-compose.test.yml` — ephemeral PostgreSQL harness for backend tests

## Usage

Most developers should use the wrapper script instead of invoking this compose
file directly:

```bash
./scripts/test.sh
```

That script starts the test database, exports the expected environment
variables, runs pytest, and tears the database back down automatically.
