#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="lexicon-2026"
BUCKET_NAME="lexicon-2026-deployments"
BUILD_DIR=".aws-sam/lexicon-build"
CONFIG_FILE="$(mktemp --suffix=.toml)"
trap 'rm -f "$CONFIG_FILE"' EXIT
printf 'version = 0.1\n' > "$CONFIG_FILE"

aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].StackStatus' --output text --no-cli-pager >/dev/null
sam build --template-file template.yaml --build-dir "$BUILD_DIR" --config-file "$CONFIG_FILE"
sam deploy --template-file "$BUILD_DIR/template.yaml" --config-file "$CONFIG_FILE" \
  --stack-name "$STACK_NAME" --s3-bucket "$BUCKET_NAME" \
  --capabilities CAPABILITY_IAM --region "$REGION" --confirm-changeset
