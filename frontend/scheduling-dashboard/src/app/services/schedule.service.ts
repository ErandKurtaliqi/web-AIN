import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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
    return this.http.get<InstanceInfo>(`${this.base}/instance-info/${name}`);
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
