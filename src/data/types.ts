export type Kind = 'artist' | 'group';
export type RelationType = 'member' | 'collaboration' | 'production' | 'affiliation';
export interface Evidence { title:string; url:string; note:string; }
export interface ArtistNode {
  id:string; name:string; aliases?:string[]; kind:Kind; city:string;
  category:string; color:string; initials:string; description:string;
  catalogArtistIds?:number[]; sources?:Evidence[];
  avatarUrl?:string;
}
export type WorkVersion = '录音室版' | '现场版' | '混音版' | '发行版';
export interface TrackReference { id:string; title:string; year:number; version:WorkVersion; }
export interface Work extends TrackReference {
  artistIds:string[];
  searchAliases?:string[];
  /** Verbatim platform credits; may also include artists outside this graph. */
  creditedAs:string;
  album:string;
  releaseDate?:string;
  catalogTrackId?:number;
  catalogArtistId?:number;
  evidence:Evidence[];
}
export interface Relationship {
  id:string; source:string; target:string; type:RelationType; label:string;
  startYear?:number; endYear?:number; observedYear?:number;
  track?:TrackReference; evidence:Evidence[]; status:'seed-reference'|'verified';
}
