import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  RunRequest, CompareRequest,
  ScheduleResult, CompareResult, InstanceInfo,
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
}
