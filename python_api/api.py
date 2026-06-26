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
import re
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
from python_api.benchmark_data import (
    BENCHMARK_ALGORITHMS,
    BENCHMARK_ROWS,
    REQUESTED_GROUPS,
)
from python_api.solver_wrapper import ConfigurableSolver
from scheduling_intelligent_ils.intelligent_ils_scheduler import IntelligentILSSolver
from solvers.classic_ils_solver import IteratedLocalSearchSolver
from solvers.gls_solver import GuidedLocalSearchSolver

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


NAMED_SOLVER_OPERATORS = {
    "ils": ["swap", "shift_borders", "insert", "replace"],
    "classic_ils": ["swap", "shift_borders", "insert", "replace"],
    "intelligent_ils": ["swap", "shift_borders", "insert", "replace"],
    "gls": ["swap", "shift_borders", "insert", "replace", "remove"],
}

LIVE_ALGORITHM_ALIASES = {
    "classic_ils": "ils",
    "iterated_local_search": "ils",
    "hils": "intelligent_ils",
    "guided_local_search": "gls",
}


def _canonical_algorithm(algorithm: str) -> str:
    key = (algorithm or "hill_climbing_restarts").strip().lower()
    return LIVE_ALGORITHM_ALIASES.get(key, key)


def _score_from_filename(path: Path) -> Optional[int]:
    matches = re.findall(r"_(\d+)(?=\.json$)", path.name)
    return int(matches[-1]) if matches else None


def _find_solution_file(instance_name: str, folder_name: Optional[str]) -> Optional[Path]:
    if not folder_name:
        return None

    folder = DATA_DIR / "solutions" / folder_name
    if not folder.exists():
        return None

    base_name = instance_name.replace("_input", "")
    candidates = list(folder.glob(f"{base_name}*.json"))

    if not candidates:
        return None

    return max(
        sorted(candidates),
        key=lambda path: (_score_from_filename(path) is not None, _score_from_filename(path) or -1),
    )


def _vs_ilp(score: Optional[float], ilp_score: Optional[float]) -> Optional[float]:
    if score is None or not ilp_score:
        return None
    return round((ilp_score - score) / ilp_score, 10)


def _score_status(score: Optional[float], ilp_score: Optional[float]) -> str:
    if score is None:
        return "missing"
    if ilp_score is None:
        return "available"
    if score > ilp_score:
        return "better_than_ilp"
    if score == ilp_score:
        return "equal_to_ilp"
    return "below_ilp"


def _build_benchmark_row(row: Dict[str, Any]) -> Dict[str, Any]:
    cells: Dict[str, Any] = {}

    for algorithm in BENCHMARK_ALGORITHMS:
        key = algorithm["key"]
        score = row["ilp_score"] if key == "ilp" else row["scores"].get(key)
        source_file = _find_solution_file(row["instance"], algorithm.get("folder"))

        cells[key] = {
            "algorithm": key,
            "label": algorithm["label"],
            "score": score,
            "vs_ilp": _vs_ilp(score, row["ilp_score"]),
            "status": _score_status(score, row["ilp_score"]),
            "source": "spreadsheet",
            "source_file": (
                str(source_file.relative_to(DATA_DIR / "solutions")).replace("\\", "/")
                if source_file
                else None
            ),
            "source_available": key == "ilp" or source_file is not None,
            "requested": algorithm.get("requested", False),
        }

    return {
        "index": row["index"],
        "instance": row["instance"],
        "display_name": row["display_name"],
        "instance_type": row["instance_type"],
        "ilp_score": row["ilp_score"],
        "ilp_status": row["ilp_status"],
        "cells": cells,
    }


def _benchmark_rows(instance_name: Optional[str] = None) -> List[Dict[str, Any]]:
    normalized = instance_name.replace("_input", "") if instance_name else None
    return [
        _build_benchmark_row(row)
        for row in BENCHMARK_ROWS
        if normalized is None or row["instance"] == normalized
    ]


def _get_instance_path(instance_name: str) -> Path:
    for candidate in [
        DATA_DIR / "input" / f"{instance_name}.json",
        DATA_DIR / "input" / f"{instance_name}_input.json",
    ]:
        if candidate.exists():
            return candidate
    raise HTTPException(status_code=404, detail=f"Instance '{instance_name}' not found in data/input/")


def _stop_requested(stop_event) -> bool:
    return stop_event is not None and stop_event.is_set()


def _load_best_initial_solution(instance, instance_name: str, stop_event=None) -> Solution:
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
        if _stop_requested(stop_event):
            raise RuntimeError("Run stopped by user")

        if not search_dir.exists():
            continue
        for file_path in search_dir.glob(f"{base_name}*.json"):
            if _stop_requested(stop_event):
                raise RuntimeError("Run stopped by user")

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


def _compute_solution_metrics(solution: Solution, instance) -> tuple[int, Dict[str, Any]]:
    schedule = solution.selected.scheduled_programs
    program_lookup = {
        (ch.channel_id, p.program_id): p
        for ch in instance.channels
        for p in ch.programs
    }

    channel_switches = 0
    timing_penalties = 0
    base_score = 0
    bonus_earned = 0

    for i, sp in enumerate(schedule):
        orig = program_lookup.get((sp.channel_id, sp.program_id))
        if orig:
            base_score += orig.score
            for tp in instance.time_preferences:
                if orig.genre == tp.preferred_genre:
                    overlap = max(0, min(sp.end, tp.end) - max(sp.start, tp.start))
                    if overlap >= instance.min_duration:
                        bonus_earned += tp.bonus
            if sp.start > orig.start:
                timing_penalties += 1
            if sp.end < orig.end:
                timing_penalties += 1

        if i > 0 and schedule[i - 1].channel_id != sp.channel_id:
            channel_switches += 1

    conflicts = channel_switches + timing_penalties
    return conflicts, {
        "base_score": base_score,
        "bonus_earned": bonus_earned,
        "channel_switches": channel_switches,
        "switch_penalty_total": channel_switches * instance.switch_penalty,
        "timing_violations": timing_penalties,
        "timing_penalty_total": timing_penalties * instance.termination_penalty,
        "final_score": solution.fitness,
    }


def _solution_to_result(
    solution: Solution,
    instance,
    request: RunRequest,
    initial_score: float,
    execution_time: float,
    progress_history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    conflicts, penalty_breakdown = _compute_solution_metrics(solution, instance)
    algorithm = _canonical_algorithm(request.algorithm)

    return {
        "score": solution.fitness,
        "execution_time": round(execution_time, 3),
        "conflicts": conflicts,
        "penalty_breakdown": penalty_breakdown,
        "operator_stats": None,
        "progress_history": progress_history or [
            {
                "iteration": 0,
                "score": initial_score,
                "current_score": initial_score,
                "best_score": initial_score,
            },
            {
                "iteration": 1,
                "score": solution.fitness,
                "current_score": solution.fitness,
                "best_score": solution.fitness,
            },
        ],
        "scheduled_programs": [
            {
                "program_id": sp.program_id,
                "channel_id": sp.channel_id,
                "start": sp.start,
                "end": sp.end,
            }
            for sp in solution.selected.scheduled_programs
        ],
        "initial_score": initial_score,
        "algorithm": algorithm,
        "operators": NAMED_SOLVER_OPERATORS.get(algorithm, request.operators),
        "instance": request.instance,
        "score_improvement": round(solution.fitness - initial_score, 2),
    }


def _run_named_solver(
    request: RunRequest,
    instance,
    initial_solution: Solution,
    initial_score: float,
    progress_callback=None,
    stop_event=None,
) -> Dict[str, Any]:
    algorithm = _canonical_algorithm(request.algorithm)
    solver_by_algorithm = {
        "ils": IteratedLocalSearchSolver,
        "intelligent_ils": IntelligentILSSolver,
        "gls": GuidedLocalSearchSolver,
    }

    solver_cls = solver_by_algorithm.get(algorithm)
    if solver_cls is None:
        raise HTTPException(status_code=400, detail=f"Unsupported algorithm '{request.algorithm}'")

    progress_history = [
        {
            "iteration": 0,
            "score": initial_score,
            "current_score": initial_score,
            "best_score": initial_score,
        }
    ]
    if progress_callback:
        progress_callback(progress_history[0])

    if _stop_requested(stop_event):
        raise RuntimeError("Run stopped before the solver started")

    started = time.time()
    solver = solver_cls(deepcopy(initial_solution))
    solver.stop_event = stop_event
    best_solution = solver.solve(instance)
    execution_time = time.time() - started

    final_point = {
        "iteration": 1,
        "score": best_solution.fitness,
        "current_score": best_solution.fitness,
        "best_score": best_solution.fitness,
    }
    progress_history.append(final_point)
    if progress_callback:
        progress_callback(final_point)

    return _solution_to_result(
        best_solution,
        instance,
        request,
        initial_score,
        execution_time,
        progress_history,
    )


def _run(request: RunRequest, progress_callback=None, stop_event=None) -> Dict[str, Any]:
    instance_path = _get_instance_path(request.instance)
    instance = InstanceParser(str(instance_path)).parse()
    if _stop_requested(stop_event):
        raise RuntimeError("Run stopped by user")

    initial_solution = _load_best_initial_solution(instance, request.instance, stop_event=stop_event)
    initial_score = initial_solution.fitness
    algorithm = _canonical_algorithm(request.algorithm)

    if algorithm in NAMED_SOLVER_OPERATORS:
        return _run_named_solver(
            request,
            instance,
            initial_solution,
            initial_score,
            progress_callback=progress_callback,
            stop_event=stop_event,
        )

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

    result = solver.solve(progress_callback=progress_callback, stop_event=stop_event)
    result["initial_score"] = initial_score
    result["algorithm"] = algorithm
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


@app.get("/benchmark-results")
def benchmark_results(instance: Optional[str] = None):
    """Return spreadsheet-style benchmark rows enriched with local result files."""
    rows = _benchmark_rows(instance)
    if instance and not rows:
        raise HTTPException(status_code=404, detail=f"No benchmark row found for '{instance}'")

    return {
        "algorithms": BENCHMARK_ALGORITHMS,
        "requested_groups": REQUESTED_GROUPS,
        "rows": rows,
    }


@app.get("/benchmark-compare/{instance_name}")
def benchmark_compare(instance_name: str, scope: str = "requested"):
    """Return a CompareResult-shaped payload from the spreadsheet benchmark values."""
    rows = _benchmark_rows(instance_name)
    if not rows:
        raise HTTPException(status_code=404, detail=f"No benchmark row found for '{instance_name}'")

    row = rows[0]
    include_requested_only = scope != "all"
    results = []

    for algorithm in BENCHMARK_ALGORITHMS:
        if algorithm["key"] == "ilp":
            continue
        if include_requested_only and not algorithm.get("requested", False):
            continue

        cell = row["cells"].get(algorithm["key"])
        if not cell or cell["score"] is None:
            continue

        results.append({
            "score": cell["score"],
            "execution_time": 0,
            "conflicts": 0,
            "initial_score": row["ilp_score"],
            "score_improvement": round(cell["score"] - row["ilp_score"], 2),
            "algorithm": algorithm["key"],
            "instance": row["instance"],
            "operators": [],
            "penalty_breakdown": None,
            "operator_stats": None,
            "progress_history": [
                {
                    "iteration": 0,
                    "score": row["ilp_score"],
                    "current_score": row["ilp_score"],
                    "best_score": row["ilp_score"],
                },
                {
                    "iteration": 1,
                    "score": cell["score"],
                    "current_score": cell["score"],
                    "best_score": cell["score"],
                },
            ],
            "scheduled_programs": [],
            "label": algorithm["label"],
            "vs_ilp": cell["vs_ilp"],
            "source": cell["source"],
            "source_file": cell["source_file"],
        })

    if not results:
        raise HTTPException(status_code=404, detail=f"No benchmark results found for '{instance_name}'")

    best = max(results, key=lambda r: r["score"])
    return {
        "instance": row["instance"],
        "results": results,
        "best_label": best["label"],
        "best_score": best["score"],
    }


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
    progress_q: stdlib_queue.Queue = stdlib_queue.Queue()
    stop_event = threading.Event()

    def run_solver():
        try:
            result = _run(
                request_data,
                progress_callback=lambda p: progress_q.put({"type": "progress", **p}),
                stop_event=stop_event,
            )
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
