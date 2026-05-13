import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SignalrService } from './services/signalr.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  sidebarCollapsed = false;
  activeRoute = 'dashboard';

  navItems = [
    { route: 'dashboard', label: 'Dashboard',    emoji: '📊' },
    { route: 'schedule',  label: 'Schedule',     emoji: '📅' },
    { route: 'compare',   label: 'Compare',      emoji: '⚖️' },
  ];

  constructor(private router: Router, public signalr: SignalrService) {}

  ngOnInit(): void {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        this.activeRoute = e.urlAfterRedirects.replace('/', '') || 'dashboard';
      });
    this.signalr.connect().catch(() => {});
  }

  navigate(route: string): void {
    this.router.navigate([route]);
  }
}
