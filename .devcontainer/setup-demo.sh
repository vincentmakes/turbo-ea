#!/usr/bin/env bash
set -euo pipefail

echo "======================================"
echo "  Turbo EA Demo — Setting up..."
echo "======================================"

# Generate .env with demo-ready values
SECRET_KEY=$(openssl rand -base64 48)
cat > .env <<EOF
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=demo-codespaces
SECRET_KEY=${SECRET_KEY}
ACCESS_TOKEN_EXPIRE_MINUTES=1440
ENVIRONMENT=development
ALLOWED_ORIGINS=*
HOST_PORT=8920
SEED_DEMO=true
EOF

echo "Generated .env with demo configuration."

# Build and start all services
echo "Building and starting containers (this may take a few minutes on first run)..."
docker compose -f docker-compose.db.yml up --build -d

# Wait for backend to be healthy
echo "Waiting for backend to be ready..."
for i in $(seq 1 60); do
  if docker compose -f docker-compose.db.yml exec -T backend curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "Backend is ready!"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "WARNING: Backend did not become healthy within 60 seconds."
    echo "Check logs with: docker compose -f docker-compose.db.yml logs backend"
    exit 0
  fi
  sleep 2
done

echo ""
echo "======================================"
echo "  Turbo EA Demo is running!"
echo "======================================"
echo ""
echo "  Open the forwarded port 8920 in your browser."
echo ""
echo "  Login credentials:"
echo "    Email:    admin@turboea.demo"
echo "    Password: TurboEA!2025"
echo ""
echo "  Useful commands:"
echo "    docker compose -f docker-compose.db.yml logs -f    # View logs"
echo "    docker compose -f docker-compose.db.yml down       # Stop demo"
echo "    docker compose -f docker-compose.db.yml restart    # Restart"
echo ""
