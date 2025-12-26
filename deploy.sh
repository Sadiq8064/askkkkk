#!/bin/bash

# Exit on error
set -e

# Configuration
PROJECT_ID="quicknotes-24e44" # Set your GCP project ID here or via command line
REGION="us-central1" # Change to your preferred region
SERVICE_NAME="smartuniversity-api"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored messages
print_message() {
    echo -e "${GREEN}==>${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}WARNING:${NC} $1"
}

print_error() {
    echo -e "${RED}ERROR:${NC} $1"
}

# Check if PROJECT_ID is set
if [ -z "$PROJECT_ID" ]; then
    print_error "PROJECT_ID is not set. Please set it in the script or pass it as an environment variable."
    print_message "Usage: PROJECT_ID=your-project-id ./deploy.sh"
    exit 1
fi

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    print_error "gcloud CLI is not installed. Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set the project
print_message "Setting GCP project to ${PROJECT_ID}..."
gcloud config set project ${PROJECT_ID}

# Enable required APIs
print_message "Enabling required Google Cloud APIs..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com

# Build the container image
print_message "Building container image..."
gcloud builds submit --tag ${IMAGE_NAME}

# Deploy to Cloud Run
print_message "Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME} \
    --platform managed \
    --region ${REGION} \
    --allow-unauthenticated \
    --memory 1Gi \
    --cpu 1 \
    --max-instances 10 \
    --min-instances 0 \
    --port 3000 \
    --timeout 300

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format 'value(status.url)')

print_message "Deployment complete!"
echo ""
print_message "Service URL: ${SERVICE_URL}"
print_message "Health check: ${SERVICE_URL}/health"
echo ""
print_warning "Remember to configure environment variables in the Cloud Console or using:"
print_warning "gcloud run services update ${SERVICE_NAME} --region ${REGION} --set-env-vars KEY=VALUE"
echo ""
print_message "Useful commands:"
echo "  - View logs: gcloud run services logs read ${SERVICE_NAME} --region ${REGION}"
echo "  - Describe service: gcloud run services describe ${SERVICE_NAME} --region ${REGION}"
echo "  - Delete service: gcloud run services delete ${SERVICE_NAME} --region ${REGION}"
