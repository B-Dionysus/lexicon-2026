# Lexicon 2026

This repository contains a lightweight Lexicon 2026 implementation with:

- a static browser experience under public/
- a local mock API server for development in app.js
- a SAM/CloudFormation template in template.yaml for deployment to AWS
- a Node-based handler in src/handler.js for AWS Lambda

## To do!
- Support richer markup in definitions.
- Some way to signal "Everyone has finished, time for the next letter!"
- A way to enter emails, and then get email either a) each time someone posts a letter, and / or b) when everyone has finished and it's time to start the next round

Definitions preserve line breaks entered in the editor on both the main page and the full definition page.

## Invalidate Page Cache
- invalidateWordListCache()
## Run locally

```bash
npm install
node app.js
```

Then open http://localhost:3000.

## Deploy to AWS

Install the AWS and SAM CLIs and authenticate the `lexicon` AWS profile. Run
`aws sso login --profile lexicon` if the profile uses IAM Identity Center.

To update the existing backend stack, run:

```bash
AWS_PROFILE=lexicon ./deploy.sh
```

The script builds the Lambda and its dependencies, targets the existing
`lexicon-2026` stack, and asks for confirmation of the CloudFormation change
set. It keeps the stack's existing JWT secret; do not use it to create a new
stack. Review the change set for replacements or deletions before confirming.

To update the static site separately, review the files to be deleted first:

```bash
aws s3 sync public/ s3://lexicon-2026.sixbynine.com --delete --dryrun --profile lexicon
aws s3 sync public/ s3://lexicon-2026.sixbynine.com --delete --profile lexicon
```
