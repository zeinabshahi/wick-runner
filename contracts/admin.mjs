// Moderation that keeps the database and the contract in step. Run beside the server's data folder.
//   OWNER_KEY=0x… SCORES_ADDRESS=0x… node contracts/admin.mjs ban 0xWallet "reason"
//   OWNER_KEY=0x… SCORES_ADDRESS=0x… node contracts/admin.mjs unban 0xWallet
//   SCORES_ADDRESS=0x… node contracts/admin.mjs check      (read-only: compares every board's top 10, DB vs chain)
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { JsonRpcProvider, Wallet, Contract, id } from 'ethers';

const [cmd, who, reason = ''] = process.argv.slice(2);
const db = new DatabaseSync(resolve(process.env.DATA_DIR || 'data', 'parkour.sqlite'));
const provider = new JsonRpcProvider(process.env.CHAIN_RPC || 'https://rpc.testnet.chain.robinhood.com', 46630, { staticNetwork: true });
const abi = ['function setBanned(address[],bool,bytes32[])', 'function refill(bytes32,address[])', 'function top(bytes32) view returns (tuple(address player,uint64 score,uint64 seq)[])', 'function banned(address) view returns (bool)'];
const c = new Contract(process.env.SCORES_ADDRESS, abi, process.env.OWNER_KEY ? new Wallet(process.env.OWNER_KEY, provider) : provider);
const recordedBoards = w => db.prepare('SELECT DISTINCT board FROM scores WHERE tx IS NOT NULL' + (w ? ' AND wallet=?' : '')).all(...(w ? [w] : [])).map(r => r.board);
const dbTop = board => db.prepare(`SELECT s.wallet, s.score FROM scores s WHERE s.board=? AND s.tx IS NOT NULL AND s.wallet NOT IN (SELECT wallet FROM banned)
  AND NOT EXISTS (SELECT 1 FROM scores o WHERE o.board=s.board AND o.wallet=s.wallet AND o.tx IS NOT NULL AND (o.score > s.score OR (o.score = s.score AND (o.pos < s.pos OR (o.pos = s.pos AND o.id < s.id)))))
  ORDER BY s.score DESC, s.pos ASC, s.id ASC LIMIT 10`).all(board);

if (cmd === 'ban' || cmd === 'unban') {
  const w = (who || '').toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(w)) throw new Error('Give a wallet address');
  const boards = recordedBoards(w);
  if (cmd === 'ban') db.prepare('INSERT OR REPLACE INTO banned VALUES (?,?,?)').run(w, reason, Date.now()); else db.prepare('DELETE FROM banned WHERE wallet=?').run(w);
  await (await c.setBanned([w], cmd === 'ban', boards.map(b => id(b)))).wait();
  if (cmd === 'ban') for (const b of boards) { // a ban opens a slot on chain; refill it from the next recorded players, exactly as the DB ranks them
    const next = dbTop(b).map(r => r.wallet); if (next.length) await (await c.refill(id(b), next)).wait();
  }
  console.log(cmd, w, 'on', boards.length, 'boards, DB and chain');
} else if (cmd === 'check') {
  let bad = 0;
  for (const b of recordedBoards()) {
    const a = dbTop(b).map(r => `${r.wallet}:${r.score}`).join(), z = (await c.top(id(b))).map(e => `${e.player.toLowerCase()}:${e.score}`).join();
    if (a !== z) { bad++; console.log('MISMATCH', b.slice(0, 60), '\n  db   ', a, '\n  chain', z); }
  }
  console.log(bad ? `${bad} boards differ` : 'DB and chain agree on every recorded board'); process.exitCode = bad ? 1 : 0;
} else console.log('usage: ban <wallet> [reason] | unban <wallet> | check');
