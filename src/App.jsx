import { useEffect, useMemo, useState } from "react";

const SIZE = 9;
const START = {
  p1: { r: 8, c: 4 },
  p2: { r: 0, c: 4 },
  walls: [],
  wallsLeft: { p1: 10, p2: 10 },
  turn: "p1",
  moves: 0,
  winner: null
};

const same = (a, b) => a.r === b.r && a.c === b.c;
const keyOf = (r, c) => `${r},${c}`;
const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const wallKey = (a, b) => [keyOf(a.r, a.c), keyOf(b.r, b.c)].sort().join("|");

// A wall is stored as one anchor { r, c, direction, owner } and blocks TWO edges.
// horizontal (r,c): blocks moving down from (r,c) and (r,c+1)
// vertical   (r,c): blocks moving right from (r,c) and (r+1,c)
function wallEdges({ r, c, direction }) {
  return direction === "horizontal"
    ? [[{ r, c }, { r: r + 1, c }], [{ r, c: c + 1 }, { r: r + 1, c: c + 1 }]]
    : [[{ r, c }, { r, c: c + 1 }], [{ r: r + 1, c }, { r: r + 1, c: c + 1 }]];
}

// Cache of blocked edges per walls array. Safe because walls is never mutated
// (always replaced with a new array) - never use walls.push() on game.walls.
const edgeCache = new WeakMap();
function blockedEdges(walls) {
  let set = edgeCache.get(walls);
  if (!set) {
    set = new Set();
    for (const w of walls) for (const [a, b] of wallEdges(w)) set.add(wallKey(a, b));
    edgeCache.set(walls, set);
  }
  return set;
}

function edgeBlocked(walls, a, b) {
  return blockedEdges(walls).has(wallKey(a, b));
}

// A turn = one action by each player. Total actions -> turns.
const turnsPlayed = (actions) => Math.ceil(actions / 2);
function neighbors(pos, walls) {
  return [[pos.r-1,pos.c],[pos.r+1,pos.c],[pos.r,pos.c-1],[pos.r,pos.c+1]]
    .filter(([r,c]) => inBounds(r,c) && !edgeBlocked(walls, pos, {r,c}))
    .map(([r,c]) => ({r,c}));
}
function hasPath(start, goalRow, walls) {
  const queue = [start];
  const visited = new Set([keyOf(start.r, start.c)]);
  while (queue.length) {
    const cur = queue.shift();
    if (cur.r === goalRow) return true;
    for (const next of neighbors(cur, walls)) {
      const key = keyOf(next.r, next.c);
      if (!visited.has(key)) { visited.add(key); queue.push(next); }
    }
  }
  return false;
}
function shortestDistance(start, goalRow, walls) {
  const queue = [[start, 0]];
  const visited = new Set([keyOf(start.r, start.c)]);
  while (queue.length) {
    const [cur, dist] = queue.shift();
    if (cur.r === goalRow) return dist;
    for (const next of neighbors(cur, walls)) {
      const key = keyOf(next.r, next.c);
      if (!visited.has(key)) { visited.add(key); queue.push([next, dist + 1]); }
    }
  }
  return 999;
}
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Real pawn moves: normal steps + jump over the opponent (Quoridor rules).
// neighbors() stays pawn-blind on purpose: path checks must ignore pawns.
function legalMoves(pos, opp, walls) {
  const moves = [];
  for (const [dr, dc] of DIRS) {
    const step = { r: pos.r + dr, c: pos.c + dc };
    if (!inBounds(step.r, step.c) || edgeBlocked(walls, pos, step)) continue;

    if (!same(step, opp)) { moves.push(step); continue; }

    const jump = { r: step.r + dr, c: step.c + dc };
    if (inBounds(jump.r, jump.c) && !edgeBlocked(walls, step, jump)) {
      moves.push(jump);
      continue;
    }

    for (const [sr, sc] of DIRS) {
      if (dr * sr + dc * sc !== 0) continue; // perpendicular directions only
      const side = { r: step.r + sr, c: step.c + sc };
      if (inBounds(side.r, side.c) && !edgeBlocked(walls, step, side)) moves.push(side);
    }
  }
  return moves;
}

// Returns an error message, or null if the wall is legal.
function wallError(game, wall) {
  if (wall.r >= SIZE - 1 || wall.c >= SIZE - 1) return "Walls must fit inside the board.";
  if (wallEdges(wall).some(([a, b]) => edgeBlocked(game.walls, a, b)))
    return "There is already a wall there.";
  if (game.walls.some(w => w.r === wall.r && w.c === wall.c && w.direction !== wall.direction))
    return "Walls can't cross each other.";
  const walls = [...game.walls, wall];
  if (!hasPath(game.p1, 0, walls) || !hasPath(game.p2, SIZE - 1, walls))
    return "Illegal wall: both players must keep a route to their goal.";
  return null;
}

function freshGame() {
  return {
    ...START,
    p1: { ...START.p1 }, p2: { ...START.p2 },
    walls: [], wallsLeft: { p1: 10, p2: 10 }
  };
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [mode, setMode] = useState("local");
  const [difficulty, setDifficulty] = useState("medium");
  const [name1, setName1] = useState("Player 1");
  const [name2, setName2] = useState("Player 2");
  const [draft1, setDraft1] = useState("Player 1");
  const [draft2, setDraft2] = useState("Player 2");
  const [game, setGame] = useState(freshGame);
  const [tool, setTool] = useState("move");
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState("Choose a move or place a wall.");
  const [matches, setMatches] = useState([]);
  const [saving, setSaving] = useState(false);

  const activeName = game.turn === "p1" ? name1 : name2;
  const computerTurn = mode === "computer" && game.turn === "p2" && !game.winner;

  useEffect(() => {
    fetch("/api/matches").then(r => r.ok ? r.json() : []).then(setMatches).catch(() => {});
  }, []);

  const resetToSetup = () => {
    setDraft1(name1); setDraft2(mode === "computer" ? "Genius AI" : name2);
    setScreen("setup");
  };
  const startGame = () => {
    setName1(draft1.trim() || "Player 1");
    setName2(mode === "computer" ? "Genius AI" : (draft2.trim() || "Player 2"));
    setGame(freshGame());
    setTool("move");
    setHistory([]);
    setStatus("Reach the opposite side. You cannot block every route.");
    setScreen("game");
  };

  const saveMatch = async (winnerKey) => {
    if (saving) return;
    setSaving(true);
    const winnerName = winnerKey === "p1" ? name1 : name2;
    const payload = {
      mode: mode === "computer" ? "1 VS Computer" : "1 VS 1",
      player1: name1,
      player2: name2,
      winner: winnerName,
      moves: game.moves
    };
    try {
      const response = await fetch("/api/matches", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const saved = await response.json();
        setMatches(prev => [saved, ...prev].slice(0, 100));
      }
    } catch {
      // The game still works without the optional local history server.
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (game.winner) saveMatch(game.winner);
    // Save exactly when the winner changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.winner]);

  const commitMove = (nextGame, message) => {
    setGame(nextGame);
    setStatus(message);
    setTool("move");
  };

  const chooseMove = () => {
    setTool("move");
    setStatus("Select a highlighted square to move.");
  };

  const chooseWall = () => {
    if (game.wallsLeft[game.turn] <= 0) {
      setStatus("No walls remaining. Choose Move instead.");
      return;
    }
    setTool("wall");
    setStatus("Click a wall slot. Each wall blocks two squares.");
  };

  const hasWall = (r, c, direction) =>
    game.walls.some(w => w.r === r && w.c === c && w.direction === direction);

  const tryMove = (r, c) => {
    if (game.winner || computerTurn || tool !== "move") return;
    const current = game[game.turn];
    const target = { r, c };
    const opponent = game.turn === "p1" ? game.p2 : game.p1;
    if (!legalMoves(current, opponent, game.walls).some(n => same(n, target))) {
      setStatus("That square is not a legal move.");
      return;
    }
    const next = { ...game, [game.turn]: target, moves: game.moves + 1 };
    const goalRow = game.turn === "p1" ? 0 : SIZE - 1;
    if (r === goalRow) {
      next.winner = game.turn;
      setStatus(`${game.turn === "p1" ? name1 : name2} reached the goal!`);
      setGame(next);
      return;
    }
    next.turn = game.turn === "p1" ? "p2" : "p1";
    commitMove(next, `${next.turn === "p1" ? name1 : name2}'s turn.`);
  };

  const tryWall = (r, c, direction) => {
    if (game.winner || computerTurn || tool !== "wall") return;
    if (game.wallsLeft[game.turn] <= 0) {
      setStatus("No walls remaining. Choose Move instead.");
      return;
    }
    const wall = { r, c, direction, owner: game.turn };
    const error = wallError(game, wall);
    if (error) {
      setStatus(error);
      return;
    }
    const next = {
      ...game,
      walls: [...game.walls, wall],
      wallsLeft: { ...game.wallsLeft, [game.turn]: game.wallsLeft[game.turn] - 1 },
      moves: game.moves + 1,
      turn: game.turn === "p1" ? "p2" : "p1"
    };
    commitMove(next, `${next.turn === "p1" ? name1 : name2}'s turn.`);
  };

  const computerMove = () => {
    if (!computerTurn) return;
    const current = game.p2;
    const goalRow = SIZE - 1;
    const options = legalMoves(current, game.p1, game.walls);
    if (!options.length) return;
    // Evaluate each legal step by the shortest remaining path; Hard also considers blocking.
    let best = options.map(pos => ({
      pos,
      score: shortestDistance(pos, goalRow, game.walls) + Math.random() * (difficulty === "easy" ? 2.5 : difficulty === "medium" ? 0.8 : 0.15)
    })).sort((a,b) => a.score - b.score)[0];

    let next = { ...game, p2: best.pos, moves: game.moves + 1 };
    if (best.pos.r === goalRow) {
      next.winner = "p2";
      setStatus("Genius AI reached the goal!");
      setGame(next);
      return;
    }

    // Medium/Hard may place a wall when it meaningfully slows the human without closing any route.
    if (difficulty !== "easy" && game.wallsLeft.p2 > 0) {
      const candidates = [];
      for (let r = 0; r < SIZE - 1; r++) for (let c = 0; c < SIZE - 1; c++) {
        for (const direction of ["horizontal", "vertical"]) {
          const wall = { r, c, direction, owner: "p2" };
          if (wallError(game, wall)) continue;
          const walls = [...game.walls, wall];
          const playerDist = shortestDistance(game.p1, 0, walls);
          const aiDist = shortestDistance(game.p2, SIZE - 1, walls);
          const gain = playerDist - shortestDistance(game.p1, 0, game.walls);
          if (gain > 0 && aiDist <= shortestDistance(game.p2, SIZE - 1, game.walls) + 1) {
            candidates.push({ walls, gain });
          }
        }
      }
      candidates.sort((a,b) => b.gain - a.gain);
      const chance = difficulty === "hard" ? 0.72 : 0.35;
      if (candidates.length && Math.random() < chance) {
        const w = candidates[0];
        next = {
          ...game,
          walls: w.walls,
          wallsLeft: { ...game.wallsLeft, p2: game.wallsLeft.p2 - 1 },
          moves: game.moves + 1
        };
        setStatus("Genius AI placed a wall to slow your route.");
      }
    }
    next.turn = "p1";
    if (!next.winner) setStatus("Your turn. Plan your route carefully.");
    setGame(next);
  };

  useEffect(() => {
    if (!computerTurn) return;
    const timer = setTimeout(computerMove, 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, game]);

  useEffect(() => {
    if (screen !== "game") return;

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (game.winner || computerTurn) return;

      if (e.code === "KeyM") chooseMove();
      else if (e.code === "KeyW") chooseWall();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, game, computerTurn]);

  const legalNeighbors = useMemo(() => {
    const opp = game.turn === "p1" ? game.p2 : game.p1;
    return legalMoves(game[game.turn], opp, game.walls);
  }, [game]);
  const historySorted = [...matches].sort((a,b) => new Date(b.playedAt) - new Date(a.playedAt)).slice(0, 8);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen("home")} aria-label="Go to home">
          <span className="brand-mark">TG</span>
          <span><strong>TRAP THE GENIUS</strong><small>THINK AHEAD. BLOCK SMART.</small></span>
        </button>
        <div className="top-status"><span className="status-dot" /> LOCAL ARENA <span className="top-divider">/</span> V1.0</div>
      </header>

      {screen === "home" && <section className="hero-layout">
        <div className="hero-copy">
          <div className="eyebrow"><span /> STRATEGY GAME · TWO WAYS TO PLAY</div>
          <h1>Outthink.<br/><em>Outmaneuver.</em></h1>
          <p className="hero-description">Every wall changes the board. Every move reveals your plan. Reach the opposite side before your rival traps your route.</p>
          <div className="mode-cards">
            <button className="mode-card blue-card" onClick={() => {setMode("local"); setScreen("setup");}}>
              <span className="mode-icon">⚔</span><span className="mode-label">LOCAL MULTIPLAYER</span>
              <strong>1 VS 1</strong><span className="mode-desc">Two players. One board. No mercy.</span><span className="mode-arrow">↗</span>
            </button>
            <button className="mode-card orange-card" onClick={() => {setMode("computer"); setDraft2("Genius AI"); setScreen("setup");}}>
              <span className="mode-icon">◈</span><span className="mode-label">CHALLENGE THE AI</span>
              <strong>1 VS COMPUTER</strong><span className="mode-desc">Test your strategy against Genius AI.</span><span className="mode-arrow">↗</span>
            </button>
          </div>
          <div className="feature-line"><span>▦ 9×9 GRID</span><span>◈ 10 WALLS EACH</span><span>⌁ PATHFINDING AI</span></div>
        </div>
        <aside className="hero-side">
          <div className="mini-board-wrap">
            <div className="mini-board-title"><span>BOARD PREVIEW</span><span>09 × 09</span></div>
            <MiniBoard />
            <div className="mini-legend"><span><i className="legend-blue"/> YOU</span><span><i className="legend-orange"/> RIVAL</span></div>
          </div>
          <div className="tip-card"><span className="tip-icon">✦</span><div><strong>Think two moves ahead</strong><p>Walls slow your opponent—but never block every path to the goal.</p></div></div>
        </aside>
      </section>}

      {screen === "setup" && <section className="setup-screen panel">
        <button className="back-link" onClick={() => setScreen("home")}>← BACK TO MENU</button>
        <div className="eyebrow"><span/> PLAYER SETUP</div>
        <h2>Enter the arena.</h2>
        <p className="muted">Pick your names, then prepare your first move.</p>
        <div className="setup-grid">
          <label>PLAYER ONE<input value={draft1} maxLength={30} onChange={e => setDraft1(e.target.value)} placeholder="Enter player name"/></label>
          {mode === "local" ? <label>PLAYER TWO<input value={draft2} maxLength={30} onChange={e => setDraft2(e.target.value)} placeholder="Enter player name"/></label> :
            <label>AI DIFFICULTY<select value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="easy">Easy — warm up</option><option value="medium">Medium — tactical</option><option value="hard">Hard — strategist</option></select></label>}
        </div>
        <div className="rules-strip"><span>01 <b>Move one square</b></span><span>02 <b>Or place a wall</b></span><span>03 <b>Reach the far edge</b></span></div>
        <button className="primary-button" onClick={startGame}>START MATCH <span>→</span></button>
      </section>}

      {screen === "game" && <section className="game-layout">
        <div className="game-main panel">
          <div className="game-heading"><div><div className="eyebrow"><span/> LIVE MATCH</div><h2>Strategy <em>arena</em></h2></div><button className="quiet-button" onClick={() => setScreen("home")}>EXIT MATCH</button></div>
          <div className="score-row">
            <PlayerCard name={name1} label="NORTHBOUND" color="blue" active={game.turn === "p1" && !game.winner} walls={game.wallsLeft.p1} />
            <div className="versus">VS</div>
            <PlayerCard name={name2} label={mode === "computer" ? "AI STRATEGIST" : "SOUTHBOUND"} color="orange" active={game.turn === "p2" && !game.winner} walls={game.wallsLeft.p2} />
          </div>
          <div className="board-frame">
            <div className="board-goal top-goal">P1 GOAL</div>
            <div className="board" role="grid" aria-label="9 by 9 strategy board">
              {Array.from({length: SIZE*SIZE}, (_,i) => {
                const r = Math.floor(i/SIZE), c = i%SIZE;
                const pos = {r,c};
                const p1 = same(game.p1,pos), p2 = same(game.p2,pos);
                const isLegal = !game.winner && !computerTurn && tool === "move" && game.turn && legalNeighbors.some(n => same(n,pos));
                return <div key={keyOf(r,c)} className={`square ${isLegal ? "legal-square" : ""} ${p1 ? "piece-square" : ""} ${p2 ? "piece-square" : ""}`} role="gridcell">
                  <button className="square-button" onClick={() => tryMove(r,c)} disabled={!!game.winner || computerTurn} aria-label={`Row ${r+1}, column ${c+1}`}>
                    {p1 && <span className="piece piece-blue">1</span>}
                    {p2 && <span className="piece piece-orange">{mode === "computer" ? "AI" : "2"}</span>}
                    {isLegal && !p1 && !p2 && <span className="move-dot"/>}
                  </button>
                  {r < SIZE-1 && c < SIZE-1 && (
                    <>
                      <button className={`wall-slot wall-horizontal ${hasWall(r,c,"horizontal") ? "wall-set" : ""}`} onClick={() => tryWall(r,c,"horizontal")} aria-label="Place horizontal wall" disabled={!!game.winner || computerTurn || tool !== "wall"} title="Horizontal wall"/>
                      <button className={`wall-slot wall-vertical ${hasWall(r,c,"vertical") ? "wall-set" : ""}`} onClick={() => tryWall(r,c,"vertical")} aria-label="Place vertical wall" disabled={!!game.winner || computerTurn || tool !== "wall"} title="Vertical wall"/>
                    </>
                  )}
                </div>;
              })}
            </div>
            <div className="board-goal bottom-goal">P2 GOAL</div>
          </div>
          <div className={`status-bar ${game.winner ? "win-status" : ""}`}><span className="status-pulse"/>{game.winner ? `🏆 ${game.winner === "p1" ? name1 : name2} wins the match!` : computerTurn ? "Genius AI is calculating..." : status}</div>
        </div>
        <aside className="game-sidebar">
          <div className="panel control-panel">
            <div className="panel-title"><span>YOUR ACTION</span><span className="tiny-count">TURN {turnsPlayed(game.moves + 1)}</span></div>
            <button className={`action-choice ${tool === "move" ? "selected" : ""}`} onClick={chooseMove} disabled={!!game.winner || computerTurn}><span className="action-icon">↗</span><span><b>Move piece</b><small>Step or jump over your rival</small></span><kbd>M</kbd></button>
            <button className={`action-choice ${tool === "wall" ? "selected" : ""}`} onClick={chooseWall} disabled={!!game.winner || computerTurn || game.wallsLeft[game.turn] <= 0}><span className="action-icon">▰</span><span><b>Place a wall</b><small>Block a route, not every route</small></span><kbd>W</kbd></button>
            <div className="rule-note"><span>i</span><p>Each wall blocks two squares side by side. A valid route to the goal must remain open for both players.</p></div>
            <button className="primary-button full-button" onClick={() => {setGame(freshGame());setHistory([]);setTool("move");setStatus("New match started. Make your move.");}} disabled={!game.winner}>PLAY AGAIN <span>↻</span></button>
            <button className="text-button" onClick={resetToSetup}>Change players / difficulty</button>
          </div>
          <div className="panel recent-panel"><div className="panel-title"><span>RECENT MATCHES</span><span className="tiny-count">{matches.length} SAVED</span></div>
            {historySorted.length ? historySorted.slice(0,4).map(m => <div className="match-line" key={m.id}><span className="match-mark">✦</span><div><b>{m.winner}</b><small>{m.mode} · {turnsPlayed(m.moves)} turns</small></div></div>) : <p className="empty-state">Your completed matches will appear here.</p>}
          </div>
        </aside>
      </section>}

      {screen === "game" && game.winner && <div className="winner-overlay"><div className="winner-card"><div className="winner-symbol">♛</div><div className="eyebrow"><span/> MATCH COMPLETE</div><h2>{game.winner === "p1" ? name1 : name2}<br/><em>outsmarted the board.</em></h2><p>Victory in {turnsPlayed(game.moves)} turns. The arena remembers.</p><div className="winner-actions"><button className="primary-button" onClick={() => {setGame(freshGame());setTool("move");setStatus("New match started.");}}>REMATCH ↻</button><button className="quiet-button" onClick={() => setScreen("home")}>MAIN MENU</button></div></div></div>}

      {screen === "home" && <section className="bottom-section">
        <div className="section-heading"><div><div className="eyebrow"><span/> THE RULES</div><h2>Simple moves. <em>Deep strategy.</em></h2></div><span className="section-note">HOW TO WIN</span></div>
        <div className="rule-cards"><article><span>01</span><h3>Move smart</h3><p>Step one square at a time toward the opposite edge.</p></article><article><span>02</span><h3>Control the board</h3><p>Spend your walls to slow your rival or protect your route.</p></article><article><span>03</span><h3>Keep a path open</h3><p>No wall may remove every possible route to either goal.</p></article></div>
      </section>}
      <footer className="footer"><span>TRAP THE GENIUS © 2026</span><span>BUILT FOR THE ARENA <b>✦</b></span></footer>
    </main>
  );
}

function PlayerCard({name,label,color,active,walls}) {
  return <div className={`player-card ${color} ${active ? "player-active" : ""}`}><div className="player-avatar">{color === "blue" ? "01" : "02"}</div><div className="player-info"><small>{label}</small><strong>{name}</strong><span>{walls} walls remaining</span></div><span className="turn-indicator">{active ? "YOUR TURN" : "WAITING"}</span></div>;
}
function MiniBoard() {
  return <div className="mini-board">{Array.from({length:49},(_,i)=><span key={i} className={`${i===38?"mini-blue":i===10?"mini-orange":""} ${[17,18,25,26].includes(i)?"mini-wall":""}`}>{i===38?"1":i===10?"2":""}</span>)}</div>;
}