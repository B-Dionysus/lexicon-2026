# Lexicon 2026

This repository contains a lightweight Lexicon 2026 implementation with:

- a static browser experience under public/
- a local mock API server for development in app.js
- a SAM/CloudFormation template in template.yaml for deployment to AWS
- a Node-based handler in src/handler.js for AWS Lambda

## To do!
- Support richer markup in definitions.

Definitions preserve line breaks entered in the editor on both the main page and the full definition page.

Profiles can optionally include a private email address. A welcome email is sent
when the address or notification preferences are added or changed; it summarizes
the preferences. Addresses are not verified. If SES rejects
the send, the profile is saved and the player is warned. Local mock API saves
addresses but does not send mail.

New profiles must be created from an existing, non-default game URL. The profile
is associated with that game; visiting the example game does not permit signup.
For local development, use `http://localhost:3000/?game_id=local`.

An admin viewing their own profile can end the current game's round manually.
Games start at A and finish after Z. Round emails go to profiles associated
with that game that have an address and opted in to round notifications. The
admin must decide when everyone has submitted; completion is not checked
automatically. Email failures are reported after the round advances and require
manual follow-up. Local mock API does not send round emails.

Word notifications go to profiles associated with the game that have an email
address and opted in. They are sent for a new defined word and when a previously
undefined word receives its first definition, not for later edits. If a
notification cannot be sent, the word is saved and the submitter is warned.
The local mock API does not send word notifications.

SES must have `lexicon@benjamindionys.us` (or its domain) verified as a sender
in the deployment region. While SES is in the sandbox, recipients must also be
verified; request production access to send to unverified recipients. The Lambda
role is restricted to sending from this address. An accepted send is not a
guarantee of delivery.
`SITE_URL` in the SAM template sets the public base URL used in notification
links.

## Word list cache

The Lambda keeps each game's word list in memory to avoid querying the words
table on every request. Each request checks a shared DynamoDB invalidation
signal; if it has changed, that Lambda instance reloads the list. Researcher
names are fetched separately, so they are not stored in the word list cache.

Creating or editing a word through the API invalidates its game's cache
automatically. If words are changed directly in DynamoDB, or the main page
shows a stale list after a failed update, invalidate the cache manually:

1. Sign in and open the affected game's main page.
2. Open the browser developer console and run `await invalidateWordListCache()`.
3. Refresh the page to request the list again.

This signals all Lambda instances to reload that game's list on their next
request; it does not clear the browser cache. The local mock API does not use
this Lambda cache or provide the invalidation endpoint.

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
