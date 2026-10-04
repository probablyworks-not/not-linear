// Shared emoji + icon picker — used by the sidebar (threads, projects) and Notes. One curated, searchable list so "increase the
// selection" only ever has to change in one place. The picker is
// self-contained: it manages its own floating popover and outside-click
// dismissal, and reuses the .cp-pop / .cp-emoji-* CSS classes that already
// ship globally. When `allowIcons` is enabled (the default), a second section
// shows the Mind Garden hand-drawn SVG icons; picking one yields a token of
// the form `"icon:<id>"` instead of a glyph string. Callers that insert into
// text (composer, doc body) pass `allowIcons: false`.
//
// Relationship to other core/ modules: this is the higher-level picker built
// on top of core/mind-garden.js's fetch/parse/render primitives (see that
// file's header) — this module owns the actual popover DOM, search/filter
// behavior, and color-swatch UI. It has no dependency on core/state.js or
// core/store.js: callers pass an anchor element and an `onPick` callback and
// are responsible for what happens to the chosen glyph/token (including
// persisting it, if relevant). app.js and the feature views
// (frontend/views/notes.js) are the callers.
//
// NOTE (see openEmojiPicker below): despite the emoji/icon naming and the
// EMOJI_INDEX list still living here, the picker currently only ever shows
// the Mind Garden icon grid — emoji selection itself was removed/disabled
// ("Emoji are intentionally not offered any more"). EMOJI_INDEX and
// CURATED_EMOJIS are effectively dormant at the time of writing (no importer
// of CURATED_EMOJIS was found elsewhere in frontend/); kept here in case
// emoji selection is reinstated later, per the comments at gridHTML() below.
import { loadMindGarden, renderIconSvg, getMindGardenEntries, ICON_COLORS } from './mind-garden.js';

// Each entry is [emoji, "space separated search keywords"]. Keep the most
// generally useful icons near the front — the inline add-project grid shows the
// first slice of CURATED_EMOJIS, and the picker shows the whole set.
const EMOJI_INDEX = [
  ['📁', 'folder project directory files'],
  ['📂', 'folder open directory'],
  ['🗂️', 'folders index tabs organize'],
  ['📄', 'document page file paper'],
  ['📝', 'note memo write notes draft'],
  ['📋', 'clipboard list tasks todo'],
  ['📌', 'pin pinned location important'],
  ['📎', 'paperclip attach clip'],
  ['🔖', 'bookmark tag label'],
  ['🏷️', 'label tag price'],
  ['📊', 'chart bar data analytics stats'],
  ['📈', 'chart up growth trending data'],
  ['📉', 'chart down decline data'],
  ['🧪', 'experiment test lab science tube'],
  ['🔬', 'microscope research science lab'],
  ['🧬', 'dna biology science genetics'],
  ['🔭', 'telescope space astronomy explore'],
  ['🧭', 'compass navigate direction explore'],
  ['🗺️', 'map navigation route plan'],
  ['🚀', 'rocket launch ship fast startup'],
  ['🛰️', 'satellite space signal orbit'],
  ['🪐', 'planet saturn space cosmos'],
  ['🌍', 'earth globe world planet'],
  ['🌐', 'globe web internet world network'],
  ['⭐', 'star favorite rating'],
  ['🌟', 'star sparkle glow shine'],
  ['✨', 'sparkles magic shine new'],
  ['🔥', 'fire hot trending flame lit'],
  ['💡', 'idea lightbulb tip insight'],
  ['🎯', 'target goal aim focus objective'],
  ['🎨', 'art design palette paint creative'],
  ['🖌️', 'paintbrush design art'],
  ['🎭', 'theater drama masks performance arts'],
  ['🎬', 'movie film clapper video'],
  ['📷', 'camera photo picture'],
  ['🎥', 'video camera film record'],
  ['🎙️', 'microphone podcast record audio'],
  ['🎧', 'headphones audio music listen'],
  ['🎵', 'music note song audio'],
  ['🎸', 'guitar music rock instrument'],
  ['🎹', 'piano music keys instrument'],
  ['🥁', 'drum music beat instrument'],
  ['⚙️', 'gear settings config mechanism build'],
  ['🛠️', 'tools build fix wrench hammer'],
  ['🔧', 'wrench fix tool repair config'],
  ['🔨', 'hammer build construct fix'],
  ['🧰', 'toolbox tools kit utilities'],
  ['🔩', 'bolt nut hardware screw'],
  ['🔌', 'plug power connect electric'],
  ['🔋', 'battery power charge energy'],
  ['💻', 'laptop computer code dev coding'],
  ['🖥️', 'desktop computer monitor screen'],
  ['⌨️', 'keyboard type input code'],
  ['🖱️', 'mouse click pointer'],
  ['💾', 'save disk floppy storage'],
  ['💿', 'disk cd storage media'],
  ['📀', 'dvd disk media storage'],
  ['🗃️', 'card box files archive storage'],
  ['🗄️', 'cabinet files archive storage'],
  ['📦', 'package box ship deliver module'],
  ['📨', 'email envelope message mail send'],
  ['✉️', 'envelope mail email message'],
  ['📬', 'mailbox inbox mail message'],
  ['📮', 'postbox mail send'],
  ['📞', 'phone call contact'],
  ['☎️', 'telephone phone call'],
  ['💬', 'chat speech bubble message talk comment'],
  ['🗨️', 'speech bubble talk comment'],
  ['💭', 'thought bubble think idea'],
  ['🗯️', 'anger speech shout bubble'],
  ['🔔', 'bell notification alert reminder'],
  ['🔕', 'mute bell silent notification off'],
  ['📣', 'megaphone announce shout broadcast'],
  ['📢', 'loudspeaker announce broadcast'],
  ['❓', 'question help unknown'],
  ['❗', 'exclamation important alert'],
  ['✅', 'check done complete success yes'],
  ['☑️', 'checkbox done checked task'],
  ['✔️', 'check mark done yes'],
  ['❌', 'cross no wrong error delete'],
  ['⚠️', 'warning caution alert danger'],
  ['🚧', 'construction wip work in progress barrier'],
  ['🛑', 'stop halt block'],
  ['🚦', 'traffic light signal status'],
  ['🟢', 'green dot circle online active good'],
  ['🟡', 'yellow dot circle warning pending'],
  ['🔴', 'red dot circle error offline stop'],
  ['🔵', 'blue dot circle info'],
  ['🟣', 'purple dot circle'],
  ['🟠', 'orange dot circle'],
  ['⚪', 'white dot circle empty'],
  ['⚫', 'black dot circle filled'],
  ['🧩', 'puzzle piece plugin module component'],
  ['🧱', 'brick wall block build'],
  ['🏗️', 'crane construction build wip'],
  ['🏠', 'home house main'],
  ['🏢', 'office building company work'],
  ['🏦', 'bank finance money building'],
  ['🏛️', 'building columns institution classic'],
  ['🗝️', 'key access unlock secret'],
  ['🔑', 'key access password unlock auth'],
  ['🔒', 'lock secure private closed'],
  ['🔓', 'unlock open access'],
  ['🛡️', 'shield security protect defense'],
  ['⚔️', 'swords battle fight conflict'],
  ['🏆', 'trophy win award champion'],
  ['🥇', 'medal gold first win'],
  ['🎖️', 'medal honor award military'],
  ['👑', 'crown king royal premium'],
  ['💎', 'diamond gem premium valuable'],
  ['💰', 'money bag cash finance revenue'],
  ['💵', 'dollar money cash bill'],
  ['💳', 'card credit payment money'],
  ['🧾', 'receipt invoice bill finance'],
  ['📅', 'calendar date schedule plan'],
  ['📆', 'calendar date schedule'],
  ['⏰', 'alarm clock time reminder'],
  ['⏳', 'hourglass time waiting loading'],
  ['🕐', 'clock time hour'],
  ['📍', 'pin location map place'],
  ['🧠', 'brain think mind intelligence ai'],
  ['🤖', 'robot bot ai automation'],
  ['👾', 'alien game invader retro'],
  ['🎮', 'game controller play gaming'],
  ['🕹️', 'joystick game arcade play'],
  ['🎲', 'dice random game chance'],
  ['🧮', 'abacus calculate math count'],
  ['📐', 'ruler measure geometry design'],
  ['📏', 'ruler measure straight'],
  ['✂️', 'scissors cut clip'],
  ['🖊️', 'pen write ink'],
  ['✏️', 'pencil write edit draw'],
  ['🖍️', 'crayon color draw'],
  ['📖', 'book open read documentation'],
  ['📚', 'books library docs knowledge'],
  ['📓', 'notebook journal notes'],
  ['📔', 'notebook journal diary'],
  ['🔍', 'search magnify find look zoom'],
  ['🔎', 'search magnify find zoom'],
  ['🌱', 'seedling grow plant new sprout'],
  ['🌿', 'herb plant green leaf'],
  ['🍀', 'clover luck four leaf'],
  ['🌳', 'tree nature plant'],
  ['🌊', 'wave water ocean flow'],
  ['💧', 'droplet water drop'],
  ['❄️', 'snowflake cold winter freeze'],
  ['☀️', 'sun sunny day bright'],
  ['🌙', 'moon night dark'],
  ['⚡', 'lightning bolt fast energy power flash'],
  ['🌈', 'rainbow color pride'],
  ['🦆', 'duck bird rubber'],
  ['🐠', 'fish tropical sea'],
  ['🐮', 'cow animal moo'],
  ['🐱', 'cat animal kitten'],
  ['🐶', 'dog animal puppy'],
  ['🦊', 'fox animal'],
  ['🦉', 'owl bird wise night'],
  ['🐝', 'bee bug insect honey'],
  ['🦋', 'butterfly insect transform'],
  ['🐢', 'turtle slow animal'],
  ['🐙', 'octopus sea animal'],
  ['🦄', 'unicorn magic fantasy rare'],
  ['🐉', 'dragon fantasy mythical'],
  ['☕', 'coffee cup drink cafe break'],
  ['🍕', 'pizza food slice'],
  ['🍔', 'burger food fast'],
  ['🌮', 'taco food mexican'],
  ['🍩', 'donut food sweet'],
  ['🍪', 'cookie food sweet'],
  ['🎂', 'cake birthday celebrate'],
  ['🍾', 'champagne celebrate party launch'],
  ['🎉', 'party celebrate confetti launch ship'],
  ['🎈', 'balloon party celebrate'],
  ['🎁', 'gift present box surprise'],
  ['❤️', 'heart love red favorite'],
  ['🧡', 'orange heart love'],
  ['💛', 'yellow heart love'],
  ['💚', 'green heart love'],
  ['💙', 'blue heart love'],
  ['💜', 'purple heart love'],
  ['🖤', 'black heart love dark'],
  ['👍', 'thumbs up like approve good yes'],
  ['👎', 'thumbs down dislike no bad'],
  ['👋', 'wave hello hi greeting'],
  ['🙏', 'pray thanks please hands'],
  ['💪', 'muscle strong power flex'],
  ['🤝', 'handshake deal agree partner'],
  ['👀', 'eyes look watch review see'],
  ['🫶', 'hands heart love care'],
  ['🤔', 'thinking hmm question wonder'],
  ['😀', 'smile happy face grin'],
  ['😎', 'cool sunglasses face'],
  ['🥳', 'party face celebrate'],
  ['😴', 'sleep tired zzz face'],
];

// Flat list of just the glyphs, in index order. the picker uses the whole set.
// (See file-level note above: as of this pass, no current importer of this
// export was found in frontend/ — the picker below renders Mind Garden icons
// only. Left in place/documented rather than removed, since removing exports
// is a logic change outside the scope of a comments-only pass.)
export const CURATED_EMOJIS = EMOJI_INDEX.map(e => e[0]);

let pickerEl = null;
let pickerOutside = null;

// closeEmojiPicker: tear down the currently-open picker popover (if any) and
// remove its outside-click listener. Called at the top of openEmojiPicker()
// (so opening a new picker always closes a stale one first) and by
// frontend/views/notes.js to close the picker on other UI events (e.g.
// navigating away) without needing to know its internals.
export function closeEmojiPicker(){
  if (!pickerEl) return;
  pickerEl.remove();
  pickerEl = null;
  if (pickerOutside){ document.removeEventListener('mousedown', pickerOutside); pickerOutside = null; }
}

// gridHTML: internal — render a plain-emoji picker grid from a list of glyph
// strings. Currently unused by openEmojiPicker() below (which only renders
// the Mind Garden icon grid via mgGridHTML), kept from when the picker also
// offered raw emoji — see the file-level "NOTE" above.
function gridHTML(list){
  if (!list.length) return `<div class="cp-emoji-empty">no matches</div>`;
  return list.map(e => `<button class="cp-emoji-opt" type="button">${e}</button>`).join('');
}

// mgGridHTML: internal — render the Mind Garden icon grid for a filtered list
// of `entries` (see core/mind-garden.js's entry shape), using renderIconSvg()
// for each icon's markup and `color` for the currently-chosen swatch color.
// Called from the picker's repaint() closure inside openEmojiPicker() below.
function mgGridHTML(entries, color = ''){
  if (!entries.length) return `<div class="cp-emoji-empty">no matches</div>`;
  return entries.map(e =>
    `<button class="cp-emoji-opt mg-opt" type="button" data-icon="${e.id}" title="${e.name}">${renderIconSvg(e.id, { size: 30, color })}</button>`
  ).join('');
}

// colorSwatchHTML: internal — markup for the small swatch button shown next
// to the search box (see comment inline). Called once when building the
// picker's toolbar in openEmojiPicker(); the swatch's contents are then
// updated in place (not re-rendered via this function) when the user picks a
// color, to avoid re-rendering the whole toolbar.
function colorSwatchHTML(color){
  // Header swatch shown beside the search box; clicking opens the palette.
  const bg = color || '';
  const cls = color ? 'mg-color-swatch' : 'mg-color-swatch default';
  const inner = color
    ? `<span class="mg-color-fill" style="background:${bg}"></span>`
    : `<i class="ti ti-droplet"></i>`;
  return `<button class="${cls}" id="mg-color-swatch" type="button" title="icon color">${inner}</button>`;
}

// colorPaletteHTML: internal — markup for the hidden-by-default dropdown of
// ICON_COLORS swatches (see core/mind-garden.js), toggled open by clicking
// colorSwatchHTML's button. Called once when building the picker in
// openEmojiPicker() below.
function colorPaletteHTML(){
  return `<div class="mg-color-pop" id="mg-color-pop" hidden>` +
    ICON_COLORS.map(c => {
      const cls = 'mg-color-opt' + (c.hex ? '' : ' default');
      const style = c.hex ? `background:${c.hex}` : '';
      return `<button class="${cls}" type="button" data-hex="${c.hex}" title="${c.name}" style="${style}">${c.hex ? '' : '<i class="ti ti-droplet-off"></i>'}</button>`;
    }).join('') +
    `</div>`;
}

// Open the Mind Garden icon picker anchored under `anchorEl`. `onPick` receives
// a `"icon:<id>"` token. Emoji are intentionally not offered any more — Mind
// Garden is the single source of glyphs across the app.
// Builds and positions the popover near `anchorEl` (clamped to stay on
// screen), lazily loads the icon sheet via loadMindGarden() (core/mind-garden.js)
// and renders/filters the grid as the user types, wires the color-swatch
// palette to re-render the grid with the chosen stroke color baked into each
// icon's token, and wires Escape/Enter/outside-click to close or confirm.
// Called by app.js and by frontend/views/notes.js wherever a user can set a thread/note/
// project's icon.
export function openEmojiPicker(anchorEl, onPick){
  closeEmojiPicker();
  const pop = document.createElement('div');
  pop.className = 'cp-pop cp-emoji-pop mg-only';
  let chosenColor = '';   // '' = default (currentColor); otherwise '#RRGGBB'

  pop.innerHTML =
    `<div class="mg-toolbar">` +
      `<input class="cp-emoji-search" placeholder="search icons…" autocomplete="off">` +
      colorSwatchHTML(chosenColor) +
    `</div>` +
    colorPaletteHTML() +
    `<div class="cp-emoji-grid mg-grid" id="nl-mg-grid"><div class="cp-emoji-empty">loading…</div></div>`;

  document.body.appendChild(pop);
  const width = 300, height = 380;
  const r = anchorEl.getBoundingClientRect();
  pop.style.width = width + 'px';
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - height - 8) + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + 'px';
  pickerEl = pop;

  const mgGrid = pop.querySelector('#nl-mg-grid');
  const search = pop.querySelector('.cp-emoji-search');
  const swatch = pop.querySelector('#mg-color-swatch');
  const palette = pop.querySelector('#mg-color-pop');

  const tokenFor = (id) => chosenColor ? `icon:${id}:${chosenColor.replace('#','')}` : `icon:${id}`;
  const pick = (id) => { onPick(tokenFor(id)); closeEmojiPicker(); };

  const wireMg = () => mgGrid.querySelectorAll('.mg-opt').forEach(b =>
    b.addEventListener('click', () => pick(b.dataset.icon)));

  const repaint = () => {
    const q = search.value.trim().toLowerCase();
    const entries = getMindGardenEntries();
    if (!entries.length) return;
    const list = q ? entries.filter(e => e.keywords.includes(q)) : entries;
    mgGrid.innerHTML = mgGridHTML(list, chosenColor);
    wireMg();
  };

  loadMindGarden().then(() => repaint())
    .catch(() => { mgGrid.innerHTML = `<div class="cp-emoji-empty">mind garden failed to load</div>`; });

  // Color swatch + palette
  swatch?.addEventListener('click', (e) => {
    e.stopPropagation();
    palette.hidden = !palette.hidden;
  });
  palette?.querySelectorAll('.mg-color-opt').forEach(b => {
    b.addEventListener('click', () => {
      chosenColor = b.dataset.hex || '';
      // Update header swatch in place without re-rendering the toolbar.
      swatch.classList.toggle('default', !chosenColor);
      swatch.innerHTML = chosenColor
        ? `<span class="mg-color-fill" style="background:${chosenColor}"></span>`
        : `<i class="ti ti-droplet"></i>`;
      palette.hidden = true;
      repaint();
    });
  });

  search.addEventListener('input', repaint);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){ closeEmojiPicker(); return; }
    if (e.key !== 'Enter') return;
    const first = mgGrid.querySelector('.mg-opt');
    if (first) pick(first.dataset.icon);
  });

  pickerOutside = (e) => {
    if (pop.contains(e.target) || anchorEl.contains(e.target) || e.target === anchorEl) return;
    closeEmojiPicker();
  };
  setTimeout(() => document.addEventListener('mousedown', pickerOutside), 0);
  search.focus();
}
