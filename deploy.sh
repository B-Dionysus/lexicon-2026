#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="lexicon-2026"
BUCKET_NAME="lexicon-2026-deployments"
JWT_SECRET="${JWT_SECRET:-replace-me}"

aws s3 mb "s3://${BUCKET_NAME}" --region "$REGION" 2>/dev/null || true
sam package --template-file template.yaml --output-template-file packaged.yaml --s3-bucket "$BUCKET_NAME" --region "$REGION"
sam deploy --template-file packaged.yaml --stack-name "$STACK_NAME" --capabilities CAPABILITY_IAM --parameter-overrides JwtSecret="$JWT_SECRET" --region "$REGION" --resolve-s3
