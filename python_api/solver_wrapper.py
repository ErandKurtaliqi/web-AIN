"""
Configurable solver wrapper that makes operators dynamically selectable.
Reuses existing operator and model implementations from the project root.
Only operators present in enabled_operators are used during optimization.
"""
import random
import time
from copy import deepcopy
from typing import List, Dict, Any, Optional

from models.instance.instance_data import InstanceData
from models.solution.solution import Solution
from operators.insert import insert_best
from operators.replace import replace
from operators.shift import shift, ShiftDirection
from operators.shift_borders import shift_borders, Mode, TargetBorder
from operators.swap import swap


class ConfigurableSolver:
    """
    Hill Climbing with Random Restarts using a configurable operator set.
    Tracks per-operator statistics (calls, improvements, score delta).
    """

    AVAILABLE_OPERATORS = ["insert", "replace", "shift", "swap", "shift_borders"]

    def __init__(
        self,
        solution: Solution,
        instance: InstanceData,
        enabled_operators: List[str],
        max_iterations: int = 300,
        num_restarts: int = 3,
        insertion_interval: int = 50,
        max_shift: int = 10,
        max_execution_seconds: int = 30,
    ) -> None:
        self.initial_solution = deepcopy(solution)
        self.instance = instance
        self.enabled_operators = set(
            op for op in enabled_operators if op in self.AVAILABLE_OPERATORS
        )
        self.max_iterations = max(1, max_iterations)
        self.num_restarts = max(1, num_restarts)
        self.insertion_interval = max(1, insertion_interval)
        self.max_shift = max(1, max_shift)
        self.max_execution_seconds = max(1, max_execution_seconds)

        self.operator_stats: Dict[str, Dict[str, Any]] = {
            op: {"calls": 0, "improvements": 0, "score_delta": 0.0}
            for op in self.AVAILABLE_OPERATORS
        }
        self.progress_history: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def solve(self, progress_callback=None, stop_event=None) -> Dict[str, Any]:
        """
        Run the solver.

        Args:
            progress_callback: Optional callable(dict) invoked after each recorded snapshot.
            stop_event:         Optional threading.Event; when set the run is aborted early.
        """
        start_time = time.time()
        global_best = deepcopy(self.initial_solution)
        self.progress_history = []

        mutation_ops = [op for op in self.enabled_operators if op != "insert"]
        use_insert = "insert" in self.enabled_operators

        record_every = max(1, self.max_iterations // 30)
        stopped_early = False

        for restart in range(self.num_restarts):
            if stop_event and stop_event.is_set():
                stopped_early = True
                break
            if time.time() - start_time >= self.max_execution_seconds:
                stopped_early = True
                break

            current = (
                deepcopy(self.initial_solution)
                if restart == 0
                else self._perturb(global_best)
            )

            for i in range(self.max_iterations):
                if stop_event and stop_event.is_set():
                    stopped_early = True
                    break
                if time.time() - start_time >= self.max_execution_seconds:
                    stopped_early = True
                    break

                global_iter = restart * self.max_iterations + i

                # Insertion operator fires every insertion_interval iterations
                if use_insert and i > 0 and i % self.insertion_interval == 0:
                    current = self._apply_insert(current)

                # Pick a random mutation operator from enabled set
                if mutation_ops:
                    op_name = random.choice(mutation_ops)
                    prev_fitness = current.fitness
                    neighbor = self._apply_operator(op_name, current)
                    self.operator_stats[op_name]["calls"] += 1

                    if neighbor is not None:
                        if neighbor.fitness > current.fitness:
                            delta = neighbor.fitness - prev_fitness
                            self.operator_stats[op_name]["improvements"] += 1
                            self.operator_stats[op_name]["score_delta"] += delta
                            current = neighbor
                        elif neighbor.fitness == current.fitness:
                            current = neighbor  # accept neutral moves for plateau escape

                # Update global best
                if current.fitness > global_best.fitness:
                    global_best = deepcopy(current)

                # Record progress snapshot and fire callback
                if global_iter % record_every == 0:
                    point = {
                        "iteration": global_iter,
                        "score": global_best.fitness,
                        "current_score": current.fitness,
                        "best_score": global_best.fitness,
                    }
                    self.progress_history.append(point)
                    if progress_callback:
                        try:
                            progress_callback(point)
                        except Exception:
                            pass

            if not stopped_early:
                # Record final state after each restart
                final_point = {
                    "iteration": (restart + 1) * self.max_iterations,
                    "score": global_best.fitness,
                    "current_score": current.fitness,
                    "best_score": global_best.fitness,
                }
                self.progress_history.append(final_point)
                if progress_callback:
                    try:
                        progress_callback(final_point)
                    except Exception:
                        pass

        execution_time = time.time() - start_time
        conflicts, penalty_breakdown = self._compute_metrics(global_best)

        return {
            "score": global_best.fitness,
            "execution_time": round(execution_time, 3),
            "conflicts": conflicts,
            "penalty_breakdown": penalty_breakdown,
            "operator_stats": self.operator_stats,
            "progress_history": self.progress_history,
            "scheduled_programs": [
                {
                    "program_id": sp.program_id,
                    "channel_id": sp.channel_id,
                    "start": sp.start,
                    "end": sp.end,
                }
                for sp in global_best.selected.scheduled_programs
            ],
        }

    # ------------------------------------------------------------------
    # Operator dispatch
    # ------------------------------------------------------------------

    def _apply_insert(self, solution: Solution) -> Solution:
        prev = solution.fitness
        try:
            result = insert_best(solution, self.instance)
            self.operator_stats["insert"]["calls"] += 1
            if result and result.fitness > prev:
                self.operator_stats["insert"]["improvements"] += 1
                self.operator_stats["insert"]["score_delta"] += result.fitness - prev
                return result
        except Exception:
            pass
        return solution

    def _apply_operator(self, op_name: str, solution: Solution) -> Optional[Solution]:
        try:
            scheduled = list(solution.selected.scheduled_programs)

            if op_name == "replace":
                return replace(solution, self.instance)

            if op_name == "swap" and len(scheduled) >= 2:
                p1, p2 = random.sample(scheduled, 2)
                return swap(self.instance, solution, p1, p2)

            if op_name == "shift_borders" and scheduled:
                program = random.choice(scheduled)
                mode = random.choice(list(Mode))
                direction = random.choice(list(TargetBorder))
                shamt = random.randint(1, self.max_shift)
                return shift_borders(self.instance, solution, program, mode, direction, shamt)

            if op_name == "shift" and scheduled:
                program = random.choice(scheduled)
                direction = random.choice(list(ShiftDirection))
                shamt = random.randint(1, self.max_shift)
                return shift(self.instance, solution, program, direction, shamt)

        except Exception:
            pass
        return solution

    def _perturb(self, solution: Solution) -> Solution:
        """Random perturbation for restart diversity."""
        perturbed = deepcopy(solution)
        mutation_ops = [op for op in self.enabled_operators if op != "insert"]
        if not mutation_ops:
            return perturbed
        for _ in range(random.randint(3, 8)):
            op_name = random.choice(mutation_ops)
            result = self._apply_operator(op_name, perturbed)
            if result is not None:
                perturbed = result
        return perturbed

    # ------------------------------------------------------------------
    # Metrics
    # ------------------------------------------------------------------

    def _compute_metrics(self, solution: Solution):
        """Compute conflict count and detailed penalty breakdown."""
        schedule = solution.selected.scheduled_programs
        program_lookup = {
            (ch.channel_id, p.program_id): p
            for ch in self.instance.channels
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
                for tp in self.instance.time_preferences:
                    if orig.genre == tp.preferred_genre:
                        overlap = max(0, min(sp.end, tp.end) - max(sp.start, tp.start))
                        if overlap >= self.instance.min_duration:
                            bonus_earned += tp.bonus
                if sp.start > orig.start:
                    timing_penalties += 1
                if sp.end < orig.end:
                    timing_penalties += 1

            if i > 0 and schedule[i - 1].channel_id != sp.channel_id:
                channel_switches += 1

        conflicts = channel_switches + timing_penalties
        penalty_breakdown = {
            "base_score": base_score,
            "bonus_earned": bonus_earned,
            "channel_switches": channel_switches,
            "switch_penalty_total": channel_switches * self.instance.switch_penalty,
            "timing_violations": timing_penalties,
            "timing_penalty_total": timing_penalties * self.instance.termination_penalty,
            "final_score": solution.fitness,
        }
        return conflicts, penalty_breakdown
