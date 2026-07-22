# Lexicon 2026

This repository contains a lightweight Lexicon 2026 implementation with:

- a static browser experience under public/
- a local mock API server for development in app.js
- a SAM/CloudFormation template in template.yaml for deployment to AWS
- a Node-based handler in src/handler.js for AWS Lambda

## Run locally

```bash
npm install
node app.js
```

Then open http://localhost:3000.

## Deploy to AWS

1. Install the AWS SAM CLI.
2. Set a JWT secret and package the application.
3. Run `sam deploy --guided`.
