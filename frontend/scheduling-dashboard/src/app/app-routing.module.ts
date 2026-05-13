import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { ScheduleViewComponent } from './components/schedule-view/schedule-view.component';
import { CompareComponent } from './components/compare/compare.component';

const routes: Routes = [
  { path: '',          redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'schedule',  component: ScheduleViewComponent },
  { path: 'compare',   component: CompareComponent },
  { path: '**',        redirectTo: 'dashboard' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
