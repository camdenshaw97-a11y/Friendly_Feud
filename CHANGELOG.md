# Friend Feud: what changed, and when

Every change to the game gets an entry here, newest first. The version number is the same one
shown in small print on the TV's start screen and on the phone join screen, so you can tell at a
glance which version a screen is running.

Times are Pacific. The code in brackets is the GitHub commit for that change: on GitHub, open
**Commits** and click it to see exactly which lines changed, or to get the game back to how it
was at that point.

## 1.5.1 · October 11, 2026, 8:30 pm

- The TV's music is now a real recording: **"Private Eye" by Kevin MacLeod** (incompetech.com),
  used under the Creative Commons Attribution 3.0 licence. It plays in the lobby and on the winner
  screen when Music is on. The built-in funk tune stays as the fallback, and the built-in horn
  fanfare still opens each round.
- The credit shows in the TV lobby while the recording plays, and is in the README.
- Recordings loop from where the music starts to where it ends, so silence at either end of a
  file isn't played each time round. (This track has about six seconds of it.)

## 1.5 · October 11, 2026, 7:45 pm  [5fc6fc9]

**End-of-game awards**
- The winner screen on the TV now shows up to three awards under the winning team: **MVP** (most
  answers put on the board, with their points), **Fastest buzzer** (quickest real buzz, in
  seconds) and **Most strikes**.
- Phones list the same awards under the board, and anyone who earned one gets a short message.
- Answers and strikes are credited to whoever was answering. Steals are a team effort and count
  for nobody. Undo takes them back off the record, a false start that the host resets doesn't
  count as a buzz, and a buzz the host calls by hand isn't timed.

**Music**
- Optional music on the TV while people join and again on the winner screen. It never plays over
  a round.
- It is **off until you turn it on**: the "Music" button in the TV lobby, or the **B** key. The TV
  remembers the choice. **M** still mutes everything.
- **Use a real recording:** put a file named `lobby.mp3` in the repo and the TV plays that,
  turned down to a sensible background level. An optional `fanfare.mp3` plays at the start of
  each round. Only add music you have the right to use (the repo is public).
- **Built-in tune:** with no recording, the TV plays an original 70s-style funk groove made in the
  browser: busy bass line, horn section, clav, handclaps and cowbell. It varies from pass to pass,
  so it takes over a minute to repeat. With music on, each round opens with a two-second horn
  fanfare in place of the short chime.

**Small things**
- Version number on the TV start screen and the phone join screen.
- This change log.

## 1.4 · October 11, 2026, 6:21 pm  [3b1a705]

**Motion and polish**
- Phones: buttons sink and spring back, switches slide, the answer-timer picker and the chat tabs
  have a highlight that glides between options, screens fade across, and the host menu, host chat
  and question editor slide up and back down.
- Phones: names pop into team cards, chat messages slide in, scores count up, and the two
  face-off players get a "YOU'RE IN!" or "TOO SLOW!" card. Players also see a quick card at the
  start of each round and "YOU WON!" at the end.
- TV: a "ROUND 2 · DOUBLE POINTS" band sweeps across before each round, points fly from the bank
  to the winning team, strikes land with a red flash and a jolt, and names pop into the lobby
  with a sound.
- Phones hold a round's points for the same beat as the TV, so nobody's phone shows the new score
  before the points land.
- PLAY and "Start a new game" show that they're working, and explain the wait while the server
  wakes up.
- Fixed: the Fast Money player pickers on the host phone reset whenever anyone sent a chat
  message.
- Devices set to "reduce motion" get the same game without the movement.

## 1.3.1 · October 11, 2026, 4:46 pm  [bd3f378]

- All nine themed packs go from 20 to 40 questions each (430 questions in total with General).

## 1.3 · October 11, 2026, 3:55 pm  [ef527f7]

- New question packs: History, Animals and Kids.
- The host can rename either team, in the lobby and from the Menu during a game. A name the host
  sets sticks.
- No repeated questions within a game, or from one game to the next in the same room, until every
  question in the chosen packs has been used.
- Join screen restyled to match the rest of the game.
- Icons sit dead centre in their buttons, and answers on the phone's mini scoreboard line up the
  same way as on the TV.
- The TV always shows the join QR code during a game, so anyone who drops can scan back in.

## 1.2.2 · October 11, 2026, 1:58 pm  [66fbd29]

- Chats are wiped at the start of every new game: team chats, the everyone chat and the host's.

## 1.2.1 · October 11, 2026, 1:37 pm  [b653103]

- Host phone: everything fits on one screen. Strike and the bottom row stay pinned, and the answer
  buttons get slimmer on shorter phones.

## 1.2 · October 11, 2026, 1:20 pm  [8d88829]

- The host picks the number of rounds, 1 to 15. Points go single, double, triple, then start over.
- Board size follows the points: 6 to 8 answers on single, 5 to 7 on double, 4 to 6 on triple.

## 1.1 · October 11, 2026, 12:27 pm  [df206e4]

- Chat has two tabs: My Team (private) and Everyone (both teams and the host).
- The question stays hidden on every screen until the face-off is won, so nobody can buzz early
  just to read it.
- Optional answer timer the host can start during a turn. It buzzes at zero; the host decides
  what happens next.
- Boards no longer always have 8 answers.
- Question packs: General, Sports, Cars, Holidays, Food & Drink, Movies TV & Music, Late Night.

## 1.0.2 · October 11, 2026, 11:38 am  [52194ae]

- On a computer, the main address shows a "Show the scoreboard here" button, so there's no need
  to type /tv.

## 1.0.1 · October 11, 2026, 11:25 am  [2bb148d]

- Fixed "Not found" on Render: the game now runs with all its files in one folder, the way they
  were uploaded to GitHub.

## 1.0 · October 11, 2026, 11:16 am  [3b39bd2]

- First version: TV scoreboard, phones join with a 4-letter room code, two teams and a host,
  face-off buzzers, strikes, pass or play, steals, double and triple rounds, team chat, your own
  questions, and Fast Money.
