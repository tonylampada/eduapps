# eduapps

Small educational web apps in Portuguese (pt-BR), served as a multi-page Vite site.
Everything is plain HTML/CSS/JS — no framework, no external assets: sounds are
synthesized with the Web Audio API and the voice comes from the browser's speech
synthesis.

## Running

```bash
npm install
npm run dev      # dev server
npm run build    # production build into dist/
npm run preview  # serve the built dist/
```

The build is configured with `base: './'`, so `dist/` works both at a domain root and
under a subpath. Pushing to `main` deploys it to GitHub Pages
(`.github/workflows/deploy.yml`).

## Layout

```
index.html              home — cards linking to each game
games/maisum/           game: Mais Um
games/primeiraletra/    game: Primeira Letra
public/triagem-tea/     static page: Triagem prática de suporte no TEA
lib/                    shared modules imported by the games
vite.config.js          one Rollup input per page
```

Each game is a single self-contained `index.html` (markup, styles and an inline
`<script type="module">`) that imports from `lib/`. Pages under `public/` are copied
verbatim by Vite and are not part of the module graph.

### Games

- **Mais Um** (`games/maisum/`) — counting and adding one. Each round shows a group of
  emoji plus one more and asks how many in total; the child drags the right number onto
  the `?`. Three levels: only pictures, pictures + the numeral `1`, or a mix. 10 rounds,
  three choices per round.
- **Primeira Letra** (`games/primeiraletra/`) — initial letters. A picture and its word
  with the first letter missing (`_asa`); the child drags the correct letter into the
  blank. Levels set how many letter options appear: 2, 3 or 4. 10 rounds, drawn from a
  30-word deck.

Both games speak the prompt and the feedback, run on pointer events (mouse and touch),
award a star for a first-try hit, and remember level and audio toggles in
`localStorage`.

### Other pages

- **Triagem prática de suporte no TEA** (`public/triagem-tea/`) — a self-contained
  questionnaire (21 questions across communication, social, school, regulation,
  autonomy and an overall view) that scores an approximate support profile. Runs
  entirely in the browser; it is explicitly not a diagnosis.

### Shared `lib/`

- `audio.js` — Web Audio: an ambient pentatonic loop (`startMusic`/`stopMusic`/
  `toggleMusic`) and the success/wrong cues.
- `tts.js` — `speak()` over `SpeechSynthesis`, preferring a pt-BR voice (Fernanda by
  default) with fallbacks, plus `warmup()` for iOS, which needs a user gesture to
  unlock speech.
- `ui.js` — `pick`, `randInt` and `confettiBurst`.

## Adding a game

1. Create `games/<name>/index.html` importing what it needs from `../../lib/`.
2. Register it as an input in `vite.config.js`.
3. Add a card to the home `index.html`.
