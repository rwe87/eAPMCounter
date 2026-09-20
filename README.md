# eAPMCounter: live eAPM for Age of Empires II: Definitive Edition

Shows the effective actions per minute (eAPM) of the last game minute on stream.
A small program reads the recording file that the game writes while a match runs, counts
your own actions and serves a ready-made overlay page at `http://localhost:8123/overlay`.
Add that URL as a browser source in OBS.

## Quick start with the EXE

1. Start `eAPMCounter.exe`. On the first start it creates `config.txt` next to itself and
   guesses your in-game name from the recent recordings. The window shows the log.
2. If the guessed name is wrong, set `playerName` in `config.txt` and restart the EXE.
3. In OBS add a source of type **Browser** and set its URL to
   `http://localhost:8123/overlay`. Width 200 and height 90 are enough for the number.
   The page has a transparent background, so only the number shows.
4. Place and resize the source in your scene as usual.
5. The EXE has to run while you stream. Without a running game the overlay shows 0.

To look at the page in a normal browser, open `http://localhost:8123/overlay?bg=green`.
White text on a transparent background is hard to see otherwise.

The EXE contains Node and the program. It needs no installation. On the first start
Windows may warn about an unknown publisher, because the file is not signed.

## Endpoints

| URL | Purpose |
|---|---|
| `/overlay` | the overlay page, transparent background, for the browser source |
| `/overlay?bg=green` | the same page on a green background, to check it in a browser |
| `/eapm` | the number as JSON, fetched by the page once a second |
| `/` | current state as plain text, plus the browser source URL |

## Settings in config.txt

One line per setting, in the form `key = value`. Lines starting with `#` are comments.
Restart the program after a change, then reload the browser source in OBS.

| Key | Meaning | Default |
|---|---|---|
| `playerName` | own name in the game | empty, guessed |
| `port` | port of the local server | 8123 |
| `windowSeconds` | length of the time window | 60 |
| `timeBase` | `game` = game time like CaptureAge, `real` = wall clock time | `game` |
| `savegameDir` | folder holding the `.aoe2record` files | empty, searched under `Games\Age of Empires 2 DE\<Steam ID>\savegame` |
| `pollMs` | how often the file is checked, in milliseconds | 250 |
| `idleSeconds` | without the file growing, the game counts as over after this many seconds | 180 |
| `excludedActions` | action types that are not counted | 103, 27, 32, 15, 10, 53, 255, 41 |
| `overlayFontSize` | font size of the number | 64px |
| `overlayColor` | color of the number | #ffffff |

Changing the port also means changing the URL of the browser source in OBS.

The environment variables `EAPM_SAVEGAME_DIR` and `EAPM_PORT` override the file.

## What is counted

Every action of the own player in the recording, except game settings (103), save (27),
chapter marker (32), spectate (15), AI commands (10, 53) and end of game (255). Camera
movement and plain selection are not stored as actions in the file, so they never count.
That matches the approach CaptureAge takes.

Type 41, DE_TRANSFORM, is excluded as well. What it stands for is not documented: the
parser this one is ported from guesses "autoscout enable?" and leaves the type out of its
own list of player inputs. Over seven measured games it made up 3.5 % of the count.
Removing 41 from `excludedActions` brings it back.

eAPM = actions in the last 60 seconds of game time. During the first minute the value is
scaled to the elapsed time, starting at 10 seconds.

## How the game writes the recording

Checked on 2026-09-19 with build 180059 in a running game:

- While a match runs, the game keeps writing to `rec.aoe2record`. The file grows every
  few seconds.
- After a multiplayer match the game renames the file to `MP Replay ... .aoe2record`.
  After a single player match the name stayed `rec.aoe2record`.
- The next match creates `rec.aoe2record` anew. Its creation time often stays old, so the
  program goes by the last write time and recognizes the renamed file by the start of its
  content.

## Development

Requirements: Node.js 24 (for building the EXE) and `npm install`.

In Windows PowerShell `npm` may be blocked. Use `npm.cmd` instead of `npm`, or
double-click `start.cmd`.

| Command | Purpose |
|---|---|
| `npm start` | run the program from source |
| `npm test` | tests for the parser, counter, watcher and settings, including real recordings |
| `npm run build` | builds the package in `dist/`: the EXE, `config.txt`, `README.txt` and the license notes |
| `npm run players` | shows the player lists of the recent recordings |
| `npm run stats` | average eAPM of the recent games, for comparison with CaptureAge |
| `npm run check-growth` | prints the size of the newest recording every 2 s |
| `npm run simulate` | writes an old recording piece by piece into `.sim/savegame` |
| `npm run e2e` | starts the program and the simulation together and checks the whole chain |

The overlay is built from three files in `overlay/`: `overlay.html`, `overlay.css` and
`overlay.js`. The server fills in the configured font size and color and sends them as
one self-contained page. Editing those files changes the overlay; a reload of the browser
source picks it up.

The build uses Node's "Single Executable Application" feature: esbuild bundles the source
into one file, Node turns that into a blob, and postject appends it to a copy of
`node.exe`. The three overlay files go into the EXE as well. The warning
"The signature seems corrupted" during the build is expected: `node.exe` is signed, the
copy with the blob is not.

The `config.txt` that ships in `dist/` holds the default settings, not the one from the
project root. That one carries a personal player name.

## Automated build

`.github/workflows/build.yml` runs on every push to `main`, on every pull request and on
demand. It runs on a Windows runner, because the EXE is a copy of the runner's own
`node.exe`. The job type-checks, runs the tests, builds the package and uploads it as the
artifact `eAPMCounter-windows-x64`. Downloading that artifact gives a ZIP with the EXE,
`config.txt`, `README.txt` and the license notes.

The tests that need real recordings skip themselves on the runner, because there is no
savegame folder there. The rest run.

## Known limits

- The number lags behind the game by however long the game takes until its next write.
  Observed: a few seconds.
- The file only holds actions the game processed. It therefore does not arrive at exactly
  the same number as counting key presses would.

License notes for borrowed code: `THIRD_PARTY_LICENSES.md`.
