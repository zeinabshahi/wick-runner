// Contract self-check on a local chain:  npx ganache@7.9.2 --chain.chainId 46630 -p 8599   then  node contracts/test.mjs
import { readFileSync } from 'node:fs';
// ganache returns no revert data for custom errors, so each revert check only asserts the call fails
import { JsonRpcProvider, Wallet, ContractFactory, AbiCoder, keccak256, id, getBytes } from 'ethers';
import assert from 'node:assert';
const d = new URL('./build/', import.meta.url).pathname.slice(1) + 'contracts_WickRunnerScores_sol_WickRunnerScores.';
const p = new JsonRpcProvider(process.env.RPC || 'http://127.0.0.1:8599', 46630);
const S = await Promise.all([...Array(12).keys()].map(i => p.getSigner(i)));
const ver = Wallet.createRandom();
const c = await (await new ContractFactory(JSON.parse(readFileSync(d + 'abi')), '0x' + readFileSync(d + 'bin', 'utf8'), S[0]).deploy(ver.address)).waitForDeployment();
const addr = await c.getAddress(), B = id('v5:CP01'); let n = 0;
const sign = async (w, s, key = ver, dl) => { // same encoding as server.mjs attest()
  const r = id('run' + n++), deadline = dl ?? (await p.getBlock('latest')).timestamp + 3600;
  const h = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'address', 'address', 'bytes32', 'uint64', 'bytes32', 'uint64'], [46630, addr, await w.getAddress(), B, s, r, deadline]));
  return [B, s, r, deadline, key.signMessageSync(getBytes(h))];
};
const rec = async (w, s) => (await c.connect(w).record(...await sign(w, s))).wait();
const top = async () => (await c.top(B)).map(e => Number(e.score));
const who = async () => (await c.top(B)).map(e => e.player);
const fails = p => assert.rejects(Promise.resolve(p).then(tx => tx?.wait ? tx.wait() : tx)); // ganache may accept the send and revert on mining

const sc = [50, 90, 10, 70, 30, 100, 20, 80, 60, 40];
for (let i = 0; i < 10; i++) await rec(S[i], sc[i]);
assert.deepEqual(await top(), [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
await rec(S[2], 95); assert.deepEqual(await top(), [100, 95, 90, 80, 70, 60, 50, 40, 30, 20]);       // climbs, keeps one slot
await rec(S[2], 5); assert.equal(Number(await c.best(B, await S[2].getAddress())), 95);            // lower run changes nothing
await rec(S[10], 20); assert.equal((await top()).at(-1), 20); assert.notEqual((await who()).at(-1), await S[10].getAddress()); // tie: earlier keeps the place
await rec(S[11], 100); assert.deepEqual((await who()).slice(0, 2), [await S[5].getAddress(), await S[11].getAddress()]); // tie at the top too

// cheating
const a = await sign(S[1], 999);
await fails(c.connect(S[3]).record(...a));                                // someone else's attestation
await fails(c.connect(S[1]).record(...await sign(S[1], 999, Wallet.createRandom()))); // forged signer
const t = [...a]; t[1] = 9999; await fails(c.connect(S[1]).record(...t)); // edited score
await fails(c.connect(S[1]).record(...await sign(S[1], 999, ver, 1)));        // stale attestation
await (await c.connect(S[1]).record(...a)).wait();
await fails(c.connect(S[1]).record(...a));                                    // replay

// moderation
await fails(c.connect(S[1]).setBanned([await S[1].getAddress()], true, [B]));
const cheat = await S[1].getAddress();
await (await c.setBanned([cheat], true, [B])).wait();
assert.ok(!(await who()).includes(cheat)); assert.equal((await top()).length, 9);
await (await c.refill(B, [await S[10].getAddress(), cheat])).wait();                              // refill skips the banned wallet
assert.equal((await top()).length, 10); assert.ok(!(await who()).includes(cheat));
await fails(rec(S[1], 5000));
await (await c.setBanned([cheat], false, [B])).wait(); assert.equal((await top())[0], 999);       // unban restores the stored best
await (await c.setPaused(true)).wait(); await fails(rec(S[3], 1)); await (await c.setPaused(false)).wait();
await (await c.setVerifier(Wallet.createRandom().address)).wait(); await fails(rec(S[3], 1)); // rotated key voids old signer
await (await c.transferOwnership(await S[4].getAddress())).wait(); await (await c.connect(S[4]).acceptOwnership()).wait();
assert.equal(await c.owner(), await S[4].getAddress()); await fails(c.setPaused(true));
console.log('CONTRACT OK', await top(), 'runs', await c.runs());
