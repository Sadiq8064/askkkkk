# Deployment Guide - Google Cloud Run

This guide explains how to deploy the smartuniversity API to Google Cloud Run.

## Prerequisites

### 1. Google Cloud Account
- Create a Google Cloud account at [cloud.google.com](https://cloud.google.com)
- Create a new project or use an existing one
- Enable billing for the project

### 2. Install Google Cloud CLI
Download and install from: https://cloud.google.com/sdk/docs/install

**Verify installation:**
```bash
gcloud --version
```

### 3. Authenticate
```bash
gcloud auth login
gcloud auth application-default login
```

### 4. Set Your Project
```bash
gcloud config set project YOUR_PROJECT_ID
```

## Deployment Steps

### Option 1: Using the Deployment Script (Recommended)

1. **Edit the deployment script** to set your project ID:
   ```bash
   # Open deploy.sh and set PROJECT_ID
   nano deploy.sh
   ```
   Or set it via environment variable:
   ```bash
   export PROJECT_ID=your-project-id
   ```

2. **Make the script executable:**
   ```bash
   chmod +x deploy.sh
   ```

3. **Run the deployment:**
   ```bash
   ./deploy.sh
   # Or with environment variable:
   PROJECT_ID=your-project-id ./deploy.sh
   ```

### Option 2: Manual Deployment

1. **Enable required APIs:**
   ```bash
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable run.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   ```

2. **Build the container:**
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/smartuniversity-api
   ```

3. **Deploy to Cloud Run:**
   ```bash
   gcloud run deploy smartuniversity-api \
     --image gcr.io/YOUR_PROJECT_ID/smartuniversity-api \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --memory 1Gi \
     --cpu 1 \
     --max-instances 10 \
     --port 3000
   ```

## Environment Variables Configuration

Your application uses environment variables from the `.env` file. Configure them in Cloud Run:

### Method 1: Using gcloud CLI
```bash
gcloud run services update smartuniversity-api \
  --region us-central1 \
  --set-env-vars "MONGODB_URI=your_mongodb_uri,API_KEY=your_api_key"
```

### Method 2: Using Google Cloud Console
1. Go to [Cloud Run Console](https://console.cloud.google.com/run)
2. Click on your service
3. Click "Edit & Deploy New Revision"
4. Go to "Variables & Secrets" tab
5. Add your environment variables
6. Deploy the new revision

### Required Environment Variables
Review your `.env` file and configure all necessary variables. Common ones include:
- `MONGODB_URI` - MongoDB connection string
- API keys for external services
- Session secrets
- Any other configuration your app needs

## Database Configuration

### MongoDB Atlas (Recommended)
1. Create a MongoDB Atlas cluster at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Whitelist `0.0.0.0/0` in Network Access to allow Cloud Run connections
3. Get your connection string
4. Set it as `MONGODB_URI` environment variable in Cloud Run

### VPC Connector (For Private MongoDB)
If using a private MongoDB instance, set up a [VPC Connector](https://cloud.google.com/vpc/docs/configure-serverless-vpc-access):
```bash
gcloud run services update smartuniversity-api \
  --region us-central1 \
  --vpc-connector YOUR_VPC_CONNECTOR
```

## Post-Deployment Testing

### 1. Test Health Endpoint
```bash
curl https://YOUR_SERVICE_URL/health
```

Expected response:
```json
{
  "status": "OK",
  "timestamp": "2025-12-26T...",
  "uptime": 123.456
}
```

### 2. Test API Endpoints
Test your actual endpoints to ensure they're working:
```bash
curl https://YOUR_SERVICE_URL/api/student/...
curl https://YOUR_SERVICE_URL/university/...
```

### 3. View Logs
```bash
gcloud run services logs read smartuniversity-api --region us-central1 --limit 50
```

## Monitoring and Management

### View Service Details
```bash
gcloud run services describe smartuniversity-api --region us-central1
```

### Update Service
```bash
gcloud run services update smartuniversity-api \
  --region us-central1 \
  --memory 2Gi  # Example: increase memory
```

### Scale Configuration
```bash
gcloud run services update smartuniversity-api \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 20
```

### Delete Service
```bash
gcloud run services delete smartuniversity-api --region us-central1
```

## Troubleshooting

### Build Fails
- Check your Dockerfile syntax
- Ensure all dependencies in package.json are correct
- Review build logs: `gcloud builds list`

### Deployment Fails
- Check quotas: [console.cloud.google.com/iam-admin/quotas](https://console.cloud.google.com/iam-admin/quotas)
- Verify billing is enabled
- Check service logs for errors

### Application Not Starting
- Verify PORT environment variable is used (Cloud Run injects this)
- Check application logs: `gcloud run services logs read smartuniversity-api --region us-central1`
- Ensure your app binds to `0.0.0.0`, not `localhost`

### Database Connection Issues
- Verify MONGODB_URI is correctly set
- Check MongoDB Atlas network access whitelist
- Ensure database credentials are correct

### 502 Bad Gateway
- Container is crashing on startup - check logs
- App is not responding on the correct port
- Increase memory allocation if running out of memory

## Cost Optimization

Cloud Run pricing is based on:
- CPU and memory allocation
- Number of requests
- Execution time

To optimize costs:
1. Set `--min-instances 0` to scale to zero when idle
2. Use appropriate memory allocation (start with 512Mi, increase if needed)
3. Set reasonable `--max-instances` to prevent runaway scaling

## Security Best Practices

1. **Use Secrets Manager** for sensitive data:
   ```bash
   gcloud run services update smartuniversity-api \
     --region us-central1 \
     --set-secrets "MONGODB_URI=mongodb-uri:latest"
   ```

2. **Restrict Access** if not building a public API:
   ```bash
   gcloud run services update smartuniversity-api \
     --region us-central1 \
     --no-allow-unauthenticated
   ```

3. **Use Custom Domain** with SSL:
   - Map a custom domain in Cloud Run console
   - Automatic SSL certificate provisioning

## Additional Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud Run Pricing](https://cloud.google.com/run/pricing)
- [Best Practices](https://cloud.google.com/run/docs/tips)
