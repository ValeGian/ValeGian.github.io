import { Component, OnInit } from '@angular/core';

import { DataService } from "../data.service";
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fab } from '@fortawesome/free-brands-svg-icons';
import { fas } from '@fortawesome/free-solid-svg-icons'

@Component({
  selector: 'app-homepage',
  templateUrl: './homepage.component.html',
  styleUrls: ['./homepage.component.scss']
})
export class HomepageComponent implements OnInit {
  bio: any;
  profiles: any;

  constructor(private data: DataService, library: FaIconLibrary) {
    library.addIconPacks(fas);
    library.addIconPacks(fab)
  }

  ngOnInit() {
    this.profiles = this.data.getProfiles();
    this.bio = this.data.getBio()
  }
}
