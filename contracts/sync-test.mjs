// DB<->chain agreement check on a local chain (npx ganache@7.9.2 --chain.chainId 46630 -p 8599 -a 12 -d): DATA_DIR=<empty dir> node contracts/sync-test.mjs, then admin.mjs check / ban / unban. Random runs recorded on a local chain AND in a DB with the server's schema; then admin.mjs check must agree
import { readFileSync } from 'node:fs'; import { resolve } from 'node:path'; import { DatabaseSync } from 'node:sqlite';
import { JsonRpcProvider, Wallet, ContractFactory, AbiCoder, keccak256, id, getBytes } from 'ethers';
const d = new URL('./build/', import.meta.url).pathname.slice(1) + 'contracts_WickRunnerScores_sol_WickRunnerScores.';
const p = new JsonRpcProvider('http://127.0.0.1:8599', 46630); const S = await Promise.all([...Array(12).keys()].map(i => p.getSigner(i)));
const ver = Wallet.createRandom(), c = await (await new ContractFactory(JSON.parse(readFileSync(d + 'abi')), '0x' + readFileSync(d + 'bin', 'utf8'), S[0]).deploy(ver.address)).waitForDeployment();
const addr = await c.getAddress(); console.log('ADDR', addr);
const db = new DatabaseSync(resolve(process.env.DATA_DIR, 'parkour.sqlite'));
db.exec(`CREATE TABLE scores (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, board TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, time REAL NOT NULL, cleared INTEGER NOT NULL, log TEXT NOT NULL, created INTEGER NOT NULL, tx TEXT, pos INTEGER);
  CREATE TABLE banned (wallet TEXT PRIMARY KEY, reason TEXT, created INTEGER NOT NULL);`);
let seed = 7; const rnd = n => (seed = (seed * 16807) % 2147483647) % n;
for (let k = 0; k < 90; k++) {
  const w = S[rnd(12)], wa = (await w.getAddress()).toLowerCase(), board = ['v5:CP01', 'v5:CP02'][rnd(2)], score = 100 + rnd(30) * 10, sid = 'run' + k; // coarse scores => many ties
  const dl = (await p.getBlock('latest')).timestamp + 3600, h = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address','bytes32','uint64','bytes32','uint64'], [46630, addr, wa, id(board), score, id(sid), dl]));
  const onchain = rnd(4) > 0; // some verified runs are never recorded on chain
  db.prepare('INSERT INTO scores VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(sid, wa, board, 'n', score, 1, 1, '{}', 1000 + rnd(50), null, null);
  if (onchain) { const rc = await (await c.connect(w).record(id(board), score, id(sid), dl, ver.signMessageSync(getBytes(h)))).wait(); db.prepare('UPDATE scores SET tx=?, pos=? WHERE id=?').run(rc.hash, rc.blockNumber * 1e5 + rc.logs[0].index, sid); }
}
console.log('OWNER', (await S[0].getAddress()));

