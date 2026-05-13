# Real-Time Evaluation & Adaptive Re-Optimization Platform

A full-stack web platform for evaluating and visualizing **Smart TV Scheduling Algorithms** in real time.

> The existing Python algorithms are **NOT reimplemented** — they are wrapped and called directly.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Angular (port 4200)                  │
│   Dashboard · Schedule View · Compare · SignalR client   │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP + SignalR (WebSocket)
┌──────────────────────────▼──────────────────────────────┐
│                 ASP.NET Core (port 5000)                  │
│   REST API · SignalR Hub · Proxy to Python              │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────┐
│                  Python FastAPI (port 8000)               │
│   Wraps existing operators, solvers, models             │
│   ConfigurableSolver — operators selected at runtime    │
└──────────────────────────┬──────────────────────────────┘
                           │ direct import
┌──────────────────────────▼──────────────────────────────┐
│           Existing Python Project (AIN_25-26/)           │
│   operators/ · solvers/ · models/ · evaluators/         │
└─────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
AIN_25-26/
├── python_api/              ← NEW: FastAPI microservice
│   ├── api.py               ← Endpoints: /run /compare /reoptimize /instances
│   ├── solver_wrapper.py    ← ConfigurableSolver (operator-selectable HC)
│   └── requirements.txt
│
├── backend/
│   └── SchedulingAPI/       ← NEW: ASP.NET Core Web API
│       ├── Controllers/ScheduleController.cs
│       ├── Hubs/ScheduleHub.cs          ← SignalR hub
│       ├── Services/PythonSchedulerService.cs
│       ├── Models/ScheduleModels.cs
│       └── Program.cs
│
├── frontend/
│   └── scheduling-dashboard/  ← NEW: Angular app
│       └── src/app/
│           ├── components/dashboard/        ← KPI cards + charts + operator panel
│           ├── components/schedule-view/    ← Timeline grid
│           ├── components/compare/          ← Algorithm comparison
│           ├── components/charts/           ← ApexCharts visualizations
│           ├── components/operator-panel/   ← Multi-select operator dropdown
│           ├── services/schedule.service.ts ← HTTP calls to backend
│           └── services/signalr.service.ts  ← Real-time SignalR client
│
├── (existing Python source — unchanged)
│   ├── operators/  evaluators/  models/  solvers/  io_utils/
│   ├── main.py
│   └── data/
│
├── start-python-api.ps1   ← Run Python FastAPI
├── start-backend.ps1      ← Run .NET backend
└── start-frontend.ps1     ← Run Angular
```

---

## Prerequisites

| Tool | Minimum Version |
|------|----------------|
| Python | 3.10+ |
| pip | latest |
| .NET SDK | 8.0 |
| Node.js | 18+ |
| Angular CLI | 17+ (`npm install -g @angular/cli`) |

---

## Quick Start

Open **three separate terminals**, all from the `AIN_25-26` directory:

### Terminal 1 — Python API
```powershell
pip install -r python_api/requirements.txt
uvicorn python_api.api:app --host 0.0.0.0 --port 8000 --reload
```
Swagger UI: http://localhost:8000/docs

### Terminal 2 — .NET Backend
```powershell
cd backend/SchedulingAPI
dotnet run --urls "http://localhost:5000"
```

### Terminal 3 — Angular Frontend
```powershell
cd frontend/scheduling-dashboard
npm install
npx ng serve --open
```
Opens: http://localhost:4200

---

## API Endpoints (Python FastAPI)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/instances` | List available instance files |
| GET | `/instance-info/{name}` | Instance metadata (channels, time range) |
| GET | `/solutions/{name}` | Available initial solutions |
| POST | `/run` | Run algorithm with selected operators |
| POST | `/compare` | Compare multiple configurations |
| POST | `/reoptimize` | Re-run with updated parameters |

### POST `/run` Request Body
```json
{
  "instance": "toy",
  "algorithm": "hill_climbing_restarts",
  "operators": ["insert", "replace", "swap", "shift_borders"],
  "maxIterations": 200,
  "numRestarts": 3,
  "insertionInterval": 50,
  "maxShift": 10
}
```

### Response includes
- `score` — final fitness
- `executionTime` — seconds
- `conflicts` — channel switches + timing violations
- `penaltyBreakdown` — base score, bonuses, penalties
- `operatorStats` — per-operator calls / improvements / score delta
- `progressHistory` — score at each iteration (for charts)
- `scheduledPrograms` — final schedule list

---

## API Endpoints (.NET Backend)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/schedule/run` | Proxy → Python `/run` + SignalR broadcast |
| POST | `/api/schedule/compare` | Proxy → Python `/compare` |
| POST | `/api/schedule/reoptimize` | Proxy → Python `/reoptimize` |
| GET | `/api/schedule/instances` | Forward instance list |
| GET | `/api/schedule/instance-info/{name}` | Forward instance info |

### SignalR Hub
- URL: `http://localhost:5000/hubs/schedule`
- Join group: `JoinInstanceGroup(instanceName)`
- Event: `ScheduleUpdate` → `{ status, message, result? }`

---

## Frontend Features

### Dashboard (`/dashboard`)
- KPI cards: Best Score, Execution Time, Active Operators, Conflicts
- Operator multi-select panel with auto-run on change
- Score Progression chart (line)
- Operator Effectiveness chart (bar: calls / improvements / delta)
- Before vs After comparison chart
- Score Composition donut chart
- Score breakdown table
- Operator effectiveness table with hit rate

### Schedule View (`/schedule`)
- Timeline grid: channels × time slots
- Programs displayed as colored blocks by genre
- Real-time updates via SignalR
- Manual override tracking (detects conflicts visually)

### Compare (`/compare`)
- Create up to N operator configurations
- Run all configurations in parallel
- Side-by-side results table
- Bar charts: Score / Time / Conflicts per configuration
- Radar chart: multi-metric overview

---

## Available Operators

| Operator | Description |
|----------|-------------|
| `insert` | Insert unscheduled programs into free gaps |
| `replace` | Replace a scheduled program with an unscheduled one |
| `shift` | Shift program left/right in time |
| `swap` | Swap time slots between two programs |
| `shift_borders` | Expand or shrink program duration at borders |

Operators are passed directly to the existing Python implementations.  
The `ConfigurableSolver` in `python_api/solver_wrapper.py` selects only the enabled operators.

---

## Configuration

### Python API
No configuration file needed. Instance data is read from `data/input/`, initial solutions from `data/solutions/constructiveapproach/` and `data/solutions/dp_segmenting/`.

### .NET Backend — `appsettings.json`
```json
{
  "PythonApiUrl": "http://localhost:8000",
  "AllowedOrigins": ["http://localhost:4200"]
}
```

### Angular — `src/environments/environment.ts`
```typescript
export const environment = {
  apiUrl: 'http://localhost:5000/api',
  signalrUrl: 'http://localhost:5000/hubs/schedule',
};
```

---

## Notes for Academic Demo

- The platform reuses all existing Python algorithm code without modification.
- The `ConfigurableSolver` adapts the Hill Climbing + Restarts framework to use only selected operators, making operator selection affect actual algorithm behavior.
- Real-time updates via SignalR allow live visualization as the algorithm progresses.
- The Compare view is designed for research demonstrations showing how different operator sets affect solution quality and efficiency.
