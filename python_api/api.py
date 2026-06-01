"""
FastAPI microservice that wraps the existing Python TV Scheduling algorithms.

Run from the AIN_25-26 project root:
    uvicorn python_api.api:app --host 0.0.0.0 --port 8000 --reload

All existing Python modules (models, operators, solvers, etc.) are imported
directly — nothing is reimplemented here.
"""
import asyncio
import json as stdlib_json
import queue as stdlib_queue
import sys
import threading
import time
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure the project root is importable so existing Python modules are found
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

DATA_DIR = ROOT_DIR / "data"

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from evaluators.base_evaluator import BaseEvaluator
from io_utils.initial_solution_parser import SolutionParser
from io_utils.instance_parser import InstanceParser
from models.solution.solution import Solution
from python_api.solver_wrapper import ConfigurableSolver

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="TV Scheduling API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic request / response schemas
# ---------------------------------------------------------------------------


class RunRequest(BaseModel):
    instance: str = Field(..., description="Instance name without extension, e.g. 'toy'")
    algorithm: str = Field(default="hill_climbing_restarts")
    operators: List[str] = Field(default=["replace", "swap", "shift_borders"])
    max_iterations: int = Field(default=200, ge=1, le=5000)
    num_restarts: int = Field(default=3, ge=1, le=50)
    insertion_interval: int = Field(default=50, ge=1, le=1000)
    max_shift: int = Field(default=10, ge=1, le=200)
    max_execution_seconds: int = Field(default=30, ge=1, le=3600)


class ConfigEntry(BaseModel):
    label: str = "Config"
    operators: List[str] = ["replace", "swap", "shift_borders"]
    max_iterations: int = 200
    num_restarts: int = 3
    insertion_interval: int = 50
    max_shift: int = 10
    max_execution_seconds: int = 30


class CompareRequest(BaseModel):
    instance: str
    configurations: List[ConfigEntry]


class ReoptimizeRequest(BaseModel):
    instance: str
    operators: List[str] = ["replace", "swap", "shift_borders"]
    max_iterations: int = 200
    num_restarts: int = 3
    insertion_interval: int = 50
    max_shift: int = 10
    max_execution_seconds: int = 30


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_instance_path(instance_name: str) -> Path:
    for candidate in [
        DATA_DIR / "input" / f"{instance_name}.json",
        DATA_DIR / "input" / f"{instance_name}_input.json",
    ]:
        if candidate.exists():
            return candidate
    raise HTTPException(status_code=404, detail=f"Instance '{instance_name}' not found in data/input/")


def _load_best_initial_solution(instance, instance_name: str) -> Solution:
    """
    Load the highest-fitness initial solution available for the given instance.
    Searches constructiveapproach/ and dp_segmenting/ folders.
    """
    base_name = instance_name.replace("_input", "")
    search_dirs = [
        DATA_DIR / "solutions" / "constructiveapproach",
        DATA_DIR / "solutions" / "dp_segmenting",
    ]

    best_sol: Optional[Solution] = None
    best_fitness = float("-inf")

    for search_dir in search_dirs:
        if not search_dir.exists():
            continue
        for file_path in search_dir.glob(f"{base_name}*.json"):
            try:
                schedule = SolutionParser(str(file_path)).parse()
                evaluator = BaseEvaluator(instance)
                selected_ids = {p.program_id for p in schedule}
                unselected = [
                    p.program_id
                    for ch in instance.channels
                    for p in ch.programs
                    if p.program_id not in selected_ids
                ]
                sol = Solution(evaluator=evaluator, selected=schedule, unselected_ids=unselected)
                if sol.fitness > best_fitness:
                    best_fitness = sol.fitness
                    best_sol = sol
            except Exception:
                continue

    if best_sol is None:
        raise HTTPException(
            status_code=404,
            detail=f"No initial solution found for instance '{instance_name}'. "
                   f"Expected files in data/solutions/constructiveapproach/ or data/solutions/dp_segmenting/",
        )
    return best_sol


def _run(request: RunRequest) -> Dict[str, Any]:
    instance_path = _get_instance_path(request.instance)
    instance = InstanceParser(str(instance_path)).parse()
    initial_solution = _load_best_initial_solution(instance, request.instance)
    initial_score = initial_solution.fitness

    solver = ConfigurableSolver(
        solution=initial_solution,
        instance=instance,
        enabled_operators=request.operators,
        max_iterations=request.max_iterations,
        num_restarts=request.num_restarts,
        insertion_interval=request.insertion_interval,
        max_shift=request.max_shift,
        max_execution_seconds=request.max_execution_seconds,
    )

    result = solver.solve()
    result["initial_score"] = initial_score
    result["algorithm"] = request.algorithm
    result["operators"] = request.operators
    result["instance"] = request.instance
    result["score_improvement"] = round(result["score"] - initial_score, 2)
    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok", "data_dir": str(DATA_DIR)}


@app.get("/instances")
def list_instances():
    """Return all available instance files."""
    input_dir = DATA_DIR / "input"
    if not input_dir.exists():
        return {"instances": []}
    instances = []
    for f in sorted(input_dir.glob("*.json")):
        name = f.stem.replace("_input", "")
        instances.append({"name": name, "file": f.name})
    return {"instances": instances}


@app.get("/solutions/{instance_name}")
def list_solutions(instance_name: str):
    """Return available initial solutions for the given instance."""
    base_name = instance_name.replace("_input", "")
    search_dirs = [
        DATA_DIR / "solutions" / "constructiveapproach",
        DATA_DIR / "solutions" / "dp_segmenting",
    ]
    solutions = []
    for search_dir in search_dirs:
        if not search_dir.exists():
            continue
        for f in sorted(search_dir.glob(f"{base_name}*.json")):
            solutions.append({"folder": search_dir.name, "file": f.name})
    return {"solutions": solutions}


@app.get("/instance-info/{instance_name}")
def instance_info(instance_name: str):
    """Return metadata for an instance (channels, time range, etc.)."""
    instance_path = _get_instance_path(instance_name)
    instance = InstanceParser(str(instance_path)).parse()
    return {
        "instance": instance_name,
        "opening_time": instance.opening_time,
        "closing_time": instance.closing_time,
        "min_duration": instance.min_duration,
        "channels_count": instance.channels_count,
        "switch_penalty": instance.switch_penalty,
        "termination_penalty": instance.termination_penalty,
        "channels": [
            {
                "channel_id": ch.channel_id,
                "channel_name": ch.channel_name,
                "program_count": len(ch.programs),
                "programs": [
                    {
                        "program_id": p.program_id,
                        "start": p.start,
                        "end": p.end,
                        "genre": p.genre,
                        "score": p.score,
                    }
                    for p in ch.programs
                ],
            }
            for ch in instance.channels
        ],
        "time_preferences": [
            {
                "start": tp.start,
                "end": tp.end,
                "preferred_genre": tp.preferred_genre,
                "bonus": tp.bonus,
            }
            for tp in instance.time_preferences
        ],
        "priority_blocks": [
            {
                "start": pb.start,
                "end": pb.end,
                "allowed_channels": pb.allowed_channels,
            }
            for pb in instance.priority_blocks
        ],
    }


@app.post("/run")
def run_algorithm(request: RunRequest):
    """Run the scheduling algorithm with the selected operators and parameters."""
    return _run(request)


@app.post("/run-stream")
async def run_algorithm_stream(request_data: RunRequest, http_request: Request):
    """
    SSE endpoint that streams progress snapshots in real-time while the solver runs.
    Each event is a JSON object with a 'type' field:
      - {"type": "progress", "iteration": N, "score": S}  – live snapshot
      - {"type": "result",   ...full result fields...}     – final result on success
      - {"type": "error",    "message": "..."}             – on failure
      - {"type": "cancelled"}                              – if client disconnects early
    """
    try:
        instance_path = _get_instance_path(request_data.instance)
        instance = InstanceParser(str(instance_path)).parse()
        initial_solution = _load_best_initial_solution(instance, request_data.instance)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    solver = ConfigurableSolver(
        solution=initial_solution,
        instance=instance,
        enabled_operators=request_data.operators,
        max_iterations=request_data.max_iterations,
        num_restarts=request_data.num_restarts,
        insertion_interval=request_data.insertion_interval,
        max_shift=request_data.max_shift,
        max_execution_seconds=request_data.max_execution_seconds,
    )

    progress_q: stdlib_queue.Queue = stdlib_queue.Queue()
    stop_event = threading.Event()
    initial_score = initial_solution.fitness

    def run_solver():
        try:
            result = solver.solve(
                progress_callback=lambda p: progress_q.put({"type": "progress", **p}),
                stop_event=stop_event,
            )
            result["initial_score"] = initial_score
            result["score_improvement"] = round(result["score"] - initial_score, 2)
            result["algorithm"] = request_data.algorithm
            result["instance"] = request_data.instance
            result["operators"] = request_data.operators
            progress_q.put({"type": "result", **result})
        except Exception as exc:
            progress_q.put({"type": "error", "message": str(exc)})

    thread = threading.Thread(target=run_solver, daemon=True)
    thread.start()

    async def event_stream():
        try:
            while True:
                if await http_request.is_disconnected():
                    stop_event.set()
                    yield f"data: {stdlib_json.dumps({'type': 'cancelled'})}\n\n"
                    break

                try:
                    item = progress_q.get_nowait()
                    yield f"data: {stdlib_json.dumps(item)}\n\n"
                    if item["type"] in ("result", "error", "cancelled"):
                        break
                except stdlib_queue.Empty:
                    await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            stop_event.set()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/compare")
def compare_configurations(request: CompareRequest):
    """Run multiple operator/parameter configurations and return side-by-side results."""
    instance_path = _get_instance_path(request.instance)
    instance = InstanceParser(str(instance_path)).parse()

    results = []
    for cfg in request.configurations:
        initial_solution = _load_best_initial_solution(instance, request.instance)
        initial_score = initial_solution.fitness

        solver = ConfigurableSolver(
            solution=initial_solution,
            instance=instance,
            enabled_operators=cfg.operators,
            max_iterations=cfg.max_iterations,
            num_restarts=cfg.num_restarts,
            insertion_interval=cfg.insertion_interval,
            max_shift=cfg.max_shift,
            max_execution_seconds=cfg.max_execution_seconds,
        )
        result = solver.solve()
        result["label"] = cfg.label
        result["operators"] = cfg.operators
        result["initial_score"] = initial_score
        result["score_improvement"] = round(result["score"] - initial_score, 2)
        results.append(result)

    best = max(results, key=lambda r: r["score"])
    return {
        "instance": request.instance,
        "results": results,
        "best_label": best["label"],
        "best_score": best["score"],
    }


@app.post("/reoptimize")
def reoptimize(request: ReoptimizeRequest):
    """Re-run optimization with updated parameters (used when user tweaks settings)."""
    return _run(
        RunRequest(
            instance=request.instance,
            operators=request.operators,
            max_iterations=request.max_iterations,
            num_restarts=request.num_restarts,
            insertion_interval=request.insertion_interval,
            max_shift=request.max_shift,
            max_execution_seconds=request.max_execution_seconds,
        )
    )
