import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LfStudioMainComponent } from './components/lf-studio-main/lf-studio-main.component';
import { LfStudioListViewComponent } from './components/lf-studio-list-view/lf-studio-list-view.component';
import { LfStudioItemDetailComponent } from './components/lf-studio-item-detail/lf-studio-item-detail.component';
import { LfStudioQueueViewComponent } from './components/lf-studio-queue-view/lf-studio-queue-view.component'; // Added

@NgModule({
  declarations: [
    LfStudioMainComponent,
    LfStudioListViewComponent,
    LfStudioItemDetailComponent,
    LfStudioQueueViewComponent // Added
  ],
  imports: [
    CommonModule
  ],
  exports: [
    LfStudioMainComponent
    // Other components are used internally by LfStudioMainComponent
  ]
})
export class LfStudioModule { }
