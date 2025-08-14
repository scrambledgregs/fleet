# SDC Frontend — Week Planner Demo
Adds a **Week Planner** tab that lists this week's appointments and lets you click **Suggest** to call the backend `/ghl/appointment-created` endpoint. 
The result (Auto-booked or Awaiting Approval) appears inline with a **reason**.

## Run
```bash
npm install
npm run dev
```
Default backend URL: `http://localhost:8080` (override with `VITE_API_BASE`).

## Notes
- If your backend provides `/api/week-appointments`, the planner will use it; otherwise it falls back to mock data.
- Clicking **Suggest** posts a payload matching the backend webhook and displays the top decision.
