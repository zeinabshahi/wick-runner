// Privy bridge: email login with an embedded wallet (no browser-extension wallets, per the vibe/vibe rules).
// Built into vendor/privy.js by `npm run build:wallet`. The game talks only to window.WickWallet:
//   await WickWallet.init(appId)   -> mounts Privy
//   await WickWallet.login()       -> email login; resolves with the embedded wallet address (lowercase)
//   await WickWallet.provider()    -> EIP-1193 provider of that embedded wallet, already on Robinhood Chain testnet
//   await WickWallet.logout(); WickWallet.address(); WickWallet.onChange(fn)
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useWallets, useLogin } from '@privy-io/react-auth';

const chain = {
  id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } }, testnet: true,
};
let api = null, wallet = null, doLogin = null, pending = null, readyResolve; const ready = new Promise(r => (readyResolve = r)), listeners = new Set();
const notify = () => listeners.forEach(f => { try { f(state.address()); } catch {} });

function Bridge() {
  const privy = usePrivy(), { wallets } = useWallets();
  const { login } = useLogin({ onComplete: () => { pending?.res(); pending = null; }, onError: e => { pending?.rej(Object.assign(new Error(e === 'exited_auth_flow' ? 'Sign-in cancelled.' : 'Sign-in failed. Please retry.'), { code: e === 'exited_auth_flow' ? 4001 : 0 })); pending = null; } });
  doLogin = login;
  useEffect(() => { api = privy; if (privy.ready) readyResolve(); }, [privy, privy.ready]);
  useEffect(() => { wallet = privy.authenticated ? wallets.find(w => w.walletClientType === 'privy') || null : null; notify(); }, [wallets, privy.authenticated]);
  return null;
}
const waitFor = (test, ms = 20000) => new Promise((res, rej) => { const t0 = Date.now(), i = setInterval(() => { const v = test(); if (v) { clearInterval(i); res(v); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('Wallet is still being created. Please try again.')); } }, 150); });

const state = {
  init(appId) {
    if (!appId) throw new Error('Sign-in is not configured yet.');
    if (state._mounted) return ready; state._mounted = true;
    const host = document.createElement('div'); host.id = 'privy-root'; document.body.append(host);
    createRoot(host).render(createElement(PrivyProvider, { appId, config: {
      loginMethods: ['email'],                                    // email only: no external wallets
      embeddedWallets: { ethereum: { createOnLogin: 'all-users' } },
      defaultChain: chain, supportedChains: [chain],
      appearance: { theme: 'dark', accentColor: '#dcf513', walletList: [] },
    } }, createElement(Bridge)));
    return ready;
  },
  async login() {
    await ready;
    if (!api.authenticated) await new Promise((res, rej) => { pending = { res, rej }; doLogin(); });
    await waitFor(() => wallet); return state.address();
  },
  async provider() { const w = await waitFor(() => wallet); await w.switchChain(chain.id); return w.getEthereumProvider(); },
  async logout() { await ready; await api.logout(); wallet = null; notify(); },
  address: () => wallet?.address?.toLowerCase() || null,
  onChange(fn) { listeners.add(fn); },
};
window.WickWallet = state;
