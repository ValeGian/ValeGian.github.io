import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from "rxjs";
import meJson from "../../resources/me.json";

@Injectable({
  providedIn: 'root'
})
export class DataService {
  name : BehaviorSubject<string> = new BehaviorSubject<string>("");
  picture: BehaviorSubject<string> = new BehaviorSubject<string>("");
  bio: BehaviorSubject<string> = new BehaviorSubject<string>("");

  qualifications : BehaviorSubject<Array<string>> = new BehaviorSubject<Array<string>>([]);
  profiles : BehaviorSubject<Array<Profile>> = new BehaviorSubject<Array<Profile>>([]);
  universityProjects : BehaviorSubject<Array<Project>> = new BehaviorSubject<Array<Project>>([]);
  personalProjects : BehaviorSubject<Array<Project>> = new BehaviorSubject<Array<Project>>([]);

  constructor() {
    let data = meJson
    let _qualifications: any[] = []
    let _profiles: Profile[] = []
    let _pers_projects = [];
    let _uni_projects = [];

    this.name.next(this._parseName(data.anagraphic.fullname))
    this.picture.next(data.anagraphic.picture)
    this.bio.next(data.anagraphic.bio)

    for (let qualification of data.anagraphic.qualifications){
      _qualifications.push(qualification)
    }
    this.qualifications.next(_qualifications)

    _profiles.push({
      platform: "email",
      link: "mailto:"+data.digitalidentity.email,
      icon: "fas-envelope",
      description: "Send me an email!"
    })
    for(let profile of data.digitalidentity.profiles){
      _profiles.push(profile)
    }
    this.profiles.next(_profiles)

    for(let project of data.projects){
      switch (project.type) {
        case 'university':
          _uni_projects.push(project)
          break;
        case 'personal':
          _pers_projects.push(project)
          break;
      }
    }
    this.universityProjects.next(_uni_projects.sort(this._sortDate))
    this.personalProjects.next(_pers_projects.sort(this._sortDate))

  }

  _parseName(fullname: any){
    return fullname.first+" "+fullname.last;
  }

  // @ts-ignore
  _sortDate(a,b){
    if(new Date(a.date.year, a.date.month, a.date.day)
      <
      new Date(b.date.year, b.date.month, b.date.day))
      return 1;
    else
      return -1;
  }

  getName(){
    return this.name
  }

  getPicture(){
    return this.picture
  }

  getBio(){
    return this.bio
  }

  getQualifications(){
    return this.qualifications
  }

  getProfiles(){
    return this.profiles
  }

  // @ts-ignore
  getProjects(type: string){
    switch (type) {
      case 'university':
        return this.universityProjects
        break;
      case 'personal':
        return this.personalProjects
        break;
    }

    return this.personalProjects
  }
}
