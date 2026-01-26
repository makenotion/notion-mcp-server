#!/bin/bash
set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-tpc-misc}"
REGION="asia-northeast1"
SERVICE_NAME="notion-mcp-server"
SERVICE_URL="https://notion-mcp.tpcground.com"
IMAGE_URI="gcr.io/${PROJECT_ID}/notion-mcp-server"
SERVICE_ACCOUNT="notion-mcp-server-runtime@tpc-misc.iam.gserviceaccount.com"

# Authentication mode: 'legacy' or 'oauth'
AUTH_MODE="${AUTH_MODE:-oauth}"

# TPC OAuth Configuration (required when AUTH_MODE=oauth)
TPC_OAUTH_BASE_URL="${TPC_OAUTH_BASE_URL:-https://tpc-agent.tpcground.com}"
TPC_CLIENT_ID="${TPC_CLIENT_ID:-tpc-notion-mcp}"

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
    log_info "Deploying to Cloud Run (AUTH_MODE=$AUTH_MODE)..."

    # Base deploy command
    local deploy_args=(
        --project="$PROJECT_ID"
        --image="$IMAGE_URI"
        --platform=managed
        --region="$REGION"
        --allow-unauthenticated
        --service-account="$SERVICE_ACCOUNT"
        --args=--transport,http
    )

    if [[ "$AUTH_MODE" == "oauth" ]]; then
        # OAuth mode: Use TPC OAuth server
        if [[ -z "$TPC_CLIENT_ID" ]]; then
            log_error "TPC_CLIENT_ID is required for OAuth mode"
            exit 1
        fi

        # Get the service URL for ISSUER_URL (may need to deploy first time without it)

        deploy_args+=(
            --set-secrets=NOTION_TOKEN=NOTION_MCP_NOTION_TOKEN:latest,TPC_CLIENT_SECRET=NOTION_MCP_TPC_OAUTH_CLIENT_SECRET:latest
            --set-env-vars="AUTH_MODE=oauth,TPC_OAUTH_BASE_URL=$TPC_OAUTH_BASE_URL,TPC_CLIENT_ID=$TPC_CLIENT_ID,ISSUER_URL=$SERVICE_URL"
        )
    else
        # Legacy mode: Use static bearer token
        deploy_args+=(
            --set-secrets=NOTION_TOKEN=NOTION_MCP_NOTION_TOKEN:latest,AUTH_TOKEN=NOTION_MCP_AUTH_TOKEN:latest
        )
    fi

    gcloud run deploy "$SERVICE_NAME" "${deploy_args[@]}"
}

# Main
main() {
    log_info "Starting Cloud Run deployment..."

    check_env
    build_and_push
    deploy

    echo ""
    log_info "Deployment complete!"
    echo "=========================================="
    echo "Service URL: ${SERVICE_URL}"
    echo "MCP Endpoint: ${SERVICE_URL}/mcp"
    echo "Health Check: ${SERVICE_URL}/health"
    echo "Auth Mode: ${AUTH_MODE}"
    echo "=========================================="
    echo ""
    echo "To test:"
    echo "  curl ${SERVICE_URL}/health"
    echo ""

    if [[ "$AUTH_MODE" == "oauth" ]]; then
        echo "OAuth mode is enabled. MCP clients will authenticate via TPC OAuth."
        echo ""
        echo "OAuth Metadata: ${SERVICE_URL}/.well-known/oauth-authorization-server"
        echo ""
        echo "To add to Claude Code (OAuth):"
        echo "  claude mcp add --transport http tpc-notion ${SERVICE_URL}/mcp"
    else
        echo "To add to Claude Code:"
        echo "  claude mcp add --transport http tpc-notion ${SERVICE_URL}/mcp --header \"Authorization: Bearer \$AUTH_TOKEN\""
        echo ""
        echo "Or with specific scope:"
        echo "  claude mcp add --transport http tpc-notion ${SERVICE_URL}/mcp --header \"Authorization: Bearer \$AUTH_TOKEN\" --scope user"
    fi
}

main "$@"
