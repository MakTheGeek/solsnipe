import React, { useState, useEffect } from 'react';
import { authFetch } from '../api';
import {
  Wallet,
  Key,
  Phone,
  Send,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Lock,
  Zap,
  Sliders,
  Radio,
  Trash2,
  Plus,
  Clock,
  AlertTriangle,
  Target,
} from 'lucide-react';
import { SecurityStatus, SniperConfig, TelegramStatus } from '../types';
import { TelegramChannelManager } from './TelegramChannelManager';

interface SniperSettingsProps {
  config: SniperConfig;
  status: TelegramStatus | null;
  securityStatus?: SecurityStatus | null;
  onUpdateConfig: (newConfig: Partial<SniperConfig>) => void;
  onRequestTelegramCode: (phone?: string) => Promise<{ success: boolean; message: string; requiresPassword?: boolean }>;
  onVerifyTelegramCode: (code: string, password?: string) => Promise<{ success: boolean; message: string; requiresPassword?: boolean }>;
  onImportPrivateKey: (pk: string) => Promise<{ success: boolean; message: string; publicKey?: string; balanceSol?: number }>;
  onRefreshWalletBalance?: () => Promise<void>;
  onDisconnectTelegram?: () => Promise<{ success: boolean; message: string }>;
  onOpenSecurityModal?: () => void;
  onLockDashboard?: () => void;
}

export const SniperSettings: React.FC<SniperSettingsProps> = ({
  config,
  status,
  securityStatus,
  onUpdateConfig,
  onRequestTelegramCode,
  onVerifyTelegramCode,
  onImportPrivateKey,
  onRefreshWalletBalance,
  onDisconnectTelegram,
  onOpenSecurityModal,
  onLockDashboard,
}) => {
  // Strategy settings
  const [amount, setAmount] = useState(config.tradingAmountSol.toString());
  const [tp, setTp] = useState(config.takeProfitPercent.toString());
  const [sl, setSl] = useState(config.stopLossPercent.toString());
  const [trailing, setTrailing] = useState(config.trailingStopPercent.toString());
  const [slippage, setSlippage] = useState(config.slippagePercent.toString());
  const [autoSellStagnant, setAutoSellStagnant] = useState(config.autoSellStagnant !== false);
  const [stagnantTimeoutSeconds, setStagnantTimeoutSeconds] = useState((config.stagnantTimeoutSeconds || 180).toString());
  const [stagnantThresholdPercent, setStagnantThresholdPercent] = useState((config.stagnantThresholdPercent || 1.0).toString());
  const [priorityFee, setPriorityFee] = useState((config.priorityFeeSol || 0.005).toString());
  const [jitoTip, setJitoTip] = useState((config.jitoTipSol || 0.005).toString());
  const [router, setRouter] = useState(config.router);
  const [mode, setMode] = useState(config.executionMode);
  const [maxRugCheckScore, setMaxRugCheckScore] = useState((config.maxRugCheckScore ?? 800).toString());
  const [rejectOnRugCheckDanger, setRejectOnRugCheckDanger] = useState(config.rejectOnRugCheckDanger !== false);
  const [maxEntryMarketCapUsd, setMaxEntryMarketCapUsd] = useState((config.maxEntryMarketCapUsd ?? 40000).toString());
  const [maxTokenAgeMinutes, setMaxTokenAgeMinutes] = useState((config.maxTokenAgeMinutes ?? 15).toString());
  const [requirePositiveMomentum5m, setRequirePositiveMomentum5m] = useState(config.requirePositiveMomentum5m !== false);
  const [rpcUrl, setRpcUrl] = useState(config.rpcUrl || 'https://api.mainnet-beta.solana.com');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Wallet Management
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [importStatus, setImportStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  // Telegram Authentication
  const [phoneInput, setPhoneInput] = useState(status?.phone || '');
  const [tgCodeInput, setTgCodeInput] = useState('');
  const [tgPasswordInput, setTgPasswordInput] = useState('');
  const [show2FaField, setShow2FaField] = useState(false);
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [isDisconnectingTg, setIsDisconnectingTg] = useState(false);
  const [tgFeedback, setTgFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [newChannelInput, setNewChannelInput] = useState('');
  const [isManagingChannel, setIsManagingChannel] = useState(false);

  // Sync state when config updates
  useEffect(() => {
    setAmount(config.tradingAmountSol.toString());
    setTp(config.takeProfitPercent.toString());
    setSl(config.stopLossPercent.toString());
    setTrailing(config.trailingStopPercent.toString());
    setSlippage(config.slippagePercent.toString());
    setAutoSellStagnant(config.autoSellStagnant !== false);
    setStagnantTimeoutSeconds((config.stagnantTimeoutSeconds || 180).toString());
    setStagnantThresholdPercent((config.stagnantThresholdPercent || 1.0).toString());
    setPriorityFee((config.priorityFeeSol || 0.005).toString());
    setJitoTip((config.jitoTipSol || 0.005).toString());
    setRouter(config.router);
    setMode(config.executionMode);
    setMaxRugCheckScore((config.maxRugCheckScore ?? 800).toString());
    setRejectOnRugCheckDanger(config.rejectOnRugCheckDanger !== false);
    setMaxEntryMarketCapUsd((config.maxEntryMarketCapUsd ?? 40000).toString());
    setMaxTokenAgeMinutes((config.maxTokenAgeMinutes ?? 15).toString());
    setRequirePositiveMomentum5m(config.requirePositiveMomentum5m !== false);
    setRpcUrl(config.rpcUrl || 'https://api.mainnet-beta.solana.com');
  }, [config]);

  // Sync phone input when status updates
  useEffect(() => {
    if (status?.phone && !phoneInput) {
      setPhoneInput(status.phone);
    }
  }, [status?.phone]);

  const parseNumber = (val: string, fallback: number, allowZero: boolean = true): number => {
    const trimmed = (val ?? '').trim();
    if (trimmed === '') return fallback;
    const num = parseFloat(trimmed);
    if (isNaN(num)) return fallback;
    if (allowZero && num === 0) return 0;
    if (num < 0) return 0;
    return num;
  };

  const handleSaveStrategy = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAmount = parseNumber(amount, 0.1, false);
    const finalTp = parseNumber(tp, 50, true);
    const finalSl = parseNumber(sl, 15, true);
    const finalTrailing = parseNumber(trailing, 0, true);
    const finalSlippage = parseNumber(slippage, 5, false);
    const finalPriorityFee = parseNumber(priorityFee, 0.005, false);
    const finalJitoTip = parseNumber(jitoTip, 0.005, false);
    const finalStagnantTimeout = parseNumber(stagnantTimeoutSeconds, 180, false);
    const finalStagnantThreshold = parseNumber(stagnantThresholdPercent, 1.0, false);
    const finalMaxRugCheckScore = parseNumber(maxRugCheckScore, 800, true);
    const finalMaxEntryMc = parseNumber(maxEntryMarketCapUsd, 40000, true);
    const finalMaxTokenAge = parseNumber(maxTokenAgeMinutes, 15, true);

    onUpdateConfig({
      tradingAmountSol: finalAmount,
      takeProfitPercent: finalTp,
      stopLossPercent: finalSl,
      trailingStopPercent: finalTrailing,
      autoSellStagnant,
      stagnantTimeoutSeconds: finalStagnantTimeout,
      stagnantThresholdPercent: finalStagnantThreshold,
      slippagePercent: finalSlippage,
      maxRugCheckScore: finalMaxRugCheckScore,
      rejectOnRugCheckDanger,
      maxEntryMarketCapUsd: finalMaxEntryMc,
      maxTokenAgeMinutes: finalMaxTokenAge,
      requirePositiveMomentum5m,
      priorityFeeSol: finalPriorityFee,
      jitoTipSol: finalJitoTip,
      router,
      executionMode: mode,
      rpcUrl: rpcUrl.trim() || 'https://api.mainnet-beta.solana.com',
    });

    setSaveSuccessMsg(
      `✓ Configuration enregistrée (Mode: ${mode === 'wallet' ? 'RÉEL' : 'SIMULATION'}, TP: ${finalTp > 0 ? `+${finalTp}%` : 'Off'}, SL: ${finalSl > 0 ? `-${finalSl}%` : 'Off'}, MC Max: ${finalMaxEntryMc ? `$${finalMaxEntryMc.toLocaleString()}` : 'Illimité'}, Âge Max: ${finalMaxTokenAge ? `${finalMaxTokenAge}m` : 'Illimité'})`
    );
    setTimeout(() => setSaveSuccessMsg(null), 5000);
  };

  const applyPreset = (presetTp: number, presetSl: number, presetTrailing: number) => {
    setTp(presetTp.toString());
    setSl(presetSl.toString());
    setTrailing(presetTrailing.toString());
  };

  // --- Wallet Actions ---
  const handleCopyAddress = () => {
    if (!config.walletPublicKey) return;
    navigator.clipboard.writeText(config.walletPublicKey);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handlePastePrivateKey = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPrivateKeyInput(text.trim());
      }
    } catch {
      // Clipboard permissions fallback
    }
  };

  const handleImportKey = async () => {
    const key = privateKeyInput.trim();
    if (!key) {
      setImportStatus({
        success: false,
        message: 'Veuillez coller ou saisir une clé privée Solana valide',
      });
      return;
    }

    setIsImporting(true);
    setImportStatus(null);
    try {
      const res = await onImportPrivateKey(key);
      setImportStatus({
        success: res.success,
        message: res.message,
      });
      if (res.success) {
        setPrivateKeyInput('');
        setShowPrivateKey(false);
      }
    } catch (err: any) {
      setImportStatus({
        success: false,
        message: err.message || "Erreur lors de l'import de la clé privée",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleRefreshBalanceClick = async () => {
    if (!onRefreshWalletBalance) return;
    setIsRefreshingBalance(true);
    try {
      await onRefreshWalletBalance();
    } finally {
      setIsRefreshingBalance(false);
    }
  };

  // --- Telegram Actions ---
  const handleRequestTgCode = async () => {
    const phone = phoneInput.trim();
    if (!phone || phone.length < 6) {
      setTgFeedback({
        type: 'error',
        text: 'Veuillez entrer un numéro de téléphone international complet (ex: +242068658897)',
      });
      return;
    }

    setIsRequestingCode(true);
    setTgFeedback(null);
    try {
      const res = await onRequestTelegramCode(phone);
      if (res.success) {
        setTgFeedback({
          type: 'success',
          text: res.message || `Code de vérification envoyé à ${phone}`,
        });
      } else {
        setTgFeedback({
          type: 'error',
          text: res.message || "Échec de l'envoi du code de vérification",
        });
      }
    } catch (err: any) {
      setTgFeedback({
        type: 'error',
        text: err.message || 'Erreur réseau lors de la demande de code',
      });
    } finally {
      setIsRequestingCode(false);
    }
  };

  const handleVerifyTgCode = async () => {
    const code = tgCodeInput.trim();
    if (!code) {
      setTgFeedback({
        type: 'error',
        text: 'Veuillez saisir le code reçu sur Telegram ou par SMS',
      });
      return;
    }

    setIsVerifyingCode(true);
    setTgFeedback(null);
    try {
      const res = await onVerifyTelegramCode(code, tgPasswordInput || undefined);
      if (res.success) {
        setTgFeedback({
          type: 'success',
          text: res.message || 'Compte Telegram authentifié avec succès !',
        });
        setTgCodeInput('');
        setTgPasswordInput('');
      } else {
        if (res.requiresPassword) {
          setShow2FaField(true);
        }
        setTgFeedback({
          type: 'error',
          text: res.message || 'Code de vérification invalide ou expiré',
        });
      }
    } catch (err: any) {
      setTgFeedback({
        type: 'error',
        text: err.message || 'Erreur lors de la vérification du code',
      });
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleDisconnectTg = async () => {
    if (!onDisconnectTelegram) return;
    setIsDisconnectingTg(true);
    try {
      const res = await onDisconnectTelegram();
      setTgFeedback({
        type: 'info',
        text: res.message || 'Compte Telegram déconnecté',
      });
    } finally {
      setIsDisconnectingTg(false);
    }
  };

  const handleRemoveChannel = async (channel: string) => {
    setIsManagingChannel(true);
    try {
      const res = await authFetch('/api/telegram/remove-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      if (data.success) {
        setTgFeedback({
          type: 'success',
          text: `Canal ${channel} retiré de la liste de surveillance.`,
        });
      } else {
        setTgFeedback({
          type: 'error',
          text: data.message || 'Impossible de retirer le canal',
        });
      }
    } catch (err: any) {
      setTgFeedback({
        type: 'error',
        text: err.message || 'Erreur lors de la suppression du canal',
      });
    } finally {
      setIsManagingChannel(false);
    }
  };

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelInput.trim()) return;
    setIsManagingChannel(true);
    try {
      const res = await authFetch('/api/telegram/add-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: newChannelInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setTgFeedback({
          type: 'success',
          text: `Canal ${newChannelInput.trim()} ajouté avec succès !`,
        });
        setNewChannelInput('');
      } else {
        setTgFeedback({
          type: 'error',
          text: data.message || 'Erreur lors de l\'ajout du canal',
        });
      }
    } catch (err: any) {
      setTgFeedback({
        type: 'error',
        text: err.message || 'Erreur réseau lors de l\'ajout du canal',
      });
    } finally {
      setIsManagingChannel(false);
    }
  };

  const isBalanceLow =
    config.executionMode === 'wallet' &&
    (config.walletBalanceSol ?? 0) < (parseFloat(amount) || 0.1);

  return (
    <div className="space-y-6">
      {/* SECTION 0: CODE D'ACCÈS & SÉCURITÉ DU STREAMING DASHBOARD */}
      <div className="p-4 sm:p-5 rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-mono space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-zinc-900 text-emerald-400 border border-zinc-800">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                Code d'Accès & Sécurité du Dashboard
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Restreindre l'accès au terminal de streaming et aux configurations par code secret
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${
                securityStatus?.enabled
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}
            >
              {securityStatus?.enabled ? '● Protection Activée' : '○ Protection Inactive'}
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-850">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-white font-semibold">
              <Key className="w-4 h-4 text-emerald-400" />
              <span>
                {securityStatus?.hasCodeSet
                  ? 'Code de connexion configuré (Chiffrement SHA-256)'
                  : 'Aucun code configuré pour ce terminal'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              {securityStatus?.hasCodeSet
                ? `Verrouillage automatique : ${
                    securityStatus.autoLockMinutes === 0
                      ? 'À la fermeture du navigateur / de l\'onglet'
                      : securityStatus.autoLockMinutes === -1
                      ? 'Manuel uniquement'
                      : `Après ${securityStatus.autoLockMinutes} min d'inactivité`
                  }`
                : 'Configurez un code PIN ou mot de passe pour empêcher tout accès non autorisé à vos alertes et clés.'}
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {onOpenSecurityModal && (
              <button
                type="button"
                onClick={onOpenSecurityModal}
                className="flex-1 sm:flex-none px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-white font-mono text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                {securityStatus?.hasCodeSet ? 'Modifier le code' : 'Configurer le code'}
              </button>
            )}

            {securityStatus?.enabled && onLockDashboard && (
              <button
                type="button"
                onClick={onLockDashboard}
                className="flex-1 sm:flex-none px-3.5 py-2 rounded-lg bg-zinc-850 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white font-mono text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                Verrouiller
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 1: PORTEFEUILLE SOLANA (IMPORT CLÉ & MODE RÉEL) */}
      <div className="p-4 sm:p-5 rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-mono space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-zinc-900 text-emerald-400 border border-zinc-800">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                1. Portefeuille Solana & Mode Réel
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Importez votre clé privée pour exécuter les snipes on-chain via Jupiter V6
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${
                config.executionMode === 'wallet'
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}
            >
              {config.executionMode === 'wallet' ? '● Mode Réel (Live Wallet)' : '○ Mode Simulation'}
            </span>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('simulation');
              onUpdateConfig({ executionMode: 'simulation' });
            }}
            className={`p-3 rounded border text-left transition-colors cursor-pointer ${
              config.executionMode === 'simulation'
                ? 'bg-white text-black border-white font-semibold'
                : 'bg-zinc-900/60 border-zinc-850 text-zinc-400 hover:text-white hover:border-zinc-700'
            }`}
          >
            <div className="text-xs font-bold uppercase flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5" />
              Mode Simulation (Paper Trading)
            </div>
            <p className="text-[10px] mt-1 opacity-80">
              Zéro risque : teste les signaux et les triggers (TP/SL) avec un solde virtuel sans dépenser de SOL réels.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('wallet');
              onUpdateConfig({ executionMode: 'wallet' });
            }}
            className={`p-3 rounded border text-left transition-colors cursor-pointer ${
              config.executionMode === 'wallet'
                ? 'bg-emerald-500 text-black border-emerald-400 font-semibold'
                : 'bg-zinc-900/60 border-zinc-850 text-zinc-400 hover:text-white hover:border-zinc-700'
            }`}
          >
            <div className="text-xs font-bold uppercase flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Mode Réel (Live Wallet On-Chain)
            </div>
            <p className="text-[10px] mt-1 opacity-80">
              Ordres réels exécutés sur Solana Mainnet via Jupiter V6 et signés par votre clé privée.
            </p>
          </button>
        </div>

        {/* Current Active Wallet & Balance Card */}
        <div className="p-3.5 rounded bg-black border border-zinc-850 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-zinc-400 text-[11px] font-semibold uppercase flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Adresse Publique Active :
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-400">Solde :</span>
                <span className="text-emerald-400 font-bold text-xs">
                  {(config.walletBalanceSol ?? 0).toFixed(4)} SOL
                </span>
                <button
                  type="button"
                  onClick={handleRefreshBalanceClick}
                  disabled={isRefreshingBalance}
                  title="Actualiser le solde on-chain"
                  className="ml-1 text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshingBalance ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  config.hasPrivateKey
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                    : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                {config.hasPrivateKey ? 'Clé Importée & Prête' : 'Clé Temporaire'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 p-2 rounded bg-zinc-950 border border-zinc-900">
            <code className="text-white text-xs truncate select-all">
              {config.walletPublicKey || 'Aucun portefeuille Solana configuré'}
            </code>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleCopyAddress}
                className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 transition-colors flex items-center gap-1 cursor-pointer text-[11px]"
              >
                {copiedAddress ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Copié !</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copier</span>
                  </>
                )}
              </button>

              {config.walletPublicKey && (
                <a
                  href={`https://solscan.io/account/${config.walletPublicKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition-colors flex items-center gap-1 text-[11px]"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Solscan</span>
                </a>
              )}

              {config.hasPrivateKey && (
                <div
                  className="px-2.5 py-1 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 flex items-center gap-1 text-[11px]"
                  title="Clé privée sécurisée en mémoire serveur uniquement (export désactivé)"
                >
                  <ShieldCheck className="w-3 h-3" />
                  <span>Clé en mémoire (Protégée)</span>
                </div>
              )}
            </div>
          </div>

          {isBalanceLow && (
            <div className="p-2.5 rounded bg-amber-950/40 border border-amber-800/40 text-amber-300 text-[11px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Attention : Votre solde ({(config.walletBalanceSol ?? 0).toFixed(4)} SOL) est inférieur au montant d'achat configuré ({amount} SOL). Veuillez transférer des SOL à l'adresse ci-dessus pour exécuter vos transactions.
              </span>
            </div>
          )}
        </div>

        {/* Solana RPC Node Configuration */}
        <div className="p-3.5 rounded bg-zinc-900/50 border border-zinc-850 space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-zinc-300 font-semibold flex items-center gap-1.5 text-xs">
              <Zap className="w-3.5 h-3.5 text-purple-400" />
              Noeud RPC Solana (Connexion Blockchain & Rapidité) :
            </label>
            <span className="text-[10px] text-zinc-500 font-mono">
              Recommandé : Helius ou QuickNode pour éviter les 429
            </span>
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder="https://api.mainnet-beta.solana.com ou votre RPC privé (ex: Helius, QuickNode)"
              value={rpcUrl}
              onChange={(e) => setRpcUrl(e.target.value)}
              className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-white text-xs font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div className="flex items-center justify-between gap-1 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-zinc-500">Presets :</span>
              <button
                type="button"
                onClick={() => {
                  setRpcUrl('https://solana.leorpc.com/?api_key=FREE');
                  onUpdateConfig({ rpcUrl: 'https://solana.leorpc.com/?api_key=FREE' });
                }}
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                  rpcUrl === 'https://solana.leorpc.com/?api_key=FREE'
                    ? 'bg-amber-500 text-black border-amber-400 font-bold'
                    : 'bg-zinc-950 text-amber-400 border-zinc-900 hover:border-amber-700 hover:text-white'
                }`}
              >
                ★ LeoRPC (Gratuit)
              </button>
              <button
                type="button"
                onClick={() => {
                  setRpcUrl('https://api.mainnet-beta.solana.com');
                  onUpdateConfig({ rpcUrl: 'https://api.mainnet-beta.solana.com' });
                }}
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                  rpcUrl === 'https://api.mainnet-beta.solana.com'
                    ? 'bg-zinc-800 text-white border-zinc-600'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-900 hover:text-white'
                }`}
              >
                Solana Public
              </button>
              <button
                type="button"
                onClick={() => {
                  setRpcUrl('https://mainnet.helius-rpc.com/?api-key=');
                }}
                className="px-2 py-0.5 rounded text-[10px] bg-zinc-950 text-purple-400 border border-zinc-900 hover:border-purple-800/50 hover:text-white transition-colors cursor-pointer"
              >
                + Modèle Helius
              </button>
              <button
                type="button"
                onClick={() => {
                  setRpcUrl('https://solana-mainnet.g.alchemy.com/v2/');
                }}
                className="px-2 py-0.5 rounded text-[10px] bg-zinc-950 text-sky-400 border border-zinc-900 hover:border-sky-800/50 hover:text-white transition-colors cursor-pointer"
              >
                + Modèle Alchemy
              </button>
            </div>

            <button
              type="button"
              onClick={() => onUpdateConfig({ rpcUrl: rpcUrl.trim() })}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1"
            >
              <Check className="w-3 h-3 text-emerald-400" />
              Appliquer le RPC
            </button>
          </div>
        </div>

        {/* Private Key Import Input Form */}
        <div className="p-3.5 rounded bg-zinc-900/50 border border-zinc-850 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-zinc-300 font-semibold flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-zinc-400" />
              Importer une Clé Privée Solana :
            </label>
            <button
              type="button"
              onClick={handlePastePrivateKey}
              className="text-[11px] text-zinc-400 hover:text-white underline cursor-pointer flex items-center gap-1"
            >
              Coller depuis le presse-papier
            </button>
          </div>

          <div className="relative">
            <input
              type={showPrivateKey ? 'text' : 'password'}
              placeholder="Collez ici votre clé privée Base58 (ex: Phantom/Solflare) ou tableau JSON [12,34,...]"
              value={privateKeyInput}
              onChange={(e) => setPrivateKeyInput(e.target.value)}
              className="w-full bg-black border border-zinc-800 rounded px-3 py-2 pr-10 text-white text-xs font-mono placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <button
              type="button"
              onClick={() => setShowPrivateKey(!showPrivateKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              title={showPrivateKey ? 'Masquer' : 'Afficher'}
            >
              {showPrivateKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleImportKey}
              disabled={isImporting || !privateKeyInput.trim()}
              className="px-4 py-2 rounded bg-white text-black font-bold uppercase tracking-wider hover:bg-zinc-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5" />
              {isImporting ? 'Importation en cours...' : 'Valider & Importer la Clé'}
            </button>

            <span className="text-[10px] text-zinc-500">
              Compatible Phantom, Solflare, Backpack & id.json
            </span>
          </div>

          {importStatus && (
            <div
              className={`p-2.5 rounded text-xs flex items-center gap-2 ${
                importStatus.success
                  ? 'bg-emerald-950/60 border border-emerald-800/50 text-emerald-300'
                  : 'bg-red-950/60 border border-red-800/50 text-red-300'
              }`}
            >
              {importStatus.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{importStatus.message}</span>
            </div>
          )}

          <div className="p-2.5 rounded bg-black/50 border border-zinc-900 text-[10px] text-zinc-400 leading-relaxed">
            <strong className="text-zinc-300">Comment exporter votre clé :</strong> Dans Phantom ou Solflare, allez dans{' '}
            <em>Paramètres &rarr; Sécurité & Confidentialité &rarr; Exporter la clé privée</em>. Votre clé est conservée uniquement en mémoire de votre session pour autoriser les swaps Jupiter.
          </div>
        </div>
      </div>

      {/* SECTION 2: CONNEXION COMPTE TELEGRAM (NUMÉRO & CODE) */}
      <div className="p-4 sm:p-5 rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-mono space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-zinc-900 text-sky-400 border border-zinc-800">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                2. Connexion Téléphone & Code Telegram (MTProto)
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Connectez votre compte personnel Telegram pour écouter les canaux en direct
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${
                status?.isAuthenticated
                  ? 'bg-sky-950/80 border-sky-500/50 text-sky-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}
            >
              {status?.isAuthenticated ? '● Authentifié MTProto' : '○ Non Connecté'}
            </span>
          </div>
        </div>

        {/* Monitored Channels & Account Manager */}
        <TelegramChannelManager status={status} />
      </div>

      {/* SECTION 3: PARAMÈTRES DE STRATÉGIE & RISQUE */}
      <div className="p-4 sm:p-5 rounded-lg border border-zinc-800 bg-zinc-950 text-xs font-mono space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-zinc-900 text-amber-400 border border-zinc-800">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                3. Paramètres de Trading & Risk Management
              </h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Définissez la taille des ordres, Take Profit, Stop Loss et Trailing Stop
              </p>
            </div>
          </div>
        </div>

        {/* Global Strategy Presets Bar */}
        <div className="p-3 rounded border border-zinc-850 bg-black text-xs space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="font-semibold text-zinc-300">PRESETS RAPIDES EN 1 CLIC :</span>
            <span className="text-[10px] text-zinc-500">Applique instantanément les ratios</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => applyPreset(25, 10, 5)}
              className="p-2 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-left transition-colors cursor-pointer"
            >
              <div className="font-bold text-white text-xs">⚡ Scalp Court</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">TP +25% | SL -10% | TS -5%</div>
            </button>
            <button
              type="button"
              onClick={() => applyPreset(50, 15, 10)}
              className="p-2 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-left transition-colors cursor-pointer"
            >
              <div className="font-bold text-white text-xs">⚖️ Équilibré</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">TP +50% | SL -15% | TS -10%</div>
            </button>
            <button
              type="button"
              onClick={() => applyPreset(150, 20, 15)}
              className="p-2 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-left transition-colors cursor-pointer"
            >
              <div className="font-bold text-white text-xs">🏃 Runner / Tendance</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">TP +150% | SL -20% | TS -15%</div>
            </button>
            <button
              type="button"
              onClick={() => applyPreset(300, 25, 0)}
              className="p-2 rounded bg-zinc-900 border border-amber-900/40 hover:border-amber-700 hover:bg-zinc-850 text-left transition-colors cursor-pointer"
            >
              <div className="font-bold text-amber-400 text-xs">🌕 Moonbag (TS 0%)</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">TP +300% | SL -25% | TS: Off</div>
            </button>
          </div>
        </div>

        {saveSuccessMsg && (
          <div className="p-3 rounded border border-emerald-500/40 bg-emerald-950/40 text-emerald-300 text-xs flex items-center justify-between">
            <span>{saveSuccessMsg}</span>
            <button
              type="button"
              onClick={() => setSaveSuccessMsg(null)}
              className="text-emerald-400 hover:text-white text-xs ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        <form onSubmit={handleSaveStrategy} className="space-y-4">
          {/* Amount & Slippage */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded border border-zinc-850 bg-black">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-zinc-400 font-semibold">MONTANT PAR SNIPE (SOL)</label>
                <span className="text-[10px] text-zinc-500">Montant d'achat initial</span>
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-white"
              />
            </div>

            <div className="p-3 rounded border border-zinc-850 bg-black">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-zinc-400 font-semibold">SLIPPAGE MAXIMUM (%)</label>
                <span className="text-[10px] text-zinc-500">Tolérance de prix</span>
              </div>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="50"
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-white"
              />
            </div>
          </div>

          {/* TP / SL / Trailing Stop */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded border border-zinc-850 bg-black">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-emerald-400 font-semibold">TAKE PROFIT (%)</label>
                <span className="text-[10px] text-zinc-500">0 = Off</span>
              </div>
              <input
                type="number"
                step="1"
                min="0"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="p-3 rounded border border-zinc-850 bg-black">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-red-400 font-semibold">STOP LOSS (%)</label>
                <span className="text-[10px] text-zinc-500">0 = Off</span>
              </div>
              <input
                type="number"
                step="1"
                min="0"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="p-3 rounded border border-zinc-850 bg-black">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-amber-400 font-semibold">TRAILING STOP (%)</label>
                <span className="text-[10px] text-zinc-500">0 = Désactivé</span>
              </div>
              <input
                type="number"
                step="1"
                min="0"
                value={trailing}
                onChange={(e) => setTrailing(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Dynamic Risk / Reward Analysis & Guidance */}
          {(() => {
            const tpVal = parseFloat(tp) || 0;
            const slVal = parseFloat(sl) || 0;
            const trailingVal = parseFloat(trailing) || 0;
            if (tpVal <= 0 && trailingVal <= 0) return null;

            if (slVal > 0 && tpVal > 0 && tpVal < slVal) {
              const ratio = (slVal / tpVal).toFixed(1);
              return (
                <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/20 text-amber-200 text-xs flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-amber-300">
                      <span>Ratio Risque / Rendement Défavorable (1 : {ratio})</span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-relaxed">
                      Avec un Take Profit de <strong className="text-emerald-400">+{tpVal}%</strong> et un Stop Loss de <strong className="text-red-400">-{slVal}%</strong>, il vous faut {ratio} trades gagnants pour compenser 1 seule perte. Sur les memecoins Solana, les pumps sains dépassent souvent <strong>+30% à +100%</strong>. Pour maximiser vos gains nets, augmentez votre Take Profit (ex: +25% à +50%) ou activez un Trailing Stop (+10%).
                    </p>
                  </div>
                </div>
              );
            }

            if (slVal > 0 && tpVal >= slVal * 1.5) {
              const ratio = (tpVal / slVal).toFixed(1);
              return (
                <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-[11px]">
                    Ratio Risque/Rendement favorable (<strong>{ratio} : 1</strong>) : un gain de +{tpVal}% compense {ratio} pertes à -{slVal}%.
                  </span>
                </div>
              );
            }
            return null;
          })()}

          {/* Stagnation Auto-Sell (Inactivité / Cours Immobile) */}
          <div className="p-3.5 rounded border border-amber-900/40 bg-amber-950/10 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <div className="font-bold text-white text-xs flex items-center gap-2">
                    <span>AUTO-SELL SI COURS IMMOBILE (STAGNATION)</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-amber-900/50 text-amber-300 border border-amber-700/50">
                      3 min par défaut
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Vend automatiquement 100% de la position si le prix ne bouge pas après un délai imparti
                  </div>
                </div>
              </div>

              {/* Toggle Switch */}
              <button
                type="button"
                onClick={() => setAutoSellStagnant(!autoSellStagnant)}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors cursor-pointer ${
                  autoSellStagnant ? 'bg-amber-500' : 'bg-zinc-800'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    autoSellStagnant ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {autoSellStagnant && (
              <div className="pt-2 border-t border-zinc-850 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Timeout duration */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5 text-[11px]">
                      <span className="text-zinc-300 font-semibold">DÉLAI SANS MOUVEMENT</span>
                      <span className="text-amber-400 font-bold">
                        {Math.round(parseInt(stagnantTimeoutSeconds || '180', 10) / 60)} min ({stagnantTimeoutSeconds}s)
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 mb-1.5">
                      {[
                        { label: '1 min', sec: 60 },
                        { label: '2 min', sec: 120 },
                        { label: '3 min', sec: 180 },
                        { label: '5 min', sec: 300 },
                      ].map((item) => (
                        <button
                          key={item.sec}
                          type="button"
                          onClick={() => setStagnantTimeoutSeconds(item.sec.toString())}
                          className={`py-1 text-[11px] rounded border transition-colors cursor-pointer ${
                            stagnantTimeoutSeconds === item.sec.toString()
                              ? 'bg-amber-500 text-black border-amber-400 font-bold'
                              : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Threshold Percent */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5 text-[11px]">
                      <span className="text-zinc-300 font-semibold">SEUIL DE VARIATION MINIMALE</span>
                      <span className="text-amber-300 font-bold">±{stagnantThresholdPercent}%</span>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="10"
                      value={stagnantThresholdPercent}
                      onChange={(e) => setStagnantThresholdPercent(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-white font-bold text-xs focus:outline-none focus:border-amber-500"
                    />
                    <div className="text-[10px] text-zinc-500 mt-1">
                      Si la fluctuation reste inférieure à ±{stagnantThresholdPercent}% après le délai, la position est vendue à 100%.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RugCheck On-Chain Security Layer */}
          <div className="p-3.5 rounded border border-emerald-900/40 bg-emerald-950/10 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-bold text-white text-xs flex items-center gap-2">
                    <span>SÉCURITÉ RUGCHECK & COUCHE ANTI-RUG</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-emerald-900/50 text-emerald-300 border border-emerald-700/50">
                      Audit On-Chain
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Couche de défense supplémentaire : bloque le sniping auto si le score RugCheck dépasse le seuil ou présente un risque critique
                  </div>
                </div>
              </div>

              {/* Reject on Danger Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-400 font-mono">Bloquer Danger :</span>
                <button
                  type="button"
                  onClick={() => setRejectOnRugCheckDanger(!rejectOnRugCheckDanger)}
                  className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors cursor-pointer ${
                    rejectOnRugCheckDanger ? 'bg-emerald-500' : 'bg-zinc-800'
                  }`}
                  title="Bloquer immédiatement tout token ayant un flag DANGER ou RUGGED"
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      rejectOnRugCheckDanger ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-850 space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Max Score Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5 text-[11px]">
                    <span className="text-zinc-300 font-semibold">SCORE RUGCHECK MAXIMAL TOLÉRÉ</span>
                    <span className="text-emerald-400 font-bold">
                      {parseInt(maxRugCheckScore, 10) === 0 ? 'Désactivé' : `< ${maxRugCheckScore} pts`}
                    </span>
                  </div>
                  <input
                    type="number"
                    step="50"
                    min="0"
                    max="10000"
                    value={maxRugCheckScore}
                    onChange={(e) => setMaxRugCheckScore(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-white font-bold text-xs focus:outline-none focus:border-emerald-500"
                    placeholder="800"
                  />
                  <div className="text-[10px] text-zinc-500 mt-1">
                    0 = aucun filtre de score (seul le flag Danger sera vérifié).
                  </div>
                </div>

                {/* Quick Presets */}
                <div>
                  <div className="flex items-center justify-between mb-1.5 text-[11px]">
                    <span className="text-zinc-300 font-semibold">PRESETS DE SÉCURITÉ</span>
                    <span className="text-[10px] text-zinc-500">Niveaux de prudence</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { label: 'Strict (<300)', val: '300' },
                      { label: 'Équilibré (<800)', val: '800' },
                      { label: 'Tolérant (<1200)', val: '1200' },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setMaxRugCheckScore(item.val)}
                        className={`py-1 text-[11px] rounded border transition-colors cursor-pointer ${
                          maxRugCheckScore === item.val
                            ? 'bg-emerald-500 text-black border-emerald-400 font-bold'
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Anti-Top & Bonding Curve Safety Layer (Protection cas $VOX) */}
          <div className="p-3.5 rounded border border-purple-900/40 bg-purple-950/10 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-400 shrink-0" />
                <div>
                  <div className="font-bold text-white text-xs flex items-center gap-2">
                    <span>FILTRES ANTI-SOMMET & PUMP.FUN CURVE (EX: CAS $VOX)</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-purple-900/50 text-purple-300 border border-purple-700/50">
                      Protection Exhaustion
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Évite d'acheter au sommet de la bonding curve (lorsque les premiers acheteurs déchargent leurs sacs)
                  </div>
                </div>
              </div>

              {/* 5-Min Momentum Anti-Dump Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-400 font-mono">Anti-Dump 5 min :</span>
                <button
                  type="button"
                  onClick={() => setRequirePositiveMomentum5m(!requirePositiveMomentum5m)}
                  className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors cursor-pointer ${
                    requirePositiveMomentum5m ? 'bg-purple-500' : 'bg-zinc-800'
                  }`}
                  title="Bloquer le snipe si les ventes écrasent les achats sur les 5 dernières minutes"
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      requirePositiveMomentum5m ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-850 space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Max Market Cap Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5 text-[11px]">
                    <span className="text-zinc-300 font-semibold">MARKET CAP MAX D'ENTRÉE ($)</span>
                    <span className="text-purple-300 font-bold">
                      {parseInt(maxEntryMarketCapUsd, 10) === 0 ? 'Désactivé' : `< $${parseInt(maxEntryMarketCapUsd, 10).toLocaleString()}`}
                    </span>
                  </div>
                  <input
                    type="number"
                    step="5000"
                    min="0"
                    max="1000000"
                    value={maxEntryMarketCapUsd}
                    onChange={(e) => setMaxEntryMarketCapUsd(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-white font-bold text-xs focus:outline-none focus:border-purple-500"
                    placeholder="40000"
                  />
                  <div className="grid grid-cols-4 gap-1 mt-1.5">
                    {[
                      { label: '25k$', val: '25000' },
                      { label: '40k$', val: '40000' },
                      { label: '60k$', val: '60000' },
                      { label: 'Off', val: '0' },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setMaxEntryMarketCapUsd(item.val)}
                        className={`py-1 text-[10px] rounded border transition-colors cursor-pointer ${
                          maxEntryMarketCapUsd === item.val
                            ? 'bg-purple-500 text-white border-purple-400 font-bold'
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    $VOX a été acheté à $50,120 MC. Un plafond à $40,000 bloque ce type de piège de fin de courbe.
                  </div>
                </div>

                {/* Max Token Age Input */}
                <div>
                  <div className="flex items-center justify-between mb-1.5 text-[11px]">
                    <span className="text-zinc-300 font-semibold">ÂGE MAXIMAL DU TOKEN (MINUTES)</span>
                    <span className="text-purple-300 font-bold">
                      {parseInt(maxTokenAgeMinutes, 10) === 0 ? 'Illimité' : `< ${maxTokenAgeMinutes} min`}
                    </span>
                  </div>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="1440"
                    value={maxTokenAgeMinutes}
                    onChange={(e) => setMaxTokenAgeMinutes(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-white font-bold text-xs focus:outline-none focus:border-purple-500"
                    placeholder="15"
                  />
                  <div className="grid grid-cols-4 gap-1 mt-1.5">
                    {[
                      { label: '5 min', val: '5' },
                      { label: '10 min', val: '10' },
                      { label: '15 min', val: '15' },
                      { label: 'Illimité', val: '0' },
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setMaxTokenAgeMinutes(item.val)}
                        className={`py-1 text-[10px] rounded border transition-colors cursor-pointer ${
                          maxTokenAgeMinutes === item.val
                            ? 'bg-purple-500 text-white border-purple-400 font-bold'
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    Les tokens snipés dans leurs premières minutes ont 83% de taux de succès supérieur.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Router Selection */}
          <div className="p-3 rounded border border-zinc-850 bg-black">
            <div className="flex items-center justify-between mb-2">
              <label className="text-zinc-400 font-semibold">ROUTEUR DE SWAP</label>
              <span className="text-[10px] text-zinc-500">Routage de liquidité</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['jupiter', 'jito', 'gmgn'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRouter(r)}
                  className={`py-2 px-2 text-center rounded border uppercase transition-colors cursor-pointer text-xs ${
                    router === r
                      ? 'bg-white text-black border-white font-bold'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                  }`}
                >
                  {r === 'jupiter' ? 'Jupiter V6' : r === 'jito' ? 'Jito MEV' : 'Raydium/GMGN'}
                </button>
              ))}
            </div>
          </div>

          {/* Priority Fee & Jito MEV Tip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded border border-zinc-850 bg-black">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-zinc-400 font-semibold">PRIORITY FEE (SOL)</label>
                <span className="text-[10px] text-zinc-500">Vitesse réseau Solana</span>
              </div>
              <input
                type="number"
                step="0.001"
                min="0.0001"
                value={priorityFee}
                onChange={(e) => setPriorityFee(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-white"
              />
            </div>

            <div className="p-3 rounded border border-zinc-850 bg-black">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-zinc-400 font-semibold">POURBOIRE JITO MEV (SOL)</label>
                <span className="text-[10px] text-zinc-500">Protection anti-frontrun</span>
              </div>
              <input
                type="number"
                step="0.001"
                min="0.0001"
                value={jitoTip}
                onChange={(e) => setJitoTip(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-white"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded bg-white text-black font-bold uppercase tracking-wider hover:bg-zinc-200 transition-colors cursor-pointer text-sm shadow-sm flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Enregistrer & Sauvegarder la Configuration
          </button>
        </form>
      </div>
    </div>
  );
};
