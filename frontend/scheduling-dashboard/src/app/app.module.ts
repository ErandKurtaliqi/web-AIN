import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgApexchartsModule } from 'ng-apexcharts';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { OperatorPanelComponent } from './components/operator-panel/operator-panel.component';
import { ScheduleViewComponent } from './components/schedule-view/schedule-view.component';
import { ChartsComponent } from './components/charts/charts.component';
import { CompareComponent } from './components/compare/compare.component';

@NgModule({
  declarations: [
    AppComponent,
    DashboardComponent,
    OperatorPanelComponent,
    ScheduleViewComponent,
    ChartsComponent,
    CompareComponent,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    AppRoutingModule,
    NgApexchartsModule,
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
