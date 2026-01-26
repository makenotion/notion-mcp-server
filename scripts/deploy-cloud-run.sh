#!/bin/bash
set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-tpc-misc}"
REGION="asia-northeast1"
SERVICE_NAME="notion-mcp-server"
IMAGE_URI="gcr.io/${PROJECT_ID}/notion-mcp-server"
SERVICE_ACCOUNT="notion-mcp-server-runtime@tpc-misc.iam.gserviceaccount.com"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# Check required environment variables
check_env() {
    if [[ -z "$PROJECT_ID" ]]; then
        log_error "GCP_PROJECT_ID is required"
        echo "Usage: GCP_PROJECT_ID=your-project-id ./scripts/deploy-cloud-run.sh"
        exit 1
    fi
}

# Build and push Docker image
build_and_push() {
    log_info "Configuring Docker for GCR..."
    gcloud auth configure-docker gcr.io --quiet

    log_info "Building image locally..."
    docker build --platform linux/amd64 -t "$IMAGE_URI" .

    log_info "Pushing image to ${IMAGE_URI}..."
    docker push "$IMAGE_URI"
}

# Deploy to Cloud Run
deploy() {
    log_info "Deploying to Cloud Run..."

    # Base deploy command
    local deploy_args=(
        --project="$PROJECT_ID"
        --image="$IMAGE_URI"
        --platform=managed
        --region="$REGION"
        --allow-unauthenticated
        --service-account="$SERVICE_ACCOUNT"
        --args=--transport,http
        --set-secrets=NOTION_TOKEN=NOTION_MCP_NOTION_TOKEN:latest,AUTH_TOKEN=NOTION_MCP_AUTH_TOKEN:latest
    )

    gcloud run deploy "$SERVICE_NAME" "${deploy_args[@]}"
}

# Get service URL
get_service_url() {
    gcloud run services describe "$SERVICE_NAME" \
        --project "$PROJECT_ID" \
        --region "$REGION" \
        --format "value(status.url)"
}

# Main
main() {
    log_info "Starting Cloud Run deployment..."

    check_env
    build_and_push
    deploy

    local service_url
    service_url=$(get_service_url)

    echo ""
    log_info "Deployment complete!"
    echo "=========================================="
    echo "Service URL: ${service_url}"
    echo "MCP Endpoint: ${service_url}/mcp"
    echo "Health Check: ${service_url}/health"
    echo "=========================================="
    echo ""
    echo "To test:"
    echo "  curl ${service_url}/health"
    echo ""
    echo "To use with MCP client, configure:"
    echo "  URL: ${service_url}/mcp"
    echo "  Authorization: Bearer <your-auth-token>"
}

main "$@"
