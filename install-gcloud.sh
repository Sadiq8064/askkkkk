#!/bin/bash

# Google Cloud CLI Installation Script for macOS
# This script will download and install the Google Cloud SDK

echo "Installing Google Cloud CLI for macOS..."
echo ""

# Check if Homebrew is installed
if command -v brew &> /dev/null; then
    echo "✓ Homebrew detected. Installing gcloud via Homebrew..."
    echo ""
    
    # Install using Homebrew
    brew install --cask google-cloud-sdk
    
    # Source the completion scripts
    if [ -f "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc" ]; then
        source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"
    fi
    
    if [ -f "$(brew --prefix)/share/google-cloud-sdk/completion.zsh.inc" ]; then
        source "$(brew --prefix)/share/google-cloud-sdk/completion.zsh.inc"
    fi
    
else
    echo "✗ Homebrew not detected. Installing using the official installer..."
    echo ""
    
    # Download the latest macOS SDK
    cd ~
    
    # Detect architecture
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
        echo "Detected Apple Silicon (M1/M2/M3)..."
        SDK_URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz"
        SDK_FILE="google-cloud-cli-darwin-arm.tar.gz"
    else
        echo "Detected Intel Mac..."
        SDK_URL="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-x86_64.tar.gz"
        SDK_FILE="google-cloud-cli-darwin-x86_64.tar.gz"
    fi
    
    # Download
    echo "Downloading Google Cloud SDK..."
    curl -O $SDK_URL
    
    # Extract
    echo "Extracting..."
    tar -xzf $SDK_FILE
    
    # Install
    echo "Installing..."
    ./google-cloud-sdk/install.sh
    
    # Clean up
    rm $SDK_FILE
    
    echo ""
    echo "Please restart your terminal or run:"
    echo "source ~/.zshrc"
fi

echo ""
echo "Verifying installation..."
gcloud --version

echo ""
echo "Installation complete! Next steps:"
echo ""
echo "1. Authenticate with Google Cloud:"
echo "   gcloud auth login"
echo ""
echo "2. Set your project:"
echo "   gcloud config set project YOUR_PROJECT_ID"
echo ""
echo "3. Deploy your application:"
echo "   cd /Volumes/ExternalSSD/smartuniversity"
echo "   PROJECT_ID=your-project-id ./deploy.sh"
echo ""
