# Super Footy '94

A two-player football game in the style of FIFA 94: angled stadium view, pixel-art players, 11-a-side, set pieces, replays, and a roaring (synthesised) crowd.
It runs in a web browser with no install or build step, and is made for playing on a TV through **Steam Link with two PS4 controllers**.

- 2 players head-to-head, or 1 player against the CPU
- 16 national teams with home and away kits (clashing kits switch automatically)
- 11, 7 or 5-a-side; half length from 2 to 10 minutes
- Passing, through balls, lobs and crosses, powered shots with aiming, headers and volleys, standing and slide tackles
- Throw-ins, corners, goal kicks, free kicks and penalties, plus goal replays
- Radar, controller rumble, and an attract-mode demo match behind the menus

## Controls (PS4 controller)

| Button | Attacking | Defending |
|---|---|---|
| Left stick / D-pad | Move | Move |
| ✕ Cross | Pass | Switch player |
| □ Square | Shoot (hold for power, aim with stick) | Slide tackle |
| ○ Circle | Lob / cross | Tackle |
| △ Triangle | Through ball | – |
| R1 / R2 | Sprint | Sprint |
| L1 | – | Switch player |
| OPTIONS | Pause | Pause |

Tips:
- Pressing pass or shoot just before the ball arrives makes a one-touch pass, volley or header.
- Shots at full power are hard to keep down. A half-charged shot aimed at a corner is often best.
- At set pieces, aim with the stick and watch the yellow dotted line.

Keyboard (for testing on the PC): **Player 1** uses WASD to move, F/Space to pass, G to shoot, R to lob, T for through ball, Q to switch, Left Shift to sprint and Esc to pause. **Player 2** uses the arrow keys, K to pass, L to shoot, O to lob, P for through ball, U to switch, Right Shift to sprint and Enter to pause. F2 toggles fullscreen.

## 1. Try it on your PC

1. Download this repo: **Code → Download ZIP**, then extract it to, for example, `C:\Games\football`.
2. Double-click `index.html` to open it in Chrome (or Edge).
3. Press ✕ on a controller to join, use left/right to pick a team, then press ✕ to get ready.

## 2. Play on your TV with Steam Link

Steam Link streams your PC to the TV, so the game runs in Chrome on the PC and Steam sends both controllers to it.

1. In Steam on the PC: **Games → Add a Non-Steam Game to My Library → Browse…** and pick
   `C:\Program Files\Google\Chrome\Application\chrome.exe`.
2. Right-click the new **Google Chrome** entry → **Properties**:
   - **Name:** `Super Footy 94`
   - **Launch options** (change the path if you extracted somewhere else):
     ```
     --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir="C:\Games\football\chrome-profile" "file:///C:/Games/football/index.html"
     ```
3. **Controller layout:** in Properties → Controller, leave Steam Input on. Then make sure the game uses the **Gamepad** layout, not "Web Browser" or "Desktop", which turn the stick into a mouse. In Big Picture: select the game → ⚙ → Controller settings → Browse layouts → *Gamepad*.
4. Pair both PS4 controllers with the Steam Link (Steam Link settings → Controller), launch **Super Footy 94** from the library, and press ✕ on each controller to join.
5. To quit: press the **PS button** → *Exit Game* (or Alt+F4 on the PC).

What the launch options do:
- `--kiosk`: fullscreen with no browser bars.
- `--autoplay-policy=no-user-gesture-required`: lets the game play sound right away. Browsers block sound until you click or press a key, and controller buttons don't count.
- `--user-data-dir=…`: opens a separate Chrome window, so kiosk mode works even if Chrome is already open, and Steam can tell when the game closes.

Using Edge instead: point the shortcut at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` and add `--edge-kiosk-type=fullscreen` to the same launch options.

## Troubleshooting

- **The controller does nothing.** Press ✕ once, because browsers only show controllers after a button press. If the stick moves a mouse pointer, Steam is using the wrong layout (see step 3).
- **One controller joined as both players.** Some setups show the same pad twice. Press ○ on the extra slot to remove it, then join with the second controller.
- **No sound.** Add the `--autoplay-policy` launch option, or press any key on the PC keyboard once.
- **Input feels laggy.** In Steam Link settings, set streaming quality to *Fast* and use a wired network if you can.

## How it's built

Plain HTML5 canvas and JavaScript, with no libraries and no build step. `index.html` loads the files in `js/`:

| File | What it does |
|---|---|
| `util.js` | Math helpers and the angled projection |
| `data.js` | Teams, kits, colours |
| `input.js` | Gamepads (standard mapping) and keyboard |
| `audio.js` | Synthesised sound effects and crowd |
| `sim.js` | Match engine: physics, rules, team AI, goalkeepers, replays |
| `cpu.js` | CPU opponent (drives a virtual controller) |
| `render.js` | Pre-rendered stadium and pixel-art sprites |
| `main.js` | Menus, HUD, main loop |
