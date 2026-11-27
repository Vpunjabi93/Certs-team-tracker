# Certs Team Tracker

Live task tracker for the Management Certs team, hosted on GitHub Pages. Data lives in a Google Sheet owned by the team lead.

## What people can do

- **Sign in** with their work email and the team password.
- **Board:** one column per person, with programmes (name and sales start date), tasks and subtasks.
  - Tick tasks and subtasks off, mark them Waiting, edit or delete them.
  - Add a programme, add tasks and subtasks, and change a programme's SSD, owner or status note.
  - Every change saves to the Sheet, so everyone sees it the next time they open the page. Open pages refresh themselves every 45 seconds.
- **Daily log:** for any day, what was added and what was completed, person by person. New tasks are stamped with the day they were added, and open tasks show how long they've been open.

## How it fits together

| Piece | Where | Public? |
|---|---|---|
| `index.html`, `config.js` | This repo, served by GitHub Pages | Yes. No task data or emails. |
| `apps-script/Code.gs` | Pasted into the Sheet's Apps Script project and deployed as a web app | Code only, no secrets |
| Tasks, programmes, users, change log | The Google Sheet (tabs: Users, Programmes, Tasks, Log) | Private to the Sheet owner |
| Team password | Apps Script → Project settings → Script properties (`TEAM_PASSWORD`) | Private |

`config.js` holds the web app URL. The URL is safe to publish because every request still needs a team email and the password. After 8 wrong passwords, that email is paused for 15 minutes.

## Common jobs

- **Add or remove a person:** edit the Users tab in the Sheet (email, name, role = `member` or `lead`). Members get a column; leads see everyone.
- **Change the password:** in the Apps Script editor, type the new password into `setPassword()`, run it, then clear the value.
- **Update the code:** paste the new `Code.gs`, then go to Deploy → Manage deployments → Edit → Version: New version → Deploy. The URL stays the same.
