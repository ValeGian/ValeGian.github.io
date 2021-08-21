import {Component, OnInit, Input} from '@angular/core';

@Component({
  selector: 'app-item',
  templateUrl: './item.component.html',
  styleUrls: ['./item.component.scss']
})
export class ItemComponent implements OnInit {
  @Input() description: any;
  @Input() title: any;
  @Input() languages: any;
  @Input() link: any;
  @Input("link-title") linktitle: any;
  @Input() cardclass: any;
  @Input("link-type") linktype = "internal";
  profile: Profile = {
    platform: "",
    link: "",
    icon: "",
    description: ""
  };

  constructor() {
  }

  ngOnInit(): void {
    this.profile.link = this.link
    this.profile.description = this.linktitle
    this.profile.icon = "fab-github"
  }

}
