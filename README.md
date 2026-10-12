# Friend Feud

A survey-showdown party game. The scoreboard goes on the TV, and everyone's
phone is their buzzer, mini scoreboard and private team chat. One person is the
host and runs the board from their phone.

## Playing

1. On the computer plugged into the TV, open `YOUR-SITE/tv` and click
   **Start a new game**. Press `F` for full screen.
2. Everyone else opens `YOUR-SITE` on their phone (or scans the QR code on the
   TV) and types the 4-letter room code and their name.
3. Each player picks a team. The first person on a team names it. One person
   taps **Be the host** instead of joining a team.
4. The host taps **Start the game** and follows the prompts on their phone.

## Rules it follows

- Three rounds by default: single, double, triple points. Most points wins.
  The host can set 1 to 15 rounds; the points keep cycling single, double,
  triple.
- Face-off: one player from each team gets a buzzer (player 1s in round 1,
  player 2s in round 2, and so on). Top answer wins control outright; otherwise
  the other team gets one try to beat it. The winner chooses pass or play.
  The question stays hidden on every screen until the face-off is won.
- Boards get shorter as the points go up: 6-8 answers in single rounds, 5-7
  in double, 4-6 in triple. Your own questions always keep every answer.
- The playing team answers down the line. Three strikes and the other team
  gets one answer to steal the bank. Clear the board and the bank is yours.
- A tie after the last round goes to a sudden-death face-off.
- Fast Money (optional): two players from the winning team, 5 questions each,
  20 then 25 seconds, 200 points to win. Player two can't repeat an answer.

## Host tools

- **Question packs** (in the lobby): General, Sports, Cars, Holidays, Food &
  Drink, Movies/TV/Music, History, Animals, Kids, and an adults-only Late Night
  pack. Switch on any mix.
- **No repeats**: a question does not come back until every other question in
  the packs you have on has been used, within a game and across games. The TV
  remembers what it has shown, even after starting a new room.
- **Team names**: the host can rename either team from the lobby or from the
  in-game Menu. A name the host sets cannot be changed by the team.
- **Answer timer**: optional. Tap it during a turn to start a 5, 10, 15 or 20
  second countdown on the TV. When it runs out a buzzer sounds; the host still
  decides whether it costs a strike.
- **Chat**: players have a private team chat and an everyone chat. The host
  can read and post in the everyone chat.
- **Keyboard buzzers**: optional, off by default. Switch it on in the lobby (or
  in the in-game Menu, where it can also be switched off mid-game) and each
  team gets a key on the keyboard of the computer showing the scoreboard: A
  and L to start with. Tap Change next to a team, then press the key you want
  on that keyboard. Phone buzzers keep working alongside.
- **Fast Money, more time**: `+5 sec` beside the host's clock adds five seconds
  per tap. If the clock runs out with a question unanswered, the host can put
  five seconds back on, as long as nothing has been revealed yet.
- **Fast Money, fix an answer**: once the clock stops, every answer not yet
  revealed has a Change button, for the answer that came in at the buzzer.
- **Awards**: when the game ends the TV shows MVP, fastest buzzer and most
  strikes, and again on the closing screen after Fast Money. Each phone shows
  that player's own numbers.

- **Undo last tap** fixes any mis-tap.
- **Menu** lets you fix a score, move or remove players, or end the game.
- If someone's phone acts up during a face-off, call the buzz yourself.
- **Write questions** (in the lobby) adds your own questions. They are used
  first, and the built-in packs fill in the rest. 40 more questions are
  reserved for Fast Money.

## Running it

Needs Node.js 18 or newer.

    npm install
    npm start

Then open http://localhost:3000/tv. To play over home Wi-Fi without hosting,
phones can join at `http://YOUR-COMPUTER-IP:3000`.

## Hosting it for free (Render)

1. Put these files in a GitHub repository (everything except `node_modules`).
2. At render.com choose **New > Web Service**, connect the repository, and
   pick the **Free** instance type. Build command `npm install`, start command
   `node server.js`.
3. Render gives you an address like `friend-feud.onrender.com`. That's
   `YOUR-SITE`.

A free Render service goes to sleep after 15 minutes with nobody on it and
takes about a minute to wake up, so open the TV page a few minutes before the
party. It stays awake while a game is running.

## Changing things

- Game name: `F.TITLE` at the top of `public/common.js`.
- Built-in questions: `questions.js`.
- Fast Money target and timers: top of `server.js`.

## Music

The TV has a **Music** button in the lobby (or press **B**). It is off until you turn it on.

- With nothing added, it plays a built-in funk tune.
- To use a real recording, put a file named `lobby.mp3` next to the other files. It loops in the
  lobby and on the winner screen. An optional `fanfare.mp3` plays at the start of each round.
- Only add music you have the right to use and share. If it needs a credit, put it in
  `F.MUSIC_CREDIT` at the top of `common.js`; the TV lobby shows it while the recording plays.

### Music credit

"Private Eye" by Kevin MacLeod ([incompetech.com](https://incompetech.com)), from
[Funk Sampler](https://freemusicarchive.org/music/Kevin_MacLeod/Funk_Sampler/Private_Eye/).
Licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
The file (`lobby.mp3`) is unchanged; the game loops it from where the music starts to where it ends.

## What changed, and when

See [CHANGELOG.md](CHANGELOG.md). The version number on the TV start screen and the phone join
screen matches the entries there.
