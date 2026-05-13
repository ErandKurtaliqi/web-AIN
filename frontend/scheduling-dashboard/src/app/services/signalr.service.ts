import { Injectable, OnDestroy } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import * as signalR from '@microsoft/signalr';
import { environment } from '../../environments/environment';
import { StatusMessage } from '../models/schedule.models';

@Injectable({ providedIn: 'root' })
export class SignalrService implements OnDestroy {

  private connection: signalR.HubConnection | null = null;
  private currentGroup: string | null = null;

  /** Emits every ScheduleUpdate message received from the hub. */
  readonly scheduleUpdate$ = new Subject<StatusMessage>();

  /** Emits each live progress snapshot {iteration, score} while an algorithm runs. */
  readonly progressUpdate$ = new Subject<{ iteration: number; score: number }>();

  /** True while the hub connection is active. */
  readonly connected$ = new BehaviorSubject<boolean>(false);

  async connect(): Promise<void> {
    if (this.connection?.state === signalR.HubConnectionState.Connected) return;

    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(environment.signalrUrl)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.connection.on('ScheduleUpdate', (msg: StatusMessage) => {
      this.scheduleUpdate$.next(msg);
    });

    this.connection.on('ProgressUpdate', (point: { iteration: number; score: number }) => {
      this.progressUpdate$.next(point);
    });

    this.connection.onreconnected(() => this.connected$.next(true));
    this.connection.onclose(() => this.connected$.next(false));

    await this.connection.start();
    this.connected$.next(true);
  }

  async joinGroup(instanceName: string): Promise<void> {
    if (!this.connection || this.connection.state !== signalR.HubConnectionState.Connected) {
      await this.connect();
    }
    if (this.currentGroup && this.currentGroup !== instanceName) {
      await this.connection!.invoke('LeaveInstanceGroup', this.currentGroup);
    }
    await this.connection!.invoke('JoinInstanceGroup', instanceName);
    this.currentGroup = instanceName;
  }

  async leaveGroup(): Promise<void> {
    if (this.currentGroup && this.connection?.state === signalR.HubConnectionState.Connected) {
      await this.connection!.invoke('LeaveInstanceGroup', this.currentGroup);
      this.currentGroup = null;
    }
  }

  async disconnect(): Promise<void> {
    await this.leaveGroup();
    await this.connection?.stop();
    this.connected$.next(false);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
