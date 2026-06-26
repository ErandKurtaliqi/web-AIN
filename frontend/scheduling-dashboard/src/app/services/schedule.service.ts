import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  RunRequest, CompareRequest,
  ScheduleResult, CompareResult, InstanceInfo,
  BenchmarkResponse, BenchmarkRow, BenchmarkCell,
} from '../models/schedule.models';

@Injectable({ providedIn: 'root' })
export class ScheduleService {

  private readonly base = environment.apiUrl + '/schedule';

  constructor(private http: HttpClient) {}

  getInstances(): Observable<{ instances: { name: string; file: string }[] }> {
    return this.http.get<{ instances: { name: string; file: string }[] }>(`${this.base}/instances`);
  }

  getInstanceInfo(name: string): Observable<InstanceInfo> {
    return this.http.get<any>(`${this.base}/instance-info/${name}`).pipe(
      map(raw => ({
        instance: raw.instance,
        openingTime: raw.openingTime ?? raw.opening_time,
        closingTime: raw.closingTime ?? raw.closing_time,
        minDuration: raw.minDuration ?? raw.min_duration,
        channelsCount: raw.channelsCount ?? raw.channels_count,
        switchPenalty: raw.switchPenalty ?? raw.switch_penalty,
        terminationPenalty: raw.terminationPenalty ?? raw.termination_penalty,
        channels: (raw.channels ?? []).map((ch: any) => ({
          channelId: ch.channelId ?? ch.channel_id,
          channelName: ch.channelName ?? ch.channel_name,
          programCount: ch.programCount ?? ch.program_count,
          programs: (ch.programs ?? []).map((p: any) => ({
            programId: p.programId ?? p.program_id,
            start: p.start,
            end: p.end,
            genre: p.genre,
            score: p.score,
          })),
        })),
        timePreferences: (raw.timePreferences ?? raw.time_preferences ?? []).map((tp: any) => ({
          start: tp.start,
          end: tp.end,
          preferredGenre: tp.preferredGenre ?? tp.preferred_genre,
          bonus: tp.bonus,
        })),
        priorityBlocks: (raw.priorityBlocks ?? raw.priority_blocks ?? []).map((pb: any) => ({
          start: pb.start,
          end: pb.end,
          allowedChannels: pb.allowedChannels ?? pb.allowed_channels,
        })),
      })),
    );
  }

  getBenchmarkResults(instance?: string): Observable<BenchmarkResponse> {
    const query = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return this.http.get<any>(`${this.base}/benchmark-results${query}`).pipe(
      map(raw => ({
        algorithms: raw.algorithms ?? [],
        requestedGroups: (raw.requestedGroups ?? raw.requested_groups ?? []).map((group: any) => ({
          group: group.group,
          algorithmKeys: group.algorithmKeys ?? group.algorithm_keys ?? [],
          status: group.status,
          note: group.note,
        })),
        rows: (raw.rows ?? []).map((row: any) => this.mapBenchmarkRow(row)),
      })),
    );
  }

  getBenchmarkCompare(instance: string, scope: 'requested' | 'all' = 'requested'): Observable<CompareResult> {
    return this.http.get<any>(`${this.base}/benchmark-compare/${encodeURIComponent(instance)}?scope=${scope}`).pipe(
      map(raw => this.mapCompareResult(raw)),
    );
  }

  /** Start a streaming run — returns 202, results come via SignalR. */
  run(request: RunRequest): Observable<{ started: boolean; instance: string }> {
    return this.http.post<{ started: boolean; instance: string }>(`${this.base}/run`, request);
  }

  /** Cancel the running job for an instance group. */
  cancelRun(instanceGroup: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/cancel/${instanceGroup}`);
  }

  compare(request: CompareRequest): Observable<CompareResult> {
    return this.http.post<CompareResult>(`${this.base}/compare`, request);
  }

  reoptimize(request: Omit<RunRequest, 'algorithm'>): Observable<ScheduleResult> {
    return this.http.post<ScheduleResult>(`${this.base}/reoptimize`, request);
  }

  private mapCompareResult(raw: any): CompareResult {
    return {
      instance: raw.instance,
      results: (raw.results ?? []).map((result: any) => this.mapScheduleResult(result)),
      bestLabel: raw.bestLabel ?? raw.best_label,
      bestScore: raw.bestScore ?? raw.best_score,
    };
  }

  private mapScheduleResult(raw: any): ScheduleResult {
    return {
      score: raw.score,
      executionTime: raw.executionTime ?? raw.execution_time ?? 0,
      conflicts: raw.conflicts ?? 0,
      initialScore: raw.initialScore ?? raw.initial_score ?? 0,
      scoreImprovement: raw.scoreImprovement ?? raw.score_improvement ?? 0,
      algorithm: raw.algorithm,
      instance: raw.instance,
      operators: raw.operators ?? [],
      penaltyBreakdown: raw.penaltyBreakdown ?? raw.penalty_breakdown,
      operatorStats: raw.operatorStats ?? raw.operator_stats,
      progressHistory: (raw.progressHistory ?? raw.progress_history ?? []).map((point: any) => ({
        iteration: point.iteration,
        score: point.score,
        currentScore: point.currentScore ?? point.current_score,
        bestScore: point.bestScore ?? point.best_score,
      })),
      scheduledPrograms: (raw.scheduledPrograms ?? raw.scheduled_programs ?? []).map((program: any) => ({
        programId: program.programId ?? program.program_id,
        channelId: program.channelId ?? program.channel_id,
        start: program.start,
        end: program.end,
      })),
      label: raw.label,
      vsIlp: raw.vsIlp ?? raw.vs_ilp,
      source: raw.source,
      sourceFile: raw.sourceFile ?? raw.source_file,
    };
  }

  private mapBenchmarkRow(raw: any): BenchmarkRow {
    const cells: Record<string, BenchmarkCell> = {};
    Object.entries(raw.cells ?? {}).forEach(([key, value]: [string, any]) => {
      cells[key] = {
        algorithm: value.algorithm,
        label: value.label,
        score: value.score,
        vsIlp: value.vsIlp ?? value.vs_ilp,
        status: value.status,
        source: value.source,
        sourceFile: value.sourceFile ?? value.source_file,
        sourceAvailable: value.sourceAvailable ?? value.source_available ?? false,
        requested: value.requested ?? false,
      };
    });

    return {
      index: raw.index,
      instance: raw.instance,
      displayName: raw.displayName ?? raw.display_name,
      instanceType: raw.instanceType ?? raw.instance_type,
      ilpScore: raw.ilpScore ?? raw.ilp_score,
      ilpStatus: raw.ilpStatus ?? raw.ilp_status,
      cells,
    };
  }
}
