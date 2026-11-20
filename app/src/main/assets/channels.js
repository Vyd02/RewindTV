// Rewind TV channel lineup.
// Each channel is an Internet Archive search. To add a channel, copy a line,
// give it a new number, and change the query. Test a query at archive.org/advancedsearch.php
//
// SAFE is added to every query. It only limits results to videos (no content filter).
const SAFE = ' AND mediatype:movies';
const NO_MINORS = ' AND NOT (title:teen OR subject:teen OR title:teens OR title:young OR subject:young OR title:girl OR title:girls OR title:schoolgirl OR title:school OR title:lolita OR subject:lolita OR title:minor OR title:underage OR title:child OR title:kid OR title:barely OR title:petite OR subject:hentai)';

const CHANNELS = [
  { num: 2,  call: 'TOON',  name: 'Cartoon Classics',     color: '#ff3d7f', q: 'collection:classic_cartoons' },
  { num: 3,  call: 'SPNCH', name: 'Popeye Hour',          color: '#36c26b', q: 'title:popeye' },
  { num: 4,  call: 'SAT',   name: 'Saturday Morning',     color: '#ffb300', q: 'subject:"saturday morning"' },
  { num: 5,  call: 'VHS',   name: 'Taped Off TV',         color: '#00b8d4', q: 'collection:vhsvault AND subject:cartoons' },
  { num: 6,  call: 'HERO',  name: 'Superman Toons',       color: '#2979ff', q: 'title:superman AND subject:fleischer' },
  { num: 7,  call: 'ADS',   name: '90s Commercials',      color: '#ff6d00', q: 'subject:"90s commercials"' },
  { num: 8,  call: 'BREAK', name: 'Commercial Breaks',    color: '#d500f9', q: 'collection:classic_tv_commercials AND (subject:1990s OR subject:1990 OR title:199*)' },
  { num: 9,  call: 'KIDBK', name: 'Kids Network Breaks',  color: '#ff9100', q: 'collection:classic_tv_commercials AND subject:nickelodeon' },
  { num: 10, call: 'TOYS',  name: 'Toy Commercials',      color: '#f50057', q: 'subject:"toy commercials"' },
  { num: 11, call: 'PRESS', name: 'Game Commercials',     color: '#76ff03', q: 'subject:"video game commercials"' },
  { num: 12, call: 'RERUN', name: 'Classic TV',           color: '#ffd600', q: 'collection:classic_tv' },
  { num: 13, call: 'GOLD',  name: '50s Gold',             color: '#c6a700', q: 'collection:classic_tv_1950s' },
  { num: 14, call: 'LAFF',  name: 'Sitcom City',          color: '#ff4081', q: 'subject:sitcom AND collection:classic_tv' },
  { num: 15, call: 'BUZZR', name: 'Game Shows',           color: '#e040fb', q: 'subject:"game show" AND collection:classic_tv' },
  { num: 16, call: 'BYTE',  name: 'Computer Chronicles',  color: '#00e676', q: 'collection:computerchronicles' },
  { num: 17, call: 'WX',    name: 'Weather Watch',        color: '#40c4ff', q: 'subject:"weather channel"' },
  { num: 18, call: 'BUY',   name: 'Late Night Infomercials', color: '#ffab40', q: 'subject:infomercial' },
  { num: 19, call: 'PSA',   name: 'The More You Know',    color: '#69f0ae', q: 'subject:"public service announcement"' },
  { num: 20, call: 'CLASS', name: 'School Films',         color: '#b2ff59', q: 'collection:prelinger' },
  { num: 21, call: 'FLIX',  name: 'Comedy Movies',        color: '#ffea00', q: 'collection:Comedy_Films' },
  { num: 22, call: 'NOIR',  name: 'Film Noir',            color: '#9e9e9e', q: 'collection:Film_Noir' },
  { num: 23, call: 'OATER', name: 'Western Theater',      color: '#a1887f', q: 'collection:feature_films AND subject:western' },
  { num: 24, call: 'FRITE', name: 'Creature Feature',     color: '#76ff03', q: 'collection:SciFi_Horror' },
  { num: 25, call: 'JAMZ',  name: 'Music Videos',         color: '#ff1744', q: 'subject:"music video" AND year:[1980 TO 1999]' },
  { num: 26, call: 'SLAM',  name: '90s Wrestling',        color: '#ffc400', q: 'subject:wrestling AND (subject:1990s OR year:[1985 TO 1999])' },
  { num: 27, call: 'OTAKU', name: 'Anime Block',          color: '#ff80ab', q: 'subject:anime AND (subject:1990s OR year:[1985 TO 1999])' },
  { num: 28, call: 'NEWS',  name: 'Taped News',           color: '#448aff', q: 'subject:news AND collection:vhsvault' },
  { num: 29, call: 'LATE',  name: 'Late Night',           color: '#7c4dff', q: 'subject:"late night"' },
  // Adults only. NO_MINORS keeps out anything titled or tagged in a way that suggests minors.
  { num: 30, call: 'SKIN',  name: 'Late-Night Thrillers', color: '#c51162', q: '(subject:"erotic thriller" OR subject:softcore)' + NO_MINORS },
  { num: 31, call: 'XXX',   name: 'After Dark',           color: '#d50000', q: '(subject:nsfw OR subject:porn OR subject:"adult film" OR subject:xxx) AND year:[1970 TO 1999]' + NO_MINORS },
];
