# Deploy to Vercel with GitHub Actions

The **Deploy to Vercel** workflow deploys production after a push to `main`.
You can also select **Actions → Deploy to Vercel → Run workflow** and choose
`main`. Manual runs on other branches skip deployment.

## One-time setup

1. Create or select the Vercel project for this repository. Use the **Next.js**
   framework preset, repository root as the root directory, and **Node.js 24.x**.
2. In GitHub, open **Settings → Secrets and variables → Actions** and add these
   repository secrets:

   | Secret              | Value                                            |
   | ------------------- | ------------------------------------------------ |
   | `VERCEL_TOKEN`      | A Vercel access token with access to the project |
   | `VERCEL_ORG_ID`     | The project's Vercel team/account ID             |
   | `VERCEL_PROJECT_ID` | The Vercel project ID                            |

   The organization and project IDs are also available in `.vercel/project.json`
   after linking the project locally with `vercel link`.

3. Configure application variables in the Vercel project's **Environment Variables**
   settings for **Production**, using [`.env.example`](../.env.example) as the
   reference. For the live app, set `NEXT_PUBLIC_DEMO_MODE=false` and configure
   the Supabase URL, publishable key, and server-only service-role key. Configure
   Mapbox and Groq variables for the features you use. Local `.env.local` files
   are not uploaded by this workflow.
4. Commit and push the workflow and `vercel.json` to `main`.

## What runs

The workflow installs locked dependencies with `npm ci`, runs tests, pulls Vercel
production settings and environment variables, builds with `vercel build --prod`,
checks TypeScript, and deploys the compiled output with
`vercel deploy --prebuilt --prod`. Failed checks stop deployment. The production
deployment URL appears in the GitHub Actions run summary and its `production`
environment.

Production runs are serialized. `vercel.json` disables Vercel's automatic Git
deployments so the same push does not trigger a second deployment. This workflow
does not create preview deployments. It follows Vercel's
[GitHub Actions deployment guide](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel).

The workflow deploys the application only. Apply database migrations and perform
first-HQ setup separately using the [live Supabase setup](live-supabase.md).
