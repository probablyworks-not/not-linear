import { useEffect, useState } from 'react';
import { subscriptionOperation, type SubscriptionProvider, type SubscriptionModel } from '../../providers/subscription';
import { BTN_PRIMARY } from '../ui';
import { Section } from '../fields';

export const SUBSCRIPTION_MODELS_EVENT = 'notlinear:subscription-models';

export function SubscriptionConnections() {
  const [status, setStatus] = useState('Checking connections…');
  const [connected, setConnected] = useState<Record<SubscriptionProvider, boolean>>({ claude:false, chatgpt:false });
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<Record<string, SubscriptionModel[]>>({});
  const load = async () => {
    const current = await subscriptionOperation('status');
    const all: Record<string, SubscriptionModel[]> = {};
    for (const provider of ['claude', 'chatgpt'] as const) if (current[provider]) all[provider] = await subscriptionOperation('models', provider);
    setConnected({ claude:!!current.claude, chatgpt:!!current.chatgpt });
    setModels(all);
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_MODELS_EVENT, { detail:all }));
    setStatus('Model list updated.');
  };
  useEffect(() => { queueMicrotask(() => { void load().catch((e:Error) => setStatus(e.message)); }); }, []);
  const connect = async (provider:SubscriptionProvider) => {
    setBusy(true); setStatus('Complete the official sign-in in your browser…');
    try { await subscriptionOperation('connect', provider); await load(); }
    catch (e) { setStatus(e instanceof Error ? e.message : 'Connection failed.'); }
    finally { setBusy(false); }
  };
  return <Section label="Subscriptions" help="Connect your own plan. Subscription requests never fall back to paid API usage.">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(270px,1fr))] items-start gap-3">
      {(['claude', 'chatgpt'] as const).map(provider => <div key={provider} className="rounded-[14px] border border-rule bg-surface p-3.5">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] bg-bg-3">
            {provider === 'claude'
              ? <img src="/web/provider-logos/claude-color.svg" alt="" className="h-6 w-6" />
              : <span className="block h-6 w-6 bg-success" style={{mask:'url(/web/provider-logos/openai.svg) center / contain no-repeat', WebkitMask:'url(/web/provider-logos/openai.svg) center / contain no-repeat'}} />}
          </span>
          <span className="min-w-0 flex-1"><span className="block text-base font-semibold text-text">{provider === 'claude' ? 'Claude' : 'ChatGPT'}</span><span className="block text-xs text-text-3">{connected[provider] ? `${models[provider]?.length ?? 0} models available` : 'Use your subscription'}</span></span>
          <div className="flex flex-none flex-col items-end gap-1">
            <span className="text-xs text-text-3">{connected[provider] ? 'Connected' : 'Not connected'}</span>
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void connect(provider)}>{connected[provider] ? 'Reconnect' : provider === 'claude' ? 'Connect Claude' : 'Continue with ChatGPT'}</button>
          </div>
        </div>
      </div>)}
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void load().catch((e:Error) => setStatus(e.message))}>Refresh models</button><span className="text-sm text-text-3" role="status">{status}</span></div>
  </Section>;
}
