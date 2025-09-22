# Ocean Jobs – Job Search Frontend (No Auth)

A modern React frontend for searching jobs, filtering results, viewing salary info, tracking applications locally, and setting up local browser alerts. No login/signup or backend required.

## Highlights
- No authentication; everything is client-side.
- Search jobs with filters (keyword, location, job type).
- Salary display (when provided by API).
- Application tracking dashboard (stored in localStorage).
- Local job alerts via browser notifications or toast fallbacks.
- Ocean Professional theme (blues with amber accents), responsive layout.
- Uses Remotive public API by default (no API key required).
- Optional JSearch support via RapidAPI; add a key to `.env`.

## Quick Start
```bash
npm install
npm start
```
Open http://localhost:3000

## Data Providers
- Default: Remotive API (no key). Endpoint: https://remotive.com/api/remote-jobs
- Optional: JSearch (RapidAPI). Set REACT_APP_JSEARCH_KEY in `.env` (see `.env.example`).

Switch provider from the Filters sidebar or search panel.

## Environment Variables
Create `.env` and set:
```
REACT_APP_JSEARCH_KEY=your_rapidapi_key_here
```
Do NOT commit your `.env`.

## Local Storage Keys
- Applications: `jobhub_applications`
- Alerts: `jobhub_alerts`
- Preferences: `jobhub_prefs`

## Notifications
Use the Alerts panel to create periodic reminders. Grant notification permission when prompted. Alerts run locally in the browser; no server.

## UX Behaviors
- Loading, empty, and error states are visible in the Results panel.
- Search input debounced for fewer API calls.
- Accessible buttons/labels and ARIA regions.

## Notes
This is a frontend-only demo; no database or backend. Feel free to extend styles/components.
