// Rewind TV lineup: one tab per decade, each with its own channels starting at 1.
// A channel is a theme (an Internet Archive search) limited to that decade.
// The LINEUPS lists only include themes the archive has enough videos for in that decade.

// Every query gets SAFE added: videos only, and skip uploaders known to stamp a logo on the picture.
const SAFE = ' AND mediatype:movies' +
  ' AND NOT (coffee4binky OR "Tyrone L. Warbasse" OR "Las Vegas Time Machine" OR Lazerverse OR "Going Buoy" OR "Spaced Out Truckers" OR "Phony Phootbawl" OR description:patreon OR title:patreon)';
// Adult channels also get this: drops anything titled or tagged in a way that suggests minors.
const NO_MINORS = ' AND NOT (title:teen OR subject:teen OR title:teens OR title:young OR subject:young OR title:girl OR title:girls OR title:schoolgirl OR title:school OR title:lolita OR subject:lolita OR title:minor OR title:underage OR title:child OR title:kid OR title:barely OR title:petite OR subject:hentai)';

const THEMES = {
  cartoons:    { call: 'TOON',  name: 'Cartoons',            color: '#ff3d7f', q: '(subject:cartoon OR subject:cartoons OR subject:animation OR collection:classic_cartoons)' },
  satam:       { call: 'SAT',   name: 'Saturday Morning',    color: '#ffb300', q: 'subject:"saturday morning"' },
  kidbreaks:   { call: 'KIDBK', name: 'Kids Network Breaks', color: '#ff9100', q: 'collection:classic_tv_commercials AND (subject:nickelodeon OR subject:"cartoon network" OR subject:"fox kids" OR subject:"kids wb" OR subject:disney)' },
  toyads:      { call: 'TOYS',  name: 'Toy Commercials',     color: '#f50057', q: '(subject:"toy commercials" OR (subject:toys AND subject:commercials))' },
  gameads:     { call: 'PRESS', name: 'Game Commercials',    color: '#76ff03', q: '(subject:"video game commercials" OR (subject:"video games" AND subject:commercials))' },
  ads:         { call: 'ADS',   name: 'Commercials',         color: '#ff6d00', q: '(collection:classic_tv_commercials OR subject:commercials OR subject:commercial)' },
  tv:          { call: 'RERUN', name: 'Classic TV',          color: '#ffd600', q: 'collection:classic_tv' },
  sitcom:      { call: 'LAFF',  name: 'Sitcoms',             color: '#ff4081', q: 'subject:sitcom' },
  gameshow:    { call: 'BUZZR', name: 'Game Shows',          color: '#e040fb', q: 'subject:"game show"' },
  music:       { call: 'JAMZ',  name: 'Music Videos',        color: '#ff1744', q: '(subject:"music video" OR subject:"music videos")' },
  vhs:         { call: 'VHS',   name: 'Taped Off TV',        color: '#00b8d4', q: 'collection:vhsvault' },
  news:        { call: 'NEWS',  name: 'Taped News',          color: '#448aff', q: '(subject:news AND collection:vhsvault)' },
  sports:      { call: 'SPRT',  name: 'Sports',              color: '#00e5ff', q: '(subject:sports OR subject:football OR subject:baseball OR subject:basketball) AND collection:vhsvault' },
  wrestling:   { call: 'SLAM',  name: 'Wrestling',           color: '#ffc400', q: 'subject:wrestling' },
  anime:       { call: 'OTAKU', name: 'Anime Block',         color: '#ff80ab', q: 'subject:anime' },
  computers:   { call: 'BYTE',  name: 'Computer TV',         color: '#00e676', q: '(collection:computerchronicles OR subject:computers)' },
  weather:     { call: 'WX',    name: 'Weather Watch',       color: '#40c4ff', q: 'subject:"weather channel"' },
  infomercial: { call: 'BUY',   name: 'Infomercials',        color: '#ffab40', q: 'subject:infomercial' },
  psa:         { call: 'PSA',   name: 'The More You Know',   color: '#69f0ae', q: 'subject:"public service announcement"' },
  school:      { call: 'CLASS', name: 'School Films',        color: '#b2ff59', q: '(collection:prelinger OR subject:"educational film")' },
  trailers:    { call: 'PREV',  name: 'Coming Attractions',  color: '#ea80fc', q: '(subject:trailer OR subject:trailers)' },
  movies:      { call: 'FLIX',  name: 'Movies',              color: '#ffea00', q: 'collection:feature_films' },
  comedyfilm:  { call: 'LOL',   name: 'Comedy Movies',       color: '#fff176', q: 'collection:Comedy_Films' },
  noir:        { call: 'NOIR',  name: 'Film Noir',           color: '#9e9e9e', q: 'collection:Film_Noir' },
  western:     { call: 'OATER', name: 'Westerns',            color: '#a1887f', q: 'subject:western' },
  horror:      { call: 'FRITE', name: 'Creature Feature',    color: '#76ff03', q: '(collection:SciFi_Horror OR subject:horror)' },
  latenight:   { call: 'LATE',  name: 'Late Night',          color: '#7c4dff', q: 'subject:"late night"' },
  skin:        { call: 'SKIN',  name: 'Late-Night Thrillers', color: '#c51162', q: '(subject:"erotic thriller" OR subject:softcore)', adult: true },
  // Hardcore only: adult VHS/film collections, stag films, and porn/hardcore-tagged movies, minus streams, podcasts,
  // news, comedy, softcore/Playboy, cartoons, hardcore *punk* and other 18+ stuff that isn't porn.
  xxx:         { call: 'XXX',   name: 'After Dark',          color: '#d50000', q: '(collection:adultvhs OR collection:adultfilm OR subject:"stag film" OR subject:"stag films" OR subject:stag OR subject:hardcore OR (subject:porn OR subject:pornography OR subject:"adult film" OR subject:"adult movie" OR subject:xxx OR subject:"x-rated" OR subject:porno OR subject:"vintage porn" OR subject:"classic porn")) AND NOT (collection:twitchstreams OR collection:social-media-video OR collection:podcasts-video OR collection:podcasts_mirror OR collection:funnyordie OR collection:mirrortube OR collection:altcensored OR collection:fringe OR collection:television OR collection:loggedin OR collection:mensmagazines_post70s OR subject:punk OR subject:"hardcore punk" OR subject:metal OR subject:band OR subject:concert OR subject:"live music" OR subject:skate OR subject:gaming OR subject:"video game" OR subject:wrestling OR subject:techno OR subject:rave OR subject:horror OR subject:"horror film" OR subject:playboy OR subject:podcast OR subject:twitch OR subject:documentary OR subject:interview OR subject:news OR subject:trailer OR subject:comedy OR subject:parody OR subject:music OR subject:anime OR subject:hentai OR subject:cartoon OR subject:animation OR subject:softcore OR subject:"erotic thriller")', adult: true },
};

const DECADES = [
  { id: '50s', y: 1950 }, { id: '60s', y: 1960 }, { id: '70s', y: 1970 },
  { id: '80s', y: 1980 }, { id: '90s', y: 1990 }, { id: '00s', y: 2000 },
];
const DEFAULT_DECADE = '90s';

const LINEUPS = {
  "50s": [
    "cartoons",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "wrestling",
    "anime",
    "psa",
    "school",
    "trailers",
    "movies",
    "comedyfilm",
    "noir",
    "western",
    "horror",
    "xxx"
  ],
  "60s": [
    "cartoons",
    "satam",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "wrestling",
    "anime",
    "computers",
    "psa",
    "school",
    "trailers",
    "movies",
    "comedyfilm",
    "noir",
    "western",
    "horror",
    "latenight",
    "xxx"
  ],
  "70s": [
    "cartoons",
    "satam",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "wrestling",
    "anime",
    "psa",
    "school",
    "trailers",
    "movies",
    "comedyfilm",
    "noir",
    "western",
    "horror",
    "latenight",
    "skin",
    "xxx"
  ],
  "80s": [
    "cartoons",
    "satam",
    "toyads",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "sports",
    "wrestling",
    "anime",
    "computers",
    "infomercial",
    "psa",
    "school",
    "trailers",
    "movies",
    "comedyfilm",
    "western",
    "horror",
    "latenight",
    "skin",
    "xxx"
  ],
  "90s": [
    "cartoons",
    "satam",
    "kidbreaks",
    "toyads",
    "gameads",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "sports",
    "wrestling",
    "anime",
    "computers",
    "weather",
    "infomercial",
    "psa",
    "school",
    "trailers",
    "movies",
    "western",
    "horror",
    "latenight",
    "skin",
    "xxx"
  ],
  "00s": [
    "cartoons",
    "satam",
    "kidbreaks",
    "toyads",
    "gameads",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "sports",
    "wrestling",
    "anime",
    "computers",
    "weather",
    "infomercial",
    "psa",
    "trailers",
    "movies",
    "comedyfilm",
    "western",
    "horror",
    "latenight",
    "skin",
    "xxx"
  ]
};

function decadeClause(y) {
  // Exact year words (1990 OR 1991 ...) instead of a wildcard: same results, about 10x faster.
  const years = Array.from({ length: 10 }, (_, i) => y + i).join(' OR ');
  return ` AND (year:[${y} TO ${y + 9}] OR subject:${y}s OR subject:"${String(y).slice(2)}s" OR title:(${years}))`;
}

function lineup(decId) {
  const d = DECADES.find(x => x.id === decId) || DECADES.find(x => x.id === DEFAULT_DECADE);
  return LINEUPS[d.id].map((key, i) => {
    const t = THEMES[key];
    return { num: i + 1, key: d.id + ':' + key, dec: d.id, call: t.call, name: t.name, color: t.color,
             q: '(' + t.q + ')' + decadeClause(d.y) + (t.adult ? NO_MINORS : '') };
  });
}
