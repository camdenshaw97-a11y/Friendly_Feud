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

- Three rounds: single, double, triple points. Most points wins.
- Face-off: one player from each team gets a buzzer (player 1s in round 1,
  player 2s in round 2, and so on). Top answer wins control outright; otherwise
  the other team gets one try to beat it. The winner chooses pass or play.
- The playing team answers down the line. Three strikes and the other team
  gets one answer to steal the bank. Clear the board and the bank is yours.
- A tie after round 3 goes to a sudden-death face-off.
- Fast Money (optional): two players from the winning team, 5 questions each,
  20 then 25 seconds, 200 points to win. Player two can't repeat an answer.

## Host tools

- **Undo last tap** fixes any mis-tap.
- **Menu** lets you fix a score, move or remove players, or end the game.
- If someone's phone acts up during a face-off, call the buzz yourself.
- **Write questions** (in the lobby) adds your own questions. They are used
  first, and the 70 built-in ones fill in the rest. 40 more are reserved for
  Fast Money.

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
