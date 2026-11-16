# Certs Team Tracker

Daily task tracker for the Management Certs team (Veenu, Zil, Sovan, Tapan), hosted on GitHub Pages.

## How it works

- **Login:** pick your name and enter the team password. The password is never stored in this repo.
- **Team snapshot:** the shared daily lists, read-only. One tab per day, grouped by programme, with SSD and delay flags and a carried-forward review per person.
- **My copy:** the same lists, editable. Ticks, "Waiting" flags and new tasks save in your own browser only. **Copy my update** puts a plain-text summary of your changes on the clipboard to send to your lead.

## Data and privacy

The repo is public, so the task data is published only in encrypted form:

- `data.enc.json` is encrypted with AES-256-GCM. The key is derived from the team password with PBKDF2-SHA256 at 310,000 iterations.
- Anyone can download the file, but without the password it can't be read.
- The plaintext export (`private/data.json`) is git-ignored and never committed.

## Updating the snapshot

```bash
TEAM_PASSWORD='…' node tools/encrypt.mjs private/data.json data.enc.json
git add data.enc.json && git commit -m "Update snapshot" && git push
```

To change the team password, re-run the command with the new password and push. Everyone signs in again with the new one.
