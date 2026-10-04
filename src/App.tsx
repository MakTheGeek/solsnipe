import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { authFetch, clearAuthToken, safeJson, setAuthToken } from './api';
import { ActivePositions } from './components/ActivePositions';
import { AnalysisModal } from './components/AnalysisModal';
import { DashboardLockScreen } from './components/DashboardLockScreen';
import { Header } from './components/Header';
import { ManualAnalyzer } from './components/ManualAnalyzer';
import { SecuritySettingsModal } from './components/SecuritySettingsModal';
import { SniperSettings } from './components/SniperSettings';
import { SniperStats } from './components/SniperStats';
import { TelegramFeed } from './components/TelegramFeed';
import { TradeHistory } from './components/TradeHistory';
import {
  ActivePosition,
  SecurityStatus,
  SniperConfig,
  TelegramCall,
  TelegramStatus,
  TradeHistoryItem,
} from './types';

interface RiskStatus {
  circuitBreakerTripped: boolean;
  circuitBreakerReason?: string;
  liveTradingEnabled: boolean;
  currentOpenPositions?: number;
  totalExposureSol?: number;
  dailyLossSol?: number;
  tradesInLastHour?: number;
  consecutiveFailures?: number;
}

const DEFAULT_CONFIG: SniperConfig = {
  autoSnipe: true,
  tradingAmountSol: 0.1,
  takeProfitPercent: 50,
  stopLossPercent: 15,
  trailingStopPercent: 10,
  slippagePercent: 5,
  maxRugCheckScore: 800,
  rejectOnRugCheckDanger: true,
  router: 'jupiter',
  executionMode: 'simulation',
  priorityFeeSol: 0.005,
  jitoTipSol: 0.005,
  walletPublicKey: '',
  hasPrivateKey: false,
};

const getStoredConfig = (): SniperConfig => {
  try {
    const raw = localStorage.getItem('solana_sniper_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    }
  } catch {}
  return DEFAULT_CONFIG;
};

export default function App() {
  const [calls, setCalls] = useState<TelegramCall[]>([]);
  const [positions, setPositions] = useState<ActivePosition[]>([]);
  const [history, setHistory] = useState<TradeHistoryItem[]>([]);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [selectedCall, setSelectedCall] = useState<TelegramCall | null>(null);
  const [activeTab, setActiveTab] = useState<'stream' | 'positions' | 'history' | 'stats' | 'settings'>('stream');
  const [isManualAnalyzing, setIsManualAnalyzing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Dashboard Security & Risk State
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [riskStatus, setRiskStatus] = useState<RiskStatus | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);

  const [config, setConfig] = useState<SniperConfig>(getStoredConfig);

  const saveConfig = (newCfg: SniperConfig) => {
    setConfig(newCfg);
    try {
      localStorage.setItem('solana_sniper_config', JSON.stringify(newCfg));
    } catch {}
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Initial Data Hydration with resilient fetching and auto-retry
  const fetchData = async (retries = 3, delayMs = 1000): Promise<void> => {
    const fetchSafe = async (url: string) => {
      try {
        const res = await authFetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    try {
      const [callsData, posData, histData, configData, statusData] = await Promise.all([
        fetchSafe('/api/calls'),
        fetchSafe('/api/positions'),
        fetchSafe('/api/history'),
        fetchSafe('/api/config'),
        fetchSafe('/api/status'),
      ]);

      if (callsData) {
        const incomingCalls = (callsData.calls || (Array.isArray(callsData) ? callsData : [])) as TelegramCall[];
        const seenAddrs = new Set<string>();
        const uniqueCalls = incomingCalls.filter((c) => {
          if (!c || !c.tokenAddress) return false;
          const lower = c.tokenAddress.toLowerCase();
          if (seenAddrs.has(lower)) return false;
          seenAddrs.add(lower);
          return true;
        });
        setCalls(uniqueCalls);
        if (callsData.status) setTelegramStatus(callsData.status);
      }

      if (posData) {
        const incomingPos = (posData.positions || (Array.isArray(posData) ? posData : [])) as ActivePosition[];
        const seen = new Set<string>();
        const uniquePos = incomingPos.filter((p) => {
          if (!p || !p.id || seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
        setPositions(uniquePos);
      }

      if (histData) {
        const incomingHist = (histData.history || (Array.isArray(histData) ? histData : [])) as TradeHistoryItem[];
        const seen = new Set<string>();
        const uniqueHist = incomingHist.filter((h) => {
          if (!h || !h.id || seen.has(h.id)) return false;
          seen.add(h.id);
          return true;
        });
        setHistory(uniqueHist);
      }

      if (configData) {
        saveConfig(configData);
      }

      if (statusData) {
        if (statusData.telegram) {
          setTelegramStatus(statusData.telegram);
        }
        if (statusData.risk) {
          setRiskStatus(statusData.risk);
        }
        if (statusData.security) {
          setSecurityStatus(statusData.security);
          if (statusData.security.enabled) {
            const token =
              localStorage.getItem('solana_sniper_auth_token') ||
              sessionStorage.getItem('solana_sniper_auth_token');
            if (!token) {
              setIsLocked(true);
            }
          }
        }
      }

      const anyLoaded = !!(callsData || posData || histData || configData || statusData);
      if (!anyLoaded && retries > 0) {
        setTimeout(() => fetchData(retries - 1, delayMs * 1.5), delayMs);
      }
    } catch {
      if (retries > 0) {
        setTimeout(() => fetchData(retries - 1, delayMs * 1.5), delayMs);
      }
    }
  };

  useEffect(() => {
    fetchData();

    // Listen for 401 unauthorized events to trigger lock
    const onUnauthorized = () => {
      setIsLocked(true);
      clearAuthToken();
      showToast('Session expirée ou code de sécurité requis');
    };
    window.addEventListener('solsnipe:unauthorized', onUnauthorized);

    // Setup SSE stream for real-time live events
    const eventSource = new EventSource('/api/stream');

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        switch (payload.type) {
          case 'INIT': {
            if (payload.data?.status) {
              if (payload.data.status.telegram) setTelegramStatus(payload.data.status.telegram);
              if (payload.data.status.config) saveConfig(payload.data.status.config);
              if (payload.data.status.security) setSecurityStatus(payload.data.status.security);
              if (payload.data.status.risk) setRiskStatus(payload.data.status.risk);
            }
            if (payload.data?.positions) setPositions(payload.data.positions);
            if (payload.data?.history) setHistory(payload.data.history);
            if (payload.data?.calls) setCalls(payload.data.calls);
            break;
          }
          case 'CALL_DETECTED': {
            setCalls((prev) => {
              const exists = prev.some(
                (c) => c.id === payload.data.id || c.tokenAddress === payload.data.tokenAddress
              );
              if (exists) return prev;
              return [payload.data, ...prev];
            });
            showToast(`Signal détecté : ${payload.data.tokenSymbol || 'Token'}`);
            break;
          }
          case 'CALL_ANALYZED': {
            setCalls((prev) => {
              const targetId = payload.data.id;
              const hasDirectId = prev.some((c) => c.id === targetId);

              if (hasDirectId) {
                return prev.map((c) => (c.id === targetId ? payload.data : c));
              }

              let updated = false;
              const updatedList = prev.map((c) => {
                if (!updated && c.tokenAddress === payload.data.tokenAddress) {
                  updated = true;
                  return {
                    ...payload.data,
                    id: c.id,
                  };
                }
                return c;
              });

              if (!updated) {
                return [payload.data, ...prev];
              }
              return updatedList;
            });
            if (payload.data.status === 'SNIPED') {
              showToast(`🎯 Token validé pour snipe : ${payload.data.tokenSymbol}`);
            }
            break;
          }
          case 'CALL_UPDATED': {
            setCalls((prev) => prev.map((c) => (c.id === payload.data.id ? payload.data : c)));
            break;
          }
          case 'SNIPE_EXECUTED': {
            setPositions((prev) => {
              const exists = prev.some((p) => p.id === payload.data.id);
              if (exists) return prev;
              return [payload.data, ...prev];
            });
            showToast(`🚀 POSITION OUVERTE : $${payload.data.tokenSymbol}`);
            break;
          }
          case 'POSITIONS_UPDATED': {
            const seen = new Set<string>();
            setPositions(
              payload.data.filter((p: ActivePosition) => {
                if (!p || !p.id || seen.has(p.id)) return false;
                seen.add(p.id);
                return true;
              })
            );
            break;
          }
          case 'TRADE_EXECUTED': {
            setHistory((prev) => {
              if (prev.some((t) => t.id === payload.data.id)) return prev;
              return [payload.data, ...prev];
            });
            showToast(`Position fermée : $${payload.data.tokenSymbol} (${payload.data.exitReason})`);
            break;
          }
          case 'CONFIG_UPDATED': {
            saveConfig(payload.data);
            break;
          }
          case 'RISK_UPDATED': {
            if (payload.data) {
              setRiskStatus(payload.data);
            }
            break;
          }
          case 'WALLET_UPDATED': {
            if (payload.data) {
              setConfig((prev) => ({
                ...prev,
                walletPublicKey: payload.data.publicKey,
                walletBalanceSol: payload.data.balanceSol,
                hasPrivateKey: payload.data.isConfigured,
              }));
            }
            break;
          }
          case 'TELEGRAM_STATUS': {
            if (payload.data) {
              setTelegramStatus(payload.data);
            }
            break;
          }
          case 'SECURITY_UPDATED': {
            if (payload.data) {
              setSecurityStatus(payload.data);
              if (!payload.data.enabled) {
                setIsLocked(false);
              }
            }
            break;
          }
          default:
            break;
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    // Periodic poll fallback every 3 seconds
    const pollInterval = setInterval(() => {
      authFetch('/api/positions')
        .then((r) => r.json())
        .then((d) => setPositions(Array.isArray(d) ? d : d.positions || []))
        .catch(() => {});

      authFetch('/api/calls')
        .then((r) => r.json())
        .then((d) => {
          const incoming = Array.isArray(d) ? d : d.calls || [];
          if (Array.isArray(incoming)) {
            setCalls((prev) => {
              const prevIds = new Set(prev.map((c) => c.id));
              const prevAddrs = new Set(prev.map((c) => c.tokenAddress));

              const updated = prev.map((c) => {
                const fresh = incoming.find((x) => x.id === c.id || x.tokenAddress === c.tokenAddress);
                return fresh ? { ...fresh, id: c.id } : c;
              });

              const newItems = incoming.filter((c) => !prevIds.has(c.id) && !prevAddrs.has(c.tokenAddress));
              return [...newItems, ...updated];
            });
          }
        })
        .catch(() => {});
    }, 3000);

    return () => {
      window.removeEventListener('solsnipe:unauthorized', onUnauthorized);
      eventSource.close();
      clearInterval(pollInterval);
    };
  }, []);

  const handleToggleAutoSnipe = async () => {
    const updated = !config.autoSnipe;
    const optimistic = { ...config, autoSnipe: updated };
    saveConfig(optimistic);
    try {
      const res = await authFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSnipe: updated }),
      });
      if (res.ok) {
        const data = await res.json();
        saveConfig(data);
        showToast(updated ? 'Auto-Sniper ACTIVÉ' : 'Auto-Sniper EN PAUSE');
      }
    } catch (err) {
      console.error('Config update error:', err);
    }
  };

  const handleUpdateConfig = async (newConfig: Partial<SniperConfig>) => {
    const optimistic = { ...config, ...newConfig };
    saveConfig(optimistic);
    try {
      const res = await authFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      if (res.ok) {
        const data = await res.json();
        saveConfig(data);
        showToast('Paramètres mis à jour avec succès');
      }
    } catch (err) {
      console.error('Config update error:', err);
    }
  };

  const handleManualAnalyze = async (tokenAddress: string) => {
    setIsManualAnalyzing(true);
    try {
      const res = await authFetch('/api/manual-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: tokenAddress }),
      });
      if (res.ok) {
        const report = await res.json();
        showToast(`Audit terminé : ${report.decision} (${report.tokenSymbol})`);
        fetchData();
      } else {
        const err = await res.json();
        showToast(`Échec audit : ${err.error || 'Vérifiez le mint'}`);
      }
    } catch (err: any) {
      showToast(`Erreur audit : ${err.message}`);
    } finally {
      setIsManualAnalyzing(false);
    }
  };

  const handleManualSnipe = async (tokenAddress: string) => {
    try {
      const res = await authFetch('/api/manual-snipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress, amountSol: config.tradingAmountSol }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Snipe manuel déclenché pour ${tokenAddress.slice(0, 8)}...`);
        fetchData();
      } else {
        showToast(`Snipe rejeté : ${data.error || 'Erreur'}`);
      }
    } catch (err: any) {
      showToast(`Erreur snipe : ${err.message}`);
    }
  };

  const handleSellPosition = async (positionId: string, percent: number) => {
    try {
      const res = await authFetch('/api/sell-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, percent, reason: 'manual' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Ordre de vente exécuté (${percent}%)`);
        fetchData();
      } else {
        showToast(`Échec vente : ${data.error || 'Erreur inconnue'}`);
        fetchData();
      }
    } catch (err: any) {
      showToast(`Erreur vente : ${err.message}`);
    }
  };

  const handleUpdatePositionTargets = async (
    positionId: string,
    targets: {
      tpPercent?: number;
      slPercent?: number;
      trailingStopPercent?: number;
      autoSellStagnant?: boolean;
      stagnantTimeoutSeconds?: number;
    }
  ) => {
    try {
      const res = await authFetch('/api/position/update-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, targets }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('🎯 Objectifs & Auto-Sell mis à jour');
        setPositions((prev) =>
          prev.map((p) => (p.id === positionId ? { ...p, ...data.position } : p))
        );
      } else {
        showToast(`Erreur: ${data.error || 'Impossible de mettre à jour'}`);
      }
    } catch (err: any) {
      showToast(`Erreur: ${err.message}`);
    }
  };

  const handleRequestTelegramCode = async (phone?: string) => {
    try {
      const res = await authFetch('/api/telegram/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        showToast(data.message || 'Code Telegram envoyé');
      } else {
        showToast(`Erreur Telegram : ${data.message || data.error}`);
      }
      return data;
    } catch (err: any) {
      showToast(`Erreur réseau : ${err.message}`);
      return { success: false, message: err.message };
    }
  };

  const handleVerifyTelegramCode = async (code: string, password?: string) => {
    try {
      const res = await authFetch('/api/telegram/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, password }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        showToast('✓ Telegram connecté avec succès');
      } else {
        showToast(`Erreur validation : ${data.message || data.error}`);
      }
      return data;
    } catch (err: any) {
      showToast(`Erreur réseau : ${err.message}`);
      return { success: false, message: err.message };
    }
  };

  const handleReanalyzeCall = async (call: TelegramCall) => {
    try {
      showToast(`Audit multi-sources pour $${call.tokenSymbol || call.tokenAddress.slice(0, 6)}...`);
      const res = await authFetch('/api/manual-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: call.tokenAddress }),
      });
      const data = await res.json();
      if (res.ok && data) {
        setCalls((prev) => prev.map((c) => (c.id === call.id ? { ...c, analysis: data, status: data.decision } : c)));
        setSelectedCall({ ...call, analysis: data, status: data.decision });
        showToast(`Audit terminé : ${data.decision}`);
      }
    } catch (err: any) {
      showToast(`Erreur audit : ${err.message}`);
    }
  };

  const handleDisconnectTelegram = async () => {
    try {
      const res = await authFetch('/api/telegram/disconnect', { method: 'POST' });
      const data = await res.json();
      showToast('Compte Telegram déconnecté');
      return data;
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  };

  const handleImportPrivateKey = async (pk: string) => {
    try {
      const res = await authFetch('/api/wallet/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateKey: pk }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig((prev) => ({
          ...prev,
          walletPublicKey: data.publicKey || prev.walletPublicKey,
          hasPrivateKey: true,
        }));
        showToast('✓ Portefeuille Solana importé en mémoire avec succès !');
        fetchData();
      } else {
        showToast(`Erreur import : ${data.message || data.error}`);
      }
      return data;
    } catch (err: any) {
      showToast(`Erreur réseau : ${err.message}`);
      return { success: false, message: err.message };
    }
  };

  const handleRefreshBalance = async () => {
    try {
      const res = await authFetch('/api/wallet/refresh-balance', { method: 'POST' });
      const data = await res.json();
      if (data) {
        setConfig((prev) => ({
          ...prev,
          walletBalanceSol: data.balanceSol,
        }));
        showToast(`Solde actualisé : ${data.balanceSol?.toFixed(4)} SOL`);
      }
    } catch (err: any) {
      showToast(`Erreur : ${err.message}`);
    }
  };

  const handleForceRefreshPositions = async () => {
    try {
      const res = await authFetch('/api/positions/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.positions) {
        setPositions(data.positions);
        showToast('✓ Cours actualisés en direct depuis DexScreener');
      }
    } catch (err: any) {
      showToast(`Erreur actualisation : ${err.message}`);
    }
  };

  const handleResetCircuitBreaker = async () => {
    try {
      const res = await authFetch('/api/trading/circuit-breaker/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Circuit breaker réinitialisé');
        fetchData();
      }
    } catch (err: any) {
      showToast(`Erreur : ${err.message}`);
    }
  };

  const handleUnlockSuccess = (token: string, remember: boolean) => {
    setAuthToken(token, remember);
    setIsLocked(false);
    showToast('✓ Dashboard déverrouillé');
  };

  const handleLockDashboard = async () => {
    try {
      await authFetch('/api/security/logout', { method: 'POST' });
    } catch {}
    clearAuthToken();
    setIsLocked(true);
    showToast('Dashboard verrouillé');
  };

  const totalPnlUsd = history.reduce((acc, t) => acc + (t.realizedPnlUsd || 0), 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* Dashboard Lock Screen (Server-Enforced) */}
      {isLocked && securityStatus?.enabled && (
        <DashboardLockScreen
          securityStatus={securityStatus}
          onUnlockSuccess={handleUnlockSuccess}
          onOpenSetupModal={() => setIsSecurityModalOpen(true)}
          onBypassIfNoCode={() => setIsLocked(false)}
        />
      )}

      {/* Security Settings Modal */}
      <SecuritySettingsModal
        isOpen={isSecurityModalOpen}
        onClose={() => setIsSecurityModalOpen(false)}
        securityStatus={securityStatus}
        onStatusUpdated={(newStatus) => setSecurityStatus(newStatus)}
        onShowToast={showToast}
      />

      {/* Main Header */}
      <Header
        status={telegramStatus}
        config={config}
        onToggleAutoSnipe={handleToggleAutoSnipe}
        activePositionsCount={positions.length}
        totalCallsCount={calls.length}
        totalPnlUsd={totalPnlUsd}
        onOpenSettings={() => setActiveTab('settings')}
        securityStatus={securityStatus}
        onLockDashboard={handleLockDashboard}
        onOpenSecurityModal={() => setIsSecurityModalOpen(true)}
        riskStatus={riskStatus}
        onResetCircuitBreaker={handleResetCircuitBreaker}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 border border-emerald-500/40 text-emerald-300 px-4 py-3 rounded-lg shadow-xl text-xs font-mono animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toastMessage}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-6">
        {/* Trading Mode & Safety Banner */}
        {(!riskStatus || !riskStatus.liveTradingEnabled) && (
          <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs font-mono flex items-center justify-between shadow-md flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="font-bold tracking-wider text-emerald-300">
                SIMULATION MODE — LIVE TRADING DISABLED
              </span>
              <span className="text-zinc-400 hidden sm:inline">
                | Transactions are simulated in server memory. Zero real SOL is risked.
              </span>
            </div>
            <span className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700/50 text-[10px] uppercase font-bold text-emerald-300">
              SAFETY GATE ACTIVE
            </span>
          </div>
        )}

        {/* Risk & Safety Banners */}
        {riskStatus?.circuitBreakerTripped && (
          <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-500/80 text-rose-200 text-xs font-mono flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>
                <strong>DISJONCTEUR DE SÉCURITÉ ACTIF :</strong> {riskStatus.circuitBreakerReason || 'Risque financier détecté'}. Les nouveaux snipes sont bloqués pour protéger votre capital.
              </span>
            </div>
            <button
              onClick={handleResetCircuitBreaker}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold transition-colors cursor-pointer shrink-0 ml-4"
            >
              Réinitialiser
            </button>
          </div>
        )}

        {config.executionMode === 'wallet' && riskStatus && !riskStatus.liveTradingEnabled && (
          <div className="p-3.5 rounded-lg bg-amber-950/70 border border-amber-500/60 text-amber-200 text-xs font-mono flex items-center gap-2.5 shadow-md">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <span>
              <strong>MODE RÉEL VERROUILLÉ PAR LE SERVEUR :</strong> La variable d'environnement <code>LIVE_TRADING_ENABLED</code> est à <code>false</code>. Les ordres sont exécutés en <strong>simulation</strong> pour éviter tout débit accidentel.
            </span>
          </div>
        )}

        {/* Tab Navigation Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3 flex-wrap gap-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setActiveTab('stream')}
              className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded uppercase tracking-wider transition-colors cursor-pointer ${
                activeTab === 'stream'
                  ? 'bg-white text-black'
                  : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-900'
              }`}
            >
              Signal Feed ({calls.length})
            </button>
            <button
              onClick={() => setActiveTab('positions')}
              className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded uppercase tracking-wider transition-colors cursor-pointer ${
                activeTab === 'positions'
                  ? 'bg-white text-black'
                  : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-900'
              }`}
            >
              Positions Actives ({positions.length})
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded uppercase tracking-wider transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-black'
                  : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-900'
              }`}
            >
              Historique ({history.length})
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded uppercase tracking-wider transition-colors cursor-pointer ${
                activeTab === 'stats'
                  ? 'bg-white text-black'
                  : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-900'
              }`}
            >
              Statistiques
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3.5 py-1.5 text-xs font-mono font-semibold rounded uppercase tracking-wider transition-colors cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-white text-black'
                  : 'bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-900'
              }`}
            >
              Configuration & Wallet
            </button>
          </div>

          <div className="text-[11px] font-mono text-zinc-400 hidden md:flex items-center gap-3">
            <span>
              Mode: <strong className={config.executionMode === 'wallet' ? 'text-emerald-400' : 'text-zinc-300'}>{config.executionMode === 'wallet' ? 'RÉEL' : 'SIMULATION'}</strong>
            </span>
            <span>
              TP: <strong className="text-white">{config.takeProfitPercent > 0 ? `+${config.takeProfitPercent}%` : 'Off'}</strong>
            </span>
            <span>
              SL: <strong className="text-zinc-300">{config.stopLossPercent > 0 ? `-${config.stopLossPercent}%` : 'Off'}</strong>
            </span>
            <span>
              Trailing: <strong className={config.trailingStopPercent > 0 ? 'text-amber-300' : 'text-zinc-500'}>{config.trailingStopPercent > 0 ? `-${config.trailingStopPercent}%` : 'Off'}</strong>
            </span>
          </div>
        </div>

        {/* Manual CA Scanner component */}
        <ManualAnalyzer
          onAnalyze={handleManualAnalyze}
          isAnalyzing={isManualAnalyzing}
        />

        {/* Tab Views */}
        {activeTab === 'stream' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <TelegramFeed
                calls={calls}
                status={telegramStatus}
                onChannelsUpdated={(updated) => setTelegramStatus(updated)}
                onSelectCall={(call) => setSelectedCall(call)}
                onManualSnipe={handleManualSnipe}
                onReanalyzeCall={handleReanalyzeCall}
              />
            </div>
            <div>
              <ActivePositions
                positions={positions}
                onSellPosition={handleSellPosition}
                onUpdateTargets={handleUpdatePositionTargets}
                onForceRefresh={handleForceRefreshPositions}
              />
            </div>
          </div>
        )}

        {activeTab === 'positions' && (
          <ActivePositions
            positions={positions}
            onSellPosition={handleSellPosition}
            onUpdateTargets={handleUpdatePositionTargets}
            onForceRefresh={handleForceRefreshPositions}
          />
        )}

        {activeTab === 'history' && <TradeHistory history={history} />}

        {activeTab === 'stats' && <SniperStats history={history} calls={calls} />}

        {activeTab === 'settings' && (
          <SniperSettings
            config={config}
            status={telegramStatus}
            securityStatus={securityStatus}
            onUpdateConfig={handleUpdateConfig}
            onRequestTelegramCode={handleRequestTelegramCode}
            onVerifyTelegramCode={handleVerifyTelegramCode}
            onImportPrivateKey={handleImportPrivateKey}
            onRefreshWalletBalance={handleRefreshBalance}
            onDisconnectTelegram={handleDisconnectTelegram}
            onOpenSecurityModal={() => setIsSecurityModalOpen(true)}
            onLockDashboard={handleLockDashboard}
          />
        )}
      </main>

      {/* Modal: Deep Token Analysis View */}
      {selectedCall && (
        <AnalysisModal
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
          onManualSnipe={handleManualSnipe}
        />
      )}
    </div>
  );
}
