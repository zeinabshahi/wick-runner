// Moderation for WickRunnerScores, from on-chain data only (there is no database).
//   $env:OWNER_KEY="0x…"; node contracts/admin.mjs ban 0xWallet
//   $env:OWNER_KEY="0x…"; node contracts/admin.mjs unban 0xWallet
// A ban removes the wallet from every board it recorded on, then refills those boards from the other players' stored bests.
import { JsonRpcProvider, Wallet, Contract } from 'ethers';

const [cmd, who] = process.argv.slice(2);
const provider = new JsonRpcProvider(process.env.CHAIN_RPC || 'https://rpc.testnet.chain.robinhood.com', 46630, { staticNetwork: true });
const abi = ['function setBanned(address[],bool,bytes32[])', 'function refill(bytes32,address[])', 'event Run(address indexed player, bytes32 indexed board, uint64 score, bytes32 indexed runId, bool newBest)'];
if (!process.env.OWNER_KEY) throw new Error('Set OWNER_KEY (the wallet that deployed the contract)');
const c = new Contract(process.env.SCORES_ADDRESS || '0x2417104586F701fD9AbBc7e068A461ad5766Fe89', abi, new Wallet(process.env.OWNER_KEY, provider));
const w = (who || '').toLowerCase();
if (!['ban', 'unban'].includes(cmd) || !/^0x[0-9a-f]{40}$/.test(w)) { console.log('usage: ban <wallet> | unban <wallet>'); process.exit(1); }

const runs = await c.queryFilter(c.filters.Run(), 0);                      // every record ever made
const boards = [...new Set(runs.filter(e => e.args.player.toLowerCase() === w).map(e => e.args.board))];
await (await c.setBanned([w], cmd === 'ban', boards)).wait();
if (cmd === 'ban') for (const b of boards) {
  const players = [...new Set(runs.filter(e => e.args.board === b).map(e => e.args.player))];
  for (let i = 0; i < players.length; i += 50) await (await c.refill(b, players.slice(i, i + 50))).wait(); // the contract re-ranks from stored bests and skips banned wallets
}
console.log(cmd, w, 'on', boards.length, 'boards');
