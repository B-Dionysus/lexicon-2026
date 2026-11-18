# Lexicon 2026

This repository contains a lightweight Lexicon 2026 implementation with:

- a static browser experience under public/
- a local mock API server for development in app.js
- a SAM/CloudFormation template in template.yaml for deployment to AWS
- a Node-based handler in src/handler.js for AWS Lambda

## To do!
- Support richer markup in definitions.
- Store the JWT secret in SSM Parameter Store instead of a CloudFormation parameter (in progress).


## Done!
Definitions preserve line breaks entered in the editor on both the main page and the full definition page.

Profiles can optionally include a private email address. A welcome email is sent
when the address or notification preferences are added or changed; it summarizes
the preferences. Addresses are not verified. If SES rejects
the send, the profile is saved and the player is warned. Local mock API saves
addresses but does not send mail.

New profiles must be created from an existing, non-default game URL; visiting
the example game does not permit signup.
A player can join additional games with the same account: on the new game's
signup page, enter the existing user name and password. Leave the researcher
name and bio blank to reuse the current ones, or fill them in to use a different
researcher in that game. Each game's researcher name and bio live in the
`lexicon-2026-researchers` table (key `user_name` + `game_id`; a row means the
player belongs to that game). Profile pages, word lists and word emails use the
game's researcher, and a profile page lists only that game's words. Editing a
profile from inside a game changes only that game's researcher. Email address,
notification preferences, password and admin status are account-wide. Word and
round emails go only to opted-in members of that game, and word emails name the
game. Profiles created before this table existed (with a `game_id` attribute)
keep working as members of that game.
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

## Tests and CI

`npm test` runs the suite; no AWS credentials are needed. A GitHub Actions
workflow (`.github/workflows/test.yml`) runs it on Node 22 for every pull
request and push to `main`. It does not deploy.

## Run locally

```bash
npm install
node app.js
```

Then open http://localhost:3000.

## Deploy to AWS

Deployment has two independent parts. Run whichever matches what you changed:

| Changed | Deploy |
| --- | --- |
| `src/`, `template.yaml` (backend) | [Backend](#backend-lambda-api-and-tables) |
| `public/` (static site) | [Frontend](#frontend-static-site) |

Install the AWS and SAM CLIs and authenticate the `lexicon` AWS profile. Run
`aws sso login --profile lexicon --use-device-code` if the profile uses IAM Identity Center.

### Backend (Lambda, API and tables)

`./deploy.sh` deploys only the backend. It does not upload `public/`.

```bash
AWS_PROFILE=lexicon ./deploy.sh
```

The script builds the Lambda and its dependencies, targets the existing
`lexicon-2026` stack, and asks for confirmation of the CloudFormation change
set. Do not use it to create a new stack. Review the change set for
replacements or deletions before confirming. The API is implicit so SAM retains
the existing `ServerlessRestApi` logical ID; renaming it would replace the API
endpoint.

The JWT signing secret is read at runtime from the SSM SecureString parameter
`/lexicon-2026/jwt-secret` (the `JwtSecretParameterName` template parameter),
which must exist before deploying. Create it once:

```bash
aws ssm put-parameter --name /lexicon-2026/jwt-secret --type SecureString \
  --value '<secret>' --profile lexicon --region us-east-1
```

When migrating, reuse the secret currently in the Lambda's `JWT_SECRET`
environment variable so existing sessions stay valid; a new value signs everyone
out. If the parameter is missing or unreadable, the API returns 500 rather than
falling back to a default.

### Frontend (static site)

`aws s3 sync` uploads `public/` to the site bucket. It is separate from
`./deploy.sh`, so run it whenever `public/` changes. Review the files to be
deleted first:

```bash
aws s3 sync public/ s3://lexicon-2026.sixbynine.com --delete --dryrun --profile lexicon
aws s3 sync public/ s3://lexicon-2026.sixbynine.com --delete --profile lexicon
```
