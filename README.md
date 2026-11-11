# Lexicon 2026

This repository contains a lightweight Lexicon 2026 implementation with:

- a static browser experience under public/
- a local mock API server for development in app.js
- a SAM/CloudFormation template in template.yaml for deployment to AWS
- a Node-based handler in src/handler.js for AWS Lambda

## To do!
- POST errors (like trying to create an existing word again) return a 403 with no feedback to the user
    - My bad, it just says "Forbidden" in tiny text at the bottom
- Truncated main page posts have a (more) link that goes nowhere
- I don't think you can do carriage returns in this game. Ideally you should get access to full markup, but at the very least you need carriage returns!
- Some way to signal "Everyone has finished, time for the next letter!"
- A way to enter emails, and then get email either a) each time someone posts a letter, and / or b) when everyone has finished and it's time to start the next round

## Invalidate Page Cache
- invalidateWordListCache()
## Run locally

```bash
npm install
node app.js
```

Then open http://localhost:3000.

## Deploy to AWS

Make sure the static files are up to date with:
aws s3 sync public/ s3://lexicon-2026.sixbynine.com --delete

Then just use ./deploy.sh


1. Install the AWS SAM CLI.
2. Set a JWT secret and package the application.
3. Run `sam deploy --guided`.
