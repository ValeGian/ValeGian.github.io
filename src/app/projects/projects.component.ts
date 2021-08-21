import { Component, OnInit } from '@angular/core';
import { DataService } from "../data.service";
import { ActivatedRoute } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fab } from '@fortawesome/free-brands-svg-icons';
import { fas } from '@fortawesome/free-solid-svg-icons'

@Component({
  selector: 'app-projects',
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.scss']
})
export class ProjectsComponent implements OnInit {
  type: string = ""
  projects: any

  constructor(private data: DataService, private route: ActivatedRoute, library: FaIconLibrary) {
    library.addIconPacks(fas);
    library.addIconPacks(fab)
  }

  ngOnInit(): void {
    this.route.queryParams
      .subscribe((params) => {
        this.type = params['type']
        this.projects = this.data.getProjects(this.type)
      })
  }

}
