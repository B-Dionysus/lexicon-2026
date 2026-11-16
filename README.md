# Lexicon 2026

This repository contains a lightweight Lexicon 2026 implementation with:

- a static browser experience under public/
- a local mock API server for development in app.js
- a SAM/CloudFormation template in template.yaml for deployment to AWS
- a Node-based handler in src/handler.js for AWS Lambda

## To do!
- Support richer markup in definitions.
- Some way to signal "Everyone has finished, time for the next letter!"
- Email notifications when a player posts or a round is complete.

Definitions preserve line breaks entered in the editor on both the main page and the full definition page.

Profiles can optionally include a private email address. A welcome email is sent
when the address or notification preferences are added or changed; it summarizes
the preferences. Word and round notifications are not yet implemented. Addresses
are not verified. If SES rejects
the send, the profile is saved and the player is warned. Local mock API saves
addresses but does not send mail.

SES must have `lexicon@benjamindionys.us` (or its domain) verified as a sender
in the deployment region. While SES is in the sandbox, recipients must also be
verified; request production access to send to unverified recipients. The Lambda
role is restricted to sending from this address. An accepted send is not a
guarantee of delivery.

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
`aws sso login --profile lexicon --use-device-code` if the profile uses IAM Identity Center.

To update the existing backend stack, run:

```bash
AWS_PROFILE=lexicon ./deploy.sh
```

The script builds the Lambda and its dependencies, targets the existing
`lexicon-2026` stack, and asks for confirmation of the CloudFormation change
set. It keeps the stack's existing JWT secret; do not use it to create a new
stack. Review the change set for replacements or deletions before confirming.
The API is implicit so SAM retains the existing `ServerlessRestApi` logical ID;
renaming it would replace the API endpoint.

To update the static site separately, review the files to be deleted first:

```bash
aws s3 sync public/ s3://lexicon-2026.sixbynine.com --delete --dryrun --profile lexicon
aws s3 sync public/ s3://lexicon-2026.sixbynine.com --delete --profile lexicon
```
