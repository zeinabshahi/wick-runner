// Deploys WickRunnerScores to Robinhood Chain testnet.
// DEPLOYER_KEY=0x… (a testnet wallet with faucet ETH)  VERIFIER_KEY=0x… (the same key the server uses)  node contracts/deploy.mjs
// Prints the address to put in game.mjs (SCORES.address) and the server env (SCORES_ADDRESS).
import { readFileSync } from 'node:fs';
import { JsonRpcProvider, Wallet, ContractFactory } from 'ethers';

const dir = new URL('./build/contracts_WickRunnerScores_sol_WickRunnerScores.', import.meta.url);
const abi = JSON.parse(readFileSync(new URL(dir.href + 'abi'))), bin = '0x' + readFileSync(new URL(dir.href + 'bin'), 'utf8').trim();
const provider = new JsonRpcProvider('https://rpc.testnet.chain.robinhood.com', 46630);
if (!process.env.DEPLOYER_KEY || !process.env.VERIFIER_KEY) throw new Error('Set DEPLOYER_KEY and VERIFIER_KEY');
const deployer = new Wallet(process.env.DEPLOYER_KEY, provider), verifier = new Wallet(process.env.VERIFIER_KEY).address;
const c = await new ContractFactory(abi, bin, deployer).deploy(verifier);
await c.waitForDeployment();
console.log('WickRunnerScores', await c.getAddress(), 'verifier', verifier);
