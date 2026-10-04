import React, { useState, useEffect } from 'react';
import { authFetch, safeJson } from '../api';
import {
  Radio,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Layers,
  User,
  Key,
  Smartphone,
  Lock,
  MessageSquare,
  Search,
  RefreshCw,
  LogOut,
  HelpCircle,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { TelegramStatus } from '../types';

interface TelegramChannelManagerProps {
  status: TelegramStatus | null;
  onChannelsUpdated?: (updatedStatus: TelegramStatus) => void;
  compact?: boolean;
}

interface UserDialog {
  id: string;
  title: string;
  username?: string;
  isChannel: boolean;
  isGroup: boolean;
  unreadCount?: number;
  isMonitored: boolean;
}

const PRESET_CHANNELS = [
  { name: 'dexscreener_solana', label: 'DexScreener Solana Alerts', desc: 'Alertes tendances, volume 1h et nouveaux tokens Solana' },
  { name: 'pumpdotfunalert', label: 'Pump.fun Alert', desc: 'Alertes whales & migrations pump.fun en direct' },
  { name: 'solana_gems', label: 'Solana Gems Calls', desc: 'Canal de calls et détection de pépites Solana' },
  { name: 'solana_tracker', label: 'Solana Tracker', desc: 'Nouveaux tokens & tracking volume Solana' },
  { name: 'solana_snipers', label: 'Solana Snipers', desc: 'Signaux et détections rapides de tokens' },
];

export const TelegramChannelManager: React.FC<TelegramChannelManagerProps> = ({
  status,
  onChannelsUpdated,
  compact = false,
}) => {
  const [activeTab, setActiveTab] = useState<'my_account' | 'public_channels'>('my_account');
  const [channelInput, setChannelInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // MTProto Account Login State
  const [phone, setPhone] = useState(status?.phone || '');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [loginStep, setLoginStep] = useState<'phone' | 'code'>(status?.authenticated ? 'phone' : 'phone');
  const [showApiHelper, setShowApiHelper] = useState(false);
  const [showSessionImport, setShowSessionImport] = useState(false);
  const [rawSessionString, setRawSessionString] = useState('');

  // Dialogs (User's personal channels & groups)
  const [userDialogs, setUserDialogs] = useState<UserDialog[]>([]);
  const [isLoadingDialogs, setIsLoadingDialogs] = useState(false);
  const [dialogSearch, setDialogSearch] = useState('');

  const channels: string[] = status?.channels && status.channels.length > 0 ? status.channels : [];
  const isAccountConnected = Boolean(status?.authenticated);

  // Auto-fetch user dialogs when account is connected
  useEffect(() => {
    if (isAccountConnected && activeTab === 'my_account' && userDialogs.length === 0 && !isLoadingDialogs) {
      fetchMyDialogs();
    }
  }, [isAccountConnected, activeTab]);

  const fetchMyDialogs = async () => {
    setIsLoadingDialogs(true);
    try {
      const res = await authFetch('/api/telegram/my-dialogs');
      const { data } = await safeJson(res);
      if (data.success && Array.isArray(data.dialogs)) {
        setUserDialogs(data.dialogs);
      } else if (data.error || data.message) {
        setFeedback({ type: 'error', text: data.error || data.message });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Impossible de récupérer vos canaux' });
    } finally {
      setIsLoadingDialogs(false);
    }
  };

  const handleToggleDialog = async (dialog: UserDialog) => {
    setIsProcessing(true);
    setFeedback(null);
    const identifier = dialog.username || dialog.id;
    try {
      const res = await authFetch('/api/telegram/toggle-dialog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        setUserDialogs((prev) =>
          prev.map((d) => (d.id === dialog.id ? { ...d, isMonitored: data.isMonitored } : d))
        );
        setFeedback({
          type: 'success',
          text: data.isMonitored
            ? `Canal "${dialog.title}" ajouté à la surveillance sniper !`
            : `Canal "${dialog.title}" retiré de la surveillance.`,
        });
        if (onChannelsUpdated) {
          const freshRes = await authFetch('/api/telegram/status');
          const { data: freshStatus } = await safeJson(freshRes);
          onChannelsUpdated(freshStatus);
        }
      } else {
        setFeedback({ type: 'error', text: data.error || data.message || 'Erreur lors de la mise à jour' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur lors de la mise à jour' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      setFeedback({ type: 'error', text: 'Veuillez saisir votre numéro de téléphone au format international (ex: +33612345678).' });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/telegram/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(),
          apiId: apiId.trim() ? Number(apiId.trim()) : undefined,
          apiHash: apiHash.trim() || undefined,
        }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        setLoginStep('code');
        setFeedback({
          type: 'success',
          text: 'Code envoyé ! Consultez votre application Telegram (ou SMS) pour copier le code de vérification.',
        });
      } else {
        setFeedback({ type: 'error', text: data.message || data.error || 'Échec de l\'envoi du code.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur réseau lors de l\'envoi du code' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneCode.trim()) {
      setFeedback({ type: 'error', text: 'Veuillez saisir le code reçu sur Telegram.' });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/telegram/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: phoneCode.trim(),
          password: twoFactorPassword.trim() || undefined,
        }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        setLoginStep('phone');
        setPhoneCode('');
        setTwoFactorPassword('');
        setFeedback({
          type: 'success',
          text: data.message || `Connecté avec succès en tant que @${data.user || 'utilisateur'} !`,
        });
        const freshRes = await authFetch('/api/telegram/status');
        const { data: freshStatus } = await safeJson(freshRes);
        if (onChannelsUpdated) onChannelsUpdated(freshStatus);
        await fetchMyDialogs();
      } else {
        setFeedback({ type: 'error', text: data.message || data.error || 'Code de vérification invalide.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur lors de la validation du code' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImportSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawSessionString.trim()) {
      setFeedback({ type: 'error', text: 'Veuillez coller votre chaîne de session GramJS.' });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/telegram/import-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionString: rawSessionString.trim(),
          apiId: apiId.trim() ? Number(apiId.trim()) : undefined,
          apiHash: apiHash.trim() || undefined,
        }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        setShowSessionImport(false);
        setRawSessionString('');
        setFeedback({
          type: 'success',
          text: data.message || `Session importée avec succès (@${data.user}) !`,
        });
        const freshRes = await authFetch('/api/telegram/status');
        const { data: freshStatus } = await safeJson(freshRes);
        if (onChannelsUpdated) onChannelsUpdated(freshStatus);
        await fetchMyDialogs();
      } else {
        setFeedback({ type: 'error', text: data.message || data.error || 'Chaîne de session invalide.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur réseau lors de l\'import' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDisconnect = async () => {
    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/telegram/disconnect', { method: 'POST' });
      const { data } = await safeJson(res);
      if (data.success) {
        setUserDialogs([]);
        setLoginStep('phone');
        setFeedback({ type: 'info', text: 'Compte Telegram déconnecté.' });
        const freshRes = await authFetch('/api/telegram/status');
        const { data: freshStatus } = await safeJson(freshRes);
        if (onChannelsUpdated) onChannelsUpdated(freshStatus);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur lors de la déconnexion' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddChannels = async (inputToAdd?: string) => {
    const raw = (inputToAdd !== undefined ? inputToAdd : channelInput).trim();
    if (!raw) return;

    const cleaned = raw
      .replace(/^https?:\/\//i, '')
      .replace(/^(?:www\.)?(?:telegram\.me|t\.me)\//i, '')
      .replace(/^s\//i, '')
      .replace(/^joinchat\//i, '')
      .replace(/^@/, '')
      .replace(/\/.*$/, '')
      .trim();

    if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleaned)) {
      setFeedback({
        type: 'error',
        text: `Identifiant "${cleaned || raw}" invalide. Utilisez entre 3 et 32 caractères alphanumériques ou underscore.`,
      });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/telegram/add-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: raw }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        setFeedback({
          type: 'success',
          text: `${raw} ajouté à la surveillance avec succès !`,
        });
        if (inputToAdd === undefined) setChannelInput('');
        const freshRes = await authFetch('/api/telegram/status');
        const { data: freshStatus } = await safeJson(freshRes);
        if (onChannelsUpdated) onChannelsUpdated(freshStatus);
      } else {
        setFeedback({
          type: 'error',
          text: data.error || data.message || 'Impossible d\'ajouter ce canal (déjà présent ou invalide).',
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur réseau' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveChannel = async (channelSlug: string) => {
    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await authFetch('/api/telegram/remove-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelSlug }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        setFeedback({
          type: 'info',
          text: `Canal ${channelSlug} retiré de la surveillance.`,
        });
        const freshRes = await authFetch('/api/telegram/status');
        const { data: freshStatus } = await safeJson(freshRes);
        if (onChannelsUpdated) onChannelsUpdated(freshStatus);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur réseau' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearAll = async () => {
    setIsProcessing(true);
    setFeedback(null);
    setShowClearConfirm(false);
    try {
      const res = await authFetch('/api/telegram/set-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: [] }),
      });
      const { data } = await safeJson(res);
      if (data.success) {
        setFeedback({
          type: 'info',
          text: 'Tous les canaux ont été vidés.',
        });
        const freshRes = await authFetch('/api/telegram/status');
        const { data: freshStatus } = await safeJson(freshRes);
        if (onChannelsUpdated) onChannelsUpdated(freshStatus);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur réseau' });
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredDialogs = userDialogs.filter((d) => {
    if (!dialogSearch.trim()) return true;
    const q = dialogSearch.toLowerCase();
    return d.title.toLowerCase().includes(q) || (d.username && d.username.toLowerCase().includes(q));
  });

  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs ${compact ? 'p-3 space-y-3' : 'p-4 sm:p-5 space-y-4'}`}>
      {/* Top Header & Mode Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-zinc-900 border border-zinc-800 text-emerald-400">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <span>Gestionnaire de Canaux Telegram</span>
              {isAccountConnected ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connecté @{status?.authenticatedUser || 'MTProto'}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-900 text-zinc-400 border border-zinc-800">
                  Mode Flux Public
                </span>
              )}
            </div>
            {!compact && (
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Connectez votre propre compte Telegram ou surveillez des canaux publics Solana.
              </p>
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center bg-black p-0.5 rounded border border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab('my_account')}
            className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'my_account'
                ? 'bg-emerald-500 text-black font-bold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Mon Compte Telegram</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('public_channels')}
            className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'public_channels'
                ? 'bg-emerald-500 text-black font-bold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Canaux Publics ({channels.length})</span>
          </button>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`p-2.5 rounded text-xs flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-300'
              : feedback.type === 'error'
              ? 'bg-red-950/60 border border-red-800/60 text-red-300'
              : 'bg-sky-950/60 border border-sky-800/60 text-sky-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : feedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <Layers className="w-4 h-4 text-sky-400 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-zinc-500 hover:text-white text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 1: MON COMPTE TELEGRAM (MTPROTO & DIALOGS)               */}
      {/* ============================================================ */}
      {activeTab === 'my_account' && (
        <div className="space-y-4">
          {isAccountConnected ? (
            /* Connected state */
            <div className="space-y-4">
              <div className="p-3.5 rounded bg-zinc-900/60 border border-emerald-900/50 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span>Connecté à Telegram :</span>
                      <span className="text-emerald-400 font-mono">@{status?.authenticatedUser || 'Session active'}</span>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Les signaux postés dans vos canaux et groupes privés sont audités et snipés en direct.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={fetchMyDialogs}
                    disabled={isLoadingDialogs}
                    className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-750 text-white font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 text-[11px]"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDialogs ? 'animate-spin text-emerald-400' : ''}`} />
                    <span>{isLoadingDialogs ? 'Chargement...' : 'Actualiser mes canaux'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={isProcessing}
                    className="px-3 py-1.5 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800 text-red-300 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 text-[11px]"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Déconnecter</span>
                  </button>
                </div>
              </div>

              {/* User Dialogs & Channels list */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                    <span className="font-semibold text-white text-xs">
                      Vos Canaux et Groupes Telegram ({userDialogs.length})
                    </span>
                  </div>

                  {userDialogs.length > 0 && (
                    <div className="relative w-48 sm:w-64">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-zinc-500" />
                      <input
                        type="text"
                        placeholder="Rechercher un canal..."
                        value={dialogSearch}
                        onChange={(e) => setDialogSearch(e.target.value)}
                        className="w-full bg-black border border-zinc-800 rounded pl-8 pr-2.5 py-1 text-white text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  )}
                </div>

                {isLoadingDialogs && userDialogs.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-zinc-800 rounded bg-black/40 space-y-2">
                    <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin mx-auto" />
                    <p className="text-zinc-400 text-xs">Récupération des canaux et groupes de votre compte Telegram...</p>
                  </div>
                ) : userDialogs.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-zinc-800 rounded bg-black/40 space-y-2">
                    <p className="text-zinc-400 text-xs">Aucun canal ou groupe chargé pour le moment.</p>
                    <button
                      type="button"
                      onClick={fetchMyDialogs}
                      disabled={isLoadingDialogs}
                      className="px-3.5 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Charger mes canaux Telegram</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1">
                    {filteredDialogs.map((dialog) => (
                      <div
                        key={dialog.id}
                        className={`p-3 rounded border flex items-center justify-between gap-2 transition-all ${
                          dialog.isMonitored
                            ? 'bg-emerald-950/30 border-emerald-800/80 shadow-sm'
                            : 'bg-black border-zinc-850 hover:border-zinc-750'
                        }`}
                      >
                        <div className="truncate min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                dialog.isMonitored ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
                              }`}
                            />
                            <span className="font-semibold text-white text-xs truncate" title={dialog.title}>
                              {dialog.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400">
                            {dialog.username ? (
                              <span className="text-sky-400 font-mono">@{dialog.username}</span>
                            ) : (
                              <span className="text-zinc-500 font-mono">Groupe privé</span>
                            )}
                            <span className="text-zinc-600">•</span>
                            <span className="text-zinc-500">{dialog.isChannel ? 'Canal' : 'Groupe'}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleToggleDialog(dialog)}
                          disabled={isProcessing}
                          className={`px-2.5 py-1 rounded text-[11px] font-bold shrink-0 transition-colors cursor-pointer ${
                            dialog.isMonitored
                              ? 'bg-emerald-500 text-black hover:bg-red-500 hover:text-white'
                              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                          }`}
                        >
                          {dialog.isMonitored ? 'Surveillé ✓' : '+ Surveiller'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Disconnected state: Login Form */
            <div className="p-4 sm:p-5 rounded-lg bg-black border border-zinc-800 space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-zinc-900 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-white font-bold text-xs uppercase">
                    <Smartphone className="w-4 h-4 text-emerald-400" />
                    <span>Connexion Directe à Votre Compte Telegram</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Connectez votre compte pour écouter vos <strong>canaux privés, groupes VIP, ou discussions directes</strong> où sont partagés les signaux Solana.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowSessionImport(!showSessionImport)}
                  className="text-[10px] text-emerald-400 hover:underline shrink-0"
                >
                  {showSessionImport ? 'Utiliser numéro SMS' : 'Importer une StringSession'}
                </button>
              </div>

              {showSessionImport ? (
                /* Alternative: StringSession paste */
                <form onSubmit={handleImportSession} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-300 font-semibold block">
                      Chaîne de session GramJS (StringSession) :
                    </label>
                    <textarea
                      rows={3}
                      value={rawSessionString}
                      onChange={(e) => setRawSessionString(e.target.value)}
                      placeholder="Collez ici votre session Telegram (ex: 1BJWap8wBu7b...)..."
                      className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-0.5">API ID (optionnel si dans .env) :</label>
                      <input
                        type="number"
                        placeholder="Ex: 27481920"
                        value={apiId}
                        onChange={(e) => setApiId(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 block mb-0.5">API HASH (optionnel si dans .env) :</label>
                      <input
                        type="text"
                        placeholder="Ex: 8a4f91b..."
                        value={apiHash}
                        onChange={(e) => setApiHash(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isProcessing || !rawSessionString.trim()}
                    className="w-full py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isProcessing ? 'Connexion en cours...' : 'Se connecter avec la StringSession'}
                  </button>
                </form>
              ) : loginStep === 'phone' ? (
                /* Step 1: Input Phone + API Credentials */
                <form onSubmit={handleSendCode} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-300 font-semibold block flex items-center justify-between">
                      <span>Numéro de téléphone Telegram :</span>
                      <span className="text-[10px] text-zinc-500 font-normal">Format international obligatoire</span>
                    </label>
                    <div className="relative">
                      <Smartphone className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                      <input
                        type="tel"
                        placeholder="+33612345678 ou +242068658897..."
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        disabled={isProcessing}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded pl-9 pr-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
                        required
                      />
                    </div>
                  </div>

                  {/* Optional API ID & Hash inputs */}
                  <div className="p-3 rounded bg-zinc-950 border border-zinc-900 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-amber-400" />
                        <span>Identifiants API Telegram (my.telegram.org)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowApiHelper(!showApiHelper)}
                        className="text-[10px] text-zinc-500 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        <HelpCircle className="w-3 h-3" />
                        <span>Comment les obtenir ?</span>
                      </button>
                    </div>

                    {showApiHelper && (
                      <div className="p-2.5 rounded bg-zinc-900/80 border border-zinc-800 text-[10px] text-zinc-400 space-y-1">
                        <p>1. Connectez-vous sur <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline">https://my.telegram.org</a> avec votre numéro Telegram.</p>
                        <p>2. Cliquez sur <strong>API development tools</strong>.</p>
                        <p>3. Renseignez un nom d'application pour obtenir immédiatement votre <strong>api_id</strong> et <strong>api_hash</strong>.</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <input
                          type="number"
                          placeholder="API ID (ex: 2849102)"
                          value={apiId}
                          onChange={(e) => setApiId(e.target.value)}
                          className="w-full bg-black border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="API HASH (ex: 7fa01c...)"
                          value={apiHash}
                          onChange={(e) => setApiHash(e.target.value)}
                          className="w-full bg-black border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isProcessing || !phone.trim()}
                    className="w-full py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <span>{isProcessing ? 'Envoi en cours...' : 'Envoyer le Code de Vérification Telegram'}</span>
                  </button>
                </form>
              ) : (
                /* Step 2: Input Code & 2FA */
                <form onSubmit={handleVerifyCode} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-300 font-semibold block">
                      Code de vérification Telegram reçu sur {phone} :
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                      <input
                        type="text"
                        placeholder="Ex: 58291"
                        value={phoneCode}
                        onChange={(e) => setPhoneCode(e.target.value)}
                        disabled={isProcessing}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded pl-9 pr-3 py-2 text-white text-xs font-mono tracking-widest focus:outline-none focus:border-emerald-500"
                        autoFocus
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400 font-semibold block flex items-center justify-between">
                      <span>Mot de passe 2FA (si activé sur votre compte) :</span>
                      <span className="text-[10px] text-zinc-500">Optionnel</span>
                    </label>
                    <input
                      type="password"
                      placeholder="Mot de passe de double authentification..."
                      value={twoFactorPassword}
                      onChange={(e) => setTwoFactorPassword(e.target.value)}
                      disabled={isProcessing}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setLoginStep('phone')}
                      className="px-3 py-2 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 text-xs cursor-pointer"
                    >
                      Retour
                    </button>
                    <button
                      type="submit"
                      disabled={isProcessing || !phoneCode.trim()}
                      className="flex-1 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isProcessing ? 'Validation en cours...' : 'Valider & Connecter mon Compte'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 2: CANAUX PUBLICS & ALERTES                             */}
      {/* ============================================================ */}
      {activeTab === 'public_channels' && (
        <div className="space-y-4">
          {/* Quick Add Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAddChannels();
            }}
            className="space-y-2"
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Ex: dexscreener_solana, pumpdotfunalert, @channel..."
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  disabled={isProcessing}
                  className="w-full bg-black border border-zinc-800 rounded px-3 py-2 text-white text-xs font-mono placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <button
                type="submit"
                disabled={isProcessing || !channelInput.trim()}
                className="px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ajouter</span>
              </button>
            </div>

            {/* Presets suggestions */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[10px] text-zinc-500 mr-1 self-center">Canaux recommandés :</span>
              {PRESET_CHANNELS.map((preset) => {
                const isAlreadyAdded = channels.includes(preset.name);
                return (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => !isAlreadyAdded && handleAddChannels(preset.name)}
                    disabled={isAlreadyAdded || isProcessing}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors flex items-center gap-1 cursor-pointer ${
                      isAlreadyAdded
                        ? 'bg-zinc-900/60 text-zinc-500 border border-zinc-850 cursor-default'
                        : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-emerald-600/50'
                    }`}
                  >
                    <Plus className="w-2.5 h-2.5" />
                    <span>t.me/{preset.name}</span>
                    {isAlreadyAdded && <span className="text-[9px] text-emerald-500">✓</span>}
                  </button>
                );
              })}
            </div>
          </form>

          {/* Active Channels List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>Canaux publics sous surveillance active ({channels.length}) :</span>
              {channels.length > 0 && (
                showClearConfirm ? (
                  <div className="flex items-center gap-1.5 bg-red-950/80 border border-red-800 px-2 py-1 rounded text-[10px]">
                    <span className="text-red-300">Confirmer ?</span>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="px-1.5 py-0.5 rounded bg-red-600 text-white font-bold cursor-pointer"
                    >
                      Oui, Vider
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(false)}
                      className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 cursor-pointer"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(true)}
                    className="text-[10px] text-zinc-500 hover:text-red-400 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Tout vider</span>
                  </button>
                )
              )}
            </div>

            {channels.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-zinc-800 rounded bg-black/40 space-y-2">
                <p className="text-zinc-400 text-xs font-semibold">Aucun canal public surveillé</p>
                <p className="text-zinc-600 text-[11px]">
                  Ajoutez un canal ci-dessus ou connectez votre compte Telegram dans l'onglet dédié.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {channels.map((ch) => {
                  const clean = ch.replace('https://t.me/', '').replace('t.me/', '').replace('@', '');
                  const slug = `t.me/${clean}`;
                  const count = status?.channelCounts?.[slug] ?? 0;
                  const error = status?.channelErrors?.[slug];

                  return (
                    <div
                      key={ch}
                      className={`flex items-center justify-between p-2.5 rounded bg-black border transition-colors group ${
                        error ? 'border-amber-900/60 bg-amber-950/10' : 'border-zinc-850 hover:border-zinc-750'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            error ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
                          }`}
                        />
                        <div className="truncate min-w-0">
                          <div className="flex items-center gap-1 text-xs font-semibold text-white truncate">
                            <span className="truncate">t.me/{clean}</span>
                            <a
                              href={`https://t.me/${clean}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Ouvrir dans Telegram"
                              className="text-zinc-600 hover:text-sky-400 shrink-0"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          {error ? (
                            <div className="text-[10px] text-amber-400/90 font-mono truncate" title={error}>
                              ⚠️ {error}
                            </div>
                          ) : (
                            <div className="text-[10px] text-zinc-500 font-mono">
                              {count} alerte{count > 1 ? 's' : ''} reçue{count > 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveChannel(clean)}
                        disabled={isProcessing}
                        title={`Retirer t.me/${clean}`}
                        className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-900 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
