---
name: Auto GitHub Push
description: Automatically stages, commits, and pushes all local changes to GitHub.
---

# Auto GitHub Push Workflow

## Context & Goal

Whenever we complete a feature, fix, or session, this skill automatically checks the current code into version control and pushes it to GitHub. This eliminates the need to manually ask for code to be saved or deployed.

## Step-by-Step Workflow

// turbo-all

1. Check the git status to confirm we are in a Git repository:
   `git status`
   *(If not a git repository, ask the user if they'd like to initialize one and link it to GitHub).*

2. Stage all modifications and new files:
   `git add .`

3. Create a descriptive commit message based on the work just completed:
   `git commit -m "Auto-commit: [Description of the features, fixes, or updates just done]"`

4. Push the committed changes to your remote repository:
   `git push`

## Verification

- If `git push` returns a success message (e.g., "Branch 'main' set up to track remote branch"), the step is complete.
- If it fails due to authentication or needing an upstream branch, guide the user to resolve it (e.g., `git push -u origin main`).

## Anti-Patterns

- Never push without a descriptive commit message. Avoid generic messages like "update" or "changes".
- Do not force push (`--force`) unless explicitly authorized to do so.
